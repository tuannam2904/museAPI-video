import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Sparkles, Workflow, Clapperboard, KeyRound, LogOut, ShieldCheck, Film } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../store/auth.jsx';

/** 侧栏入口：快捷创作 / 无限画布 / Film Studio / 作品 / muse 导入 / 管理（仅 admin） */
const NAV = [
  { to: '/create', label: 'Tạo nhanh', icon: Sparkles },
  { to: '/canvas', label: 'Canvas vô hạn', icon: Workflow },
  { to: '/film-studio', label: 'Film Studio', icon: Clapperboard },
  { to: '/works', label: 'Tác phẩm', icon: Film },
  { to: '/accounts', label: 'Nhập Muse', icon: KeyRound },
];
const ADMIN_NAV = { to: '/admin', label: 'Quản trị', icon: ShieldCheck };

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();
  const items = user?.role === 'admin' ? [...NAV, ADMIN_NAV] : NAV;

  return (
    <div className="relative flex h-full overflow-hidden bg-ink-900">
      {/* ---------------- 细侧栏 ---------------- */}
      <aside className="relative z-20 flex w-[84px] shrink-0 flex-col items-center border-r border-white/[0.05] bg-[#0b0f19] py-4">
        <button
          onClick={() => nav('/create')}
          title="MuseAPI-Video"
          className="mint-btn grid h-11 w-11 place-items-center rounded-2xl"
        >
          <Sparkles size={20} strokeWidth={2.2} />
        </button>

        <nav className="mt-8 flex w-full flex-col items-center gap-1.5 px-2">
          {items.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-2">
          <span
            title={`${user?.name || 'Chưa đặt tên'} · ${user?.email || ''}`}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-[#161c2c] text-[12px] font-semibold text-mist-100"
          >
            {initial}
          </span>
          <button
            onClick={logout}
            title="Đăng xuất"
            className="grid h-8 w-8 place-items-center rounded-lg text-mist-400 transition hover:bg-white/5 hover:text-rose-400"
          >
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {/* ---------------- 主区 ---------------- */}
      <main className="page-bg min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, label, icon: Icon }) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        clsx(
          'group relative flex w-full flex-col items-center gap-1 rounded-2xl py-2.5 transition',
          isActive ? 'bg-brand-500/[0.12] text-white' : 'text-mist-400 hover:bg-white/[0.04] hover:text-mist-100'
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute -left-2 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full bg-brand-400 shadow-[0_0_10px_rgba(79,227,193,.8)]" />
          )}
          <Icon size={19} strokeWidth={1.8} className={isActive ? 'text-brand-300' : ''} />
          <span className="text-[11px] font-medium tracking-wide">{label}</span>
        </>
      )}
    </NavLink>
  );
}
