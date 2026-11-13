import { CFG } from '../config.js';
import { db } from '../db.js';
import { listAccounts as museListAccounts } from '../muse.js';

/**
 * Prompt-writer pool: viết prompt dùng tài khoản Muse nào.
 *
 * Thứ tự ưu tiên khi một user nhờ viết prompt (chat, phân tích ảnh,
 * kịch bản/chia cảnh Film Studio):
 *   (a) tài khoản của chính user đó (owner_id = userId) — mỗi người tự
 *       tiêu hạn mức chat của mình, không tranh nhau;
 *   (b) pool prompt-writer chung (accounts.prompt_writer = 1, do admin
 *       đánh dấu) — chọn xoay vòng (round-robin) để tải trải đều;
 *   (c) không có tài khoản nào → gọi upstream không kèm account_id,
 *       upstream tự xoay vòng như trước.
 *
 * "Đang bật" = upstream /admin/accounts báo enabled !== false; khi không
 * đọc được upstream thì dùng luôn các dòng trong DB (upstream sẽ tự báo
 * lỗi nếu tài khoản bị vô hiệu hoá khi ghim).
 */

/** Tập upstream_id đang bật (upstream /admin/accounts). null nếu không đọc được. */
async function upstreamEnabledIds() {
  try {
    const { accounts } = await museListAccounts();
    return new Set((accounts || []).filter((a) => a.enabled !== false).map((a) => a.id));
  } catch {
    return null;
  }
}

/** Chỉ giữ tài khoản có upstream_id và (nếu đọc được upstream) đang bật. */
function usable(rows, enabled) {
  const withUpstream = rows.filter((a) => a.upstream_id);
  if (!enabled) return withUpstream;
  return withUpstream.filter((a) => enabled.has(a.upstream_id));
}

/** Chỉ số xoay vòng theo từng khóa (mỗi user một khóa riêng, pool chung một khóa). */
const rrIndex = new Map();

/** Chọn 1 tài khoản trong danh sách theo vòng tròn (thứ tự ổn định theo created_at, id). */
function pickRoundRobin(list, key) {
  if (!list.length) return null;
  const sorted = [...list].sort(
    (a, b) => (a.created_at - b.created_at) || String(a.id).localeCompare(String(b.id))
  );
  const i = rrIndex.get(key) || 0;
  const pick = sorted[i % sorted.length];
  rrIndex.set(key, i + 1);
  return pick;
}

/**
 * Chọn tài khoản prompt-writer cho userId.
 * Trả { platformId, upstreamId } hoặc null. Không bao giờ ném lỗi.
 */
export async function pickPromptWriterAccount(userId) {
  try {
    const enabled = await upstreamEnabledIds();

    // (a) Tài khoản của chính user — xoay vòng riêng từng user.
    if (userId) {
      const own = usable(
        db.prepare('SELECT * FROM accounts WHERE owner_id = ? AND upstream_id IS NOT NULL').all(userId),
        enabled
      );
      const pick = pickRoundRobin(own, `own:${userId}`);
      if (pick) return { platformId: pick.id, upstreamId: pick.upstream_id };
    }

    // (b) Pool prompt-writer chung — xoay vòng toàn cục.
    const pool = usable(
      db.prepare('SELECT * FROM accounts WHERE prompt_writer = 1 AND upstream_id IS NOT NULL').all(),
      enabled
    );
    const pick = pickRoundRobin(pool, 'pool');
    if (pick) return { platformId: pick.id, upstreamId: pick.upstream_id };

    // (c) Không có tài khoản nào.
    return null;
  } catch {
    return null;
  }
}

/**
 * Gửi chat qua tài khoản prompt-writer đã chọn (ưu tiên acc của user,
 * rồi đến pool chung, cuối cùng để upstream tự xoay vòng).
 * Trả về nội dung text của assistant. Ném lỗi tiếng Việt khi HTTP lỗi
 * hoặc upstream không trả về nội dung.
 * userId là tùy chọn: bỏ qua thì đi thẳng vào pool chung.
 */
export async function chatWithPromptWriter({ userId, messages, images, model = 'muse-spark', timeoutMs = 5 * 60 * 1000 }) {
  const picked = await pickPromptWriterAccount(userId);
  const accountId = picked?.upstreamId || null;
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
