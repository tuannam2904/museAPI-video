import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { chatWithPromptWriter } from '../lib/promptWriter.js';

const r = Router();

export const TEXT_MODELS = [
  { id: 'muse-spark', name: 'Muse Spark', desc: 'Mô hình văn bản tích hợp, phản hồi nhanh' },
];

/** 站内文本对话：用 JWT 鉴权，转发到上游的 OpenAI 兼容接口 */
r.post('/chat', requireAuth, async (req, res) => {
  const { messages, model = 'muse-spark' } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Vui lòng chọn mô hình văn bản trước' });
  }

  const clean = messages
    .filter((m) => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  try {
    const content = await chatWithPromptWriter({ userId: req.user.id, messages: clean, model });
    res.json({ content, model, usage: null });
  } catch (e) {
    res.status(502).json({ error: `Yêu cầu gặp lỗi：${e.message}` });
  }
});

r.get('/chat/models', requireAuth, (_req, res) => res.json({ models: TEXT_MODELS }));

export default r;
