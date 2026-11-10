import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, ArrowRight, Gift, Zap, Film, Layers } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../store/auth.jsx';
import { Button, Field, Input, useToast } from '../components/ui.jsx';

const HIGHLIGHTS = [
  { icon: Film, title: 'Video từ văn bản · Video từ hình ảnh', desc: 'Một câu lệnh tạo video 5–10 giây, hỗ trợ khung hình đầu/cuối và ảnh tham khảo' },
  { icon: Layers, title: 'Canvas vô hạn · Luồng công việc dạng node', desc: 'Kéo thả node để nối quy trình tạo, tự động lưu' },
  { icon: Zap, title: 'Kho tài khoản · Tự động điều phối', desc: 'Luân chuyển và gia hạn nhiều tài khoản, thất bại tự động hoàn điểm' },
];

export default function Login() {
  const { login, register } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const ref = params.get('ref') || '';
  const [mode, setMode] = useState(ref ? 'register' : 'login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await login(form.email.trim(), form.password);
        toast('Chào mừng bạn trở lại', 'ok');
      } else {
        await register(form.email.trim(), form.password, form.name.trim() || undefined, ref || undefined);
        toast(ref ? 'Đăng ký thành công, phần thưởng mời đã được cộng' : 'Đăng ký thành công, đã tặng điểm', 'ok');
      }
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-bg flex h-full items-center justify-center overflow-hidden px-4 py-10">
      <div className="relative grid w-full max-w-[1000px] gap-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-center">
        {/* ---------------- 左：品牌 ---------------- */}
        <div className="hidden lg:block">
          <div className="flex items-baseline gap-1">
            <span className="font-display text-[36px] font-extrabold italic leading-none tracking-tight text-white">Muse</span>
            <span className="font-display text-[36px] font-extrabold leading-none tracking-tighter text-white">API</span>
            <span className="mb-3 text-[13px] font-semibold uppercase tracking-[0.1em] text-brand-400">-Video</span>
          </div>

          <h1 className="mt-6 text-[30px] font-semibold leading-tight tracking-tight text-white">
            Biến một câu nói<br />
            thành<span className="brand-text"> video dùng được ngay</span>
          </h1>
          <p className="mt-3 max-w-md text-[13px] leading-relaxed text-mist-400">
            Nền tảng sáng tạo gói gọn khả năng tài khoản muse.ai — tạo video, canvas vô hạn và kho tài khoản trong một nơi.
          </p>

          <div className="mt-8 space-y-3">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="flex items-start gap-3">
                <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#1e2432] bg-[#0d1119] text-brand-400">
                  <h.icon size={15} strokeWidth={1.8} />
                </div>
                <div>
                  <p className="text-[13px] font-medium text-mist-200">{h.title}</p>
                  <p className="mt-0.5 text-[11.5px] text-mist-400">{h.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-8 font-mono text-[10px] tracking-[0.2em] text-ink-500">
            MUSE.AI · ACCOUNT POOL · VIDEO GENERATION
          </p>
        </div>

        {/* ---------------- 右：表单 ---------------- */}
        <div className="w-full">
          {/* 移动端 logo */}
          <div className="mb-7 flex items-baseline justify-center gap-1 lg:hidden">
            <span className="font-display text-[24px] font-extrabold italic text-white">Muse</span>
            <span className="font-display text-[24px] font-extrabold text-white">API</span>
            <span className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-brand-400">-Video</span>
          </div>

          <div className="rounded-2xl border border-[#1a2030] bg-[#0b0f17]/80 p-6 backdrop-blur-xl">
            <div className="mb-5 flex rounded-xl bg-ink-900 p-1">
              {[
                ['login', 'Đăng nhập'],
                ['register', 'Đăng ký'],
              ].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => { setMode(k); setErr(''); }}
                  className={clsx(
                    'flex-1 rounded-lg py-2 text-[13px] font-medium transition',
                    mode === k ? 'bg-[#182030] text-white shadow-sm' : 'text-mist-400 hover:text-mist-200'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-3.5">
              {ref && (
                <div className="flex items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-[11.5px] text-brand-300">
                  <Gift size={13} /> Bạn được mời đăng ký, sau khi hoàn tất cả hai bên đều nhận 50 điểm
                </div>
              )}

              {mode === 'register' && (
                <Field label="Tên hiển thị">
                  <Input value={form.name} onChange={set('name')} placeholder="Đặt tên gì cũng được" />
                </Field>
              )}

              <Field label="Email">
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={set('email')}
                  placeholder="you@example.com"
                  autoComplete="username"
                />
              </Field>

              <Field label="Mật khẩu" hint={mode === 'register' ? 'Ít nhất 6 ký tự' : undefined}>
                <Input
                  type="password"
                  required
                  value={form.password}
                  onChange={set('password')}
                  placeholder={mode === 'register' ? 'Ít nhất 6 ký tự' : 'Nhập mật khẩu'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </Field>

              {err && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-300">
                  {err}
                </div>
              )}

              <Button type="submit" size="lg" loading={loading} className="w-full">
                {mode === 'login' ? 'Vào bàn làm việc' : 'Đăng ký và bắt đầu'}
                {!loading && <ArrowRight size={16} />}
              </Button>
            </form>

            <p className="mt-4 flex items-center justify-center gap-1.5 text-[10.5px] text-ink-500">
              <Sparkles size={11} /> Lần đầu sử dụng, hãy liên kết tài khoản muse.ai trong mục «Nhập Muse» trước
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
