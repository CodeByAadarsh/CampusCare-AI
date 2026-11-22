import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { User } from '../models/User.js';
import { httpError } from '../utils/http.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

/** Requires "Authorization: Bearer <token>". Loads the user into req.user. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw httpError(401, 'Please sign in again.');
    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw httpError(401, 'Your session has expired. Please sign in again.');
    }
    const user = await User.findById(payload.sub);
    if (!user) throw httpError(401, 'This account no longer exists. Please sign in again.');
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (role) => (req, res, next) => {
  if (req.user?.role !== role) return next(httpError(403, 'You do not have access to this action.'));
  next();
};
