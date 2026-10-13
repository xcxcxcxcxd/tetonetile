import { Router } from 'express';
import { all, get, insert, update, run } from '../db.js';
import { requireRole, can } from '../auth.js';
import { clean } from '../lib/validate.js';
import { bad, idParam, notFound, conflict } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { swatchSvg } from '../lib/swatch.js';
import { getSettings } from '../lib/settings.js';
import { PRODUCT_COLS, PRODUCT_FROM, productRow, withImage } from '../services/catalog.js';
import { priceFor } from '../services/pricing.js';
import { listUnits, stockByProduct } from '../services/stock.js';
import { crud } from '../lib/crud.js';
import { round2 } from '../../shared/calc.js';

const r = Router();
// Public endpoints (no sign-in): product pictures are used on printed documents and public product pages.
export const publicCatalog = Router();

publicCatalog.get('/products/:id/swatch.svg', (req, res) => {
  const p = productRow(idParam(req));
  if (!p) throw notFound('Product not found');
  res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'public, max-age=86400');
  res.send(
    swatchSvg({
      hex: p.hex || '#b9b2a6',
      shape: p.shape || 'square',
      finish: p.finish,
      painted: !!p.painted,
      tileCm: p.width_cm,
      seed: p.sku,
      size: Number(req.query.size) > 0 && Number(req.query.size) <= 1200 ? Number(req.query.size) : 240,
    }),
  );
});

publicCatalog.get('/products/:id/image', (req, res) => {
  const p = productRow(idParam(req));
  if (!p) throw notFound('Product not found');
  res.set('Cache-Control', 'no-cache');
  res.redirect(302, p.image_file ? `/files/${p.image_file}` : `/api/products/${p.id}/swatch.svg`);
});

const PRODUCT_SPEC = {
  sku: { type: 'text', required: true, upper: true, max: 40 },
  kind: { type: 'enum', values: ['tile', 'custom', 'sample', 'service'], default: 'tile' },
  format_id: { type: 'fk' },
  colour_id: { type: 'fk' },
  name: { type: 'text', required: true, max: 200 },
  description: { type: 'text' },
  unit: { type: 'enum', values: ['m2', 'pc', 'lm', 'box', 'unit'], default: 'm2' },
  cost: { type: 'num', min: 0, default: 0 },
  reserve_target_boxes: { type: 'int', min: 0, default: 0 },
  hs_code: { type: 'text' },
  active: { type: 'bool', default: 1 },
};

function stripCost(req, p) {
  if (!can(req.user, 'sales')) delete p.cost;
  return p;
}

r.get('/products', (req, res) => {
  const where = [];
  const params = [];
  const q = String(req.query.q || '').trim();
  if (q) {
    where.push('(p.sku LIKE ? OR p.name LIKE ? OR c.name LIKE ? OR f.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  for (const [k, col] of [['format_id', 'p.format_id'], ['colour_id', 'p.colour_id'], ['kind', 'p.kind'], ['family', 'f.family'], ['finish', 'c.finish']]) {
    if (req.query[k]) {
      where.push(`${col} = ?`);
      params.push(req.query[k]);
    }
  }
  if (req.query.active !== 'all') where.push('p.active = 1');
  const rows = all(
    `SELECT ${PRODUCT_COLS} FROM ${PRODUCT_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY f.sort, c.sort, p.sku LIMIT 2000`,
    ...params,
  ).map(withImage);
  const stock = new Map(stockByProduct().map((s) => [s.product_id, s]));
  res.json({
    rows: rows.map((p) => {
      const s = stock.get(p.id);
      return stripCost(req, { ...p, on_hand: s?.on_hand || 0, available: s?.available || 0, reserved: s?.reserved || 0, available_m2: s?.available_m2 || 0, export_reserve: s?.export_reserve || 0 });
    }),
  });
});

r.get('/products/:id', (req, res) => {
  const p = productRow(idParam(req));
  if (!p) throw notFound('Product not found');
  const s = getSettings();
  const tiers = all('SELECT * FROM price_tiers ORDER BY sort');
  const currencies = [...new Set(['EUR', 'USD', s.base_currency])];
  const prices = can(req.user, 'sales')
    ? tiers.map((t) => ({ tier: t.name, tier_id: t.id, ...Object.fromEntries(currencies.map((c) => [c, priceFor({ productId: p.id, tierId: t.id, currency: c })])) }))
    : [];
  const units = listUnits(`u.product_id = ? AND u.status IN ('in_stock','reserved','picked','hold')`, [p.id], 'l.code, loc.code', 1000);
  const lots = {};
  for (const u of units) {
    const k = u.lot_code || 'no lot';
    lots[k] = lots[k] || { lot_code: k, lot_id: u.lot_id, boxes: 0, available: 0, reserved: 0, locations: new Set() };
    lots[k].boxes += u.boxes;
    if (u.status === 'in_stock' && u.grade === 'A') lots[k].available += u.boxes;
    if (['reserved', 'picked'].includes(u.status)) lots[k].reserved += u.boxes;
    if (u.location_label) lots[k].locations.add(u.location_label);
  }
  res.json({
    product: stripCost(req, p),
    images: all("SELECT * FROM attachments WHERE entity = 'product' AND entity_id = ? ORDER BY id", p.id),
    prices,
    currencies,
    price_list: can(req.user, 'sales')
      ? all(
          `SELECT pl.*, t.name AS tier_name, c.company AS client_name FROM price_list pl LEFT JOIN price_tiers t ON t.id = pl.tier_id
           LEFT JOIN clients c ON c.id = pl.client_id WHERE pl.product_id = ? ORDER BY pl.client_id IS NULL DESC, t.sort, c.company`,
          p.id,
        )
      : [],
    units,
    lots: Object.values(lots).map((l) => ({ ...l, locations: [...l.locations], m2: p.m2_per_box ? round2(l.boxes * p.m2_per_box) : null })),
    open_mos: all(
      `SELECT mo.id, mo.number, mo.status, mo.boxes_required, mo.due_date, st.name AS stage_name FROM manufacturing_orders mo
       LEFT JOIN stages st ON st.id = mo.current_stage_id WHERE mo.product_id = ? AND mo.status IN ('planned','released','in_progress','hold') ORDER BY mo.id`,
      p.id,
    ),
    recent_lines: can(req.user, 'sales')
      ? all(
          `SELECT d.id AS doc_id, d.type, d.number, d.issue_date, d.currency, c.company AS client_name, dl.qty, dl.unit, dl.unit_price
           FROM doc_lines dl JOIN sales_docs d ON d.id = dl.doc_id JOIN clients c ON c.id = d.client_id
           WHERE dl.product_id = ? ORDER BY d.issue_date DESC, d.id DESC LIMIT 15`,
          p.id,
        )
      : [],
  });
});

r.post('/products', requireRole(), (req, res) => {
  const v = clean(PRODUCT_SPEC, req.body);
  if (get('SELECT 1 FROM products WHERE sku = ? COLLATE NOCASE', v.sku)) throw conflict(`SKU ${v.sku} already exists.`);
  if (v.kind === 'tile' && (!v.format_id || !v.colour_id)) throw bad('A tile needs a format and a colour.');
  const id = insert('products', v);
  audit(req, 'product', id, 'create', v.sku);
  res.status(201).json(productRow(id));
});

r.put('/products/:id', requireRole(), (req, res) => {
  const id = idParam(req);
  const p = get('SELECT * FROM products WHERE id = ?', id);
  if (!p) throw notFound('Product not found');
  const v = clean(PRODUCT_SPEC, req.body, { partial: true });
  if (v.sku && get('SELECT 1 FROM products WHERE sku = ? COLLATE NOCASE AND id != ?', v.sku, id)) throw conflict(`SKU ${v.sku} already exists.`);
  if (req.body.image_id !== undefined) {
    const imgId = req.body.image_id ? Number(req.body.image_id) : null;
    if (imgId && !get("SELECT 1 FROM attachments WHERE id = ? AND entity = 'product' AND entity_id = ?", imgId, id)) throw bad('Image not found for this product');
    v.image_id = imgId;
  }
  update('products', id, v);
  audit(req, 'product', id, 'update', p.sku);
  res.json(productRow(id));
});

r.delete('/products/:id', requireRole(), (req, res) => {
  const id = idParam(req);
  const p = get('SELECT * FROM products WHERE id = ?', id);
  if (!p) throw notFound('Product not found');
  const used = get('SELECT 1 FROM doc_lines WHERE product_id = ? UNION SELECT 1 FROM stock_units WHERE product_id = ? UNION SELECT 1 FROM manufacturing_orders WHERE product_id = ? LIMIT 1', id, id, id);
  if (used) throw conflict(`${p.sku} is used in documents, stock or production. Deactivate it instead.`);
  run('DELETE FROM price_list WHERE product_id = ?', id);
  run('DELETE FROM products WHERE id = ?', id);
  audit(req, 'product', id, 'delete', p.sku);
  res.json({ ok: true });
});

// ---- pricing ----
r.get('/pricing', (req, res) => {
  const productId = Number(req.query.product_id);
  if (!productId) throw bad('product_id is required');
  res.json(priceFor({ productId, clientId: Number(req.query.client_id) || null, tierId: Number(req.query.tier_id) || null, currency: req.query.currency || 'EUR' }));
});

r.post('/pricing/batch', (req, res) => {
  const { product_ids = [], client_id, tier_id, currency = 'EUR' } = req.body || {};
  const out = {};
  for (const id of product_ids.slice(0, 500)) out[id] = priceFor({ productId: Number(id), clientId: client_id || null, tierId: tier_id || null, currency });
  res.json(out);
});

r.use(
  '/price-list',
  crud({
    table: 'price_list',
    entity: 'price',
    write: ['sales'],
    spec: {
      product_id: { type: 'fk', required: true }, tier_id: { type: 'fk' }, client_id: { type: 'fk' },
      currency: { type: 'text', required: true, upper: true, max: 3 }, price: { type: 'num', required: true, min: 0 },
      valid_until: { type: 'date' }, notes: { type: 'text' },
    },
    filters: ['product_id', 'client_id', 'tier_id'],
    select: 'price_list.*, p.sku, p.name AS product_name, t.name AS tier_name, c.company AS client_name',
    from: 'price_list JOIN products p ON p.id = price_list.product_id LEFT JOIN price_tiers t ON t.id = price_list.tier_id LEFT JOIN clients c ON c.id = price_list.client_id',
    defaultSort: 'p.sku',
    beforeSave: (v, req, existing) => {
      const merged = { ...(existing || {}), ...v };
      if (!merged.tier_id && !merged.client_id) throw bad('Choose a client (contract price) or a tier (list price).');
    },
    label: (x) => `${x.currency} ${x.price}`,
  }),
);

export default r;
