import { Router } from 'express';
import { all, get, insert, update, run, nowTs, today } from '../db.js';
import { requireRole } from '../auth.js';
import { clean } from '../lib/validate.js';
import { bad, idParam, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { nextNumber } from '../lib/numbering.js';
import {
  MO_SELECT, MO_FROM, moRow, createMo, moProgress, releaseMo, materialCheck, logStage, board, lotTrace, releaseLot, holdLot,
  kilnLoadDetail, readyForKiln, addToKiln, setKilnStatus, unloadKiln, requirements, labourReport,
} from '../services/production.js';
import { listUnits } from '../services/stock.js';
import { syncOrderStatus } from '../services/docs.js';

const r = Router();
const PROD = requireRole('production');

r.get('/mos', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status === 'open') where.push("mo.status IN ('planned','released','in_progress','hold')");
  else if (req.query.status) {
    where.push('mo.status = ?');
    params.push(req.query.status);
  }
  for (const k of ['product_id', 'order_id', 'purpose']) {
    if (req.query[k]) {
      where.push(`mo.${k} = ?`);
      params.push(req.query[k]);
    }
  }
  if (req.query.q) {
    where.push('(mo.number LIKE ? OR p.sku LIKE ? OR l.code LIKE ? OR d.number LIKE ? OR cl.company LIKE ?)');
    for (let i = 0; i < 5; i++) params.push(`%${req.query.q}%`);
  }
  const t = today();
  res.json({
    rows: all(`SELECT ${MO_SELECT} FROM ${MO_FROM} WHERE ${where.join(' AND ')} ORDER BY mo.id DESC LIMIT 500`, ...params).map((m) => ({
      ...m,
      late: !!m.due_date && m.due_date < t && !['completed', 'closed', 'cancelled'].includes(m.status),
      image_url: `/api/products/${m.product_id}/image`,
    })),
  });
});

r.get('/mos/board', (req, res) => res.json(board()));

r.get('/mos/:id', (req, res) => {
  const mo = moRow(idParam(req));
  if (!mo) throw notFound('MO not found');
  res.json({
    mo,
    progress: moProgress(mo),
    materials: materialCheck(mo),
    qc: all('SELECT q.*, u.name AS user_name FROM qc_inspections q LEFT JOIN users u ON u.id = q.user_id WHERE q.mo_id = ? ORDER BY q.at', mo.id),
    kiln_loads: all(
      `SELECT i.*, kl.number, kl.status, kl.fire_start, kl.fire_end, k.name AS kiln_name FROM kiln_load_items i
       JOIN kiln_loads kl ON kl.id = i.kiln_load_id JOIN kilns k ON k.id = kl.kiln_id WHERE i.mo_id = ? ORDER BY kl.id`,
      mo.id,
    ),
    units: listUnits('u.mo_id = ?', [mo.id], 'u.code', 1000),
    workers: all('SELECT id, name, team FROM workers WHERE active = 1 ORDER BY name'),
  });
});

r.post('/mos', PROD, (req, res) => {
  const v = clean(
    {
      product_id: { type: 'fk', required: true }, boxes_required: { type: 'int', min: 1 }, qty_m2: { type: 'num', min: 0 },
      purpose: { type: 'enum', values: ['order', 'stock', 'export_reserve', 'samples', 'rework'], default: 'stock' },
      order_id: { type: 'fk' }, order_line_id: { type: 'fk' }, workshop: { type: 'text', upper: true }, priority: { type: 'int', min: 1, max: 3, default: 2 },
      planned_start: { type: 'date' }, due_date: { type: 'date' }, loss_pct: { type: 'num', min: 0, max: 100 }, notes: { type: 'text' },
    },
    req.body,
  );
  const id = createMo(req, v);
  if (req.body.release) releaseMo(req, id);
  audit(req, 'mo', id, 'create', null);
  res.status(201).json(moRow(id));
});

r.put('/mos/:id', PROD, (req, res) => {
  const id = idParam(req);
  const mo = get('SELECT * FROM manufacturing_orders WHERE id = ?', id);
  if (!mo) throw notFound('MO not found');
  const v = clean(
    { priority: { type: 'int', min: 1, max: 3 }, planned_start: { type: 'date' }, due_date: { type: 'date' }, notes: { type: 'text' }, workshop: { type: 'text', upper: true } },
    req.body,
    { partial: true },
  );
  update('manufacturing_orders', id, { ...v, updated_at: nowTs() });
  res.json(moRow(id));
});

r.post('/mos/:id/release', PROD, (req, res) => {
  const id = idParam(req);
  const materials = releaseMo(req, id);
  audit(req, 'mo', id, 'release', null);
  res.json({ mo: moRow(id), materials });
});

r.post('/mos/:id/log', requireRole('production'), (req, res) => {
  const id = idParam(req);
  const result = logStage(req, id, req.body || {});
  audit(req, 'mo', id, 'log', `stage ${req.body.stage_id}: +${req.body.qty_good ?? ''}`);
  res.json({ ...result, mo: moRow(id), progress: moProgress(moRow(id)) });
});

r.post('/mos/:id/status', PROD, (req, res) => {
  const id = idParam(req);
  const mo = get('SELECT * FROM manufacturing_orders WHERE id = ?', id);
  if (!mo) throw notFound('MO not found');
  const to = String(req.body.status || '');
  const allowed = {
    hold: ['released', 'in_progress'],
    in_progress: ['hold'],
    cancelled: ['planned', 'released', 'hold', 'in_progress'],
    closed: ['completed'],
  };
  if (!allowed[to]?.includes(mo.status)) throw bad(`Cannot change ${mo.status.replace('_', ' ')} to ${to.replace('_', ' ')}.`);
  update('manufacturing_orders', id, { status: to, updated_at: nowTs(), notes: req.body.reason ? `${mo.notes ? `${mo.notes}\n` : ''}${to}: ${req.body.reason}` : mo.notes });
  if (mo.order_id) syncOrderStatus(mo.order_id);
  audit(req, 'mo', id, 'status', to);
  res.json(moRow(id));
});

// ---- lots ----
r.get('/lots/:id', (req, res) => res.json(lotTrace(idParam(req))));
r.post('/lots/:id/release', PROD, (req, res) => {
  releaseLot(req, idParam(req), req.body.notes);
  audit(req, 'lot', idParam(req), 'release', req.body.notes);
  res.json(lotTrace(idParam(req)));
});
r.post('/lots/:id/hold', PROD, (req, res) => {
  holdLot(req, idParam(req), req.body.notes);
  audit(req, 'lot', idParam(req), 'hold', req.body.notes);
  res.json(lotTrace(idParam(req)));
});
r.get('/lots', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status) {
    where.push('l.status = ?');
    params.push(req.query.status);
  }
  if (req.query.q) {
    where.push('(l.code LIKE ? OR p.sku LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  res.json({
    rows: all(
      `SELECT l.*, p.sku, p.name AS product_name, c.hex, mo.number AS mo_number,
         (SELECT COALESCE(SUM(u.boxes), 0) FROM stock_units u WHERE u.lot_id = l.id AND u.status IN ('in_stock','reserved','picked','hold')) AS boxes_on_hand
       FROM lots l JOIN products p ON p.id = l.product_id LEFT JOIN colours c ON c.id = p.colour_id LEFT JOIN manufacturing_orders mo ON mo.id = l.mo_id
       WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT 500`,
      ...params,
    ),
  });
});

// ---- QC list ----
r.get('/qc', (req, res) => {
  res.json({
    rows: all(
      `SELECT q.*, mo.number AS mo_number, l.code AS lot_code, p.sku, c.hex FROM qc_inspections q
       LEFT JOIN manufacturing_orders mo ON mo.id = q.mo_id LEFT JOIN lots l ON l.id = q.lot_id
       LEFT JOIN products p ON p.id = mo.product_id LEFT JOIN colours c ON c.id = p.colour_id ORDER BY q.at DESC LIMIT 300`,
    ),
    holds: all(
      `SELECT l.*, p.sku, c.hex, (SELECT COALESCE(SUM(boxes), 0) FROM stock_units u WHERE u.lot_id = l.id AND u.status = 'hold') AS boxes
       FROM lots l JOIN products p ON p.id = l.product_id LEFT JOIN colours c ON c.id = p.colour_id WHERE l.status = 'hold' ORDER BY l.id DESC`,
    ),
  });
});

// ---- kilns ----
r.get('/kiln-overview', (req, res) => {
  const kilns = all('SELECT * FROM kilns WHERE active = 1 ORDER BY code');
  res.json({
    kilns: kilns.map((k) => {
      const current = get("SELECT id FROM kiln_loads WHERE kiln_id = ? AND status != 'unloaded' ORDER BY id DESC LIMIT 1", k.id);
      return {
        ...k,
        current: current ? kilnLoadDetail(current.id) : null,
        last: get("SELECT number, unloaded_at FROM kiln_loads WHERE kiln_id = ? AND status = 'unloaded' ORDER BY id DESC LIMIT 1", k.id) || null,
        loads_30d: get("SELECT COUNT(*) AS n FROM kiln_loads WHERE kiln_id = ? AND created_at >= datetime('now','-30 days')", k.id).n,
      };
    }),
    ready: readyForKiln(),
    recent: all(
      `SELECT kl.*, k.name AS kiln_name,
         (SELECT COALESCE(SUM(pcs_loaded),0) FROM kiln_load_items i WHERE i.kiln_load_id = kl.id) AS pcs,
         (SELECT COALESCE(SUM(pcs_defect),0) FROM kiln_load_items i WHERE i.kiln_load_id = kl.id) AS defects
       FROM kiln_loads kl JOIN kilns k ON k.id = kl.kiln_id ORDER BY kl.id DESC LIMIT 30`,
    ),
  });
});

r.get('/kiln-loads/:id', (req, res) => res.json({ load: kilnLoadDetail(idParam(req)), ready: readyForKiln() }));

r.post('/kiln-loads', PROD, (req, res) => {
  const kiln = get('SELECT * FROM kilns WHERE id = ?', Number(req.body.kiln_id));
  if (!kiln) throw bad('Choose a kiln.');
  const open = get("SELECT number FROM kiln_loads WHERE kiln_id = ? AND status != 'unloaded'", kiln.id);
  if (open) throw bad(`${kiln.name} already has load ${open.number} in progress.`);
  const id = insert('kiln_loads', { number: nextNumber('kiln_load'), kiln_id: kiln.id, status: 'loading', loaded_at: nowTs(), operator: req.body.operator || req.user.name });
  audit(req, 'kiln_load', id, 'create', kiln.name);
  res.status(201).json({ load: kilnLoadDetail(id) });
});

r.post('/kiln-loads/:id/items', PROD, (req, res) => {
  const id = idParam(req);
  addToKiln(req, id, Number(req.body.mo_id), req.body.pcs, { force: !!req.body.force });
  res.json({ load: kilnLoadDetail(id), ready: readyForKiln() });
});

r.delete('/kiln-loads/:id/items/:itemId', PROD, (req, res) => {
  const id = idParam(req);
  const load = get('SELECT status FROM kiln_loads WHERE id = ?', id);
  if (load?.status !== 'loading') throw bad('Pieces can only be removed while loading.');
  run('DELETE FROM kiln_load_items WHERE id = ? AND kiln_load_id = ?', Number(req.params.itemId), id);
  res.json({ load: kilnLoadDetail(id), ready: readyForKiln() });
});

r.post('/kiln-loads/:id/status', PROD, (req, res) => {
  const id = idParam(req);
  setKilnStatus(req, id, String(req.body.status || ''), req.body);
  audit(req, 'kiln_load', id, 'status', req.body.status);
  res.json({ load: kilnLoadDetail(id) });
});

r.put('/kiln-loads/:id', PROD, (req, res) => {
  const id = idParam(req);
  if (!get('SELECT id FROM kiln_loads WHERE id = ?', id)) throw notFound('Kiln load not found');
  const v = clean({ notes: { type: 'text' }, operator: { type: 'text' }, fuel_kg: { type: 'num', min: 0 }, peak_temp_c: { type: 'num', min: 0, max: 1600 } }, req.body, { partial: true });
  update('kiln_loads', id, v);
  audit(req, 'kiln_load', id, 'update', Object.keys(v).join(', '));
  res.json({ load: kilnLoadDetail(id) });
});

r.post('/kiln-loads/:id/unload', PROD, (req, res) => {
  const id = idParam(req);
  unloadKiln(req, id, req.body.items || []);
  audit(req, 'kiln_load', id, 'unload', null);
  res.json({ load: kilnLoadDetail(id) });
});

// ---- planning helpers ----
r.get('/production/requirements', (req, res) => res.json({ rows: requirements() }));

r.get('/production/labour', (req, res) => {
  const to = req.query.to || today();
  const from = req.query.from || new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  res.json({ from, to, rows: labourReport(from, to) });
});

r.get('/production/reserve', (req, res) => {
  // Reserved export stock (fast-selling colours held for small buyers) against targets.
  res.json({
    rows: all(
      `SELECT p.id, p.sku, p.name, p.reserve_target_boxes, c.hex, c.fast_seller,
         (SELECT COALESCE(SUM(u.boxes), 0) FROM stock_units u WHERE u.product_id = p.id AND u.pool = 'export_reserve' AND u.status = 'in_stock') AS reserve_boxes,
         (SELECT COALESCE(SUM(mo.boxes_required), 0) FROM manufacturing_orders mo WHERE mo.product_id = p.id AND mo.purpose = 'export_reserve' AND mo.status IN ('planned','released','in_progress')) AS in_production
       FROM products p LEFT JOIN colours c ON c.id = p.colour_id
       WHERE p.active = 1 AND (p.reserve_target_boxes > 0 OR c.fast_seller = 1) ORDER BY p.sku`,
    ).map((x) => ({ ...x, gap: Math.max(0, x.reserve_target_boxes - x.reserve_boxes - x.in_production), image_url: `/api/products/${x.id}/image` })),
  });
});

export default r;
