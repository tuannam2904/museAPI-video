import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const r = Router();

const MAX_DOC_BYTES = 5 * 1024 * 1024;

function isValidDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  if (!Array.isArray(doc.nodes)) return false;
  if (doc.links !== undefined && !Array.isArray(doc.links)) return false;
  return true;
}

/**
 * GET /api/canvas — lấy tài liệu Canvas đã lưu của user đang đăng nhập.
 * Trả về: { doc: <object> | null, updatedAt: <ms> | null }.
 * Chưa lưu bao giờ → { doc: null, updatedAt: null }.
 */
r.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT doc, updated_at FROM canvas_docs WHERE user_id = ?').get(req.user.id);
  if (!row) return res.json({ doc: null, updatedAt: null });
  let parsed = null;
  try {
    parsed = JSON.parse(row.doc);
  } catch {
    parsed = null;
  }
  res.json({ doc: parsed, updatedAt: row.updated_at });
});

/**
 * PUT /api/canvas — lưu tài liệu Canvas của user đang đăng nhập.
 * Body: { doc } — doc phải là object, doc.nodes phải là mảng,
 * doc.links nếu có phải là mảng, kích thước tối đa 5 MB.
 * Trả về: { ok: true, updatedAt }.
 */
r.put('/', requireAuth, (req, res) => {
  const { doc } = req.body || {};
  if (!isValidDoc(doc)) {
    return res.status(400).json({ error: 'Tài liệu Canvas không hợp lệ' });
  }
  const raw = JSON.stringify(doc);
  if (raw.length > MAX_DOC_BYTES) {
    return res.status(413).json({ error: 'Tài liệu Canvas quá lớn' });
  }
  const updatedAt = Date.now();
  db.prepare(
    'INSERT INTO canvas_docs (user_id, doc, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(user_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at'
  ).run(req.user.id, raw, updatedAt);
  res.json({ ok: true, updatedAt });
});

export default r;
