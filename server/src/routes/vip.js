import { Router } from 'express';
import QRCode from 'qrcode';
import { requireAuth } from '../auth.js';
import { db, uid, now, getSettings, isVip, vipExpiresAt } from '../db.js';
import { vietqrPayload, newCode } from '../lib/sepay.js';

const r = Router();
r.use(requireAuth);

/* 3 gói VIP — thời hạn cố định theo gói, giá đọc từ settings (admin chỉnh được). */
const VIP_PLANS = {
  day: { key: 'day', days: 1, priceKey: 'vipPriceDayVnd' },
  week: { key: 'week', days: 7, priceKey: 'vipPriceWeekVnd' },
  month: { key: 'month', days: 30, priceKey: 'vipPriceMonthVnd' },
};

function planOf(settings, plan) {
  const p = VIP_PLANS[plan] || VIP_PLANS.month;
  return { key: p.key, days: p.days, priceVnd: Number(settings[p.priceKey]) || 0 };
}

function plansList(settings) {
  return Object.values(VIP_PLANS).map((p) => ({
    key: p.key,
    days: p.days,
    priceVnd: Number(settings[p.priceKey]) || 0,
  }));
}

function bankInfo(settings) {
  return {
    accountNo: String(settings.sepayMbAccountNo || ''),
    accountName: String(settings.sepayMbAccountName || ''),
    bin: String(settings.sepayMbBin || ''),
  };
}

function orderShape(o) {
  return {
    id: o.id,
    code: o.code,
    amountVnd: o.amount_vnd,
    status: o.status,
    plan: o.duration_days === 1 ? 'day' : o.duration_days === 7 ? 'week' : 'month',
    durationDays: o.duration_days,
    createdAt: o.created_at,
    expiresAt: o.expires_at,
    paidAt: o.paid_at,
    paymentId: o.payment_id,
    note: o.note || null,
  };
}

async function qrFor(order, settings) {
  const bank = bankInfo(settings);
  const qrPayload = vietqrPayload(bank.bin, bank.accountNo, order.amount_vnd, order.code);
  let qrDataUrl = null;
  try {
    qrDataUrl = await QRCode.toDataURL(qrPayload);
  } catch (e) {
    console.warn('[vip] Tạo QR lỗi:', e.message);
  }
  return { qrPayload, qrDataUrl, bank };
}

/* Tạo đơn mua VIP: chuyển khoản VietQR (SePay), mã đơn = tiền tố + 6 số. */
r.post('/order', async (req, res) => {
  try {
    const settings = getSettings();
    const plan = planOf(settings, req.body?.plan);
    if (!plan.priceVnd || plan.priceVnd <= 0) {
      return res.status(400).json({ error: 'Gói VIP chưa được cấu hình giá' });
    }

    // Tối đa 3 đơn pending/user (tránh spam đơn).
    const pending = db.prepare(
      "SELECT COUNT(*) n FROM vip_orders WHERE user_id = ? AND status = 'pending'"
    ).get(req.user.id).n;
    if (pending >= 3) {
      return res.status(400).json({ error: 'Bạn đang có 3 đơn chờ thanh toán, hãy thanh toán hoặc hủy bớt' });
    }

    const ttlMin = Number(settings.vipOrderTtlMin) || 10;
    const ts = now();
    const code = newCode(settings.sepayCodePrefix, 6);
    const id = uid('vip_');
    db.prepare(
      `INSERT INTO vip_orders(id, user_id, code, amount_vnd, status, duration_days, created_at, expires_at)
       VALUES(?,?,?,?,'pending',?,?,?)`
    ).run(id, req.user.id, code, plan.priceVnd, plan.days, ts, ts + ttlMin * 60000);
    const order = db.prepare('SELECT * FROM vip_orders WHERE id = ?').get(id);
    const qr = await qrFor(order, settings);
    res.json({ order: orderShape(order), ...qr });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Trạng thái VIP + bảng giá 3 gói (để frontend render). */
r.get('/status', (req, res) => {
  const settings = getSettings();
  const plans = plansList(settings);
  const month = plans.find((p) => p.key === 'month') || plans[plans.length - 1];
  res.json({
    isVip: isVip(req.user.id),
    vipExpiresAt: vipExpiresAt(req.user.id),
    plans,
    // Giữ 2 field cũ (gói tháng) để tương thích ngược.
    priceVnd: month?.priceVnd ?? 0,
    durationDays: month?.days ?? 30,
  });
});

/* Đơn VIP của mình (20 đơn mới nhất). */
r.get('/orders', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM vip_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(req.user.id);
  res.json({ orders: rows.map(orderShape) });
});

/* Chi tiết một đơn của mình (kèm VietQR để thanh toán lại nếu chưa hết hạn). */
r.get('/order/:id', async (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM vip_orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'Đơn không tồn tại' });
    const settings = getSettings();
    const qr = await qrFor(order, settings);
    res.json({ order: orderShape(order), ...qr });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* Hủy đơn đang chờ thanh toán của mình. */
r.post('/order/:id/cancel', (req, res) => {
  const order = db.prepare('SELECT * FROM vip_orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Đơn không tồn tại' });
  if (order.status !== 'pending') {
    return res.status(400).json({ error: `Đơn đã ${order.status}, không thể hủy` });
  }
  db.prepare("UPDATE vip_orders SET status = 'canceled' WHERE id = ?").run(order.id);
  res.json({ ok: true, order: orderShape({ ...order, status: 'canceled' }) });
});

export default r;
