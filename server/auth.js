import crypto from 'node:crypto';
import { get, run, nowTs } from './db.js';
import { config } from './config.js';
import { HttpError, forbidden } from './lib/http.js';

const COOKIE = 'zsid';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(res, userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  run(
    'INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)',
    sha256(token),
    userId,
    expires.toISOString().replace('T', ' ').slice(0, 19),
    String(userAgent || '').slice(0, 200),
  );
  run('UPDATE users SET last_login_at = ? WHERE id = ?', nowTs(), userId);
  setCookie(res, token, expires);
}

export function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) run('DELETE FROM sessions WHERE id = ?', sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.secureCookies ? '; Secure' : ''}`);
}

function setCookie(res, token, expires) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${config.secureCookies ? '; Secure' : ''}`,
  );
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/** Attaches req.user when a valid session cookie is present. Never rejects. */
export function loadUser(req, _res, next) {
  req.user = null;
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = get(
      `SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now') AND u.active = 1`,
      sha256(token),
    );
    if (row) req.user = row;
  }
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  next();
}

/** Allow only the listed roles (admin is always allowed). */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in.'));
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    next(forbidden());
  };
}

export const can = (user, ...roles) => !!user && (user.role === 'admin' || roles.includes(user.role));

/**
 * CSRF guard for the JSON API: browsers cannot send a custom header cross-site
 * without a CORS preflight (which this server never approves), and the session
 * cookie is SameSite=Lax.
 */
export function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'zelligerar') return next(new HttpError(403, 'Missing request header.'));
  next();
}

// Simple login throttle: 10 failed attempts per 15 minutes per IP + email.
const attempts = new Map();
export function throttleCheck(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && now - a.first < 15 * 60000 && a.count >= 10) {
    throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  }
}
export function throttleFail(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > 15 * 60000) attempts.set(key, { first: now, count: 1 });
  else a.count++;
  if (attempts.size > 5000) attempts.clear();
}
export const throttleReset = (key) => attempts.delete(key);
