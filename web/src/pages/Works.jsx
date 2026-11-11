import { useCallback, useEffect, useState } from 'react';
import { Film, Image as ImageIcon, Trash2, Download, RefreshCw, Loader2, Play, Clock, HardDrive, LayoutGrid, List } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo, fmtBytes } from '../lib/api.js';
import { fmtCountdown, jobDeleteAt, useNow } from '../lib/mediaPolicy.js';
import { Badge, Button, Empty, Modal, useToast, Spinner } from '../components/ui.jsx';

const FILTERS = [
  ['', 'Tất cả', Film],
  ['video', 'Video', Film],
  ['image', 'Hình ảnh', ImageIcon],
];

const VIEW_KEY = 'works_view';

export default function Works() {
  const toast = useToast();
  const [type, setType] = useState('');
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [media, setMedia] = useState(null);
  const [retentionDays, setRetentionDays] = useState(7);
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
  });
  const now = useNow();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.jobs({ type: type || undefined, page, pageSize: 24 });
      setJobs(out.jobs);
      setTotal(out.total);
      if (out.mediaRetentionDays) setRetentionDays(Number(out.mediaRetentionDays));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [type, page, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [type]);
  useEffect(() => { api.mediaStats().then(setMedia).catch(() => {}); }, []);

  const remove = async (job) => {
    if (!confirm('Xóa tác phẩm này? Tệp sẽ bị xóa cùng.')) return;
    try {
      await api.deleteJob(job.id);
      setJobs((l) => l.filter((j) => j.id !== job.id));
      setTotal((t) => t - 1);
      setPreview(null);
      toast('Đã xóa', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const pages = Math.max(1, Math.ceil(total / 24));

  return (
    <div className="p-5 lg:p-7">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5 rounded-xl bg-ink-850 p-1">
          {FILTERS.map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setType(k)}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition',
                type === k ? 'bg-ink-700 text-white shadow-sm' : 'text-mist-400 hover:text-mist-200'
              )}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-ink-850 p-1">
            <button
              onClick={() => { setView('grid'); try { localStorage.setItem(VIEW_KEY, 'grid'); } catch {} }}
              title="Dạng lưới"
              className={clsx('grid h-7 w-7 place-items-center rounded-lg transition', view === 'grid' ? 'bg-ink-700 text-white' : 'text-mist-400 hover:text-mist-200')}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => { setView('list'); try { localStorage.setItem(VIEW_KEY, 'list'); } catch {} }}
              title="Dạng danh sách"
              className={clsx('grid h-7 w-7 place-items-center rounded-lg transition', view === 'list' ? 'bg-ink-700 text-white' : 'text-mist-400 hover:text-mist-200')}
            >
              <List size={14} />
            </button>
          </div>
          <span className="text-[12.5px] text-mist-400">Tổng {total} mục</span>
          <Button variant="outline" size="sm" onClick={load} loading={loading}>
            <RefreshCw size={13} /> Làm mới
          </Button>
        </div>
      </div>

      <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-[12.5px] leading-relaxed text-amber-200/90">
        <Clock size={15} className="mt-0.5 shrink-0" />
        <p>
          Video và ảnh sẽ <b>tự động xóa sau {retentionDays} ngày</b> — hãy tải về nếu muốn giữ lại.
          {media && (
            <span className="ml-2 inline-flex items-center gap-1 text-mist-300">
              <HardDrive size={12} /> Bạn đã dùng <b className="text-mist-100">{media.totalMB} MB / {media.maxMB} MB</b>
            </span>
          )}
        </p>
      </div>

      {loading && !jobs.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shimmer aspect-video rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <Empty
          icon={Film}
          title="Chưa có tác phẩm nào"
          desc="Đến bàn sáng tạo để tạo video đầu tiên"
          action={<Button onClick={() => (window.location.href = '/studio')}>Đi tạo ngay</Button>}
        />
      ) : view === 'list' ? (
        <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-850">
          <div className="hidden grid-cols-[112px_minmax(0,1fr)_76px_84px_64px_88px_128px_76px] items-center gap-3 border-b border-ink-700 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-ink-500 lg:grid">
            <span>Xem trước</span>
            <span>Nội dung</span>
            <span>Loại</span>
            <span>Thời lượng</span>
            <span className="text-right">Điểm</span>
            <span>Tạo lúc</span>
            <span>Tự xóa sau</span>
            <span className="text-right">Thao tác</span>
          </div>
          <div className="divide-y divide-ink-800">
            {jobs.map((j) => (
              <WorkRow key={j.id} job={j} now={now} retentionDays={retentionDays} onOpen={() => setPreview(j)} onDelete={() => remove(j)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {jobs.map((j) => (
            <WorkCard key={j.id} job={j} now={now} retentionDays={retentionDays} onOpen={() => setPreview(j)} onDelete={() => remove(j)} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Trang trước
          </Button>
          <span className="px-2 text-[12.5px] text-mist-400">{page} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Trang sau
          </Button>
        </div>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title="Chi tiết tác phẩm" width="max-w-3xl">
        {preview && (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-xl bg-black/50">
              {preview.mediaUrl ? (
                /\.(mp4|webm|mov)/i.test(preview.mediaUrl) ? (
                  <video src={preview.mediaUrl} controls autoPlay loop className="max-h-[60vh] w-full" />
                ) : (
                  <img src={preview.mediaUrl} alt="" className="max-h-[60vh] w-full object-contain" />
                )
              ) : preview.result?.url ? (
                <video src={preview.result.url} controls className="max-h-[60vh] w-full" />
              ) : (
                <div className="grid h-40 place-items-center text-[13px] text-mist-400">
                  {preview.status === 'failed' ? preview.error : 'Chưa có tệp media'}
                </div>
              )}
            </div>
            <p className="text-[13px] leading-relaxed text-mist-200">{preview.prompt}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-500">
              <span>{preview.params?.duration || 5}s · {preview.params?.size}</span>
              <span>{preview.cost} điểm</span>
              <span>{fmtAgo(preview.createdAt)}</span>
              {preview.result?.bytes && <span>{fmtBytes(preview.result.bytes)}</span>}
              {jobDeleteAt(preview, retentionDays) && (
                <span className="flex items-center gap-1 text-amber-300/90">
                  <Clock size={11} /> Tự xóa sau {fmtCountdown(jobDeleteAt(preview, retentionDays) - now)}
                </span>
              )}
              {preview.status === 'completed' && !preview.mediaUrl && (
                <span className="text-ink-500">File đã bị xóa theo chính sách lưu trữ</span>
              )}
            </div>
            <div className="flex gap-2 pt-1">
              {(preview.mediaUrl || preview.result?.url) && (
                <a href={preview.mediaUrl || preview.result.url} download>
                  <Button variant="soft" size="sm"><Download size={13} /> Tải xuống</Button>
                </a>
              )}
              <Button variant="danger" size="sm" onClick={() => remove(preview)}>
                <Trash2 size={13} /> Xóa
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function WorkCard({ job, now, retentionDays, onOpen, onDelete }) {
  const [hover, setHover] = useState(false);
  const running = ['queued', 'processing'].includes(job.status);
  const failed = job.status === 'failed';
  const deleteAt = jobDeleteAt(job, retentionDays);
  const gone = job.status === 'completed' && !job.mediaUrl;

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative overflow-hidden rounded-xl border border-ink-700 bg-ink-850 transition hover:border-ink-500 hover:shadow-xl hover:shadow-black/40"
    >
      <button onClick={onOpen} className="block w-full">
        <div className="relative aspect-video overflow-hidden bg-ink-900">
          {job.mediaUrl ? (
            /\.(mp4|webm|mov)/i.test(job.mediaUrl) ? (
              <video
                src={job.mediaUrl}
                muted
                loop
                playsInline
                autoPlay={hover}
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
            ) : (
              <img
                src={job.mediaUrl}
                alt=""
                className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
              />
            )
          ) : (
            <div className="grid h-full place-items-center">
              {running ? (
                <div className="flex flex-col items-center gap-2 text-[12px] text-brand-400">
                  <Loader2 size={18} className="animate-spin" />
                  {job.progress || 0}%
                </div>
              ) : failed ? (
                <span className="px-3 text-center text-[12px] text-rose-400">{job.error || 'Tạo thất bại'}</span>
              ) : gone ? (
                <span className="px-3 text-center text-[12px] text-ink-500">File đã bị xóa theo chính sách lưu trữ</span>
              ) : (
                <span className="text-[12px] text-ink-500">Không có bản xem trước</span>
              )}
            </div>
          )}

          <div className="absolute left-2 top-2 flex gap-1.5">
            <Badge tone={job.type === 'video' ? 'brand' : 'neutral'}>
              {job.type === 'video' ? 'Video' : 'Hình ảnh'}
            </Badge>
            {failed && <Badge tone="error">Thất bại</Badge>}
          </div>

          {job.mediaUrl && (
            <span className="absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
              <Play size={12} />
            </span>
          )}
        </div>
      </button>

      <div className="flex items-start justify-between gap-2 px-3 py-2.5">
        <p className="line-clamp-2 text-[12.5px] leading-snug text-mist-300">{job.prompt}</p>
        <button
          onClick={onDelete}
          className="shrink-0 rounded p-1 text-ink-500 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="flex items-center justify-between px-3 pb-2.5 text-[10.5px] text-ink-500">
        <span>{job.params?.duration}s · {job.params?.size}</span>
        {deleteAt ? (
          <span className="flex items-center gap-1 text-amber-300/80">
            <Clock size={10} /> Xóa sau {fmtCountdown(deleteAt - now)}
          </span>
        ) : (
          <span>{fmtAgo(job.createdAt)}</span>
        )}
      </div>
    </div>
  );
}

/* Một hàng ngang trong chế độ danh sách: thumbnail + các cột số liệu. */
function WorkRow({ job, now, retentionDays, onOpen, onDelete }) {
  const running = ['queued', 'processing'].includes(job.status);
  const failed = job.status === 'failed';
  const deleteAt = jobDeleteAt(job, retentionDays);
  const gone = job.status === 'completed' && !job.mediaUrl;
  const isVideo = /\.(mp4|webm|mov)/i.test(job.mediaUrl || '');

  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition hover:bg-ink-800/40 lg:grid-cols-[112px_minmax(0,1fr)_76px_84px_64px_88px_128px_76px] lg:gap-3 lg:px-4">
      <button onClick={onOpen} className="relative block aspect-video w-[88px] overflow-hidden rounded-lg bg-ink-900 lg:w-[112px]">
        {job.mediaUrl ? (
          isVideo ? (
            <video src={job.mediaUrl} muted playsInline className="h-full w-full object-cover" />
          ) : (
            <img src={job.mediaUrl} alt="" className="h-full w-full object-cover" />
          )
        ) : (
          <span className="grid h-full place-items-center">
            {running ? (
              <Loader2 size={16} className="animate-spin text-brand-400" />
            ) : failed ? (
              <span className="px-1 text-center text-[11px] text-rose-400">Thất bại</span>
            ) : gone ? (
              <span className="px-1 text-center text-[11px] text-ink-500">Đã xóa</span>
            ) : (
              <ImageIcon size={16} className="text-ink-500" />
            )}
          </span>
        )}
      </button>

      <button onClick={onOpen} className="min-w-0 text-left">
        <p className="line-clamp-2 text-[12.5px] leading-snug text-mist-200">{job.prompt}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-500 lg:hidden">
          <span>{job.type === 'video' ? 'Video' : 'Hình ảnh'}</span>
          <span>{job.params?.duration ? `${job.params.duration}s · ` : ''}{job.params?.size}</span>
          <span>{job.cost} điểm</span>
          {deleteAt && <span className="text-amber-300/90">Xóa sau {fmtCountdown(deleteAt - now)}</span>}
        </p>
      </button>

      <span className="hidden lg:block">
        <Badge tone={job.type === 'video' ? 'brand' : 'neutral'}>{job.type === 'video' ? 'Video' : 'Hình ảnh'}</Badge>
        {failed && <Badge tone="error">Thất bại</Badge>}
      </span>
      <span className="hidden text-[12px] text-mist-300 lg:block">
        {job.params?.duration ? `${job.params.duration}s · ` : ''}{job.params?.size || '—'}
      </span>
      <span className="hidden text-right text-[12px] font-medium tabular-nums text-amber-300 lg:block">{job.cost}</span>
      <span className="hidden text-[12px] text-mist-400 lg:block">{fmtAgo(job.createdAt)}</span>
      <span className="hidden text-[12px] lg:block">
        {deleteAt ? (
          <span className="flex items-center gap-1 text-amber-300/90">
            <Clock size={11} /> {fmtCountdown(deleteAt - now)}
          </span>
        ) : gone ? (
          <span className="text-ink-500">Đã xóa</span>
        ) : running ? (
          <span className="text-brand-400">{job.progress || 0}%</span>
        ) : (
          <span className="text-ink-500">—</span>
        )}
      </span>

      <span className="flex items-center justify-end gap-1">
        {job.mediaUrl && (
          <a
            href={job.mediaUrl}
            download
            onClick={(e) => e.stopPropagation()}
            title="Tải xuống"
            className="rounded-md border border-ink-600 p-1.5 text-mist-300 hover:border-brand-500/60 hover:text-brand-300"
          >
            <Download size={13} />
          </a>
        )}
        <button
          onClick={onDelete}
          title="Xóa"
          className="rounded-md border border-ink-600 p-1.5 text-mist-300 hover:border-rose-500/60 hover:text-rose-300"
        >
          <Trash2 size={13} />
        </button>
      </span>
    </div>
  );
}
