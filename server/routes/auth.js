import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import {
  hashPassword, verifyPassword, validatePassword, createSession, destroySession, requireAuth, requireRole,
  throttleCheck, throttleFail, throttleReset,
} from '../auth.js';
import { clean } from '../lib/validate.js';
import { bad, idParam, notFound, conflict } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { saveSettings } from '../lib/settings.js';

const r = Router();

r.get('/auth/state', (req, res) => {
  const users = get('SELECT COUNT(*) AS n FROM users').n;
  res.json({ setupNeeded: users === 0, user: req.user });
});

/** First run: create the first admin (only possible while there are no users). */
r.post('/auth/setup', async (req, res) => {
  if (get('SELECT COUNT(*) AS n FROM users').n > 0) throw conflict('Setup is already done.');
  const v = clean(
    { name: { type: 'text', required: true, max: 100 }, email: { type: 'email', required: true }, password: { type: 'text', required: true } },
    req.body,
  );
  validatePassword(v.password);
  const id = insert('users', { name: v.name, email: v.email, password_hash: hashPassword(v.password), role: 'admin' });
  if (req.body.demo) {
    const { seedDemo } = await import('../seed-demo.js');
    seedDemo({ adminId: id });
  }
  saveSettings({ setup_done: true });
  createSession(res, id, req.get('user-agent'));
  req.user = { id };
  audit(req, 'user', id, 'setup', v.email);
  res.json({ ok: true });
});

r.post('/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const key = `${req.ip}|${email}`;
  throttleCheck(key);
  const u = get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', email);
  if (!u || !u.active || !verifyPassword(req.body.password || '', u.password_hash)) {
    throttleFail(key);
    throw bad('Email or password is not correct.');
  }
  throttleReset(key);
  createSession(res, u.id, req.get('user-agent'));
  res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

r.post('/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

r.get('/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

r.post('/auth/password', requireAuth, (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!verifyPassword(req.body.current || '', u.password_hash)) throw bad('Current password is not correct.');
  validatePassword(req.body.next);
  update('users', u.id, { password_hash: hashPassword(req.body.next) });
  audit(req, 'user', u.id, 'password', null);
  res.json({ ok: true });
});

// ---- users (admin) ----
const USER_SPEC = {
  name: { type: 'text', required: true, max: 100 },
  email: { type: 'email', required: true },
  role: { type: 'enum', values: ['admin', 'sales', 'production', 'warehouse', 'viewer'], default: 'viewer' },
  active: { type: 'bool', default: 1 },
};

r.get('/users', requireAuth, (req, res) => {
  const cols = req.user.role === 'admin' ? 'id, name, email, role, active, created_at, last_login_at' : 'id, name, role, active';
  res.json({ rows: all(`SELECT ${cols} FROM users ORDER BY active DESC, name`) });
});

r.post('/users', requireRole(), (req, res) => {
  const v = clean(USER_SPEC, req.body);
  validatePassword(req.body.password);
  if (get('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE', v.email)) throw conflict('A user with this email already exists.');
  const id = insert('users', { ...v, password_hash: hashPassword(req.body.password) });
  audit(req, 'user', id, 'create', `${v.email} (${v.role})`);
  res.status(201).json(get('SELECT id, name, email, role, active FROM users WHERE id = ?', id));
});

r.put('/users/:id', requireRole(), (req, res) => {
  const id = idParam(req);
  const u = get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('User not found');
  const v = clean(USER_SPEC, req.body, { partial: true });
  if (id === req.user.id && (v.role && v.role !== 'admin')) throw bad('You cannot remove your own admin role.');
  if (id === req.user.id && v.active === 0) throw bad('You cannot deactivate yourself.');
  if (v.email && get('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE AND id != ?', v.email, id)) throw conflict('Email already used.');
  if (req.body.password) {
    validatePassword(req.body.password);
    v.password_hash = hashPassword(req.body.password);
  }
  update('users', id, v);
  // A deactivated user or a reset password signs that user out everywhere.
  if ((v.active === 0 || v.password_hash) && id !== req.user.id) run('DELETE FROM sessions WHERE user_id = ?', id);
  audit(req, 'user', id, 'update', u.email);
  res.json(get('SELECT id, name, email, role, active FROM users WHERE id = ?', id));
});

export default r;
