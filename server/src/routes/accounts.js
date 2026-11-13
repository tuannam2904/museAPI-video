import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  listAccounts as localAccounts, upsertAccount, deleteAccountRow, db, now,
  createBindCode, getBindCode, finishBindCode, failBindCode, auditLog,
} from '../db.js';
import * as muse from '../muse.js';
import { vipAccountTodayCount, getVipDailyLimit } from '../lib/accounts.js';

const r = Router();

/* ---------------------------- 额度解析 ----------------------------
 * 上游 /admin/accounts 返回的 quota 形如：
 * { raw, weekly_reset: '11月11日', weekly_used_pct: 40, found: true, checked_at }
 * raw 里还带「已使用 0%(剩余 309 亿个词元)」这样的额外额度信息。
 */
function parseQuota(q) {
  if (!q || typeof q !== 'object') return null;
  if (!q.found && q.weekly_used_pct == null) return null;

  const raw = String(q.raw || '');
  // Số tokens còn lại: ưu tiên dạng tiếng Trung "剩余 309 亿个词元",
  // dự phòng dạng tiếng Anh "309 billion tokens remaining".
  const tokens = raw.match(/剩余\s*([\d.]+\s*[亿万]?)\s*个词元/)
    || raw.match(/([\d.]+\s*(?:billion|million|tỷ|triệu)?)\s*tokens?\s*(?:remaining|left|remained)/i);

  const usedPct = typeof q.weekly_used_pct === 'number' ? q.weekly_used_pct : null;
  return {
    weeklyUsedPct: usedPct,
    weeklyLeftPct: usedPct != null ? Math.max(0, Math.min(100, 100 - usedPct)) : null,
    weeklyReset: q.weekly_reset || null,
    tokensLeft: tokens ? tokens[1].replace(/\s+/g, '') : null,
    extraLeft: q.extra_left || null,
    extraUsedPct: typeof q.extra_used_pct === 'number' ? q.extra_used_pct : null,
    plan: q.plan || null,
    checkedAt: q.checked_at || null,
    ok: q.found === true,
  };
}

/* Đếm số job đã tạo xong theo từng tài khoản upstream (jobs.account_id).
 * Chỉ đếm job completed — đó mới là video/ảnh thực sự đã tạo ra. */
function jobCountsByAccount() {
  const rows = db.prepare(
    `SELECT account_id, type, COUNT(*) AS c FROM jobs
     WHERE status = 'completed' AND account_id IS NOT NULL
     GROUP BY account_id, type`
  ).all();
  const map = new Map();
  for (const r of rows) {
    const e = map.get(r.account_id) || { video: 0, image: 0 };
    if (r.type === 'video') e.video = r.c;
    else if (r.type === 'image') e.image = r.c;
    map.set(r.account_id, e);
  }
  return map;
}

/* ---------------------------- 免 F12 绑定 ----------------------------
 * 流程：平台生成一次性 code → 浏览器扩展读 muse.ai 的 HttpOnly cookie
 *      → POST /api/accounts/bind（用 code 认证，不需要 JWT）→ 导入上游。
 */

// 生成绑定码（已登录用户在平台上点「一键绑定」）
r.post('/bind-code', requireAuth, (req, res) => {
  const { label } = req.body || {};
  const { code, expiresAt } = createBindCode(req.user.id, label);
  res.json({ code, expiresAt, url: `/bind/${code}` });
});

// 查询绑定状态（绑定页轮询用，公开读）
r.get('/bind/:code', (req, res) => {
  const row = getBindCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Mã liên kết không tồn tại' });
  res.json({
    status: row.status,
    message: row.message || null,
    accountId: row.account_id || null,
    expiresAt: row.expires_at,
    label: row.label,
  });
});

// 扩展 / 油猴脚本提交 cookie（公开，用一次性 code 认证）
r.post('/bind', async (req, res) => {
  const { code, cookie, label } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Thiếu mã liên kết' });
  if (!cookie || String(cookie).trim().length < 10) {
    return res.status(400).json({ error: 'Chưa nhận được Cookie, vui lòng kiểm tra trình duyệt đã đăng nhập muse.ai' });
  }

  const row = getBindCode(code);
  if (!row) return res.status(404).json({ error: 'Mã liên kết không tồn tại' });
  if (row.status === 'expired') return res.status(410).json({ error: 'Mã liên kết đã hết hạn, vui lòng tạo lại trên nền tảng' });
  if (row.status === 'done') return res.status(409).json({ error: 'Mã liên kết này đã được sử dụng' });

  const cleaned = String(cookie).replace(/^cookie\s*:\s*/i, '').replace(/\s*\n\s*/g, '; ');
  if (!/hatch_sess=/.test(cleaned)) {
    const msg = 'Cookie không có hatch_sess, trình duyệt này có thể chưa đăng nhập muse.ai';
    failBindCode(code, msg);
    return res.status(400).json({ error: msg });
  }

  let result;
  try {
    result = await muse.addAccount({
      label: label || row.label || `muse-${new Date().toISOString().slice(5, 16)}`,
      cookie: cleaned,
    });
  } catch (e) {
    failBindCode(code, e.message);
    return res.status(502).json({ error: `Upstream từ chối nhập：${e.message}` });
  }

  const added = (result.added || [])[0];
  if (!added) {
    const msg = 'Upstream không trả về thông tin tài khoản';
    failBindCode(code, msg);
    return res.status(502).json({ error: msg });
  }

  const acc = upsertAccount({
    upstreamId: added.id,
    label: added.label,
    ownerId: row.user_id,
    status: 'unknown',
    expiresAt: added.expires_at || null,
  });

  finishBindCode(code, { accountId: acc.id, message: result.warning || 'Liên kết thành công' });

  res.json({
    ok: true,
    account: { id: acc.id, upstreamId: acc.upstream_id, label: acc.label },
    warning: result.warning || null,
  });
});

// 把上游账号池与本地镜像对齐（上游新增/删除时同步）
async function syncFromUpstream() {
  try {
    const { accounts } = await muse.listAccounts();
    for (const a of accounts) {
      upsertAccount({
        upstreamId: a.id,
        label: a.label,
        status: a.ok === true ? 'ok' : a.ok === false ? 'error' : 'unknown',
        expiresAt: a.expires_at || null,
        quota: a.quota ? JSON.stringify(a.quota) : null,
        note: a.note || null,
      });
    }
    return accounts;
  } catch (e) {
    return [];
  }
}

r.get('/', requireAuth, async (req, res) => {
  const upstream = await syncFromUpstream();
  const upMap = new Map(upstream.map((a) => [a.id, a]));
  const local = localAccounts(req.user.role === 'admin' ? null : req.user.id);
  const counts = jobCountsByAccount();

  const accounts = local.map((a) => {
    const up = a.upstream_id ? upMap.get(a.upstream_id) : null;
    let stored = null;
    try { stored = a.quota ? JSON.parse(a.quota) : null; } catch { stored = null; }
    const quota = parseQuota(up?.quota ?? stored);
    const c = (a.upstream_id && counts.get(a.upstream_id)) || { video: 0, image: 0 };
    const isVipAcc = Number(a.vip) === 1;
    return {
      id: a.id,
      upstreamId: a.upstream_id,
      label: a.label,
      mine: a.owner_id === req.user.id,
      shared: a.owner_id === null,
      isPromptWriter: Number(a.prompt_writer) === 1,
      isVip: isVipAcc,
      // Acc VIP: số lượt tạo đã dùng hôm nay / giới hạn lượt/ngày (Admin xem "45/100 hôm nay").
      todayUsed: isVipAcc ? vipAccountTodayCount(a.upstream_id) : null,
      dailyLimit: isVipAcc ? getVipDailyLimit() : null,
      status: up ? (up.ok === true ? 'ok' : up.ok === false ? 'error' : 'unknown') : 'missing',
      note: up?.note || a.note || null,
      expiresAt: up?.expires_at ?? a.expires_at,
      proxy: up?.proxy || null,
      quota,
      useCount: typeof up?.use_count === 'number' ? up.use_count : null,
      lastUsed: up?.last_used ? Math.round(Number(up.last_used)) : null,
      videoCount: c.video,
      imageCount: c.image,
      busy: !!up?.busy,
      createdAt: a.created_at,
    };
  });

  /* ---- 汇总：当前账号池的可用总量 ---- */
  const alive = accounts.filter((a) => a.status !== 'missing');
  const usable = alive.filter((a) => a.status === 'ok');
  const withPct = usable.filter((a) => a.quota?.weeklyLeftPct != null);
  const summary = {
    total: alive.length,
    usable: usable.length,
    // 平均剩余周额度（多账号时即「还能跑几成」的平均值）
    weeklyLeftPct: withPct.length
      ? Math.round(withPct.reduce((s, a) => s + a.quota.weeklyLeftPct, 0) / withPct.length)
      : null,
    // 各账号剩余比例之和，例如 2 个账号各 60% → 120%
    pooledWeeklyPct: withPct.length
      ? Math.round(withPct.reduce((s, a) => s + a.quota.weeklyLeftPct, 0))
      : null,
    weeklyReset: withPct.map((a) => a.quota.weeklyReset).find(Boolean) || null,
    tokensLeft: usable.map((a) => a.quota?.tokensLeft).filter(Boolean),
    checkedAt: usable.map((a) => a.quota?.checkedAt).filter(Boolean).sort().pop() || null,
    // Tổng số video/ảnh đã tạo xong (mọi tài khoản cộng lại)
    totalVideos: accounts.reduce((s, a) => s + (a.videoCount || 0), 0),
    totalImages: accounts.reduce((s, a) => s + (a.imageCount || 0), 0),
  };

  res.json({ accounts, summary, upstreamUp: upstream.length > 0 });
});

/* 触发一次上游额度刷新（全池） */
r.post('/quota', requireAuth, async (req, res) => {
  try {
    const out = await muse.queryQuota(req.body?.accountId);
    await syncFromUpstream();
    res.json({ ok: true, quota: parseQuota(out) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 核心：前端粘贴 Cookie 头即可导入（可 kèm proxy riêng cho tài khoản）
r.post('/', requireAuth, async (req, res) => {
  const { cookie, label, proxy } = req.body || {};
  if (!cookie || String(cookie).trim().length < 10) {
    return res.status(400).json({ error: 'Vui lòng dán đầy đủ Cookie (ít nhất phải có hatch_sess)' });
  }
  if (proxy !== undefined && proxy !== null && (typeof proxy !== 'object' || typeof proxy.server !== 'string' || !proxy.server.trim())) {
    return res.status(400).json({ error: 'Proxy phải có địa chỉ máy chủ, ví dụ http://host:port' });
  }
  const text = String(cookie).trim();
  // 容错：用户可能粘贴了 "Cookie: xxx" 前缀或整段请求头
  const cleaned = text.replace(/^cookie\s*:\s*/i, '').replace(/\s*\n\s*/g, '; ');

  let result;
  try {
    result = await muse.addAccount({
      label: label || `muse-${new Date().toISOString().slice(5, 16)}`,
      cookie: cleaned,
      ...(proxy ? { proxy } : {}),
    });
  } catch (e) {
    return res.status(502).json({ error: `Upstream từ chối nhập：${e.message}` });
  }

  const added = (result.added || [])[0];
  if (!added) return res.status(502).json({ error: 'Upstream không trả về thông tin tài khoản' });

  const row = upsertAccount({
    upstreamId: added.id,
    label: added.label,
    ownerId: req.user.role === 'admin' ? null : req.user.id,
    status: 'unknown',
    expiresAt: added.expires_at || null,
  });

  res.json({
    account: { id: row.id, upstreamId: row.upstream_id, label: row.label, status: 'unknown' },
    warning: result.warning || null,
    essentialMissing: result.essential_missing || [],
  });
});

/* Đặt / đổi / xóa proxy riêng của một tài khoản (chỉ traffic đi muse.ai mới qua proxy này).
 * proxy = { server, username?, password? } để đặt; proxy = null để xóa. */
r.patch('/:id/proxy', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Tài khoản không tồn tại' });
  if (row.owner_id && row.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền thao tác tài khoản này' });
  }
  const { proxy } = req.body || {};
  if (proxy !== null && (typeof proxy !== 'object' || typeof proxy.server !== 'string' || !proxy.server.trim())) {
    return res.status(400).json({ error: 'Proxy phải có địa chỉ máy chủ, ví dụ http://host:port' });
  }
  try {
    await muse.updateAccount(row.upstream_id, { proxy: proxy === null ? null : proxy });
    await syncFromUpstream();
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* Thêm tài khoản này vào pool prompt-writer: các lần viết prompt (chat,
 * phân tích ảnh, kịch bản và chia cảnh Film Studio) sẽ xoay vòng qua các
 * tài khoản trong pool khi user không có acc của riêng mình. */
r.post('/:id/prompt-writer', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Tài khoản không tồn tại' });
  db.prepare('UPDATE accounts SET prompt_writer = 1 WHERE id = ?').run(row.id);
  auditLog(req.user.id, 'prompt_writer_add', 'account', row.id, `Thêm ${row.label} vào pool viết prompt`);
  res.json({ ok: true });
});

/* Gỡ tài khoản khỏi pool prompt-writer (lũy tiến: đã gỡ rồi thì vẫn ok). */
r.delete('/:id/prompt-writer', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (row) {
    db.prepare('UPDATE accounts SET prompt_writer = 0 WHERE id = ?').run(row.id);
    auditLog(req.user.id, 'prompt_writer_remove', 'account', row.id, `Gỡ ${row.label} khỏi pool viết prompt`);
  }
  res.json({ ok: true });
});

r.post('/:id/test', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Tài khoản không tồn tại' });
  if (row.owner_id && row.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền thao tác tài khoản này' });
  }
  try {
    const out = await muse.testAccount(row.upstream_id);
    const ok = out?.ok === true || out?.session_ok === true || out?.valid === true;
    upsertAccount({
      upstreamId: row.upstream_id,
      label: row.label,
      status: ok ? 'ok' : (out?.session_ok === false ? 'error' : 'unknown'),
      note: out?.note || out?.error || null,
      expiresAt: out?.expires_at || row.expires_at,
      quota: out?.quota ? JSON.stringify(out.quota) : row.quota,
    });
    res.json({ result: out });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

r.post('/:id/keepalive', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Tài khoản không tồn tại' });
  if (row.owner_id && row.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền thao tác tài khoản này' });
  }
  try {
    res.json({ result: await muse.keepaliveAccount(row.upstream_id) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

r.delete('/:id', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Tài khoản không tồn tại' });
  if (row.owner_id && row.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền xóa tài khoản này' });
  }
  if (row.upstream_id) {
    try { await muse.deleteAccount(row.upstream_id); } catch (e) { /* 上游已不存在也照删 */ }
  }
  deleteAccountRow(row.id);
  res.json({ ok: true });
});

export default r;
