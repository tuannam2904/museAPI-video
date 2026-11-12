import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings2, Save, Loader2, LogOut, Shield, Palette, Bell, User as UserIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtTime } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../components/ui.jsx';

const TABS = [
  { key: 'profile', label: 'Hồ sơ cá nhân', icon: UserIcon },
  { key: 'security', label: 'Bảo mật tài khoản', icon: Shield },
  { key: 'prefs', label: 'Tùy chọn', icon: Palette },
];

export default function SettingsPage() {
  const { user, refresh, logout } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState('profile');

  const [name, setName] = useState(user?.name || '');
  const [savingName, setSavingName] = useState(false);

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const [theme, setTheme] = useState(() => localStorage.getItem('xm_theme') || 'dark');

  useEffect(() => { setName(user?.name || ''); }, [user?.name]);

  const saveName = async () => {
    if (!name.trim()) return toast('Tên hiển thị không được để trống', 'error');
    setSavingName(true);
    try {
      await api.updateMe({ name: name.trim() });
      await refresh();
      toast('Đã lưu', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingName(false);
    }
  };

  const savePw = async () => {
    if (newPw.length < 6) return toast('Mật khẩu mới ít nhất 6 ký tự', 'error');
    setSavingPw(true);
    try {
      await api.updateMe({ password: newPw, oldPassword: oldPw });
      setOldPw(''); setNewPw('');
      toast('Đã cập nhật mật khẩu', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSavingPw(false);
    }
  };

  const applyTheme = (mode) => {
    setTheme(mode);
    localStorage.setItem('xm_theme', mode);
    document.documentElement.classList.toggle('light', mode === 'light');
    toast(mode === 'light' ? 'Đã chuyển sang giao diện sáng (một số trang đang tương thích)' : 'Đã chuyển sang giao diện tối', 'ok');
  };

  return (
    <div className="mx-auto max-w-[900px] px-8 pb-20 pt-6">
      <p className="eyebrow">Settings</p>
      <h1 className="mt-2 flex items-center gap-2.5 text-[30px] font-semibold tracking-tight text-white">
        <Settings2 size={24} className="text-brand-400" strokeWidth={1.6} />
        Cài đặt
      </h1>
      <p className="mt-1.5 text-[12.5px] text-mist-400">Thông tin cá nhân, bảo mật tài khoản và tùy chọn</p>

      <div className="mt-6 flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              'flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[12.5px] transition',
              tab === t.key
                ? 'border-brand-500/50 bg-brand-500/10 text-brand-300'
                : 'border-[#1e2432] text-mist-300 hover:border-[#2c3448] hover:text-white'
            )}
          >
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 card p-5">
        {tab === 'profile' && (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-2xl brand-gradient text-[24px] font-bold text-white">
                {(user?.name || user?.email || '?').slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="text-[15px] font-medium text-white">{user?.name}</p>
                <p className="text-[12px] text-mist-400">{user?.email}</p>
                <p className="mt-1 font-mono text-[10.5px] text-mist-400">
                  {user?.role === 'admin' ? 'ADMIN' : 'USER'} · Đăng ký {fmtTime(user?.createdAt)}
                </p>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[12.5px] text-mist-300">Tên hiển thị</label>
              <div className="flex gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-[#1e2432] bg-ink-900 px-3.5 text-[13px] text-mist-100 outline-none focus:border-brand-500/50"
                />
                <button
                  onClick={saveName}
                  disabled={savingName}
                  className="flex items-center gap-1.5 rounded-xl brand-gradient px-4 text-[12.5px] font-medium text-white disabled:opacity-50"
                >
                  {savingName ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Lưu
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[#1e2432] bg-ink-900/50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-mist-300">Số dư điểm</span>
                <span className="font-mono text-[15px] font-semibold text-gold-400">
                  {user?.credits?.toLocaleString()}
                </span>
              </div>
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => nav('/recharge')} className="flex-1 rounded-lg border border-[#232a38] py-1.5 text-[11.5px] text-mist-200 hover:border-brand-500/50 hover:text-white">
                  Nạp điểm
                </button>
                <button onClick={() => nav('/credits')} className="flex-1 rounded-lg border border-[#232a38] py-1.5 text-[11.5px] text-mist-200 hover:border-brand-500/50 hover:text-white">
                  Chi tiết điểm
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'security' && (
          <div className="max-w-md space-y-3.5">
            <div>
              <label className="mb-1.5 block text-[12.5px] text-mist-300">Mật khẩu hiện tại</label>
              <input
                type="password"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
                placeholder="Nhập mật khẩu hiện tại"
                className="h-10 w-full rounded-xl border border-[#1e2432] bg-ink-900 px-3.5 text-[13px] text-mist-100 outline-none focus:border-brand-500/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[12.5px] text-mist-300">Mật khẩu mới</label>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Ít nhất 6 ký tự"
                className="h-10 w-full rounded-xl border border-[#1e2432] bg-ink-900 px-3.5 text-[13px] text-mist-100 outline-none focus:border-brand-500/50"
              />
            </div>
            <button
              onClick={savePw}
              disabled={savingPw}
              className="flex items-center gap-1.5 rounded-xl brand-gradient px-4 py-2 text-[12.5px] font-medium text-white disabled:opacity-50"
            >
              {savingPw ? <Loader2 size={12} className="animate-spin" /> : <Shield size={12} />} Cập nhật mật khẩu
            </button>

            <div className="mt-6 border-t border-[#1e2432] pt-4">
              <button
                onClick={() => { logout(); nav('/login'); }}
                className="flex items-center gap-1.5 rounded-xl border border-rose-500/30 px-4 py-2 text-[12.5px] text-rose-300 transition hover:bg-rose-500/10"
              >
                <LogOut size={12} /> Đăng xuất
              </button>
            </div>
          </div>
        )}

        {tab === 'prefs' && (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[12.5px] text-mist-300">Giao diện</p>
              <div className="flex gap-2">
                {[['dark', 'Tối (mặc định)'], ['light', 'Sáng']].map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => applyTheme(k)}
                    className={clsx(
                      'rounded-xl border px-4 py-2.5 text-[12.5px] transition',
                      theme === k
                        ? 'border-brand-500/50 bg-brand-500/10 text-brand-300'
                        : 'border-[#1e2432] text-mist-300 hover:border-[#2c3448]'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-mist-300">
                <Bell size={12} /> Thông báo
              </p>
              <div className="space-y-2">
                {['Nhắc khi tác vụ xong', 'Nhắc khi điểm thay đổi', 'Thông báo phiên bản mới'].map((label) => (
                  <label key={label} className="flex items-center justify-between rounded-lg border border-[#1e2432] px-3.5 py-2.5">
                    <span className="text-[12.5px] text-mist-200">{label}</span>
                    <input type="checkbox" defaultChecked className="accent-brand-500" />
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
