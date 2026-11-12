import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './store/auth.jsx';
import { ToastProvider, Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Create from './pages/Create.jsx';
import Canvas from './pages/Canvas.jsx';
import BatchVideo from './pages/BatchVideo.jsx';
import Characters from './pages/Characters.jsx';
import Accounts from './pages/Accounts.jsx';
import FilmStudio from './pages/FilmStudio.jsx';
import Works from './pages/Works.jsx';
import Admin from './pages/Admin.jsx';
import Bind from './pages/Bind.jsx';

function Boot() {
  return <div className="grid h-full place-items-center bg-ink-900 text-brand-400"><Spinner size={26} /></div>;
}

function Guard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Boot />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Chỉ quản trị viên mới vào được trang Quản trị.
function AdminGuard({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Boot />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/create" replace />;
  return children;
}

/**
 * 功能入口：快捷创作 / 无限画布 / Film Studio / muse 账号导入。
 * 其余页面（首页、论坛、价目表、会员、邀请、团队、API 平台、设置、历史）已下线，
 * 源码文件仍保留在 web/src/pages 下，需要时可重新接回路由。
 */
export default function App() {
  const { user, loading } = useAuth();

  return (
    <ToastProvider>
      <Routes>
        <Route
          path="/login"
          element={loading ? <Boot /> : user ? <Navigate to="/create" replace /> : <Login />}
        />
        <Route
          path="/bind/:code"
          element={
            <Guard>
              <Bind />
            </Guard>
          }
        />

        <Route
          element={
            <Guard>
              <Layout />
            </Guard>
          }
        >
          <Route path="/create" element={<Create />} />
          <Route path="/canvas" element={<Canvas />} />
          <Route path="/batch-video" element={<BatchVideo />} />
          <Route path="/characters" element={<Characters />} />
          <Route path="/film-studio" element={<FilmStudio />} />
          <Route path="/works" element={<Works />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/admin" element={<AdminGuard><Admin /></AdminGuard>} />
        </Route>

        <Route path="*" element={<Navigate to={user ? '/create' : '/login'} replace />} />
      </Routes>
    </ToastProvider>
  );
}
