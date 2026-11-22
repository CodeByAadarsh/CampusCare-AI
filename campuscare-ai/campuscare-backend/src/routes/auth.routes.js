import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { asyncHandler, httpError } from '../utils/http.js';
import { config } from '../config.js';

const router = Router();
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** POST /api/auth/login  { email, password, role? } -> { token, user } */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) throw httpError(400, 'Enter your college email and password.');

  const user = await User.findOne({ email: String(email).toLowerCase().trim() });
  const ok = user && (await bcrypt.compare(String(password), user.passwordHash));
  if (!ok) throw httpError(401, 'That email and password do not match an account.');
  if (role && role !== user.role) {
    throw httpError(403, `${user.email} is registered as ${user.role === 'admin' ? 'an administrator' : 'a student'}. Switch the role above.`);
  }
  res.json({ token: signToken(user), user: user.toPublic() });
}));

/** POST /api/auth/register  { name, email, password, enrollment?, branch? } -> { token, user }  (students only) */
router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password, enrollment, branch } = req.body || {};
  const mail = String(email || '').toLowerCase().trim();
  if (!name || String(name).trim().length < 2) throw httpError(400, 'Enter your full name.');
  if (!EMAIL_RX.test(mail)) throw httpError(400, 'Enter a valid email address.');
  if (config.allowedEmailDomain && !mail.endsWith(`@${config.allowedEmailDomain}`)) {
    throw httpError(400, `Use your @${config.allowedEmailDomain} college email.`);
  }
  if (!password || String(password).length < 8) throw httpError(400, 'Use a password of at least 8 characters.');

  const user = await User.create({
    name: String(name).trim(),
    email: mail,
    passwordHash: await bcrypt.hash(String(password), 10),
    role: 'student', // administrators are created by the seed script or an existing admin, never by self sign-up
    enrollment: enrollment ? String(enrollment).trim() : undefined,
    branch: branch ? String(branch).trim() : undefined,
  });
  res.status(201).json({ token: signToken(user), user: user.toPublic() });
}));

/** GET /api/auth/me -> user */
router.get('/me', requireAuth, (req, res) => res.json(req.user.toPublic()));

export default router;
