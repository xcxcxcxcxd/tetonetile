import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { get, insert, run } from '../db.js';
import { config } from '../config.js';
import { requireRole, requireAuth } from '../auth.js';
import { bad, idParam, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';

const r = Router();
const MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' };
const ENTITIES = ['product', 'doc', 'shipment', 'claim', 'mo', 'lot', 'unit', 'client', 'entity', 'qc', 'sample'];
const PUBLIC_ENTITIES = ['product', 'entity'];

/** Upload as JSON { entity, entity_id, filename, mime, data (base64), caption, kind }. Images are resized in the browser first. */
r.post('/files', requireRole('sales', 'production', 'warehouse'), (req, res) => {
  const { entity, entity_id, filename, mime, data, caption, kind } = req.body || {};
  if (!ENTITIES.includes(entity)) throw bad('Unknown attachment target');
  if (!Number(entity_id)) throw bad('Missing entity id');
  if (!MIME[mime]) throw bad('Only JPG, PNG, WebP, GIF or PDF files');
  const buf = Buffer.from(String(data || ''), 'base64');
  if (!buf.length) throw bad('Empty file');
  if (buf.length > 12 * 1024 * 1024) throw bad('File is larger than 12 MB');
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const stored = `${entity}-${entity_id}-${crypto.randomBytes(8).toString('hex')}${MIME[mime]}`;
  fs.writeFileSync(path.join(config.uploadDir, stored), buf);
  const id = insert('attachments', {
    entity, entity_id: Number(entity_id), kind: kind || (mime.startsWith('image/') ? 'image' : 'document'),
    filename: String(filename || stored).slice(0, 200), stored_name: stored, mime, size: buf.length, caption: caption || null, uploaded_by: req.user.id,
  });
  if (entity === 'product' && req.body.set_main) run('UPDATE products SET image_id = ? WHERE id = ?', id, Number(entity_id));
  audit(req, entity, Number(entity_id), 'upload', filename);
  res.status(201).json({ ...get('SELECT * FROM attachments WHERE id = ?', id), url: `/files/${stored}` });
});

r.delete('/files/:id', requireRole('sales', 'production', 'warehouse'), (req, res) => {
  const a = get('SELECT * FROM attachments WHERE id = ?', idParam(req));
  if (!a) throw notFound('File not found');
  run('UPDATE products SET image_id = NULL WHERE image_id = ?', a.id);
  run('UPDATE doc_lines SET image_id = NULL WHERE image_id = ?', a.id);
  run('UPDATE shipment_docs SET attachment_id = NULL WHERE attachment_id = ?', a.id);
  run('DELETE FROM attachments WHERE id = ?', a.id);
  fs.rm(path.join(config.uploadDir, a.stored_name), { force: true }, () => {});
  audit(req, a.entity, a.entity_id, 'delete-file', a.filename);
  res.json({ ok: true });
});

/** Serve an uploaded file. Product pictures and company logos are public; everything else needs a session. */
export function serveFile(req, res, next) {
  const name = String(req.params.name || '');
  if (!/^[a-z]+-\d+-[0-9a-f]{16}\.(jpg|png|webp|gif|pdf)$/.test(name)) return next(notFound('File not found'));
  const a = get('SELECT * FROM attachments WHERE stored_name = ?', name);
  if (!a) return next(notFound('File not found'));
  if (!PUBLIC_ENTITIES.includes(a.entity) && !req.user) return requireAuth(req, res, next);
  res.set('Cache-Control', 'private, max-age=86400');
  res.type(a.mime);
  if (req.query.download) res.attachment(a.filename);
  res.sendFile(path.join(config.uploadDir, a.stored_name), (err) => err && next(notFound('File not found')));
}

export default r;
