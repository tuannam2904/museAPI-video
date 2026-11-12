import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, ImagePlus, X, Download, Play, RefreshCw, AlertTriangle, Clock,
  Video, Wand2, Loader2, CheckCircle2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { Badge, Button, Field, Textarea, useToast, Spinner } from '../components/ui.jsx';

const IDEAS = [
  'Đường phố Tokyo trong đêm mưa, ánh neon vỡ vụn trên vũng nước, máy quay từ từ tiến tới cô gái che ô',
  'Đỉnh núi tuyết, mây cuộn trào, một con đại bàng trắng lướt qua ống kính, ánh sáng xuyên qua mây',
  'Sân vườn cổ phong, người phụ nữ áo đỏ ngoái lại, hoa rơi theo gió, độ sâu trường ảnh nông',
  'Buổi sáng ở thành phố tương lai, phương tiện bay lượn giữa các tòa tháp cao, ánh nắng vàng chiếu xiên',
  'Hơi nóng bốc lên từ tách cà phê, ngoài cửa sổ tuyết rơi, cận cảnh quay chậm',
];

export default function Studio() {
  const { user, refresh } = useAuth();
  const toast = useToast();

  const [meta, setMeta] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(5);
  const [size, setSize] = useState('16:9');
  const [refs, setRefs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(null);
  const [recent, setRecent] = useState([]);
  const [accCount, setAccCount] = useState(null);
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  const cost = useMemo(() => {
    if (!meta) return 0;
    return meta.price.videoBase + meta.price.videoPerSecond * duration;
  }, [meta, duration]);

  const loadRecent = useCallback(async () => {
    try {
      const out = await api.jobs({ pageSize: 6 });
      setRecent(out.jobs.filter((j) => j.type === 'video'));
    } catch { /* 忽略 */ }
  }, []);

  useEffect(() => {
    api.meta().then((m) => {
      setMeta(m);
      if (!m.sizes.includes(size)) setSize(m.sizes[0]);
      if (!m.durations.includes(duration)) setDuration(m.durations[0]);
    }).catch(() => toast('Không đọc được cấu hình nền tảng', 'error'));
    loadRecent();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 账号池空时提醒用户先去导入
  useEffect(() => {
    api.accounts()
      .then((o) => setAccCount(o.accounts.filter((a) => a.status !== 'missing').length))
      .catch(() => setAccCount(null));
  }, []);

  // 轮询当前任务
  useEffect(() => {
    if (!active || ['completed', 'failed'].includes(active.status)) return;
    pollRef.current = setTimeout(async () => {
      try {
        const { job } = await api.job(active.id);
        setActive(job);
        if (job.status === 'completed') {
          toast('Tạo xong', 'ok');
          refresh();
          loadRecent();
        } else if (job.status === 'failed') {
          toast(job.error || 'Tạo thất bại, đã hoàn điểm', 'error');
          refresh();
          loadRecent();
        }
      } catch { /* 继续轮询 */ }
    }, 2500);
    return () => clearTimeout(pollRef.current);
  }, [active, refresh, loadRecent, toast]);

  const onPickFiles = async (files) => {
    if (!files?.length) return;
    if (refs.length + files.length > 3) {
      toast('Tối đa 3 ảnh tham chiếu', 'error');
      return;
    }
    setUploading(true);
    try {
      const out = await api.upload(Array.from(files));
      setRefs((r) => [...r, ...out.files].slice(0, 3));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (prompt.trim().length < 2) return toast('Hãy viết mô tả hình ảnh trước', 'error');
    if ((user?.credits ?? 0) < cost) return toast(`Không đủ điểm, lần này cần ${cost}`, 'error');
    setBusy(true);
    try {
      const { job } = await api.createVideo({
        prompt: prompt.trim(),
        duration,
        size,
        images: refs.map((r) => r.url),
      });
      setActive(job);
      refresh();
      loadRecent();
    } catch (e) {
      toast(e.message, 'error');
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const running = active && ['queued', 'processing'].includes(active.status);

  return (
    <div className="grid gap-5 p-5 lg:p-7 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
      {/* ---------------- 创作表单 ---------------- */}
      <section className="card h-fit p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-white">
            <Video size={16} className="text-brand-400" /> Tạo video
          </h2>
          <Badge tone="brand">muse-video</Badge>
        </div>

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-medium text-mist-300">Mô tả hình ảnh</span>
              <button
                onClick={() => setPrompt(IDEAS[Math.floor(Math.random() * IDEAS.length)])}
                className="flex items-center gap-1 text-[11.5px] text-brand-400 hover:text-brand-300"
              >
                <Wand2 size={11} /> Gợi ý
              </button>
            </div>
            <Textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Mô tả chủ thể, hành động, bối cảnh, ngôn ngữ ống kính. Ví dụ: con hẻm sau mưa, cô gái che ô ngoái lại, quay chậm, độ sâu trường ảnh nông, tông ấm"
              maxLength={1200}
            />
            <div className="mt-1 flex justify-between text-[11px] text-ink-500">
              <span>Hỗ trợ viết lẫn tiếng Trung và tiếng Anh, ngôn ngữ ống kính càng cụ thể thì video càng ổn định</span>
              <span>{prompt.length}/1200</span>
            </div>
          </div>

          {/* 参考图 */}
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-mist-300">
              Ảnh tham chiếu <span className="text-ink-500">(không bắt buộc, ảnh đầu làm khung hình đầu tiên)</span>
            </span>
            <div className="grid grid-cols-4 gap-2">
              {refs.map((r) => (
                <div key={r.url} className="group relative aspect-square overflow-hidden rounded-lg border border-ink-700">
                  <img src={r.url} alt="" className="h-full w-full object-cover" />
                  <button
                    onClick={() => setRefs((list) => list.filter((i) => i.url !== r.url))}
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition group-hover:opacity-100"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {refs.length < 3 && (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ink-600 text-[10.5px] text-mist-400 transition hover:border-brand-500/60 hover:text-brand-400"
                >
                  {uploading ? <Spinner size={14} /> : <ImagePlus size={16} />}
                  {uploading ? 'Đang tải lên' : 'Thêm'}
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => onPickFiles(e.target.files)}
            />
          </div>

          {/* 时长 */}
          <Field label="Thời lượng">
            <div className="flex gap-2">
              {(meta?.durations || [5]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={clsx(
                    'flex-1 rounded-xl border py-2 text-[13px] font-medium transition',
                    duration === d
                      ? 'border-brand-500/60 bg-brand-500/12 text-brand-300'
                      : 'border-ink-700 text-mist-400 hover:border-ink-600 hover:text-mist-200'
                  )}
                >
                  {d}s
                </button>
              ))}
            </div>
          </Field>

          {/* 画幅 */}
          <Field label="Khung hình">
            <div className="flex gap-2">
              {(meta?.sizes || ['16:9']).map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={clsx(
                    'flex-1 rounded-xl border py-2 text-[12.5px] font-medium transition',
                    size === s
                      ? 'border-brand-500/60 bg-brand-500/12 text-brand-300'
                      : 'border-ink-700 text-mist-400 hover:border-ink-600 hover:text-mist-200'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </Field>

          <div className="flex items-center justify-between rounded-xl bg-ink-900 px-3.5 py-3">
            <span className="text-[12.5px] text-mist-400">Dự kiến tiêu hao</span>
            <span className="text-[15px] font-semibold tabular-nums text-amber-300">{cost} điểm</span>
          </div>

          <Button size="lg" className="w-full" loading={busy || running} onClick={submit} disabled={running}>
            {running ? 'Đang tạo…' : <><Sparkles size={16} /> Bắt đầu tạo</>}
          </Button>
          <p className="text-center text-[11px] text-ink-500">
            Mỗi video 5–10 giây, thường 1–3 phút là xong, thất bại sẽ tự động hoàn điểm
          </p>
        </div>
      </section>

      {/* ---------------- 结果区 ---------------- */}
      <section className="min-w-0 space-y-4">
        {active ? <ResultPanel job={active} /> : <GuidePanel accountCount={accCount} />}

        {recent.length > 0 && (
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-mist-200">
                <Clock size={14} className="text-mist-400" /> Tạo gần đây
              </h3>
              <a href="/works" className="text-[12px] text-brand-400 hover:text-brand-300">Tất cả tác phẩm →</a>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {recent.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setActive(j)}
                  className="group relative aspect-[9/16] overflow-hidden rounded-lg border border-ink-700 bg-ink-900"
                >
                  {j.mediaUrl ? (
                    <video src={j.mediaUrl} muted className="h-full w-full object-cover opacity-80 group-hover:opacity-100" />
                  ) : (
                    <div className="grid h-full place-items-center text-[10px] text-ink-500">
                      {j.status === 'failed' ? 'Thất bại' : j.status === 'completed' ? 'Không có xem trước' : 'Đang tạo'}
                    </div>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-left text-[10px] text-white/85">
                    {j.prompt.slice(0, 16)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function GuidePanel({ accountCount }) {
  const steps = [
    { n: '01', t: 'Nhập tài khoản Muse', d: 'Dán Cookie một lần, tài khoản vào pool sẽ tự động được điều phối' },
    { n: '02', t: 'Viết rõ ngôn ngữ ống kính', d: 'Chủ thể + hành động + bối cảnh + chuyển động máy, càng cụ thể càng ổn' },
    { n: '03', t: 'Tạo xong và tải xuống', d: '1–3 phút là xong, thư viện tác phẩm xem lại bất cứ lúc nào' },
  ];
  return (
    <div className="card overflow-hidden">
      <div className="relative overflow-hidden px-6 py-8">
        <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-brand-600/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-44 w-44 rounded-full bg-violet-600/15 blur-3xl" />
        <div className="relative">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-400">Workspace</p>
          <h3 className="mt-2 text-[22px] font-semibold tracking-tight text-white">
            Ba bước để tạo ra một<span className="brand-text"> video dùng được</span>
          </h3>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-mist-400">
            Nền tảng đã đóng gói khả năng của Muse bản web thành giao diện chuẩn, pool tài khoản luân chuyển ở phía sau, bạn chỉ cần mô tả hình ảnh.
          </p>
        </div>

        <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="rounded-xl border border-ink-700 bg-ink-900/70 p-3.5">
              <span className="text-[11px] font-semibold tabular-nums text-brand-400">{s.n}</span>
              <p className="mt-1 text-[13px] font-medium text-mist-200">{s.t}</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-mist-400">{s.d}</p>
            </div>
          ))}
        </div>

        {accountCount === 0 && (
          <div className="relative mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
              <div>
                <p className="text-[13px] font-medium text-amber-200">Chưa có tài khoản khả dụng</p>
                <p className="mt-0.5 text-[11.5px] text-amber-200/70">
                  Trước khi tạo phải nhập Cookie của một tài khoản muse.ai, nếu không máy chủ sẽ từ chối thẳng
                </p>
              </div>
            </div>
            <a
              href="/accounts"
              className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 text-[12.5px] font-semibold text-amber-950 transition hover:bg-amber-300"
            >
              Đi nhập →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function ResultPanel({ job, compact }) {  if (!job) {
    return (
      <div className={clsx('card grid place-items-center', compact ? 'h-64' : 'h-[420px]')}>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-800 text-mist-400">
            <Play size={22} />
          </div>
          <div>
            <p className="text-[14px] font-medium text-mist-200">Chưa có kết quả tạo</p>
            <p className="mt-1 text-[12px] text-mist-400">Viết mô tả xong, bấm "Bắt đầu tạo"</p>
          </div>
        </div>
      </div>
    );
  }

  const running = ['queued', 'processing'].includes(job.status);
  const done = job.status === 'completed';
  const failed = job.status === 'failed';
  const url = job.mediaUrl || job.result?.url;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {running && <Loader2 size={14} className="animate-spin text-brand-400" />}
          {done && <CheckCircle2 size={14} className="text-emerald-400" />}
          {failed && <AlertTriangle size={14} className="text-rose-400" />}
          <span className="truncate text-[12.5px] text-mist-300">{job.prompt}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={done ? 'ok' : failed ? 'error' : 'brand'}>
            {done ? 'Hoàn thành' : failed ? 'Thất bại' : job.status === 'processing' ? 'Đang tạo' : 'Đang chờ'}
          </Badge>
          {url && (
            <a
              href={url}
              download
              className="rounded-lg border border-ink-600 p-1.5 text-mist-300 transition hover:border-ink-500 hover:text-white"
              title="Tải xuống"
            >
              <Download size={13} />
            </a>
          )}
        </div>
      </div>

      <div className="relative bg-black/40">
        {done && url ? (
          /\.(mp4|webm|mov)/i.test(url) ? (
            <video src={url} controls autoPlay loop playsInline className="max-h-[62vh] w-full object-contain" />
          ) : (
            <img src={url} alt="" className="max-h-[62vh] w-full object-contain" />
          )
        ) : (
          <div className={clsx('relative grid place-items-center overflow-hidden', compact ? 'h-56' : 'h-[380px]')}>
            {running ? (
              <div className="w-full max-w-xs px-6">
                <div className="mb-3 flex items-center justify-between text-[12px] text-mist-400">
                  <span>Đang dựng</span>
                  <span className="tabular-nums">{job.progress || 0}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full brand-gradient transition-all duration-700"
                    style={{ width: `${Math.max(6, job.progress || 0)}%` }}
                  />
                </div>
                <p className="mt-3 text-center text-[11px] text-ink-500">
                  Trình duyệt máy chủ đang chạy, đừng đóng trang
                </p>
              </div>
            ) : failed ? (
              <div className="max-w-sm px-6 text-center">
                <AlertTriangle size={22} className="mx-auto mb-2 text-rose-400" />
                <p className="text-[13px] text-rose-300">{job.error || 'Tạo thất bại'}</p>
                {job.refunded && <p className="mt-1 text-[11.5px] text-ink-500">Điểm đã tự động hoàn lại</p>}
              </div>
            ) : (
              <RefreshCw size={20} className="text-ink-500" />
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[11.5px] text-ink-500">
        <span>{job.params?.duration || 5}s · {job.params?.size || '16:9'}</span>
        <span>Tiêu hao {job.cost} điểm</span>
        {job.createdAt && <span>{fmtAgo(job.createdAt)}</span>}
        {job.accountId && <span className="truncate">Tài khoản {job.accountId.slice(0, 10)}</span>}
      </div>
    </div>
  );
}
