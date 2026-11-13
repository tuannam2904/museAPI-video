import { useCallback, useEffect, useState } from 'react';
import {
  X, Play, Pause, ArrowUp, ArrowDown, Trash2, Loader2, Clock, Plus, ListOrdered, Zap,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { useToast } from './ui.jsx';
import { useConfirmDialog } from './ConfirmDialog.jsx';

const STATUS = {
  pending: { label: 'Chờ thực hiện', cls: 'bg-gold-400/15 text-gold-400' },
  running: { label: 'Đang thực hiện', cls: 'bg-brand-500/15 text-brand-300' },
  done: { label: 'Đã thực hiện', cls: 'bg-emerald-500/15 text-emerald-300' },
  paused: { label: 'Đã tạm dừng', cls: 'bg-[#2a3040] text-mist-300' },
  failed: { label: 'Thất bại', cls: 'bg-rose-500/15 text-rose-300' },
};

export default function QueueDrawer({ open, onClose, prompt, duration, size }) {
  const toast = useToast();
  const confirmDialog = useConfirmDialog();
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);
  const [intervalMin, setIntervalMin] = useState(5);
  const [maxRuns, setMaxRuns] = useState(3);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.queue();
      setItems(out.items);
      setStats(out.stats);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [open, load]);

  const add = async () => {
    if (!prompt?.trim()) return toast('Hãy viết câu lệnh vào ô nhập bên dưới trước', 'error');
    setBusy(true);
    try {
      await api.addQueue({ prompt: prompt.trim(), duration, size, intervalMin, maxRuns });
      toast('Đã thêm vào hàng đợi', 'ok');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn, msg) => {
    try {
      await fn();
      if (msg) toast(msg, 'ok');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-[#1e2432] bg-ink-900/95 backdrop-blur-xl fade-in">
        <div className="flex items-center justify-between border-b border-[#1e2432] px-4 py-3.5">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold text-white">
            <ListOrdered size={15} className="text-brand-400" /> Tác vụ tự động
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-mist-400 hover:bg-ink-700 hover:text-white">
            <X size={15} />
          </button>
        </div>

        {/* 添加 */}
        <div className="border-b border-[#1e2432] p-4">
          <div className="mb-2 rounded-lg border border-[#1e2432] bg-ink-850 px-3 py-2">
            <p className="line-clamp-2 text-[12px] leading-relaxed text-mist-300">
              {prompt?.trim() || '(Ô nhập bên dưới chưa có câu lệnh)'}
            </p>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-[10.5px] text-mist-400">Khoảng cách mặc định (phút)</label>
              <input
                type="number"
                min={1}
                max={1440}
                value={intervalMin}
                onChange={(e) => setIntervalMin(Number(e.target.value) || 1)}
                className="h-9 w-full rounded-lg border border-[#1e2432] bg-ink-850 px-2.5 font-mono text-[12px] text-mist-100 outline-none focus:border-brand-500/50"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-[10.5px] text-mist-400">Số lần thực hiện</label>
              <input
                type="number"
                min={1}
                max={50}
                value={maxRuns}
                onChange={(e) => setMaxRuns(Number(e.target.value) || 1)}
                className="h-9 w-full rounded-lg border border-[#1e2432] bg-ink-850 px-2.5 font-mono text-[12px] text-mist-100 outline-none focus:border-brand-500/50"
              />
            </div>
            <button
              onClick={add}
              disabled={busy}
              className="flex h-9 items-center gap-1 rounded-lg brand-gradient px-3 text-[12px] font-medium text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Thêm
            </button>
          </div>

          <p className="mt-2 font-mono text-[10px] text-mist-400">
            Mỗi lần {10 + 2 * (duration || 5)} điểm · Tổng {maxRuns} lần · Khoảng {(10 + 2 * (duration || 5)) * maxRuns} điểm
          </p>
        </div>

        {/* 统计 */}
        <div className="flex items-center justify-between border-b border-[#1e2432] px-4 py-2">
          <div className="flex gap-3 text-[10.5px] text-mist-400">
            <span>Chờ thực hiện <b className="font-mono text-gold-400">{stats.pending || 0}</b></span>
            <span>Đang thực hiện <b className="font-mono text-brand-300">{stats.running || 0}</b></span>
            <span>Đã thực hiện <b className="font-mono text-emerald-300">{stats.done || 0}</b></span>
            <span>Tạm dừng <b className="font-mono text-mist-300">{stats.paused || 0}</b></span>
          </div>
          <button onClick={load} className="text-[10.5px] text-mist-400 hover:text-white">
            {loading ? 'Đang làm mới…' : 'Làm mới'}
          </button>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {items.length === 0 ? (
            <div className="grid place-items-center py-20 text-center">
              <Clock size={26} className="text-mist-400/50" />
              <p className="mt-2 text-[12px] text-mist-400">Chưa có tác vụ trong hàng đợi</p>
              <p className="mt-0.5 text-[11px] text-ink-500">Viết xong câu lệnh rồi bấm «Thêm» ở phía trên</p>
            </div>
          ) : (
            <div className="divide-y divide-[#151a25]">
              {items.map((q, i) => {
                const st = STATUS[q.status] || STATUS.pending;
                return (
                  <div key={q.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-ink-500">{String(i + 1).padStart(2, '0')}</span>
                          <span className={clsx('rounded px-1.5 py-0.5 text-[10px]', st.cls)}>{st.label}</span>
                          <span className="font-mono text-[10px] text-mist-400">
                            {q.runs}/{q.maxRuns} lần
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-mist-200">{q.prompt}</p>
                        <p className="mt-1 font-mono text-[9.5px] text-ink-500">
                          {q.nextRunAt && q.status === 'pending'
                            ? `Lần sau ${new Date(q.nextRunAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
                            : q.lastRunAt
                              ? `Lần trước ${fmtAgo(q.lastRunAt)}`
                              : 'Chưa thực hiện'}
                          {' · '}Cách nhau {q.intervalMin} phút
                        </p>
                        {q.note && <p className="mt-0.5 truncate text-[9.5px] text-mist-400">{q.note}</p>}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-1">
                      {q.status === 'paused' ? (
                        <IconAction icon={Play} title="Tiếp tục" onClick={() => act(() => api.patchQueue(q.id, { status: 'pending' }), 'Đã tiếp tục')} />
                      ) : (
                        <IconAction icon={Pause} title="Tạm dừng" onClick={() => act(() => api.patchQueue(q.id, { status: 'paused' }), 'Đã tạm dừng')} />
                      )}
                      <IconAction icon={ArrowUp} title="Lên trên" onClick={() => act(() => api.moveQueue(q.id, 'up'))} />
                      <IconAction icon={ArrowDown} title="Xuống dưới" onClick={() => act(() => api.moveQueue(q.id, 'down'))} />
                      <button
                        onClick={() => { api.deleteQueue(q.id).then(load).catch((e) => toast(e.message, 'error')); }}
                        className="ml-auto grid h-7 w-7 place-items-center rounded-md text-mist-400 transition hover:bg-ink-700 hover:text-rose-400"
                        title="Xóa"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex gap-2 border-t border-[#1e2432] p-3">
          <button
            onClick={() => act(() => api.clearQueueDone(), 'Đã dọn các mục đã xong')}
            className="flex-1 rounded-lg border border-[#232a38] py-2 text-[11.5px] text-mist-300 transition hover:border-[#2c3448] hover:text-white"
          >
            Dọn các mục đã xong
          </button>
          <button
            onClick={async () => {
              if (!(await confirmDialog('Xóa toàn bộ tác vụ trong hàng đợi?', { dontAskKey: 'queue-clear-all' }))) return;
              act(() => api.clearQueueAll(), 'Đã xóa toàn bộ tác vụ');
            }}
            className="flex-1 rounded-lg border border-rose-500/30 py-2 text-[11.5px] text-rose-300 transition hover:bg-rose-500/10"
          >
            Xóa toàn bộ
          </button>
        </div>
      </aside>
    </>
  );
}

function IconAction({ icon: Icon, title, onClick }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="grid h-7 w-7 place-items-center rounded-md text-mist-400 transition hover:bg-ink-700 hover:text-white"
    >
      <Icon size={12} />
    </button>
  );
}
