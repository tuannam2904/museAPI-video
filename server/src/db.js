import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CFG, DB_FILE, MEDIA_DIR } from './config.js';

fs.mkdirSync(CFG.dataDir, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  credits       INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  type        TEXT NOT NULL,              -- video | image
  prompt      TEXT NOT NULL,
  params      TEXT NOT NULL DEFAULT '{}', -- 请求参数 JSON
  upstream_id TEXT,
  status      TEXT NOT NULL DEFAULT 'queued', -- queued|processing|completed|failed|canceled
  progress    INTEGER NOT NULL DEFAULT 0,
  cost        INTEGER NOT NULL DEFAULT 0,
  refunded    INTEGER NOT NULL DEFAULT 0,
  result      TEXT,
  error       TEXT,
  media_file  TEXT,
  account_id  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_user  ON jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(status);

CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  upstream_id TEXT UNIQUE,
  label       TEXT NOT NULL,
  owner_id    TEXT,                       -- null = 公共池
  status      TEXT NOT NULL DEFAULT 'unknown',
  expires_at  INTEGER,
  quota       TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  synced_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  delta         INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  job_id        TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS film_projects (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  title          TEXT NOT NULL,
  idea           TEXT NOT NULL,
  genre          TEXT NOT NULL DEFAULT 'đời thường',
  duration_total INTEGER NOT NULL DEFAULT 30,
  scene_duration INTEGER NOT NULL DEFAULT 5,
  style          TEXT NOT NULL DEFAULT 'điện ảnh',
  aspect         TEXT NOT NULL DEFAULT '9:16',
  script         TEXT,
  status         TEXT NOT NULL DEFAULT 'draft', -- draft|script|storyboard|generating|ready|done
  final_file     TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_films_user ON film_projects(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS film_scenes (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  duration     INTEGER NOT NULL DEFAULT 5,
  description  TEXT NOT NULL DEFAULT '',
  characters   TEXT NOT NULL DEFAULT '',
  action       TEXT NOT NULL DEFAULT '',
  camera       TEXT NOT NULL DEFAULT '',
  lighting     TEXT NOT NULL DEFAULT '',
  setting      TEXT NOT NULL DEFAULT '',
  image_prompt TEXT NOT NULL DEFAULT '',
  video_prompt TEXT NOT NULL DEFAULT '',
  image_job_id TEXT,
  video_job_id TEXT,
  image_media  TEXT,
  video_media  TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|image|image_done|video|done|failed
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_film_scenes_proj ON film_scenes(project_id, sort_order);

CREATE TABLE IF NOT EXISTS film_characters (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  name         TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  photos       TEXT NOT NULL DEFAULT '[]',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_film_chars_proj ON film_characters(project_id, created_at);

CREATE TABLE IF NOT EXISTS uploads (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bind_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  label      TEXT,
  status     TEXT NOT NULL DEFAULT 'pending',   -- pending | done | expired
  account_id TEXT,
  message    TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bind_user ON bind_codes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,              -- recharge | membership
  amount     REAL NOT NULL DEFAULT 0,    -- 人民币
  credits    INTEGER NOT NULL DEFAULT 0,
  plan       TEXT,
  status     TEXT NOT NULL DEFAULT 'pending', -- pending | paid | canceled
  created_at INTEGER NOT NULL,
  paid_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memberships (
  user_id    TEXT PRIMARY KEY,
  plan       TEXT NOT NULL,
  credits    INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

/* Đơn mua VIP qua SePay (VietQR + chuyển khoản MB): một đơn = một gói ngày/tuần/tháng */
CREATE TABLE IF NOT EXISTS vip_orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  code          TEXT NOT NULL UNIQUE,   -- mã chuyển khoản, VD VIP123456
  amount_vnd    INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|paid|expired|underpaid|canceled
  duration_days INTEGER NOT NULL DEFAULT 30,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,       -- hạn thanh toán (TTL)
  paid_at       INTEGER,
  payment_id    INTEGER,                -- id giao dịch bên Worker/D1
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_vip_orders_user ON vip_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vip_orders_code ON vip_orders(code);

CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'chat',
  title      TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  likes      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_cat ON posts(category, created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS replies (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id, created_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT 'Khóa mặc định',
  key        TEXT NOT NULL UNIQUE,
  last_used  INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keys_user ON api_keys(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS queue_items (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  params       TEXT NOT NULL DEFAULT '{}',
  interval_min INTEGER NOT NULL DEFAULT 5,
  max_runs     INTEGER NOT NULL DEFAULT 3,
  runs         INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|running|paused|done|failed
  next_run_at  INTEGER,
  last_run_at  INTEGER,
  job_id       TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_user ON queue_items(user_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_queue_due ON queue_items(status, next_run_at);
`);

// 邀请关系（老库自动补列）
try {
  db.exec('ALTER TABLE users ADD COLUMN invited_by TEXT');
} catch { /* 已存在 */ }

// Hạn mức riêng từng user (để admin quản lý nhiều người dùng)
for (const col of ['daily_credit_cap INTEGER', 'max_concurrent_jobs INTEGER', 'media_max_mb INTEGER', 'daily_video_limit INTEGER']) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* đã có */ }
}

// VIP: tài khoản Muse nào là VIP (admin đánh dấu) + user nào đang có quyền VIP (hết hạn khi nào)
try { db.exec('ALTER TABLE accounts ADD COLUMN vip INTEGER NOT NULL DEFAULT 0'); } catch { /* đã có */ }
try { db.exec('ALTER TABLE users ADD COLUMN vip_expires_at INTEGER'); } catch { /* đã có */ }

// Prompt-writer pool: nhiều tài khoản có thể làm prompt-writer (accounts.prompt_writer = 1),
// thay cho setting cũ prompt_writer_account_id chỉ cho phép đúng 1 tài khoản.
try { db.exec('ALTER TABLE accounts ADD COLUMN prompt_writer INTEGER NOT NULL DEFAULT 0'); } catch { /* đã có */ }

// Di chuyển một lần từ setting cũ sang cột prompt_writer (lũy tiến, bỏ qua khi lỗi).
try {
  const legacy = db.prepare("SELECT value FROM settings WHERE key = 'prompt_writer_account_id'").get();
  if (legacy?.value) {
    const acc = db.prepare('SELECT id FROM accounts WHERE id = ?').get(legacy.value);
    if (acc) db.prepare('UPDATE accounts SET prompt_writer = 1 WHERE id = ?').run(acc.id);
    db.prepare("DELETE FROM settings WHERE key = 'prompt_writer_account_id'").run();
  }
} catch { /* bỏ qua */ }

db.exec(`
CREATE TABLE IF NOT EXISTS admin_audit (
  id         TEXT PRIMARY KEY,
  admin_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  target_type TEXT,
  target_id  TEXT,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit(created_at DESC);
`);

export const uid = (p = '') => p + crypto.randomBytes(9).toString('hex');
export const now = () => Date.now();

/* ------------------------------ nhật ký quản trị ------------------------------ */
export function auditLog(adminId, action, targetType, targetId, detail) {
  db.prepare(
    'INSERT INTO admin_audit(id, admin_id, action, target_type, target_id, detail, created_at) VALUES(?,?,?,?,?,?,?)'
  ).run(uid('audit_'), adminId, action, targetType ?? null, targetId ?? null, detail ?? null, now());
}

/* ------------------------------- settings ------------------------------- */
const DEFAULT_SETTINGS = {
  siteName: 'Aimi Muse Studio',
  signupCredits: String(CFG.signupCredits),
  priceVideoBase: String(CFG.price.videoBase),
  priceVideoPerSecond: String(CFG.price.videoPerSecond),
  priceImage: String(CFG.price.image),
  allowRegister: CFG.allowRegister ? '1' : '0',
  notice: '',
  // Dung lượng media tối đa MỖI USER trên server (MB) — user nào vượt thì tự xóa file cũ nhất của chính user đó.
  mediaMaxMB: '1024',
  // Mức trần toàn server (MB) — tổng media của mọi user cộng lại.
  mediaGlobalMaxMB: '5120',
  // Giữ file media bao nhiêu ngày rồi tự xóa.
  mediaRetentionDays: '7',
  // VIP: giá 3 gói (ngày/tuần/tháng, VND). Thời hạn gói là cố định: ngày=1, tuần=7, tháng=30.
  vipPriceDayVnd: '9000',
  vipPriceWeekVnd: '49000',
  vipPriceMonthVnd: '99000',
  // VIP: giới hạn số lượt tạo (video + ảnh) MỖI tài khoản Muse VIP được dùng trong 1 ngày
  // (tính từ 0h đến 24h giờ địa phương). Hết lượt thì acc đó nghỉ đến ngày mai;
  // user muốn tạo thêm thì tự thêm tài khoản Muse của mình. Đổi được trong Admin.
  vipDailyVideoLimit: '100',
  // Giới hạn số video/ảnh MỖI user được tạo trong 1 ngày (tính từ 0h đến 24h giờ
  // địa phương) khi tạo bằng tài khoản Muse của chính họ — đây là giới hạn duy nhất
  // thay cho hệ điểm. Rỗng = không giới hạn. Hạn mức riêng từng user
  // (users.daily_video_limit) ưu tiên hơn giá trị chung này. Đổi được trong Admin.
  dailyVideoLimit: '100',
  // SePay (VietQR + chuyển khoản MB): Worker nhận webhook rồi cho platform poll.
  sepayMailApiUrl: '',
  sepayMailApiToken: '',
  sepayMbAccountNo: '1136226868',
  sepayMbAccountName: 'NGUYEN TUAN NAM',
  sepayMbBin: '970422',
  sepayCodePrefix: 'VIP',
  // Con trỏ poll Worker (id giao dịch lớn nhất đã thấy) + chu kỳ poll.
  vipSePaySince: '0',
  vipOrderTtlMin: '10',
  vipPollSeconds: '15',
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function getSetting(key) {
  return getSettings()[key] ?? DEFAULT_SETTINGS[key];
}

/* --------------------------------- VIP --------------------------------- */
export function isVip(userId) {
  const u = db.prepare('SELECT vip_expires_at FROM users WHERE id = ?').get(userId);
  return !!(u && u.vip_expires_at && u.vip_expires_at > now());
}

export function vipExpiresAt(userId) {
  const u = db.prepare('SELECT vip_expires_at FROM users WHERE id = ?').get(userId);
  return u?.vip_expires_at ?? null;
}

/* Cộng thêm `days` ngày VIP: nối tiếp từ hạn hiện tại nếu còn hạn, không thì từ bây giờ. */
export function grantVip(userId, days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) throw new Error('Số ngày VIP không hợp lệ');
  const u = db.prepare('SELECT vip_expires_at FROM users WHERE id = ?').get(userId);
  if (!u) throw new Error('Người dùng không tồn tại');
  const base = Math.max(now(), u.vip_expires_at || 0);
  const exp = base + Math.round(d * 86400000);
  db.prepare('UPDATE users SET vip_expires_at = ? WHERE id = ?').run(exp, userId);
  return exp;
}

export function revokeVip(userId) {
  db.prepare('UPDATE users SET vip_expires_at = NULL WHERE id = ?').run(userId);
}

/* ------------------------- giới hạn số video/ngày ------------------------- */
/** Số video + ảnh user đã tạo từ 0h hôm nay (giờ địa phương của server).
 * Đếm mọi job đã tạo, không lọc trạng thái: job đã tạo là đã chiếm 1 lượt,
 * dù sau đó thành công hay thất bại. */
export function userTodayVideoCount(userId) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const row = db.prepare(
    'SELECT COUNT(*) n FROM jobs WHERE user_id = ? AND created_at >= ?'
  ).get(userId, d.getTime());
  return Number(row?.n) || 0;
}

/** Giới hạn số video/ảnh user được tạo trong 1 ngày: hạn mức riêng của user
 * (users.daily_video_limit) ưu tiên; không có thì lấy giá trị chung
 * (setting dailyVideoLimit); rỗng/không hợp lệ = không giới hạn (null). */
export function getDailyVideoLimit(userId) {
  const u = db.prepare('SELECT daily_video_limit FROM users WHERE id = ?').get(userId);
  if (u && u.daily_video_limit != null) return u.daily_video_limit;
  const raw = getSetting('dailyVideoLimit');
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/* -------------------------------- ledger -------------------------------- */
export function addCredits(userId, delta, reason, jobId = null) {
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('Người dùng không tồn tại');
  const after = user.credits + delta;
  db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(after, userId);
  db.prepare(
    'INSERT INTO ledger(id, user_id, delta, balance_after, reason, job_id, created_at) VALUES(?,?,?,?,?,?,?)'
  ).run(uid('l_'), userId, delta, after, reason, jobId, now());
  return after;
}

export function priceOf(type, params = {}) {
  const s = getSettings();
  if (type === 'video') {
    const sec = Number(params.duration) || 5;
    return Number(s.priceVideoBase) + Number(s.priceVideoPerSecond) * sec;
  }
  return Number(s.priceImage);
}

/* --------------------------------- jobs --------------------------------- */
export function createJob(userId, type, prompt, params, cost) {
  const id = uid('job_');
  const ts = now();
  db.prepare(
    `INSERT INTO jobs(id, user_id, type, prompt, params, status, progress, cost, created_at, updated_at)
     VALUES(?,?,?,?,?,'queued',0,?,?,?)`
  ).run(id, userId, type, prompt, JSON.stringify(params || {}), cost, ts, ts);
  return getJob(id);
}

export function getJob(id) {
  const j = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return j ? shapeJob(j) : null;
}

export function shapeJob(j) {
  let params = {};
  let result = null;
  try { params = JSON.parse(j.params || '{}'); } catch { params = {}; }
  try { result = j.result ? JSON.parse(j.result) : null; } catch { result = null; }
  return {
    id: j.id,
    userId: j.user_id,
    type: j.type,
    prompt: j.prompt,
    params,
    upstreamId: j.upstream_id || null,
    status: j.status,
    progress: j.progress,
    cost: j.cost,
    refunded: !!j.refunded,
    result,
    error: j.error || null,
    mediaUrl: j.media_file ? `/media/${j.media_file}` : null,
    mediaFile: j.media_file,
    accountId: j.account_id,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
    finishedAt: j.finished_at,
  };
}

export function updateJob(id, patch) {
  const allowed = ['upstream_id', 'status', 'progress', 'result', 'error', 'media_file', 'account_id', 'finished_at', 'refunded'];
  const cols = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue;
    cols.push(`${k} = ?`);
    vals.push(v === undefined ? null : v);
  }
  if (!cols.length) return;
  cols.push('updated_at = ?');
  vals.push(now(), id);
  db.prepare(`UPDATE jobs SET ${cols.join(', ')} WHERE id = ?`).run(...vals);
}

export function listJobs({ userId, type, status, page = 1, pageSize = 24 }) {
  const where = [];
  const args = [];
  if (userId) { where.push('user_id = ?'); args.push(userId); }
  if (type) { where.push('type = ?'); args.push(type); }
  if (status) { where.push('status = ?'); args.push(status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM jobs ${w}`).get(...args).n;
  const rows = db
    .prepare(`SELECT * FROM jobs ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize);
  return { total, jobs: rows.map(shapeJob) };
}

export function pendingJobs() {
  return db
    .prepare("SELECT * FROM jobs WHERE status IN ('queued','processing') AND upstream_id IS NOT NULL")
    .all()
    .map(shapeJob);
}

/* ------------------------------- accounts ------------------------------- */
export function upsertAccount({ upstreamId, label, ownerId, status, expiresAt, quota, note }) {
  const existing = upstreamId
    ? db.prepare('SELECT * FROM accounts WHERE upstream_id = ?').get(upstreamId)
    : null;
  const ts = now();
  if (existing) {
    db.prepare(
      `UPDATE accounts SET label = ?, status = ?, expires_at = ?, quota = ?, note = ?, synced_at = ?
       WHERE upstream_id = ?`
    ).run(label ?? existing.label, status ?? existing.status,
      expiresAt ?? existing.expires_at, quota ?? existing.quota,
      note ?? existing.note, ts, upstreamId);
    return db.prepare('SELECT * FROM accounts WHERE upstream_id = ?').get(upstreamId);
  }
  const id = uid('acc_');
  db.prepare(
    `INSERT INTO accounts(id, upstream_id, label, owner_id, status, expires_at, quota, note, created_at, synced_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)`
  ).run(id, upstreamId ?? null, label || 'Tài khoản Muse', ownerId ?? null,
    status || 'unknown', expiresAt ?? null, quota ?? null, note ?? null, ts, ts);
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

export function listAccounts(ownerId) {
  if (ownerId) {
    return db.prepare('SELECT * FROM accounts WHERE owner_id = ? OR owner_id IS NULL ORDER BY created_at DESC').all(ownerId);
  }
  return db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all();
}

export function deleteAccountRow(id) {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

/* ------------------------------ 绑定码 ------------------------------ */
const BIND_TTL = 20 * 60 * 1000; // 20 分钟

export function createBindCode(userId, label) {
  const code = crypto.randomBytes(16).toString('base64url');
  const ts = now();
  db.prepare(
    'INSERT INTO bind_codes(code, user_id, label, status, created_at, expires_at) VALUES(?,?,?,?,?,?)'
  ).run(code, userId, label || null, 'pending', ts, ts + BIND_TTL);
  return { code, expiresAt: ts + BIND_TTL };
}

export function getBindCode(code) {
  const row = db.prepare('SELECT * FROM bind_codes WHERE code = ?').get(code);
  if (!row) return null;
  if (row.status === 'pending' && row.expires_at < now()) {
    db.prepare("UPDATE bind_codes SET status = 'expired' WHERE code = ?").run(code);
    row.status = 'expired';
  }
  return row;
}

export function finishBindCode(code, { accountId, message }) {
  db.prepare(
    "UPDATE bind_codes SET status = 'done', account_id = ?, message = ?, used_at = ? WHERE code = ?"
  ).run(accountId ?? null, message ?? null, now(), code);
}

export function failBindCode(code, message) {
  db.prepare('UPDATE bind_codes SET message = ? WHERE code = ?').run(message, code);
}
