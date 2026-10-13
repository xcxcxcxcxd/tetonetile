import { Router } from 'express';
import { all, get, run, tx } from '../db.js';
import { crud } from '../lib/crud.js';
import { requireRole } from '../auth.js';
import { bad, idParam, notFound } from '../lib/http.js';
import { getSettings, saveSettings, publicBase } from '../lib/settings.js';
import { audit } from '../lib/audit.js';
import { buildZoneLocations, createTileProducts } from '../seed.js';
import { occupancy } from '../services/stock.js';

const r = Router();

/** Everything the browser caches at start. */
r.get('/bootstrap', (req, res) => {
  const s = getSettings();
  const isCostRole = ['admin', 'sales'].includes(req.user.role);
  res.json({
    user: req.user,
    settings: { ...s, public_url_effective: publicBase(req) },
    entities: all('SELECT * FROM entities WHERE active = 1 ORDER BY is_default DESC, name'),
    formats: all('SELECT * FROM formats ORDER BY sort, code'),
    colours: all('SELECT * FROM colours ORDER BY sort, code'),
    tiers: all('SELECT * FROM price_tiers ORDER BY sort'),
    stages: all('SELECT * FROM stages ORDER BY sort'),
    kilns: all('SELECT * FROM kilns ORDER BY code'),
    warehouses: all('SELECT * FROM warehouses ORDER BY id'),
    zones: all('SELECT * FROM zones ORDER BY warehouse_id, sort'),
    workers: all('SELECT id, name, team, active FROM workers ORDER BY active DESC, name'),
    users: all('SELECT id, name, role FROM users WHERE active = 1 ORDER BY name'),
    can_see_cost: isCostRole,
    counts: {
      products: get('SELECT COUNT(*) AS n FROM products').n,
      clients: get('SELECT COUNT(*) AS n FROM clients').n,
      products_without_cost: get("SELECT COUNT(*) AS n FROM products WHERE kind = 'tile' AND active = 1 AND cost = 0").n,
    },
  });
});

r.get('/settings', (req, res) => res.json({ ...getSettings(), public_url_effective: publicBase(req) }));

r.put('/settings', requireRole(), (req, res) => {
  const allowed = ['base_currency', 'rates', 'rates_updated', 'public_url', 'defaults', 'logistics', 'production', 'terms'];
  const patch = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (patch.public_url) patch.public_url = String(patch.public_url).trim().replace(/\/+$/, '');
  if (patch.public_url && !/^https?:\/\/[^\s]+$/.test(patch.public_url)) throw bad('Public URL must start with http:// or https://');
  if (patch.rates) {
    for (const [k, v] of Object.entries(patch.rates)) if (!(Number(v) > 0)) throw bad(`Exchange rate for ${k} must be above 0`);
    patch.rates_updated = new Date().toISOString().slice(0, 10);
  }
  const s = saveSettings(patch);
  audit(req, 'settings', null, 'update', Object.keys(patch).join(', '));
  res.json(s);
});

// ---- issuing entities ----
r.use(
  '/entities',
  crud({
    table: 'entities',
    write: [],
    spec: {
      name: { type: 'text', required: true }, brand: { type: 'text' }, address: { type: 'text' }, city: { type: 'text' },
      country: { type: 'text' }, phone: { type: 'text' }, email: { type: 'text' }, website: { type: 'text' }, ice: { type: 'text' },
      if_number: { type: 'text' }, rc: { type: 'text' }, patente: { type: 'text' }, cnss: { type: 'text' }, vat_number: { type: 'text' },
      capital: { type: 'text' }, bank_name: { type: 'text' }, bank_account: { type: 'text' }, iban: { type: 'text' }, swift: { type: 'text' },
      footer_note: { type: 'text' }, is_default: { type: 'bool' }, active: { type: 'bool' },
    },
    defaultSort: 'entities.is_default DESC, entities.name',
    afterSave: (id) => {
      // only one default issuing entity
      if (get('SELECT is_default FROM entities WHERE id = ?', id)?.is_default) run('UPDATE entities SET is_default = 0 WHERE id != ?', id);
    },
  }),
);

// ---- catalogue reference ----
r.use(
  '/formats',
  crud({
    table: 'formats',
    write: [],
    spec: {
      code: { type: 'text', required: true, upper: true, max: 12 }, name: { type: 'text', required: true },
      family: { type: 'enum', values: ['zellige', 'cement', 'terracotta', 'other'], default: 'zellige' },
      shape: { type: 'enum', values: ['square', 'hexagon', 'rect', 'custom'], default: 'square' },
      width_cm: { type: 'num', min: 0 }, length_cm: { type: 'num', min: 0 }, thickness_cm: { type: 'num', min: 0 },
      pcs_per_m2: { type: 'num', min: 0 }, pcs_per_box: { type: 'int', min: 1 }, m2_per_box: { type: 'num', min: 0 },
      kg_per_box: { type: 'num', min: 0 }, boxes_per_pallet: { type: 'int', min: 1, default: 78 }, box_dims: { type: 'text' },
      sell_unit: { type: 'enum', values: ['m2', 'pc', 'lm', 'box'], default: 'm2' }, painted: { type: 'bool' },
      production_loss_pct: { type: 'num', min: 0, max: 100, default: 10 }, packing_confirmed: { type: 'bool', default: 1 },
      notes: { type: 'text' }, sort: { type: 'int' }, active: { type: 'bool', default: 1 },
    },
    search: ['formats.code', 'formats.name'],
    defaultSort: 'formats.sort, formats.code',
    label: (x) => x.code,
  }),
);

r.use(
  '/colours',
  crud({
    table: 'colours',
    write: [],
    spec: {
      code: { type: 'text', required: true, upper: true, max: 8 }, name: { type: 'text', required: true }, hex: { type: 'color', default: '#cccccc' },
      finish: { type: 'enum', values: ['glazed', 'natural'], default: 'glazed' }, glaze_family: { type: 'text' }, lead_free: { type: 'bool' },
      colour_group: { type: 'text', default: 'A' }, price_adjust_pct: { type: 'num', default: 0 }, fast_seller: { type: 'bool' },
      sds_available: { type: 'bool' }, notes: { type: 'text' }, sort: { type: 'int' }, active: { type: 'bool', default: 1 },
    },
    search: ['colours.code', 'colours.name'],
    defaultSort: 'colours.sort, colours.code',
    label: (x) => `${x.code} ${x.name}`,
  }),
);

r.post('/products/generate', requireRole(), (req, res) => {
  const created = tx(() => createTileProducts());
  audit(req, 'product', null, 'generate', `${created} products`);
  res.json({ created });
});

r.use(
  '/tiers',
  crud({
    table: 'price_tiers',
    entity: 'tier',
    write: [],
    spec: {
      code: { type: 'text', required: true, upper: true }, name: { type: 'text', required: true }, multiplier: { type: 'num', required: true, min: 0.01 },
      min_pallets: { type: 'num', min: 0 }, max_pallets: { type: 'num', min: 0 }, notes: { type: 'text' }, sort: { type: 'int' },
    },
    defaultSort: 'price_tiers.sort',
  }),
);

// ---- factory reference ----
r.use(
  '/stages',
  crud({
    table: 'stages',
    write: ['production'],
    spec: {
      code: { type: 'text', required: true, upper: true }, name: { type: 'text', required: true }, sort: { type: 'int', required: true },
      applies_to: { type: 'enum', values: ['all', 'zellige', 'glazed', 'natural', 'painted', 'cement'], default: 'all' },
      daily_capacity_m2: { type: 'num', min: 0 }, typical_days: { type: 'num', min: 0 }, is_kiln: { type: 'bool' }, is_qc: { type: 'bool' },
      is_packing: { type: 'bool' }, instructions: { type: 'text' }, color: { type: 'color' }, active: { type: 'bool', default: 1 },
    },
    defaultSort: 'stages.sort',
  }),
);

r.use(
  '/kilns',
  crud({
    table: 'kilns',
    write: ['production'],
    spec: {
      code: { type: 'text', required: true, upper: true }, name: { type: 'text', required: true }, workshop: { type: 'text' },
      capacity_m2: { type: 'num', min: 0 }, fuel: { type: 'text' }, notes: { type: 'text' }, active: { type: 'bool', default: 1 },
    },
    defaultSort: 'kilns.code',
  }),
);

r.use(
  '/workers',
  crud({
    table: 'workers',
    write: ['production'],
    spec: {
      name: { type: 'text', required: true }, team: { type: 'text' }, phone: { type: 'text' }, piece_rate: { type: 'num', min: 0 },
      active: { type: 'bool', default: 1 }, notes: { type: 'text' },
    },
    search: ['workers.name', 'workers.team'],
    filters: ['active', 'team'],
    defaultSort: 'workers.active DESC, workers.name',
  }),
);

// ---- warehouse structure ----
r.use(
  '/warehouses',
  crud({
    table: 'warehouses',
    write: ['warehouse'],
    spec: { code: { type: 'text', required: true, upper: true, max: 6 }, name: { type: 'text', required: true }, address: { type: 'text' }, notes: { type: 'text' }, active: { type: 'bool', default: 1 } },
    defaultSort: 'warehouses.id',
  }),
);

const ZONE_KINDS = ['rack', 'floor', 'shelf', 'raw', 'quarantine', 'dispatch', 'receiving', 'samples'];
r.use(
  '/zones',
  crud({
    table: 'zones',
    write: ['warehouse'],
    spec: {
      warehouse_id: { type: 'fk', required: true }, code: { type: 'text', required: true, upper: true, max: 4 }, name: { type: 'text', required: true },
      kind: { type: 'enum', values: ZONE_KINDS, default: 'rack' }, color: { type: 'color' }, sort: { type: 'int' }, notes: { type: 'text' },
    },
    filters: ['warehouse_id'],
    defaultSort: 'zones.warehouse_id, zones.sort',
    canDelete: (z) => (get('SELECT 1 FROM stock_units u JOIN locations l ON l.id = u.location_id WHERE l.zone_id = ? LIMIT 1', z.id) ? 'This zone still holds stock. Move it first.' : null),
  }),
);

/** Location-generation wizard: add a rack / shelf / lane block to a zone in one go. */
r.post('/zones/:id/generate', requireRole('warehouse'), (req, res) => {
  const zone = get('SELECT z.*, w.code AS wh FROM zones z JOIN warehouses w ON w.id = z.warehouse_id WHERE z.id = ?', idParam(req));
  if (!zone) throw notFound('Zone not found');
  const b = req.body || {};
  const n = (v, max) => {
    const x = Math.round(Number(v));
    if (!Number.isFinite(x) || x < 1 || x > max) throw bad(`Values must be between 1 and ${max}.`);
    return x;
  };
  const layout = { capacity: b.capacity === '' || b.capacity === null || b.capacity === undefined ? null : Number(b.capacity), startRack: n(b.startRack || 1, 99) };
  if (b.mode === 'rack') Object.assign(layout, { racks: n(b.racks, 40), levels: n(b.levels, 9), positions: n(b.positions, 26) });
  else if (b.mode === 'lane') Object.assign(layout, { lanes: n(b.lanes, 60), depth: n(b.depth, 20) });
  else Object.assign(layout, { count: n(b.count, 200) });
  const created = tx(() => buildZoneLocations(zone, zone.wh, layout));
  audit(req, 'zone', zone.id, 'generate', `${created} locations`);
  res.json({ created });
});

r.use(
  '/locations',
  crud({
    table: 'locations',
    write: ['warehouse'],
    spec: {
      zone_id: { type: 'fk', required: true }, code: { type: 'text', required: true, upper: true }, label: { type: 'text', required: true, upper: true },
      rack: { type: 'text' }, level: { type: 'int' }, position: { type: 'text', upper: true }, capacity: { type: 'int', min: 0 },
      capacity_unit: { type: 'enum', values: ['pallet', 'box', 'kg', 'any'], default: 'pallet' }, notes: { type: 'text' },
      blocked: { type: 'bool' }, active: { type: 'bool', default: 1 },
    },
    filters: ['zone_id'],
    search: ['locations.code', 'locations.label'],
    defaultSort: 'locations.code',
    label: (x) => x.code,
    canDelete: (l) => (occupancy(l.id)?.units ? `${l.label} still holds stock. Move it first.` : null),
  }),
);

export default r;
