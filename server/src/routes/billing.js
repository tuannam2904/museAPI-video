import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db, uid, now, addCredits, getSettings } from '../db.js';

const r = Router();

/* 会员档位（对应目标站：初级/中级/高级/旗舰） */
export const PLANS = {
  starter: {
    key: 'starter', name: 'Bản Cơ bản', price: 19.9, credits: 144,
    perks: ['Chất lượng chuẩn', 'Mô hình cơ bản', 'Hàng đợi thường'],
  },
  standard: {
    key: 'standard', name: 'Bản Nâng cao', price: 29.9, credits: 224,
    perks: ['Chất lượng HD', 'Tất cả mô hình', 'Hàng đợi ưu tiên'],
  },
  pro: {
    key: 'pro', name: 'Bản Chuyên nghiệp', price: 39.9, credits: 304,
    perks: ['Chất lượng HD', 'Tất cả mô hình', 'Xóa watermark', 'Hàng đợi ưu tiên', 'Giấy phép thương mại'],
  },
  ultimate: {
    key: 'ultimate', name: 'Bản Cao cấp', price: 49.9, credits: 384,
    perks: ['Chất lượng cao nhất', 'Tất cả mô hình', 'Xóa watermark', 'Hàng đợi ưu tiên cao nhất', 'Giấy phép thương mại', 'Hỗ trợ riêng'],
  },
};

const CREDIT_PER_YUAN = 10;

/* ------------------------------- 会员 ------------------------------- */
r.get('/membership', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM memberships WHERE user_id = ?').get(req.user.id);
  res.json({
    plans: Object.values(PLANS),
    current: row
      ? { plan: row.plan, name: PLANS[row.plan]?.name || row.plan, credits: row.credits, startedAt: row.started_at, expiresAt: row.expires_at }
      : null,
  });
});

r.post('/membership', requireAuth, (req, res) => {
  const { plan } = req.body || {};
  const p = PLANS[plan];
  if (!p) return res.status(400).json({ error: 'Gói không tồn tại' });

  const current = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  if (current.credits < p.credits) {
    return res.status(402).json({ error: `Không đủ điểm, đăng ký ${p.name} cần ${p.credits} điểm` });
  }

  const ts = now();
  addCredits(req.user.id, -p.credits, `Đăng ký ${p.name}`, null);
  db.prepare(
    `INSERT INTO memberships(user_id, plan, credits, started_at, expires_at) VALUES(?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, credits = excluded.credits,
       started_at = excluded.started_at, expires_at = excluded.expires_at`
  ).run(req.user.id, plan, p.credits, ts, ts + 30 * 86400 * 1000);

  const order = uid('ord_');
  db.prepare(
    'INSERT INTO orders(id, user_id, kind, amount, credits, plan, status, created_at, paid_at) VALUES(?,?,?,?,?,?,?,?,?)'
  ).run(order, req.user.id, 'membership', p.price, p.credits, plan, 'paid', ts, ts);

  res.json({ ok: true, plan: p, orderId: order });
});

/* ------------------------------- 充值 ------------------------------- */
r.get('/recharge/orders', requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT * FROM orders WHERE user_id = ? AND kind = 'recharge' ORDER BY created_at DESC LIMIT 30")
    .all(req.user.id);
  res.json({ orders: rows });
});

r.post('/recharge', requireAuth, (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Vui lòng nhập số tiền nạp hợp lệ' });
  }
  if (amount > 100000) return res.status(400).json({ error: 'Số tiền nạp một lần quá lớn' });

  const credits = Math.round(amount * CREDIT_PER_YUAN);
  const id = uid('ord_');
  const ts = now();

  db.prepare(
    'INSERT INTO orders(id, user_id, kind, amount, credits, status, created_at) VALUES(?,?,?,?,?,?,?)'
  ).run(id, req.user.id, 'recharge', amount, credits, 'pending', ts);

  // 自托管环境没有真实支付通道：直接按「模拟支付成功」入账
  db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?").run(ts, id);
  addCredits(req.user.id, credits, `Nạp tiền vào tài khoản ¥${amount}`, null);

  res.json({
    ok: true,
    order: { id, amount, credits, status: 'paid' },
    balance: db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id).credits,
  });
});

export default r;
