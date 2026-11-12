import { useEffect, useState } from 'react';
import { Users, UserPlus, Send, Loader2, Copy, CheckCircle2, Crown, UserCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtTime } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';

export default function Team() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => {
    api.team().then(setData).catch((e) => toast(e.message, 'error'));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  const transfer = async () => {
    if (!email.trim()) return toast('Hãy nhập email của người nhận', 'error');
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return toast('Hãy nhập số điểm hợp lệ', 'error');
    setBusy(true);
    try {
      await api.transferCredits(email.trim(), n);
      await refresh();
      setEmail(''); setAmount('');
      toast(`Đã tặng ${n} điểm`, 'ok');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(data.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      toast('Đã sao chép mã mời', 'ok');
    } catch {
      toast('Sao chép thất bại', 'error');
    }
  };

  if (!data) {
    return <div className="grid h-full place-items-center text-brand-400"><Loader2 size={22} className="animate-spin" /></div>;
  }

  return (
    <div className="mx-auto max-w-[1000px] px-8 pb-20 pt-6">
      <p className="eyebrow">Team</p>
      <h1 className="mt-2 flex items-center gap-2.5 text-[30px] font-semibold tracking-tight text-white">
        <Users size={24} className="text-brand-400" strokeWidth={1.6} />
        Chế độ nhóm
      </h1>
      <p className="mt-1.5 text-[12.5px] text-mist-400">Mời thành viên tham gia, chia sẻ điểm và cộng tác</p>

      {/* 统计 */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          ['Thành viên trực tiếp', data.stats.direct, UserCheck],
          ['Thành viên cấp 2', data.stats.second, Users],
          ['Điểm từ lời mời', data.stats.creditsEarned, Crown],
        ].map(([label, value, Icon]) => (
          <div key={label} className="card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-mist-400">{label}</span>
              <Icon size={14} className="text-brand-400" />
            </div>
            <p className="mt-1.5 font-display text-[26px] font-bold leading-none text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* 成员列表 */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1e2432] px-4 py-3">
            <h2 className="text-[13.5px] font-semibold text-mist-200">Thành viên nhóm（{data.members.length}）</h2>
            <button className="flex items-center gap-1 text-[11.5px] text-brand-400 hover:text-brand-300">
              <UserPlus size={12} /> Mời thành viên
            </button>
          </div>

          {data.members.length === 0 ? (
            <div className="grid place-items-center py-16 text-center">
              <Users size={26} className="text-mist-400/50" />
              <p className="mt-2 text-[12.5px] text-mist-300">Chưa có thành viên nhóm</p>
              <p className="mt-0.5 text-[11.5px] text-mist-400">Gửi mã mời cho bạn bè, sau khi đăng ký sẽ tự động vào nhóm</p>
            </div>
          ) : (
            <div className="divide-y divide-[#141922]">
              {data.members.map((m) => (
                <div key={m.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#1b2230] text-[12px] text-mist-300">
                      {(m.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="text-[12.5px] text-mist-200">{m.name}</p>
                        <span className={clsx(
                          'rounded px-1 py-0.5 text-[9.5px]',
                          m.level === 1 ? 'bg-brand-500/15 text-brand-300' : 'bg-[#2a3040] text-mist-300'
                        )}>
                          {m.level === 1 ? 'Trực tiếp' : 'Cấp 2'}
                        </span>
                      </div>
                      <p className="font-mono text-[10px] text-ink-500">{m.email}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[11.5px] text-gold-400">{m.credits}</p>
                    <p className="text-[9.5px] text-ink-500">{fmtTime(m.joinedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 转赠 */}
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-mist-200">
              <Send size={13} className="text-brand-400" /> Tặng điểm
            </h3>
            <p className="mb-3 text-[11px] text-mist-400">Số dư hiện tại <span className="font-mono text-gold-400">{user?.credits?.toLocaleString()}</span></p>

            <div className="space-y-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email đăng ký của người nhận"
                className="h-9 w-full rounded-lg border border-[#1e2432] bg-ink-900 px-3 text-[12px] text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/50"
              />
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="Số điểm"
                className="h-9 w-full rounded-lg border border-[#1e2432] bg-ink-900 px-3 font-mono text-[12px] text-mist-100 outline-none placeholder:text-mist-400/60 focus:border-brand-500/50"
              />
              <button
                onClick={transfer}
                disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg brand-gradient py-2 text-[12px] font-medium text-white disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Xác nhận tặng
              </button>
            </div>
          </div>

          <div className="card p-4">
            <h3 className="mb-1.5 text-[13px] font-semibold text-mist-200">Mã mời nhóm</h3>
            <div className="flex items-center gap-2 rounded-lg bg-ink-900 px-3 py-2">
              <span className="flex-1 font-mono text-[13px] tracking-wider text-brand-300">{data.inviteCode}</span>
              <button onClick={copyCode} className="text-mist-400 hover:text-white">
                {copied ? <CheckCircle2 size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-mist-400">
              Thành viên đăng ký bằng cùng mã mời sẽ tự động thuộc về bạn; tài khoản đã có có thể nhập qua "Tham gia nhóm".
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
