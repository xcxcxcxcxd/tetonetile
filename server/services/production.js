// Production cycle: manufacturing order (MO) -> lot -> stages -> kiln -> QC -> packing -> stock.
import { all, get, insert, update, tx, today, nowTs } from '../db.js';
import { targetPieces, packPieces, evaluateQc, round2 } from '../../shared/calc.js';
import { nextNumber } from '../lib/numbering.js';
import { bad, notFound, conflict, forbidden } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { productRow, routingFor } from './catalog.js';
import { createUnit, findLocation, reserveUnit, splitUnit, reservedBoxes, allocateLine, consumeMaterial, materialStock, logMove, setUnitStatus } from './stock.js';
import { syncOrderStatus } from './docs.js';

export const MO_SELECT = `mo.*, p.sku, p.name AS product_name, f.code AS format_code, f.name AS format_name, f.pcs_per_box,
  f.m2_per_box, f.pcs_per_m2, f.boxes_per_pallet, f.family, f.painted, c.code AS colour_code, c.name AS colour_name, c.hex,
  c.finish, l.code AS lot_code, l.status AS lot_status, d.number AS order_number, d.promised_date, cl.company AS client_name,
  st.name AS stage_name, st.code AS stage_code, st.color AS stage_color`;

export const MO_FROM = `manufacturing_orders mo
  JOIN products p ON p.id = mo.product_id
  LEFT JOIN formats f ON f.id = p.format_id
  LEFT JOIN colours c ON c.id = p.colour_id
  LEFT JOIN lots l ON l.id = mo.lot_id
  LEFT JOIN sales_docs d ON d.id = mo.order_id
  LEFT JOIN clients cl ON cl.id = d.client_id
  LEFT JOIN stages st ON st.id = mo.current_stage_id`;

const int = (v) => (v === null || v === undefined || v === '' ? 0 : Math.round(Number(v)) || 0);

export function moRow(id) {
  const mo = get(`SELECT ${MO_SELECT} FROM ${MO_FROM} WHERE mo.id = ?`, id);
  if (mo) mo.image_url = `/api/products/${mo.product_id}/image`;
  return mo;
}

export function createMo(req, data) {
  const p = productRow(data.product_id);
  if (!p) throw notFound('Product not found');
  if (!p.format_id || !p.pcs_per_box) throw bad('This product has no packing data (pieces per box), so it cannot be produced.');
  let boxes = data.boxes_required ? Math.ceil(Number(data.boxes_required)) : null;
  if (!boxes && data.qty_m2) boxes = Math.ceil(Number(data.qty_m2) / p.m2_per_box - 1e-9);
  if (!boxes || boxes <= 0) throw bad('Enter the quantity to produce, in boxes or m².');
  const loss = data.loss_pct !== undefined && data.loss_pct !== null && data.loss_pct !== '' ? Number(data.loss_pct) : p.production_loss_pct;
  const target = targetPieces(boxes, { pcs_per_box: p.pcs_per_box, production_loss_pct: loss });
  const workshop = data.workshop || getSettings().production.default_workshop;
  return tx(() => {
    const id = insert('manufacturing_orders', {
      number: nextNumber('mo'),
      product_id: p.id,
      order_id: data.order_id || null,
      order_line_id: data.order_line_id || null,
      purpose: data.purpose || (data.order_id ? 'order' : 'stock'),
      workshop,
      qty_m2: round2(boxes * p.m2_per_box),
      boxes_required: boxes,
      target_pcs: target,
      loss_pct: loss,
      status: 'planned',
      priority: data.priority || 2,
      planned_start: data.planned_start || null,
      due_date: data.due_date || null,
      notes: data.notes || null,
      created_by: req.user?.id ?? null,
    });
    const lotId = insert('lots', { code: nextNumber('lot'), product_id: p.id, mo_id: id, workshop });
    update('manufacturing_orders', id, { lot_id: lotId });
    return id;
  });
}

/** Stage-by-stage piece balance for an MO. */
export function moProgress(mo) {
  const product = productRow(mo.product_id);
  const routing = routingFor(product);
  const logs = all(
    `SELECT sl.*, st.code AS stage_code, st.name AS stage_name, w.name AS worker_name, kl.number AS kiln_load_number, u.name AS user_name
     FROM stage_logs sl JOIN stages st ON st.id = sl.stage_id LEFT JOIN workers w ON w.id = sl.worker_id
     LEFT JOIN kiln_loads kl ON kl.id = sl.kiln_load_id LEFT JOIN users u ON u.id = sl.user_id
     WHERE sl.mo_id = ? ORDER BY sl.id`,
    mo.id,
  );
  const inKiln = get(
    `SELECT COALESCE(SUM(i.pcs_loaded), 0) AS n FROM kiln_load_items i JOIN kiln_loads k ON k.id = i.kiln_load_id
     WHERE i.mo_id = ? AND k.status != 'unloaded'`,
    mo.id,
  ).n;
  let prevGood = mo.target_pcs;
  let prevDone = true;
  const stages = routing.map((st, idx) => {
    const sl = logs.filter((l) => l.stage_id === st.id);
    const good = sl.reduce((s, l) => s + l.qty_good, 0);
    const scrap = sl.reduce((s, l) => s + l.qty_scrap, 0);
    const input = idx === 0 ? mo.target_pcs : prevGood;
    const loaded = st.is_kiln ? inKiln : 0;
    const waiting = Math.max(0, input - good - scrap - loaded);
    const done = sl.some((l) => l.completes_stage);
    const status = done ? 'done' : sl.length || loaded || (idx > 0 && prevGood > 0) || (idx === 0 && prevDone) ? 'active' : 'pending';
    const row = {
      stage: { id: st.id, code: st.code, name: st.name, color: st.color, is_kiln: st.is_kiln, is_qc: st.is_qc, is_packing: st.is_packing, instructions: st.instructions, typical_days: st.typical_days },
      input,
      good,
      scrap,
      in_kiln: loaded,
      waiting,
      done,
      status,
      grade_a: sl.reduce((s, l) => s + (l.grade_a || 0), 0),
      grade_b: sl.reduce((s, l) => s + (l.grade_b || 0), 0),
      first_at: sl[0]?.created_at || null,
      last_at: sl[sl.length - 1]?.created_at || null,
    };
    prevGood = good;
    prevDone = done;
    return row;
  });
  const current = stages.find((s) => !s.done) || null;
  const totalScrap = stages.reduce((s, x) => s + x.scrap, 0);
  const last = stages[stages.length - 1];
  return {
    routing: stages,
    logs,
    current_stage_id: current?.stage.id ?? null,
    scrap: totalScrap,
    scrap_pct: mo.target_pcs ? round2((totalScrap / mo.target_pcs) * 100) : 0,
    packed_pcs: last && last.stage.is_packing ? last.good : 0,
    pct: stages.length ? Math.round((stages.filter((s) => s.done).length / stages.length) * 100) : 0,
  };
}

export function releaseMo(req, moId) {
  const mo = get('SELECT * FROM manufacturing_orders WHERE id = ?', moId);
  if (!mo) throw notFound('MO not found');
  if (mo.status !== 'planned') throw bad(`${mo.number} is already ${mo.status.replace('_', ' ')}.`);
  const prog = moProgress(mo);
  update('manufacturing_orders', moId, { status: 'released', released_at: nowTs(), current_stage_id: prog.current_stage_id, updated_at: nowTs() });
  return materialCheck(mo);
}

/** Material shortages for what this MO still has to do. */
export function materialCheck(mo) {
  const product = productRow(mo.product_id);
  const m2 = mo.qty_m2 || 0;
  return bomFor(product, { m2, boxes: mo.boxes_required || 0, pieces: mo.target_pcs })
    .map((b) => ({ ...b, stock: materialStock(b.material_id) }))
    .map((b) => ({ ...b, short: round2(Math.max(0, b.qty - b.stock)) }));
}

function nextStageAfter(prog, stageId) {
  const idx = prog.routing.findIndex((s) => s.stage.id === stageId);
  return prog.routing.slice(idx + 1).find((s) => !s.done)?.stage || null;
}

/**
 * Record work at a stage.
 * data: { stage_id, qty_good, qty_scrap, scrap_reason, worker_id, operator, completes_stage, notes,
 *         grade_a, grade_b, rejects, qc: {...levels}  (sorting stage)
 *         pack_a, pack_b                               (packing stage) }
 */
export function logStage(req, moId, data, { kilnLoadId = null } = {}) {
  const mo = get('SELECT * FROM manufacturing_orders WHERE id = ?', moId);
  if (!mo) throw notFound('MO not found');
  if (['completed', 'closed', 'cancelled'].includes(mo.status)) throw bad(`${mo.number} is ${mo.status}.`);
  if (mo.status === 'hold') throw bad(`${mo.number} is on hold.`);
  if (mo.status === 'planned') throw bad(`Release ${mo.number} before recording work.`);
  const product = productRow(mo.product_id);
  const prog = moProgress(mo);
  const st = prog.routing.find((s) => s.stage.id === Number(data.stage_id));
  if (!st) throw bad('This stage is not in the route for this product.');
  if (st.done && !data.force) throw bad(`${st.stage.name} is already finished for ${mo.number}.`);

  let good = int(data.qty_good);
  let scrap = int(data.qty_scrap);
  let gradeA = null;
  let gradeB = null;
  if (st.stage.is_qc) {
    gradeA = int(data.grade_a);
    gradeB = int(data.grade_b);
    good = gradeA + gradeB;
    scrap = int(data.rejects ?? data.qty_scrap);
  }
  if (st.stage.is_packing) {
    const sort = prog.routing.find((s) => s.stage.is_qc);
    const availA = (sort ? sort.grade_a : st.input) - st.grade_a;
    const availB = (sort ? sort.grade_b : 0) - st.grade_b;
    gradeA = data.pack_a === undefined || data.pack_a === '' ? Math.max(0, availA) : int(data.pack_a);
    gradeB = data.pack_b === undefined || data.pack_b === '' ? Math.max(0, availB) : int(data.pack_b);
    if (gradeA > availA || gradeB > availB) throw bad(`Only ${Math.max(0, availA)} grade A and ${Math.max(0, availB)} grade B pieces are sorted and waiting to be packed.`);
    good = gradeA + gradeB;
  }
  if (good < 0 || scrap < 0) throw bad('Quantities cannot be negative.');
  if (good + scrap === 0 && !data.completes_stage) throw bad('Enter the pieces finished or scrapped.');
  const admin = req.user?.role === 'admin';
  if (good + scrap > st.waiting && !(data.force && admin)) {
    throw bad(`Only ${st.waiting} pieces are waiting at ${st.stage.name}${st.in_kiln ? ` (${st.in_kiln} are in the kiln)` : ''}.`);
  }
  // Closing a stage with pieces still waiting: record them as a shortfall, or refuse.
  let completes = !!data.completes_stage;
  const remaining = st.waiting - good - scrap;
  if (completes && (remaining > 0 || st.in_kiln > 0)) {
    if (st.in_kiln > 0 || data.complete_if_clear) completes = false;
    else if (data.close_remaining) {
      scrap += remaining;
      data.scrap_reason = data.scrap_reason || 'Shortfall when stage closed';
    } else {
      throw conflict(`${remaining} pieces are still waiting at ${st.stage.name}. Record them, or close the stage and count them as shortfall.`, { code: 'remaining', remaining });
    }
  }
  data.completes_stage = completes;

  let qcResult = null;
  const result = tx(() => {
    const logId = insert('stage_logs', {
      mo_id: mo.id,
      stage_id: st.stage.id,
      worker_id: data.worker_id || null,
      operator: data.operator || req.user?.name || null,
      finished_at: nowTs(),
      qty_in: st.waiting,
      qty_good: good,
      qty_scrap: scrap,
      grade_a: gradeA,
      grade_b: gradeB,
      scrap_reason: data.scrap_reason || null,
      kiln_load_id: kilnLoadId || data.kiln_load_id || null,
      completes_stage: data.completes_stage ? 1 : 0,
      notes: data.notes || null,
      user_id: req.user?.id ?? null,
    });
    const patch = { updated_at: nowTs() };
    if (mo.status === 'released') patch.status = 'in_progress';
    if (st.stage.is_qc) {
      patch.good_pcs = mo.good_pcs + gradeA;
      patch.grade_b_pcs = mo.grade_b_pcs + gradeB;
      if (data.qc) qcResult = recordQc(req, mo, product, { ...data.qc, grade_a: gradeA, grade_b: gradeB, rejects: scrap });
    }
    let created = [];
    if (st.stage.is_packing && good > 0) created = packToStock(req, mo, product, gradeA, gradeB);
    let next = null;
    let completed = false;
    if (data.completes_stage) {
      next = nextStageAfter(prog, st.stage.id);
      patch.current_stage_id = next?.id ?? null;
      if (!next) {
        patch.status = 'completed';
        patch.completed_at = nowTs();
        completed = true;
        const lot = get('SELECT * FROM lots WHERE id = ?', mo.lot_id);
        if (lot && lot.status === 'open') update('lots', lot.id, { status: 'released', produced_at: today() });
      }
    }
    update('manufacturing_orders', mo.id, patch);
    if (getSettings().production.auto_consume && good > 0) {
      const m2 = product.pcs_per_m2 ? good / product.pcs_per_m2 : 0;
      const boxes = product.pcs_per_box ? good / product.pcs_per_box : 0;
      for (const b of bomFor(product, { m2, boxes, pieces: good }, [st.stage.id])) {
        consumeMaterial(req, b.material_id, b.qty, { ref: mo.number, notes: st.stage.name });
      }
    }
    return { log_id: logId, next_stage: next, completed, units: created };
  });
  if (mo.order_id) syncOrderStatus(mo.order_id);
  return { ...result, qc: qcResult };
}

function recordQc(req, mo, product, q) {
  const levels = {
    colour_var: q.colour_var, texture_var: q.texture_var, size_var: q.size_var,
    pits_chips: q.pits_chips, crazing: q.crazing, iron_spots: q.iron_spots,
    matches_reference: q.matches_reference === undefined || q.matches_reference === null || q.matches_reference === '' ? null : Number(q.matches_reference),
  };
  const evaln = evaluateQc(levels, product.finish, product.hex);
  const result = q.result === 'fail' ? 'fail' : evaln.result;
  insert('qc_inspections', {
    mo_id: mo.id,
    lot_id: mo.lot_id,
    inspector: q.inspector || req.user?.name || null,
    sample_size: q.sample_size ? Number(q.sample_size) : null,
    ...Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, v === undefined || v === '' || v === null ? null : Number(v)])),
    grade_a: q.grade_a ?? null,
    grade_b: q.grade_b ?? null,
    rejects: q.rejects ?? null,
    result,
    notes: q.notes || null,
    user_id: req.user?.id ?? null,
  });
  if (result !== 'pass' && mo.lot_id) update('lots', mo.lot_id, { status: 'hold', notes: evaln.exceeded.map((e) => `${e.label} ${e.level} > ${e.allowed}`).join('; ') || 'QC hold' });
  return { result, exceeded: evaln.exceeded, allowed: evaln.allowed };
}

/** Turn packed pieces into labelled pallets / box groups at the packing-out location. */
export function packToStock(req, mo, product, gradeA, gradeB) {
  const s = getSettings();
  const lot = mo.lot_id ? get('SELECT * FROM lots WHERE id = ?', mo.lot_id) : null;
  const hold = lot?.status === 'hold';
  const wh = get('SELECT id FROM warehouses WHERE code = ?', mo.workshop) || get('SELECT id FROM warehouses ORDER BY id LIMIT 1');
  let loc = null;
  if (hold) loc = get(`SELECT loc.id FROM locations loc JOIN zones z ON z.id = loc.zone_id WHERE z.warehouse_id = ? AND z.kind = 'quarantine' AND loc.active = 1 ORDER BY loc.code LIMIT 1`, wh?.id);
  if (!loc) {
    const configured = findLocation(s.production.receiving_location_code);
    loc = configured && configured.warehouse_id === wh?.id ? configured : null;
  }
  if (!loc) loc = get(`SELECT loc.id FROM locations loc JOIN zones z ON z.id = loc.zone_id WHERE z.warehouse_id = ? AND z.kind = 'receiving' AND loc.active = 1 ORDER BY loc.code LIMIT 1`, wh?.id);
  const pool = { export_reserve: 'export_reserve', samples: 'samples' }[mo.purpose] || 'general';
  const created = [];
  for (const [grade, pcs] of [['A', gradeA], ['B', gradeB]]) {
    if (!pcs) continue;
    const pack = packPieces(pcs, product);
    if (!pack.pallets.length) {
      if (pack.loose) {
        const id = createUnit(req, { kind: 'boxes', product_id: product.id, lot_id: mo.lot_id, grade, boxes: 0, loose_pcs: pack.loose, location_id: loc?.id ?? null, status: hold ? 'hold' : 'in_stock', pool, mo_id: mo.id }, { ref: mo.number, notes: `Packed grade ${grade} (loose pieces)` });
        created.push({ id, grade, boxes: 0 });
      }
      continue;
    }
    pack.pallets.forEach((boxes, i) => {
      const last = i === pack.pallets.length - 1;
      const id = createUnit(
        req,
        {
          kind: boxes < 10 ? 'boxes' : 'pallet',
          product_id: product.id,
          lot_id: mo.lot_id,
          grade,
          boxes,
          loose_pcs: last ? pack.loose : 0,
          location_id: loc?.id ?? null,
          status: hold ? 'hold' : 'in_stock',
          pool,
          mo_id: mo.id,
        },
        { ref: mo.number, notes: `Packed grade ${grade}` },
      );
      created.push({ id, grade, boxes });
    });
  }
  if (!hold && mo.order_line_id) reserveProduced(req, mo, created.filter((c) => c.grade === 'A'));
  return created.map((c) => c.id);
}

/** Reserve freshly packed grade-A units for the order line the MO was made for. */
function reserveProduced(req, mo, units) {
  const line = get('SELECT dl.*, d.number FROM doc_lines dl JOIN sales_docs d ON d.id = dl.doc_id WHERE dl.id = ?', mo.order_line_id);
  if (!line || !line.boxes) return;
  let need = line.boxes - reservedBoxes(line.id);
  for (const c of [...units].sort((a, b) => b.boxes - a.boxes)) {
    if (need <= 0) break;
    const u = get('SELECT * FROM stock_units WHERE id = ?', c.id);
    if (!u || u.status !== 'in_stock' || !u.boxes) continue;
    if (u.boxes <= need) {
      reserveUnit(req, u.id, line.id, line.number);
      need -= u.boxes;
    } else {
      const nid = splitUnit(req, u.id, need, { status: 'reserved', orderLineId: line.id, ref: line.number });
      logMove(req, { unit_id: nid, type: 'reserve', boxes: need, ref: line.number });
      need = 0;
    }
  }
}

/** Release a lot from QC hold: units become available and order lines get reserved. */
export function releaseLot(req, lotId, notes) {
  const lot = get('SELECT * FROM lots WHERE id = ?', lotId);
  if (!lot) throw notFound('Lot not found');
  if (lot.status !== 'hold') throw bad(`${lot.code} is not on hold.`);
  tx(() => {
    update('lots', lot.id, { status: 'released', notes: notes ? `${lot.notes || ''} Released: ${notes}`.trim() : lot.notes });
    const units = all("SELECT * FROM stock_units WHERE lot_id = ? AND status = 'hold'", lot.id);
    for (const u of units) setUnitStatus(req, u.id, 'in_stock', { notes: 'Lot released from QC hold', ref: lot.code });
    const mo = lot.mo_id ? get('SELECT * FROM manufacturing_orders WHERE id = ?', lot.mo_id) : null;
    if (mo?.order_line_id) reserveProduced(req, mo, units.filter((u) => u.grade === 'A').map((u) => ({ id: u.id, grade: 'A', boxes: u.boxes })));
  });
  const mo = lot.mo_id ? get('SELECT order_id FROM manufacturing_orders WHERE id = ?', lot.mo_id) : null;
  if (mo?.order_id) syncOrderStatus(mo.order_id);
}

export function holdLot(req, lotId, notes) {
  const lot = get('SELECT * FROM lots WHERE id = ?', lotId);
  if (!lot) throw notFound('Lot not found');
  tx(() => {
    update('lots', lot.id, { status: 'hold', notes: notes || lot.notes });
    for (const u of all("SELECT id FROM stock_units WHERE lot_id = ? AND status = 'in_stock'", lot.id)) setUnitStatus(req, u.id, 'hold', { notes: notes || 'Lot put on hold', ref: lot.code });
  });
}

// ---------------------------------------------------------------------------
// Orders -> production. Batch continuity: a line is served from ONE lot in stock,
// or produced as ONE new lot.
// ---------------------------------------------------------------------------
export function releaseOrder(req, orderId, { force = false, allowMultiLot = false } = {}) {
  const order = get('SELECT * FROM sales_docs WHERE id = ?', orderId);
  if (!order || order.type !== 'order') throw notFound('Order not found');
  if (['cancelled', 'closed', 'shipped', 'delivered', 'draft'].includes(order.status)) throw bad(`Order ${order.number} is ${order.status}.`);
  const missing = [];
  if (!order.colour_approved_at) missing.push('written colour approval');
  if (!order.deposit_received_at) missing.push('the deposit');
  if (missing.length && !force) throw conflict(`Waiting for ${missing.join(' and ')}. Production starts only after both.`, { code: 'gates', missing });
  if (missing.length && force && req.user?.role !== 'admin') throw forbidden('Only an admin can start production before the colour approval and deposit.');
  const lines = all(
    `SELECT dl.*, p.kind, p.sku FROM doc_lines dl JOIN products p ON p.id = dl.product_id WHERE dl.doc_id = ? AND dl.boxes > 0 ORDER BY dl.position`,
    orderId,
  );
  const results = [];
  tx(() => {
    for (const line of lines) {
      const planned = get(
        "SELECT COALESCE(SUM(boxes_required), 0) AS n FROM manufacturing_orders WHERE order_line_id = ? AND status NOT IN ('cancelled')",
        line.id,
      ).n;
      const already = reservedBoxes(line.id);
      if (already + planned >= line.boxes) {
        results.push({ sku: line.sku, action: 'covered', boxes: line.boxes });
        continue;
      }
      if (!planned) {
        const alloc = allocateLine(req, line.id, { allowMultiLot });
        if (alloc.ok) {
          results.push({ sku: line.sku, action: 'reserved', boxes: alloc.reserved, lots: alloc.lots, warnings: alloc.warnings });
          continue;
        }
      }
      const need = line.boxes - reservedBoxes(line.id) - planned;
      if (need <= 0) continue;
      const due = order.promised_date ? addDaysSafe(order.promised_date, -7) : null;
      const moId = createMo(req, { product_id: line.product_id, order_id: order.id, order_line_id: line.id, purpose: 'order', boxes_required: need, due_date: due, priority: 2 });
      const mo = get('SELECT number FROM manufacturing_orders WHERE id = ?', moId);
      const warnings = reservedBoxes(line.id) > 0 ? ['Part of this line is already reserved from another lot - blend on site.'] : [];
      results.push({ sku: line.sku, action: 'produce', boxes: need, mo: mo.number, mo_id: moId, warnings });
    }
    const anyMo = results.some((r) => r.action === 'produce') || get("SELECT 1 FROM manufacturing_orders WHERE order_id = ? AND status NOT IN ('completed','closed','cancelled')", orderId);
    update('sales_docs', orderId, { status: anyMo ? 'in_production' : 'ready', updated_at: nowTs() });
  });
  return results;
}

function addDaysSafe(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Kilns
// ---------------------------------------------------------------------------
export function kilnLoadDetail(id) {
  const load = get('SELECT kl.*, k.code AS kiln_code, k.name AS kiln_name, k.capacity_m2 FROM kiln_loads kl JOIN kilns k ON k.id = kl.kiln_id WHERE kl.id = ?', id);
  if (!load) throw notFound('Kiln load not found');
  load.items = all(
    `SELECT i.*, mo.number AS mo_number, p.sku, p.name AS product_name, c.hex, c.code AS colour_code, f.pcs_per_m2, lt.code AS lot_code
     FROM kiln_load_items i JOIN manufacturing_orders mo ON mo.id = i.mo_id JOIN products p ON p.id = mo.product_id
     LEFT JOIN colours c ON c.id = p.colour_id LEFT JOIN formats f ON f.id = p.format_id LEFT JOIN lots lt ON lt.id = mo.lot_id
     WHERE i.kiln_load_id = ? ORDER BY i.id`,
    id,
  ).map((i) => ({ ...i, m2: i.pcs_per_m2 ? round2(i.pcs_loaded / i.pcs_per_m2) : null, image_url: null }));
  load.m2 = round2(load.items.reduce((s, i) => s + (i.m2 || 0), 0));
  return load;
}

function fireStage() {
  return get("SELECT * FROM stages WHERE is_kiln = 1 AND active = 1 ORDER BY sort LIMIT 1");
}

/** MOs with pieces waiting to be fired (for the "load kiln" picker). */
export function readyForKiln() {
  const fs = fireStage();
  if (!fs) return [];
  return all(`SELECT ${MO_SELECT} FROM ${MO_FROM} WHERE mo.status IN ('released','in_progress') ORDER BY mo.priority, mo.due_date`)
    .map((mo) => ({ mo, prog: moProgress(mo) }))
    .map(({ mo, prog }) => ({ mo, st: prog.routing.find((s) => s.stage.is_kiln) }))
    .filter(({ st }) => st && st.waiting > 0)
    .map(({ mo, st }) => ({ id: mo.id, number: mo.number, sku: mo.sku, product_name: mo.product_name, hex: mo.hex, lot_code: mo.lot_code, waiting: st.waiting, pcs_per_m2: mo.pcs_per_m2, image_url: `/api/products/${mo.product_id}/image` }));
}

export function addToKiln(req, loadId, moId, pcs) {
  const load = get('SELECT * FROM kiln_loads WHERE id = ?', loadId);
  if (!load) throw notFound('Kiln load not found');
  if (load.status !== 'loading') throw bad(`${load.number} is ${load.status}; pieces can only be added while loading.`);
  const mo = get('SELECT * FROM manufacturing_orders WHERE id = ?', moId);
  if (!mo) throw notFound('MO not found');
  if (!['released', 'in_progress'].includes(mo.status)) throw bad(`${mo.number} is ${mo.status}.`);
  const st = moProgress(mo).routing.find((s) => s.stage.is_kiln);
  if (!st) throw bad(`${mo.number} has no firing stage.`);
  pcs = int(pcs);
  if (pcs <= 0) throw bad('Enter the number of pieces loaded.');
  if (pcs > st.waiting) throw bad(`Only ${st.waiting} pieces of ${mo.number} are ready for firing.`);
  const existing = get('SELECT * FROM kiln_load_items WHERE kiln_load_id = ? AND mo_id = ?', loadId, moId);
  if (existing) update('kiln_load_items', existing.id, { pcs_loaded: existing.pcs_loaded + pcs });
  else insert('kiln_load_items', { kiln_load_id: loadId, mo_id: moId, pcs_loaded: pcs });
  if (mo.status === 'released') update('manufacturing_orders', mo.id, { status: 'in_progress', updated_at: nowTs() });
}

export function setKilnStatus(req, loadId, status, extra = {}) {
  const load = get('SELECT * FROM kiln_loads WHERE id = ?', loadId);
  if (!load) throw notFound('Kiln load not found');
  const order = ['loading', 'firing', 'cooling', 'unloaded'];
  if (order.indexOf(status) !== order.indexOf(load.status) + 1) throw bad(`${load.number} is ${load.status}; next step is ${order[order.indexOf(load.status) + 1] || 'none'}.`);
  if (status === 'firing' && !get('SELECT 1 FROM kiln_load_items WHERE kiln_load_id = ?', loadId)) throw bad('Load some pieces before firing.');
  const patch = { status };
  if (status === 'firing') patch.fire_start = nowTs();
  if (status === 'cooling') patch.fire_end = nowTs();
  for (const k of ['fuel_kg', 'peak_temp_c', 'notes', 'operator']) if (extra[k] !== undefined && extra[k] !== '') patch[k] = extra[k];
  update('kiln_loads', loadId, patch);
}

/** Unload: record good / defective pieces per MO; this writes the firing stage logs. */
export function unloadKiln(req, loadId, items) {
  const load = get('SELECT * FROM kiln_loads WHERE id = ?', loadId);
  if (!load) throw notFound('Kiln load not found');
  if (load.status !== 'cooling') throw bad(`${load.number} must be cooling before it is unloaded.`);
  const fs = fireStage();
  const rows = all('SELECT * FROM kiln_load_items WHERE kiln_load_id = ?', loadId);
  const byId = new Map((items || []).map((i) => [Number(i.item_id), i]));
  tx(() => {
    for (const it of rows) {
      const input = byId.get(it.id) || {};
      const good = input.pcs_good === undefined || input.pcs_good === '' ? it.pcs_loaded : int(input.pcs_good);
      const defect = input.pcs_defect === undefined || input.pcs_defect === '' ? Math.max(0, it.pcs_loaded - good) : int(input.pcs_defect);
      if (good + defect !== it.pcs_loaded) throw bad(`Good + defective must equal the ${it.pcs_loaded} pieces loaded.`);
      update('kiln_load_items', it.id, { pcs_good: good, pcs_defect: defect, defect_notes: input.defect_notes || null });
    }
    update('kiln_loads', loadId, { status: 'unloaded', unloaded_at: nowTs() });
    for (const it of all('SELECT * FROM kiln_load_items WHERE kiln_load_id = ?', loadId)) {
      const input = byId.get(it.id) || {};
      logStage(
        req,
        it.mo_id,
        {
          stage_id: fs.id,
          qty_good: it.pcs_good,
          qty_scrap: it.pcs_defect,
          scrap_reason: it.defect_notes,
          completes_stage: !!input.complete,
          complete_if_clear: true,
          operator: load.operator,
          notes: `Kiln load ${load.number}`,
        },
        { kilnLoadId: load.id },
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Materials: bill of materials and requirements
// ---------------------------------------------------------------------------
export function bomFor(product, { m2 = 0, boxes = 0, pieces = 0 }, stageIds = null) {
  const fam = product.family === 'cement' ? 'cement' : 'zellige';
  const rules = all('SELECT r.*, m.code, m.name, m.unit FROM bom_rules r LEFT JOIN materials m ON m.id = r.material_id').filter(
    (r) =>
      (r.family === 'all' || r.family === fam) &&
      (r.finish === 'all' || r.finish === product.finish) &&
      (!r.format_id || r.format_id === product.format_id) &&
      (!stageIds || stageIds.includes(r.stage_id)),
  );
  const best = new Map();
  for (const r of rules) {
    const k = `${r.colour_specific ? 'colour' : r.material_id}|${r.stage_id}`;
    const cur = best.get(k);
    if (!cur || (r.format_id && !cur.format_id)) best.set(k, r);
  }
  const out = [];
  for (const r of best.values()) {
    const mat = r.colour_specific
      ? get('SELECT id, code, name, unit FROM materials WHERE colour_id = ? AND active = 1 ORDER BY id LIMIT 1', product.colour_id)
      : r.material_id
        ? { id: r.material_id, code: r.code, name: r.name, unit: r.unit }
        : null;
    if (!mat) continue;
    const base = r.per === 'm2' ? m2 : r.per === 'box' ? boxes : pieces;
    const qty = round2(base * r.qty);
    if (qty > 0) out.push({ material_id: mat.id, code: mat.code, name: mat.name, unit: mat.unit, stage_id: r.stage_id, qty });
  }
  return out;
}

/** Raw material needed by all open MOs for the stages they have not finished, against stock. */
export function requirements() {
  const mos = all("SELECT * FROM manufacturing_orders WHERE status IN ('planned','released','in_progress','hold')");
  const need = new Map();
  for (const mo of mos) {
    const product = productRow(mo.product_id);
    const prog = moProgress(mo);
    const open = prog.routing.filter((s) => !s.done).map((s) => s.stage.id);
    if (!open.length) continue;
    for (const b of bomFor(product, { m2: mo.qty_m2 || 0, boxes: mo.boxes_required || 0, pieces: mo.target_pcs }, open)) {
      const cur = need.get(b.material_id) || { ...b, qty: 0, mos: [] };
      cur.qty = round2(cur.qty + b.qty);
      cur.mos.push(mo.number);
      need.set(b.material_id, cur);
    }
  }
  return [...need.values()]
    .map((n) => {
      const stock = materialStock(n.material_id);
      const m = get('SELECT min_stock, reorder_qty FROM materials WHERE id = ?', n.material_id);
      return { ...n, mos: [...new Set(n.mos)], stock, short: round2(Math.max(0, n.qty - stock)), min_stock: m?.min_stock || 0 };
    })
    .sort((a, b) => b.short - a.short || a.code.localeCompare(b.code));
}

// ---------------------------------------------------------------------------
// Production board and lot traceability
// ---------------------------------------------------------------------------
export function board() {
  const stages = all('SELECT id, code, name, color, sort, is_kiln, is_qc, is_packing FROM stages WHERE active = 1 ORDER BY sort');
  const mos = all(
    `SELECT ${MO_SELECT} FROM ${MO_FROM} WHERE mo.status IN ('planned','released','in_progress','hold')
     ORDER BY mo.priority, mo.due_date IS NULL, mo.due_date, mo.id`,
  );
  const t = today();
  const cards = mos.map((mo) => {
    const prog = moProgress(mo);
    const cur = prog.routing.find((s) => s.stage.id === prog.current_stage_id);
    return {
      id: mo.id,
      number: mo.number,
      status: mo.status,
      priority: mo.priority,
      purpose: mo.purpose,
      sku: mo.sku,
      product_name: mo.product_name,
      colour_name: mo.colour_name,
      hex: mo.hex,
      lot_code: mo.lot_code,
      lot_status: mo.lot_status,
      order_number: mo.order_number,
      client_name: mo.client_name,
      due_date: mo.due_date,
      late: !!mo.due_date && mo.due_date < t,
      target_pcs: mo.target_pcs,
      boxes_required: mo.boxes_required,
      qty_m2: mo.qty_m2,
      column: mo.status === 'planned' ? 'planned' : prog.current_stage_id ? String(prog.current_stage_id) : 'done',
      stage_name: cur?.stage.name || null,
      waiting: cur?.waiting ?? 0,
      in_kiln: cur?.in_kiln ?? 0,
      done_pct: prog.pct,
      scrap_pct: prog.scrap_pct,
      image_url: `/api/products/${mo.product_id}/image`,
      flow: prog.routing.map((s) => ({ id: s.stage.id, code: s.stage.code, done: s.done, waiting: s.waiting, good: s.good })),
    };
  });
  return { stages, cards };
}

export function lotTrace(lotId) {
  const lot = get(
    `SELECT l.*, p.sku, p.name AS product_name, c.hex, c.code AS colour_code, c.name AS colour_name, c.finish, f.code AS format_code, f.m2_per_box
     FROM lots l JOIN products p ON p.id = l.product_id LEFT JOIN colours c ON c.id = p.colour_id LEFT JOIN formats f ON f.id = p.format_id WHERE l.id = ?`,
    lotId,
  );
  if (!lot) throw notFound('Lot not found');
  lot.image_url = `/api/products/${lot.product_id}/image`;
  const mo = lot.mo_id ? moRow(lot.mo_id) : null;
  const progress = mo ? moProgress(mo) : null;
  const kilnLoads = all(
    `SELECT DISTINCT kl.id, kl.number, kl.status, kl.fire_start, kl.fire_end, kl.fuel_kg, kl.peak_temp_c, k.name AS kiln_name, i.pcs_loaded, i.pcs_good, i.pcs_defect
     FROM kiln_load_items i JOIN kiln_loads kl ON kl.id = i.kiln_load_id JOIN kilns k ON k.id = kl.kiln_id WHERE i.mo_id = ?`,
    lot.mo_id || -1,
  );
  const qc = all('SELECT * FROM qc_inspections WHERE lot_id = ? ORDER BY at', lot.id);
  const units = all(
    `SELECT u.id, u.code, u.kind, u.grade, u.boxes, u.loose_pcs, u.status, u.pool, loc.label AS location_label, loc.code AS location_code,
       d.number AS order_number, d.id AS order_id, cl.company AS client_name, s.number AS shipment_number, s.id AS shipment_id
     FROM stock_units u LEFT JOIN locations loc ON loc.id = u.location_id LEFT JOIN doc_lines dl ON dl.id = u.order_line_id
     LEFT JOIN sales_docs d ON d.id = dl.doc_id LEFT JOIN clients cl ON cl.id = d.client_id LEFT JOIN shipments s ON s.id = u.shipment_id
     WHERE u.lot_id = ? ORDER BY u.code`,
    lot.id,
  );
  const claims = all('SELECT id, number, status, category, reported_at FROM claims WHERE lot_id = ?', lot.id);
  const sum = (f) => units.filter(f).reduce((s, u) => s + u.boxes, 0);
  return {
    lot,
    mo,
    progress,
    kiln_loads: kilnLoads,
    qc,
    units,
    claims,
    totals: {
      boxes: sum(() => true),
      in_stock: sum((u) => ['in_stock', 'hold'].includes(u.status)),
      reserved: sum((u) => ['reserved', 'picked'].includes(u.status)),
      shipped: sum((u) => ['loaded', 'shipped'].includes(u.status)),
    },
  };
}

export function labourReport(from, to) {
  return all(
    `SELECT w.id AS worker_id, w.name AS worker, w.piece_rate, st.name AS stage, SUM(sl.qty_good) AS good, SUM(sl.qty_scrap) AS scrap, COUNT(*) AS entries
     FROM stage_logs sl JOIN workers w ON w.id = sl.worker_id JOIN stages st ON st.id = sl.stage_id
     WHERE date(sl.created_at) BETWEEN ? AND ? GROUP BY w.id, st.id ORDER BY w.name, st.sort`,
    from,
    to,
  ).map((r) => ({ ...r, pay: r.piece_rate ? round2(r.good * r.piece_rate) : null }));
}
