import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const r = Router();

const MAX_DOC_BYTES = 5 * 1024 * 1024;
const MAX_TITLE_LEN = 80;
const DEFAULT_TITLE = 'Dự án mới';

function isValidDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  if (!Array.isArray(doc.nodes)) return false;
  if (doc.links !== undefined && !Array.isArray(doc.links)) return false;
  return true;
}

function newProjectId() {
  return 'c_' + crypto.randomBytes(8).toString('hex');
}

function parseDoc(row) {
  let parsed = null;
  try {
    parsed = JSON.parse(row.doc);
  } catch {
    parsed = null;
  }
  return parsed;
}

function docTitle(parsed) {
  const t = parsed && typeof parsed.title === 'string' ? parsed.title.trim() : '';
  return t || 'Canvas vô hạn';
}

function docNodeCount(parsed) {
  return parsed && Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
}

function cleanTitle(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, MAX_TITLE_LEN);
}

/**
 * GET /api/canvas — danh sách dự án Canvas của user đang đăng nhập.
 * Trả về: { projects: [{ id, title, nodeCount, createdAt, updatedAt }] }
 * (sắp xếp theo updatedAt giảm dần).
 */
r.get('/', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT id, doc, created_at, updated_at FROM canvas_docs WHERE user_id = ? ORDER BY updated_at DESC')
    .all(req.user.id);
  const projects = rows.map((row) => {
    const parsed = parseDoc(row);
    return {
      id: row.id,
      title: docTitle(parsed),
      nodeCount: docNodeCount(parsed),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  res.json({ projects });
});

/**
 * POST /api/canvas — tạo dự án Canvas mới.
 * Body: { title? } — tên tùy chọn (tối đa 80 ký tự), mặc định 'Dự án mới'.
 * Trả về: { project: { id, title, nodeCount: 0, createdAt, updatedAt }, doc }.
 */
r.post('/', requireAuth, (req, res) => {
  const title = cleanTitle(req.body?.title) || DEFAULT_TITLE;
  const id = newProjectId();
  const now = Date.now();
  const doc = { title, nodes: [], links: [] };
  db.prepare('INSERT INTO canvas_docs (id, user_id, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    req.user.id,
    JSON.stringify(doc),
    now,
    now
  );
  res.json({
    project: { id, title, nodeCount: 0, createdAt: now, updatedAt: now },
    doc,
  });
});

/**
 * GET /api/canvas/:id — lấy tài liệu của 1 dự án.
 * Trả về: { id, title, doc, createdAt, updatedAt }.
 * 404 nếu dự án không thuộc về user đang đăng nhập.
 */
r.get('/:id', requireAuth, (req, res) => {
  const row = db
    .prepare('SELECT id, doc, created_at, updated_at FROM canvas_docs WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const parsed = parseDoc(row);
  res.json({
    id: row.id,
    title: docTitle(parsed),
    doc: parsed || { title: 'Canvas vô hạn', nodes: [], links: [] },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

/**
 * PUT /api/canvas/:id — lưu tài liệu của 1 dự án.
 * Body: { doc } — doc phải là object, doc.nodes phải là mảng,
 * doc.links nếu có phải là mảng, kích thước tối đa 5 MB.
 * Trả về: { ok: true, updatedAt }. 404 nếu dự án không thuộc về user.
 */
r.put('/:id', requireAuth, (req, res) => {
  const { doc } = req.body || {};
  if (!isValidDoc(doc)) {
    return res.status(400).json({ error: 'Tài liệu Canvas không hợp lệ' });
  }
  const raw = JSON.stringify(doc);
  if (raw.length > MAX_DOC_BYTES) {
    return res.status(413).json({ error: 'Tài liệu Canvas quá lớn' });
  }
  const updatedAt = Date.now();
  const info = db
    .prepare('UPDATE canvas_docs SET doc = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(raw, updatedAt, req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  res.json({ ok: true, updatedAt });
});

/**
 * PATCH /api/canvas/:id — đổi tên 1 dự án.
 * Body: { title } — bắt buộc, không rỗng, tối đa 80 ký tự.
 * Trả về: { ok: true, title, updatedAt }. 404 nếu dự án không thuộc về user.
 */
r.patch('/:id', requireAuth, (req, res) => {
  const title = cleanTitle(req.body?.title);
  if (!title) {
    return res.status(400).json({ error: 'Tên dự án không hợp lệ' });
  }
  const row = db
    .prepare('SELECT doc FROM canvas_docs WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  const parsed = parseDoc(row) || { title: 'Canvas vô hạn', nodes: [], links: [] };
  parsed.title = title;
  const updatedAt = Date.now();
  db.prepare('UPDATE canvas_docs SET doc = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(
    JSON.stringify(parsed),
    updatedAt,
    req.params.id,
    req.user.id
  );
  res.json({ ok: true, title, updatedAt });
});

/**
 * DELETE /api/canvas/:id — xóa 1 dự án.
 * Trả về: { ok: true }. 404 nếu dự án không thuộc về user.
 */
r.delete('/:id', requireAuth, (req, res) => {
  const info = db
    .prepare('DELETE FROM canvas_docs WHERE id = ? AND user_id = ?')
    .run(req.params.id, req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Không tìm thấy dự án' });
  res.json({ ok: true });
});

export default r;
