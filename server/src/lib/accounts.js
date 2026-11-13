import { db, isVip } from '../db.js';
import { listAccounts } from '../muse.js';

/**
 * Chọn tài khoản Muse cho 1 user dùng để tạo video/ảnh (VIP gating).
 *
 * - Mặc định (không VIP): chỉ dùng tài khoản của chính user đó
 *   (accounts.owner_id = userId). Không rớt xuống kho chung.
 * - vip: true → dùng tài khoản VIP do admin cung cấp (accounts.vip = 1),
 *   yêu cầu user còn quyền VIP (users.vip_expires_at > now).
 * - accountId: user chỉ định 1 tài khoản — chỉ cho phép tài khoản của chính
 *   họ, hoặc tài khoản VIP khi họ còn quyền VIP.
 *
 * Phụ thuộc schema do vip.js/admin.js quản lý: accounts.vip (0/1),
 * users.vip_expires_at (ms epoch, null = không có VIP).
 */

/** Lỗi chọn tài khoản + HTTP status và thông báo tiếng Việt cho frontend. */
export const PICK_ERRORS = {
  vip_required: { status: 403, message: 'Cần quyền VIP để dùng acc VIP' },
  no_vip_account: { status: 503, message: 'Hiện không có acc VIP khả dụng, thử lại sau' },
  no_own_account: {
    status: 400,
    message: 'Bạn chưa thêm tài khoản Muse. Thêm tài khoản ở trang Nhập Muse hoặc mua VIP để dùng acc VIP.',
  },
  forbidden: { status: 403, message: 'Tài khoản này không thuộc về bạn' },
};

/** true nếu user còn quyền VIP (vip_expires_at > now). Dùng chung helper của db.js. */
export const isVipUser = isVip;

/**
 * Tập upstream_id đang bật (upstream /admin/accounts, enabled !== false).
 * Trả null nếu không đọc được upstream — lúc đó không lọc theo enabled
 * (upstream sẽ tự báo lỗi nếu tài khoản bị vô hiệu hoá khi ghim).
 */
async function upstreamEnabledIds() {
  try {
    const { accounts } = await listAccounts();
    return new Set((accounts || []).filter((a) => a.enabled !== false).map((a) => a.id));
  } catch {
    return null;
  }
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Chọn 1 tài khoản cho userId.
 * opts = { vip?: boolean, accountId?: string }
 * Trả { upstreamId, platformId, mode: 'vip' | 'own' } hoặc { error: <mã lỗi> }.
 */
export async function pickAccountForUser(userId, opts = {}) {
  const vip = !!opts.vip;
  const accountId = opts.accountId || null;
  const userIsVip = isVipUser(userId);

  // User chỉ định 1 tài khoản cụ thể.
  if (accountId) {
    const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!acc || !acc.upstream_id) return { error: 'forbidden' };
    const isOwn = acc.owner_id === userId;
    const isVipAcc = Number(acc.vip) === 1;
    if (!isOwn && !(isVipAcc && userIsVip)) return { error: 'forbidden' };
    const enabled = await upstreamEnabledIds();
    if (enabled && !enabled.has(acc.upstream_id)) return { error: 'forbidden' };
    return { upstreamId: acc.upstream_id, platformId: acc.id, mode: isVipAcc && !isOwn ? 'vip' : 'own' };
  }

  const enabled = await upstreamEnabledIds();
  // Chỉ giữ lại tài khoản có upstream_id và (nếu đọc được upstream) đang bật.
  const usable = (rows) => {
    const withUpstream = rows.filter((a) => a.upstream_id);
    if (!enabled) return withUpstream;
    return withUpstream.filter((a) => enabled.has(a.upstream_id));
  };

  // VIP: tài khoản VIP do admin cung cấp, chọn ngẫu nhiên 1 cái đang bật.
  if (vip) {
    if (!userIsVip) return { error: 'vip_required' };
    const cands = usable(db.prepare('SELECT * FROM accounts WHERE vip = 1').all());
    if (!cands.length) return { error: 'no_vip_account' };
    const pick = pickRandom(cands);
    return { upstreamId: pick.upstream_id, platformId: pick.id, mode: 'vip' };
  }

  // Mặc định: chỉ tài khoản của chính user.
  const own = usable(
    db.prepare('SELECT * FROM accounts WHERE owner_id = ? AND upstream_id IS NOT NULL').all(userId)
  );
  if (!own.length) return { error: 'no_own_account' };
  const pick = pickRandom(own);
  return { upstreamId: pick.upstream_id, platformId: pick.id, mode: 'own' };
}
