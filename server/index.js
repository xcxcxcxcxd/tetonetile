import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb, getDb } from './db.js';
import { seedReference } from './seed.js';
import { loadUser, requireAuth, csrfGuard } from './auth.js';
import { HttpError } from './lib/http.js';
import authRoutes from './routes/auth.js';
import referenceRoutes from './routes/reference.js';
import catalogRoutes, { publicCatalog } from './routes/catalog.js';
import crmRoutes from './routes/crm.js';
import docRoutes from './routes/docs.js';
import productionRoutes from './routes/production.js';
import warehouseRoutes from './routes/warehouse.js';
import shipmentRoutes from './routes/shipments.js';
import fileRoutes, { serveFile } from './routes/files.js';
import qrRoutes from './routes/qr.js';
import knowledgeRoutes from './routes/knowledge.js';
import dashboardRoutes from './routes/dashboard.js';
import dataRoutes from './routes/data.js';

const pub = path.join(config.root, 'public');
const nm = (p) => path.join(config.root, 'node_modules', p);

/** CSP allows the one inline <script type="importmap"> in index.html by its hash. */
function importMapHash() {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const m = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  return m ? `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'` : '';
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${importMapHash()}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });
  app.use(express.json({ limit: '20mb' }));
  app.use(loadUser);

  const assets = { maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0 };
  app.use('/vendor/preact', express.static(nm('preact/dist'), assets));
  app.use('/vendor/preact-hooks', express.static(nm('preact/hooks/dist'), assets));
  app.use('/vendor/htm', express.static(nm('htm/dist'), assets));
  app.use('/vendor/jsqr', express.static(nm('jsqr/dist'), assets));
  app.use('/vendor/marked', express.static(nm('marked/lib'), assets));
  app.use('/shared', express.static(path.join(config.root, 'shared'), assets));
  app.use(express.static(pub, { ...assets, index: false }));
  app.get('/files/:name', serveFile);
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(csrfGuard);
  api.use(authRoutes);
  api.use(publicCatalog);
  api.use(qrRoutes);
  api.use(knowledgeRoutes);
  api.use(requireAuth);
  for (const r of [referenceRoutes, catalogRoutes, crmRoutes, docRoutes, productionRoutes, warehouseRoutes, shipmentRoutes, fileRoutes, dashboardRoutes, dataRoutes]) api.use(r);
  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // Single-page app: every other path (including QR links /q/<code>) loads the app shell.
  app.get('/{*splat}', (req, res) => res.sendFile(path.join(pub, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details || {}) });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large.' });
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid JSON.' });
    if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
      const msg = String(err.message);
      const friendly = msg.includes('UNIQUE') ? 'That code or number is already used.' : msg.includes('FOREIGN KEY') ? 'This record is linked to others and cannot be changed that way.' : 'The data breaks a rule of the database.';
      return res.status(409).json({ error: friendly });
    }
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Something went wrong. The error was logged on the server.' });
  });
  return app;
}

/** Daily safety copy of the database; keeps the 14 most recent. */
export async function autoBackup() {
  try {
    if (!getDb() || config.dbFile === ':memory:') return;
    fs.mkdirSync(config.backupDir, { recursive: true });
    const name = `auto-${new Date().toISOString().slice(0, 10)}.db`;
    const file = path.join(config.backupDir, name);
    if (!fs.existsSync(file)) await getDb().backup(file);
    const autos = fs.readdirSync(config.backupDir).filter((f) => f.startsWith('auto-') && f.endsWith('.db')).sort();
    for (const old of autos.slice(0, Math.max(0, autos.length - 14))) fs.rmSync(path.join(config.backupDir, old), { force: true });
  } catch (e) {
    console.error('Automatic backup failed:', e.message);
  }
}

export function start() {
  openDb();
  if (seedReference()) console.log('Reference data loaded (formats, colours, stages, warehouses, materials).');
  const app = createApp();
  app.listen(config.port, config.host, () => {
    console.log(`Zelligerar CRM running on http://localhost:${config.port}`);
    if (!config.publicUrl) console.log('Tip: set PUBLIC_URL (or Settings > Company > Public address) so QR labels open on phones.');
  });
  autoBackup();
  setInterval(autoBackup, 6 * 3600 * 1000).unref();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start();
