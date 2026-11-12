import { useEffect, useState } from 'react';
import { Wallet, Loader2, CheckCircle2, Zap, Copy, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtTime } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';

const PRESETS = [10, 30, 50, 100, 200, 500];

export default function Recharge() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [amount, setAmount] = useState(50);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState([]);
  const [done, setDone] = useState(null);

  const loadOrders = () => {
    api.orders().then((d) => setOrders(d.orders || [])).catch(() => {});
  };
  useEffect(loadOrders, []);

  const value = custom ? Number(custom) : amount;
  const credits = Math.round((Number.isFinite(value) ? value : 0) * 10);

  const submit = async () => {
    if (!Number.isFinite(value) || value <= 0) return toast('Hãy nhập số tiền nạp hợp lệ', 'error');
    setBusy(true);
    try {
      const out = await api.recharge(value);
      setDone(out);
      await refresh();
      loadOrders();
      toast(`Đã nhận ${out.order.credits} điểm`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-20 pt-6">
      <p className="eyebrow">Account</p>
      <h1 className="mt-2 flex items-center gap-2.5 text-[30px] font-semibold tracking-tight text-white">
        <Wallet size={24} className="text-brand-400" strokeWidth={1.6} />
        Nạp tiền tài khoản
      </h1>
      <p className="mt-1.5 text-[12.5px] text-mist-400">1 tệ = 10 điểm, điểm dùng để sáng tạo trên trang và gọi API</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* 充值面板 */}
        <div className="card p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <span className="text-[13px] font-medium text-mist-200">Chọn số tiền nạp</span>
            <span className="text-[11.5px] text-mist-400">
              Số dư hiện tại <span className="font-mono text-brand-300">{user?.credits?.toLocaleString() ?? 0}</span>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {PRESETS.map((a) => (
              <button
                key={a}
                onClick={() => { setAmount(a); setCustom(''); }}
                className={clsx(
                  'rounded-xl border p-3 text-left transition',
                  !custom && amount === a
                    ? 'border-brand-500/60 bg-brand-500/10'
                    : 'border-[#1e2432] hover:border-[#2c3448]'
                )}
              >
                <p className="font-display text-[20px] font-bold leading-none text-white">¥{a}</p>
                <p className="mt-1 font-mono text-[10.5px] text-mist-400">{a * 10} điểm</p>
              </button>
            ))}
          </div>

          <div className="mt-3">
            <label className="mb-1.5 block text-[11.5px] text-mist-400">Số tiền tùy chỉnh (tệ)</label>
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="Nạp số tiền lớn hãy liên hệ hỗ trợ qua WeChat"
              className="h-10 w-full rounded-xl border border-[#1e2432] bg-ink-900 px-3.5 text-[13px] text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/50"
            />
          </div>

          <div className="mt-4 rounded-xl border border-[#1e2432] bg-ink-900/60 p-3.5">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-mist-400">Dự kiến nhận</span>
              <span className="font-mono text-[15px] font-semibold text-gold-400">{credits} điểm</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11.5px]">
              <span className="text-mist-400">Số tiền thanh toán</span>
              <span className="font-mono text-mist-200">¥{Number.isFinite(value) ? value : 0}</span>
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[12.5px] font-medium text-mist-200">Phương thức thanh toán</p>
            <div className="flex items-center gap-2 rounded-xl border border-brand-500/40 bg-brand-500/[0.07] px-3.5 py-2.5">
              <span className="grid h-6 w-6 place-items-center rounded bg-[#1677ff] text-[10px] font-bold text-white">支</span>
              <div className="flex-1">
                <p className="text-[12.5px] text-mist-100">Thanh toán Alipay</p>
                <p className="text-[10.5px] text-mist-400">Giao dịch đảm bảo Alipay · An toàn tiền</p>
              </div>
              <CheckCircle2 size={15} className="text-brand-400" />
            </div>
          </div>

          <button
            onClick={submit}
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full brand-gradient py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-brand-600/25 transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            Xác nhận nạp ¥{Number.isFinite(value) ? value : 0}
          </button>

          <p className="mt-2.5 flex items-center justify-center gap-1 text-[10.5px] text-mist-400">
            <ShieldCheck size={11} /> Môi trường tự vận hành: đặt hàng xong nhận ngay (không có kênh thanh toán bên thứ ba)
          </p>
        </div>

        {/* 右栏 */}
        <div className="space-y-4">
          {done && (
            <div className="card border-brand-500/30 p-4">
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-brand-300">
                <CheckCircle2 size={14} /> Nạp thành công
              </p>
              <p className="mt-2 text-[11.5px] text-mist-400">Mã đơn hàng</p>
              <p className="break-all font-mono text-[11px] text-mist-200">{done.order.id}</p>
              <div className="mt-2 flex items-center justify-between text-[11.5px]">
                <span className="text-mist-400">Đã nhận</span>
                <span className="font-mono text-gold-400">+{done.order.credits} điểm</span>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(done.order.id); toast('Đã sao chép mã đơn hàng', 'ok'); }}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-[#232a38] py-1.5 text-[11px] text-mist-300 hover:text-white"
              >
                <Copy size={10} /> Sao chép mã đơn hàng
              </button>
            </div>
          )}

          <div className="card p-4">
            <p className="mb-2 text-[12.5px] font-medium text-mist-200">Hướng dẫn nạp</p>
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-mist-400">
              <li>· Điểm dùng để sáng tạo trên trang và gọi API</li>
              <li>· Tác vụ thất bại sẽ tự động hoàn điểm</li>
              <li>· Nạp số tiền lớn hãy liên hệ hỗ trợ qua WeChat</li>
              <li>· Điểm không rút được, hãy nạp theo nhu cầu</li>
            </ul>
          </div>

          <div className="card p-4">
            <p className="mb-2 text-[12.5px] font-medium text-mist-200">Đơn hàng gần đây</p>
            {orders.length === 0 ? (
              <p className="py-3 text-center text-[11px] text-mist-400">Chưa có lịch sử nạp</p>
            ) : (
              <div className="space-y-1.5">
                {orders.slice(0, 5).map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-[11px]">
                    <span className="text-mist-400">{fmtTime(o.created_at)}</span>
                    <span className="font-mono text-mist-200">¥{o.amount} → {o.credits}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
