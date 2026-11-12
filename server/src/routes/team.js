import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db, now, addCredits } from '../db.js';
import { inviteCodeOf, findByInviteCode } from '../auth.js';

const r = Router();

/* 团队 = 我邀请来的人 + 我邀请的人邀请来的人（两层） */
function teamMembers(userId) {
  const direct = db
    .prepare('SELECT id, email, name, credits, created_at FROM users WHERE invited_by = ?')
    .all(userId);
  const ids = direct.map((u) => u.id);
  let second = [];
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    second = db
      .prepare(`SELECT id, email, name, credits, created_at, invited_by FROM users WHERE invited_by IN (${marks})`)
      .all(...ids);
  }
  return { direct, second };
}

r.get('/team', requireAuth, (req, res) => {
  const { direct, second } = teamMembers(req.user.id);
  const mask = (e) => String(e).replace(/^(.{2}).*(@.*)$/, '$1***$2');

  res.json({
    inviteCode: inviteCodeOf(req.user.id),
    stats: {
      direct: direct.length,
      second: second.length,
      creditsEarned: direct.length * 50,
    },
    members: [
      ...direct.map((u) => ({
        id: u.id, name: u.name || u.email.split('@')[0], email: mask(u.email),
        credits: u.credits, level: 1, joinedAt: u.created_at,
      })),
      ...second.map((u) => ({
        id: u.id, name: u.name || u.email.split('@')[0], email: mask(u.email),
        credits: u.credits, level: 2, joinedAt: u.created_at,
      })),
    ].sort((a, b) => b.joinedAt - a.joinedAt),
  });
});

/* 积分转赠 */
r.post('/team/transfer', requireAuth, (req, res) => {
  const { email, credits } = req.body || {};
  const amount = Math.floor(Number(credits));
  if (!email) return res.status(400).json({ error: 'Vui lòng nhập email của đối phương' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Vui lòng nhập số điểm hợp lệ' });

  const target = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase().trim());
  if (!target) return res.status(404).json({ error: 'Đối phương chưa đăng ký' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Không thể chuyển cho chính mình' });

  const me = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  if (me.credits < amount) return res.status(402).json({ error: `Không đủ điểm, hiện có ${me.credits}` });

  addCredits(req.user.id, -amount, `Tặng cho ${target.email.split('@')[0]}`, null);
  addCredits(target.id, amount, `Được tặng từ ${req.user.email.split('@')[0]}`, null);

  res.json({
    ok: true,
    balance: db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id).credits,
  });
});

/* 通过邀请码加入（把当前用户挂到邀请人名下） */
r.post('/team/join', requireAuth, (req, res) => {
  const code = String(req.body?.code || '').trim();
  const inviter = findByInviteCode(code);
  if (!inviter) return res.status(404).json({ error: 'Mã mời không hợp lệ' });
  if (inviter.id === req.user.id) return res.status(400).json({ error: 'Không thể tham gia nhóm của chính mình' });

  const existing = db.prepare('SELECT invited_by FROM users WHERE id = ?').get(req.user.id);
  if (existing?.invited_by) return res.status(409).json({ error: 'Bạn đã có người giới thiệu' });

  db.prepare('UPDATE users SET invited_by = ? WHERE id = ?').run(inviter.id, req.user.id);
  res.json({ ok: true, inviter: inviter.name || inviter.email.split('@')[0] });
});

export default r;
