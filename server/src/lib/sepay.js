/* SePay qua VietQR + chuyển khoản MB — port từ aimibot mbpay.py (Python).
 * Cơ chế: SePay chỉ đẩy webhook về Cloudflare Worker (lưu D1); platform TỰ POLL
 * Worker (GET /payments?since=, Bearer MAIL_API_TOKEN) rồi đối chiếu theo mã
 * chuyển khoản, claim giao dịch rồi kích hoạt VIP. Không cần SePay API key.
 */
import crypto from 'node:crypto';
import { db, now, getSettings, getSetting, setSetting, grantVip } from '../db.js';

const NAPAS_GUID = 'A000000727';
const SERVICE_ACCOUNT = 'QRIBFTTA'; // transfer to account number

/* CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — EMVCo QR yêu cầu. */
export function crc16Ccitt(data) {
  let crc = 0xFFFF;
  for (const b of data) {
    crc ^= (b << 8) & 0xFFFF;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? (((crc << 1) ^ 0x1021) & 0xFFFF) : ((crc << 1) & 0xFFFF);
    }
  }
  return crc & 0xFFFF;
}

export function tlv(tag, value) {
  if (value.length > 99) throw new Error(`EMV field ${tag} too long`);
  return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

/* Bỏ dấu tiếng Việt, chỉ giữ [A-Za-z0-9 ], giới hạn độ dài. */
export function asciiClean(s, limit) {
  const norm = String(s || '').normalize('NFD').replace(/đ/g, 'd').replace(/Đ/g, 'D');
  const stripped = norm.replace(/\p{Mn}/gu, '');
  return stripped.replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, limit);
}

/* Build chuỗi VietQR. Dynamic (POI 12) khi có amount, không thì static (11). */
export function vietqrPayload(binCode, account, amount = null, purpose = '') {
  const acc = tlv('00', NAPAS_GUID) + tlv('01', tlv('00', binCode) + tlv('01', account)) + tlv('02', SERVICE_ACCOUNT);
  let s = tlv('00', '01') + tlv('01', amount ? '12' : '11') + tlv('38', acc) + tlv('53', '704');
  if (amount) s += tlv('54', String(parseInt(amount, 10)));
  s += tlv('58', 'VN');
  const p = asciiClean(purpose, 25);
  if (p) s += tlv('62', tlv('08', p));
  s += '6304';
  return s + crc16Ccitt(Buffer.from(s, 'ascii')).toString(16).toUpperCase().padStart(4, '0');
}

/* Mã đơn: tiền tố (chỉ [A-Z0-9], tối đa 12 ký tự, mặc định AIMI) + số ngẫu nhiên. */
export function newCode(prefix, digits = 6) {
  const clean = String(prefix || 'AIMI').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'AIMI';
  let out = clean;
  for (let i = 0; i < digits; i++) out += String(crypto.randomInt(0, 10));
  return out;
}

/* Mã có xuất hiện trong nội dung chuyển khoản không? Không phân biệt hoa/thường;
 * ngân hàng có thể lược khoảng trắng/dấu câu nên kiểm tra cả bản chỉ còn [A-Z0-9].
 * Mã không được theo sau bởi một chữ số khác (VIP1234 không khớp VIP12345). */
export function codeIn(code, ...texts) {
  const escaped = String(code).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = new RegExp(escaped + '(?!\\d)');
  for (const t of texts) {
    if (!t) continue;
    const up = String(t).toUpperCase();
    if (pat.test(up)) return true;
    if (pat.test(up.replace(/[^A-Z0-9]/g, ''))) return true;
  }
  return false;
}

/* Trả về [order, 'paid'|'underpay'] cho đơn có mã khớp giao dịch, không thì [null, null]. */
export function matchPayment(orders, pay) {
  for (const o of orders) {
    if (codeIn(o.code, pay?.code, pay?.content)) {
      const paid = Number(pay?.amount || 0) >= Number(o.amount_vnd);
      return [o, paid ? 'paid' : 'underpay'];
    }
  }
  return [null, null];
}

/* ------------------------- Cloudflare Worker API ------------------------- */
function workerBase() {
  const s = getSettings();
  return {
    base: String(s.sepayMailApiUrl || '').trim().replace(/\/+$/, ''),
    token: String(s.sepayMailApiToken || '').trim(),
  };
}

export async function fetchPayments(since) {
  const { base, token } = workerBase();
  const res = await fetch(`${base}/payments?since=${encodeURIComponent(since)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Worker trả ${res.status} khi lấy payments`);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.payments)) return data.payments;
  return [];
}

/* Claim một giao dịch (nguyên tử bên Worker; 409 nếu đã bị claim trước). */
export async function claimPayment(id, by) {
  const { base, token } = workerBase();
  const res = await fetch(`${base}/payments/claim`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, by }),
  });
  return { ok: res.ok, status: res.status };
}

/* ------------------------------ Poller VIP ------------------------------ */
/* Một lượt poll: hết hạn đơn quá TTL, lấy giao dịch mới từ Worker, đối chiếu mã,
 * claim + kích hoạt VIP nếu đủ tiền, đánh dấu underpaid nếu thiếu tiền.
 * Không bao giờ throw; lỗi được log và trả về {error}. */
export async function vipPollOnce() {
  try {
    const s = getSettings();
    if (!String(s.sepayMailApiUrl || '').trim() || !String(s.sepayMailApiToken || '').trim()) {
      return { skipped: true };
    }
    const ts = now();
    const DAY = 86400000;

    // 1. Đơn pending quá hạn thanh toán -> 'expired' (vẫn được nhận tiền trễ trong 24h).
    const stale = db.prepare(
      "SELECT id FROM vip_orders WHERE status = 'pending' AND expires_at < ?"
    ).all(ts);
    for (const row of stale) {
      db.prepare("UPDATE vip_orders SET status = 'expired' WHERE id = ? AND status = 'pending'").run(row.id);
    }

    // 2. Đơn có thể đối chiếu: pending + expired trong 24h gần nhất (cửa sổ nhận tiền trễ).
    const orders = db.prepare(
      `SELECT * FROM vip_orders WHERE status IN ('pending','expired') AND created_at > ? ORDER BY created_at ASC`
    ).all(ts - DAY);
    if (!orders.length) return { checked: 0, paid: 0, underpaid: 0, expired: stale.length };

    // 3. Lấy giao dịch mới từ Worker (con trỏ riêng của platform, không chung với bot).
    const since = Number(getSetting('vipSePaySince') || 0);
    const pays = await fetchPayments(since);
    let maxId = since;
    let paid = 0;
    let underpaid = 0;
    for (const pay of pays) {
      const pid = Number(pay?.id || 0);
      if (pid > maxId) maxId = pid;
      if (pay?.claimed) continue; // đã được claim (bởi bot hoặc lượt poll khác)
      const [order, verdict] = matchPayment(orders, pay);
      if (!order) continue;
      if (verdict === 'paid') {
        const claim = await claimPayment(pay.id, `vip:${order.id}`);
        if (!claim.ok) {
          console.warn(`[vip] Không claim được payment ${pay.id} cho đơn ${order.id} (HTTP ${claim.status})`);
          continue;
        }
        db.prepare(
          "UPDATE vip_orders SET status = 'paid', paid_at = ?, payment_id = ? WHERE id = ? AND status IN ('pending','expired')"
        ).run(ts, pid, order.id);
        try {
          grantVip(order.user_id, order.duration_days);
        } catch (e) {
          console.warn(`[vip] Đã thanh toán đơn ${order.id} nhưng grantVip lỗi:`, e.message);
        }
        paid++;
      } else if (verdict === 'underpay') {
        // Thiếu tiền: không claim, không kích hoạt — admin xử lý tay.
        db.prepare(
          "UPDATE vip_orders SET status = 'underpaid', note = ? WHERE id = ? AND status IN ('pending','expired')"
        ).run(`Thiếu tiền: chuyển ${pay.amount}đ, cần ${order.amount_vnd}đ`, order.id);
        underpaid++;
      }
    }

    // 4. Tiến con trỏ tới id giao dịch lớn nhất đã thấy.
    if (maxId > since) setSetting('vipSePaySince', String(maxId));
    return { checked: pays.length, paid, underpaid, expired: stale.length };
  } catch (e) {
    console.warn('[vip] Poll lỗi:', e.message);
    return { error: e.message };
  }
}
