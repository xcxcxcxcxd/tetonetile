// Stock positioning: every pallet / box group / material lot is a "stock unit"
// with a QR label and a location (warehouse -> zone -> rack/level/position).
import { all, get, insert, update, tx, nowTs } from '../db.js';
import { nextNumber } from '../lib/numbering.js';
import { bad, notFound, conflict } from '../lib/http.js';
import { round2 } from '../../shared/calc.js';

/** Statuses of units that are physically somewhere in our buildings. */
export const PRESENT = ['in_stock', 'reserved', 'picked', 'hold'];
const PRESENT_SQL = PRESENT.map((s) => `'${s}'`).join(',');

export const UNIT_COLS = `u.*, p.sku, p.name AS product_name, p.kind AS product_kind,
  f.code AS format_code, f.name AS format_name, f.m2_per_box, f.pcs_per_box, f.kg_per_box, f.boxes_per_pallet, f.family, f.shape,
  c.code AS colour_code, c.name AS colour_name, c.hex, c.finish, c.fast_seller,
  l.code AS lot_code, l.status AS lot_status,
  loc.code AS location_code, loc.label AS location_label, z.kind AS zone_kind, z.code AS zone_code, z.name AS zone_name,
  w.code AS warehouse_code, w.id AS warehouse_id,
  m.code AS material_code, m.name AS material_name, m.unit AS material_unit, m.category AS material_category,
  d.number AS order_number, d.id AS order_id, cl.company AS order_client,
  s.number AS shipment_number, par.code AS parent_code`;

export const UNIT_FROM = `stock_units u
  LEFT JOIN products p ON p.id = u.product_id
  LEFT JOIN formats f ON f.id = p.format_id
  LEFT JOIN colours c ON c.id = p.colour_id
  LEFT JOIN lots l ON l.id = u.lot_id
  LEFT JOIN locations loc ON loc.id = u.location_id
  LEFT JOIN zones z ON z.id = loc.zone_id
  LEFT JOIN warehouses w ON w.id = z.warehouse_id
  LEFT JOIN materials m ON m.id = u.material_id
  LEFT JOIN doc_lines dl ON dl.id = u.order_line_id
  LEFT JOIN sales_docs d ON d.id = dl.doc_id
  LEFT JOIN clients cl ON cl.id = d.client_id
  LEFT JOIN shipments s ON s.id = u.shipment_id
  LEFT JOIN stock_units par ON par.id = u.parent_id`;

export function decorateUnit(u) {
  if (!u) return u;
  u.m2 = u.m2_per_box ? round2(u.boxes * u.m2_per_box) : null;
  u.weight_kg = u.kg_per_box ? round2(u.boxes * u.kg_per_box + (u.loose_pcs && u.pcs_per_box ? (u.loose_pcs / u.pcs_per_box) * u.kg_per_box : 0)) : null;
  u.pieces = u.pcs_per_box ? u.boxes * u.pcs_per_box + (u.loose_pcs || 0) : null;
  u.image_url = u.product_id ? `/api/products/${u.product_id}/image` : null;
  return u;
}

export function unitRow(id) {
  return decorateUnit(get(`SELECT ${UNIT_COLS} FROM ${UNIT_FROM} WHERE u.id = ?`, id));
}

export function unitByCode(code) {
  return decorateUnit(get(`SELECT ${UNIT_COLS} FROM ${UNIT_FROM} WHERE u.code = ? COLLATE NOCASE`, String(code).trim()));
}

export function listUnits(where = '1=1', params = [], order = 'u.updated_at DESC', limit = 500) {
  return all(`SELECT ${UNIT_COLS} FROM ${UNIT_FROM} WHERE ${where} ORDER BY ${order} LIMIT ${Number(limit) || 500}`, ...params).map(decorateUnit);
}

export function logMove(req, m) {
  insert('stock_moves', {
    user_id: req?.user?.id ?? null,
    unit_id: m.unit_id ?? null,
    unit_code: m.unit_code ?? null,
    type: m.type,
    from_location_id: m.from_location_id ?? null,
    to_location_id: m.to_location_id ?? null,
    boxes: m.boxes ?? null,
    qty: m.qty ?? null,
    ref: m.ref ?? null,
    notes: m.notes ?? null,
  });
}

/**
 * Find a location by id, full code (TET-A01-2B) or short label (A01-2B). The same
 * label can exist in several warehouses: then the given warehouse wins, else the main one.
 */
export function findLocation(ref, { warehouseId } = {}) {
  if (ref === null || ref === undefined || ref === '') return null;
  const sel = `SELECT loc.*, z.kind AS zone_kind, z.code AS zone_code, z.name AS zone_name, z.warehouse_id, w.code AS warehouse_code
    FROM locations loc JOIN zones z ON z.id = loc.zone_id JOIN warehouses w ON w.id = z.warehouse_id`;
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return get(`${sel} WHERE loc.id = ?`, Number(ref));
  const code = String(ref).trim().toUpperCase().replace(/^LOC[-:]/, '');
  const byCode = get(`${sel} WHERE loc.code = ?`, code);
  if (byCode) return byCode;
  const byLabel = all(`${sel} WHERE loc.label = ? ORDER BY w.id`, code);
  if (byLabel.length <= 1) return byLabel[0] || null;
  return byLabel.find((l) => l.warehouse_id === Number(warehouseId)) || byLabel[0];
}

const palletsOf = (u) => (u.kind === 'boxes' ? u.boxes / (u.boxes_per_pallet || 78) : u.kind === 'material' ? 0 : 1);

/** How full a location is, in its own capacity unit. */
export function occupancy(locationId) {
  const loc = get('SELECT * FROM locations WHERE id = ?', locationId);
  if (!loc) return null;
  const units = all(
    `SELECT u.kind, u.boxes, f.boxes_per_pallet FROM stock_units u
     LEFT JOIN products p ON p.id = u.product_id LEFT JOIN formats f ON f.id = p.format_id
     WHERE u.location_id = ? AND u.status IN (${PRESENT_SQL}) AND u.parent_id IS NULL`,
    locationId,
  );
  const boxes = units.reduce((s, u) => s + (u.boxes || 0), 0);
  const pallets = Math.ceil(units.reduce((s, u) => s + palletsOf(u), 0) - 1e-9);
  const used = loc.capacity_unit === 'box' ? boxes : loc.capacity_unit === 'pallet' ? pallets : units.length;
  const capacity = loc.capacity_unit === 'any' || loc.capacity_unit === 'kg' ? null : loc.capacity;
  return { used, capacity, unit: loc.capacity_unit, boxes, pallets, units: units.length, free: capacity != null ? capacity - used : null };
}

function addedLoad(loc, unit) {
  if (loc.capacity_unit === 'box') return unit.boxes || 0;
  if (loc.capacity_unit === 'pallet') return unit.kind === 'boxes' ? Math.ceil((unit.boxes || 0) / (unit.boxes_per_pallet || 78)) || 1 : unit.kind === 'material' ? 0 : 1;
  return 0;
}

const SERIES = { pallet: 'pallet', boxes: 'boxes', material: 'material', shipping: 'shipping' };

export function createUnit(req, data, { ref = null, notes = null, moveType = 'receive' } = {}) {
  const kind = data.kind || 'pallet';
  const code = data.code || nextNumber(SERIES[kind] || 'pallet');
  const id = insert('stock_units', {
    code,
    kind,
    product_id: data.product_id ?? null,
    material_id: data.material_id ?? null,
    lot_id: data.lot_id ?? null,
    supplier_lot: data.supplier_lot ?? null,
    grade: data.grade || 'A',
    boxes: data.boxes ?? 0,
    loose_pcs: data.loose_pcs ?? 0,
    qty: data.qty ?? 0,
    location_id: data.location_id ?? null,
    parent_id: data.parent_id ?? null,
    pool: data.pool || 'general',
    status: data.status || 'in_stock',
    order_line_id: data.order_line_id ?? null,
    shipment_id: data.shipment_id ?? null,
    mo_id: data.mo_id ?? null,
    notes: data.notes ?? null,
  });
  logMove(req, { unit_id: id, unit_code: code, type: moveType, to_location_id: data.location_id ?? null, boxes: data.boxes ?? null, qty: data.qty || null, ref, notes });
  return id;
}

/** Move a unit (and anything stacked on it) to a location. Over-capacity needs force. */
export function moveUnit(req, unitId, locationRef, { ref = null, notes = null, force = false } = {}) {
  const u = unitRow(unitId);
  if (!u) throw notFound('Stock unit not found');
  if (!PRESENT.includes(u.status)) throw bad(`${u.code} is ${u.status.replace('_', ' ')} and cannot be moved.`);
  if (u.parent_id) throw bad(`${u.code} is on shipping pallet ${u.parent_code}. Move that pallet instead.`);
  const loc = findLocation(locationRef);
  if (!loc || !loc.active) throw notFound('Location not found');
  if (loc.blocked && !force) throw conflict(`${loc.label} is blocked.`, { code: 'blocked' });
  if (u.location_id === loc.id) return { unchanged: true, location: loc };
  const occ = occupancy(loc.id);
  const add = addedLoad(loc, u);
  const warnings = [];
  if (occ.capacity != null && occ.used + add > occ.capacity) {
    const msg = `${loc.label} would hold ${occ.used + add} of ${occ.capacity} ${occ.unit}${occ.capacity === 1 ? '' : 's'}.`;
    if (!force) throw conflict(`Location is full. ${msg}`, { code: 'over_capacity' });
    warnings.push(msg);
  }
  if (u.status === 'hold' && loc.zone_kind !== 'quarantine') warnings.push(`${u.code} is on QC hold; it should stay in quarantine.`);
  if (u.kind === 'material' && loc.zone_kind !== 'raw') warnings.push('Raw materials normally go to the raw materials zone.');
  if (u.kind !== 'material' && loc.zone_kind === 'raw') warnings.push('This is the raw materials zone.');
  tx(() => {
    update('stock_units', u.id, { location_id: loc.id, updated_at: nowTs() });
    for (const child of all('SELECT id FROM stock_units WHERE parent_id = ?', u.id)) {
      update('stock_units', child.id, { location_id: loc.id, updated_at: nowTs() });
    }
    logMove(req, { unit_id: u.id, unit_code: u.code, type: 'move', from_location_id: u.location_id, to_location_id: loc.id, boxes: u.boxes, ref, notes });
  });
  return { location: loc, warnings };
}

/** Take `boxes` off a unit into a new unit. */
export function splitUnit(req, unitId, boxes, { locationId, status, orderLineId, kind, ref } = {}) {
  const u = get('SELECT * FROM stock_units WHERE id = ?', unitId);
  if (!u) throw notFound('Stock unit not found');
  boxes = Number(boxes);
  if (!Number.isInteger(boxes) || boxes <= 0 || boxes >= u.boxes) throw bad(`Split must take between 1 and ${u.boxes - 1} boxes.`);
  return tx(() => {
    const newId = createUnit(
      req,
      {
        kind: kind || u.kind,
        product_id: u.product_id,
        material_id: u.material_id,
        lot_id: u.lot_id,
        grade: u.grade,
        boxes,
        location_id: locationId !== undefined ? locationId : u.location_id,
        pool: u.pool,
        status: status || u.status,
        order_line_id: orderLineId !== undefined ? orderLineId : u.order_line_id,
        mo_id: u.mo_id,
      },
      { moveType: 'split', ref: ref || u.code, notes: `Split from ${u.code}` },
    );
    update('stock_units', u.id, { boxes: u.boxes - boxes, updated_at: nowTs() });
    return newId;
  });
}

export function setUnitStatus(req, unitId, status, { notes, ref } = {}) {
  const u = get('SELECT * FROM stock_units WHERE id = ?', unitId);
  if (!u) throw notFound('Stock unit not found');
  const patch = { status, updated_at: nowTs() };
  if (['shipped', 'consumed', 'scrapped'].includes(status)) patch.location_id = null;
  if (status === 'in_stock') patch.order_line_id = null;
  update('stock_units', u.id, patch);
  logMove(req, { unit_id: u.id, unit_code: u.code, type: status === 'hold' ? 'hold' : status === 'scrapped' ? 'scrap' : status === 'in_stock' ? 'release' : status, from_location_id: u.location_id, boxes: u.boxes, qty: u.qty || null, notes, ref });
}

export function adjustUnit(req, unitId, { boxes, loose_pcs, qty, reason }) {
  const u = get('SELECT * FROM stock_units WHERE id = ?', unitId);
  if (!u) throw notFound('Stock unit not found');
  const patch = { updated_at: nowTs() };
  if (boxes !== undefined && boxes !== null) patch.boxes = Math.max(0, Math.round(Number(boxes)));
  if (loose_pcs !== undefined && loose_pcs !== null) patch.loose_pcs = Math.max(0, Math.round(Number(loose_pcs)));
  if (qty !== undefined && qty !== null) patch.qty = Math.max(0, Number(qty));
  const nb = patch.boxes ?? u.boxes;
  const nq = patch.qty ?? u.qty;
  const empty = u.kind === 'material' ? nq <= 0 : nb <= 0 && (patch.loose_pcs ?? u.loose_pcs) <= 0;
  if (empty) {
    patch.status = u.kind === 'material' ? 'consumed' : 'scrapped';
    patch.location_id = null;
  }
  update('stock_units', u.id, patch);
  logMove(req, {
    unit_id: u.id,
    unit_code: u.code,
    type: 'adjust',
    from_location_id: u.location_id,
    boxes: patch.boxes !== undefined ? patch.boxes - u.boxes : null,
    qty: patch.qty !== undefined ? round2(patch.qty - u.qty) : null,
    notes: reason || null,
  });
}

// ---------------------------------------------------------------------------
// Directed putaway: where should this unit go?
// ---------------------------------------------------------------------------
const ZONES_FOR = {
  pallet: ['rack', 'floor'],
  boxes: ['shelf', 'samples'],
  material: ['raw'],
  shipping: ['dispatch'],
};

export function putawaySuggestions(unitId, { limit = 5, warehouseId } = {}) {
  const u = unitRow(unitId);
  if (!u) throw notFound('Stock unit not found');
  const kinds = u.status === 'hold' ? ['quarantine'] : u.pool === 'samples' ? ['samples', 'shelf'] : ZONES_FOR[u.kind] || ['rack'];
  const wh = warehouseId || u.warehouse_id || get("SELECT id FROM warehouses WHERE active = 1 ORDER BY id LIMIT 1")?.id;
  const locs = all(
    `SELECT loc.*, z.kind AS zone_kind, z.code AS zone_code, z.name AS zone_name FROM locations loc
     JOIN zones z ON z.id = loc.zone_id
     WHERE z.warehouse_id = ? AND loc.active = 1 AND loc.blocked = 0 AND z.kind IN (${kinds.map(() => '?').join(',')})
     ORDER BY z.sort, loc.rack, loc.level, loc.position`,
    wh,
    ...kinds,
  );
  if (!locs.length) return [];
  // what is where (one query for the whole warehouse)
  const contents = all(
    `SELECT u.location_id, u.lot_id, u.product_id, u.material_id, loc.rack, loc.zone_id FROM stock_units u
     JOIN locations loc ON loc.id = u.location_id JOIN zones z ON z.id = loc.zone_id
     WHERE z.warehouse_id = ? AND u.status IN (${PRESENT_SQL}) AND u.id != ?`,
    wh,
    u.id,
  );
  const byLoc = new Map();
  const productRacks = new Set();
  for (const c of contents) {
    if (!byLoc.has(c.location_id)) byLoc.set(c.location_id, []);
    byLoc.get(c.location_id).push(c);
    if ((u.product_id && c.product_id === u.product_id) || (u.material_id && c.material_id === u.material_id)) productRacks.add(`${c.zone_id}:${c.rack}`);
  }
  const kindRank = Object.fromEntries(kinds.map((k, i) => [k, i]));
  const scored = [];
  for (const loc of locs) {
    if (loc.id === u.location_id) continue;
    const occ = occupancy(loc.id);
    const add = addedLoad(loc, u);
    if (occ.capacity != null && occ.used + add > occ.capacity) continue;
    const here = byLoc.get(loc.id) || [];
    const reasons = [];
    let score = 0;
    const sameLot = u.lot_id && here.some((c) => c.lot_id === u.lot_id);
    const sameItem = here.some((c) => (u.product_id && c.product_id === u.product_id) || (u.material_id && c.material_id === u.material_id));
    const mixed = here.some((c) => (u.product_id && c.product_id !== u.product_id) || (u.material_id && c.material_id !== u.material_id));
    if (sameLot) {
      score += 60;
      reasons.push('Same lot already here - keeps the batch together');
    } else if (sameItem) {
      score += 35;
      reasons.push('Same product already here');
    }
    if (!here.length) {
      score += 20;
      reasons.push('Empty');
    }
    if (mixed && loc.capacity_unit === 'pallet') score -= 25;
    if (!sameItem && productRacks.has(`${loc.zone_id}:${loc.rack}`)) {
      score += 15;
      reasons.push('Same product in this rack');
    }
    if (loc.capacity_unit === 'pallet' && loc.level) {
      if (loc.level === 1) {
        score += u.fast_seller ? 15 : 8;
        reasons.push(u.fast_seller ? 'Ground level - fast seller' : 'Ground level');
      } else score -= (loc.level - 1) * 3;
    }
    score -= (kindRank[loc.zone_kind] || 0) * 10;
    scored.push({ id: loc.id, code: loc.code, label: loc.label, zone: loc.zone_name, zone_kind: loc.zone_kind, score, reasons, occupancy: occ });
  }
  scored.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Allocation: reserve stock for an order line, one lot per line (no banding)
// ---------------------------------------------------------------------------
export function reservedBoxes(lineId) {
  return get(
    `SELECT COALESCE(SUM(boxes), 0) AS n FROM stock_units WHERE order_line_id = ? AND status IN ('reserved','picked','loaded','shipped')`,
    lineId,
  ).n;
}

export function lineLots(lineId) {
  return all(
    `SELECT DISTINCT u.lot_id, l.code FROM stock_units u LEFT JOIN lots l ON l.id = u.lot_id
     WHERE u.order_line_id = ? AND u.status IN ('reserved','picked','loaded','shipped')`,
    lineId,
  );
}

export function availableByLot(productId, { pools = ['general'], grade = 'A' } = {}) {
  return all(
    `SELECT u.lot_id, l.code AS lot_code, l.status AS lot_status, SUM(u.boxes) AS boxes, COUNT(*) AS units, MIN(u.created_at) AS since
     FROM stock_units u LEFT JOIN lots l ON l.id = u.lot_id
     WHERE u.product_id = ? AND u.status = 'in_stock' AND u.grade = ? AND u.kind IN ('pallet','boxes')
       AND u.pool IN (${pools.map(() => '?').join(',')}) AND u.boxes > 0
     GROUP BY u.lot_id ORDER BY since`,
    productId,
    grade,
    ...pools,
  );
}

export function reserveUnit(req, unitId, lineId, ref) {
  const u = get('SELECT * FROM stock_units WHERE id = ?', unitId);
  update('stock_units', unitId, { status: 'reserved', order_line_id: lineId, updated_at: nowTs() });
  logMove(req, { unit_id: unitId, unit_code: u.code, type: 'reserve', from_location_id: u.location_id, boxes: u.boxes, ref });
}

export function unreserveUnit(req, unitId, ref) {
  const u = get('SELECT * FROM stock_units WHERE id = ?', unitId);
  if (!u || !['reserved', 'picked'].includes(u.status)) return;
  update('stock_units', unitId, { status: 'in_stock', order_line_id: null, updated_at: nowTs() });
  logMove(req, { unit_id: unitId, unit_code: u.code, type: 'unreserve', from_location_id: u.location_id, boxes: u.boxes, ref });
}

/**
 * Reserve stock for one order line. Batch continuity rule: the whole line comes
 * from ONE lot unless allowMultiLot is set (then a banding warning is returned).
 */
export function allocateLine(req, lineId, { allowMultiLot = false, pools = ['general'] } = {}) {
  const line = get(
    `SELECT dl.*, d.number AS doc_number, d.type AS doc_type FROM doc_lines dl JOIN sales_docs d ON d.id = dl.doc_id WHERE dl.id = ?`,
    lineId,
  );
  if (!line) throw notFound('Order line not found');
  if (!line.product_id || !line.boxes) return { ok: true, reserved: 0, needed: 0, skipped: true };
  let needed = line.boxes - reservedBoxes(lineId);
  if (needed <= 0) return { ok: true, reserved: 0, needed: 0, warnings: [] };
  const existing = lineLots(lineId).map((l) => l.lot_id);
  let lots = availableByLot(line.product_id, { pools });
  if (existing.length && !allowMultiLot) lots = lots.filter((l) => existing.includes(l.lot_id));
  const fits = lots.filter((l) => l.boxes >= needed).sort((a, b) => a.boxes - b.boxes);
  let plan;
  if (fits.length) plan = [fits[0]];
  else if (allowMultiLot && lots.length) plan = [...lots].sort((a, b) => b.boxes - a.boxes);
  else return { ok: false, reason: 'no_single_lot', needed, available: lots, warnings: [] };

  let reserved = 0;
  const used = [];
  tx(() => {
    for (const lot of plan) {
      if (needed <= 0) break;
      const units = all(
        `SELECT * FROM stock_units WHERE product_id = ? AND lot_id IS ? AND status = 'in_stock' AND grade = 'A'
         AND kind IN ('pallet','boxes') AND pool IN (${pools.map(() => '?').join(',')}) AND boxes > 0 ORDER BY boxes DESC, id`,
        line.product_id,
        lot.lot_id,
        ...pools,
      );
      let took = false;
      for (const u of units) {
        if (needed <= 0) break;
        if (u.boxes <= needed) {
          reserveUnit(req, u.id, lineId, line.doc_number);
          needed -= u.boxes;
          reserved += u.boxes;
        } else {
          const nid = splitUnit(req, u.id, needed, { status: 'reserved', orderLineId: lineId, ref: line.doc_number });
          logMove(req, { unit_id: nid, type: 'reserve', boxes: needed, ref: line.doc_number });
          reserved += needed;
          needed = 0;
        }
        took = true;
      }
      if (took) used.push(lot.lot_code || 'no lot');
    }
  });
  const warnings = [];
  const allLots = new Set([...existing.map(String), ...plan.map((l) => String(l.lot_id))]);
  if (used.length > 1 || allLots.size > 1) warnings.push(`Line supplied from several lots (${used.join(', ')}). Ask the installer to blend boxes to avoid banding.`);
  return { ok: needed <= 0, reserved, needed: Math.max(0, needed), lots: used, warnings };
}

/** Route-ordered pick list for an order: zone, rack, level, position. */
export function pickList(orderId) {
  return listUnits(
    `d.id = ? AND u.status IN ('reserved','picked')`,
    [orderId],
    'w.code, z.sort, loc.rack, loc.level, loc.position, u.code',
    2000,
  );
}

/**
 * Cycle count of one location: `found` lists the unit codes (and box counts) seen.
 * Units found here that were elsewhere are moved here; quantities are adjusted;
 * expected units not found lose their location (they show up in "Unlocated").
 */
export function countLocation(req, locationRef, found) {
  const loc = findLocation(locationRef);
  if (!loc) throw notFound('Location not found');
  const expected = all(`SELECT * FROM stock_units WHERE location_id = ? AND status IN (${PRESENT_SQL}) AND parent_id IS NULL`, loc.id);
  const result = { location: loc.label, confirmed: 0, moved: [], adjusted: [], missing: [], unknown: [] };
  tx(() => {
    const seen = new Set();
    for (const f of found || []) {
      const u = get('SELECT * FROM stock_units WHERE code = ? COLLATE NOCASE', String(f.code || '').trim());
      if (!u) {
        result.unknown.push(f.code);
        continue;
      }
      seen.add(u.id);
      if (u.location_id !== loc.id) {
        if (!PRESENT.includes(u.status)) {
          result.unknown.push(`${u.code} (${u.status})`);
          continue;
        }
        update('stock_units', u.id, { location_id: loc.id, updated_at: nowTs() });
        logMove(req, { unit_id: u.id, unit_code: u.code, type: 'count', from_location_id: u.location_id, to_location_id: loc.id, boxes: u.boxes, notes: 'Found during count' });
        result.moved.push(u.code);
      }
      const boxes = f.boxes === undefined || f.boxes === null || f.boxes === '' ? null : Number(f.boxes);
      const qty = f.qty === undefined || f.qty === null || f.qty === '' ? null : Number(f.qty);
      if ((boxes !== null && boxes !== u.boxes) || (qty !== null && qty !== u.qty)) {
        adjustUnit(req, u.id, { boxes, qty, reason: `Count at ${loc.label}` });
        result.adjusted.push(u.code);
      } else if (u.location_id === loc.id) result.confirmed++;
    }
    for (const u of expected) {
      if (seen.has(u.id)) continue;
      update('stock_units', u.id, { location_id: null, updated_at: nowTs() });
      logMove(req, { unit_id: u.id, unit_code: u.code, type: 'count', from_location_id: loc.id, boxes: u.boxes, notes: `Not found at ${loc.label} during count` });
      result.missing.push(u.code);
    }
  });
  return result;
}

/** Stock summary per product: on hand / reserved / available, in boxes and m2. */
export function stockByProduct(where = '1=1', params = []) {
  return all(
    `SELECT p.id AS product_id, p.sku, p.name, p.reserve_target_boxes, f.code AS format_code, f.m2_per_box, f.boxes_per_pallet,
       c.code AS colour_code, c.name AS colour_name, c.hex, c.fast_seller,
       SUM(CASE WHEN u.status IN ('in_stock','reserved','picked','hold') THEN u.boxes ELSE 0 END) AS on_hand,
       SUM(CASE WHEN u.status IN ('reserved','picked') THEN u.boxes ELSE 0 END) AS reserved,
       SUM(CASE WHEN u.status = 'in_stock' AND u.grade = 'A' AND u.pool = 'general' THEN u.boxes ELSE 0 END) AS available,
       SUM(CASE WHEN u.status = 'in_stock' AND u.pool = 'export_reserve' THEN u.boxes ELSE 0 END) AS export_reserve,
       SUM(CASE WHEN u.status = 'in_stock' AND u.grade = 'B' THEN u.boxes ELSE 0 END) AS grade_b,
       SUM(CASE WHEN u.status = 'hold' THEN u.boxes ELSE 0 END) AS on_hold,
       COUNT(DISTINCT CASE WHEN u.status IN ('in_stock','reserved','picked','hold') THEN u.lot_id END) AS lots,
       COUNT(DISTINCT CASE WHEN u.status IN ('in_stock','reserved','picked','hold') THEN u.location_id END) AS locations
     FROM products p
     JOIN stock_units u ON u.product_id = p.id
     LEFT JOIN formats f ON f.id = p.format_id
     LEFT JOIN colours c ON c.id = p.colour_id
     WHERE ${where}
     GROUP BY p.id
     HAVING on_hand > 0
     ORDER BY p.sku`,
    ...params,
  ).map((r) => ({
    ...r,
    on_hand_m2: r.m2_per_box ? round2(r.on_hand * r.m2_per_box) : null,
    available_m2: r.m2_per_box ? round2(r.available * r.m2_per_box) : null,
    image_url: `/api/products/${r.product_id}/image`,
  }));
}

export function materialStock(materialId) {
  return get(`SELECT COALESCE(SUM(qty), 0) AS qty FROM stock_units WHERE material_id = ? AND status IN (${PRESENT_SQL})`, materialId).qty;
}

/** Consume raw material FIFO across its units. Returns the quantity actually taken. */
export function consumeMaterial(req, materialId, qty, { ref, notes } = {}) {
  let left = Number(qty) || 0;
  if (left <= 0) return 0;
  const units = all(`SELECT * FROM stock_units WHERE material_id = ? AND status = 'in_stock' AND qty > 0 ORDER BY created_at, id`, materialId);
  let taken = 0;
  tx(() => {
    for (const u of units) {
      if (left <= 0) break;
      const take = Math.min(u.qty, left);
      const rest = round2(u.qty - take);
      update('stock_units', u.id, { qty: rest, status: rest <= 0 ? 'consumed' : u.status, location_id: rest <= 0 ? null : u.location_id, updated_at: nowTs() });
      logMove(req, { unit_id: u.id, unit_code: u.code, type: 'consume', from_location_id: u.location_id, qty: -round2(take), ref, notes });
      left = round2(left - take);
      taken = round2(taken + take);
    }
  });
  return taken;
}
