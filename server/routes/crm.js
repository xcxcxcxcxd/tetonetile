import { Router } from 'express';
import { all, get, insert, update, run, today, nowTs } from '../db.js';
import { requireRole } from '../auth.js';
import { clean } from '../lib/validate.js';
import { bad, idParam, notFound, conflict } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { crud } from '../lib/crud.js';
import { nextNumber } from '../lib/numbering.js';
import { listDocs, defaultTierId } from '../services/docs.js';
import { OPP_STAGES } from '../../shared/constants.js';
import { round2 } from '../../shared/calc.js';

const r = Router();

const CLIENT_SPEC = {
  code: { type: 'text', upper: true, max: 20 },
  company: { type: 'text', required: true, max: 200 },
  type: { type: 'enum', values: ['end_user', 'trade', 'wholesale', 'programme', 'distributor'], default: 'end_user' },
  tier_id: { type: 'fk' },
  currency: { type: 'text', upper: true, max: 3, default: 'EUR' },
  region: { type: 'enum', values: ['US', 'EU', 'UK', 'GCC', 'MA', 'OTHER'], default: 'EU' },
  country: { type: 'text' }, city: { type: 'text' }, address: { type: 'text' },
  contact_name: { type: 'text' }, email: { type: 'email' }, phone: { type: 'text' }, website: { type: 'text' },
  vat_number: { type: 'text' }, incoterm: { type: 'text', upper: true }, incoterm_place: { type: 'text' },
  payment_terms: { type: 'text' }, deposit_pct: { type: 'num', min: 0, max: 100 }, source: { type: 'text' },
  owner_id: { type: 'fk' }, tags: { type: 'text' }, notes: { type: 'text' }, archived: { type: 'bool', default: 0 },
};

r.get('/clients', (req, res) => {
  const where = [];
  const params = [];
  const q = String(req.query.q || '').trim();
  if (q) {
    where.push('(c.company LIKE ? OR c.contact_name LIKE ? OR c.email LIKE ? OR c.code LIKE ? OR c.country LIKE ? OR c.city LIKE ? OR c.tags LIKE ?)');
    for (let i = 0; i < 7; i++) params.push(`%${q}%`);
  }
  for (const k of ['type', 'region', 'owner_id', 'currency']) {
    if (req.query[k]) {
      where.push(`c.${k} = ?`);
      params.push(req.query[k]);
    }
  }
  where.push(req.query.archived === '1' ? 'c.archived = 1' : 'c.archived = 0');
  const rows = all(
    `SELECT c.*, t.name AS tier_name, u.name AS owner_name,
       (SELECT COUNT(*) FROM sales_docs d WHERE d.client_id = c.id AND d.type = 'quote' AND d.status IN ('draft','sent')) AS open_quotes,
       (SELECT COUNT(*) FROM sales_docs d WHERE d.client_id = c.id AND d.type = 'order' AND d.status NOT IN ('cancelled','closed','delivered')) AS open_orders,
       (SELECT COALESCE(SUM(d.total), 0) FROM sales_docs d WHERE d.client_id = c.id AND d.type = 'invoice' AND d.status NOT IN ('draft','cancelled')) AS invoiced,
       (SELECT COALESCE(SUM(o.value), 0) FROM opportunities o WHERE o.client_id = c.id AND o.stage NOT IN ('won','lost')) AS pipeline,
       (SELECT MAX(a.created_at) FROM activities a WHERE a.client_id = c.id) AS last_activity
     FROM clients c LEFT JOIN price_tiers t ON t.id = c.tier_id LEFT JOIN users u ON u.id = c.owner_id
     WHERE ${where.join(' AND ')} ORDER BY c.company LIMIT 2000`,
    ...params,
  );
  res.json({ rows });
});

r.get('/clients/:id', (req, res) => {
  const id = idParam(req);
  const c = get('SELECT c.*, t.name AS tier_name, u.name AS owner_name FROM clients c LEFT JOIN price_tiers t ON t.id = c.tier_id LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?', id);
  if (!c) throw notFound('Client not found');
  const docs = listDocs({ client_id: id, limit: 500 });
  const sum = (type) => round2(docs.filter((d) => d.type === type && !['draft', 'cancelled'].includes(d.status)).reduce((s, d) => s + d.total, 0));
  res.json({
    client: c,
    contacts: all('SELECT * FROM contacts WHERE client_id = ? ORDER BY is_primary DESC, name', id),
    opportunities: all('SELECT o.*, u.name AS owner_name FROM opportunities o LEFT JOIN users u ON u.id = o.owner_id WHERE o.client_id = ? ORDER BY o.updated_at DESC', id),
    docs,
    samples: all('SELECT * FROM samples WHERE client_id = ? ORDER BY id DESC', id),
    activities: all(
      `SELECT a.*, u.name AS user_name, au.name AS assigned_name, d.number AS doc_number FROM activities a
       LEFT JOIN users u ON u.id = a.user_id LEFT JOIN users au ON au.id = a.assigned_to LEFT JOIN sales_docs d ON d.id = a.doc_id
       WHERE a.client_id = ? ORDER BY a.created_at DESC LIMIT 200`,
      id,
    ),
    claims: all('SELECT * FROM claims WHERE client_id = ? ORDER BY id DESC', id),
    shipments: all('SELECT * FROM shipments WHERE client_id = ? ORDER BY id DESC', id),
    contract_prices: all(
      `SELECT pl.*, p.sku, p.name AS product_name FROM price_list pl JOIN products p ON p.id = pl.product_id WHERE pl.client_id = ? ORDER BY p.sku`,
      id,
    ),
    stats: {
      quoted: sum('quote'),
      ordered: sum('order'),
      invoiced: sum('invoice'),
      outstanding: round2(docs.filter((d) => d.type === 'invoice' && ['issued', 'partially_paid'].includes(d.status)).reduce((s, d) => s + d.balance, 0)),
      overdue: docs.filter((d) => d.display_status === 'overdue').length,
    },
  });
});

r.post('/clients', requireRole('sales'), (req, res) => {
  const v = clean(CLIENT_SPEC, req.body);
  if (!v.tier_id) v.tier_id = defaultTierId(v.type);
  if (v.code && get('SELECT 1 FROM clients WHERE code = ?', v.code)) throw conflict(`Client code ${v.code} is taken.`);
  if (!v.owner_id) v.owner_id = req.user.id;
  const id = insert('clients', v);
  if (!v.code) update('clients', id, { code: `C${String(id).padStart(4, '0')}` });
  if (v.contact_name) insert('contacts', { client_id: id, name: v.contact_name, email: v.email, phone: v.phone, is_primary: 1 });
  audit(req, 'client', id, 'create', v.company);
  res.status(201).json(get('SELECT * FROM clients WHERE id = ?', id));
});

r.put('/clients/:id', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const c = get('SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw notFound('Client not found');
  const v = clean(CLIENT_SPEC, req.body, { partial: true });
  if (v.code && get('SELECT 1 FROM clients WHERE code = ? AND id != ?', v.code, id)) throw conflict(`Client code ${v.code} is taken.`);
  v.updated_at = nowTs();
  update('clients', id, v);
  audit(req, 'client', id, 'update', c.company);
  res.json(get('SELECT * FROM clients WHERE id = ?', id));
});

r.delete('/clients/:id', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const c = get('SELECT * FROM clients WHERE id = ?', id);
  if (!c) throw notFound('Client not found');
  if (get('SELECT 1 FROM sales_docs WHERE client_id = ? LIMIT 1', id)) {
    update('clients', id, { archived: 1, updated_at: nowTs() });
    audit(req, 'client', id, 'archive', c.company);
    return res.json({ ok: true, archived: true });
  }
  run('DELETE FROM clients WHERE id = ?', id);
  audit(req, 'client', id, 'delete', c.company);
  res.json({ ok: true });
});

r.use(
  '/contacts',
  crud({
    table: 'contacts',
    write: ['sales'],
    spec: {
      client_id: { type: 'fk', required: true }, name: { type: 'text', required: true }, role: { type: 'text' }, email: { type: 'email' },
      phone: { type: 'text' }, whatsapp: { type: 'text' }, is_primary: { type: 'bool' }, notes: { type: 'text' },
    },
    filters: ['client_id'],
    defaultSort: 'contacts.is_primary DESC, contacts.name',
  }),
);

// ---- opportunities (pipeline) ----
const OPP_SPEC = {
  client_id: { type: 'fk', required: true }, title: { type: 'text', required: true }, project: { type: 'text' },
  stage: { type: 'enum', values: Object.keys(OPP_STAGES), default: 'new' }, value: { type: 'num', min: 0 }, currency: { type: 'text', upper: true },
  area_m2: { type: 'num', min: 0 }, expected_close: { type: 'date' }, probability: { type: 'int', min: 0, max: 100 },
  lost_reason: { type: 'text' }, owner_id: { type: 'fk' }, notes: { type: 'text' },
};

r.get('/opportunities', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.stage) {
    where.push('o.stage = ?');
    params.push(req.query.stage);
  }
  if (req.query.client_id) {
    where.push('o.client_id = ?');
    params.push(req.query.client_id);
  }
  if (req.query.open === '1') where.push("o.stage NOT IN ('won','lost')");
  if (req.query.q) {
    where.push('(o.title LIKE ? OR o.project LIKE ? OR c.company LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  res.json({
    rows: all(
      `SELECT o.*, c.company AS client_name, c.country, c.currency AS client_currency, u.name AS owner_name,
         (SELECT COUNT(*) FROM samples s WHERE s.opportunity_id = o.id) AS samples,
         (SELECT d.number FROM sales_docs d WHERE d.opportunity_id = o.id AND d.type = 'quote' ORDER BY d.id DESC LIMIT 1) AS last_quote,
         (SELECT d.id FROM sales_docs d WHERE d.opportunity_id = o.id AND d.type = 'quote' ORDER BY d.id DESC LIMIT 1) AS last_quote_id,
         (SELECT MIN(a.due_date) FROM activities a WHERE a.opportunity_id = o.id AND a.done = 0 AND a.due_date IS NOT NULL) AS next_task
       FROM opportunities o JOIN clients c ON c.id = o.client_id LEFT JOIN users u ON u.id = o.owner_id
       WHERE ${where.join(' AND ')} ORDER BY o.updated_at DESC LIMIT 1000`,
      ...params,
    ),
  });
});

r.post('/opportunities', requireRole('sales'), (req, res) => {
  const v = clean(OPP_SPEC, req.body);
  if (v.probability === null || v.probability === undefined) v.probability = OPP_STAGES[v.stage].probability;
  if (!v.owner_id) v.owner_id = req.user.id;
  if (!v.currency) v.currency = get('SELECT currency FROM clients WHERE id = ?', v.client_id)?.currency || 'EUR';
  const id = insert('opportunities', v);
  audit(req, 'opportunity', id, 'create', v.title);
  res.status(201).json(get('SELECT * FROM opportunities WHERE id = ?', id));
});

r.put('/opportunities/:id', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const o = get('SELECT * FROM opportunities WHERE id = ?', id);
  if (!o) throw notFound('Opportunity not found');
  const v = clean(OPP_SPEC, req.body, { partial: true });
  if (v.stage && v.stage !== o.stage) {
    if (req.body.probability === undefined) v.probability = OPP_STAGES[v.stage].probability;
    if (v.stage === 'lost' && !v.lost_reason && !o.lost_reason) throw bad('Say why the opportunity was lost - it helps pricing and follow-up.');
    insert('activities', {
      client_id: o.client_id, opportunity_id: id, type: 'note', subject: `Stage: ${OPP_STAGES[o.stage].label} → ${OPP_STAGES[v.stage].label}`,
      body: v.lost_reason || null, done: 1, done_at: nowTs(), user_id: req.user.id,
    });
  }
  v.updated_at = nowTs();
  update('opportunities', id, v);
  audit(req, 'opportunity', id, 'update', o.title);
  res.json(get('SELECT * FROM opportunities WHERE id = ?', id));
});

r.delete('/opportunities/:id', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  run('UPDATE sales_docs SET opportunity_id = NULL WHERE opportunity_id = ?', id);
  run('DELETE FROM opportunities WHERE id = ?', id);
  audit(req, 'opportunity', id, 'delete', null);
  res.json({ ok: true });
});

// ---- activities and tasks ----
const ACT_SPEC = {
  client_id: { type: 'fk' }, opportunity_id: { type: 'fk' }, doc_id: { type: 'fk' },
  type: { type: 'enum', values: ['note', 'call', 'email', 'meeting', 'whatsapp', 'task'], default: 'note' },
  subject: { type: 'text', required: true, max: 300 }, body: { type: 'text' }, due_date: { type: 'date' },
  done: { type: 'bool' }, assigned_to: { type: 'fk' },
};

r.get('/activities', (req, res) => {
  const where = ['1=1'];
  const params = [];
  for (const k of ['client_id', 'opportunity_id', 'doc_id', 'assigned_to', 'type']) {
    if (req.query[k]) {
      where.push(`a.${k} = ?`);
      params.push(req.query[k]);
    }
  }
  if (req.query.open === '1') where.push('a.done = 0 AND a.due_date IS NOT NULL');
  if (req.query.mine === '1') {
    where.push('(a.assigned_to = ? OR (a.assigned_to IS NULL AND a.user_id = ?))');
    params.push(req.user.id, req.user.id);
  }
  res.json({
    rows: all(
      `SELECT a.*, c.company AS client_name, o.title AS opportunity_title, u.name AS user_name, au.name AS assigned_name, d.number AS doc_number
       FROM activities a LEFT JOIN clients c ON c.id = a.client_id LEFT JOIN opportunities o ON o.id = a.opportunity_id
       LEFT JOIN users u ON u.id = a.user_id LEFT JOIN users au ON au.id = a.assigned_to LEFT JOIN sales_docs d ON d.id = a.doc_id
       WHERE ${where.join(' AND ')} ORDER BY a.done, a.due_date IS NULL, a.due_date, a.created_at DESC LIMIT 500`,
      ...params,
    ),
  });
});

r.post('/activities', requireRole('sales', 'production', 'warehouse'), (req, res) => {
  const v = clean(ACT_SPEC, req.body);
  if (v.due_date && v.type !== 'task') v.type = 'task';
  if (v.done) v.done_at = nowTs();
  const id = insert('activities', { ...v, user_id: req.user.id });
  if (v.opportunity_id) update('opportunities', v.opportunity_id, { updated_at: nowTs() });
  res.status(201).json(get('SELECT * FROM activities WHERE id = ?', id));
});

r.put('/activities/:id', requireRole('sales', 'production', 'warehouse'), (req, res) => {
  const id = idParam(req);
  const a = get('SELECT * FROM activities WHERE id = ?', id);
  if (!a) throw notFound('Activity not found');
  const v = clean(ACT_SPEC, req.body, { partial: true });
  if (v.done === 1 && !a.done) v.done_at = nowTs();
  if (v.done === 0) v.done_at = null;
  update('activities', id, v);
  res.json(get('SELECT * FROM activities WHERE id = ?', id));
});

r.delete('/activities/:id', requireRole('sales'), (req, res) => {
  run('DELETE FROM activities WHERE id = ?', idParam(req));
  res.json({ ok: true });
});

// ---- samples ----
const SAMPLE_SPEC = {
  client_id: { type: 'fk', required: true }, opportunity_id: { type: 'fk' },
  status: { type: 'enum', values: ['requested', 'prepared', 'sent', 'delivered', 'approved', 'rejected'], default: 'requested' },
  items: { type: 'json' }, method: { type: 'enum', values: ['courier', 'groupage', 'hand', 'pickup'], default: 'groupage' },
  tracking: { type: 'text' }, charge: { type: 'num', min: 0 }, currency: { type: 'text', upper: true }, paid: { type: 'bool' },
  sent_at: { type: 'date' }, follow_up: { type: 'date' }, feedback: { type: 'text' }, notes: { type: 'text' },
};

r.get('/samples', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status) {
    where.push('s.status = ?');
    params.push(req.query.status);
  }
  if (req.query.client_id) {
    where.push('s.client_id = ?');
    params.push(req.query.client_id);
  }
  if (req.query.open === '1') where.push("s.status NOT IN ('approved','rejected')");
  const rows = all(
    `SELECT s.*, c.company AS client_name, o.title AS opportunity_title FROM samples s JOIN clients c ON c.id = s.client_id
     LEFT JOIN opportunities o ON o.id = s.opportunity_id WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 500`,
    ...params,
  );
  const ids = new Set();
  for (const s of rows) for (const it of safeJson(s.items)) ids.add(Number(it.product_id));
  const products = ids.size ? all(`SELECT p.id, p.sku, p.name, c.hex FROM products p LEFT JOIN colours c ON c.id = p.colour_id WHERE p.id IN (${[...ids].join(',')})`) : [];
  const pm = new Map(products.map((p) => [p.id, p]));
  res.json({
    rows: rows.map((s) => ({
      ...s,
      items: safeJson(s.items).map((it) => ({ ...it, ...(pm.get(Number(it.product_id)) || {}), image_url: it.product_id ? `/api/products/${it.product_id}/image` : null })),
    })),
  });
});

const safeJson = (s) => {
  try {
    return JSON.parse(s || '[]') || [];
  } catch {
    return [];
  }
};

r.post('/samples', requireRole('sales'), (req, res) => {
  const v = clean(SAMPLE_SPEC, req.body);
  const id = insert('samples', { ...v, number: nextNumber('sample') });
  if (v.opportunity_id) {
    const o = get('SELECT stage FROM opportunities WHERE id = ?', v.opportunity_id);
    if (o && ['new', 'qualified'].includes(o.stage)) update('opportunities', v.opportunity_id, { stage: 'samples', probability: OPP_STAGES.samples.probability, updated_at: nowTs() });
  }
  audit(req, 'sample', id, 'create', null);
  res.status(201).json(get('SELECT * FROM samples WHERE id = ?', id));
});

r.put('/samples/:id', requireRole('sales', 'warehouse'), (req, res) => {
  const id = idParam(req);
  const s = get('SELECT * FROM samples WHERE id = ?', id);
  if (!s) throw notFound('Sample not found');
  const v = clean(SAMPLE_SPEC, req.body, { partial: true });
  if (v.status === 'sent' && !s.sent_at && !v.sent_at) v.sent_at = today();
  if (v.status === 'sent' && !s.follow_up && !v.follow_up) {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    v.follow_up = d.toISOString().slice(0, 10);
  }
  update('samples', id, v);
  audit(req, 'sample', id, 'update', s.number);
  res.json(get('SELECT * FROM samples WHERE id = ?', id));
});

r.delete('/samples/:id', requireRole('sales'), (req, res) => {
  run('DELETE FROM samples WHERE id = ?', idParam(req));
  res.json({ ok: true });
});

// ---- claims ----
const CLAIM_SPEC = {
  client_id: { type: 'fk', required: true }, order_id: { type: 'fk' }, shipment_id: { type: 'fk' }, lot_id: { type: 'fk' },
  reported_at: { type: 'date', required: true }, in_writing: { type: 'bool', default: 1 }, before_installation: { type: 'bool', default: 1 },
  category: { type: 'enum', values: ['breakage', 'shortage', 'wrong_item', 'colour', 'quality', 'other'], default: 'breakage' },
  description: { type: 'text' }, qty_affected: { type: 'num', min: 0 }, unit: { type: 'text' },
  status: { type: 'enum', values: ['open', 'investigating', 'accepted', 'rejected', 'resolved'], default: 'open' },
  resolution: { type: 'text' }, credit_amount: { type: 'num', min: 0 },
};

r.get('/claims', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status) {
    where.push('cl.status = ?');
    params.push(req.query.status);
  }
  if (req.query.open === '1') where.push("cl.status IN ('open','investigating','accepted')");
  res.json({
    rows: all(
      `SELECT cl.*, c.company AS client_name, d.number AS order_number, s.number AS shipment_number, l.code AS lot_code
       FROM claims cl JOIN clients c ON c.id = cl.client_id LEFT JOIN sales_docs d ON d.id = cl.order_id
       LEFT JOIN shipments s ON s.id = cl.shipment_id LEFT JOIN lots l ON l.id = cl.lot_id
       WHERE ${where.join(' AND ')} ORDER BY cl.id DESC LIMIT 500`,
      ...params,
    ),
  });
});

r.get('/claims/:id', (req, res) => {
  const id = idParam(req);
  const c = get(
    `SELECT cl.*, c.company AS client_name, d.number AS order_number, s.number AS shipment_number, l.code AS lot_code
     FROM claims cl JOIN clients c ON c.id = cl.client_id LEFT JOIN sales_docs d ON d.id = cl.order_id
     LEFT JOIN shipments s ON s.id = cl.shipment_id LEFT JOIN lots l ON l.id = cl.lot_id WHERE cl.id = ?`,
    id,
  );
  if (!c) throw notFound('Claim not found');
  res.json({ claim: c, photos: all("SELECT * FROM attachments WHERE entity = 'claim' AND entity_id = ? ORDER BY id", id) });
});

r.post('/claims', requireRole('sales'), (req, res) => {
  const v = clean(CLAIM_SPEC, req.body);
  const id = insert('claims', { ...v, number: nextNumber('claim'), created_by: req.user.id });
  audit(req, 'claim', id, 'create', v.category);
  res.status(201).json(get('SELECT * FROM claims WHERE id = ?', id));
});

r.put('/claims/:id', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const c = get('SELECT * FROM claims WHERE id = ?', id);
  if (!c) throw notFound('Claim not found');
  const v = clean(CLAIM_SPEC, req.body, { partial: true });
  v.updated_at = nowTs();
  update('claims', id, v);
  audit(req, 'claim', id, 'update', c.number);
  res.json(get('SELECT * FROM claims WHERE id = ?', id));
});

export default r;
