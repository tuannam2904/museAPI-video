import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { requireAuth } from '../auth.js';

const r = Router();

// Thư viện prompt Muse Video (204 mẫu, đồng bộ từ
// github.com/apimodels/muse-video-prompts, giấy phép CC-BY-4.0).
// File JSON nằm cùng mã nguồn, đọc một lần lúc khởi động.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'prompts.json');

let cache = null;
function loadPrompts() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const list = JSON.parse(raw);
    cache = Array.isArray(list) ? list : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** GET /api/prompts — toàn bộ thư viện (client tự tìm kiếm / lọc theo nhóm) */
r.get('/prompts', requireAuth, (_req, res) => {
  const prompts = loadPrompts();
  const categories = [...new Set(prompts.map((p) => p.category_en).filter(Boolean))].sort();
  res.json({ total: prompts.length, categories, prompts });
});

export default r;
