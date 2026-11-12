import { CFG } from '../config.js';
import { db } from '../db.js';

const PROMPT_WRITER_KEY = 'prompt_writer_account_id';

/** Lấy upstream id của tài khoản prompt-writer đã chọn, hoặc null nếu chưa chọn. */
export function getPromptWriterUpstreamId() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PROMPT_WRITER_KEY);
  const platformId = row?.value;
  if (!platformId) return null;
  const acc = db.prepare('SELECT upstream_id FROM accounts WHERE id = ?').get(platformId);
  return acc?.upstream_id || null;
}

/**
 * Gửi chat qua tài khoản prompt-writer (nếu đã chọn tài khoản thì ghim vào
 * đúng tài khoản đó, chưa chọn thì upstream tự xoay vòng như trước).
 * Trả về nội dung text của assistant. Ném lỗi tiếng Việt khi HTTP lỗi
 * hoặc upstream không trả về nội dung.
 */
export async function chatWithPromptWriter({ messages, images, model = 'muse-spark', timeoutMs = 5 * 60 * 1000 }) {
  const accountId = getPromptWriterUpstreamId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = { model, messages, stream: false };
    if (images) body.images = images;
    if (accountId) body.account_id = accountId;
    const up = await fetch(`${CFG.museBase}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CFG.museKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(data?.error?.message || data?.detail || `Lỗi HTTP ${up.status} từ upstream`);
    const content = data?.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('Upstream không trả về nội dung');
    return content;
  } finally {
    clearTimeout(timer);
  }
}
