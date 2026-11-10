import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Download, RotateCcw, Link2, Loader2, Play, Image as ImageIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { useToast } from '../components/ui.jsx';

const TABS = [
  ['all', 'Tất cả'],
  ['done', 'Đã xong'],
  ['running', 'Đang tạo'],
  ['failed', 'Thất bại'],
];

export default function History() {
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('all');
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.jobs({ pageSize: 60 });
      setJobs(out.jobs);
      setTotal(out.total);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filter = (j) => {
    if (tab === 'done') return j.status === 'completed';
    if (tab === 'running') return ['queued', 'processing'].includes(j.status);
    if (tab === 'failed') return j.status === 'failed';
    return true;
  };
  const shown = jobs.filter(filter);

  return (
    <div className="mx-auto max-w-[1180px] px-8 pb-20 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Archive</p>
          <h1 className="mt-2 flex items-center gap-2.5 text-[30px] font-semibold tracking-tight text-white">
            <Clock size={24} className="text-brand-400" strokeWidth={1.6} />
            Lịch sử sáng tạo
          </h1>
          <p className="mt-1.5 text-[12.5px] text-mist-400">
            Tổng <span className="font-mono text-mist-200">{total}</span> bản ghi sáng tạo, hỗ trợ tải xuống, sao chép liên kết, tạo lại
          </p>
        </div>

        <div className="flex gap-1 rounded-xl border border-[#1a2030] bg-[#0d1119] p-1">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={clsx(
                'rounded-lg px-3.5 py-1.5 text-[12.5px] transition',
                tab === k ? 'bg-[#182030] text-white' : 'text-mist-400 hover:text-mist-200'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 min-h-[420px] rounded-2xl border border-[#1a2030] bg-[#0b0f17]/60">
        {loading ? (
          <div className="grid place-items-center py-32 text-brand-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 grid h-20 w-20 place-items-center rounded-2xl bg-[#141a26]">
              <Clock size={30} className="text-mist-400/60" strokeWidth={1.4} />
            </div>
            <p className="text-[14px] text-mist-300">Chưa có lịch sử</p>
            <p className="mt-1 text-[12px] text-mist-400">Hãy đến trung tâm sáng tạo để gửi một tác vụ</p>
            <button
              onClick={() => nav('/create')}
              className="mt-5 rounded-full brand-gradient px-6 py-2.5 text-[13px] font-medium text-white shadow-lg shadow-brand-600/25 transition hover:brightness-110"
            >
              Đến trung tâm sáng tạo
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[#141922]">
            {shown.map((j) => {
              const isVideo = /\.(mp4|webm|mov)/i.test(j.mediaUrl || '');
              return (
                <div key={j.id} className="flex items-center gap-3 px-4 py-3 transition hover:bg-[#0e131c]">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-ink-900">
                    {j.mediaUrl ? (
                      isVideo ? (
                        <video src={j.mediaUrl} muted className="h-full w-full object-cover" />
                      ) : (
                        <img src={j.mediaUrl} alt="" className="h-full w-full object-cover" />
                      )
                    ) : (
                      <div className="grid h-full place-items-center text-mist-400">
                        {['queued', 'processing'].includes(j.status) ? (
                          <Loader2 size={14} className="animate-spin text-brand-400" />
                        ) : isVideo ? <Play size={14} /> : <ImageIcon size={14} />}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-mist-200">{j.prompt}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-mist-400">
                      {j.type === 'video' ? 'VIDEO' : 'IMAGE'} · {j.params?.duration || '—'}s · {j.params?.size} ·{' '}
                      {fmtAgo(j.createdAt)}
                    </p>
                  </div>

                  <span
                    className={clsx(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10.5px]',
                      j.status === 'completed' && 'bg-brand-500/15 text-brand-300',
                      j.status === 'failed' && 'bg-rose-500/15 text-rose-300',
                      ['queued', 'processing'].includes(j.status) && 'bg-gold-400/15 text-gold-400'
                    )}
                  >
                    {j.status === 'completed' ? 'Đã xong' : j.status === 'failed' ? 'Thất bại' : 'Đang tạo'}
                  </span>

                  <div className="flex shrink-0 gap-1">
                    {j.mediaUrl && (
                      <>
                        <a
                          href={j.mediaUrl}
                          download
                          className="grid h-7 w-7 place-items-center rounded-md text-mist-400 transition hover:bg-ink-700 hover:text-white"
                          title="Tải xuống"
                        >
                          <Download size={13} />
                        </a>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(location.origin + j.mediaUrl);
                            toast('Đã sao chép liên kết', 'ok');
                          }}
                          className="grid h-7 w-7 place-items-center rounded-md text-mist-400 transition hover:bg-ink-700 hover:text-white"
                          title="Sao chép liên kết"
                        >
                          <Link2 size={13} />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => nav('/create')}
                      className="grid h-7 w-7 place-items-center rounded-md text-mist-400 transition hover:bg-ink-700 hover:text-brand-300"
                      title="Tạo lại"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
