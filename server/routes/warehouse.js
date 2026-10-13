import { Router } from 'express';
import { all, get, insert, update, run, tx, nowTs, today } from '../db.js';
import { requireRole } from '../auth.js';
import { clean } from '../lib/validate.js';
import { bad, idParam, notFound, conflict } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { crud } from '../lib/crud.js';
import { nextNumber } from '../lib/numbering.js';
import {
  PRESENT, listUnits, unitRow, unitByCode, findLocation, occupancy, createUnit, moveUnit, splitUnit, setUnitStatus, adjustUnit,
  putawaySuggestions, countLocation, stockByProduct, materialStock, consumeMaterial, logMove,
} from '../services/stock.js';
import { round2 } from '../../shared/calc.js';

const r = Router();
const WH = requireRole('warehouse', 'production');
const PRESENT_SQL = PRESENT.map((s) => `'${s}'`).join(',');

/** The visual map: every location of a warehouse with what is on it. */
r.get('/warehouse/map', (req, res) => {
  const wh = req.query.warehouse_id ? get('SELECT * FROM warehouses WHERE id = ?', Number(req.query.warehouse_id)) : get('SELECT * FROM warehouses WHERE active = 1 ORDER BY id LIMIT 1');
  if (!wh) throw notFound('Warehouse not found');
  const zones = all('SELECT * FROM zones WHERE warehouse_id = ? ORDER BY sort, code', wh.id);
  const locations = all(
    `SELECT loc.* FROM locations loc JOIN zones z ON z.id = loc.zone_id WHERE z.warehouse_id = ? AND loc.active = 1 ORDER BY loc.code`,
    wh.id,
  );
  const units = all(
    `SELECT u.id, u.code, u.kind, u.boxes, u.qty, u.status, u.grade, u.pool, u.location_id, p.sku, c.hex, c.code AS colour_code,
       l.code AS lot_code, m.code AS material_code, m.unit AS material_unit, f.boxes_per_pallet, d.number AS order_number
     FROM stock_units u JOIN locations loc ON loc.id = u.location_id JOIN zones z ON z.id = loc.zone_id
     LEFT JOIN products p ON p.id = u.product_id LEFT JOIN colours c ON c.id = p.colour_id LEFT JOIN formats f ON f.id = p.format_id
     LEFT JOIN lots l ON l.id = u.lot_id LEFT JOIN materials m ON m.id = u.material_id
     LEFT JOIN doc_lines dl ON dl.id = u.order_line_id LEFT JOIN sales_docs d ON d.id = dl.doc_id
     WHERE z.warehouse_id = ? AND u.status IN (${PRESENT_SQL}) AND u.parent_id IS NULL`,
    wh.id,
  );
  const byLoc = new Map();
  for (const u of units) {
    if (!byLoc.has(u.location_id)) byLoc.set(u.location_id, []);
    byLoc.get(u.location_id).push(u);
  }
  const cells = locations.map((loc) => {
    const here = byLoc.get(loc.id) || [];
    const boxes = here.reduce((s, u) => s + (u.boxes || 0), 0);
    const pallets = Math.ceil(here.reduce((s, u) => s + (u.kind === 'boxes' ? u.boxes / (u.boxes_per_pallet || 78) : u.kind === 'material' ? 0 : 1), 0) - 1e-9);
    const used = loc.capacity_unit === 'box' ? boxes : loc.capacity_unit === 'pallet' ? pallets : here.length;
    const cap = ['any', 'kg'].includes(loc.capacity_unit) ? null : loc.capacity;
    return {
      id: loc.id, code: loc.code, label: loc.label, zone_id: loc.zone_id, rack: loc.rack, level: loc.level, position: loc.position,
      capacity: cap, capacity_unit: loc.capacity_unit, blocked: loc.blocked, used, boxes,
      fill: cap ? Math.min(1, used / cap) : here.length ? 0.5 : 0,
      units: here.map((u) => ({ id: u.id, code: u.code, sku: u.sku || u.material_code, hex: u.hex, boxes: u.boxes, qty: u.qty, unit: u.material_unit, status: u.status, grade: u.grade, pool: u.pool, lot: u.lot_code, order: u.order_number })),
    };
  });
  const unlocated = get(`SELECT COUNT(*) AS n FROM stock_units WHERE location_id IS NULL AND status IN (${PRESENT_SQL}) AND parent_id IS NULL`).n;
  res.json({ warehouse: wh, warehouses: all('SELECT * FROM warehouses WHERE active = 1 ORDER BY id'), zones, cells, unlocated });
});

r.get('/locations/:id/detail', (req, res) => {
  const loc = findLocation(idParam(req));
  if (!loc) throw notFound('Location not found');
  res.json({
    location: loc,
    occupancy: occupancy(loc.id),
    units: listUnits(`u.location_id = ? AND u.status IN (${PRESENT_SQL})`, [loc.id], 'u.code'),
    moves: all(
      `SELECT sm.*, u.name AS user_name FROM stock_moves sm LEFT JOIN users u ON u.id = sm.user_id
       WHERE sm.from_location_id = ? OR sm.to_location_id = ? ORDER BY sm.id DESC LIMIT 40`,
      loc.id,
      loc.id,
    ),
  });
});

// ---- stock ----
r.get('/stock/summary', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.q) {
    where.push('(p.sku LIKE ? OR p.name LIKE ? OR c.name LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  if (req.query.format_id) {
    where.push('p.format_id = ?');
    params.push(req.query.format_id);
  }
  res.json({ rows: stockByProduct(where.join(' AND '), params) });
});

r.get('/stock/units', (req, res) => {
  const where = [];
  const params = [];
  const status = req.query.status || 'present';
  if (status === 'present') where.push(`u.status IN (${PRESENT_SQL})`);
  else if (status !== 'all') {
    where.push('u.status = ?');
    params.push(status);
  }
  for (const [k, col] of [['product_id', 'u.product_id'], ['lot_id', 'u.lot_id'], ['location_id', 'u.location_id'], ['kind', 'u.kind'], ['material_id', 'u.material_id'], ['pool', 'u.pool'], ['grade', 'u.grade']]) {
    if (req.query[k]) {
      where.push(`${col} = ?`);
      params.push(req.query[k]);
    }
  }
  if (req.query.unlocated === '1') where.push('u.location_id IS NULL AND u.parent_id IS NULL');
  if (req.query.zone_kind) {
    where.push('z.kind = ?');
    params.push(req.query.zone_kind);
  }
  if (req.query.q) {
    where.push('(u.code LIKE ? OR p.sku LIKE ? OR l.code LIKE ? OR loc.label LIKE ? OR m.code LIKE ? OR c.name LIKE ?)');
    for (let i = 0; i < 6; i++) params.push(`%${req.query.q}%`);
  }
  res.json({ rows: listUnits(where.length ? where.join(' AND ') : '1=1', params, 'u.updated_at DESC', Number(req.query.limit) || 1000) });
});

/** "Where is it?" - every location holding a product, lot, material or code. */
r.get('/stock/where', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ rows: [] });
  const rows = listUnits(
    `u.status IN (${PRESENT_SQL}) AND (p.sku LIKE ? OR l.code LIKE ? OR u.code LIKE ? OR m.code LIKE ? OR c.name LIKE ? OR c.code = ?)`,
    [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, q],
    'w.code, z.sort, loc.rack, loc.level, loc.position',
    500,
  );
  res.json({ rows });
});

r.get('/stock/units/:id', (req, res) => {
  const u = unitRow(idParam(req));
  if (!u) throw notFound('Stock unit not found');
  res.json({
    unit: u,
    occupancy: u.location_id ? occupancy(u.location_id) : null,
    children: listUnits('u.parent_id = ?', [u.id]),
    moves: all(
      `SELECT sm.*, u.name AS user_name, lf.label AS from_label, lt.label AS to_label FROM stock_moves sm
       LEFT JOIN users u ON u.id = sm.user_id LEFT JOIN locations lf ON lf.id = sm.from_location_id LEFT JOIN locations lt ON lt.id = sm.to_location_id
       WHERE sm.unit_id = ? ORDER BY sm.id DESC LIMIT 100`,
      u.id,
    ),
  });
});

const RECEIVE_SPEC = {
  kind: { type: 'enum', values: ['pallet', 'boxes', 'material'], default: 'pallet' },
  product_id: { type: 'fk' }, material_id: { type: 'fk' }, lot_code: { type: 'text', upper: true }, supplier_lot: { type: 'text' },
  grade: { type: 'enum', values: ['A', 'B', 'C'], default: 'A' }, boxes: { type: 'int', min: 0, default: 0 }, loose_pcs: { type: 'int', min: 0, default: 0 },
  qty: { type: 'num', min: 0, default: 0 }, location_id: { type: 'fk' }, location_code: { type: 'text' },
  pool: { type: 'enum', values: ['general', 'export_reserve', 'samples'], default: 'general' }, notes: { type: 'text' },
  copies: { type: 'int', min: 1, max: 100, default: 1 },
};

/** Manual receipt: opening stock, returns, bought-in goods, raw materials. */
r.post('/stock/units', WH, (req, res) => {
  const v = clean(RECEIVE_SPEC, req.body);
  if (v.kind === 'material' ? !v.material_id : !v.product_id) throw bad(v.kind === 'material' ? 'Choose a material.' : 'Choose a product.');
  if (v.kind === 'material' ? !(v.qty > 0) : !(v.boxes > 0 || v.loose_pcs > 0)) throw bad('Enter the quantity.');
  const loc = v.location_id || v.location_code ? findLocation(v.location_id || v.location_code) : null;
  if ((v.location_id || v.location_code) && !loc) throw notFound('Location not found');
  const ids = tx(() => {
    let lotId = null;
    if (v.lot_code && v.product_id) {
      const lot = get('SELECT * FROM lots WHERE code = ?', v.lot_code);
      if (lot && lot.product_id !== v.product_id) throw bad(`Lot ${v.lot_code} belongs to another product.`);
      lotId = lot ? lot.id : insert('lots', { code: v.lot_code, product_id: v.product_id, status: 'released', notes: 'Created at stock receipt' });
    }
    const out = [];
    for (let i = 0; i < v.copies; i++) {
      out.push(
        createUnit(
          req,
          {
            kind: v.kind, product_id: v.product_id, material_id: v.material_id, lot_id: lotId, supplier_lot: v.supplier_lot, grade: v.grade,
            boxes: v.boxes, loose_pcs: v.loose_pcs, qty: v.qty, location_id: loc?.id ?? null, pool: v.pool, notes: v.notes,
          },
          { ref: 'Manual receipt', notes: v.notes },
        ),
      );
    }
    return out;
  });
  audit(req, 'stock', ids[0], 'receive', `${ids.length} unit(s)`);
  res.status(201).json({ units: ids.map(unitRow) });
});

r.post('/stock/units/:id/move', WH, (req, res) => {
  const id = idParam(req);
  const result = moveUnit(req, id, req.body.location_id || req.body.location_code, { force: !!req.body.force, notes: req.body.notes || null });
  res.json({ ...result, unit: unitRow(id) });
});

r.post('/stock/units/:id/split', WH, (req, res) => {
  const id = idParam(req);
  const loc = req.body.location_id || req.body.location_code ? findLocation(req.body.location_id || req.body.location_code) : null;
  const newId = splitUnit(req, id, req.body.boxes, { locationId: loc ? loc.id : undefined, kind: req.body.kind || undefined });
  res.json({ unit: unitRow(id), created: unitRow(newId) });
});

r.post('/stock/units/:id/adjust', WH, (req, res) => {
  const id = idParam(req);
  if (!String(req.body.reason || '').trim()) throw bad('Give a reason for the adjustment (count, breakage, found...).');
  adjustUnit(req, id, req.body);
  audit(req, 'stock', id, 'adjust', req.body.reason);
  res.json({ unit: unitRow(id) });
});

r.post('/stock/units/:id/status', WH, (req, res) => {
  const id = idParam(req);
  const status = String(req.body.status || '');
  if (!['hold', 'in_stock', 'scrapped'].includes(status)) throw bad('Status must be hold, in_stock or scrapped.');
  const u = get('SELECT * FROM stock_units WHERE id = ?', id);
  if (!u) throw notFound();
  if (status === 'in_stock' && !['hold'].includes(u.status)) throw bad(`${u.code} is ${u.status}.`);
  setUnitStatus(req, id, status, { notes: req.body.notes || null });
  audit(req, 'stock', id, 'status', status);
  res.json({ unit: unitRow(id) });
});

r.post('/stock/units/:id/pool', requireRole('sales', 'warehouse'), (req, res) => {
  const id = idParam(req);
  const pool = String(req.body.pool || '');
  if (!['general', 'export_reserve', 'samples'].includes(pool)) throw bad('Unknown stock pool.');
  const u = get('SELECT * FROM stock_units WHERE id = ?', id);
  if (!u) throw notFound();
  if (u.status !== 'in_stock') throw bad('Only free stock can change pool.');
  update('stock_units', id, { pool, updated_at: nowTs() });
  logMove(req, { unit_id: id, unit_code: u.code, type: 'pool', notes: `${u.pool} → ${pool}` });
  res.json({ unit: unitRow(id) });
});

r.post('/stock/units/:id/pick', WH, (req, res) => {
  const id = idParam(req);
  const u = get('SELECT * FROM stock_units WHERE id = ?', id);
  if (!u) throw notFound();
  if (u.status !== 'reserved') throw bad(`${u.code} is ${u.status}; only reserved stock is picked.`);
  const loc = req.body.location_id || req.body.location_code ? findLocation(req.body.location_id || req.body.location_code) : null;
  tx(() => {
    if (loc && loc.id !== u.location_id) moveUnit(req, id, loc.id, { force: true, notes: 'Picked to dispatch' });
    update('stock_units', id, { status: 'picked', updated_at: nowTs() });
    logMove(req, { unit_id: id, unit_code: u.code, type: 'pick', from_location_id: u.location_id, to_location_id: loc?.id ?? u.location_id, boxes: u.boxes });
  });
  res.json({ unit: unitRow(id) });
});

r.get('/stock/units/:id/putaway', (req, res) => res.json({ suggestions: putawaySuggestions(idParam(req)) }));

/** Units waiting to be put away (in receiving / packing out, or with no location). */
r.get('/stock/putaway-queue', (req, res) => {
  res.json({
    rows: listUnits(
      `u.status IN (${PRESENT_SQL}) AND u.parent_id IS NULL AND (u.location_id IS NULL OR z.kind = 'receiving')`,
      [],
      'u.created_at',
    ),
  });
});

r.post('/stock/count', WH, (req, res) => {
  const result = countLocation(req, req.body.location_id || req.body.location_code, req.body.found || []);
  audit(req, 'stock', null, 'count', `${result.location}: ${result.confirmed} ok, ${result.moved.length} moved, ${result.adjusted.length} adjusted, ${result.missing.length} missing`);
  res.json(result);
});

r.get('/stock/moves', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.type) {
    where.push('sm.type = ?');
    params.push(req.query.type);
  }
  if (req.query.q) {
    where.push('(sm.unit_code LIKE ? OR sm.ref LIKE ? OR sm.notes LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  if (req.query.from) {
    where.push('date(sm.at) >= ?');
    params.push(req.query.from);
  }
  res.json({
    rows: all(
      `SELECT sm.*, u.name AS user_name, lf.label AS from_label, lt.label AS to_label, su.product_id, p.sku, c.hex, m.code AS material_code
       FROM stock_moves sm LEFT JOIN users u ON u.id = sm.user_id LEFT JOIN locations lf ON lf.id = sm.from_location_id
       LEFT JOIN locations lt ON lt.id = sm.to_location_id LEFT JOIN stock_units su ON su.id = sm.unit_id
       LEFT JOIN products p ON p.id = su.product_id LEFT JOIN colours c ON c.id = p.colour_id LEFT JOIN materials m ON m.id = su.material_id
       WHERE ${where.join(' AND ')} ORDER BY sm.id DESC LIMIT ${Math.min(Number(req.query.limit) || 300, 2000)}`,
      ...params,
    ),
  });
});

// ---- raw materials ----
const MATERIAL_SPEC = {
  code: { type: 'text', required: true, upper: true, max: 20 }, name: { type: 'text', required: true },
  category: { type: 'enum', values: ['clay', 'glaze', 'pigment', 'fuel', 'packaging', 'consumable', 'other'], default: 'other' },
  unit: { type: 'text', default: 'kg' }, min_stock: { type: 'num', min: 0, default: 0 }, reorder_qty: { type: 'num', min: 0 },
  supplier_id: { type: 'fk' }, unit_cost: { type: 'num', min: 0 }, colour_id: { type: 'fk' }, notes: { type: 'text' }, active: { type: 'bool', default: 1 },
};

r.get('/materials', (req, res) => {
  const rows = all(
    `SELECT m.*, s.name AS supplier_name, c.hex, c.name AS colour_name,
       (SELECT COALESCE(SUM(u.qty), 0) FROM stock_units u WHERE u.material_id = m.id AND u.status IN (${PRESENT_SQL})) AS stock,
       (SELECT COUNT(*) FROM stock_units u WHERE u.material_id = m.id AND u.status IN (${PRESENT_SQL})) AS units,
       (SELECT COALESCE(SUM(pl.qty - pl.qty_received), 0) FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
          WHERE pl.material_id = m.id AND po.status IN ('ordered','partial')) AS on_order
     FROM materials m LEFT JOIN suppliers s ON s.id = m.supplier_id LEFT JOIN colours c ON c.id = m.colour_id
     WHERE ${req.query.all === '1' ? '1=1' : 'm.active = 1'} ORDER BY m.category, m.code`,
  );
  res.json({ rows: rows.map((m) => ({ ...m, stock: round2(m.stock), low: m.min_stock > 0 && m.stock < m.min_stock })) });
});

r.get('/materials/:id', (req, res) => {
  const id = idParam(req);
  const m = get('SELECT m.*, s.name AS supplier_name FROM materials m LEFT JOIN suppliers s ON s.id = m.supplier_id WHERE m.id = ?', id);
  if (!m) throw notFound('Material not found');
  res.json({
    material: { ...m, stock: materialStock(id) },
    units: listUnits(`u.material_id = ? AND u.status IN (${PRESENT_SQL})`, [id], 'u.created_at'),
    moves: all('SELECT sm.*, u.name AS user_name FROM stock_moves sm JOIN stock_units su ON su.id = sm.unit_id LEFT JOIN users u ON u.id = sm.user_id WHERE su.material_id = ? ORDER BY sm.id DESC LIMIT 60', id),
  });
});

r.post('/materials', requireRole('production', 'warehouse'), (req, res) => {
  const v = clean(MATERIAL_SPEC, req.body);
  if (get('SELECT 1 FROM materials WHERE code = ?', v.code)) throw conflict(`Material ${v.code} exists.`);
  const id = insert('materials', v);
  audit(req, 'material', id, 'create', v.code);
  res.status(201).json(get('SELECT * FROM materials WHERE id = ?', id));
});

r.put('/materials/:id', requireRole('production', 'warehouse'), (req, res) => {
  const id = idParam(req);
  if (!get('SELECT 1 FROM materials WHERE id = ?', id)) throw notFound();
  const v = clean(MATERIAL_SPEC, req.body, { partial: true });
  update('materials', id, v);
  res.json(get('SELECT * FROM materials WHERE id = ?', id));
});

r.post('/materials/:id/receive', WH, (req, res) => {
  const id = idParam(req);
  const m = get('SELECT * FROM materials WHERE id = ?', id);
  if (!m) throw notFound('Material not found');
  const qty = Number(req.body.qty);
  if (!(qty > 0)) throw bad('Enter the quantity received.');
  const loc = findLocation(req.body.location_id || req.body.location_code);
  if (!loc) throw bad('Choose where it is stored.');
  const uid = createUnit(req, { kind: 'material', material_id: id, qty, supplier_lot: req.body.supplier_lot || null, location_id: loc.id, notes: req.body.notes || null }, { ref: req.body.ref || 'Receipt' });
  res.status(201).json({ unit: unitRow(uid) });
});

r.post('/materials/:id/consume', requireRole('production', 'warehouse'), (req, res) => {
  const id = idParam(req);
  const qty = Number(req.body.qty);
  if (!(qty > 0)) throw bad('Enter the quantity used.');
  const stock = materialStock(id);
  if (qty > stock + 1e-9) throw bad(`Only ${stock} in stock.`);
  const taken = consumeMaterial(req, id, qty, { ref: req.body.ref || null, notes: req.body.notes || null });
  res.json({ taken, stock: materialStock(id) });
});

r.use(
  '/suppliers',
  crud({
    table: 'suppliers',
    write: ['production', 'warehouse'],
    spec: {
      name: { type: 'text', required: true }, category: { type: 'text' }, contact_name: { type: 'text' }, phone: { type: 'text' },
      email: { type: 'email' }, address: { type: 'text' }, notes: { type: 'text' }, active: { type: 'bool', default: 1 },
    },
    search: ['suppliers.name', 'suppliers.category'],
    defaultSort: 'suppliers.name',
  }),
);

r.use(
  '/bom-rules',
  crud({
    table: 'bom_rules',
    entity: 'bom',
    write: ['production'],
    spec: {
      material_id: { type: 'fk' }, stage_id: { type: 'fk' }, format_id: { type: 'fk' },
      family: { type: 'enum', values: ['all', 'zellige', 'cement'], default: 'all' }, finish: { type: 'enum', values: ['all', 'glazed', 'natural'], default: 'all' },
      per: { type: 'enum', values: ['m2', 'piece', 'box'], default: 'm2' }, qty: { type: 'num', required: true, min: 0 },
      colour_specific: { type: 'bool' }, notes: { type: 'text' },
    },
    select: 'bom_rules.*, m.code AS material_code, m.name AS material_name, m.unit AS material_unit, s.name AS stage_name, f.code AS format_code',
    from: 'bom_rules LEFT JOIN materials m ON m.id = bom_rules.material_id LEFT JOIN stages s ON s.id = bom_rules.stage_id LEFT JOIN formats f ON f.id = bom_rules.format_id',
    defaultSort: 's.sort, m.code',
    beforeSave: (v, req, existing) => {
      const merged = { ...(existing || {}), ...v };
      if (!merged.material_id && !merged.colour_specific) throw bad('Choose a material, or tick "glaze of the product colour".');
    },
  }),
);

// ---- purchase orders ----
r.get('/purchase-orders', (req, res) => {
  res.json({
    rows: all(
      `SELECT po.*, s.name AS supplier_name, (SELECT COUNT(*) FROM po_lines pl WHERE pl.po_id = po.id) AS lines,
         (SELECT COALESCE(SUM(pl.qty * COALESCE(pl.unit_cost, 0)), 0) FROM po_lines pl WHERE pl.po_id = po.id) AS value
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id ORDER BY po.id DESC LIMIT 300`,
    ),
  });
});

r.get('/purchase-orders/:id', (req, res) => {
  const id = idParam(req);
  const po = get('SELECT po.*, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?', id);
  if (!po) throw notFound('Purchase order not found');
  res.json({ po, lines: all('SELECT pl.*, m.code, m.name, m.unit FROM po_lines pl JOIN materials m ON m.id = pl.material_id WHERE pl.po_id = ? ORDER BY pl.id', id) });
});

r.post('/purchase-orders', requireRole('production', 'warehouse'), (req, res) => {
  const supplier = get('SELECT * FROM suppliers WHERE id = ?', Number(req.body.supplier_id));
  if (!supplier) throw bad('Choose a supplier.');
  const lines = (req.body.lines || []).filter((l) => l.material_id && Number(l.qty) > 0);
  if (!lines.length) throw bad('Add at least one material line.');
  const id = tx(() => {
    const poId = insert('purchase_orders', {
      number: nextNumber('po'), supplier_id: supplier.id, status: req.body.status === 'ordered' ? 'ordered' : 'draft',
      order_date: req.body.order_date || today(), expected_date: req.body.expected_date || null, notes: req.body.notes || null,
    });
    for (const l of lines) insert('po_lines', { po_id: poId, material_id: Number(l.material_id), qty: Number(l.qty), unit_cost: l.unit_cost ? Number(l.unit_cost) : null });
    return poId;
  });
  audit(req, 'po', id, 'create', supplier.name);
  res.status(201).json({ id });
});

r.post('/purchase-orders/:id/status', requireRole('production', 'warehouse'), (req, res) => {
  const id = idParam(req);
  const status = String(req.body.status || '');
  if (!['draft', 'ordered', 'cancelled'].includes(status)) throw bad('Unknown status');
  update('purchase_orders', id, { status });
  res.json({ ok: true });
});

r.post('/purchase-orders/:id/receive', WH, (req, res) => {
  const id = idParam(req);
  const po = get('SELECT * FROM purchase_orders WHERE id = ?', id);
  if (!po) throw notFound('Purchase order not found');
  if (['cancelled', 'received'].includes(po.status)) throw bad(`This PO is ${po.status}.`);
  const created = tx(() => {
    const out = [];
    for (const it of req.body.lines || []) {
      const line = get('SELECT * FROM po_lines WHERE id = ? AND po_id = ?', Number(it.line_id), id);
      const qty = Number(it.qty);
      if (!line || !(qty > 0)) continue;
      const loc = findLocation(it.location_id || it.location_code);
      if (!loc) throw bad('Choose a location for every received line.');
      out.push(createUnit(req, { kind: 'material', material_id: line.material_id, qty, supplier_lot: it.supplier_lot || null, location_id: loc.id }, { ref: po.number }));
      update('po_lines', line.id, { qty_received: round2(line.qty_received + qty) });
    }
    const lines = all('SELECT * FROM po_lines WHERE po_id = ?', id);
    const full = lines.every((l) => l.qty_received >= l.qty - 1e-9);
    update('purchase_orders', id, { status: full ? 'received' : 'partial' });
    return out;
  });
  res.json({ units: created.map(unitRow) });
});

export default r;
