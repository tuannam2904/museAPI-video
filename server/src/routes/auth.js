import { Router } from 'express';
import { db, now, getSetting, addCredits } from '../db.js';
import {
  createUser, findUserByEmail, verifyPassword, signToken, publicUser,
  requireAuth, hashPassword, inviteCodeOf, findByInviteCode, invitedUsers,
} from '../auth.js';

const r = Router();

r.post('/register', (req, res) => {
  const { email, password, name, ref } = req.body || {};
  if (getSetting('allowRegister') === '0') return res.status(403).json({ error: 'Hiện chưa mở đăng ký' });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Định dạng email không đúng' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Mật khẩu ít nhất 6 ký tự' });
  if (findUserByEmail(email)) return res.status(409).json({ error: 'Email này đã được đăng ký' });

  // 邀请关系：邀请人 +50，被邀请人额外 +50
  const inviter = ref ? findByInviteCode(ref) : null;
  const user = createUser({ email, password, name, invitedBy: inviter?.id || null });

  if (inviter) {
    try {
      addCredits(inviter.id, 50, `Mời người dùng mới ${user.email.split('@')[0]}`);
      addCredits(user.id, 50, 'Thưởng đăng ký theo lời mời');
    } catch (e) {
      console.error('[invite] 奖励发放失败', e.message);
    }
  }

  res.json({ token: signToken(user), user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

r.get('/invite', requireAuth, (req, res) => {
  const code = inviteCodeOf(req.user.id);
  const list = invitedUsers(req.user.id);
  res.json({
    code,
    link: `${req.protocol}://${req.get('host')}/login?ref=${code}`,
    total: list.length,
    invited: list.map((u) => ({
      email: u.email.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
      name: u.name || u.email.split('@')[0],
      createdAt: u.created_at,
    })),
    reward: { inviter: 50, invitee: 50 },
  });
});

r.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'Tài khoản đã bị khóa' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

r.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

r.patch('/me', requireAuth, (req, res) => {
  const { name, password, oldPassword } = req.body || {};
  if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).slice(0, 40), req.user.id);
  if (password) {
    if (!verifyPassword(String(oldPassword || ''), req.user.password_hash)) {
      return res.status(400).json({ error: 'Mật khẩu cũ không đúng' });
    }
    if (String(password).length < 6) return res.status(400).json({ error: 'Mật khẩu mới ít nhất 6 ký tự' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(password)), req.user.id);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

r.get('/ledger', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(req.user.id);
  res.json({ ledger: rows });
});

export default r;
