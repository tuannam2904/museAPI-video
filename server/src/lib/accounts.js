import { db, isVip, getSetting } from '../db.js';
import { listAccounts } from '../muse.js';

/**
 * Chọn tài khoản Muse cho 1 user dùng để tạo video/ảnh (VIP gating).
 *
 * - Mặc định (không VIP): dùng tài khoản của chính user đó
 *   (accounts.owner_id = userId) trước; nếu user không có acc riêng mà
 *   còn quyền VIP (hoặc là admin) thì dùng acc VIP do admin cung cấp
 *   (accounts.vip = 1, chịu giới hạn lượt/ngày). Không rớt xuống kho chung.
 * - vip: true → dùng tài khoản VIP do admin cung cấp, yêu cầu user còn
 *   quyền VIP (hoặc là admin).
 * - accountId: user chỉ định 1 tài khoản — chỉ cho phép tài khoản của chính
 *   họ, hoặc tài khoản VIP khi họ còn quyền VIP (hoặc là admin).
 * - Admin được tính như VIP khi chọn tài khoản (dùng được acc VIP) nhưng
 *   KHÔNG được tính là VIP ở các chỗ khác (hiển thị, gia hạn, thanh toán).
 *
 * Phụ thuộc schema do vip.js/admin.js quản lý: accounts.vip (0/1),
 * users.vip_expires_at (ms epoch, null = không có VIP), users.role.
 */

/** Lỗi chọn tài khoản + HTTP status và thông báo tiếng Việt cho frontend. */
export const PICK_ERRORS = {
  vip_required: { status: 403, message: 'Cần quyền VIP để dùng acc VIP' },
  no_vip_account: { status: 503, message: 'Hiện không có acc VIP khả dụng, thử lại sau' },
  vip_daily_cap: {
    status: 503,
    message: 'Các acc VIP đã dùng hết lượt tạo hôm nay. Hãy thêm tài khoản Muse của riêng bạn để tiếp tục, hoặc chờ sang ngày mai.',
  },
  no_own_account: {
    status: 400,
    message: 'Bạn chưa thêm tài khoản Muse. Thêm tài khoản ở trang Nhập Muse hoặc mua VIP để dùng acc VIP.',
  },
  forbidden: { status: 403, message: 'Tài khoản này không thuộc về bạn' },
};

/** true nếu user còn quyền VIP (vip_expires_at > now). Dùng chung helper của db.js. */
export const isVipUser = isVip;

/** true nếu user có role admin. Admin dùng được acc VIP như user VIP. */
function isAdminUser(userId) {
  try {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(userId);
    return u?.role === 'admin';
  } catch {
    return false;
  }
}

/** true nếu user được dùng acc VIP: còn quyền VIP, hoặc là admin. */
function canUseVip(userId) {
  return isVipUser(userId) || isAdminUser(userId);
}

/**
 * Trạng thái pool acc VIP do admin cung cấp — chỉ trả SỐ LƯỢNG, không lộ
 * chi tiết tài khoản (label, quota, proxy) cho user thường.
 * { total, active }: total = số acc VIP; active = số acc VIP đang hoạt động
 * (đang bật ở upstream — nếu không đọc được upstream thì bỏ qua điều kiện
 * này — và chưa hết lượt tạo hôm nay).
 */
export async function vipPoolStatus() {
  const rows = db.prepare('SELECT * FROM accounts WHERE vip = 1 AND upstream_id IS NOT NULL').all();
  const total = rows.length;
  const enabled = await upstreamEnabledIds();
  const limit = getVipDailyLimit();
  const active = rows.filter((a) => {
    if (enabled && !enabled.has(a.upstream_id)) return false;
    return vipAccountTodayCount(a.upstream_id) < limit;
  }).length;
  return { total, active };
}

/**
 * Chọn 1 acc VIP còn lượt hôm nay (ngẫu nhiên để tải chia đều).
 * Trả { upstreamId, platformId, mode: 'vip' } hoặc { error }.
 * `usable` là hàm lọc acc có upstream_id và đang bật (định nghĩa trong pickAccountForUser).
 */
function pickVipAccount(usable) {
  const cands = usable(db.prepare('SELECT * FROM accounts WHERE vip = 1').all());
  if (!cands.length) return { error: 'no_vip_account' };
  const limit = getVipDailyLimit();
  const available = cands.filter((a) => vipAccountTodayCount(a.upstream_id) < limit);
  if (!available.length) return { error: 'vip_daily_cap' };
  const pick = pickRandom(available);
  return { upstreamId: pick.upstream_id, platformId: pick.id, mode: 'vip' };
}

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

/** Mốc 0h hôm nay (giờ địa phương của server), dạng ms epoch. */
export function todayMidnightMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Giới hạn lượt tạo/ngày cho MỖI acc VIP (setting vipDailyVideoLimit, mặc định 100). */
export function getVipDailyLimit() {
  const n = Number(getSetting('vipDailyVideoLimit'));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100;
}

/**
 * Đếm số lượt tạo (video + ảnh) mà một tài khoản Muse VIP đã được dùng hôm nay.
 * upstreamId = id upstream của tài khoản (accounts.upstream_id).
 * Đếm mọi job đã tạo từ 0h hôm nay mà params lưu accountMode='vip' và
 * accountId là tài khoản này (params.accountId là id nền tảng, nên cần đổi
 * upstream id → id nền tảng qua bảng accounts). Không lọc theo trạng thái job:
 * job đã tạo là đã chiếm 1 lượt dùng acc VIP, dù sau đó thành công hay thất bại.
 * Lỗi gì cũng trả 0, không bao giờ throw.
 */
export function vipAccountTodayCount(upstreamId) {
  try {
    if (!upstreamId) return 0;
    const acc = db.prepare('SELECT id FROM accounts WHERE upstream_id = ?').get(upstreamId);
    if (!acc) return 0;
    const row = db.prepare(
      `SELECT COUNT(*) n FROM jobs
       WHERE created_at >= ?
         AND json_extract(params, '$.accountMode') = 'vip'
         AND json_extract(params, '$.accountId') = ?`
    ).get(todayMidnightMs(), acc.id);
    return Number(row?.n) || 0;
  } catch {
    return 0;
  }
}

/**
 * Chọn 1 tài khoản cho userId.
 * opts = { vip?: boolean, accountId?: string }
 * Trả { upstreamId, platformId, mode: 'vip' | 'own' } hoặc { error: <mã lỗi> }.
 */
export async function pickAccountForUser(userId, opts = {}) {
  const vip = !!opts.vip;
  const accountId = opts.accountId || null;
  const userIsVip = canUseVip(userId);

  // User chỉ định 1 tài khoản cụ thể.
  if (accountId) {
    const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!acc || !acc.upstream_id) return { error: 'forbidden' };
    const isOwn = acc.owner_id === userId;
    const isVipAcc = Number(acc.vip) === 1;
    if (!isOwn && !(isVipAcc && userIsVip)) return { error: 'forbidden' };
    const enabled = await upstreamEnabledIds();
    if (enabled && !enabled.has(acc.upstream_id)) return { error: 'forbidden' };
    const mode = isVipAcc && !isOwn ? 'vip' : 'own';
    // Acc VIP chỉ định tay cũng chịu giới hạn lượt/ngày (không lách được bằng cách ghim acc).
    if (mode === 'vip' && vipAccountTodayCount(acc.upstream_id) >= getVipDailyLimit()) {
      return { error: 'vip_daily_cap' };
    }
    return { upstreamId: acc.upstream_id, platformId: acc.id, mode };
  }

  const enabled = await upstreamEnabledIds();
  // Chỉ giữ lại tài khoản có upstream_id và (nếu đọc được upstream) đang bật.
  const usable = (rows) => {
    const withUpstream = rows.filter((a) => a.upstream_id);
    if (!enabled) return withUpstream;
    return withUpstream.filter((a) => enabled.has(a.upstream_id));
  };

  // VIP: tài khoản VIP do admin cung cấp — chỉ chọn trong các acc chưa hết lượt hôm nay,
  // chọn ngẫu nhiên để tải chia đều. Tất cả đều hết lượt thì báo để user tự thêm acc.
  if (vip) {
    if (!userIsVip) return { error: 'vip_required' };
    return pickVipAccount(usable);
  }

  // Mặc định: tài khoản của chính user trước; nếu không có acc riêng mà user
  // là VIP (hoặc admin) thì dùng acc VIP (chịu giới hạn lượt/ngày).
  const own = usable(
    db.prepare('SELECT * FROM accounts WHERE owner_id = ? AND upstream_id IS NOT NULL').all(userId)
  );
  if (own.length) {
    const pick = pickRandom(own);
    return { upstreamId: pick.upstream_id, platformId: pick.id, mode: 'own' };
  }
  if (userIsVip) return pickVipAccount(usable);
  return { error: 'no_own_account' };
}
