import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Layers, BookOpen, Plus, X, Search, Download, RefreshCw, Trash2, Loader2,
  Clock, Check, AlertTriangle, Square, Users, Play,
  Video as VideoIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtTime, fmtAgo } from '../lib/api.js';
import { fmtCountdown, useNow } from '../lib/mediaPolicy.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';
import PromptLibrary from '../components/PromptLibrary.jsx';

/* Tạo video hàng loạt (kiểu Meosu): dán nhiều prompt, mỗi dòng là một video.
   Trang VIDEO-ONLY, hoàn toàn riêng với tab Canvas.
   - Bố cục 3 cột: form tạo | hàng đợi | chi tiết kết quả.
   - Không có hàng đợi phía server: runner chạy ở client, tối đa
     clamp(số tài khoản khả dụng, 1, 4) luồng cùng lúc (mặc định 1).
   - Tác vụ lưu vào localStorage ('xm_batch_video') nên tải lại trang vẫn
     giữ hàng đợi; task đang chạy có jobId thì tiếp tục poll để hồi trạng thái. */

const STORE_KEY = 'xm_batch_video';
const CHAR_STORE_KEY = 'xm_characters';
const VIDEO_SIZES = ['9:16', '16:9', '1:1'];
const DURATIONS = [5, 8, 10];
const STATUS_LABEL = { pending: 'Chờ', running: 'Đang tạo', done: 'Hoàn tất', failed: 'Thất bại' };

const fmtElapsed = (ms) => {
  if (ms == null || ms < 0) return '00:00';
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const parseLines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

const loadTasks = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
};

const loadCharacters = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAR_STORE_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
};

export default function BatchVideo() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const now = useNow(1000);

  const [tasks, setTasks] = useState(loadTasks);
  const [lines, setLines] = useState('');
  const [size, setSize] = useState('9:16');
  const [duration, setDuration] = useState(5);
  const [refMode, setRefMode] = useState('shared');
  const [refs, setRefs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortNewest, setSortNewest] = useState(true);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [retentionDays, setRetentionDays] = useState(7);

  /* ---------- nhân vật (lưu localStorage 'xm_characters') ---------- */
  const [characters, setCharacters] = useState(loadCharacters);
  const [keepChar, setKeepChar] = useState(false);
  const [keepCharId, setKeepCharId] = useState(null);
  const [showCharForm, setShowCharForm] = useState(false);
  const [charName, setCharName] = useState('');
  const [charNote, setCharNote] = useState('');
  const [charPhotos, setCharPhotos] = useState([]);
  const [charUploading, setCharUploading] = useState(false);

  const fileRef = useRef(null);
  const charFileRef = useRef(null);
  const tasksRef = useRef(tasks);
  const stopRef = useRef(false);
  const loopRef = useRef(false);
  const runningRef = useRef(false);
  const concurrencyRef = useRef(1);
  const mountedRef = useRef(true);

  const perVideo = 10 + 2 * duration;
  const lineCount = parseLines(lines).length;
  const totalCost = lineCount * perVideo;
  const concurrency = Math.min(4, Math.max(1, summary?.usable || 1));
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  /* ---------- đồng bộ ref / lưu trữ ---------- */
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { concurrencyRef.current = concurrency; }, [concurrency]);
  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => { localStorage.setItem(CHAR_STORE_KEY, JSON.stringify(characters)); }, [characters]);
  useEffect(() => () => { mountedRef.current = false; stopRef.current = true; }, []);

  /* ---------- tài khoản + chính sách lưu trữ ---------- */
  useEffect(() => {
    let alive = true;
    const load = () => api.accounts()
      .then((d) => { if (alive) setSummary(d.summary); })
      .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    api.jobs({ pageSize: 1 })
      .then((out) => { if (out.mediaRetentionDays) setRetentionDays(Number(out.mediaRetentionDays)); })
      .catch(() => {});
  }, []);

  /* ---------- cập nhật tác vụ (tasksRef là nguồn thật, setTasks chỉ báo React) ---------- */
  const setTasksAll = (next) => {
    tasksRef.current = next;
    setTasks(next);
  };

  const updateTask = (id, patch) => {
    setTasksAll(tasksRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  /* ---------- poll các task đang chạy (hồi trạng thái sau khi tải lại trang) ---------- */
  useEffect(() => {
    const runningTasks = tasks.filter((t) => t.status === 'running' && t.jobId);
    if (!runningTasks.length) return undefined;
    const t = setTimeout(async () => {
      const results = await Promise.all(
        runningTasks.map(async (task) => {
          try { return { id: task.jobId, job: (await api.job(task.jobId)).job }; } catch { return null; }
        })
      );
      let allTerminal = true;
      const next = tasksRef.current.map((task) => {
        if (task.status !== 'running' || !task.jobId) return task;
        const hit = results.find((r) => r?.id === task.jobId)?.job;
        if (!hit) { allTerminal = false; return task; }
        if (hit.status === 'completed') {
          return { ...task, status: 'done', progress: 100, mediaUrl: hit.mediaUrl || task.mediaUrl, finishedAt: Date.now() };
        }
        if (hit.status === 'failed') {
          return { ...task, status: 'failed', error: hit.error || 'Tạo thất bại', finishedAt: Date.now() };
        }
        allTerminal = false;
        if ((hit.progress ?? task.progress) !== task.progress || (hit.mediaUrl && hit.mediaUrl !== task.mediaUrl)) {
          return { ...task, progress: hit.progress ?? task.progress, mediaUrl: hit.mediaUrl || task.mediaUrl };
        }
        return task;
      });
      setTasksAll(next);
      if (allTerminal) refresh();
    }, 2500);
    return () => clearTimeout(t);
  }, [tasks, refresh]);

  /* ---------- runner: khởi động task chờ, tối đa concurrency luồng ---------- */
  const startTask = async (task) => {
    updateTask(task.id, { status: 'running', startedAt: Date.now(), progress: 5 });
    try {
      const out = await api.createVideo({
        prompt: task.prompt,
        duration: task.duration,
        size: task.size,
        images: task.refUrls,
      });
      const job = out.job;
      updateTask(task.id, { jobId: job.id, progress: job.progress ?? 15 });
      refresh();
    } catch (e) {
      updateTask(task.id, { status: 'failed', error: e.message || 'Tạo thất bại', finishedAt: Date.now() });
      if (e.status === 402) {
        stopRef.current = true;
        toast('Không đủ điểm — đã dừng hàng loạt', 'error');
      } else {
        toast(e.message, 'error');
      }
    }
  };

  const runLoop = async () => {
    while (mountedRef.current) {
      if (stopRef.current) return;
      const cur = tasksRef.current;
      const runningNow = cur.filter((t) => t.status === 'running').length;
      const pending = cur.filter((t) => t.status === 'pending');
      if (!pending.length && runningNow === 0) return;
      const slots = Math.max(0, (concurrencyRef.current || 1) - runningNow);
      if (pending.length && slots > 0) {
        pending.slice(0, slots).forEach((t) => { startTask(t); });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const ensureLoop = () => {
    if (loopRef.current) return;
    loopRef.current = true;
    (async () => {
      await runLoop();
      loopRef.current = false;
      runningRef.current = false;
      setRunning(false);
      const cur = tasksRef.current;
      if (cur.length && !cur.some((t) => t.status === 'pending' || t.status === 'running')) {
        toast('Đã tạo xong tất cả video', 'ok');
      }
      refresh();
    })();
  };

  /* ---------- bắt đầu / dừng ---------- */
  const startBatch = () => {
    const prompts = parseLines(lines);
    const pending = tasksRef.current.filter((t) => t.status === 'pending');
    if (!prompts.length && !pending.length) {
      return toast('Nhập ít nhất một prompt (mỗi dòng một video)', 'error');
    }
    if (summary && !summary.usable) {
      return toast('Chưa có tài khoản khả dụng — vào tab Nhập Muse để thêm', 'error');
    }
    if (prompts.length) {
      const total = prompts.length * perVideo;
      if ((user?.credits ?? 0) < total) {
        return toast(`Không đủ điểm, cần ${total} điểm cho ${prompts.length} video`, 'error');
      }
      const base = tasksRef.current.length
        ? Math.max(...tasksRef.current.map((t) => t.index)) + 1
        : 1;
      const newTasks = prompts.map((prompt, i) => {
        const charUrls = charUrlsForPrompt(prompt);
        const baseRefs = refMode === 'shared'
          ? refs.map((r) => r.url)
          : (refs[i] ? [refs[i].url] : []);
        return {
          id: `b_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
          index: base + i,
          prompt,
          status: 'pending',
          jobId: null,
          progress: 0,
          mediaUrl: null,
          error: null,
          cost: perVideo,
          duration,
          size,
          /* ảnh nhân vật trước, rồi tới ảnh tham chiếu đã tải, tối đa 3 ảnh */
          refUrls: [...charUrls, ...baseRefs.filter((u) => !charUrls.includes(u))].slice(0, 3),
          createdAt: Date.now() + i,
          startedAt: null,
          finishedAt: null,
        };
      });
      setTasksAll([...tasksRef.current, ...newTasks]);
      setSelectedId(newTasks[0].id);
      setLines('');
      toast(`Đã thêm ${newTasks.length} video vào hàng đợi`, 'ok');
    }
    stopRef.current = false;
    runningRef.current = true;
    setRunning(true);
    ensureLoop();
  };

  const stopBatch = () => {
    stopRef.current = true;
    runningRef.current = false;
    setRunning(false);
    toast('Đã dừng — các video đang tạo vẫn chạy tiếp trên máy chủ', 'info');
  };

  /* ---------- tác vụ đơn ---------- */
  const deleteTask = async (task) => {
    if (task.jobId) {
      try { await api.deleteJob(task.jobId); } catch { /* ignore */ }
    }
    setTasksAll(tasksRef.current.filter((t) => t.id !== task.id));
    if (selectedId === task.id) setSelectedId(null);
    toast('Đã xóa tác vụ', 'ok');
  };

  const regenerate = (task) => {
    if (!['done', 'failed'].includes(task.status)) return;
    setTasksAll(tasksRef.current.map((t) => (t.id === task.id
      ? { ...t, status: 'pending', jobId: null, progress: 0, mediaUrl: null, error: null, startedAt: null, finishedAt: null }
      : t)));
    stopRef.current = false;
    runningRef.current = true;
    setRunning(true);
    ensureLoop();
    toast('Đã đưa video này vào hàng đợi để tạo lại', 'ok');
  };

  /* ---------- tải ảnh tham chiếu ---------- */
  const onPick = async (files) => {
    if (!files?.length) return;
    if (refs.length + files.length > 3) return toast('Tối đa 3 ảnh tham khảo', 'error');
    setUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setRefs((r) => [...r, ...out.files].slice(0, 3));
      toast('Đã tải ảnh lên', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /* ---------- nhân vật: ảnh gắn theo tên trong prompt + nhân vật giữ nguyên ---------- */
  const charUrlsForPrompt = (prompt) => {
    const urls = [];
    if (keepChar && keepCharId) {
      const kc = characters.find((c) => c.id === keepCharId);
      if (kc) kc.photos.forEach((p) => { if (!urls.includes(p.url)) urls.push(p.url); });
    }
    const lower = (prompt || '').toLowerCase();
    characters.forEach((c) => {
      if (c.name && lower.includes(c.name.toLowerCase())) {
        c.photos.forEach((p) => { if (!urls.includes(p.url)) urls.push(p.url); });
      }
    });
    return urls;
  };

  const onPickCharPhotos = async (files) => {
    if (!files?.length) return;
    if (charPhotos.length + files.length > 3) return toast('Tối đa 3 ảnh mặt cho một nhân vật', 'error');
    setCharUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setCharPhotos((r) => [...r, ...out.files].slice(0, 3));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCharUploading(false);
      if (charFileRef.current) charFileRef.current.value = '';
    }
  };

  const saveCharacter = () => {
    const name = charName.trim();
    if (!name || !charPhotos.length) return;
    const c = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      note: charNote.trim(),
      photos: charPhotos,
      createdAt: Date.now(),
    };
    setCharacters((list) => [...list, c]);
    setCharName('');
    setCharNote('');
    setCharPhotos([]);
    setShowCharForm(false);
    toast('Đã lưu nhân vật', 'ok');
  };

  const deleteCharacter = (c) => {
    if (!confirm(`Xóa nhân vật "${c.name}"?`)) return;
    setCharacters((list) => list.filter((x) => x.id !== c.id));
    if (keepCharId === c.id) {
      setKeepCharId(null);
      setKeepChar(false);
    }
    toast('Đã xóa nhân vật', 'ok');
  };

  const usePrompt = (p) => {
    const text = (p.text || '').replace(/\s*\n\s*/g, ' ').trim();
    if (!text) return;
    setLines((prev) => (prev.trim() ? `${prev.replace(/\n+$/, '')}\n${text}` : text));
    setLibraryOpen(false);
    toast('Đã thêm prompt vào danh sách', 'ok');
  };

  /* ---------- lọc / sắp xếp hàng đợi ---------- */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tasks.filter((t) => {
      if (statusFilter === 'running' && !['running', 'pending'].includes(t.status)) return false;
      if (statusFilter === 'done' && t.status !== 'done') return false;
      if (statusFilter === 'failed' && t.status !== 'failed') return false;
      if (!q) return true;
      const num = `#${String(t.index).padStart(3, '0')}`;
      return t.prompt.toLowerCase().includes(q) || num.toLowerCase().includes(q) || String(t.index) === q;
    });
    return [...list].sort((a, b) => (sortNewest ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));
  }, [tasks, query, statusFilter, sortNewest]);

  /* nhân vật có tên xuất hiện trong các dòng prompt đang nhập */
  const matchedCharacters = useMemo(() => {
    const text = lines.toLowerCase();
    if (!text.trim()) return [];
    return characters.filter((c) => c.name && text.includes(c.name.toLowerCase()));
  }, [lines, characters]);

  const selected = tasks.find((t) => t.id === selectedId)
    || [...tasks].sort((a, b) => b.createdAt - a.createdAt)[0]
    || null;
  const selectedElapsed = selected?.startedAt
    ? (selected.finishedAt || now) - selected.startedAt
    : 0;
  const selectedDeleteAt = selected?.status === 'done' && selected.mediaUrl && selected.finishedAt
    ? selected.finishedAt + retentionDays * 86400 * 1000
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ---------------- tiêu đề + tài khoản ---------------- */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/[0.05] px-4 py-3.5 lg:px-6">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/10 text-brand-300">
          <Layers size={18} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[16px] font-semibold text-white">Video hàng loạt</h1>
          <p className="text-[12px] text-mist-400">
            Mỗi dòng là một video — chạy nối tiếp, tối đa {concurrency} luồng cùng lúc
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => nav('/accounts')}
            title={summary?.usable ? `Tài khoản khả dụng ${summary.usable}/${summary.total}` : 'Chưa có tài khoản khả dụng, bấm vào đây để nhập'}
            className={clsx(
              'flex items-center gap-3 rounded-2xl border px-3.5 py-2 transition',
              summary?.usable
                ? 'border-white/[0.07] bg-white/[0.02] hover:border-brand-400/40'
                : 'border-amber-500/40 bg-amber-500/10 hover:border-amber-400'
            )}
          >
            {summary?.usable ? (
              <>
                <Users size={14} className="text-mist-300" />
                <div className="text-left">
                  <p className="text-[11.5px] text-mist-200">
                    {summary.usable} tài khoản · Còn {summary.weeklyLeftPct ?? '—'}%
                  </p>
                  <div className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400"
                      style={{ width: `${Math.max(2, summary.weeklyLeftPct ?? 0)}%` }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <AlertTriangle size={13} className="text-amber-400" />
                <span className="text-[12px] text-amber-300">Chưa kết nối tài khoản</span>
              </>
            )}
          </button>
          <button
            onClick={() => api.accounts().then((d) => setSummary(d.summary)).catch(() => {})}
            title="Làm mới hạn mức"
            className="grid h-9 w-9 place-items-center rounded-xl text-mist-400 transition hover:bg-white/5 hover:text-brand-300"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {/* ---------------- 3 cột ---------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4 lg:overflow-hidden lg:px-6">
        <div className="grid grid-cols-1 gap-4 lg:h-full lg:grid-cols-3">

          {/* ===== Cột trái: form tạo ===== */}
          <section className="panel flex min-h-0 flex-col p-4">
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-white">Tạo video hàng loạt</h2>
              <button
                onClick={() => setLibraryOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] px-2.5 text-[12px] text-mist-200 transition hover:border-brand-400/40 hover:text-brand-300"
              >
                <BookOpen size={13} /> Mẫu prompt
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 lg:overflow-y-auto lg:pr-1">
              <div>
                <textarea
                  value={lines}
                  onChange={(e) => setLines(e.target.value)}
                  rows={8}
                  placeholder="Mỗi dòng là một video…&#10;Ví dụ:&#10;Mèo con đang chơi bóng len trong sân&#10;Chó Shiba chạy trên bãi biển lúc hoàng hôn"
                  className="block w-full resize-none rounded-xl border border-white/[0.07] bg-[#0d111c] px-3.5 py-3 text-[13.5px] leading-relaxed text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
                />
                <p className="mt-1.5 text-right font-mono text-[11px] text-mist-400">
                  {lineCount} video · {lines.length} ký tự
                </p>
                {matchedCharacters.length > 0 && (
                  <p className="mt-1 text-[11.5px] text-mist-400">
                    Nhân vật được nhận ra: <span className="text-brand-300">{matchedCharacters.map((c) => c.name).join(', ')}</span>
                  </p>
                )}
              </div>

              {/* Ảnh tham chiếu */}
              <div>
                <p className="mb-2 text-[13px] font-medium text-mist-200">Ảnh tham chiếu</p>
                <div className="flex flex-wrap items-center gap-2">
                  {refs.map((r) => (
                    <div key={r.url} className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#0d111c] py-1 pl-1 pr-2">
                      <img src={r.url} alt="" className="h-9 w-12 rounded-lg object-cover" />
                      <span className="max-w-[110px] truncate text-[12px] text-mist-200">
                        {r.name || r.url.split('/').pop()}
                      </span>
                      <button
                        onClick={() => setRefs((l) => l.filter((x) => x.url !== r.url))}
                        className="text-mist-400 hover:text-rose-400"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  {refs.length < 3 && (
                    <button
                      onClick={() => fileRef.current?.click()}
                      title="Tải ảnh tham khảo lên (tối đa 3 ảnh)"
                      className="grid h-12 w-12 place-items-center rounded-xl border border-white/[0.07] bg-[#0d111c] text-mist-300 transition hover:border-brand-400/50 hover:text-brand-300"
                    >
                      {uploading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
                    </button>
                  )}
                  {refs.length === 0 && (
                    <span className="text-[11.5px] text-mist-400">Không bắt buộc, tối đa 3 ảnh</span>
                  )}
                </div>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onPick(e.target.files)} />
              </div>

              {/* Nhân vật */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[13px] font-medium text-mist-200">Nhân vật</p>
                  <button
                    onClick={() => setShowCharForm((v) => !v)}
                    className="flex h-7 items-center gap-1 rounded-lg border border-white/[0.08] px-2.5 text-[12px] text-mist-200 transition hover:border-brand-400/40 hover:text-brand-300"
                  >
                    <Plus size={12} /> Thêm
                  </button>
                </div>

                {characters.length === 0 && !showCharForm && (
                  <p className="text-[11.5px] leading-relaxed text-mist-400">
                    Chưa có nhân vật — thêm tên + ảnh mặt để dùng lại cho nhiều video.
                  </p>
                )}
                {characters.length > 0 && (
                  <div className="space-y-2">
                    {characters.map((c) => (
                      <div key={c.id} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-[#0d111c] p-2">
                        <div className="flex shrink-0 -space-x-1.5">
                          {c.photos.slice(0, 3).map((p) => (
                            <img key={p.url} src={p.url} alt="" className="h-8 w-8 rounded-lg border border-white/10 object-cover" />
                          ))}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-mist-100">
                            {c.name}
                            <span className="ml-1.5 font-normal text-mist-400">{c.photos.length} ảnh</span>
                          </p>
                          {c.note && <p className="truncate text-[11.5px] text-mist-400">{c.note}</p>}
                        </div>
                        <button
                          onClick={() => deleteCharacter(c)}
                          title="Xóa nhân vật"
                          className="shrink-0 rounded-md p-1 text-mist-400 transition hover:bg-white/5 hover:text-rose-400"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {characters.length > 0 && (
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12.5px] text-mist-200">
                    <input
                      type="checkbox"
                      checked={keepChar}
                      onChange={(e) => setKeepChar(e.target.checked)}
                      className="h-4 w-4 shrink-0 accent-emerald-500"
                    />
                    Giữ nguyên nhân vật
                    {keepChar && (
                      <select
                        value={keepCharId || ''}
                        onChange={(e) => setKeepCharId(e.target.value || null)}
                        aria-label="Chọn nhân vật giữ nguyên"
                        className="h-8 min-w-0 flex-1 appearance-none rounded-lg border border-white/[0.07] bg-[#0d111c] px-2 text-[12.5px] text-mist-200 outline-none focus:border-brand-400/50"
                      >
                        <option value="">Chọn nhân vật…</option>
                        {characters.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    )}
                  </label>
                )}

                {showCharForm && (
                  <div className="mt-2 space-y-2 rounded-xl border border-white/[0.07] bg-[#0d111c] p-3">
                    <input
                      value={charName}
                      onChange={(e) => setCharName(e.target.value)}
                      placeholder="Tên nhân vật (ví dụ: Mai)"
                      className="h-9 w-full rounded-lg border border-white/[0.07] bg-[#0d111c] px-3 text-[13px] text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {charPhotos.map((p) => (
                        <div key={p.url} className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-[#0d111c] py-1 pl-1 pr-2">
                          <img src={p.url} alt="" className="h-9 w-12 rounded-lg object-cover" />
                          <button
                            onClick={() => setCharPhotos((l) => l.filter((x) => x.url !== p.url))}
                            className="text-mist-400 hover:text-rose-400"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ))}
                      {charPhotos.length < 3 && (
                        <button
                          onClick={() => charFileRef.current?.click()}
                          title="Tải ảnh mặt lên (tối đa 3 ảnh)"
                          className="grid h-12 w-12 place-items-center rounded-xl border border-white/[0.07] bg-[#0d111c] text-mist-300 transition hover:border-brand-400/50 hover:text-brand-300"
                        >
                          {charUploading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={18} />}
                        </button>
                      )}
                      {charPhotos.length === 0 && (
                        <span className="text-[11.5px] text-mist-400">Tải 1–3 ảnh mặt</span>
                      )}
                    </div>
                    <input ref={charFileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onPickCharPhotos(e.target.files)} />
                    <input
                      value={charNote}
                      onChange={(e) => setCharNote(e.target.value)}
                      placeholder="Ghi chú (tùy chọn)"
                      className="h-9 w-full rounded-lg border border-white/[0.07] bg-[#0d111c] px-3 text-[13px] text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveCharacter}
                        disabled={!charName.trim() || charPhotos.length === 0}
                        className="mint-btn flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold disabled:opacity-40"
                      >
                        <Check size={14} /> Lưu nhân vật
                      </button>
                      <button
                        onClick={() => { setShowCharForm(false); setCharName(''); setCharNote(''); setCharPhotos([]); }}
                        className="flex h-9 items-center rounded-lg border border-white/[0.08] px-3.5 text-[13px] text-mist-200 transition hover:border-white/20"
                      >
                        Hủy
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Chế độ tham chiếu */}
              <div>
                <p className="mb-2 text-[13px] font-medium text-mist-200">Ảnh tham chiếu dùng cho prompt</p>
                <div className="seg">
                  {[['shared', 'Dùng chung'], ['pairing', 'Ghép cặp']].map(([k, label]) => (
                    <button key={k} onClick={() => setRefMode(k)} className={clsx(refMode === k && 'on')}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-400">
                  {refMode === 'shared'
                    ? 'Mọi video dùng chung tất cả ảnh tham chiếu đã tải lên.'
                    : 'Video thứ i dùng ảnh thứ i (nếu có); video không có ảnh tương ứng sẽ tạo không có tham chiếu.'}
                </p>
              </div>

              {/* Tỉ lệ + thời lượng */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] text-mist-300">Tỉ lệ</span>
                  <div className="seg">
                    {VIDEO_SIZES.map((sz) => (
                      <button key={sz} onClick={() => setSize(sz)} className={clsx(size === sz && 'on')} style={{ minWidth: 0, padding: '6px 12px' }}>
                        {sz}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] text-mist-300">Thời lượng</span>
                  <div className="seg">
                    {DURATIONS.map((d) => (
                      <button key={d} onClick={() => setDuration(d)} className={clsx(duration === d && 'on')} style={{ minWidth: 0, padding: '6px 12px' }}>
                        {d}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Chi phí */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-[#0d111c] px-3 py-2.5 text-[12.5px]">
                <span className="text-mist-300">
                  {lineCount} video × {perVideo} điểm = <b className="text-white">{totalCost} điểm</b>
                </span>
                <span className={clsx(lineCount > 0 && (user?.credits ?? 0) < totalCost ? 'font-medium text-rose-300' : 'text-mist-400')}>
                  Điểm của bạn: {user?.credits ?? '—'}
                </span>
              </div>
              <p className="text-[11.5px] text-mist-400">
                Chạy đồng thời tối đa {concurrency} video (theo số tài khoản khả dụng).
              </p>
            </div>

            <div className="mt-3 flex shrink-0 gap-2">
              <button
                onClick={startBatch}
                disabled={running && lineCount === 0 && pendingCount === 0}
                className="mint-btn flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold"
              >
                <Play size={16} /> Tạo &amp; chạy
              </button>
              {running && (
                <button
                  onClick={stopBatch}
                  title="Dừng tạo mới — các video đang tạo vẫn chạy tiếp"
                  className="flex h-12 items-center gap-2 rounded-xl border border-rose-500/40 px-4 text-[14px] font-medium text-rose-300 transition hover:bg-rose-500/10"
                >
                  <Square size={14} /> Dừng
                </button>
              )}
            </div>
          </section>

          {/* ===== Cột giữa: hàng đợi ===== */}
          <section className="panel flex min-h-0 flex-col p-4">
            <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-white">
                Hàng đợi video
                <span className="ml-2 rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-[11px] text-mist-300">
                  {tasks.length}
                </span>
              </h2>
              <span className="text-[11.5px] text-mist-400">
                Đang chạy {runningCount} · Xong {doneCount}{failedCount > 0 ? ` · Lỗi ${failedCount}` : ''}
              </span>
            </div>

            <div className="mb-3 flex shrink-0 gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Tìm prompt hoặc số thứ tự…"
                  className="h-9 w-full rounded-xl border border-white/[0.07] bg-[#0d111c] pl-8 pr-3 text-[13px] text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Lọc theo trạng thái"
                className="h-9 shrink-0 appearance-none rounded-xl border border-white/[0.07] bg-[#0d111c] px-2.5 text-[12.5px] text-mist-200 outline-none focus:border-brand-400/50"
              >
                <option value="all">Tất cả</option>
                <option value="running">Đang chạy</option>
                <option value="done">Hoàn tất</option>
                <option value="failed">Thất bại</option>
              </select>
              <select
                value={sortNewest ? 'new' : 'old'}
                onChange={(e) => setSortNewest(e.target.value === 'new')}
                aria-label="Sắp xếp"
                className="h-9 shrink-0 appearance-none rounded-xl border border-white/[0.07] bg-[#0d111c] px-2.5 text-[12.5px] text-mist-200 outline-none focus:border-brand-400/50"
              >
                <option value="new">Mới nhất</option>
                <option value="old">Cũ nhất</option>
              </select>
            </div>

            <div className="min-h-0 flex-1 space-y-2 lg:overflow-y-auto lg:pr-1">
              {visible.length === 0 && (
                <div className="flex flex-col items-center justify-center py-14 text-center">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.07] bg-ink-800">
                    <VideoIcon size={20} className="text-mist-400" />
                  </div>
                  <p className="mt-3 text-[13px] font-medium text-mist-200">Chưa có tác vụ</p>
                  <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-mist-400">
                    Nhập prompt ở cột trái rồi bấm &lsquo;Tạo &amp; chạy&rsquo;.
                  </p>
                </div>
              )}
              {visible.map((t) => {
                const elapsed = t.startedAt ? (t.finishedAt || now) - t.startedAt : 0;
                const pct = t.status === 'done' ? 100 : Math.max(0, t.progress || 0);
                const active = selected?.id === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={clsx(
                      'cursor-pointer rounded-xl border p-3 transition',
                      active
                        ? 'border-brand-400/50 bg-brand-500/[0.07]'
                        : 'border-white/[0.06] bg-[#0d111c] hover:border-white/15'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 font-mono text-[11px] text-mist-400">
                          #{String(t.index).padStart(3, '0')}
                        </span>
                        <span
                          className={clsx(
                            'flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
                            t.status === 'done' && 'border-brand-400/30 bg-[#06231d]/80 text-brand-300',
                            t.status === 'running' && 'border-white/10 bg-black/50 text-mist-100',
                            t.status === 'pending' && 'border-white/10 bg-black/30 text-mist-300',
                            t.status === 'failed' && 'border-rose-400/30 bg-rose-950/70 text-rose-300'
                          )}
                        >
                          {t.status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-brand-400 pulse-dot" />}
                          {t.status === 'done' && <Check size={10} />}
                          {t.status === 'failed' && <X size={10} />}
                          {STATUS_LABEL[t.status]}
                        </span>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTask(t); }}
                        title="Xóa tác vụ này"
                        className="shrink-0 rounded-md p-1 text-mist-400 transition hover:bg-white/5 hover:text-rose-400"
                      >
                        <X size={13} />
                      </button>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-mist-100">{t.prompt}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <div
                          className={clsx('h-full rounded-full transition-all', t.status === 'failed' ? 'bg-rose-400' : 'bg-brand-400')}
                          style={{ width: `${t.status === 'failed' ? 100 : Math.max(3, pct)}%` }}
                        />
                      </div>
                      <span className="shrink-0 font-mono text-[10.5px] text-mist-400">
                        {t.status === 'done' ? '100%' : t.status === 'failed' ? 'Lỗi' : `${pct}%`}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 font-mono text-[10.5px] text-mist-400">
                        <Clock size={10} /> {fmtElapsed(elapsed)}
                      </span>
                    </div>
                    {t.status === 'failed' && t.error && (
                      <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-rose-300">{t.error}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ===== Cột phải: chi tiết kết quả ===== */}
          <section className="panel flex min-h-0 flex-col p-4">
            <h2 className="mb-3 shrink-0 text-[15px] font-semibold text-white">Chi tiết kết quả</h2>
            {!selected ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-14 text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.07] bg-ink-800">
                  <VideoIcon size={20} className="text-mist-400" />
                </div>
                <p className="mt-3 text-[13px] font-medium text-mist-200">Chưa chọn tác vụ</p>
                <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-mist-400">
                  Bấm một dòng trong hàng đợi để xem chi tiết.
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-3 lg:overflow-y-auto lg:pr-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[13.5px] font-medium leading-snug text-white">{selected.prompt}</p>
                  <span
                    className={clsx(
                      'flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
                      selected.status === 'done' && 'border-brand-400/30 bg-[#06231d]/80 text-brand-300',
                      selected.status === 'running' && 'border-white/10 bg-black/50 text-mist-100',
                      selected.status === 'pending' && 'border-white/10 bg-black/30 text-mist-300',
                      selected.status === 'failed' && 'border-rose-400/30 bg-rose-950/70 text-rose-300'
                    )}
                  >
                    {selected.status === 'running' && <span className="h-1.5 w-1.5 rounded-full bg-brand-400 pulse-dot" />}
                    {STATUS_LABEL[selected.status]}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-mist-400">
                  #{String(selected.index).padStart(3, '0')} · {fmtTime(selected.createdAt)} · {fmtAgo(selected.createdAt)}
                </p>
                <div className="flex items-center gap-2">
                  <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <div
                      className={clsx('h-full rounded-full transition-all', selected.status === 'failed' ? 'bg-rose-400' : 'bg-brand-400')}
                      style={{ width: `${selected.status === 'done' ? 100 : Math.max(3, selected.progress || 0)}%` }}
                    />
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-mist-300">
                    {selected.status === 'done' ? '100%' : selected.status === 'failed' ? 'Thất bại' : `${selected.progress || 0}%`}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-mist-400">
                    <Clock size={11} /> {fmtElapsed(selectedElapsed)}
                  </span>
                </div>

                <div className="h-[380px] overflow-hidden rounded-xl bg-black/40">
                  {selected.mediaUrl ? (
                    <video src={selected.mediaUrl} muted loop playsInline autoPlay controls className="h-full w-full object-contain" />
                  ) : selected.status === 'running' ? (
                    <div className="grid h-full place-items-center">
                      <div className="flex flex-col items-center gap-2 text-mist-400">
                        <Loader2 size={22} className="animate-spin text-brand-400" />
                        <span className="text-[12px]">Muse đang tạo… {selected.progress || 0}%</span>
                      </div>
                    </div>
                  ) : selected.status === 'failed' ? (
                    <div className="grid h-full place-items-center px-4 text-center">
                      <div>
                        <AlertTriangle size={20} className="mx-auto text-rose-400" />
                        <p className="mt-2 text-[12.5px] leading-relaxed text-rose-300">{selected.error || 'Tạo thất bại'}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid h-full place-items-center text-[12.5px] text-mist-400">
                      Chờ tạo…
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-mist-400">
                  <span>Video {selected.size}</span>
                  <span>{selected.duration}s</span>
                  <span>Ảnh tham chiếu ({selected.refUrls?.length || 0})</span>
                  <span>{selected.cost} điểm</span>
                  {selectedDeleteAt && (
                    <span className="flex items-center gap-1 text-amber-300/90">
                      <Clock size={11} /> Tự xóa sau {fmtCountdown(selectedDeleteAt - now)}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <a href={selected.mediaUrl || undefined} download>
                    <button
                      disabled={!selected.mediaUrl}
                      className="flex h-10 items-center gap-1.5 rounded-xl border border-white/[0.08] px-3.5 text-[13px] text-mist-200 transition hover:border-brand-400/40 hover:text-white disabled:opacity-40"
                    >
                      <Download size={14} /> Tải xuống
                    </button>
                  </a>
                  <button
                    onClick={() => regenerate(selected)}
                    disabled={!['done', 'failed'].includes(selected.status)}
                    className="flex h-10 items-center gap-1.5 rounded-xl border border-white/[0.08] px-3.5 text-[13px] text-mist-200 transition hover:border-brand-400/40 hover:text-white disabled:opacity-40"
                  >
                    <RefreshCw size={14} /> Tạo lại
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm('Xóa tác vụ này? Video trên máy chủ (nếu có) sẽ bị xóa cùng.')) return;
                      deleteTask(selected);
                    }}
                    className="flex h-10 items-center gap-1.5 rounded-xl border border-rose-500/30 px-3.5 text-[13px] text-rose-300 transition hover:bg-rose-500/10"
                  >
                    <Trash2 size={14} /> Xóa
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      <PromptLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} onUse={usePrompt} />
    </div>
  );
}
