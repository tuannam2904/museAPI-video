import { useCallback, useEffect, useState } from 'react';
import {
  Users, Film, CheckCircle2, XCircle, Loader2, Cpu, Wallet, Settings2,
  RefreshCw, Search, Plus, Minus, ShieldOff, ShieldCheck, Save, Zap, MessageSquare, Trash2, TrendingUp,
  HardDrive, UserPlus, Crown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { api, fmtAgo, fmtTime } from '../lib/api.js';
import { useAuth } from '../store/auth.jsx';
import { Badge, Button, Drawer, Field, Input, Select, useToast, Spinner, Empty } from '../components/ui.jsx';

const TABS = [
  ['overview', 'Tổng quan', Cpu],
  ['users', 'Người dùng', Users],
  ['ledger', 'Lịch sử điểm', Wallet],
  ['audit', 'Nhật ký', ShieldCheck],
  ['orders', 'Đơn hàng', Wallet],
  ['vip', 'VIP', Crown],
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
      {tab === 'ledger' && <LedgerPanel />}
      {tab === 'audit' && <AuditPanel />}
      {tab === 'orders' && <OrdersPanel />}
      {tab === 'vip' && <VipPanel />}
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
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'user' });
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.adminUsers({ q, role: roleFilter, status: statusFilter, sort });
      setUsers(out.users);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, q, roleFilter, statusFilter, sort]);

  useEffect(() => { load(); }, [load]);

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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Tìm email…"
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="md" onClick={() => load()} loading={loading}>Tìm</Button>
        <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-[150px]">
          <option value="">Tất cả vai trò</option>
          <option value="user">Người dùng</option>
          <option value="admin">Quản trị viên</option>
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-[150px]">
          <option value="">Tất cả trạng thái</option>
          <option value="active">Bình thường</option>
          <option value="banned">Đã cấm</option>
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-[170px]">
          <option value="createdAt">Mới nhất</option>
          <option value="creditsSpent">Tiêu nhiều nhất</option>
          <option value="jobs">Nhiều tác vụ nhất</option>
          <option value="mediaMB">Media nhiều nhất</option>
        </Select>
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
                <th className="px-3 py-2.5 text-right font-medium">Video</th>
                <th className="px-3 py-2.5 text-right font-medium">Ảnh</th>
                <th className="px-3 py-2.5 text-right font-medium">Đã tiêu</th>
                <th className="px-3 py-2.5 text-right font-medium">Media</th>
                <th className="px-3 py-2.5 font-medium">Hoạt động cuối</th>
                <th className="px-3 py-2.5 text-right font-medium">TK Muse</th>
                <th className="px-3 py-2.5 font-medium">Đăng ký</th>
                <th className="px-4 py-2.5 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {users.map((u) => {
                const st = u.stats || {};
                return (
                <tr key={u.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-2.5">
                    <button onClick={() => setDetailId(u.id)} className="block text-left" title="Xem chi tiết">
                      <p className="font-medium text-mist-200 hover:text-brand-300">{u.name}</p>
                      <p className="text-[11px] text-ink-500 hover:text-brand-300/70">{u.email}</p>
                      {u.vipExpiresAt && u.vipExpiresAt > Date.now() && (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-300">
                          <Crown size={10} /> VIP đến {fmtTime(u.vipExpiresAt)}
                        </span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.status === 'active' ? 'ok' : 'error'}>{u.status === 'active' ? 'Bình thường' : 'Đã cấm'}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-amber-300">{u.credits}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-mist-200">{st.videos ?? 0}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-mist-200">{st.images ?? 0}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-rose-300">{st.creditsSpent ?? 0}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-mist-300">
                    {st.mediaMB != null ? `${st.mediaMB} MB` : '—'}
                    {st.mediaFiles ? <span className="text-ink-500"> · {st.mediaFiles} file</span> : ''}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-ink-500">{st.lastActive ? fmtAgo(st.lastActive) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-mist-200">{st.accounts ?? 0}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
        {users.length === 0 && !loading && <Empty icon={Users} title="Chưa có người dùng" />}
      </div>

      {detailId && (
        <UserDetailDrawer
          userId={detailId}
          me={me}
          onClose={() => setDetailId(null)}
          onDeleted={() => { setDetailId(null); load(); }}
          onChanged={() => load()}
        />
      )}
    </div>
  );
}

/* ------------------------------- Chi tiết người dùng ------------------------------- */
function UserDetailDrawer({ userId, me, onClose, onDeleted, onChanged }) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dtab, setDtab] = useState('jobs');
  const [pw, setPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwResult, setPwResult] = useState('');
  const [limits, setLimits] = useState({ daily_credit_cap: '', max_concurrent_jobs: '', media_max_mb: '' });
  const [limitsBusy, setLimitsBusy] = useState(false);
  const [vipDays, setVipDays] = useState('30');
  const [vipBusy, setVipBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.adminUserDetail(userId);
      setDetail(out);
      const lim = out.user?.limits || {};
      setLimits({
        daily_credit_cap: lim.daily_credit_cap ?? '',
        max_concurrent_jobs: lim.max_concurrent_jobs ?? '',
        media_max_mb: lim.media_max_mb ?? '',
      });
    } catch (e) {
      toast(e.message, 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [userId, toast, onClose]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  const copyPw = async () => {
    try {
      await navigator.clipboard.writeText(pwResult);
      toast('Đã sao chép mật khẩu', 'ok');
    } catch {
      toast('Sao chép thất bại, hãy chọn thủ công', 'error');
    }
  };

  const resetPw = async () => {
    if (pw && pw.length < 6) return toast('Mật khẩu ít nhất 6 ký tự', 'error');
    setPwBusy(true);
    setPwResult('');
    try {
      const out = await api.adminResetPassword(userId, pw || undefined);
      setPwResult(out.password || '');
      setPw('');
      toast('Đã đặt lại mật khẩu', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPwBusy(false);
    }
  };

  const saveLimits = async () => {
    const body = {};
    for (const k of ['daily_credit_cap', 'max_concurrent_jobs', 'media_max_mb']) {
      const v = limits[k];
      body[k] = v === '' || v === null || v === undefined ? null : Number(v);
    }
    if (Object.values(body).some((v) => v !== null && (!Number.isFinite(v) || v < 0))) {
      return toast('Hạn mức phải là số ≥ 0', 'error');
    }
    setLimitsBusy(true);
    try {
      await api.adminSetLimits(userId, body);
      toast('Đã lưu hạn mức', 'ok');
      onChanged?.();
      loadDetail();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLimitsBusy(false);
    }
  };

  const remove = async () => {
    const u = detail?.user;
    if (!confirm(`Xóa user «${u?.email}»? Toàn bộ tác vụ, lịch sử điểm, tài khoản Muse, phim và media của user này sẽ bị xóa.`)) return;
    setDeleting(true);
    try {
      await api.adminDeleteUser(userId);
      toast('Đã xóa user', 'ok');
      onDeleted();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const grantVip = async () => {
    const days = Number(vipDays);
    if (!Number.isFinite(days) || days < 1) return toast('Số ngày VIP phải ≥ 1', 'error');
    setVipBusy(true);
    try {
      await api.adminGrantVip(userId, days);
      toast(`Đã cấp VIP ${days} ngày`, 'ok');
      onChanged?.();
      loadDetail();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setVipBusy(false);
    }
  };

  const revokeVip = async () => {
    const du = detail?.user;
    if (!confirm(`Hủy VIP của «${du?.email}»? User sẽ không dùng được tài khoản Muse VIP nữa.`)) return;
    setVipBusy(true);
    try {
      await api.adminRevokeVip(userId);
      toast('Đã hủy VIP', 'ok');
      onChanged?.();
      loadDetail();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setVipBusy(false);
    }
  };

  const u = detail?.user;
  const st = detail?.stats || u?.stats || {};
  const jobs = detail?.jobs || [];
  const ledger = detail?.ledger || [];
  const accounts = detail?.accounts || [];
  const films = detail?.films || [];
  const media = detail?.media || {};

  const jobStatus = (s) => (s === 'completed' ? ['ok', 'Xong'] : s === 'failed' ? ['error', 'Thất bại'] : s === 'processing' ? ['warn', 'Đang chạy'] : s === 'canceled' ? ['neutral', 'Đã hủy'] : ['brand', 'Đang chờ']);

  return (
    <Drawer open onClose={onClose} title={u?.name || u?.email || 'Chi tiết người dùng'} subtitle={u?.email} width="w-[640px]">
      {loading && !detail ? (
        <div className="grid place-items-center py-24 text-brand-400"><Spinner size={20} /></div>
      ) : !u ? (
        <Empty icon={Users} title="Không tìm thấy người dùng" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>{u.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}</Badge>
            <Badge tone={u.status === 'active' ? 'ok' : 'error'}>{u.status === 'active' ? 'Bình thường' : 'Đã cấm'}</Badge>
            {u.vipExpiresAt && u.vipExpiresAt > Date.now() && (
              <Badge tone="warn">VIP đến {fmtTime(u.vipExpiresAt)}</Badge>
            )}
            <span className="text-[12px] text-mist-400">Điểm: <b className="text-amber-300">{u.credits}</b></span>
            <span className="text-[12px] text-mist-400">Đăng ký: {fmtTime(u.createdAt)}</span>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-ink-900 px-2 py-2.5">
              <p className="text-[17px] font-semibold tabular-nums text-white">{st.videos ?? 0}</p>
              <p className="text-[11px] text-mist-400">Video</p>
            </div>
            <div className="rounded-xl bg-ink-900 px-2 py-2.5">
              <p className="text-[17px] font-semibold tabular-nums text-white">{st.images ?? 0}</p>
              <p className="text-[11px] text-mist-400">Ảnh</p>
            </div>
            <div className="rounded-xl bg-ink-900 px-2 py-2.5">
              <p className="text-[17px] font-semibold tabular-nums text-rose-300">{st.creditsSpent ?? 0}</p>
              <p className="text-[11px] text-mist-400">Điểm đã tiêu</p>
            </div>
            <div className="rounded-xl bg-ink-900 px-2 py-2.5">
              <p className="text-[17px] font-semibold tabular-nums text-white">{st.mediaMB ?? 0} MB</p>
              <p className="text-[11px] text-mist-400">Media · {st.mediaFiles ?? 0} file</p>
            </div>
            <div className="rounded-xl bg-ink-900 px-2 py-2.5">
              <p className="text-[17px] font-semibold tabular-nums text-white">{st.accounts ?? 0}</p>
              <p className="text-[11px] text-mist-400">TK Muse</p>
            </div>
            <div className="rounded-xl bg-ink-900 px-2 py-2.5">
              <p className="text-[13px] font-semibold text-white">{st.lastActive ? fmtAgo(st.lastActive) : '—'}</p>
              <p className="text-[11px] text-mist-400">Hoạt động cuối</p>
            </div>
          </div>

          {/* Đặt lại mật khẩu */}
          <div className="card p-4">
            <h4 className="text-[13px] font-semibold text-mist-200">Đặt lại mật khẩu</h4>
            <div className="mt-3 flex gap-2">
              <Input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="Mật khẩu mới (để trống = tự tạo)"
                className="flex-1"
              />
              <Button onClick={resetPw} loading={pwBusy}>Đặt lại</Button>
            </div>
            {pwResult && (
              <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-[11.5px] text-amber-200">Mật khẩu mới — chỉ hiện một lần, hãy gửi cho user ngay:</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-[13px] text-white">{pwResult}</code>
                  <Button variant="outline" size="sm" onClick={copyPw}>Sao chép</Button>
                </div>
              </div>
            )}
          </div>

          {/* Hạn mức */}
          <div className="card p-4">
            <h4 className="text-[13px] font-semibold text-mist-200">Hạn mức riêng</h4>
            <p className="mt-0.5 text-[11.5px] text-ink-500">Để trống = không giới hạn</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Điểm tối đa mỗi ngày">
                <Input type="number" min="0" value={limits.daily_credit_cap} onChange={(e) => setLimits((l) => ({ ...l, daily_credit_cap: e.target.value }))} placeholder="Không giới hạn" />
              </Field>
              <Field label="Tác vụ chạy cùng lúc">
                <Input type="number" min="0" value={limits.max_concurrent_jobs} onChange={(e) => setLimits((l) => ({ ...l, max_concurrent_jobs: e.target.value }))} placeholder="Không giới hạn" />
              </Field>
              <Field label="Media tối đa (MB)">
                <Input type="number" min="0" value={limits.media_max_mb} onChange={(e) => setLimits((l) => ({ ...l, media_max_mb: e.target.value }))} placeholder="Không giới hạn" />
              </Field>
            </div>
            <div className="mt-3 flex justify-end">
              <Button onClick={saveLimits} loading={limitsBusy}><Save size={13} /> Lưu hạn mức</Button>
            </div>
          </div>

          {/* VIP */}
          <div className="card p-4">
            <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-mist-200">
              <Crown size={13} className="text-amber-300" /> VIP
            </h4>
            <p className="mt-0.5 text-[11.5px] text-ink-500">
              {u.vipExpiresAt && u.vipExpiresAt > Date.now()
                ? `Đang VIP đến ${fmtTime(u.vipExpiresAt)} — user này dùng được các tài khoản Muse VIP.`
                : 'Chưa có VIP — user này chỉ dùng được tài khoản Muse của chính họ.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                type="number"
                min="1"
                value={vipDays}
                onChange={(e) => setVipDays(e.target.value)}
                className="w-24"
                placeholder="30"
              />
              <span className="text-[12px] text-mist-400">ngày</span>
              <Button onClick={grantVip} loading={vipBusy}>Cấp VIP</Button>
              <Button
                variant="outline"
                onClick={revokeVip}
                loading={vipBusy}
                disabled={!u.vipExpiresAt || u.vipExpiresAt <= Date.now()}
              >
                Hủy VIP
              </Button>
            </div>
          </div>

          {/* 4 tab chi tiết */}
          <div className="flex gap-1.5 rounded-xl bg-ink-850 p-1 w-fit">
            {[['jobs', 'Tác vụ'], ['ledger', 'Lịch sử điểm'], ['accounts', 'Tài khoản Muse'], ['media', 'Media & Phim']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setDtab(k)}
                className={clsx(
                  'rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition',
                  dtab === k ? 'bg-ink-700 text-white shadow-sm' : 'text-mist-400 hover:text-mist-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {dtab === 'jobs' && (
            <div className="space-y-1.5">
              {jobs.length === 0 && <p className="py-6 text-center text-[12.5px] text-ink-500">Chưa có tác vụ nào</p>}
              {jobs.map((j) => {
                const [tone, label] = jobStatus(j.status);
                return (
                  <div key={j.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-900 px-2.5 py-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-mist-300" title={j.prompt}>{j.prompt || '(không có prompt)'}</span>
                    <Badge tone={j.type === 'video' ? 'brand' : 'neutral'}>{j.type === 'video' ? 'Video' : 'Ảnh'}</Badge>
                    <Badge tone={tone}>{label}</Badge>
                    <span className="shrink-0 text-[11px] tabular-nums text-mist-400">{j.cost ?? 0} điểm</span>
                    <span className="shrink-0 text-[10.5px] text-ink-500">{fmtAgo(j.created_at)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {dtab === 'ledger' && (
            <div className="space-y-1.5">
              {ledger.length === 0 && <p className="py-6 text-center text-[12.5px] text-ink-500">Chưa có giao dịch điểm nào</p>}
              {ledger.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-900 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-mist-300">{e.reason}</p>
                    <p className="text-[10.5px] text-ink-500">{fmtTime(e.created_at)}{e.job_id ? ` · ${e.job_id}` : ''}</p>
                  </div>
                  <span className={clsx('shrink-0 font-mono text-[12.5px] font-semibold', e.delta >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                    {e.delta >= 0 ? `+${e.delta}` : e.delta}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-mist-400">Số dư {e.balance_after}</span>
                </div>
              ))}
            </div>
          )}

          {dtab === 'accounts' && (
            <div className="space-y-1.5">
              {accounts.length === 0 && <p className="py-6 text-center text-[12.5px] text-ink-500">Chưa nhập tài khoản Muse nào</p>}
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-900 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-mist-200">{a.label}</p>
                    <p className="font-mono text-[10.5px] text-ink-500">{a.upstream_id ? `#${a.upstream_id.slice(0, 8)}` : ''}</p>
                  </div>
                  <Badge tone={a.status === 'ok' ? 'ok' : a.status === 'error' ? 'error' : 'warn'}>
                    {a.status === 'ok' ? 'Khả dụng' : a.status === 'error' ? 'Lỗi' : 'Chờ kiểm tra'}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {dtab === 'media' && (
            <div className="space-y-3">
              <p className="rounded-lg bg-ink-900 px-3 py-2 text-[12.5px] text-mist-300">
                Media: <b className="text-white">{media.totalMB ?? st.mediaMB ?? 0} MB</b> · {media.files ?? st.mediaFiles ?? 0} file
              </p>
              {films.length === 0 ? (
                <p className="py-4 text-center text-[12.5px] text-ink-500">Chưa có phim nào</p>
              ) : (
                <div className="space-y-1.5">
                  {films.map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-900 px-2.5 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium text-mist-200">{f.title}</p>
                        <p className="text-[10.5px] text-ink-500">{f.genre || ''}{f.duration_total ? ` · ${f.duration_total}s` : ''} · {f.status || ''}</p>
                      </div>
                      <span className="shrink-0 text-[10.5px] text-ink-500">{fmtAgo(f.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-ink-700 pt-4">
            <Button
              variant="outline"
              onClick={remove}
              loading={deleting}
              disabled={u.id === me?.id}
              className="w-full border-rose-500/40 text-rose-300 hover:border-rose-500/70"
            >
              <Trash2 size={13} /> Xóa user này (xóa cả tác vụ, lịch sử điểm, tài khoản Muse, phim và media)
            </Button>
            {u.id === me?.id && <p className="mt-2 text-center text-[11px] text-ink-500">Không thể xóa chính mình</p>}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/* ------------------------------- Lịch sử điểm ------------------------------- */
function LedgerPanel() {
  const toast = useToast();
  const [entries, setEntries] = useState([]);
  const [userFilter, setUserFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (userFilter.trim()) params.user_id = userFilter.trim();
      if (reasonFilter.trim()) params.reason = reasonFilter.trim();
      const out = await api.adminLedger(params);
      setEntries(out.entries || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast, userFilter, reasonFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Lọc theo email hoặc ID user…"
          className="max-w-xs"
        />
        <Input
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          placeholder="Lọc theo lý do…"
          className="max-w-xs"
        />
        <Button variant="outline" size="md" onClick={() => load()} loading={loading}>Tìm</Button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Người dùng</th>
                <th className="px-3 py-2.5 text-right font-medium">Thay đổi</th>
                <th className="px-3 py-2.5 text-right font-medium">Số dư sau</th>
                <th className="px-3 py-2.5 font-medium">Lý do</th>
                <th className="px-3 py-2.5 font-medium">Tác vụ</th>
                <th className="px-4 py-2.5 font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-2.5 text-[11.5px] text-mist-300">{e.email || e.user_id}</td>
                  <td className={clsx('px-3 py-2.5 text-right font-mono font-semibold', e.delta >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                    {e.delta >= 0 ? `+${e.delta}` : e.delta}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-mist-200">{e.balance_after}</td>
                  <td className="px-3 py-2.5 text-mist-300">{e.reason}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-ink-500">{e.job_id || '—'}</td>
                  <td className="px-4 py-2.5 text-[11px] text-ink-500">{fmtTime(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 && !loading && <Empty icon={Wallet} title="Chưa có giao dịch điểm nào" />}
      </div>
    </div>
  );
}

/* ------------------------------- Nhật ký quản trị ------------------------------- */
function AuditPanel() {
  const toast = useToast();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api.adminAudit(100);
      setEntries(out.entries || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="md" onClick={() => load()} loading={loading}>
          <RefreshCw size={12} /> Làm mới
        </Button>
      </div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Quản trị viên</th>
                <th className="px-3 py-2.5 font-medium">Hành động</th>
                <th className="px-3 py-2.5 font-medium">Đối tượng</th>
                <th className="px-3 py-2.5 font-medium">Chi tiết</th>
                <th className="px-4 py-2.5 font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-ink-800/40">
                  <td className="px-4 py-2.5 text-[11.5px] text-mist-300">{e.admin_email}</td>
                  <td className="px-3 py-2.5"><Badge tone="brand">{e.action}</Badge></td>
                  <td className="px-3 py-2.5 text-[11.5px] text-mist-300">
                    {e.target_type}
                    {e.target_id ? <span className="font-mono text-[11px] text-ink-500"> · {String(e.target_id).slice(0, 12)}</span> : ''}
                  </td>
                  <td className="px-3 py-2.5 text-mist-300">{e.detail || '—'}</td>
                  <td className="px-4 py-2.5 text-[11px] text-ink-500">{fmtTime(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 && !loading && <Empty icon={ShieldCheck} title="Chưa có hoạt động quản trị nào" />}
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

/* ------------------------------- VIP ------------------------------- */
function VipPanel() {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [accLoading, setAccLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [ordLoading, setOrdLoading] = useState(true);
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    api.adminSettings().then((r) => setSettings(r.settings)).catch((e) => toast(e.message, 'error'));
    api.adminVipAccounts()
      .then((r) => setAccounts(r.accounts || []))
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setAccLoading(false));
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const loadOrders = useCallback(async () => {
    setOrdLoading(true);
    try {
      const out = await api.adminVipOrders();
      setOrders(out.orders || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setOrdLoading(false);
    }
  }, [toast]);

  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      const out = await api.updateAdminSettings(settings);
      setSettings(out.settings);
      toast('Đã lưu cài đặt VIP', 'ok');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleVipAccount = async (a) => {
    try {
      await api.setVipAccount(a.id, !a.vip);
      setAccounts((l) => l.map((x) => (x.id === a.id ? { ...x, vip: !x.vip } : x)));
      toast(a.vip ? `Đã bỏ VIP cho «${a.label}»` : `«${a.label}» đã là tài khoản VIP`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const confirmOrder = async (o) => {
    if (!confirm(`Xác nhận đã nhận ${Number(o.amount_vnd || 0).toLocaleString('vi-VN')}đ cho đơn ${o.code} và kích hoạt VIP cho user này?`)) return;
    setConfirming(o.id);
    try {
      await api.adminConfirmVipOrder(o.id);
      toast('Đã xác nhận và kích hoạt VIP', 'ok');
      loadOrders();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setConfirming(null);
    }
  };

  const vipStatus = (s) => (
    s === 'paid' ? ['ok', 'Đã thanh toán']
      : s === 'pending' ? ['brand', 'Chờ thanh toán']
      : s === 'underpaid' ? ['warn', 'Thiếu tiền']
      : s === 'expired' ? ['neutral', 'Hết hạn']
      : s === 'canceled' ? ['neutral', 'Đã hủy']
      : ['neutral', s || '—']
  );

  if (!settings) return <div className="grid place-items-center py-24 text-brand-400"><Spinner size={20} /></div>;

  return (
    <div className="space-y-4">
      {/* Cài đặt giá gói + SePay */}
      <div className="card p-5">
        <h3 className="mb-1 text-[13.5px] font-semibold text-mist-200">Giá gói VIP (VND)</h3>
        <p className="mb-4 text-[11.5px] text-ink-500">Thời hạn cố định: gói Ngày = 1 ngày, gói Tuần = 7 ngày, gói Tháng = 30 ngày.</p>
        <div className="grid gap-3.5 sm:grid-cols-3">
          <Field label="Gói Ngày (1 ngày)">
            <Input type="number" min="0" value={settings.vipPriceDayVnd ?? ''} onChange={set('vipPriceDayVnd')} placeholder="VD: 15000" />
          </Field>
          <Field label="Gói Tuần (7 ngày)">
            <Input type="number" min="0" value={settings.vipPriceWeekVnd ?? ''} onChange={set('vipPriceWeekVnd')} placeholder="VD: 79000" />
          </Field>
          <Field label="Gói Tháng (30 ngày)">
            <Input type="number" min="0" value={settings.vipPriceMonthVnd ?? ''} onChange={set('vipPriceMonthVnd')} placeholder="VD: 249000" />
          </Field>
          <Field label="Giới hạn lượt tạo / ngày / acc VIP" hint="Mỗi tài khoản VIP tạo tối đa từng này lượt mỗi ngày — hết lượt thì user tự thêm tài khoản của họ">
            <Input type="number" min="0" value={settings.vipDailyVideoLimit ?? ''} onChange={set('vipDailyVideoLimit')} placeholder="100" />
          </Field>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="mb-1 text-[13.5px] font-semibold text-mist-200">Thanh toán SePay (chuyển khoản ngân hàng)</h3>
        <p className="mb-4 text-[11.5px] text-ink-500">
          Dùng chung Worker + tài khoản MB với bot Telegram aimibot. Hệ thống tự hỏi Worker
          xem có tiền về không rồi kích hoạt VIP — không cần duyệt tay.
        </p>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="MAIL_API_URL (địa chỉ Worker)">
            <Input value={settings.sepayMailApiUrl ?? ''} onChange={set('sepayMailApiUrl')} placeholder="https://mail.taphoaimi.dpdns.org" />
          </Field>
          <Field label="MAIL_API_TOKEN" hint="Token này không bao giờ hiện lại cho user thường — chỉ admin thấy ở đây">
            <Input type="password" value={settings.sepayMailApiToken ?? ''} onChange={set('sepayMailApiToken')} placeholder="Dán token của Worker" autoComplete="off" />
          </Field>
          <Field label="Số tài khoản nhận tiền">
            <Input value={settings.sepayMbAccountNo ?? ''} onChange={set('sepayMbAccountNo')} placeholder="VD: 1136226868" />
          </Field>
          <Field label="Tên chủ tài khoản">
            <Input value={settings.sepayMbAccountName ?? ''} onChange={set('sepayMbAccountName')} placeholder="VD: NGUYEN TUAN NAM" />
          </Field>
          <Field label="BIN ngân hàng">
            <Input value={settings.sepayMbBin ?? ''} onChange={set('sepayMbBin')} placeholder="VD: 970422 (MB)" />
          </Field>
          <Field label="Tiền tố mã đơn">
            <Input value={settings.sepayCodePrefix ?? ''} onChange={set('sepayCodePrefix')} placeholder="VD: VIP" />
          </Field>
          <Field label="Đơn hết hạn sau (phút)">
            <Input type="number" min="1" value={settings.vipOrderTtlMin ?? ''} onChange={set('vipOrderTtlMin')} placeholder="10" />
          </Field>
          <Field label="Hỏi Worker mỗi (giây)">
            <Input type="number" min="5" value={settings.vipPollSeconds ?? ''} onChange={set('vipPollSeconds')} placeholder="15" />
          </Field>
        </div>
        <div className="mt-4">
          <Button loading={saving} onClick={save}><Save size={14} /> Lưu cài đặt VIP</Button>
        </div>
      </div>

      {/* Tài khoản Muse VIP */}
      <div className="card p-5">
        <h3 className="mb-1 text-[13.5px] font-semibold text-mist-200">Tài khoản Muse VIP</h3>
        <p className="mb-4 text-[11.5px] text-ink-500">
          Chỉ user đang có VIP mới được dùng các tài khoản đã bật VIP ở đây. User không có VIP
          chỉ dùng được tài khoản Muse của chính họ.
        </p>
        {accLoading ? (
          <div className="grid place-items-center py-10 text-brand-400"><Spinner size={18} /></div>
        ) : accounts.length === 0 ? (
          <Empty icon={Crown} title="Chưa có tài khoản Muse nào" desc="Nhập tài khoản Muse ở trang Nhập Muse trước, rồi bật VIP ở đây." />
        ) : (
          <div className="space-y-1.5">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl bg-ink-900 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-mist-200">{a.label}</p>
                  <p className="font-mono text-[10.5px] text-ink-500">
                    {a.upstream_id ? `#${String(a.upstream_id).slice(0, 8)}` : ''}
                    {a.owner_id ? ' · tài khoản riêng' : ' · kho chung'}
                    {a.status ? ` · ${a.status}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.vip && a.todayUsed != null && a.dailyLimit != null && (
                    <span className="shrink-0 text-[11.5px] tabular-nums text-mist-300">
                      {a.todayUsed}/{a.dailyLimit} hôm nay
                    </span>
                  )}
                  {a.vip && <Badge tone="warn">VIP</Badge>}
                  <button
                    onClick={() => toggleVipAccount(a)}
                    className={clsx(
                      'relative h-6 w-11 shrink-0 rounded-full transition',
                      a.vip ? 'bg-amber-500' : 'bg-ink-600'
                    )}
                    title={a.vip ? 'Bấm để bỏ VIP' : 'Bấm để đánh dấu VIP'}
                    aria-label={a.vip ? 'Bỏ VIP' : 'Đánh dấu VIP'}
                  >
                    <span className={clsx(
                      'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                      a.vip ? 'left-[22px]' : 'left-0.5'
                    )}
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Đơn VIP */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-4 py-3">
          <h3 className="text-[13px] font-semibold text-mist-200">Đơn VIP ({orders.length})</h3>
          <Button variant="outline" size="sm" onClick={loadOrders} loading={ordLoading}>
            <RefreshCw size={12} /> Làm mới
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead className="border-b border-ink-700 text-[11px] uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Mã đơn</th>
                <th className="px-3 py-2.5 font-medium">Người dùng</th>
                <th className="px-3 py-2.5 text-right font-medium">Số tiền</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-3 py-2.5 font-medium">Tạo lúc</th>
                <th className="px-3 py-2.5 font-medium">Thanh toán lúc</th>
                <th className="px-4 py-2.5 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-800">
              {orders.map((o) => {
                const [tone, label] = vipStatus(o.status);
                return (
                  <tr key={o.id} className="hover:bg-ink-800/40">
                    <td className="px-4 py-2.5 font-mono text-[11.5px] font-semibold text-amber-300">{o.code}</td>
                    <td className="px-3 py-2.5 text-[11.5px] text-mist-300">{o.email || o.user_id}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-mist-100">{Number(o.amount_vnd || 0).toLocaleString('vi-VN')}đ</td>
                    <td className="px-3 py-2.5"><Badge tone={tone}>{label}</Badge></td>
                    <td className="px-3 py-2.5 text-[11px] text-ink-500">{fmtTime(o.created_at)}</td>
                    <td className="px-3 py-2.5 text-[11px] text-ink-500">{o.paid_at ? fmtTime(o.paid_at) : '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      {(o.status === 'pending' || o.status === 'underpaid') && (
                        <Button
                          size="sm"
                          loading={confirming === o.id}
                          onClick={() => confirmOrder(o)}
                        >
                          Xác nhận
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && !ordLoading && <Empty icon={Crown} title="Chưa có đơn VIP nào" />}
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
