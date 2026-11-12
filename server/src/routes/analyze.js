import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { normalizeRefs } from './generate.js';
import { getPromptSkill } from '../lib/promptSkill.js';
import { chatWithPromptWriter } from '../lib/promptWriter.js';

const r = Router();

/**
 * POST /api/analyze-image — đọc ảnh tham chiếu rồi viết prompt video tiếng Việt.
 * Body: { images: [{ url, label }], motion } — tối đa 3 ảnh, label là nhãn
 * từng ảnh (ai, đang làm gì), motion là ý tưởng chuyển động của người dùng.
 * Trả về: { ok, descriptions, videoPrompt }.
 */
r.post('/analyze-image', requireAuth, async (req, res) => {
  const { images = [], motion = '' } = req.body || {};
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Cần ít nhất một ảnh tham chiếu để phân tích' });
  }

  // Chuyển /media/ và /uploads/ thành data URL mà upstream đọc được;
  // ảnh nào không đọc được thì bỏ qua, còn ảnh nào thì phân tích ảnh đó.
  const refs = [];
  const labels = [];
  for (const item of images.slice(0, 3)) {
    const url = typeof item === 'string' ? item : item?.url;
    if (!url) continue;
    const norm = normalizeRefs([url]);
    if (norm.length && norm[0].url) {
      refs.push(norm[0].url);
      labels.push(typeof item === 'string' ? '' : String(item?.label || ''));
    }
  }
  if (!refs.length) {
    return res.status(400).json({ error: 'Không đọc được ảnh tham chiếu nào — hãy tải ảnh lên lại' });
  }

  const skill = getPromptSkill();
  const labelLines = labels
    .map((l, i) => `Ảnh ${i + 1} — ${l.trim() || 'không có nhãn'}`)
    .join('\n');
  const userMsg = `Phân tích ${refs.length} ảnh tham chiếu sau đây:\n${labelLines}\n\nHãy mô tả chi tiết từng ảnh theo đúng thứ tự trong kỹ năng, rồi viết prompt video tiếng Việt hoàn chỉnh cho video này (ý tưởng chuyển động: ${String(motion || '').trim() || 'tự do'}). Trả lời theo đúng định dạng: phần mô tả ảnh trước, sau đó một dòng chỉ có ---PROMPT--- rồi đến prompt video hoàn chỉnh.`;

  const messages = skill
    ? [
        { role: 'system', content: skill },
        { role: 'user', content: userMsg },
      ]
    : [{ role: 'user', content: userMsg }];

  try {
    const text = await chatWithPromptWriter({
      messages,
      images: refs,
      timeoutMs: 5 * 60 * 1000,
    });
    const parts = text.split(/^---PROMPT---\s*$/m);
    const descriptions = parts[0].trim();
    const videoPrompt = parts.length > 1 ? parts.slice(1).join('\n').trim() : '';
    res.json({ ok: true, descriptions, videoPrompt });
  } catch (e) {
    res.status(502).json({ error: `Phân tích ảnh gặp lỗi: ${e.message}` });
  }
});

export default r;
