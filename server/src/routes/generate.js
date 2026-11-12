import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../auth.js';
import { CFG, MEDIA_DIR } from '../config.js';
import { mediaStatsForUser } from '../mediaCleanup.js';
import {
  db, uid, now, createJob, getJob, updateJob, listJobs, addCredits, priceOf, getSettings,
  getSetting,
} from '../db.js';
import * as muse from '../muse.js';

const r = Router();

const UPLOAD_DIR = path.join(CFG.dataDir, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
      cb(null, `${uid('up_')}${ext}`);
    },
  }),
  limits: { fileSize: 40 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image|video|audio)\//.test(file.mimetype) || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Chỉ hỗ trợ ảnh / video / âm thanh / PDF làm tài liệu tham chiếu'), ok);
  },
});

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.heic': 'image/heic', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
};

/** 把平台本地素材（/uploads/ 上传, /media/ đã tạo）转成 data URL，上游无需公网访问权限 */
function toDataUrl(localUrl) {
  const name = path.basename(String(localUrl));
  const dir = String(localUrl).startsWith('/media/') ? MEDIA_DIR : UPLOAD_DIR;
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  const b64 = fs.readFileSync(file).toString('base64');
  return `data:${mime};base64,${b64}`;
}

export function normalizeRefs(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item) continue;
    if (typeof item === 'string') {
      if (item.startsWith('/uploads/') || item.startsWith('/media/')) {
        const d = toDataUrl(item);
        if (d) out.push({ url: d });
      } else if (/^(https?:|data:)/i.test(item)) {
        out.push({ url: item });
      }
    } else if (item.url) {
      out.push(item);
    }
  }
  return out;
}

/* ------------------------------ 上传 ------------------------------ */
r.post('/upload', requireAuth, upload.array('files', 10), (req, res) => {
  const files = (req.files || []).map((f) => {
    db.prepare('INSERT INTO uploads(id, user_id, filename, mime, bytes, created_at) VALUES(?,?,?,?,?,?)')
      .run(uid('u_'), req.user.id, f.filename, f.mimetype, f.size, now());
    return { url: `/uploads/${f.filename}`, name: f.originalname, bytes: f.size, mime: f.mimetype };
  });
  if (!files.length) return res.status(400).json({ error: 'Không nhận được file' });
  res.json({ files });
});

/* ------------------------------ 视频 ------------------------------ */

/* Hạn mức từng user: số tác vụ chạy cùng lúc + điểm tiêu mỗi ngày.
 * Trả về thông báo lỗi (tiếng Việt) nếu vi phạm, null nếu được phép.
 * Gọi sau bước kiểm tra số dư và trước khi tạo job / trừ điểm, để yêu cầu
 * bị từ chối không tốn điểm và không tạo job. */
export function checkUserLimits(userId, cost) {
  const u = db.prepare('SELECT daily_credit_cap, max_concurrent_jobs FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  if (u.max_concurrent_jobs != null) {
    const running = db.prepare(
      "SELECT COUNT(*) n FROM jobs WHERE user_id = ? AND status IN ('queued','processing')"
    ).get(userId).n;
    if (running >= u.max_concurrent_jobs) {
      return 'Bạn đang có quá nhiều tác vụ đang chạy, hãy chờ tác vụ hiện tại xong rồi tạo tiếp';
    }
  }
  if (u.daily_credit_cap != null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const spent = db.prepare(
      'SELECT COALESCE(-SUM(delta),0) n FROM ledger WHERE user_id = ? AND delta < 0 AND created_at >= ?'
    ).get(userId, today.getTime()).n;
    if (spent + cost > u.daily_credit_cap) {
      return 'Bạn đã dùng hết hạn mức điểm hôm nay';
    }
  }
  return null;
}

r.post('/videos', requireAuth, async (req, res) => {
  const { prompt, duration = 5, size = '16:9', images = [], model = 'muse-video', extra = null } = req.body || {};
  if (!prompt || String(prompt).trim().length < 2) {
    return res.status(400).json({ error: 'Vui lòng nhập mô tả hình ảnh' });
  }
  const dur = CFG.videoDurations.includes(Number(duration)) ? Number(duration) : 5;
  const params = { duration: dur, size: CFG.sizes.includes(size) ? size : '16:9', images, extra };
  const cost = priceOf('video', params);

  const fresh = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  if (fresh.credits < cost) {
    return res.status(402).json({ error: `Không đủ điểm, lần này cần ${cost}, hiện có ${fresh.credits}` });
  }

  const limitErr = checkUserLimits(req.user.id, cost);
  if (limitErr) return res.status(400).json({ error: limitErr });

  const job = createJob(req.user.id, 'video', String(prompt).trim(), params, cost);
  addCredits(req.user.id, -cost, 'Tạo tác vụ video', job.id);

  try {
    const refs = normalizeRefs(images);
    const payload = {
      prompt: String(prompt).trim(),
      model,
      duration: dur,
      size: params.size,
    };
    if (refs.length) payload.images = refs;
    if (extra) payload.extra = String(extra).slice(0, 500);

    const out = await muse.createVideo(payload);
    const upstreamId = out?.id || out?.task_id;
    if (!upstreamId) throw new Error('Upstream không trả về ID tác vụ');
    updateJob(job.id, { upstream_id: upstreamId, status: 'processing', progress: 15 });
    res.json({ job: getJob(job.id) });
  } catch (e) {
    updateJob(job.id, { status: 'failed', error: e.message, finished_at: Date.now() });
    addCredits(req.user.id, cost, 'Hoàn điểm khi tạo tác vụ thất bại', job.id);
    updateJob(job.id, { refunded: 1 });
    res.status(502).json({ error: `Tạo tác vụ thất bại：${e.message}`, refunded: true });
  }
});

/* ------------------------------ 图片 ------------------------------ */
r.post('/images', requireAuth, async (req, res) => {
  const { prompt, size = '1:1', images = [] } = req.body || {};
  if (!prompt || String(prompt).trim().length < 2) {
    return res.status(400).json({ error: 'Vui lòng nhập prompt' });
  }
  const params = { size: CFG.sizes.includes(size) ? size : '1:1', images };
  const cost = priceOf('image', params);

  const fresh = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  if (fresh.credits < cost) {
    return res.status(402).json({ error: `Không đủ điểm, lần này cần ${cost}, hiện có ${fresh.credits}` });
  }

  const limitErr = checkUserLimits(req.user.id, cost);
  if (limitErr) return res.status(400).json({ error: limitErr });

  const job = createJob(req.user.id, 'image', String(prompt).trim(), params, cost);
  addCredits(req.user.id, -cost, 'Tạo tác vụ hình ảnh', job.id);

  try {
    const refs = normalizeRefs(images);
    const payload = { prompt: String(prompt).trim(), model: 'muse-image', size: params.size };
    if (refs.length) payload.images = refs;

    const out = await muse.createImageTask(payload);
    const upstreamId = out?.id || out?.task_id;
    if (!upstreamId) throw new Error('Upstream không trả về ID tác vụ');
    updateJob(job.id, { upstream_id: upstreamId, status: 'processing', progress: 10 });
    res.json({ job: getJob(job.id) });
  } catch (e) {
    updateJob(job.id, { status: 'failed', error: e.message, finished_at: Date.now() });
    addCredits(req.user.id, cost, 'Hoàn điểm khi tạo tác vụ thất bại', job.id);
    updateJob(job.id, { refunded: 1 });
    res.status(502).json({ error: `Tạo tác vụ thất bại：${e.message}`, refunded: true });
  }
});

/* ------------------------------ 任务 ------------------------------ */
r.get('/jobs', requireAuth, (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(60, Math.max(1, Number(req.query.pageSize) || 24));
  const out = listJobs({
    userId: req.user.role === 'admin' && req.query.all === '1' ? null : req.user.id,
    type: req.query.type || null,
    status: req.query.status || null,
    page,
    pageSize,
  });
  // Số ngày giữ file media — frontend dùng để tính đếm ngược "xóa sau …".
  res.json({ ...out, mediaRetentionDays: Math.max(1, Number(getSetting('mediaRetentionDays') || 7)) });
});

/* Thống kê dung lượng media của CHÍNH user đang gọi (ai cũng xem được). */
r.get('/media-stats', requireAuth, (req, res) => {
  res.json(mediaStatsForUser(req.user.id));
});

r.get('/jobs/:id', requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tác vụ không tồn tại' });
  if (job.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền xem' });
  }
  res.json({ job });
});

r.delete('/jobs/:id', requireAuth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tác vụ không tồn tại' });
  if (job.userId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Không có quyền xóa' });
  }
  if (job.mediaFile) {
    try { fs.unlinkSync(path.join(CFG.dataDir, 'media', job.mediaFile)); } catch { /* ignore */ }
  }
  db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
  res.json({ ok: true });
});

/* --------------------------- 元信息 / 定价 --------------------------- */
r.get('/meta', requireAuth, (_req, res) => {
  const s = getSettings();
  res.json({
    siteName: s.siteName,
    notice: s.notice,
    durations: CFG.videoDurations,
    sizes: CFG.sizes,
    price: {
      videoBase: Number(s.priceVideoBase),
      videoPerSecond: Number(s.priceVideoPerSecond),
      image: Number(s.priceImage),
    },
  });
});

export default r;
