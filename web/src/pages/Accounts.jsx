import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Trash2, RefreshCw, ShieldCheck, KeyRound, ClipboardPaste, ExternalLink, ChevronDown, Info,
  Link2, Copy, CheckCircle2, Loader2, HelpCircle, Search, Activity, Download, Clipboard, Lock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { Badge, Button, Drawer, Empty, Field, Input, Modal, Textarea, useToast } from '../components/ui.jsx';

const STATUS = {
  ok: { tone: 'ok', label: 'Khả dụng' },
  error: { tone: 'error', label: 'Lỗi' },
  unknown: { tone: 'warn', label: 'Chờ kiểm tra' },
  missing: { tone: 'error', label: 'Đã xóa ở upstream' },
};

export default function Accounts() {
  const toast = useToast();
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [guide, setGuide] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.accounts();
      setList(out.accounts);
      setSummary(out.summary || null);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const refreshQuota = async (acc) => {
    setBusyId(acc.id);
    try {
      await api.refreshQuota(acc.upstreamId);
      await load();
      toast('Đã làm mới hạn mức', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const act = async (id, fn, okMsg) => {
    setBusyId(id);
    try {
      await fn(id);
      toast(okMsg, 'ok');
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (acc) => {
    if (!confirm(`Xóa tài khoản «${acc.label}»?`)) return;
    setBusyId(acc.id);
    try {
      await api.deleteAccount(acc.id);
      setList((l) => l.filter((a) => a.id !== acc.id));
      toast('Đã xóa', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const quotaText = (q) => {
    if (!q) return '—';
    if (q.weeklyLeftPct != null) return `Còn ${q.weeklyLeftPct}%`;
    if (typeof q === 'string') return q;
    return '—';
  };
  void quotaText;

  const shown = list.filter((a) => {
    if (statusFilter !== 'all' && (a.status || 'unknown') !== statusFilter) return false;
    if (q && !`${a.label || ''} ${a.note || ''} ${a.upstreamId || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-[1180px] px-6 py-7 lg:px-9">
      {/* 顶部 */}
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-tight text-white">
            Nhập Muse
            <HelpCircle size={17} className="cursor-pointer text-mist-400 hover:text-mist-200" onClick={() => setGuide((v) => !v)} />
          </h1>
          <p className="mt-1.5 text-[13px] text-mist-400">
            Liên kết tài khoản Muse bằng Cookie để nhập và quản lý tài sản tài khoản Muse của bạn một cách dễ dàng.
            {user?.role === 'admin' ? 'Tài khoản do quản trị viên nhập được dùng chung.' : 'Tài khoản bạn nhập chỉ mình bạn thấy.'}
          </p>
        </div>
        <div className="flex gap-2.5">
          <Button onClick={() => setBindOpen(true)} className="h-11 px-5">
            <Link2 size={15} /> Liên kết một chạm
          </Button>
          <Button variant="outline" onClick={() => setOpen(true)} className="h-11 px-5">
            <Clipboard size={15} /> Dán Cookie
          </Button>
        </div>
      </div>

      {/* 使用说明（点标题旁 ? 展开） */}
      {guide && (
        <div className="panel mb-5 space-y-2.5 px-5 py-4 text-[12.5px] leading-relaxed text-mist-400 fade-in">
          <p className="flex items-center gap-2 text-[13px] font-medium text-mist-200">
            <Info size={14} className="text-brand-400" /> Lấy Cookie bằng cách nào?
          </p>
          <p>
            <b className="text-mist-200">Cách 1 (khuyên dùng, không cần F12)</b>: Bấm nút ở góc phải phía trên 
            <b className="text-brand-300">«Liên kết một chạm»</b>để tạo liên kết → mở trong <span className="text-mist-200">trình duyệt đã đăng nhập muse.ai</span>→
            Tiện ích sẽ tự đọc trạng thái đăng nhập và lưu vào. Chỉ cần cài tiện ích một lần.
          </p>
          <p>
            <b className="text-mist-200">Cách 2 (thủ công dự phòng)</b>: Bấm «Dán Cookie», dùng Chrome mở {' '}
            <a className="text-brand-400 hover:underline" href="https://muse.ai/" target="_blank" rel="noreferrer">muse.ai <ExternalLink size={10} className="inline" /></a>
            {' '}đăng nhập → <kbd className="rounded bg-white/5 px-1.5 py-0.5 text-[11px]">F12</kbd> → <b className="text-mist-200">Application → Cookies → https://muse.ai</b> →
            Sao chép toàn bộ đoạn (ít nhất phải có <code className="rounded bg-white/5 px-1 text-[11px]">hatch_sess</code>).
          </p>
          <p className="text-ink-500">Phiên đăng nhập hiệu lực khoảng 48 giờ, hết hạn thì liên kết lại. Có thể liên kết nhiều tài khoản, kho sẽ tự luân chuyển.</p>
        </div>
      )}

      {/* 工具条 */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h2 className="text-[17px] font-semibold text-white">
            Tài khoản Muse của tôi <span className="font-normal text-mist-400">({list.length})</span>
          </h2>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-[12.5px] text-mist-300 transition hover:text-brand-300"
          >
            <RefreshCw size={13} className={clsx(loading && 'animate-spin')} /> Làm mới trạng thái
          </button>
          {summary?.usable > 0 && (
            <span className="hidden items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1 text-[11.5px] text-mist-300 md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              Khả dụng {summary.usable}/{summary.total}
              {summary.weeklyLeftPct != null && <> · Trung bình còn <b className="text-brand-300">{summary.weeklyLeftPct}%</b></>}
              {summary.weeklyReset && <span className="text-ink-500"> · Đặt lại vào {summary.weeklyReset}</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-10 cursor-pointer appearance-none rounded-xl border border-white/[0.07] bg-[#121726] pl-3.5 pr-8 text-[12.5px] text-mist-200 outline-none focus:border-brand-400/50"
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="ok">Khả dụng</option>
              <option value="unknown">Chờ kiểm tra</option>
              <option value="error">Lỗi</option>
              <option value="missing">Đã xóa ở upstream</option>
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-mist-400" />
          </label>
          <label className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm theo ghi chú hoặc ID"
              className="h-10 w-[200px] rounded-xl border border-white/[0.07] bg-[#121726] pl-9 pr-3 text-[12.5px] text-mist-100 outline-none placeholder:text-mist-400/70 focus:border-brand-400/50"
            />
          </label>
        </div>
      </div>

      {/* 列表 */}
      {loading && !list.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-[178px] rounded-2xl" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="panel">
          <Empty
            icon={KeyRound}
            title="Kho tài khoản đang trống"
            desc="Nhập ít nhất một tài khoản muse.ai để bắt đầu tạo"
            action={
              <div className="flex gap-2">
                <Button onClick={() => setBindOpen(true)}><Link2 size={14} /> Liên kết một chạm</Button>
                <Button variant="outline" onClick={() => setOpen(true)}><Plus size={14} /> Dán Cookie</Button>
              </div>
            }
          />
        </div>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-mist-400">Không có tài khoản nào khớp bộ lọc</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((a) => (
            <AccountCard
              key={a.id}
              a={a}
              busy={busyId === a.id}
              onTest={() => act(a.id, api.testAccount, 'Kiểm tra xong')}
              onKeepalive={() => act(a.id, api.keepaliveAccount, 'Đã thử gia hạn')}
              onRemove={() => remove(a)}
              onQuota={() => refreshQuota(a)}
            />
          ))}
        </div>
      )}

      <p className="mt-5 text-center text-[11.5px] text-ink-500">Tổng {list.length} tài khoản · Tự động luân chuyển nhiều tài khoản</p>

      <ImportModal
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => { setOpen(false); load(); }}
      />

      <BindDrawer
        open={bindOpen}
        onClose={() => setBindOpen(false)}
        onDone={load}
      />
    </div>
  );
}

const AVATAR_GRADS = [
  'from-emerald-400 to-teal-700',
  'from-indigo-400 to-violet-700',
  'from-rose-400 to-red-800',
  'from-sky-400 to-blue-700',
  'from-teal-400 to-cyan-800',
  'from-amber-400 to-orange-700',
];
const gradFor = (id = '') => AVATAR_GRADS[[...String(id)].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_GRADS.length];

function AccountCard({ a, busy, onTest, onKeepalive, onRemove, onQuota }) {
  const st = STATUS[a.status] || STATUS.unknown;
  const expiring = a.expiresAt && a.expiresAt * 1000 - Date.now() < 6 * 3600 * 1000;
  const left = a.quota?.weeklyLeftPct;

  return (
    <div className="card card-hover flex flex-col p-5">
      <div className="flex items-start gap-3">
        <span className={clsx('h-12 w-12 shrink-0 rounded-full bg-gradient-to-br shadow-inner', gradFor(a.id || a.upstreamId))} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-white" title={a.label}>{a.label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={st.tone} dot>{st.label}</Badge>
            {a.shared && <Badge tone="brand">Kho chung</Badge>}
          </div>
        </div>
        <span className="font-mono text-[10px] text-ink-500" title={a.upstreamId}>
          {a.upstreamId ? `#${a.upstreamId.slice(0, 6)}` : ''}
        </span>
      </div>

      <div className="mt-4">
        {left != null ? (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-mist-300">
                Hạn mức tuần <b className="ml-1 text-[18px] font-semibold text-brand-300">{left}%</b>
                <span className="text-mist-400"> / 100%</span>
              </span>
              <button onClick={onQuota} disabled={busy} title="Làm mới hạn mức" className="text-mist-400 hover:text-brand-300 disabled:opacity-40">
                <RefreshCw size={12} />
              </button>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={clsx(
                  'h-full rounded-full transition-all',
                  left > 40 ? 'bg-gradient-to-r from-brand-500 to-brand-400' : left > 15 ? 'bg-gold-400' : 'bg-rose-400'
                )}
                style={{ width: `${Math.max(2, left)}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] text-mist-300">
                Hạn mức tuần <b className="ml-1 text-[18px] font-semibold text-mist-400">—</b>
              </span>
              <button onClick={onQuota} disabled={busy} className="text-[12px] text-brand-400 hover:text-brand-300 disabled:opacity-50">
                {busy ? 'Đang tra cứu…' : 'Bấm để tra cứu'}
              </button>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]" />
          </>
        )}
        <p className="mt-2.5 flex flex-wrap gap-x-3 text-[11.5px] text-mist-400">
          <span>
            Hiệu lực đến{' '}
            <span className={clsx('font-mono', expiring ? 'text-amber-300' : 'text-mist-300')}>
              {a.expiresAt ? new Date(a.expiresAt * 1000).toLocaleString('vi-VN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
          </span>
          {a.quota?.weeklyReset && <span>Đặt lại vào {a.quota.weeklyReset}</span>}
          {a.quota?.tokensLeft && <span>Thêm {a.quota.tokensLeft} tokens</span>}
        </p>
        {a.note && <p className="mt-1 truncate text-[11px] text-ink-500" title={a.note}>{a.note}</p>}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button variant="soft" size="sm" loading={busy} onClick={onTest}>
          {!busy && <ShieldCheck size={13} />} Kiểm tra
        </Button>
        <Button variant="soft" size="sm" disabled={busy} onClick={onKeepalive}>
          <Activity size={13} /> Duy trì
        </Button>
        <button
          onClick={onRemove}
          disabled={busy}
          title="Xóa"
          className="ml-auto grid h-8 w-8 place-items-center rounded-xl border border-rose-500/25 text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-40"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function BindDrawer({ open, onClose, onDone }) {
  const toast = useToast();
  const [code, setCode] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | creating | waiting | done | expired | error
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');

  const link = code ? `${location.origin}/bind/${code.code}` : '';

  useEffect(() => {
    if (!open) {
      setCode(null);
      setStatus('idle');
      setErr('');
      return;
    }
    let cancelled = false;
    (async () => {
      setStatus('creating');
      setErr('');
      try {
        const out = await api.bindCode();
        if (cancelled) return;
        setCode(out);
        setStatus('waiting');
      } catch (e) {
        if (cancelled) return;
        setErr(e.message);
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // 轮询绑定状态
  useEffect(() => {
    if (status !== 'waiting' || !code) return undefined;
    const t = setInterval(async () => {
      try {
        const s = await api.bindStatus(code.code);
        if (s.status === 'done') {
          setStatus('done');
          onDone?.();
        } else if (s.status === 'expired') {
          setStatus('expired');
        }
      } catch (e) {
        if (e.status === 404) setStatus('expired');
      }
    }, 2500);
    return () => clearInterval(t);
  }, [status, code, onDone]);

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1600);
    } catch {
      toast('Sao chép thất bại, hãy chọn thủ công', 'error');
    }
  };

  const steps = [
    ['Sao chép liên kết', 'Sao chép liên kết bên dưới (hoặc mã liên kết)'],
    ['Mở trình duyệt đã đăng nhập muse.ai', 'Đảm bảo trình duyệt đó đã cài tiện ích trình duyệt Muse'],
    ['Mở liên kết trong trình duyệt đó', 'Tiện ích sẽ tự đọc trạng thái đăng nhập và gửi đi'],
    ['Chờ hoàn tất', 'Trang này tự phát hiện, sau khi liên kết thành công tài khoản sẽ vào kho tài khoản'],
  ];

  return (
    <Drawer open={open} onClose={onClose} title="Quy trình liên kết một chạm" subtitle="Liên kết tài khoản nhanh bằng liên kết, không cần tìm Cookie bằng F12">
      <div className="space-y-5">
        {/* 绑定码 */}
        <div className="panel p-4">
          <p className="mb-2.5 text-[13px] font-medium text-mist-100">Mã ủy quyền liên kết</p>
          {status === 'creating' && (
            <div className="flex items-center gap-2 py-3 text-[12.5px] text-mist-400">
              <Loader2 size={14} className="animate-spin text-brand-400" /> Đang tạo mã liên kết…
            </div>
          )}
          {code && (
            <>
              <div className="flex items-stretch overflow-hidden rounded-xl border border-white/[0.07] bg-[#0d111c]">
                <span className="min-w-0 flex-1 truncate px-3.5 py-2.5 font-mono text-[16px] font-semibold tracking-wider text-brand-300">
                  {code.code}
                </span>
                <button
                  onClick={() => copy(code.code, 'code')}
                  title="Sao chép mã liên kết"
                  className="grid w-11 place-items-center border-l border-white/[0.07] text-mist-300 hover:bg-white/5 hover:text-white"
                >
                  {copied === 'code' ? <CheckCircle2 size={15} className="text-brand-400" /> : <Copy size={15} />}
                </button>
              </div>
              <div className="mt-2.5 flex gap-2">
                <div className="min-w-0 flex-1 truncate rounded-xl border border-white/[0.07] bg-[#0d111c] px-3 py-2 font-mono text-[11px] text-mist-300" title={link}>
                  {link}
                </div>
                <Button variant="soft" size="sm" className="h-9" onClick={() => copy(link, 'link')}>
                  {copied === 'link' ? <CheckCircle2 size={13} /> : <Copy size={13} />}
                </Button>
                <a href={link} target="_blank" rel="noreferrer">
                  <Button size="sm" className="h-9">Mở</Button>
                </a>
              </div>
            </>
          )}

          {status === 'waiting' && (
            <p className="mt-3 flex items-center gap-2 text-[12px] text-mist-400">
              <Loader2 size={13} className="animate-spin text-brand-400" /> Đang chờ tiện ích gửi… Mở liên kết xong sẽ tự hoàn tất
            </p>
          )}
          {status === 'done' && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-[12.5px] text-emerald-300">
              <CheckCircle2 size={14} /> Liên kết thành công, tài khoản đã vào kho tài khoản của bạn
            </p>
          )}
          {status === 'expired' && (
            <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-[12.5px] text-amber-200">
              Mã liên kết đã hết hạn, đóng bảng rồi bấm «Liên kết một chạm» lại
            </p>
          )}
          {status === 'error' && (
            <p className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-300">{err || 'Tạo mã liên kết thất bại'}</p>
          )}
        </div>

        {/* 操作步骤 */}
        <div>
          <p className="mb-3 text-[13px] font-medium text-mist-100">Các bước thực hiện</p>
          <ol className="relative space-y-4">
            <span className="absolute bottom-3 left-[11px] top-3 w-px bg-white/[0.07]" />
            {steps.map(([t, d], i) => (
              <li key={t} className="relative flex gap-3">
                <span className="z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500/20 font-mono text-[11px] font-semibold text-brand-300 ring-4 ring-[#0f1320]">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[13px] font-medium text-mist-100">{t}</p>
                  <p className="mt-0.5 text-[11.5px] text-mist-400">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* 扩展安装 */}
        <div className="panel p-4">
          <p className="text-[13px] font-medium text-mist-100">Chưa cài tiện ích?</p>
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-white/[0.06] bg-[#0d111c] p-3">
            <Download size={18} className="mt-0.5 shrink-0 text-mist-300" />
            <div className="text-[11.5px] leading-relaxed text-mist-400">
              <p className="text-[12.5px] font-medium text-mist-100">Tải tiện ích trình duyệt Muse</p>
              Giải nén rồi vào <code className="rounded bg-white/5 px-1">chrome://extensions</code> bật «Chế độ nhà phát triển» → «Tải tiện ích đã giải nén». Hỗ trợ Chrome / Edge.
            </div>
          </div>
          <a href="/download/museapi-video-extension.zip" download className="mt-3 block">
            <Button variant="outline" className="w-full border-brand-400/40 text-brand-300 hover:border-brand-400/70">
              Tải ngay <ExternalLink size={13} />
            </Button>
          </a>
        </div>

        <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-mist-400">
          <Lock size={13} className="mt-0.5 shrink-0" />
          Mã liên kết hiệu lực khoảng 20 phút, hãy dùng sớm. Thao tác này chỉ đọc trạng thái đăng nhập muse.ai, không lấy mật khẩu của bạn.
        </p>
      </div>
    </Drawer>
  );
}

function ImportModal({ open, onClose, onDone }) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [cookie, setCookie] = useState('');
  const [busy, setBusy] = useState(false);

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setCookie(t.trim());
    } catch {
      toast('Trình duyệt không cho phép đọc clipboard, hãy dán thủ công', 'error');
    }
  };

  const submit = async () => {
    if (cookie.trim().length < 10) return toast('Hãy dán Cookie', 'error');
    setBusy(true);
    try {
      const out = await api.importAccount({ label: label.trim() || undefined, cookie: cookie.trim() });
      if (out.essentialMissing?.length) {
        toast(`Nhập thành công nhưng thiếu ${out.essentialMissing.join(', ')}, có thể không tạo được`, 'error');
      } else {
        toast('Tài khoản đã được lưu vào', 'ok');
      }
      setLabel(''); setCookie('');
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Nhập bằng cách dán Cookie">
      <div className="space-y-3.5">
        <Field label="Tên ghi chú" hint="Để phân biệt nhiều tài khoản, có thể để trống">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ví dụ: Tài khoản chính / Tài khoản phụ A" />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-mist-300">Cookie</span>
            <button onClick={paste} className="flex items-center gap-1 text-[11.5px] text-brand-400 hover:text-brand-300">
              <ClipboardPaste size={11} /> Đọc clipboard
            </button>
          </div>
          <Textarea
            rows={6}
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder={'hatch_sess=eyJhbGciOi...; hatch_vml=...; các mục khác'}
            className="font-mono text-[11.5px]"
          />
          <p className="mt-1 text-[11px] text-ink-500">
            Bắt buộc phải có <code className="rounded bg-ink-800 px-1">hatch_sess</code>. Dán toàn bộ đoạn là được, các dòng thừa sẽ tự được dọn.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Hủy</Button>
          <Button onClick={submit} loading={busy}>Nhập</Button>
        </div>
      </div>
    </Modal>
  );
}
