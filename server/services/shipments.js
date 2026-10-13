// Shipments: container / groupage loads, document pack, scan-to-load verification.
import { all, get, insert, update, run, tx, nowTs } from '../db.js';
import { DOC_PACKS } from '../../shared/constants.js';
import { containerCheck, round2 } from '../../shared/calc.js';
import { nextNumber } from '../lib/numbering.js';
import { bad, notFound, conflict } from '../lib/http.js';
import { getSettings } from '../lib/settings.js';
import { listUnits, unitByCode, logMove } from './stock.js';
import { syncOrderStatus } from './docs.js';

export function createShipment(req, data) {
  const s = getSettings();
  const client = data.client_id ? get('SELECT * FROM clients WHERE id = ?', data.client_id) : null;
  const region = data.region || client?.region || 'OTHER';
  const mode = data.mode || 'container_40';
  return tx(() => {
    const id = insert('shipments', {
      number: nextNumber('shipment'),
      client_id: client?.id ?? null,
      mode,
      region,
      incoterm: data.incoterm || client?.incoterm || s.defaults.incoterm,
      incoterm_place: data.incoterm_place || client?.incoterm_place || s.defaults.incoterm_place,
      forwarder: data.forwarder || null,
      port_loading: data.port_loading || s.logistics.port_loading,
      port_discharge: data.port_discharge || null,
      ready_date: data.ready_date || null,
      etd: data.etd || null,
      eta: data.eta || null,
      max_payload_kg: data.max_payload_kg || (mode === 'container_20' ? s.logistics.max_payload_20 : mode === 'container_40' ? s.logistics.max_payload_40 : null),
      status: 'planning',
      notes: data.notes || null,
    });
    (DOC_PACKS[region] || DOC_PACKS.OTHER).forEach(([code, name, hint], i) => insert('shipment_docs', { shipment_id: id, code, name, hint, sort: i }));
    for (const oid of data.order_ids || []) addOrder(id, oid);
    return id;
  });
}

export function addOrder(shipmentId, orderId) {
  const o = get("SELECT * FROM sales_docs WHERE id = ? AND type = 'order'", orderId);
  if (!o) throw notFound('Order not found');
  run('INSERT OR IGNORE INTO shipment_orders (shipment_id, order_id) VALUES (?, ?)', shipmentId, orderId);
}

const FAMILY_PALLET = (u) => u.family || 'zellige';

function summarise(units, pallet_kg) {
  const pallets = {};
  let boxes = 0;
  let net = 0;
  let m2 = 0;
  let count = 0;
  for (const u of units) {
    if (u.parent_id) continue;
    count++;
    const fam = FAMILY_PALLET(u);
    pallets[fam] = (pallets[fam] || 0) + (u.kind === 'boxes' ? u.boxes / (u.boxes_per_pallet || 78) : 1);
  }
  for (const u of units) {
    boxes += u.boxes || 0;
    net += u.weight_kg || 0;
    m2 += u.m2 || 0;
  }
  for (const k of Object.keys(pallets)) pallets[k] = Math.ceil(pallets[k] - 1e-9);
  const palletCount = Object.values(pallets).reduce((s, v) => s + v, 0);
  return { units: count, pallets, pallet_count: palletCount, boxes, m2: round2(m2), net_kg: round2(net), gross_kg: round2(net + palletCount * pallet_kg) };
}

export function shipmentDetail(id) {
  const sh = get(
    `SELECT s.*, c.company AS client_name, c.region AS client_region FROM shipments s LEFT JOIN clients c ON c.id = s.client_id WHERE s.id = ?`,
    id,
  );
  if (!sh) throw notFound('Shipment not found');
  const s = getSettings();
  const orders = all(
    `SELECT d.id, d.number, d.status, d.total, d.currency, c.company AS client_name FROM shipment_orders so
     JOIN sales_docs d ON d.id = so.order_id JOIN clients c ON c.id = d.client_id WHERE so.shipment_id = ? ORDER BY d.number`,
    id,
  );
  const orderIds = orders.map((o) => o.id);
  const expected = orderIds.length
    ? listUnits(`d.id IN (${orderIds.map(() => '?').join(',')}) AND u.status IN ('reserved','picked','loaded','shipped')`, orderIds, 'u.status, w.code, z.sort, loc.rack, loc.level, loc.position, u.code', 5000)
    : [];
  const loadedHere = listUnits('u.shipment_id = ?', [id], 'u.code', 5000);
  const map = new Map(expected.map((u) => [u.id, u]));
  for (const u of loadedHere) map.set(u.id, u);
  const units = [...map.values()];
  const loaded = units.filter((u) => u.shipment_id === id && ['loaded', 'shipped'].includes(u.status));
  const pending = units.filter((u) => !(u.shipment_id === id && ['loaded', 'shipped'].includes(u.status)));
  const plan = summarise(units, s.logistics.pallet_kg);
  const done = summarise(loaded, s.logistics.pallet_kg);
  const docs = all('SELECT sd.*, a.stored_name, a.filename FROM shipment_docs sd LEFT JOIN attachments a ON a.id = sd.attachment_id WHERE sd.shipment_id = ? ORDER BY sd.sort, sd.id', id);
  const docsDone = docs.filter((d) => ['ready', 'sent', 'na'].includes(d.status)).length;
  const lots = [...new Set(units.map((u) => u.lot_code).filter(Boolean))];
  return {
    ...sh,
    orders,
    units,
    loaded,
    pending,
    plan,
    done,
    check: containerCheck(sh.mode, plan.pallets, plan.gross_kg, sh.max_payload_kg),
    docs,
    docs_progress: { done: docsDone, total: docs.length },
    lots,
    photos: all("SELECT * FROM attachments WHERE entity = 'shipment' AND entity_id = ? ORDER BY id", id),
  };
}

/** Scan a pallet label at the loading dock. Only units reserved for this shipment's orders are accepted. */
export function loadScan(req, shipmentId, code) {
  const sh = get('SELECT * FROM shipments WHERE id = ?', shipmentId);
  if (!sh) throw notFound('Shipment not found');
  if (['shipped', 'delivered', 'cancelled'].includes(sh.status)) throw bad(`${sh.number} is ${sh.status}.`);
  const raw = String(code || '').trim();
  const clean = raw.includes('/q/') ? raw.split('/q/').pop() : raw;
  const u = unitByCode(decodeURIComponent(clean));
  if (!u) return { ok: false, reason: 'unknown', message: `No pallet or box label "${clean}".` };
  if (u.shipment_id === sh.id && ['loaded', 'shipped'].includes(u.status)) return { ok: true, already: true, message: `${u.code} is already loaded.`, unit: u };
  const orderIds = all('SELECT order_id FROM shipment_orders WHERE shipment_id = ?', sh.id).map((r) => r.order_id);
  if (!['reserved', 'picked'].includes(u.status) || !orderIds.includes(u.order_id)) {
    const why =
      u.status === 'in_stock' ? `${u.code} is free stock, not reserved for this shipment.`
      : u.status === 'hold' ? `${u.code} is on QC hold. Do not load.`
      : u.order_number ? `${u.code} belongs to ${u.order_number}${u.order_client ? ` (${u.order_client})` : ''}, not to this shipment.`
      : `${u.code} is ${u.status}.`;
    return { ok: false, reason: 'wrong_unit', message: why, unit: u };
  }
  tx(() => {
    update('stock_units', u.id, { status: 'loaded', shipment_id: sh.id, location_id: null, updated_at: nowTs() });
    for (const child of all('SELECT * FROM stock_units WHERE parent_id = ?', u.id)) {
      update('stock_units', child.id, { status: 'loaded', shipment_id: sh.id, location_id: null, updated_at: nowTs() });
    }
    logMove(req, { unit_id: u.id, unit_code: u.code, type: 'load', from_location_id: u.location_id, boxes: u.boxes, ref: sh.number });
    if (['planning', 'booked'].includes(sh.status)) update('shipments', sh.id, { status: 'loading' });
  });
  const d = shipmentDetail(sh.id);
  return { ok: true, message: `${u.code} loaded - ${u.sku || u.material_code} lot ${u.lot_code || '-'}, ${u.boxes} boxes.`, unit: u, progress: { loaded: d.loaded.length, total: d.units.length } };
}

export function unloadUnit(req, shipmentId, unitId) {
  const u = get('SELECT * FROM stock_units WHERE id = ? AND shipment_id = ?', unitId, shipmentId);
  if (!u) throw notFound('That unit is not on this shipment');
  if (u.status !== 'loaded') throw bad(`${u.code} is ${u.status}.`);
  const dock = get(
    `SELECT loc.id FROM locations loc JOIN zones z ON z.id = loc.zone_id WHERE z.kind = 'dispatch' AND loc.active = 1 ORDER BY loc.code LIMIT 1`,
  );
  update('stock_units', u.id, { status: 'picked', shipment_id: null, location_id: dock?.id ?? null, updated_at: nowTs() });
  logMove(req, { unit_id: u.id, unit_code: u.code, type: 'unload', to_location_id: dock?.id ?? null, boxes: u.boxes, notes: 'Taken off the shipment' });
}

const ORDER = ['planning', 'booked', 'loading', 'loaded', 'shipped', 'delivered'];

export function setShipmentStatus(req, id, status, { force = false } = {}) {
  const sh = shipmentDetail(id);
  if (status === sh.status) return;
  if (status === 'cancelled') {
    if (sh.loaded.length) throw bad('Unload all pallets before cancelling the shipment.');
    update('shipments', id, { status });
    return;
  }
  if (!ORDER.includes(status)) throw bad('Unknown status');
  if (status === 'shipped') {
    if (!sh.loaded.length) throw bad('Nothing has been loaded yet.');
    const warnings = [];
    if (sh.pending.length) warnings.push(`${sh.pending.length} reserved unit(s) are not loaded.`);
    const openDocs = sh.docs.filter((d) => d.status === 'todo');
    if (openDocs.length) warnings.push(`${openDocs.length} document(s) in the pack are not ready: ${openDocs.map((d) => d.name).join(', ')}.`);
    if (sh.mode.startsWith('container') && !sh.seal_no) warnings.push('No seal number recorded.');
    if (warnings.length && !force) throw conflict(warnings.join(' '), { code: 'ship_warnings', warnings });
    tx(() => {
      for (const u of all("SELECT * FROM stock_units WHERE shipment_id = ? AND status = 'loaded'", id)) {
        update('stock_units', u.id, { status: 'shipped', location_id: null, updated_at: nowTs() });
        logMove(req, { unit_id: u.id, unit_code: u.code, type: 'ship', boxes: u.boxes, ref: sh.number });
      }
      update('shipments', id, { status, etd: sh.etd || nowTs().slice(0, 10) });
    });
    for (const o of sh.orders) syncOrderStatus(o.id);
    return;
  }
  if (status === 'delivered') {
    update('shipments', id, { status });
    for (const o of sh.orders) {
      const ord = get('SELECT status FROM sales_docs WHERE id = ?', o.id);
      if (ord.status === 'shipped') update('sales_docs', o.id, { status: 'delivered', updated_at: nowTs() });
    }
    return;
  }
  update('shipments', id, { status });
}

/** Packing list rows: one row per pallet / box group. */
export function packingList(id) {
  const d = shipmentDetail(id);
  const s = getSettings();
  const rows = (d.loaded.length ? d.loaded : d.units).map((u, i) => ({
    no: i + 1,
    code: u.code,
    sku: u.sku,
    description: u.product_name,
    colour: u.colour_code ? `${u.colour_code} ${u.colour_name}` : '',
    lot: u.lot_code,
    grade: u.grade,
    boxes: u.boxes,
    pieces: u.pieces,
    m2: u.m2,
    net_kg: u.weight_kg,
    gross_kg: round2((u.weight_kg || 0) + (u.kind === 'boxes' ? 0 : s.logistics.pallet_kg)),
    order: u.order_number,
    hs_code: '6907',
  }));
  return { shipment: d, rows, totals: d.loaded.length ? d.done : d.plan };
}
