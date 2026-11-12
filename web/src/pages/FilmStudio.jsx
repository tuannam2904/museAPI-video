import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ChevronDown, Clapperboard, Download, Film, Image as ImageIcon, Plus,
  RefreshCw, Scissors, Trash2, Video, Wand2, AlertTriangle,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { Badge, Button, Empty, Field, Input, Select, Spinner, Textarea, useToast } from '../components/ui.jsx';

const GENRES = ['đời thường', 'hành động', 'hài hước', 'tình cảm', 'kinh dị', 'viễn tưởng', 'tài liệu'];
const STYLES = ['điện ảnh', 'chân thực', 'hoạt hình', 'tài liệu', 'hoài cổ'];
const ASPECTS = ['9:16', '16:9', '1:1'];
const TOTAL_DURATIONS = [15, 30, 60];
const SCENE_DURATIONS = [5, 8, 10];

const PROJECT_STATUS = {
  draft: { label: 'Nháp', tone: 'neutral' },
  script: { label: 'Có kịch bản', tone: 'brand' },
  storyboard: { label: 'Có cảnh quay', tone: 'brand' },
  generating: { label: 'Đang tạo', tone: 'warn' },
  ready: { label: 'Sẵn ghép', tone: 'ok' },
  done: { label: 'Hoàn thành', tone: 'ok' },
};

const SCENE_STATUS = {
  pending: { label: 'Chờ', tone: 'neutral' },
  image: { label: 'Đang tạo ảnh', tone: 'warn' },
  image_done: { label: 'Có ảnh', tone: 'brand' },
  video: { label: 'Đang tạo video', tone: 'warn' },
  done: { label: 'Xong', tone: 'ok' },
  failed: { label: 'Lỗi', tone: 'error' },
};

const POLL_MS = 5000;
const STITCH_TIMEOUT_MS = 20 * 60 * 1000; // khớp timeout ffmpeg phía server

function Seg({ options, value, onChange, suffix = '' }) {
  return (
    <div className="flex gap-1 rounded-xl border border-white/[0.07] bg-[#0d111c] p-1">
      {options.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={clsx(
            'h-8 flex-1 rounded-lg text-[13px] font-medium transition',
            value === v ? 'bg-brand-500/20 text-brand-300' : 'text-mist-400 hover:text-white'
          )}
        >
          {v}{suffix}
        </button>
      ))}
    </div>
  );
}

function StepCard({ n, title, desc, children }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-500/15 text-[13px] font-semibold text-brand-300">
          {n}
        </span>
        <div>
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
          {desc && <p className="mt-0.5 text-[12.5px] text-mist-400">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function FilmStudio() {
  const toast = useToast();

  /* ---------------- danh sách dự án ---------------- */
  const [projects, setProjects] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  /* ---------------- form tạo phim mới ---------------- */
  const [idea, setIdea] = useState('');
  const [genre, setGenre] = useState('đời thường');
  const [style, setStyle] = useState('điện ảnh');
  const [aspect, setAspect] = useState('9:16');
  const [durationTotal, setDurationTotal] = useState(30);
  const [sceneDuration, setSceneDuration] = useState(5);
  const [creating, setCreating] = useState(false);

  /* ---------------- chi tiết dự án ---------------- */
  const [project, setProject] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Nháp chỉnh sửa — khởi tạo 1 lần theo từng dự án để polling không ghi đè lúc đang sửa
  const initRef = useRef(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [ideaDraft, setIdeaDraft] = useState('');
  const [genreDraft, setGenreDraft] = useState('đời thường');
  const [styleDraft, setStyleDraft] = useState('điện ảnh');
  const [aspectDraft, setAspectDraft] = useState('9:16');
  const [durationTotalDraft, setDurationTotalDraft] = useState(30);
  const [sceneDurationDraft, setSceneDurationDraft] = useState(5);
  const [scriptDraft, setScriptDraft] = useState('');
  const [savingIdea, setSavingIdea] = useState(false);
  const [savingTitle, setSavingTitle] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [writingScript, setWritingScript] = useState(false);
  const [splitting, setSplitting] = useState(false);

  // Cảnh: prompt đang mở / nháp prompt / trạng thái bận từng cảnh / thêm cảnh
  const [promptOpen, setPromptOpen] = useState({});
  const [promptDrafts, setPromptDrafts] = useState({});
  const [sceneBusy, setSceneBusy] = useState({});
  const [newSceneDesc, setNewSceneDesc] = useState('');
  const [addingScene, setAddingScene] = useState(false);

  // Tạo toàn bộ / ghép phim
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generateMsg, setGenerateMsg] = useState('');
  const [stitching, setStitching] = useState(false);
  const [stitchingBusy, setStitchingBusy] = useState(false);

  // Nhân vật tham chiếu
  const [characters, setCharacters] = useState([]);
  const [charName, setCharName] = useState('');
  const [charDesc, setCharDesc] = useState('');
  const [charPhotos, setCharPhotos] = useState([]);
  const [charUploading, setCharUploading] = useState(false);
  const [addingChar, setAddingChar] = useState(false);
  const [portraitBusy, setPortraitBusy] = useState({});
  const charFileRef = useRef(null);

  /* ---------------- tải dữ liệu ---------------- */
  const loadProjects = useCallback(async () => {
    setLoadingList(true);
    try {
      const out = await api.films();
      setProjects(out.projects || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoadingList(false);
    }
  }, [toast]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    try {
      const out = await api.film(selectedId);
      setProject(out.project);
      setScenes(out.scenes || []);
      if (out.project?.finalUrl) setStitching(false);
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [selectedId, toast]);

  const loadCharacters = useCallback(async () => {
    if (!selectedId) return;
    try {
      const out = await api.filmCharacters(selectedId);
      setCharacters(out.characters || []);
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [selectedId, toast]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (!selectedId) return;
    initRef.current = null;
    setProject(null);
    setScenes([]);
    setCharacters([]);
    setCharName('');
    setCharDesc('');
    setCharPhotos([]);
    setGenerateMsg('');
    setStitching(false);
    setLoadingDetail(true);
    loadDetail().finally(() => setLoadingDetail(false));
    loadCharacters();
  }, [selectedId, loadDetail, loadCharacters]);

  // Khởi tạo nháp 1 lần khi dự án vừa tải xong
  useEffect(() => {
    if (!project || initRef.current === project.id) return;
    initRef.current = project.id;
    setTitleDraft(project.title || '');
    setIdeaDraft(project.idea || '');
    setGenreDraft(project.genre || 'đời thường');
    setStyleDraft(project.style || 'điện ảnh');
    setAspectDraft(project.aspect || '9:16');
    setDurationTotalDraft(project.durationTotal || 30);
    setSceneDurationDraft(project.sceneDuration || 5);
    setScriptDraft(project.script || '');
  }, [project]);

  // Polling khi đang tạo (dự án generating / cảnh đang chạy / đang ghép)
  const busyScene = scenes.some((s) => s.status === 'image' || s.status === 'video');
  const shouldPoll = !!selectedId && (project?.status === 'generating' || busyScene || stitching);
  useEffect(() => {
    if (!shouldPoll) return undefined;
    const t = setInterval(loadDetail, POLL_MS);
    return () => clearInterval(t);
  }, [shouldPoll, loadDetail]);

  // Ghép quá lâu thì dừng theo dõi (server cũng timeout sau 20 phút; lỗi ghép server không trả về client)
  useEffect(() => {
    if (!stitching) return undefined;
    const t = setTimeout(() => {
      setStitching(false);
      toast('Ghép phim quá lâu — hãy mở lại dự án để kiểm tra kết quả', 'error');
    }, STITCH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [stitching, toast]);

  /* ---------------- tạo / xóa dự án ---------------- */
  const createProject = async () => {
    if (idea.trim().length < 3) return toast('Hãy nhập ý tưởng phim (ít nhất vài từ)', 'error');
    setCreating(true);
    try {
      const out = await api.createFilm({
        idea: idea.trim(), genre, style, aspect, durationTotal, sceneDuration,
      });
      setIdea('');
      setSelectedId(out.project.id);
      toast('Đã tạo dự án phim', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (id, e) => {
    e?.stopPropagation();
    if (!window.confirm('Xóa dự án phim này và toàn bộ cảnh của nó?')) return;
    setDeleting(true);
    try {
      await api.deleteFilm(id);
      if (id === selectedId) setSelectedId(null);
      setProjects((l) => l.filter((p) => p.id !== id));
      toast('Đã xóa dự án', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  /* ---------------- lưu chỉnh sửa dự án ---------------- */
  const saveTitle = async () => {
    if (!titleDraft.trim() || titleDraft.trim() === project.title) return;
    setSavingTitle(true);
    try {
      const out = await api.patchFilm(project.id, { title: titleDraft.trim() });
      setProject(out.project);
      toast('Đã lưu tên phim', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingTitle(false);
    }
  };

  const saveIdea = async () => {
    if (ideaDraft.trim().length < 3) return toast('Ý tưởng cần ít nhất vài từ', 'error');
    setSavingIdea(true);
    try {
      const out = await api.patchFilm(project.id, {
        idea: ideaDraft.trim(), genre: genreDraft, style: styleDraft, aspect: aspectDraft,
        durationTotal: durationTotalDraft, sceneDuration: sceneDurationDraft,
      });
      setProject(out.project);
      toast('Đã lưu ý tưởng', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingIdea(false);
    }
  };

  const writeScript = async () => {
    setWritingScript(true);
    try {
      const out = await api.filmScript(project.id);
      setProject(out.project);
      setScriptDraft(out.script || '');
      toast('Đã viết xong kịch bản', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setWritingScript(false);
    }
  };

  const saveScript = async () => {
    setSavingScript(true);
    try {
      const out = await api.patchFilm(project.id, { script: scriptDraft });
      setProject(out.project);
      toast('Đã lưu kịch bản', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingScript(false);
    }
  };

  const splitStoryboard = async () => {
    setSplitting(true);
    try {
      const out = await api.filmStoryboard(project.id);
      setProject(out.project);
      setScenes(out.scenes || []);
      toast(`Đã chia thành ${out.scenes?.length || 0} cảnh`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSplitting(false);
    }
  };

  /* ---------------- nhân vật tham chiếu ---------------- */
  const onPickCharPhotos = async (files) => {
    if (!files?.length) return;
    if (charPhotos.length + files.length > 3) return toast('Tối đa 3 ảnh cho một nhân vật', 'error');
    setCharUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      const urls = (out.files || []).map((f) => ({ url: f.url }));
      setCharPhotos((r) => [...r, ...urls].slice(0, 3));
      toast('Đã tải ảnh lên', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCharUploading(false);
      if (charFileRef.current) charFileRef.current.value = '';
    }
  };

  const canSaveChar = charName.trim() && (charPhotos.length > 0 || charDesc.trim());

  const addCharacter = async () => {
    if (!canSaveChar) return toast('Nhập tên nhân vật và thêm ít nhất 1 ảnh hoặc mô tả', 'error');
    setAddingChar(true);
    try {
      const out = await api.addFilmCharacter(project.id, {
        name: charName.trim(), description: charDesc.trim(), photos: charPhotos,
      });
      if (out.character) setCharacters((l) => [...l, out.character]);
      setCharName('');
      setCharDesc('');
      setCharPhotos([]);
      toast('Đã thêm nhân vật', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAddingChar(false);
    }
  };

  const deleteCharacter = async (charId, name) => {
    if (!window.confirm(`Xóa nhân vật "${name}"?`)) return;
    try {
      await api.deleteFilmCharacter(project.id, charId);
      setCharacters((l) => l.filter((c) => c.id !== charId));
      toast('Đã xóa nhân vật', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const makePortrait = async (charId) => {
    setPortraitBusy((m) => ({ ...m, [charId]: true }));
    try {
      const out = await api.filmCharacterPortrait(project.id, charId);
      if (out.character) {
        setCharacters((l) => l.map((c) => (c.id === charId ? out.character : c)));
      } else {
        await loadCharacters();
      }
      toast('Đã tạo ảnh chân dung', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPortraitBusy((m) => {
        const next = { ...m };
        delete next[charId];
        return next;
      });
    }
  };

  /* ---------------- cảnh ---------------- */
  const addScene = async () => {
    if (newSceneDesc.trim().length < 2) return toast('Hãy nhập mô tả cho cảnh mới', 'error');
    setAddingScene(true);
    try {
      const out = await api.addFilmScene(project.id, { description: newSceneDesc.trim() });
      setScenes((l) => [...l, out.scene]);
      setNewSceneDesc('');
      toast('Đã thêm cảnh', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAddingScene(false);
    }
  };

  const setBusy = (sceneId, kind) => setSceneBusy((m) => ({ ...m, [sceneId]: kind }));
  const clearBusy = (sceneId) => setSceneBusy((m) => {
    const next = { ...m };
    delete next[sceneId];
    return next;
  });

  const sceneAction = async (sceneId, kind, fn) => {
    setBusy(sceneId, kind);
    try {
      const out = await fn();
      const updated = out.scene;
      setScenes((l) => l.map((s) => (s.id === sceneId ? updated : s)));
      return updated;
    } catch (e) {
      toast(e.message, 'error');
      await loadDetail();
      return null;
    } finally {
      clearBusy(sceneId);
    }
  };

  const createSceneImage = (sceneId) => sceneAction(sceneId, 'image', () => api.filmSceneImage(project.id, sceneId));
  const createSceneVideo = (sceneId) => sceneAction(sceneId, 'video', () => api.filmSceneVideo(project.id, sceneId));

  const retryScene = async (sceneId) => {
    // Backend chỉ reset cảnh về "Chờ" (xóa job cũ); bấm "Tạo ảnh" lại để tạo mới
    const updated = await sceneAction(sceneId, 'retry', () => api.filmSceneRetry(project.id, sceneId));
    if (updated) toast('Đã đặt lại cảnh — bấm "Tạo ảnh" để tạo lại', 'ok');
  };

  const deleteScene = async (sceneId) => {
    if (!window.confirm('Xóa cảnh này?')) return;
    setBusy(sceneId, 'delete');
    try {
      await api.deleteFilmScene(project.id, sceneId);
      setScenes((l) => l.filter((s) => s.id !== sceneId));
      toast('Đã xóa cảnh', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      clearBusy(sceneId);
    }
  };

  const openPrompts = (scene) => {
    setPromptOpen((m) => ({ ...m, [scene.id]: !m[scene.id] }));
    setPromptDrafts((m) => m[scene.id] ? m : {
      ...m,
      [scene.id]: { imagePrompt: scene.imagePrompt || '', videoPrompt: scene.videoPrompt || '' },
    });
  };

  const savePrompts = async (scene) => {
    const d = promptDrafts[scene.id] || {};
    const updated = await sceneAction(scene.id, 'save', () => api.patchFilmScene(project.id, scene.id, {
      imagePrompt: d.imagePrompt ?? scene.imagePrompt,
      videoPrompt: d.videoPrompt ?? scene.videoPrompt,
    }));
    if (updated) toast('Đã lưu prompt', 'ok');
  };

  /* ---------------- tạo toàn bộ / ghép ---------------- */
  const generateAll = async () => {
    if (!scenes.length) return toast('Chưa có cảnh nào — hãy chia cảnh trước', 'error');
    setGeneratingAll(true);
    try {
      const out = await api.filmGenerateAll(project.id);
      setGenerateMsg(out.message || '');
      toast(out.message || 'Đã bắt đầu tạo toàn bộ phim', 'ok');
      await loadDetail();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setGeneratingAll(false);
    }
  };

  const stitch = async () => {
    if (!scenes.some((s) => s.videoMedia)) return toast('Chưa có cảnh nào có video để ghép', 'error');
    setStitchingBusy(true);
    try {
      const out = await api.filmStitch(project.id);
      if (out.started) {
        setStitching(true);
        toast(out.message || 'Đang ghép phim…', 'ok');
      } else {
        toast(out.message || 'Phim đang được ghép', 'ok');
        setStitching(true);
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setStitchingBusy(false);
    }
  };

  /* ---------------- LIST VIEW ---------------- */
  if (!selectedId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-5">
        <header className="mb-4">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Clapperboard size={22} className="text-brand-300" />
            Film Studio
          </h1>
          <p className="mt-1 text-[13px] text-mist-400">
            Nhập ý tưởng thô — Muse viết kịch bản, chia cảnh, tạo ảnh tham chiếu, tạo video từng cảnh rồi ghép thành phim.
          </p>
        </header>

        {/* Tạo phim mới */}
        <section className="card mb-5 p-4 sm:p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-white">Tạo phim mới</h2>
          <Field label="Ý tưởng phim">
            <Textarea
              rows={3}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Ví dụ: một chú mèo cam giao đồ ăn trong đêm mưa ở Sài Gòn, gặp một bà cụ bán vé số…"
            />
          </Field>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Thể loại">
              <Select value={genre} onChange={(e) => setGenre(e.target.value)}>
                {GENRES.map((g) => <option key={g} value={g} className="bg-ink-800">{g}</option>)}
              </Select>
            </Field>
            <Field label="Phong cách">
              <Select value={style} onChange={(e) => setStyle(e.target.value)}>
                {STYLES.map((s) => <option key={s} value={s} className="bg-ink-800">{s}</option>)}
              </Select>
            </Field>
            <Field label="Tỷ lệ">
              <Select value={aspect} onChange={(e) => setAspect(e.target.value)}>
                {ASPECTS.map((a) => <option key={a} value={a} className="bg-ink-800">{a}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Tổng thời lượng phim">
              <Seg options={TOTAL_DURATIONS} value={durationTotal} onChange={setDurationTotal} suffix="s" />
            </Field>
            <Field label="Thời lượng mỗi cảnh">
              <Seg options={SCENE_DURATIONS} value={sceneDuration} onChange={setSceneDuration} suffix="s" />
            </Field>
          </div>
          <Button className="mt-4 w-full" size="lg" loading={creating} onClick={createProject}>
            <Plus size={17} /> Tạo phim mới
          </Button>
        </section>

        {/* Danh sách dự án */}
        <h2 className="mb-2 text-[15px] font-semibold text-white">Dự án của tôi</h2>
        {loadingList ? (
          <div className="grid place-items-center py-16 text-brand-400"><Spinner size={26} /></div>
        ) : projects.length === 0 ? (
          <Empty icon={Film} title="Chưa có phim nào" desc="Nhập ý tưởng ở trên để bắt đầu phim đầu tiên của bạn." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {projects.map((p) => {
              const st = PROJECT_STATUS[p.status] || PROJECT_STATUS.draft;
              const pct = p.sceneCount ? Math.round((p.doneCount / p.sceneCount) * 100) : 0;
              return (
                <article
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className="card card-hover cursor-pointer p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-[15px] font-semibold text-white">{p.title}</h3>
                    <button
                      onClick={(e) => deleteProject(p.id, e)}
                      title="Xóa dự án"
                      className="shrink-0 rounded-lg p-1.5 text-mist-400 hover:bg-rose-500/10 hover:text-rose-400"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <p className="mt-1 text-[12.5px] text-mist-400">
                    {p.genre} · {p.style} · {p.aspect} · {p.durationTotal}s
                  </p>
                  <p className="mt-1.5 line-clamp-2 text-[13px] text-mist-300">{p.idea}</p>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Badge tone={st.tone} dot>{st.label}</Badge>
                    <span className="text-[12px] text-mist-400">
                      {p.doneCount}/{p.sceneCount} cảnh xong · {fmtAgo(p.updatedAt)}
                    </span>
                  </div>
                  {p.sceneCount > 0 && (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full rounded-full bg-brand-400 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  /* ---------------- DETAIL VIEW ---------------- */
  const pst = PROJECT_STATUS[project?.status] || PROJECT_STATUS.draft;
  const hasVideo = scenes.some((s) => s.videoMedia);
  const isGenerating = project?.status === 'generating';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5">
      <button
        onClick={() => setSelectedId(null)}
        className="mb-3 inline-flex items-center gap-1.5 text-[13.5px] text-mist-300 hover:text-white"
      >
        <ArrowLeft size={16} /> Quay lại danh sách
      </button>

      {loadingDetail || !project ? (
        <div className="grid place-items-center py-16 text-brand-400"><Spinner size={26} /></div>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Tiêu đề + trạng thái */}
          <div className="flex items-start gap-2">
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              className="text-[16px] font-semibold"
              aria-label="Tên phim"
            />
            <Button variant="soft" size="sm" className="mt-0.5 shrink-0" loading={savingTitle} onClick={saveTitle}>
              Lưu tên
            </Button>
            <Button
              variant="danger" size="sm" className="mt-0.5 shrink-0" loading={deleting}
              onClick={(e) => deleteProject(project.id, e)}
            >
              <Trash2 size={14} /> Xóa
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={pst.tone} dot>{pst.label}</Badge>
            <span className="text-[12.5px] text-mist-400">
              {project.genre} · {project.style} · {project.aspect} · {project.durationTotal}s · mỗi cảnh {project.sceneDuration}s
            </span>
            {isGenerating && <span className="inline-flex items-center gap-1.5 text-[12.5px] text-amber-300"><Spinner size={12} /> Đang tạo các cảnh…</span>}
          </div>

          {/* Bước 1 — Ý tưởng */}
          <StepCard n={1} title="Ý tưởng" desc="Sửa ý tưởng hoặc thông số rồi lưu — kịch bản và cảnh sẽ dùng thông số mới cho lần tạo sau.">
            <Field label="Ý tưởng phim">
              <Textarea rows={3} value={ideaDraft} onChange={(e) => setIdeaDraft(e.target.value)} />
            </Field>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Field label="Thể loại">
                <Select value={genreDraft} onChange={(e) => setGenreDraft(e.target.value)}>
                  {GENRES.map((g) => <option key={g} value={g} className="bg-ink-800">{g}</option>)}
                </Select>
              </Field>
              <Field label="Phong cách">
                <Select value={styleDraft} onChange={(e) => setStyleDraft(e.target.value)}>
                  {STYLES.map((s) => <option key={s} value={s} className="bg-ink-800">{s}</option>)}
                </Select>
              </Field>
              <Field label="Tỷ lệ">
                <Select value={aspectDraft} onChange={(e) => setAspectDraft(e.target.value)}>
                  {ASPECTS.map((a) => <option key={a} value={a} className="bg-ink-800">{a}</option>)}
                </Select>
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Tổng thời lượng phim">
                <Seg options={TOTAL_DURATIONS} value={durationTotalDraft} onChange={setDurationTotalDraft} suffix="s" />
              </Field>
              <Field label="Thời lượng mỗi cảnh">
                <Seg options={SCENE_DURATIONS} value={sceneDurationDraft} onChange={setSceneDurationDraft} suffix="s" />
              </Field>
            </div>
            <Button variant="soft" className="mt-3" loading={savingIdea} onClick={saveIdea}>Lưu thay đổi</Button>
          </StepCard>

          {/* Bước 2 — Kịch bản */}
          <StepCard n={2} title="Kịch bản" desc="Muse viết kịch bản tiếng Việt từ ý tưởng của bạn (mất khoảng 30 giây). Bạn có thể sửa lại trước khi chia cảnh.">
            <Button loading={writingScript} onClick={writeScript}>
              <Wand2 size={15} /> {project.script ? 'Viết lại kịch bản' : 'Viết kịch bản'}
            </Button>
            <Textarea
              className="mt-3"
              rows={10}
              value={scriptDraft}
              onChange={(e) => setScriptDraft(e.target.value)}
              placeholder="Chưa có kịch bản — bấm “Viết kịch bản” để Muse viết từ ý tưởng."
            />
            <Button variant="soft" className="mt-3" loading={savingScript} onClick={saveScript}>Lưu kịch bản</Button>
          </StepCard>

          {/* Bước 3 — Nhân vật tham chiếu */}
          <StepCard n={3} title="Nhân vật tham chiếu" desc="Sau khi có kịch bản, định nghĩa các nhân vật chính tại đây để khuôn mặt giữ nhất quán giữa các cảnh. Khi một cảnh nhắc tên nhân vật, ảnh tham chiếu của nhân vật sẽ tự động gắn kèm khi tạo ảnh cho cảnh đó.">
            {/* Danh sách nhân vật */}
            {characters.length > 0 && (
              <div className="mb-4 flex flex-col gap-3">
                {characters.map((c) => (
                  <article key={c.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                    <div className="flex items-start gap-3">
                      {(c.photos || []).length > 0 ? (
                        <div className="flex shrink-0 gap-1.5">
                          {c.photos.slice(0, 3).map((p, i) => (
                            <img key={i} src={p.url} alt={`${c.name} ${i + 1}`} className="h-14 w-14 rounded-lg border border-white/[0.06] object-cover" />
                          ))}
                        </div>
                      ) : (
                        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-lg border border-white/[0.06] bg-black/40 text-mist-400">
                          <ImageIcon size={20} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h4 className="text-[14px] font-semibold text-white">{c.name}</h4>
                        {c.description && <p className="mt-0.5 line-clamp-3 text-[12.5px] leading-relaxed text-mist-300">{c.description}</p>}
                        {!c.description && <p className="mt-0.5 text-[12.5px] italic text-mist-400">Chưa có mô tả</p>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="soft" size="sm"
                        loading={!!portraitBusy[c.id]}
                        onClick={() => makePortrait(c.id)}
                      >
                        <ImageIcon size={14} /> Tạo ảnh chân dung
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => deleteCharacter(c.id, c.name)}>
                        <Trash2 size={14} /> Xóa
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {/* Form thêm nhân vật */}
            <Field label="Tên nhân vật">
              <Input
                value={charName}
                onChange={(e) => setCharName(e.target.value)}
                placeholder="Ví dụ: Mèo Cam, Bà cụ bán vé số…"
              />
            </Field>
            <Field label="Mô tả nhân vật" className="mt-3">
              <Textarea
                rows={3}
                value={charDesc}
                onChange={(e) => setCharDesc(e.target.value)}
                placeholder="Mô tả ngoại hình, trang phục, tuổi, đặc điểm nhận dạng…"
              />
            </Field>
            <div className="mt-3">
              <span className="mb-1.5 block text-[13px] font-medium text-mist-200">Ảnh tham chiếu (tối đa 3)</span>
              {charPhotos.length > 0 && (
                <div className="mb-2 flex gap-1.5">
                  {charPhotos.map((p, i) => (
                    <div key={i} className="relative">
                      <img src={p.url} alt={`Ảnh ${i + 1}`} className="h-14 w-14 rounded-lg border border-white/[0.06] object-cover" />
                      <button
                        type="button"
                        onClick={() => setCharPhotos((l) => l.filter((_, j) => j !== i))}
                        className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/80 text-[11px] text-white ring-1 ring-white/20"
                        aria-label="Gỡ ảnh"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <input
                ref={charFileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => onPickCharPhotos(e.target.files)}
              />
              <Button
                variant="outline" size="sm"
                loading={charUploading}
                disabled={charPhotos.length >= 3}
                onClick={() => charFileRef.current?.click()}
              >
                <Plus size={14} /> {charPhotos.length ? 'Thêm ảnh' : 'Tải ảnh lên'}
              </Button>
              <span className="ml-2 text-[12px] text-mist-400">{charPhotos.length}/3 ảnh</span>
            </div>
            <Button
              className="mt-4" loading={addingChar}
              disabled={!canSaveChar}
              onClick={addCharacter}
            >
              <Plus size={15} /> Thêm nhân vật
            </Button>
            <p className="mt-3 text-[12.5px] text-mist-400">
              Ảnh tham chiếu được gắn tự động vào cảnh có tên nhân vật khi tạo ảnh.
            </p>
          </StepCard>

          {/* Bước 4 — Cảnh quay */}
          <StepCard n={4} title="Cảnh quay" desc="Muse chia kịch bản thành từng cảnh theo trình tự câu chuyện, giữ ngoại hình nhân vật và trang phục nhất quán.">
            <div className="flex flex-wrap items-center gap-2">
              <Button loading={splitting} onClick={splitStoryboard}>
                <Scissors size={15} /> {scenes.length ? 'Chia lại cảnh' : 'Chia cảnh'}
              </Button>
              <span className="text-[12.5px] text-mist-400">{scenes.length} cảnh</span>
            </div>

            {scenes.length === 0 ? (
              <p className="mt-4 text-[13px] text-mist-400">Chưa có cảnh nào. Bấm “Chia cảnh” để Muse tự chia từ kịch bản, hoặc thêm cảnh thủ công bên dưới.</p>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {scenes.map((scene, idx) => {
                  const sst = SCENE_STATUS[scene.status] || SCENE_STATUS.pending;
                  const busy = sceneBusy[scene.id];
                  const drafts = promptDrafts[scene.id] || { imagePrompt: scene.imagePrompt || '', videoPrompt: scene.videoPrompt || '' };
                  return (
                    <article key={scene.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-semibold text-white">Cảnh {idx + 1}</span>
                          <Badge tone="neutral">{scene.duration}s</Badge>
                          <Badge tone={sst.tone} dot>{sst.label}</Badge>
                        </div>
                        <button
                          onClick={() => deleteScene(scene.id)}
                          title="Xóa cảnh"
                          className="rounded-lg p-1.5 text-mist-400 hover:bg-rose-500/10 hover:text-rose-400"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>

                      {/* Xem trước ảnh / video */}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/40">
                          {scene.imageMedia ? (
                            <img src={scene.imageMedia} alt={`Ảnh cảnh ${idx + 1}`} className="aspect-video w-full object-cover" />
                          ) : (
                            <div className="grid aspect-video place-items-center gap-1 text-mist-400">
                              <ImageIcon size={20} />
                              <span className="text-[11.5px]">Chưa có ảnh</span>
                            </div>
                          )}
                        </div>
                        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/40">
                          {scene.videoMedia ? (
                            <video src={scene.videoMedia} controls muted loop playsInline preload="metadata" className="aspect-video w-full object-cover" />
                          ) : (
                            <div className="grid aspect-video place-items-center gap-1 text-mist-400">
                              <Video size={20} />
                              <span className="text-[11.5px]">Chưa có video</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <p className="mt-3 text-[13.5px] leading-relaxed text-mist-200">{scene.description || '—'}</p>
                      {(scene.characters || scene.action || scene.camera) && (
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-mist-400">
                          {[scene.characters && `Nhân vật: ${scene.characters}`,
                            scene.action && `Hành động: ${scene.action}`,
                            scene.camera && `Camera: ${scene.camera}`,
                            scene.setting && `Bối cảnh: ${scene.setting}`,
                            scene.lighting && `Ánh sáng: ${scene.lighting}`].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {scene.status === 'failed' && scene.error && (
                        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-rose-300">
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {scene.error}
                        </p>
                      )}

                      {/* Prompt (gập/mở) */}
                      <button
                        onClick={() => openPrompts(scene)}
                        className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand-300 hover:text-brand-200"
                      >
                        Prompt <ChevronDown size={14} className={clsx('transition', promptOpen[scene.id] && 'rotate-180')} />
                      </button>
                      {promptOpen[scene.id] && (
                        <div className="mt-2 flex flex-col gap-2">
                          <Field label="Prompt tạo ảnh (tiếng Việt)">
                            <Textarea
                              rows={3}
                              value={drafts.imagePrompt}
                              onChange={(e) => setPromptDrafts((m) => ({ ...m, [scene.id]: { ...drafts, imagePrompt: e.target.value } }))}
                            />
                          </Field>
                          <Field label="Prompt tạo video (tiếng Việt)">
                            <Textarea
                              rows={3}
                              value={drafts.videoPrompt}
                              onChange={(e) => setPromptDrafts((m) => ({ ...m, [scene.id]: { ...drafts, videoPrompt: e.target.value } }))}
                            />
                          </Field>
                          <div>
                            <Button variant="soft" size="sm" loading={busy === 'save'} onClick={() => savePrompts(scene)}>
                              Lưu prompt
                            </Button>
                          </div>
                        </div>
                      )}

                      {/* Nút thao tác theo cảnh */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="soft" size="sm" loading={busy === 'image'} onClick={() => createSceneImage(scene.id)}>
                          <ImageIcon size={14} /> Tạo ảnh
                        </Button>
                        <Button
                          variant="soft" size="sm" loading={busy === 'video'}
                          disabled={!scene.imageMedia}
                          onClick={() => createSceneVideo(scene.id)}
                        >
                          <Video size={14} /> Tạo video
                        </Button>
                        {scene.status === 'failed' && (
                          <Button variant="outline" size="sm" loading={busy === 'retry'} onClick={() => retryScene(scene.id)}>
                            <RefreshCw size={14} /> Làm lại
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* Thêm cảnh */}
            <div className="mt-4 flex gap-2">
              <Input
                value={newSceneDesc}
                onChange={(e) => setNewSceneDesc(e.target.value)}
                placeholder="Mô tả cảnh mới…"
                onKeyDown={(e) => { if (e.key === 'Enter') addScene(); }}
              />
              <Button variant="outline" loading={addingScene} onClick={addScene} className="shrink-0">
                <Plus size={15} /> Thêm cảnh
              </Button>
            </div>
          </StepCard>

          {/* Bước 5 — Tạo toàn bộ */}
          <StepCard n={5} title="Tạo toàn bộ" desc="Tạo ảnh tham chiếu cho mọi cảnh trước, rồi tạo video cho mọi cảnh — chạy nền, nhiều luồng song song theo số tài khoản Muse đang bật.">
            <Button
              size="lg" className="w-full"
              loading={generatingAll || isGenerating}
              disabled={isGenerating || !scenes.length}
              onClick={generateAll}
            >
              <Clapperboard size={17} /> {isGenerating ? 'Đang tạo các cảnh…' : 'Tạo toàn bộ phim'}
            </Button>
            {generateMsg && <p className="mt-2 text-[13px] text-mist-300">{generateMsg}</p>}
            {isGenerating && (
              <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-amber-300">
                <Spinner size={12} /> Đang chạy nền — trang tự cập nhật tiến độ mỗi 5 giây, bạn có thể quay lại sau.
              </p>
            )}
          </StepCard>

          {/* Bước 6 — Ghép & xuất */}
          <StepCard n={6} title="Ghép & xuất" desc="Ghép các video cảnh theo đúng thứ tự thành một phim MP4 hoàn chỉnh.">
            <Button
              size="lg" className="w-full" variant="outline"
              loading={stitchingBusy || stitching}
              disabled={!hasVideo || stitching}
              onClick={stitch}
            >
              <Scissors size={17} /> {stitching ? 'Đang ghép phim…' : 'Ghép phim'}
            </Button>
            {!hasVideo && (
              <p className="mt-2 text-[12.5px] text-mist-400">Cần ít nhất một cảnh có video mới ghép được.</p>
            )}
            {project.finalUrl && (
              <div className="mt-4">
                <video src={project.finalUrl} controls playsInline preload="metadata" className="aspect-video w-full rounded-xl border border-white/[0.06] bg-black" />
                <a href={project.finalUrl} download className="mint-btn mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold">
                  <Download size={16} /> Tải phim về
                </a>
                <p className="mt-2 text-[12.5px] text-mist-400">Phim hoàn chỉnh · {fmtAgo(project.updatedAt)}</p>
              </div>
            )}
          </StepCard>
        </div>
      )}
    </div>
  );
}
