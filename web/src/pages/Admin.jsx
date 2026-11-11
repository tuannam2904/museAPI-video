import { useCallback, useEffect, useState } from 'react';
import {
  Users, Film, CheckCircle2, XCircle, Loader2, Cpu, Wallet, Settings2,
  RefreshCw, Search, Plus, Minus, ShieldOff, ShieldCheck, Save, Zap, MessageSquare, Trash2, TrendingUp,
  HardDrive, UserPlus, Crown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo, fmtTime } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { Badge, Button, Field, Input, Select, useToast, Spinner, Empty } from '../components/ui.jsx';

const TABS = [
  ['overview', 'Tổng quan', Cpu],
  ['users', 'Người dùng', Users],
  ['orders', 'Đơn hàng', Wallet],
  ['posts', 'Cộng đồng', MessageSquare],
  ['settings', 'Cài đặt', Settings2],
];

export default function Admin() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="p-5 lg:p-7">
      <div className="mb-5 flex gap-1.5 rounded-xl bg-ink-850 p-1 w-fit">
        {TABS.map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition',
              tab === k ? 'bg-ink-700 text-white shadow-sm' : 'text-mist-400 hover:text-mist-200'
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'orders' && <OrdersPanel />}
      {tab === 'posts' && <PostsPanel />}
      {tab === 'settings' && <SettingsPanel />}
    </div>
  );
}

/* ------------------------------- Tổng quan ------------------------------- */
function Overview() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [sys, setSys] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ka, setKa] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, s] = await Promise.all([api.adminOverview(), api.adminSystem().catch((e) => ({ error: e.message }))]);
      setData(ov);
      setSys(s);
      api.adminTrend().then((t) => setTrend(t.days || [])).catch(() => {});
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const keepalive = async () => {
    setKa(true);
    try {
      const out = await api.adminKeepalive();
      const okN = out.results.filter((r) => r.ok).length;
      toast(`Bảo trì xong: ${okN}/${out.results.length} thành công`, okN ? 'ok' : 'error');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setKa(false);
    }
  };

  if (loading && !data) {
    return <div className="grid place-items-center py-24 text-brand-400"><Spinner size={22} /></div>;
  }

  const s = data?.stats || {};
  const cards = [
    ['Người dùng', s.users, Users, 'text-brand-300'],
    ['Tổng tác vụ', s.jobs, Film, 'text-mist-200'],
    ['Đã xong', s.done, CheckCircle2, 'text-emerald-300'],
    ['Thất bại', s.failed, XCircle, 'text-rose-300'],
    ['Đang chạy', s.running, Loader2, 'text-amber-300'],
    ['Số tài khoản', s.accounts, ShieldCheck, 'text-violet-300'],
  ];

  const up = sys?.upstream;
  const st = up?.stats || {};

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {cards.map(([label, val, Icon, color]) => (
          <div key={label} className="card p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-mist-400">{label}</span>
              <Icon size={13} className={color} />
            </div>
            <p className="mt-1.5 text-xl font-semibold tabular-nums text-white">{val ?? 0}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Trạng thái upstream */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-[13.5px] font-semibold text-mist-200">
              <Cpu size={14} className="text-brand-400" /> Engine upstream muse2api
            </h3>
            <Button variant="outline" size="sm" onClick={load} loading={loading}>
              <RefreshCw size={12} /> Làm mới
            </Button>
          </div>

          {sys?.error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-300">
              Không kết nối được upstream：{sys.error}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <Row label="Tiến trình trình duyệt" value={up?.browser_running ? 'Đang chạy' : 'Nhàn rỗi'} tone={up?.browser_running ? 'ok' : 'neutral'} />
                <Row label="Tài khoản khả dụng" value={`${st.healthy ?? 0} / ${st.total ?? 0}`} />
                <Row label="Tài khoản lỗi" value={st.error ?? 0} tone={st.error ? 'error' : 'neutral'} />
                <Row label="File media" value={up?.media_count ?? 0} />
              </div>
              <div className="mt-3 rounded-lg bg-ink-900 px-3 py-2 text-[11.5px] text-mist-400">
                <p>Timeout video {up?.config?.video_timeout}s · Timeout ảnh {up?.config?.image_timeout}s</p>
                <p className="mt-0.5">Cổng CDP {up?.config?.cdp_port}</p>
              </div>
              <Button
                variant="soft"
                size="sm"
                className="mt-3 w-full"
                loading={ka}
                onClick={keepalive}
              >
                <Zap size={12} /> Bảo trì toàn bộ (gia hạn phiên)
              </Button>
            </>
          )}
        </div>

        {/* Tác vụ gần đây */}
        <div className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold text-mist-200">
            <Wallet size={14} className="text-brand-400" /> Tác vụ gần đây
          </h3>
          <div className="space-y-1.5">
            {(data?.recent || []).length === 0 && (
              <p className="py-6 text-center text-[12.5px] text-ink-500">Chưa có tác vụ nào</p>
            )}
            {(data?.recent || []).map((j) => (
              <div key={j.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-900 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-mist-300">{j.prompt}</span>
                <Badge
                  tone={j.status === 'completed' ? 'ok' : j.status === 'failed' ? 'error' : 'brand'}
                >
                  {j.status === 'completed' ? 'Xong' : j.status === 'failed' ? 'Thất bại' : 'Đang chạy'}
                </Badge>
                <span className="shrink-0 text-[10.5px] text-ink-500">{fmtAgo(j.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Video đã tạo" value={s.videos ?? 0} />
        <MiniStat label="Ảnh đã tạo" value={s.images ?? 0} />
        <MiniStat label="Tổng điểm người dùng" value={s.credits ?? 0} />
        <MiniStat label="Đã tiêu thụ" value={s.consumed ?? 0} />
      </div>

      {/* 7 ngày gần đây */}
      <div className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold text-mist-200">
          <TrendingUp size={14} className="text-brand-400" /> 7 ngày gần đây
        </h3>
        {trend.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-ink-500">Chưa có dữ liệu</p>
        ) : (
          <div className="flex items-end justify-between gap-2">
            {trend.map((d) => {
              const max = Math.max(1, ...trend.map((x) => x.jobs));
              const h = Math.max(4, Math.round((d.jobs / max) * 72));
              return (
                <div key={d.date} className="flex flex-1 flex-col items-center gap-1.5">
                  <span className="font-mono text-[10px] text-mist-300">{d.jobs || ''}</span>
                  <div
                    className="w-full max-w-[34px] rounded-t-md bg-gradient-to-t from-brand-600/40 to-brand-400 transition-all"
                    style={{ height: `${h}px` }}
                    title={`${d.jobs} tác vụ · ${d.credits} điểm`}
                  />
                  <span className="font-mono text-[9.5px] text-ink-500">{d.date}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, tone = 'neutral' }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-ink-900 px-2.5 py-1.5">
      <span className="text-ink-500">{label}</span>
      {tone === 'neutral' ? (
        <span className="font-medium text-mist-200">{value}</span>
      ) : (
        <Badge tone={tone}>{value}</Badge>
      )}
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="card px-3.5 py-3">
      <p className="text-[11px] text-mist-400">{label}</p>
      <p className="mt-1 text-[17px] font-semibold tabular-nums text-white">{value.toLocaleString()}</p>
    </div>
  );
}

/* ------------------------------- Người dùng ------------------------------- */
function UsersPanel() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'user' });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (query) => {
    setLoading(true);
    try {
      const out = await api.adminUsers(query);
      setUsers(out.users);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(''); }, [load]);

  const patch = async (id, body, msg) => {
    try {
      const out = await api.adminPatchUser(id, body);
      setUsers((l) => l.map((u) => (u.id === id ? out.user : u)));
      toast(msg, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const create = async () => {
    if (!form.email.includes('@')) return toast('Email không hợp lệ', 'error');
    if (form.password.length < 6) return toast('Mật khẩu ít nhất 6 ký tự', 'error');
    setCreating(true);
    try {
      const out = await api.adminCreateUser(form);
      setUsers((l) => [out.user, ...l]);
      setForm({ email: '', password: '', name: '', role: 'user' });
      setCreateOpen(false);
      toast('Đã tạo user', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const recharge = (u) => {
    const v = prompt(`Cộng/trừ điểm cho ${u.email} (số âm là trừ)`, '100');
    if (!v) return;
    const n = Number(v);
    if (!Number.isFinite(n) || n === 0) return toast('Nhập số khác 0', 'error');
    patch(u.id, { credits: n }, n > 0 ? `Đã cộng ${n} điểm` : `Đã trừ ${-n} điểm`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(q)}
            placeholder="Tìm email…"
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="md" onClick={() => load(q)} loading={loading}>Tìm</Button>
        <Button size="md" onClick={() => setCreateOpen((v) => !v)}>
          <UserPlus size={14} /> Tạo user mới
        </Button>
      </div>

      {createOpen && (
        <div className="card space-y-3 p-4">
          <p className="text-[13px] font-medium text-mist-200">Tạo tài khoản mới (user đăng nhập bằng email + mật khẩu này)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email">
              <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="user@example.com" />
            </Field>
            <Field label="Mật khẩu (≥ 6 ký tự)">
              <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="••••••" />
            </Field>
            <Field label="Tên hiển thị">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Để trống = lấy từ email" />
            </Field>
            <Field label="Vai trò">
              <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                <option value="user">Người dùng</option>
                <option value="admin">Quản trị viên</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Hủy</Button>
            <Button onClick={create} loading={creating}>Tạo tài khoản</Button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Người dùng</th>
                <th className="px-3 py-2.5 font-medium">Vai trò</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-3 py-2.5 text-right font-medium">Điểm</th>
                <th className="px-3 py-2.5 font-medium">Đăng ký</th>
                <th className="px-4 py-2.5 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-mist-200">{u.name}</p>
                    <p className="text-[11px] text-ink-500">{u.email}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.status === 'active' ? 'ok' : 'error'}>{u.status === 'active' ? 'Bình thường' : 'Đã cấm'}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-amber-300">{u.credits}</td>
                  <td className="px-3 py-2.5 text-[11px] text-ink-500">{fmtTime(u.createdAt)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => recharge(u)}
                        className="rounded-md border border-ink-600 p-1.5 text-mist-300 hover:border-brand-500/60 hover:text-brand-300"
                        title="Cộng/trừ điểm"
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        onClick={() => patch(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }, u.role === 'admin' ? 'Đã hạ xuống user' : 'Đã nâng lên admin')}
                        disabled={u.id === me?.id}
                        className="rounded-md border border-ink-600 p-1.5 text-mist-300 hover:border-brand-500/60 hover:text-brand-300 disabled:opacity-30"
                        title={u.id === me?.id ? 'Không đổi role của chính mình' : (u.role === 'admin' ? 'Hạ xuống user' : 'Nâng lên admin')}
                      >
                        <Crown size={12} />
                      </button>
                      <button
                        onClick={() => patch(u.id, { status: u.status === 'active' ? 'banned' : 'active' }, u.status === 'active' ? 'Đã cấm' : 'Đã mở cấm')}
                        className={clsx(
                          'rounded-md border p-1.5',
                          u.status === 'active'
                            ? 'border-ink-600 text-mist-300 hover:border-rose-500/60 hover:text-rose-300'
                            : 'border-ink-600 text-rose-300 hover:border-emerald-500/60 hover:text-emerald-300'
                        )}
                        title={u.status === 'active' ? 'Cấm' : 'Mở cấm'}
                      >
                        {u.status === 'active' ? <ShieldOff size={12} /> : <ShieldCheck size={12} />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {users.length === 0 && !loading && <Empty icon={Users} title="Chưa có người dùng" />}
      </div>
    </div>
  );
}

/* ------------------------------- Đơn hàng ------------------------------- */
function OrdersPanel() {
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [kind, setKind] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (k) => {
    setLoading(true);
    try {
      const out = await api.adminOrders(k);
      setOrders(out.orders || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(''); }, [load]);

  const total = orders.filter((o) => o.status === 'paid').reduce((s, o) => s + (o.amount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[['', 'Tất cả'], ['recharge', 'Nạp điểm'], ['membership', 'Gói đăng ký']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => { setKind(k); load(k); }}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-[12px] transition',
              kind === k ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-[#1e2432] text-mist-300 hover:text-white'
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[12px] text-mist-400">
          Đã thanh toán tổng cộng <span className="font-mono text-gold-400">¥{total.toFixed(2)}</span>
        </span>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Mã đơn</th>
                <th className="px-3 py-2.5 font-medium">Người dùng</th>
                <th className="px-3 py-2.5 font-medium">Loại</th>
                <th className="px-3 py-2.5 text-right font-medium">Số tiền</th>
                <th className="px-3 py-2.5 text-right font-medium">Điểm</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-4 py-2.5 font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-2.5 font-mono text-[11px] text-mist-300">{o.id}</td>
                  <td className="px-3 py-2.5 text-[11.5px] text-mist-300">{o.email || '—'}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={o.kind === 'recharge' ? 'brand' : 'warn'}>
                      {o.kind === 'recharge' ? 'Nạp điểm' : 'Gói đăng ký'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-mist-100">¥{o.amount}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-gold-400">+{o.credits}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={o.status === 'paid' ? 'ok' : 'neutral'}>
                      {o.status === 'paid' ? 'Đã thanh toán' : o.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-[11px] text-ink-500">{fmtTime(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && !loading && <Empty icon={Wallet} title="Chưa có đơn hàng" />}
      </div>
    </div>
  );
}

/* ------------------------------- Cộng đồng ------------------------------- */
function PostsPanel() {
  const toast = useToast();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.adminPosts();
      setPosts(out.posts || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const remove = async (p) => {
    if (!confirm(`Xóa bài viết "${p.title}"?`)) return;
    try {
      await api.adminDeletePost(p.id);
      setPosts((l) => l.filter((x) => x.id !== p.id));
      toast('Đã xóa', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-700 px-4 py-3">
        <h3 className="text-[13px] font-semibold text-mist-200">Bài viết cộng đồng ({posts.length})</h3>
      </div>
      {loading ? (
        <div className="grid place-items-center py-16 text-brand-400"><Spinner size={18} /></div>
      ) : posts.length === 0 ? (
        <Empty icon={MessageSquare} title="Chưa có bài viết" />
      ) : (
        <div className="divide-y divide-ink-800">
          {posts.map((p) => (
            <div key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-mist-200">{p.title}</p>
                <p className="mt-0.5 line-clamp-1 text-[11.5px] text-mist-400">{p.content}</p>
                <p className="mt-1 font-mono text-[10px] text-ink-500">
                  {p.email} · {p.category} · ♥{p.likes} · {p.reply_count} trả lời · {fmtTime(p.created_at)}
                </p>
              </div>
              <button onClick={() => remove(p)} className="shrink-0 rounded p-1.5 text-mist-400 hover:text-rose-400">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Cài đặt ------------------------------- */
function SettingsPanel() {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [media, setMedia] = useState(null);
  const [cleaning, setCleaning] = useState(false);

  useEffect(() => {
    api.adminSettings().then((r) => setSettings(r.settings)).catch((e) => toast(e.message, 'error'));
    api.adminMediaStats().then(setMedia).catch(() => {});
  }, [toast]);

  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const out = await api.adminSaveSettings(settings);
      setSettings(out.settings);
      toast('Đã lưu', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const cleanupNow = async () => {
    setCleaning(true);
    try {
      const out = await api.adminMediaCleanup();
      setMedia(out);
      toast(out.deleted?.length ? `Đã dọn ${out.deleted.length} file, giải phóng ${out.freedMB} MB` : 'Không có file nào cần dọn', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCleaning(false);
    }
  };

  if (!settings) return <div className="grid place-items-center py-24 text-brand-400"><Spinner size={20} /></div>;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card p-5">
        <h3 className="mb-4 text-[13.5px] font-semibold text-mist-200">Trang web</h3>
        <div className="space-y-3.5">
          <Field label="Tên trang">
            <Input value={settings.siteName} onChange={set('siteName')} />
          </Field>
          <Field label="Thông báo trang chủ" hint="Để trống thì không hiện">
            <Input value={settings.notice} onChange={set('notice')} placeholder="VD: user mới đăng ký tặng 100 điểm" />
          </Field>
          <Field label="Mở đăng ký">
            <Select value={settings.allowRegister} onChange={set('allowRegister')}>
              <option value="1">Cho tự đăng ký</option>
              <option value="0">Đóng đăng ký (chỉ admin tạo tài khoản)</option>
            </Select>
          </Field>
          <Field label="Điểm tặng khi đăng ký">
            <Input type="number" value={settings.signupCredits} onChange={set('signupCredits')} />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-1 text-[13.5px] font-semibold text-mist-200">Giá (điểm)</h3>
        <p className="mb-4 text-[11.5px] text-ink-500">Video tiêu = giá gốc + đơn giá/giây × thời lượng; VD: 10 + 2×5s = 20</p>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field label="Giá gốc video">
            <Input type="number" value={settings.priceVideoBase} onChange={set('priceVideoBase')} />
          </Field>
          <Field label="Đơn giá mỗi giây video">
            <Input type="number" value={settings.priceVideoPerSecond} onChange={set('priceVideoPerSecond')} />
          </Field>
          <Field label="Đơn giá ảnh">
            <Input type="number" value={settings.priceImage} onChange={set('priceImage')} />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-1 text-[13.5px] font-semibold text-mist-200">Lưu trữ media (server)</h3>
        <p className="mb-4 text-[11.5px] text-ink-500">
          File quá số ngày giữ sẽ tự xóa. Hạn mức tính theo từng user — user nào vượt mức
          của mình thì chỉ xóa file cũ nhất của chính user đó. Chỉ xóa file của job đã tạo
          xong — job đang chạy không bao giờ bị xóa.
        </p>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Dung lượng tối đa mỗi user (MB)" hint="Vượt mức này thì bắt đầu xóa file cũ nhất của chính user đó">
            <Input type="number" min="0" value={settings.mediaMaxMB ?? 1024} onChange={set('mediaMaxMB')} />
          </Field>
          <Field label="Mức trần toàn server (MB)" hint="Tổng media mọi user cộng lại — vượt thì xóa file cũ nhất trước">
            <Input type="number" min="0" value={settings.mediaGlobalMaxMB ?? 5120} onChange={set('mediaGlobalMaxMB')} />
          </Field>
          <Field label="Giữ file bao nhiêu ngày" hint="Quá số ngày này thì tự xóa">
            <Input type="number" min="1" value={settings.mediaRetentionDays ?? 7} onChange={set('mediaRetentionDays')} />
          </Field>
        </div>
        {media && (
          <div className="mt-3.5 space-y-2">
            <p className="flex flex-wrap items-center gap-x-3 text-[12px] text-mist-300">
              <span className="flex items-center gap-1.5">
                <HardDrive size={13} className="text-brand-400" />
                Toàn server: <b className="text-white">{media.totalMB} MB / {media.globalMaxMB ?? media.maxMB} MB</b> · {media.files} file
              </span>
              <Button variant="outline" size="sm" onClick={cleanupNow} loading={cleaning}>
                Dọn ngay
              </Button>
            </p>
            {media.users?.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-ink-700">
                {media.users.map((u) => (
                  <div key={u.userId} className="flex items-center justify-between gap-2 border-b border-ink-800 px-3 py-1.5 text-[12px] last:border-b-0">
                    <span className="min-w-0 truncate text-mist-300">{u.name || u.email}</span>
                    <span className="shrink-0 tabular-nums text-mist-400">{u.totalMB} MB · {u.files} file</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Button loading={saving} onClick={save}>
        <Save size={14} /> Lưu cài đặt
      </Button>
    </div>
  );
}
