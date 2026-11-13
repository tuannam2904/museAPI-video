import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth, requireAdmin, publicUser, createUser, hashPassword } from '../auth.js';
import { db, addCredits, getSettings, setSetting, upsertAccount, auditLog, grantVip, revokeVip } from '../db.js';
import { mediaStats, mediaStatsForUser, cleanupMedia } from '../mediaCleanup.js';
import { MEDIA_DIR } from '../config.js';
import * as muse from '../muse.js';
import { vipAccountTodayCount, getVipDailyLimit } from '../lib/accounts.js';

const r = Router();
r.use(requireAuth, requireAdmin);

/* ------------------------- helper: hạn mức + thống kê user ------------------------- */
function userLimits(u) {
  return {
    daily_credit_cap: u.daily_credit_cap ?? null,
    max_concurrent_jobs: u.max_concurrent_jobs ?? null,
    media_max_mb: u.media_max_mb ?? null,
  };
}

function userStats(u, media) {
  const id = u.id;
  const videos = db.prepare("SELECT COUNT(*) n FROM jobs WHERE user_id = ? AND type = 'video' AND status = 'completed'").get(id).n;
  const images = db.prepare("SELECT COUNT(*) n FROM jobs WHERE user_id = ? AND type = 'image' AND status = 'completed'").get(id).n;
  const jobs = db.prepare('SELECT COUNT(*) n FROM jobs WHERE user_id = ?').get(id).n;
  const creditsSpent = db.prepare('SELECT COALESCE(-SUM(delta),0) n FROM ledger WHERE user_id = ? AND delta < 0').get(id).n;
  const accounts = db.prepare('SELECT COUNT(*) n FROM accounts WHERE owner_id = ?').get(id).n;
  const lastJob = db.prepare('SELECT MAX(created_at) m FROM jobs WHERE user_id = ?').get(id).m;
  return {
    videos, images, jobs, creditsSpent,
    mediaMB: media?.totalMB ?? 0,
    mediaFiles: media?.files ?? 0,
    accounts,
    lastActive: lastJob ?? u.created_at,
  };
}

function publicUserFull(u, media) {
  return { ...publicUser(u), vipExpiresAt: u.vip_expires_at ?? null, limits: userLimits(u), stats: userStats(u, media) };
}

r.get('/overview', (_req, res) => {  const users = db.prepare("SELECT COUNT(*) n FROM users").get().n;
  const jobs = db.prepare("SELECT COUNT(*) n FROM jobs").get().n;
  const done = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='completed'").get().n;
  const failed = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='failed'").get().n;
  const running = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','processing')").get().n;
  const videos = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='completed' AND type='video'").get().n;
  const images = db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='completed' AND type='image'").get().n;
  const credits = db.prepare("SELECT COALESCE(SUM(credits),0) n FROM users").get().n;
  const consumed = db.prepare("SELECT COALESCE(-SUM(delta),0) n FROM ledger WHERE delta < 0").get().n;
  const accounts = db.prepare('SELECT COUNT(*) n FROM accounts').get().n;
  const recent = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 8').all();
  res.json({
    stats: { users, jobs, done, failed, running, videos, images, credits, consumed, accounts },
    recent,
  });
});

r.get('/users', (req, res) => {
  const q = String(req.query.q || '').trim();
  const role = String(req.query.role || '').trim();
  const status = String(req.query.status || '').trim();
  const sort = String(req.query.sort || 'createdAt').trim();
  const where = [];
  const args = [];
  if (q) { where.push('email LIKE ?'); args.push(`%${q}%`); }
  if (role === 'user' || role === 'admin') { where.push('role = ?'); args.push(role); }
  if (status === 'active' || status === 'banned') { where.push('status = ?'); args.push(status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM users ${w} ORDER BY created_at DESC LIMIT 200`).all(...args);
  const mediaByUser = new Map(mediaStats().users.map((u) => [u.userId, u]));
  const users = rows.map((u) => publicUserFull(u, mediaByUser.get(u.id)));
  const sortKey = { creditsSpent: 'creditsSpent', jobs: 'jobs', mediaMB: 'mediaMB', createdAt: 'createdAt' }[sort] || 'createdAt';
  const getVal = (u) => (sortKey === 'createdAt' ? u.createdAt : u.stats[sortKey]) || 0;
  users.sort((a, b) => getVal(b) - getVal(a));
  res.json({ users });
});

/* Chi tiết một người dùng: hồ sơ + tác vụ + lịch sử điểm + tài khoản Muse + media + phim */
r.get('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Người dùng không tồn tại' });
  const media = mediaStatsForUser(user.id);
  const jobs = db.prepare(
    'SELECT id, type, prompt, status, cost, created_at, media_file FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(user.id);
  const ledger = db.prepare(
    'SELECT id, delta, balance_after, reason, job_id, created_at FROM ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(user.id);
  const accounts = db.prepare(
    'SELECT id, label, status, upstream_id FROM accounts WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(user.id);
  const films = db.prepare(
    'SELECT id, title, status, created_at FROM film_projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(user.id);
  res.json({
    user: { ...publicUser(user), vipExpiresAt: user.vip_expires_at ?? null, limits: userLimits(user) },
    stats: userStats(user, media),
    jobs,
    ledger,
    accounts,
    media: { totalMB: media.totalMB, files: media.files },
    films,
  });
});

/* Xóa người dùng + toàn bộ dữ liệu của họ (không đụng tài khoản dùng chung) */
r.delete('/users/:id', (req, res) => {
  const id = req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'Không thể xóa chính mình' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Người dùng không tồn tại' });

  // Thu thập file media của user rồi xóa khỏi đĩa (chỉ file của chính user này)
  const mediaFiles = new Set();
  for (const row of db.prepare('SELECT media_file FROM jobs WHERE user_id = ? AND media_file IS NOT NULL').all(id)) mediaFiles.add(row.media_file);
  for (const row of db.prepare('SELECT final_file FROM film_projects WHERE user_id = ? AND final_file IS NOT NULL').all(id)) mediaFiles.add(row.final_file);
  for (const row of db.prepare('SELECT filename FROM uploads WHERE user_id = ?').all(id)) mediaFiles.add(row.filename);
  for (const row of db.prepare(
    'SELECT image_media, video_media FROM film_scenes WHERE project_id IN (SELECT id FROM film_projects WHERE user_id = ?)'
  ).all(id)) {
    for (const u of [row.image_media, row.video_media]) {
      if (u && u.startsWith('/media/')) mediaFiles.add(u.slice(7));
    }
  }
  for (const name of mediaFiles) {
    if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) continue;
    try { fs.unlinkSync(path.join(MEDIA_DIR, name)); } catch { /* file đã mất */ }
  }

  db.prepare('DELETE FROM film_scenes WHERE project_id IN (SELECT id FROM film_projects WHERE user_id = ?)').run(id);
  db.prepare('DELETE FROM film_characters WHERE project_id IN (SELECT id FROM film_projects WHERE user_id = ?)').run(id);
  db.prepare('DELETE FROM film_projects WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM jobs WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM ledger WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE owner_id = ?').run(id);
  db.prepare('DELETE FROM orders WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM replies WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)').run(id);
  db.prepare('DELETE FROM replies WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM post_likes WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM post_likes WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)').run(id);
  db.prepare('DELETE FROM posts WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM uploads WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM api_keys WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM memberships WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM bind_codes WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM queue_items WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  auditLog(req.user.id, 'delete_user', 'user', id, `Xóa người dùng ${user.email}`);
  res.json({ ok: true });
});

/* Đặt lại mật khẩu cho user (không nhập thì tạo ngẫu nhiên 10 ký tự) */
r.post('/users/:id/reset-password', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Người dùng không tồn tại' });
  let { password } = req.body || {};
  if (password === undefined || password === null || password === '') {
    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const buf = crypto.randomBytes(10);
    password = [...buf].map((b) => CHARS[b % CHARS.length]).join('');
  }
  if (String(password).length < 6) return res.status(400).json({ error: 'Mật khẩu ít nhất 6 ký tự' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(password)), user.id);
  auditLog(req.user.id, 'reset_password', 'user', user.id, `Đặt lại mật khẩu cho ${user.email}`);
  res.json({ ok: true, password: String(password) });
});

/* Đặt hạn mức riêng cho user (null = không giới hạn / dùng mặc định chung) */
r.patch('/users/:id/limits', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Người dùng không tồn tại' });
  const { daily_credit_cap, max_concurrent_jobs, media_max_mb } = req.body || {};
  const parse = (v, name) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} phải là số nguyên >= 0 hoặc null`);
    return n;
  };
  let caps;
  try {
    caps = {
      daily_credit_cap: parse(daily_credit_cap, 'Hạn mức điểm/ngày'),
      max_concurrent_jobs: parse(max_concurrent_jobs, 'Số job chạy cùng lúc'),
      media_max_mb: parse(media_max_mb, 'Dung lượng media'),
    };
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  db.prepare('UPDATE users SET daily_credit_cap = ?, max_concurrent_jobs = ?, media_max_mb = ? WHERE id = ?')
    .run(caps.daily_credit_cap, caps.max_concurrent_jobs, caps.media_max_mb, user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  auditLog(req.user.id, 'set_limits', 'user', user.id,
    `Đặt hạn mức cho ${user.email}: điểm/ngày=${caps.daily_credit_cap ?? 'không giới hạn'}, job cùng lúc=${caps.max_concurrent_jobs ?? 'không giới hạn'}, media=${caps.media_max_mb ?? 'mặc định'} MB`);
  res.json({ user: { ...publicUser(updated), limits: userLimits(updated) } });
});

/* Lịch sử điểm toàn hệ thống */
r.get('/ledger', (req, res) => {
  const userId = String(req.query.user_id || '').trim();
  const reason = String(req.query.reason || '').trim();
  let limit = Number(req.query.limit || 100);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  limit = Math.min(limit, 500);
  const where = [];
  const args = [];
  if (userId) { where.push('l.user_id = ?'); args.push(userId); }
  if (reason) { where.push('l.reason LIKE ?'); args.push(`%${reason}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const entries = db.prepare(
    `SELECT l.id, l.user_id, u.email, l.delta, l.balance_after, l.reason, l.job_id, l.created_at
     FROM ledger l LEFT JOIN users u ON u.id = l.user_id ${w} ORDER BY l.created_at DESC LIMIT ?`
  ).all(...args, limit);
  res.json({ entries });
});

/* Nhật ký quản trị */
r.get('/audit', (req, res) => {
  let limit = Number(req.query.limit || 100);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  limit = Math.min(limit, 500);
  const entries = db.prepare(
    `SELECT a.id, u.email AS admin_email, a.action, a.target_type, a.target_id, a.detail, a.created_at
     FROM admin_audit a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.created_at DESC LIMIT ?`
  ).all(limit);
  res.json({ entries });
});

/* ------------------------------ VIP ------------------------------ */
/* Danh sách đơn VIP (lọc theo trạng thái / tìm theo email user). */
r.get('/vip/orders', (req, res) => {
  const status = String(req.query.status || '').trim();
  const q = String(req.query.q || '').trim();
  const where = [];
  const args = [];
  if (['pending', 'paid', 'expired', 'underpaid', 'canceled'].includes(status)) { where.push('v.status = ?'); args.push(status); }
  if (q) { where.push('u.email LIKE ?'); args.push(`%${q}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT v.*, u.email AS user_email FROM vip_orders v
     LEFT JOIN users u ON u.id = v.user_id ${w} ORDER BY v.created_at DESC LIMIT 100`
  ).all(...args);
  res.json({ orders: rows });
});

/* Cấp VIP tay cho user (cộng thêm `days` ngày, nối tiếp hạn hiện tại nếu còn). */
r.post('/vip/grant', (req, res) => {
  const { userId, days } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Người dùng không tồn tại' });
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) return res.status(400).json({ error: 'Số ngày VIP không hợp lệ' });
  const exp = grantVip(user.id, d);
  auditLog(req.user.id, 'vip_grant', 'user', user.id, `Cấp VIP ${d} ngày cho ${user.email} (hết hạn ${new Date(exp).toISOString()})`);
  res.json({ ok: true, vipExpiresAt: exp });
});

/* Thu hồi quyền VIP của user. */
r.post('/vip/revoke', (req, res) => {
  const { userId } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Người dùng không tồn tại' });
  revokeVip(user.id);
  auditLog(req.user.id, 'vip_revoke', 'user', user.id, `Thu hồi VIP của ${user.email}`);
  res.json({ ok: true });
});

/* Xác nhận tay một đơn VIP (pending/underpaid/expired): đánh dấu đã trả + cấp VIP theo số ngày của đơn. */
r.post('/vip/orders/:id/confirm', (req, res) => {
  const order = db.prepare('SELECT * FROM vip_orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Đơn không tồn tại' });
  if (order.status === 'paid') return res.status(400).json({ error: 'Đơn đã được thanh toán' });
  if (order.status === 'canceled') return res.status(400).json({ error: 'Đơn đã bị hủy' });
  const ts = Date.now();
  db.prepare("UPDATE vip_orders SET status = 'paid', paid_at = ?, note = ? WHERE id = ?")
    .run(ts, 'Admin xác nhận tay', order.id);
  const exp = grantVip(order.user_id, order.duration_days);
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(order.user_id);
  auditLog(req.user.id, 'vip_confirm', 'vip_order', order.id,
    `Xác nhận tay đơn VIP ${order.code} (${order.amount_vnd}đ, ${order.duration_days} ngày) cho ${user?.email || order.user_id}`);
  res.json({ ok: true, vipExpiresAt: exp });
});

/* Danh sách tài khoản Muse (kèm cờ VIP + số lượt VIP đã dùng hôm nay / giới hạn ngày). */
r.get('/accounts', (req, res) => {
  const rows = db.prepare(
    `SELECT a.*, u.email AS owner_email FROM accounts a
     LEFT JOIN users u ON u.id = a.owner_id ORDER BY a.created_at DESC LIMIT 200`
  ).all();
  const dailyLimit = getVipDailyLimit();
  const accounts = rows.map((a) => {
    if (Number(a.vip) !== 1) return { ...a, todayUsed: null, dailyLimit: null };
    return { ...a, todayUsed: vipAccountTodayCount(a.upstream_id), dailyLimit };
  });
  res.json({ accounts });
});

/* Đánh dấu / bỏ đánh dấu một tài khoản Muse là VIP (do admin cung cấp). */
r.patch('/accounts/:id/vip', (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Tài khoản không tồn tại' });
  const vip = req.body?.vip === true || req.body?.vip === 1 || req.body?.vip === '1';
  db.prepare('UPDATE accounts SET vip = ? WHERE id = ?').run(vip ? 1 : 0, row.id);
  auditLog(req.user.id, 'vip_account', 'account', row.id,
    `${vip ? 'Đánh dấu' : 'Bỏ đánh dấu'} tài khoản Muse "${row.label}" là VIP`);
  res.json({ ok: true, account: { ...row, vip: vip ? 1 : 0 } });
});

r.post('/users', (req, res) => {
  const { email, password, name, role } = req.body || {};
  if (!email || !String(email).includes('@')) return res.status(400).json({ error: 'Email không hợp lệ' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mật khẩu ít nhất 6 ký tự' });
  if (role && !['user', 'admin'].includes(role)) return res.status(400).json({ error: 'Role không hợp lệ' });
  try {
    const u = createUser({ email, password, name, role: role || 'user', credits: 0 });
    auditLog(req.user.id, 'create_user', 'user', u.id, `Tạo người dùng ${u.email} (role ${u.role})`);
    res.json({ user: publicUser(u) });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'Email đã tồn tại' : e.message });
  }
});

r.patch('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Người dùng không tồn tại' });
  const { credits, role, status, password } = req.body || {};
  const changes = [];
  if (credits !== undefined && credits !== null) {
    const delta = Number(credits);
    if (delta !== 0) {
      addCredits(user.id, delta, delta > 0 ? 'Quản trị viên nạp điểm' : 'Quản trị viên trừ điểm');
      changes.push(`điểm ${delta > 0 ? '+' : ''}${delta}`);
    }
  }
  if (role && ['user', 'admin'].includes(role)) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
    changes.push(`role → ${role}`);
  }
  if (status && ['active', 'banned'].includes(status)) {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, user.id);
    changes.push(`trạng thái → ${status}`);
  }
  auditLog(req.user.id, 'update_user', 'user', user.id, `Cập nhật ${user.email}: ${changes.join(', ') || 'không thay đổi'}`);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

/* ------------------------------ 订单 ------------------------------ */
r.get('/orders', (req, res) => {
  const { kind } = req.query;
  const base = `SELECT o.*, u.email FROM orders o LEFT JOIN users u ON u.id = o.user_id`;
  const rows = kind
    ? db.prepare(`${base} WHERE o.kind = ? ORDER BY o.created_at DESC LIMIT 200`).all(kind)
    : db.prepare(`${base} ORDER BY o.created_at DESC LIMIT 200`).all();
  res.json({ orders: rows });
});

/* ------------------------------ 社区 ------------------------------ */
r.get('/posts', (_req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.email,
      (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS reply_count
    FROM posts p LEFT JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC LIMIT 200
  `).all();
  res.json({ posts: rows });
});

r.delete('/posts/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM replies WHERE post_id = ?').run(req.params.id);
  if (post) auditLog(req.user.id, 'delete_post', 'post', post.id, `Xóa bài viết "${post.title}"`);
  res.json({ ok: true });
});

/* ---------------------------- 7 天趋势 ---------------------------- */
r.get('/trend', (_req, res) => {
  const dayMs = 86400000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const from = today.getTime() - i * dayMs;
    const to = from + dayMs;
    days.push({
      date: new Date(from).toISOString().slice(5, 10),
      jobs: db.prepare('SELECT COUNT(*) n FROM jobs WHERE created_at >= ? AND created_at < ?').get(from, to).n,
      credits: db.prepare("SELECT COALESCE(-SUM(delta),0) n FROM ledger WHERE delta < 0 AND created_at >= ? AND created_at < ?").get(from, to).n,
      recharge: db.prepare("SELECT COALESCE(SUM(amount),0) n FROM orders WHERE kind='recharge' AND status='paid' AND created_at >= ? AND created_at < ?").get(from, to).n,
    });
  }
  res.json({ days });
});

r.get('/settings', (_req, res) => res.json({ settings: getSettings() }));

/* Thống kê dung lượng media trên server (để admin đặt mức trần + xem đã dùng bao nhiêu). */
r.get('/media-stats', (_req, res) => res.json(mediaStats()));

/* Dọn media ngay lập tức (quá hạn + vượt dung lượng), trả về kết quả dọn. */
r.post('/media-cleanup', (_req, res) => {
  try {
    res.json(cleanupMedia());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
r.patch('/settings', (req, res) => {
  const allow = ['siteName', 'signupCredits', 'priceVideoBase', 'priceVideoPerSecond', 'priceImage', 'allowRegister', 'notice', 'mediaMaxMB', 'mediaRetentionDays', 'mediaGlobalMaxMB',
    'vipPriceDayVnd', 'vipPriceWeekVnd', 'vipPriceMonthVnd', 'vipDailyVideoLimit', 'sepayMailApiUrl', 'sepayMailApiToken', 'sepayMbAccountNo', 'sepayMbAccountName', 'sepayMbBin', 'sepayCodePrefix', 'vipOrderTtlMin', 'vipPollSeconds'];
  const changed = [];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (allow.includes(k)) { setSetting(k, v); changed.push(k); }
  }
  if (changed.length) auditLog(req.user.id, 'update_settings', 'settings', null, `Cập nhật cài đặt: ${changed.join(', ')}`);
  res.json({ settings: getSettings() });
});

r.get('/system', async (_req, res) => {
  const out = { upstream: null, error: null };
  try {
    const st = await muse.status();
    out.upstream = st;
    for (const a of st.accounts || []) {
      upsertAccount({
        upstreamId: a.id,
        label: a.label,
        status: a.ok === true ? 'ok' : a.ok === false ? 'error' : 'unknown',
        expiresAt: a.expires_at || null,
        quota: a.quota ? JSON.stringify(a.quota) : null,
        note: a.note || null,
      });
    }
  } catch (e) {
    out.error = e.message;
  }
  res.json(out);
});

r.post('/keepalive', async (_req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM accounts WHERE upstream_id IS NOT NULL').all();
    const results = [];
    for (const row of rows) {
      try {
        const out = await muse.keepaliveAccount(row.upstream_id);
        results.push({ id: row.id, label: row.label, ok: true, out });
      } catch (e) {
        results.push({ id: row.id, label: row.label, ok: false, error: e.message });
      }
    }
    res.json({ results });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default r;
