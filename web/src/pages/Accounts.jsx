import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Trash2, RefreshCw, ShieldCheck, KeyRound, ClipboardPaste, ExternalLink, ChevronDown, Info,
  Link2, Copy, CheckCircle2, Loader2, HelpCircle, Search, Activity, Download, Clipboard, Lock, Globe,
  Video, Image as ImageIcon, Wand2, ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { Badge, Button, Drawer, Empty, Field, Input, Modal, Textarea, useToast } from '../components/ui.jsx';
import { useConfirmDialog } from '../components/ConfirmDialog.jsx';

const STATUS = {
  ok: { tone: 'ok', label: 'Khả dụng' },
  error: { tone: 'error', label: 'Lỗi' },
  unknown: { tone: 'warn', label: 'Chờ kiểm tra' },
  missing: { tone: 'error', label: 'Đã xóa ở upstream' },
};

// Gộp 3 ô nhập proxy thành object gửi lên server. Trả về undefined nếu chưa nhập
// địa chỉ máy chủ. Dán cả dạng http://user:pass@host:port vào ô máy chủ cũng được,
// upstream sẽ tự tách tài khoản/mật khẩu ra.
function buildProxy(server, user, pass) {
  const s = (server || '').trim();
  if (!s) return undefined;
  const p = { server: s };
  if ((user || '').trim()) p.username = user.trim();
  if (pass) p.password = pass;
  return p;
}

export default function Accounts() {
  const toast = useToast();
  const confirmDialog = useConfirmDialog();
  const { user } = useAuth();
  // Chỉ quản trị viên mới thấy / chạm được phần viết prompt chung — dùng cùng
  // cách kiểm tra admin như AdminGuard (App.jsx) và Layout.jsx
  const isAdmin = user?.role === 'admin';
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [proxyAcc, setProxyAcc] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [guide, setGuide] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [q, setQ] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  // Thêm / gỡ tài khoản khỏi nhóm viết prompt — nhiều tài khoản có thể cùng
  // viết prompt, yêu cầu xoay vòng giữa các tài khoản trong nhóm
  const togglePromptWriter = async (acc) => {
    setBusyId(acc.id);
    try {
      if (acc.isPromptWriter) {
        await api.clearPromptWriter(acc.id);
        toast('Đã gỡ khỏi nhóm viết prompt', 'ok');
      } else {
        await api.setPromptWriter(acc.id);
        toast(`«${acc.label}» đã vào nhóm viết prompt — yêu cầu sẽ xoay vòng giữa các tài khoản trong nhóm`, 'ok');
      }
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

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
    if (!(await confirmDialog(`Xóa tài khoản «${acc.label}»?`, { dontAskKey: 'accounts-delete' }))) return;
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
              {summary.totalVideos > 0 && <> · Đã tạo <b className="text-brand-300">{summary.totalVideos} video</b></>}
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

      {/* 列表 — hàng gọn, bấm để mở chi tiết */}
      {loading && !list.length ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-[64px] rounded-xl" />)}
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
        <div className="space-y-2">
          {shown.map((a) => (
            <AccountRow
              key={a.id}
              a={a}
              isAdmin={isAdmin}
              busy={busyId === a.id}
              expanded={expandedId === a.id}
              onToggleExpand={() => setExpandedId((v) => (v === a.id ? null : a.id))}
              onTest={() => act(a.id, api.testAccount, 'Kiểm tra xong')}
              onKeepalive={() => act(a.id, api.keepaliveAccount, 'Đã thử gia hạn')}
              onRemove={() => remove(a)}
              onQuota={() => refreshQuota(a)}
              onProxy={() => setProxyAcc(a)}
              onPromptWriter={() => togglePromptWriter(a)}
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

      {proxyAcc && (
        <ProxyModal
          account={proxyAcc}
          onClose={() => setProxyAcc(null)}
          onDone={() => { setProxyAcc(null); load(); }}
        />
      )}
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

function AccountRow({ a, isAdmin, busy, expanded, onToggleExpand, onTest, onKeepalive, onRemove, onQuota, onProxy, onPromptWriter }) {
  const st = STATUS[a.status] || STATUS.unknown;
  const expiring = a.expiresAt && a.expiresAt * 1000 - Date.now() < 6 * 3600 * 1000;
  const left = a.quota?.weeklyLeftPct;
  // Nhóm viết prompt chỉ admin mới thấy — người thường nhìn hàng như chưa từng
  // có tính năng này: không huy hiệu, không viền brand, không nút Wand2
  const showPromptWriter = isAdmin && a.isPromptWriter;
  const sub = [
    a.expiresAt
      ? `Hiệu lực đến ${new Date(a.expiresAt * 1000).toLocaleString('vi-VN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
      : null,
    a.proxy?.server ? `Proxy: ${a.proxy.server}` : null,
    a.note || null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className={clsx(
        'overflow-hidden rounded-xl border transition',
        showPromptWriter
          ? 'border-l-4 border-l-brand-400 border-y-white/[0.08] border-r-white/[0.08] bg-brand-500/[0.06]'
          : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.12]'
      )}
    >
      {/* Hàng gọn — bấm để mở / thu chi tiết */}
      <div
        className="flex min-h-[64px] cursor-pointer items-center gap-3 px-3 py-2"
        onClick={onToggleExpand}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpand(); } }}
      >
        <span className={clsx('h-9 w-9 shrink-0 rounded-full bg-gradient-to-br shadow-inner', gradFor(a.id || a.upstreamId))} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13.5px] font-semibold text-white" title={a.label}>{a.label}</p>
            <Badge tone={st.tone} dot>{st.label}</Badge>
            {a.shared && <Badge tone="brand">Kho chung</Badge>}
            {showPromptWriter && <Badge tone="brand">Viết prompt</Badge>}
          </div>
          {sub && <p className="mt-0.5 truncate text-[11.5px] text-mist-400" title={sub}>{sub}</p>}
        </div>
        <div className="hidden shrink-0 items-center gap-3 text-[12px] text-mist-300 md:flex">
          {left != null ? (
            <span className="whitespace-nowrap" title={`Hạn mức tuần còn ${left}%`}>
              Còn <b className="text-brand-300">{left}%</b>
              {a.quota?.plan && <span className="ml-1 text-[11px] text-ink-500">{a.quota.plan}</span>}
            </span>
          ) : (
            <span className="whitespace-nowrap text-amber-300">Chưa đọc được</span>
          )}
          <span className="flex items-center gap-1 whitespace-nowrap">
            <Video size={12} className="text-brand-400" />
            {a.videoCount ?? 0} video · {a.imageCount ?? 0} ảnh
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <IconBtn title="Kiểm tra" disabled={busy} onClick={onTest}><ShieldCheck size={14} /></IconBtn>
          <IconBtn title="Duy trì" disabled={busy} onClick={onKeepalive}><Activity size={14} /></IconBtn>
          <IconBtn title="Proxy" disabled={busy} onClick={onProxy}><Globe size={14} /></IconBtn>
          {isAdmin && (
            <IconBtn
              title={a.isPromptWriter ? 'Gỡ khỏi nhóm viết prompt' : 'Thêm vào nhóm viết prompt'}
              disabled={busy}
              active={!!a.isPromptWriter}
              onClick={onPromptWriter}
            >
              <Wand2 size={14} />
            </IconBtn>
          )}
          <IconBtn title="Xóa" danger disabled={busy} onClick={onRemove}><Trash2 size={14} /></IconBtn>
          <ChevronRight
            size={15}
            className={clsx('ml-0.5 shrink-0 text-mist-400 transition-transform', expanded && 'rotate-90')}
          />
        </div>
      </div>

      {/* Chi tiết — chỉ hiện khi mở */}
      {expanded && (
        <div className="fade-in border-t border-white/[0.06] px-3 py-3 text-[12px]">
          <div className="flex items-baseline justify-between">
            <span className="text-mist-300">
              Hạn mức tuần{' '}
              {left != null ? (
                <>
                  <b className="ml-1 text-[16px] font-semibold text-brand-300">{left}%</b>
                  <span className="text-mist-400"> / 100%</span>
                  {a.quota?.plan && <span className="ml-2 text-[11px] text-ink-500">{a.quota.plan}</span>}
                </>
              ) : (
                <b className="ml-1 text-[14px] font-semibold text-amber-300">Chưa đọc được</b>
              )}
            </span>
            <button onClick={onQuota} disabled={busy} className="text-[12px] text-brand-400 hover:text-brand-300 disabled:opacity-50">
              {busy ? 'Đang tra cứu…' : left != null ? 'Làm mới hạn mức' : 'Bấm để tra cứu'}
            </button>
          </div>
          {left != null ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={clsx(
                  'h-full rounded-full transition-all',
                  left > 40 ? 'bg-gradient-to-r from-brand-500 to-brand-400' : left > 15 ? 'bg-gold-400' : 'bg-rose-400'
                )}
                style={{ width: `${Math.max(2, left)}%` }}
              />
            </div>
          ) : (
            <>
              <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]" />
              <p className="mt-2 text-[11.5px] leading-relaxed text-mist-400">
                Muse chưa đọc được bảng Usage của tài khoản này (phiên vẫn khả dụng).
                Bấm «Tra cứu» để đọc lại — nếu vẫn không được thì hạn mức tuần tạm thời chưa rõ.
              </p>
            </>
          )}
          <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-mist-300">
            <span className="flex items-center gap-1.5">
              <Video size={13} className="text-brand-400" />
              Đã tạo <b className="text-white">{a.videoCount ?? 0} video</b>
            </span>
            <span className="flex items-center gap-1.5">
              <ImageIcon size={13} className="text-brand-400" />
              <b className="text-white">{a.imageCount ?? 0} ảnh</b>
            </span>
            {a.useCount != null && (
              <span className="text-mist-400">
                Upstream đã dùng <b className="text-mist-200">{a.useCount} lần</b>
                {a.lastUsed ? ` · lần cuối ${fmtAgo(a.lastUsed * 1000)}` : ''}
              </span>
            )}
          </p>
          <p className="mt-2 flex flex-wrap gap-x-3 text-[11.5px] text-mist-400">
            <span>
              Hiệu lực đến{' '}
              <span className={clsx('font-mono', expiring ? 'text-amber-300' : 'text-mist-300')}>
                {a.expiresAt ? new Date(a.expiresAt * 1000).toLocaleString('vi-VN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
            </span>
            {a.quota?.weeklyReset && <span>Đặt lại vào {a.quota.weeklyReset}</span>}
            {a.quota?.tokensLeft && <span>Thêm {a.quota.tokensLeft} tokens</span>}
            {a.quota?.extraLeft && <span>Tokens thêm còn {a.quota.extraLeft}</span>}
            {a.proxy?.server && <span>Proxy: {a.proxy.server}</span>}
            {a.upstreamId && <span className="font-mono text-[10px] text-ink-500">#{a.upstreamId.slice(0, 6)}</span>}
          </p>
          {a.note && <p className="mt-1 text-[11px] text-ink-500">{a.note}</p>}
        </div>
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled, danger, active }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        'grid h-8 w-8 shrink-0 place-items-center rounded-lg border transition disabled:opacity-40',
        active
          ? 'border-brand-400/50 bg-brand-500/20 text-brand-300'
          : danger
            ? 'border-rose-500/25 text-rose-400 hover:bg-rose-500/10'
            : 'border-white/[0.07] text-mist-300 hover:bg-white/5 hover:text-white'
      )}
    >
      {children}
    </button>
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
  const [proxyServer, setProxyServer] = useState('');
  const [proxyUser, setProxyUser] = useState('');
  const [proxyPass, setProxyPass] = useState('');
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
      const proxy = buildProxy(proxyServer, proxyUser, proxyPass);
      const out = await api.importAccount({ label: label.trim() || undefined, cookie: cookie.trim(), ...(proxy ? { proxy } : {}) });
      if (out.essentialMissing?.length) {
        toast(`Nhập thành công nhưng thiếu ${out.essentialMissing.join(', ')}, có thể không tạo được`, 'error');
      } else {
        toast('Tài khoản đã được lưu vào', 'ok');
      }
      setLabel(''); setCookie(''); setProxyServer(''); setProxyUser(''); setProxyPass('');
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

        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
          <p className="text-[13px] font-medium text-mist-300">
            Proxy <span className="font-normal text-ink-500">(không bắt buộc)</span>
          </p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            Chỉ traffic đi muse.ai của tài khoản này mới qua proxy. Để trống là không dùng proxy.
          </p>
          <div className="mt-2 space-y-2">
            <Input
              value={proxyServer}
              onChange={(e) => setProxyServer(e.target.value)}
              placeholder="http://host:port hoặc socks5://host:port"
              className="font-mono text-[12px]"
            />
            <div className="grid grid-cols-2 gap-2">
              <Input value={proxyUser} onChange={(e) => setProxyUser(e.target.value)} placeholder="Tên đăng nhập proxy (nếu có)" />
              <Input type="password" value={proxyPass} onChange={(e) => setProxyPass(e.target.value)} placeholder="Mật khẩu proxy (nếu có)" />
            </div>
            <p className="text-[11px] text-ink-500">
              Dán cả dạng <code className="rounded bg-ink-800 px-1">http://user:pass@host:port</code> vào ô địa chỉ cũng được, hệ thống sẽ tự tách.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Hủy</Button>
          <Button onClick={submit} loading={busy}>Nhập</Button>
        </div>
      </div>
    </Modal>
  );
}

function ProxyModal({ account, onClose, onDone }) {
  const toast = useToast();
  const [server, setServer] = useState(account?.proxy?.server || '');
  const [user, setUser] = useState(account?.proxy?.username || '');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const hasProxy = !!account?.proxy?.server;

  const save = async (clear) => {
    if (!clear && !buildProxy(server, user, pass)) return toast('Nhập địa chỉ proxy', 'error');
    setBusy(true);
    try {
      const proxy = clear ? null : buildProxy(server, user, pass);
      await api.updateAccountProxy(account.id, proxy);
      toast(clear ? 'Đã xóa proxy' : 'Đã lưu proxy — hãy bấm Kiểm tra để xác nhận', 'ok');
      onDone();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Proxy — ${account?.label || ''}`}>
      <div className="space-y-3.5">
        <p className="text-[12px] text-mist-400">
          Chỉ traffic đi muse.ai của tài khoản này mới qua proxy. Đổi proxy sẽ đặt lại trạng thái
          tài khoản thành chờ kiểm tra — bấm <b className="text-mist-200">Kiểm tra</b> sau khi lưu để xác nhận.
        </p>
        <Field label="Địa chỉ máy chủ" hint="http://host:port hoặc socks5://host:port">
          <Input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="http://host:port"
            className="font-mono text-[12px]"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tên đăng nhập">
            <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="Nếu có" />
          </Field>
          <Field label="Mật khẩu" hint={account?.proxy?.has_password ? 'Để trống để giữ mật khẩu cũ' : undefined}>
            <Input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Nếu có" />
          </Field>
        </div>
        <p className="text-[11px] text-ink-500">
          Dán cả dạng <code className="rounded bg-ink-800 px-1">http://user:pass@host:port</code> vào ô địa chỉ cũng được, hệ thống sẽ tự tách.
        </p>
        <div className="flex justify-between gap-2 pt-1">
          <div>
            {hasProxy && (
              <Button variant="outline" onClick={() => save(true)} loading={busy}>Xóa proxy</Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Hủy</Button>
            <Button onClick={() => save(false)} loading={busy}>Lưu</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
