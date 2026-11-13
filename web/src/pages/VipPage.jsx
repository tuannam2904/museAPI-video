import { useCallback, useEffect, useState } from 'react';
import { Crown, Copy, RefreshCw, X, CheckCircle2, Clock, AlertTriangle, QrCode } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtTime } from '../lib/api.js';
import { fmtCountdown, useNow } from '../lib/mediaPolicy.js';
import { Badge, Button, Empty, Spinner, useToast } from '../components/ui.jsx';
import { useConfirmDialog } from '../components/ConfirmDialog.jsx';

const PLAN_LABEL = { day: 'Ngày', week: 'Tuần', month: 'Tháng' };
const PLAN_DAYS = { day: 1, week: 7, month: 30 };
const ORDER_STATUS = {
  pending: ['brand', 'Chờ thanh toán'],
  paid: ['ok', 'Đã thanh toán'],
  expired: ['neutral', 'Hết hạn'],
  underpaid: ['warn', 'Thiếu tiền'],
  canceled: ['neutral', 'Đã hủy'],
};

const fmtVnd = (n) => (n == null || n === '' ? '—' : `${Number(n).toLocaleString('vi-VN')}đ`);

export default function VipPage() {
  const toast = useToast();
  const confirmDialog = useConfirmDialog();
  const now = useNow(1000);
  const [status, setStatus] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState('month');
  const [activeOrder, setActiveOrder] = useState(null); // {order, qrPayload, qrDataUrl, bank}
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, ord] = await Promise.all([api.vipStatus(), api.vipOrders()]);
      setStatus(st);
      setOrders(ord.orders || []);
      return { st, ord };
    } catch (e) {
      toast(e.message, 'error');
      return null;
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const out = await load();
      // Nếu có đơn đang chờ thanh toán thì mở sẵn để user tiếp tục chuyển khoản.
      const pending = out?.ord?.orders?.find((o) => o.status === 'pending');
      if (pending) {
        try {
          setActiveOrder(await api.vipOrder(pending.id));
        } catch { /* đơn có thể đã hết hạn — kệ, lịch sử vẫn hiện */ }
      }
      setLoading(false);
    })();
  }, [load]);

  // Tự kiểm tra đơn đang chờ mỗi 20s (server tự xác nhận khi tiền về).
  useEffect(() => {
    const order = activeOrder?.order;
    if (!order || order.status !== 'pending') return undefined;
    const t = setInterval(() => { refreshOrder(order.id, true); }, 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.order?.id, activeOrder?.order?.status]);

  const refreshOrder = async (id, silent) => {
    setChecking(true);
    try {
      const detail = await api.vipOrder(id);
      setActiveOrder(detail);
      const [st, ord] = await Promise.all([api.vipStatus(), api.vipOrders()]);
      setStatus(st);
      setOrders(ord.orders || []);
      const s = detail.order?.status;
      if (s === 'paid' && !silent) toast('Đã thanh toán — VIP đã được kích hoạt', 'ok');
      if (s === 'paid') setActiveOrder((d) => ({ ...d }));
      return detail;
    } catch (e) {
      if (!silent) toast(e.message, 'error');
      return null;
    } finally {
      setChecking(false);
    }
  };

  const buy = async () => {
    if (!selectedPlan) return;
    setCreating(true);
    try {
      const detail = await api.createVipOrder(selectedPlan);
      setActiveOrder(detail);
      const ord = await api.vipOrders();
      setOrders(ord.orders || []);
      toast('Đã tạo đơn VIP — quét mã QR để thanh toán', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const cancel = async () => {
    const order = activeOrder?.order;
    if (!order) return;
    if (!(await confirmDialog(`Hủy đơn VIP ${order.code}?`, { dontAskKey: 'vip-cancel-order' }))) return;
    setCanceling(true);
    try {
      await api.cancelVipOrder(order.id);
      setActiveOrder(null);
      const ord = await api.vipOrders();
      setOrders(ord.orders || []);
      toast('Đã hủy đơn', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCanceling(false);
    }
  };

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(String(text));
      toast(`Đã sao chép ${label}`, 'ok');
    } catch {
      toast('Sao chép thất bại, hãy chọn thủ công', 'error');
    }
  };

  if (loading && !status) {
    return <div className="grid h-full place-items-center text-brand-400"><Spinner size={22} /></div>;
  }

  const plans = status?.plans?.length ? status.plans : [];
  const isVip = !!status?.isVip;
  const vipUntil = status?.vipExpiresAt;
  const order = activeOrder?.order;
  const orderLeft = order?.expiresAt ? order.expiresAt - now : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-5 lg:p-7">
      {/* ---------- trạng thái VIP ---------- */}
      <div className="card flex flex-wrap items-center gap-4 p-5">
        <span className={clsx(
          'grid h-12 w-12 place-items-center rounded-2xl',
          isVip ? 'bg-amber-500/15 text-amber-300' : 'bg-white/[0.04] text-mist-400'
        )}
        >
          <Crown size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold text-white">
            {isVip ? 'Bạn đang là VIP' : 'Nâng cấp VIP'}
          </h1>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-mist-400">
            {isVip
              ? `VIP của bạn có hiệu lực đến ${fmtTime(vipUntil)} — dùng được các tài khoản Muse VIP do admin cung cấp.`
              : 'VIP được dùng các tài khoản Muse VIP do admin cung cấp. Không có VIP thì bạn dùng tài khoản Muse của chính mình.'}
          </p>
          {status?.vipActiveCount != null && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-mist-400">
              Hiện có <b className="text-brand-300">{status.vipActiveCount} tài khoản Muse đang hoạt động</b>
              {status.vipTotalCount > 0 && <> / {status.vipTotalCount} acc VIP</>}.
            </p>
          )}
        </div>
        {isVip && <Badge tone="warn">VIP đến {fmtTime(vipUntil)}</Badge>}
      </div>

      {/* ---------- 3 gói VIP ---------- */}
      <div className="card p-5">
        <h2 className="text-[14px] font-semibold text-mist-200">Chọn gói VIP</h2>
        {plans.length === 0 ? (
          <p className="mt-3 text-[12.5px] text-mist-400">Admin chưa đặt giá gói VIP — quay lại sau nhé.</p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {plans.map((p) => {
                const label = PLAN_LABEL[p.key] || p.key;
                const days = p.days ?? PLAN_DAYS[p.key] ?? 0;
                const active = selectedPlan === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => setSelectedPlan(p.key)}
                    className={clsx(
                      'rounded-2xl border p-4 text-left transition',
                      active
                        ? 'border-amber-400/60 bg-amber-500/[0.08] shadow-[0_0_0_1px_rgba(251,191,36,.35)]'
                        : 'border-white/[0.07] bg-[#0d111c] hover:border-white/20'
                    )}
                  >
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
                      <Crown size={13} className={active ? 'text-amber-300' : 'text-mist-400'} />
                      Gói {label}
                      {p.key === 'month' && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">Tiết kiệm nhất</span>}
                    </p>
                    <p className="mt-1.5 text-[22px] font-bold tabular-nums text-white">{fmtVnd(p.priceVnd)}</p>
                    <p className="mt-0.5 text-[12px] text-mist-400">{days} ngày sử dụng</p>
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={buy} loading={creating} disabled={!selectedPlan}>
                <Crown size={14} /> Mua VIP — {fmtVnd(plans.find((p) => p.key === selectedPlan)?.priceVnd)}
              </Button>
              <p className="text-[11.5px] text-mist-400">Thanh toán bằng chuyển khoản ngân hàng (VietQR) — hệ thống tự kích hoạt khi tiền về.</p>
            </div>
          </>
        )}
      </div>

      {/* ---------- đơn đang thanh toán ---------- */}
      {order && (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-mist-200">
              <QrCode size={15} className="text-brand-400" />
              Thanh toán đơn VIP
            </h2>
            <OrderBadge status={order.status} />
          </div>

          {order.status === 'paid' && (
            <p className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-emerald-200">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              Đã thanh toán — VIP của bạn đã được kích hoạt đến {fmtTime(status?.vipExpiresAt)}.
            </p>
          )}
          {order.status === 'underpaid' && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              Bạn đã chuyển thiếu tiền so với đơn này — số tiền chuyển không được cộng. Hãy liên hệ admin để được hỗ trợ, hoặc tạo đơn mới.
            </p>
          )}
          {order.status === 'expired' && (
            <p className="flex items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[12.5px] leading-relaxed text-mist-300">
              <Clock size={14} className="mt-0.5 shrink-0" />
              Đơn này đã hết hạn thanh toán. Nếu bạn đã chuyển khoản sau khi hết hạn, hệ thống vẫn nhận trong 24 giờ — bấm "Kiểm tra thanh toán" để kiểm tra lại, hoặc tạo đơn mới.
            </p>
          )}
          {order.status === 'canceled' && (
            <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-[12.5px] text-mist-300">
              Đơn này đã bị hủy.
            </p>
          )}

          {order.status === 'pending' && (
            <>
              <div className="flex flex-wrap gap-4">
                {activeOrder.qrDataUrl ? (
                  <img src={activeOrder.qrDataUrl} alt="Mã VietQR thanh toán" className="h-44 w-44 shrink-0 rounded-2xl border border-white/10 bg-white p-2" />
                ) : (
                  <div className="grid h-44 w-44 shrink-0 place-items-center rounded-2xl border border-white/10 bg-[#0d111c] p-3 text-center text-[11.5px] leading-relaxed text-mist-400">
                    Không có ảnh QR — quét bằng app ngân hàng với nội dung chuyển khoản bên dưới.
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-2.5 text-[13px]">
                  <InfoRow label="Ngân hàng" value={activeOrder.bank?.bin ? `MB (BIN ${activeOrder.bank.bin})` : 'MB'} onCopy={activeOrder.bank?.bin ? () => copy(activeOrder.bank.bin, 'mã BIN') : null} />
                  <InfoRow label="Số tài khoản" value={activeOrder.bank?.accountNo} onCopy={() => copy(activeOrder.bank?.accountNo, 'số tài khoản')} mono />
                  <InfoRow label="Chủ tài khoản" value={activeOrder.bank?.accountName} onCopy={() => copy(activeOrder.bank?.accountName, 'tên chủ tài khoản')} />
                  <InfoRow label="Số tiền" value={fmtVnd(order.amountVnd)} onCopy={() => copy(order.amountVnd, 'số tiền')} strong />
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-ink-500">Nội dung chuyển khoản (bắt buộc ghi đúng)</p>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-xl bg-black/30 px-3 py-2.5 font-mono text-[16px] font-bold tracking-wider text-amber-300">{order.code}</code>
                      <button onClick={() => copy(order.code, 'mã chuyển khoản')} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] text-mist-300 hover:text-brand-300" title="Sao chép mã">
                        <Copy size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {activeOrder.qrPayload && (
                <p className="break-all rounded-xl bg-[#0d111c] px-3 py-2 font-mono text-[10.5px] leading-relaxed text-ink-500">
                  {activeOrder.qrPayload}
                </p>
              )}

              <p className="flex items-center gap-1.5 text-[12px] text-mist-400">
                <Clock size={13} className="text-amber-300" />
                {orderLeft != null && orderLeft > 0
                  ? <>Còn <b className="text-white">{fmtCountdown(orderLeft)}</b> để thanh toán — quá hạn đơn sẽ tự hủy.</>
                  : 'Đơn đã hết hạn thanh toán.'}
              </p>
              <p className="text-[11.5px] leading-relaxed text-mist-400">
                Chuyển khoản đúng số tiền và đúng nội dung trên — hệ thống tự kiểm tra mỗi 20 giây và kích hoạt VIP ngay khi tiền về, không cần chờ admin duyệt.
              </p>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => refreshOrder(order.id)} loading={checking}>
                  <RefreshCw size={13} /> Kiểm tra thanh toán
                </Button>
                <Button variant="outline" onClick={cancel} loading={canceling} className="border-rose-500/40 text-rose-300 hover:border-rose-500/70">
                  <X size={13} /> Hủy đơn
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- lịch sử đơn VIP ---------- */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-mist-200">Lịch sử đơn VIP</h2>
          <Button variant="outline" size="sm" onClick={() => load()} loading={loading}>
            <RefreshCw size={12} /> Làm mới
          </Button>
        </div>
        {orders.length === 0 ? (
          <Empty icon={Crown} title="Chưa có đơn VIP nào" desc="Chọn gói ở trên và bấm Mua VIP để tạo đơn đầu tiên." />
        ) : (
          <div className="space-y-1.5">
            {orders.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-ink-900 px-3 py-2.5">
                <code className="font-mono text-[12.5px] font-semibold tracking-wider text-amber-300">{o.code}</code>
                <span className="text-[12.5px] tabular-nums text-mist-200">{fmtVnd(o.amountVnd)}</span>
                <span className="text-[11px] text-ink-500">{fmtTime(o.createdAt)}</span>
                <span className="ml-auto flex items-center gap-2">
                  <OrderBadge status={o.status} />
                  {o.status === 'pending' && (
                    <button
                      onClick={async () => { try { setActiveOrder(await api.vipOrder(o.id)); } catch (e) { toast(e.message, 'error'); } }}
                      className="rounded-lg border border-brand-500/40 px-2.5 py-1 text-[11.5px] text-brand-300 hover:bg-brand-500/10"
                    >
                      Xem & thanh toán
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OrderBadge({ status }) {
  const [tone, label] = ORDER_STATUS[status] || ['neutral', status || '—'];
  return <Badge tone={tone}>{label}</Badge>;
}

function InfoRow({ label, value, mono, strong, onCopy }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-500">{label}</span>
      <button
        onClick={onCopy}
        title={onCopy ? 'Bấm để sao chép' : undefined}
        className={clsx(
          'min-w-0 truncate text-right',
          mono ? 'font-mono' : '',
          strong ? 'font-semibold text-white' : 'text-mist-200',
          onCopy && 'hover:text-brand-300'
        )}
      >
        {value}
      </button>
    </div>
  );
}
