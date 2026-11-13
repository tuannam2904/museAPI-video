import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, LogOut } from 'lucide-react';
import { api } from '../lib/api.js';
import { Badge, Button, Field, Input, Spinner, useToast } from '../components/ui.jsx';
import { useAuth } from '../store/auth.jsx';

export default function Profile() {
  const toast = useToast();
  const nav = useNavigate();
  const { logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [vip, setVip] = useState(null);
  const [media, setMedia] = useState(null);
  const [ownCount, setOwnCount] = useState(0);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [rMe, rVip, rMedia, rAcc] = await Promise.allSettled([
      api.me(),
      api.vipStatus(),
      api.mediaStats(),
      api.accounts(),
    ]);
    if (rMe.status === 'fulfilled' && rMe.value?.user) {
      setMe(rMe.value.user);
      setName(rMe.value.user.name || '');
    } else {
      toast(rMe.reason?.message || 'Không tải được thông tin cá nhân', 'error');
    }
    if (rVip.status === 'fulfilled') {
      setVip(rVip.value);
    } else {
      toast(rVip.reason?.message || 'Không tải được trạng thái VIP', 'error');
    }
    if (rMedia.status === 'fulfilled') {
      setMedia(rMedia.value);
    } else {
      toast(rMedia.reason?.message || 'Không tải được dung lượng media', 'error');
    }
    if (rAcc.status === 'fulfilled') {
      setOwnCount((rAcc.value?.accounts || []).filter((a) => a.mine).length);
    } else {
      toast(rAcc.reason?.message || 'Không tải được tài khoản Muse', 'error');
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const saveName = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return toast('Tên hiển thị không được để trống', 'error');
    setSavingName(true);
    try {
      const out = await api.updateMe({ name: trimmed });
      if (out?.user) {
        setMe(out.user);
        setName(out.user.name || '');
      } else {
        const r = await api.me();
        if (r?.user) {
          setMe(r.user);
          setName(r.user.name || '');
        }
      }
      toast('Đã lưu tên hiển thị', 'ok');
    } catch (err) {
      toast(err.message || 'Không lưu được tên', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const changePw = async (e) => {
    e.preventDefault();
    if (!oldPw) return toast('Nhập mật khẩu cũ', 'error');
    if (newPw.length < 6) return toast('Mật khẩu mới phải từ 6 ký tự trở lên', 'error');
    if (newPw !== newPw2) return toast('Hai mật khẩu mới không khớp', 'error');
    setChangingPw(true);
    try {
      await api.updateMe({ password: newPw, oldPassword: oldPw });
      setOldPw('');
      setNewPw('');
      setNewPw2('');
      toast('Đã đổi mật khẩu', 'ok');
    } catch (err) {
      toast(err.message || 'Không đổi được mật khẩu', 'error');
    } finally {
      setChangingPw(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="grid place-items-center py-16">
          <Spinner size={26} />
        </div>
      </div>
    );
  }

  const isVip = !!me?.isVip;
  const vipDaysLeft = me?.vipExpiresAt
    ? Math.max(0, Math.ceil((me.vipExpiresAt - Date.now()) / 86400000))
    : null;
  const limit = me?.dailyVideoLimit;
  const today = me?.todayVideoCount ?? 0;
  const pct = limit ? Math.min(100, Math.round((today / limit) * 100)) : null;
  const initial = (me?.name || me?.email || '?').slice(0, 1).toUpperCase();
  // Trạng thái VIP từ /api/vip/status (dự phòng khi me chưa có isVip)
  const vipActive = isVip || !!vip?.isVip;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-xl font-semibold text-white">Trang cá nhân</h1>
      <p className="mt-1 text-[13px] text-mist-400">Thông tin tài khoản, VIP và mức sử dụng của bạn.</p>

      {/* ---------------- Thẻ đầu: avatar + tên + huy hiệu ---------------- */}
      <section className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-teal-700 text-xl font-bold text-white shadow-inner">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-white">{me?.name || me?.email || '—'}</p>
            <p className="truncate text-[13px] text-mist-400">{me?.email || ''}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Badge tone={me?.role === 'admin' ? 'brand' : 'neutral'}>
                {me?.role === 'admin' ? 'Quản trị' : 'Người dùng'}
              </Badge>
              {vipActive && (
                <Badge tone="brand">
                  <Crown size={12} /> VIP
                </Badge>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Thông tin ---------------- */}
      <section className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="text-[15px] font-semibold text-white">Thông tin</h2>
        <form onSubmit={saveName} className="mt-3">
          <Field label="Tên hiển thị">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên hiển thị" />
          </Field>
          <Button type="submit" loading={savingName} size="sm" className="mt-2">
            Lưu tên
          </Button>
        </form>
        <dl className="mt-4 space-y-2 border-t border-white/[0.06] pt-3 text-[13px]">
          <InfoRow label="Email" value={me?.email || '—'} />
          <InfoRow label="Vai trò" value={me?.role === 'admin' ? 'Quản trị' : 'Người dùng'} />
          <InfoRow
            label="Ngày tham gia"
            value={me?.createdAt ? new Date(me.createdAt).toLocaleString('vi-VN') : '—'}
          />
          <InfoRow label="Mã người dùng" value={me?.id ? me.id.slice(0, 8) : '—'} mono />
        </dl>
      </section>

      {/* ---------------- VIP ---------------- */}
      <section className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="text-[15px] font-semibold text-white">VIP</h2>
        {vipActive ? (
          <>
            <p className="mt-2 text-[13px] text-mist-300">
              Đang dùng VIP
              {me?.vipExpiresAt ? (
                <>
                  {' '}— hết hạn{' '}
                  <b className="text-white">{new Date(me.vipExpiresAt).toLocaleString('vi-VN')}</b>
                </>
              ) : null}
              {vipDaysLeft != null ? <> (còn {vipDaysLeft} ngày)</> : null}
            </p>
            <Button size="sm" className="mt-3" onClick={() => nav('/vip')}>
              Gia hạn VIP
            </Button>
          </>
        ) : (
          <>
            <p className="mt-2 text-[13px] text-mist-300">Bạn chưa có VIP.</p>
            <Button size="sm" className="mt-3" onClick={() => nav('/vip')}>
              Mua VIP
            </Button>
          </>
        )}
      </section>

      {/* ---------------- Sử dụng hôm nay ---------------- */}
      <section className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="text-[15px] font-semibold text-white">Sử dụng hôm nay</h2>
        <p className="mt-2 text-[13px] text-mist-300">
          {limit == null ? (
            <>
              Không giới hạn — đã tạo <b className="text-white">{today} video</b> hôm nay
            </>
          ) : (
            <>
              {today} / {limit} video hôm nay
            </>
          )}
        </p>
        {limit != null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all"
              style={{ width: `${today > 0 ? Math.max(2, pct) : 0}%` }}
            />
          </div>
        )}
        <p className="mt-2.5 text-[13px] text-mist-300">
          Dung lượng:{' '}
          {media ? (
            <>
              <b className="text-white">{media.totalMB} MB</b> · {media.files} tập tin · giữ{' '}
              {media.retentionDays} ngày
            </>
          ) : (
            '—'
          )}
        </p>
        {me?.limits?.media_max_mb != null && (
          <p className="mt-1 text-[13px] text-mist-300">
            Giới hạn của bạn: {me.limits.media_max_mb} MB
          </p>
        )}
      </section>

      {/* ---------------- Tài khoản Muse ---------------- */}
      <section className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="text-[15px] font-semibold text-white">Tài khoản Muse</h2>
        <p className="mt-2 text-[13px] text-mist-300">
          Bạn có <b className="text-white">{ownCount} tài khoản Muse riêng</b>.
        </p>
        {ownCount === 0 && (
          <p className="mt-1 text-[12.5px] text-mist-400">Bạn đang dùng acc VIP hoặc kho chung.</p>
        )}
        <Button size="sm" variant="outline" className="mt-3" onClick={() => nav('/accounts')}>
          Quản lý tài khoản
        </Button>
      </section>

      {/* ---------------- Đổi mật khẩu ---------------- */}
      <section className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
        <h2 className="text-[15px] font-semibold text-white">Đổi mật khẩu</h2>
        <form onSubmit={changePw} className="mt-3 space-y-3">
          <Field label="Mật khẩu cũ">
            <Input
              type="password"
              value={oldPw}
              onChange={(e) => setOldPw(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="Mật khẩu mới">
            <Input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <Input
              type="password"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Button type="submit" loading={changingPw} size="sm">
            Đổi mật khẩu
          </Button>
        </form>
      </section>

      <div className="mt-6 flex justify-end">
        <Button variant="danger" size="sm" onClick={logout}>
          <LogOut size={14} /> Đăng xuất
        </Button>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-mist-400">{label}</dt>
      <dd className={mono ? 'font-mono text-[12px] text-mist-100' : 'truncate text-mist-100'}>
        {value}
      </dd>
    </div>
  );
}
