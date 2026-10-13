// Sales documents: quote -> order -> proforma / invoice -> credit note.
import { all, get, insert, update, run, tx, today, nowTs } from '../db.js';
import { lineQuantities, lineTotal, docTotals, packingSummary, tierCheck, promisedDate, addDays, round2 } from '../../shared/calc.js';
import { DOC_TYPES } from '../../shared/constants.js';
import { getSettings } from '../lib/settings.js';
import { nextNumber } from '../lib/numbering.js';
import { bad, notFound, conflict } from '../lib/http.js';
import { productsByIds } from './catalog.js';
import { unreserveUnit, reservedBoxes, lineLots } from './stock.js';

export const DOC_SELECT = `d.*, c.company AS client_name, c.region AS client_region, c.country AS client_country,
  c.code AS client_code, c.email AS client_email, t.name AS tier_name, e.name AS entity_name, u.name AS created_by_name,
  src.number AS source_number, src.type AS source_type, o.number AS order_number, op.title AS opportunity_title`;

export const DOC_FROM = `sales_docs d
  JOIN clients c ON c.id = d.client_id
  LEFT JOIN price_tiers t ON t.id = d.tier_id
  LEFT JOIN entities e ON e.id = d.entity_id
  LEFT JOIN users u ON u.id = d.created_by
  LEFT JOIN sales_docs src ON src.id = d.source_id
  LEFT JOIN sales_docs o ON o.id = d.order_id
  LEFT JOIN opportunities op ON op.id = d.opportunity_id`;

const TIER_FOR_TYPE = { end_user: 'END', trade: 'TRADE', wholesale: 'WHOLESALE', distributor: 'WHOLESALE', programme: 'PROGRAMME' };

export function defaultTierId(clientType) {
  return get('SELECT id FROM price_tiers WHERE code = ?', TIER_FOR_TYPE[clientType] || 'END')?.id ?? null;
}

export function defaultEntityId() {
  return (get('SELECT id FROM entities WHERE is_default = 1 AND active = 1') || get('SELECT id FROM entities WHERE active = 1 ORDER BY id'))?.id ?? null;
}

/** Header defaults for a new document, from the client and the settings. */
export function newDocDefaults(type, client) {
  const s = getSettings();
  const d = s.defaults;
  const domestic = client.region === 'MA';
  const issue = today();
  return {
    type,
    client_id: client.id,
    entity_id: defaultEntityId(),
    status: 'draft',
    issue_date: issue,
    valid_until: type === 'quote' ? addDays(issue, d.quote_validity_days) : type === 'invoice' ? addDays(issue, d.invoice_due_days) : type === 'proforma' ? addDays(issue, 14) : null,
    currency: client.currency || d.currency,
    tier_id: client.tier_id ?? defaultTierId(client.type),
    incoterm: domestic ? null : client.incoterm || d.incoterm,
    incoterm_place: domestic ? null : client.incoterm_place || d.incoterm_place,
    payment_terms: client.payment_terms || d.payment_terms,
    deposit_pct: client.deposit_pct ?? d.deposit_pct,
    lead_time_weeks: d.lead_time_weeks,
    overage_pct: d.overage_pct,
    vat_rate: domestic ? d.vat_rate_domestic : 0,
    vat_note: domestic ? null : d.vat_note_export,
    delivery_address: client.address || null,
  };
}

/** Compute one line from what the user entered. */
export function computeLine(l, doc, p) {
  const unit = l.unit || (p ? p.sell_unit || p.unit : 'unit') || 'unit';
  const ownOverage = l.overage_pct === '' || l.overage_pct === undefined || l.overage_pct === null ? null : Number(l.overage_pct);
  const ov = ownOverage ?? Number(doc.overage_pct || 0);
  const netQty = l.net_qty === '' || l.net_qty === undefined || l.net_qty === null ? null : Number(l.net_qty);
  let q;
  if (p && p.format_id) q = lineQuantities(p, { unit, net_qty: netQty, overage_pct: ov, qty: l.qty });
  else q = { qty: round2(Number(l.qty) || 0), boxes: null, pieces: null, weight_kg: null };
  const price = Math.round((Number(l.unit_price) || 0) * 10000) / 10000;
  return {
    product_id: p ? p.id : null,
    description: l.description ?? (p ? p.name : null),
    unit,
    net_qty: netQty,
    overage_pct: ownOverage,
    qty: q.qty,
    boxes: q.boxes,
    pieces: q.pieces,
    weight_kg: q.weight_kg,
    unit_price: price,
    price_source: l.price_source ?? null,
    discount_pct: Number(l.discount_pct) || 0,
    line_total: lineTotal(q.qty, price, l.discount_pct),
    image_id: l.image_id ? Number(l.image_id) : null,
    notes: l.notes ?? null,
    source_line_id: l.source_line_id ?? null,
  };
}

export function docLines(docId) {
  const lines = all('SELECT * FROM doc_lines WHERE doc_id = ? ORDER BY position, id', docId);
  const products = productsByIds([...new Set(lines.map((l) => l.product_id).filter(Boolean))]);
  const images = new Map(
    all(`SELECT id, stored_name FROM attachments WHERE id IN (${lines.map((l) => l.image_id).filter(Boolean).join(',') || 0})`).map((a) => [a.id, a.stored_name]),
  );
  return lines.map((l) => {
    const p = l.product_id ? products.get(l.product_id) : null;
    return {
      ...l,
      product: p
        ? {
            id: p.id, sku: p.sku, name: p.name, kind: p.kind, format_code: p.format_code, format_name: p.format_name, family: p.family,
            colour_code: p.colour_code, colour_name: p.colour_name, hex: p.hex, finish: p.finish, m2_per_box: p.m2_per_box,
            pcs_per_box: p.pcs_per_box, kg_per_box: p.kg_per_box, boxes_per_pallet: p.boxes_per_pallet, pcs_per_m2: p.pcs_per_m2,
            length_cm: p.length_cm, thickness_cm: p.thickness_cm, sell_unit: p.sell_unit, lead_free: p.lead_free,
          }
        : null,
      image_url: l.image_id && images.get(l.image_id) ? `/files/${images.get(l.image_id)}` : p ? `/api/products/${p.id}/image?v=${p.image_id || 0}` : null,
    };
  });
}

export function recalcTotals(docId) {
  const doc = get('SELECT * FROM sales_docs WHERE id = ?', docId);
  const lines = all('SELECT line_total FROM doc_lines WHERE doc_id = ?', docId);
  const t = docTotals(lines, doc);
  update('sales_docs', docId, { subtotal: t.linesTotal, total: t.total, updated_at: nowTs() });
  return t;
}

export function assertEditable(doc, touchingAmounts = true) {
  const locked =
    (['invoice', 'credit'].includes(doc.type) && doc.status !== 'draft') ||
    (doc.type === 'quote' && doc.status === 'accepted') ||
    (doc.type === 'order' && ['shipped', 'delivered', 'closed', 'cancelled'].includes(doc.status)) ||
    (doc.type === 'proforma' && ['paid', 'cancelled'].includes(doc.status));
  if (locked && touchingAmounts) {
    const why = doc.type === 'invoice' ? 'Issued invoices cannot be changed - create a credit note instead.' : `This ${DOC_TYPES[doc.type].label.toLowerCase()} is ${doc.status} and locked.`;
    throw conflict(why, { code: 'locked' });
  }
}

const HEADER_LOCKED_SAFE = ['internal_notes'];

/** Save header fields and (optionally) replace the lines. Line ids are kept so reservations stay linked. */
export function saveDoc(req, docId, header, lines) {
  const doc = get('SELECT * FROM sales_docs WHERE id = ?', docId);
  if (!doc) throw notFound('Document not found');
  const onlySafe = !lines && Object.keys(header).every((k) => HEADER_LOCKED_SAFE.includes(k));
  assertEditable(doc, !onlySafe);
  tx(() => {
    if (Object.keys(header).length) update('sales_docs', docId, header);
    const merged = { ...doc, ...header };
    const existing = new Map(all('SELECT * FROM doc_lines WHERE doc_id = ?', docId).map((l) => [l.id, l]));
    const source = lines || [...existing.values()].sort((a, b) => a.position - b.position);
    const products = productsByIds([...new Set(source.map((l) => Number(l.product_id)).filter(Boolean))]);
    const keep = new Set();
    source.forEach((l, i) => {
      const p = l.product_id ? products.get(Number(l.product_id)) : null;
      if (l.product_id && !p) throw bad(`Line ${i + 1}: product not found`);
      if (!p && !String(l.description || '').trim()) throw bad(`Line ${i + 1}: choose a product or type a description`);
      const values = { ...computeLine(l, merged, p), position: i };
      const lid = Number(l.id);
      if (lid && existing.has(lid)) {
        update('doc_lines', lid, values);
        keep.add(lid);
      } else {
        keep.add(insert('doc_lines', { doc_id: docId, ...values }));
      }
    });
    for (const id of existing.keys()) {
      if (keep.has(id)) continue;
      if (doc.type === 'order') {
        for (const u of all("SELECT id FROM stock_units WHERE order_line_id = ? AND status IN ('reserved','picked')", id)) unreserveUnit(req, u.id, doc.number);
        run("UPDATE manufacturing_orders SET order_line_id = NULL, notes = COALESCE(notes,'') || ' [order line removed]' WHERE order_line_id = ?", id);
      }
      run('DELETE FROM doc_lines WHERE id = ?', id);
    }
    recalcTotals(docId);
    if (doc.type === 'order') refreshPromised(docId);
  });
}

export function refreshPromised(orderId) {
  const o = get('SELECT * FROM sales_docs WHERE id = ?', orderId);
  const p = promisedDate(o.colour_approved_at, o.deposit_received_at, o.lead_time_weeks);
  if (p !== o.promised_date) update('sales_docs', orderId, { promised_date: p });
}

// ---------------------------------------------------------------------------
// Payments. Payments for an order chain are recorded on the ORDER; invoices of
// that order are settled first-in-first-out from the order's payments.
// ---------------------------------------------------------------------------
export function paymentTarget(doc) {
  return ['proforma', 'invoice'].includes(doc.type) && doc.order_id ? doc.order_id : doc.id;
}

export function paidOn(docId) {
  return round2(get("SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 0) AS s FROM payments WHERE doc_id = ?", docId).s);
}

/** Amount paid towards this document. */
export function paidFor(doc) {
  if (doc.type === 'order' || !doc.order_id) return paidOn(doc.id);
  const pool = paidOn(doc.order_id);
  if (doc.type === 'proforma') return round2(Math.min(pool, doc.total));
  let left = pool;
  const invoices = all("SELECT id, total FROM sales_docs WHERE order_id = ? AND type = 'invoice' AND status NOT IN ('draft','cancelled') ORDER BY issue_date, id", doc.order_id);
  for (const inv of invoices) {
    const alloc = Math.min(left, inv.total);
    if (inv.id === doc.id) return round2(alloc);
    left -= alloc;
  }
  return round2(Math.min(left, doc.total)); // draft invoice: what would be left for it
}

export function invoiceStatusFromPayments(doc) {
  if (doc.type !== 'invoice' || ['draft', 'cancelled'].includes(doc.status)) return doc.status;
  const paid = paidFor(doc);
  if (paid >= doc.total - 0.005) return 'paid';
  if (paid > 0) return 'partially_paid';
  return 'issued';
}

export function displayStatus(doc) {
  if (doc.type === 'invoice' && ['issued', 'partially_paid'].includes(doc.status) && doc.valid_until && doc.valid_until < today()) return 'overdue';
  if (doc.type === 'quote' && doc.status === 'sent' && doc.valid_until && doc.valid_until < today()) return 'expired';
  return doc.status;
}

/** After any payment change: refresh invoice/proforma statuses and the deposit gate. */
export function afterPaymentChange(req, targetId) {
  const target = get('SELECT * FROM sales_docs WHERE id = ?', targetId);
  if (!target) return;
  if (target.type === 'order') {
    const paid = paidOn(target.id);
    const deposit = round2((target.total * (target.deposit_pct || 0)) / 100);
    if (!target.deposit_received_at && paid > 0 && paid >= deposit - 0.005) {
      const last = get('SELECT date FROM payments WHERE doc_id = ? ORDER BY date DESC, id DESC LIMIT 1', target.id);
      update('sales_docs', target.id, { deposit_received_at: last?.date || today() });
      refreshPromised(target.id);
    }
    for (const d of all("SELECT * FROM sales_docs WHERE order_id = ? AND type IN ('invoice','proforma')", target.id)) {
      if (d.type === 'invoice') update('sales_docs', d.id, { status: invoiceStatusFromPayments(d) });
      else if (d.status === 'issued' && paidFor(d) >= d.total - 0.005) update('sales_docs', d.id, { status: 'paid' });
    }
  } else if (target.type === 'invoice') {
    update('sales_docs', target.id, { status: invoiceStatusFromPayments(target) });
  }
}

// ---------------------------------------------------------------------------
// Status changes and conversions
// ---------------------------------------------------------------------------
const TRANSITIONS = {
  quote: { draft: ['sent', 'accepted', 'rejected'], sent: ['accepted', 'rejected', 'expired', 'draft'], rejected: ['draft'], expired: ['draft', 'sent'], accepted: [] },
  order: {
    draft: ['confirmed', 'cancelled'],
    confirmed: ['in_production', 'ready', 'cancelled', 'draft'],
    in_production: ['ready', 'cancelled', 'confirmed'],
    ready: ['shipped', 'in_production', 'cancelled'],
    shipped: ['delivered', 'closed'],
    delivered: ['closed'],
    closed: [],
    cancelled: ['draft'],
  },
  proforma: { draft: ['issued', 'cancelled'], issued: ['paid', 'cancelled', 'draft'], paid: [], cancelled: [] },
  invoice: { draft: ['issued', 'cancelled'], issued: ['cancelled'], partially_paid: [], paid: [], cancelled: [] },
  credit: { draft: ['issued', 'cancelled'], issued: [], cancelled: [] },
};

export function changeStatus(req, docId, status) {
  const doc = get('SELECT * FROM sales_docs WHERE id = ?', docId);
  if (!doc) throw notFound('Document not found');
  if (doc.status === status) return doc;
  const allowed = TRANSITIONS[doc.type]?.[doc.status] || [];
  if (!allowed.includes(status)) throw bad(`A ${doc.status} ${DOC_TYPES[doc.type].label.toLowerCase()} cannot be marked ${status.replace('_', ' ')}.`);
  tx(() => {
    const patch = { status, updated_at: nowTs() };
    if (status === 'sent' || status === 'issued') patch.sent_at = doc.sent_at || nowTs();
    if (doc.type === 'invoice' && status === 'issued' && !doc.valid_until) patch.valid_until = addDays(today(), getSettings().defaults.invoice_due_days);
    if (doc.type === 'invoice' && status === 'cancelled' && paidOn(doc.id) > 0) throw bad('This invoice has payments. Issue a credit note instead.');
    update('sales_docs', docId, patch);
    if (doc.type === 'quote' && doc.opportunity_id) {
      const opp = get('SELECT stage FROM opportunities WHERE id = ?', doc.opportunity_id);
      if (status === 'accepted') update('opportunities', doc.opportunity_id, { stage: 'won', probability: 100, updated_at: nowTs() });
      else if (status === 'sent' && opp && ['new', 'qualified', 'samples'].includes(opp.stage)) update('opportunities', doc.opportunity_id, { stage: 'quoted', updated_at: nowTs() });
    }
    if (doc.type === 'order' && status === 'cancelled') {
      for (const u of all("SELECT u.id FROM stock_units u JOIN doc_lines dl ON dl.id = u.order_line_id WHERE dl.doc_id = ? AND u.status IN ('reserved','picked')", docId)) {
        unreserveUnit(req, u.id, doc.number);
      }
      run("UPDATE manufacturing_orders SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status IN ('planned','released','hold')", nowTs(), docId);
    }
    if (doc.type === 'invoice' && status === 'issued') afterPaymentChange(req, doc.order_id || doc.id);
  });
  return get('SELECT * FROM sales_docs WHERE id = ?', docId);
}

const CONVERSIONS = { quote: ['order', 'proforma'], order: ['proforma', 'invoice'], proforma: ['invoice'], invoice: ['credit'] };

export function convertDoc(req, docId, to) {
  const src = get('SELECT * FROM sales_docs WHERE id = ?', docId);
  if (!src) throw notFound('Document not found');
  if (!(CONVERSIONS[src.type] || []).includes(to)) throw bad(`A ${src.type} cannot be turned into a ${to}.`);
  if (src.type === 'quote' && to === 'order') {
    const existing = get("SELECT number FROM sales_docs WHERE source_id = ? AND type = 'order' AND status != 'cancelled'", src.id);
    if (existing) throw conflict(`Already converted to ${existing.number}.`);
  }
  const s = getSettings();
  return tx(() => {
    const issue = today();
    const orderId = src.type === 'order' ? src.id : src.order_id;
    const id = insert('sales_docs', {
      type: to,
      number: nextNumber(to),
      entity_id: src.entity_id,
      client_id: src.client_id,
      opportunity_id: src.opportunity_id,
      source_id: src.id,
      order_id: to === 'order' ? null : orderId,
      status: to === 'order' ? 'confirmed' : 'draft',
      issue_date: issue,
      valid_until: to === 'invoice' ? addDays(issue, s.defaults.invoice_due_days) : to === 'proforma' ? addDays(issue, 14) : null,
      currency: src.currency,
      tier_id: src.tier_id,
      incoterm: src.incoterm,
      incoterm_place: src.incoterm_place,
      payment_terms: src.payment_terms,
      deposit_pct: src.deposit_pct,
      lead_time_weeks: src.lead_time_weeks,
      overage_pct: src.overage_pct,
      project: src.project,
      client_ref: src.client_ref,
      delivery_address: src.delivery_address,
      discount_pct: src.discount_pct,
      freight: src.freight,
      handling_fee: src.handling_fee,
      vat_rate: src.vat_rate,
      vat_note: src.vat_note,
      notes: src.notes,
      colour_approved_at: to === 'order' ? null : src.colour_approved_at,
      created_by: req.user?.id ?? null,
    });
    for (const l of all('SELECT * FROM doc_lines WHERE doc_id = ? ORDER BY position, id', src.id)) {
      const { id: lineId, doc_id: _d, ...rest } = l;
      insert('doc_lines', { ...rest, doc_id: id, source_line_id: lineId });
    }
    recalcTotals(id);
    if (src.type === 'quote' && to === 'order' && src.status !== 'accepted') {
      update('sales_docs', src.id, { status: 'accepted', updated_at: nowTs() });
      if (src.opportunity_id) update('opportunities', src.opportunity_id, { stage: 'won', probability: 100, updated_at: nowTs() });
    }
    return id;
  });
}

export function duplicateDoc(req, docId) {
  const src = get('SELECT * FROM sales_docs WHERE id = ?', docId);
  if (!src) throw notFound('Document not found');
  const client = get('SELECT * FROM clients WHERE id = ?', src.client_id);
  return tx(() => {
    const d = newDocDefaults(src.type, client);
    const id = insert('sales_docs', {
      ...d,
      number: nextNumber(src.type),
      opportunity_id: src.opportunity_id,
      project: src.project,
      currency: src.currency,
      tier_id: src.tier_id,
      incoterm: src.incoterm,
      incoterm_place: src.incoterm_place,
      overage_pct: src.overage_pct,
      notes: src.notes,
      created_by: req.user?.id ?? null,
    });
    for (const l of all('SELECT * FROM doc_lines WHERE doc_id = ? ORDER BY position, id', src.id)) {
      const { id: _i, doc_id: _d, source_line_id: _s, ...rest } = l;
      insert('doc_lines', { ...rest, doc_id: id });
    }
    recalcTotals(id);
    return id;
  });
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------
export function docDetail(docId) {
  const doc = get(`SELECT ${DOC_SELECT} FROM ${DOC_FROM} WHERE d.id = ?`, docId);
  if (!doc) throw notFound('Document not found');
  const s = getSettings();
  const lines = docLines(docId);
  const paid = paidFor(doc);
  const totals = docTotals(lines, { ...doc, paid });
  const packing = packingSummary(
    lines.filter((l) => l.boxes).map((l) => ({ boxes: l.boxes, weight_kg: l.weight_kg, family: l.product?.family, boxes_per_pallet: l.product?.boxes_per_pallet })),
    s.logistics,
  );
  const tier = doc.tier_id ? get('SELECT * FROM price_tiers WHERE id = ?', doc.tier_id) : null;
  const target = paymentTarget(doc);
  const related = relatedDocs(doc);
  return {
    ...doc,
    display_status: displayStatus(doc),
    lines,
    totals,
    paid,
    packing,
    tier_check: tierCheck(tier, packing.pallets),
    payments: all('SELECT p.*, u.name AS created_by_name FROM payments p LEFT JOIN users u ON u.id = p.created_by WHERE p.doc_id = ? ORDER BY p.date, p.id', target),
    payment_doc_id: target,
    related,
    client: get('SELECT * FROM clients WHERE id = ?', doc.client_id),
    entity: doc.entity_id ? get('SELECT * FROM entities WHERE id = ?', doc.entity_id) : null,
    fulfilment: doc.type === 'order' ? orderFulfilment(doc.id) : null,
    shipments: doc.type === 'order' ? all('SELECT s.* FROM shipments s JOIN shipment_orders so ON so.shipment_id = s.id WHERE so.order_id = ? ORDER BY s.id', doc.id) : [],
    attachments: all("SELECT * FROM attachments WHERE entity = 'doc' AND entity_id = ? ORDER BY id", doc.id),
    gates_missing: doc.type === 'order' ? [!doc.colour_approved_at && 'colour', !doc.deposit_received_at && 'deposit'].filter(Boolean) : [],
  };
}

/** The whole chain around a document: its quote, order, proformas, invoices, credit notes. */
function relatedDocs(doc) {
  const ids = new Set();
  const addAll = (sql, ...p) => all(sql, ...p).forEach((r) => ids.add(r.id));
  const orderId = doc.type === 'order' ? doc.id : doc.order_id;
  if (doc.source_id) ids.add(doc.source_id);
  addAll('SELECT id FROM sales_docs WHERE source_id = ?', doc.id);
  if (orderId) {
    ids.add(orderId);
    addAll('SELECT id FROM sales_docs WHERE order_id = ?', orderId);
    const order = get('SELECT source_id FROM sales_docs WHERE id = ?', orderId);
    if (order?.source_id) ids.add(order.source_id);
  }
  ids.delete(doc.id);
  if (!ids.size) return [];
  return all(`SELECT id, type, number, status, total, currency, issue_date FROM sales_docs WHERE id IN (${[...ids].join(',')}) ORDER BY id`);
}

/** Per order line: what is reserved, what is being made, what has shipped. */
export function orderFulfilment(orderId) {
  const lines = all(
    `SELECT dl.id, dl.position, dl.product_id, dl.boxes, dl.qty, dl.unit, p.sku, p.kind FROM doc_lines dl LEFT JOIN products p ON p.id = dl.product_id
     WHERE dl.doc_id = ? ORDER BY dl.position, dl.id`,
    orderId,
  );
  return lines.map((l) => {
    if (!l.boxes || !l.product_id) return { line_id: l.id, sku: l.sku, tracked: false };
    const byStatus = Object.fromEntries(
      all(`SELECT status, SUM(boxes) AS boxes FROM stock_units WHERE order_line_id = ? GROUP BY status`, l.id).map((r) => [r.status, r.boxes]),
    );
    const mos = all(
      `SELECT mo.id, mo.number, mo.status, mo.boxes_required, mo.target_pcs, mo.due_date, st.name AS stage_name, lt.code AS lot_code
       FROM manufacturing_orders mo LEFT JOIN stages st ON st.id = mo.current_stage_id LEFT JOIN lots lt ON lt.id = mo.lot_id
       WHERE mo.order_line_id = ? AND mo.status != 'cancelled' ORDER BY mo.id`,
      l.id,
    );
    const reserved = reservedBoxes(l.id);
    const inProduction = mos.filter((m) => !['completed', 'closed'].includes(m.status)).reduce((s, m) => s + (m.boxes_required || 0), 0);
    const lots = lineLots(l.id);
    let state = 'open';
    if ((byStatus.shipped || 0) >= l.boxes) state = 'shipped';
    else if ((byStatus.loaded || 0) + (byStatus.shipped || 0) >= l.boxes) state = 'loaded';
    else if (reserved >= l.boxes) state = 'ready';
    else if (inProduction > 0) state = 'in_production';
    else if (reserved > 0) state = 'partial';
    return {
      line_id: l.id,
      sku: l.sku,
      tracked: true,
      required: l.boxes,
      reserved,
      picked: byStatus.picked || 0,
      loaded: byStatus.loaded || 0,
      shipped: byStatus.shipped || 0,
      in_production: inProduction,
      lots: lots.map((x) => x.code || 'no lot'),
      multi_lot: lots.length > 1,
      mos,
      state,
    };
  });
}

/** Refresh an order's status from its fulfilment (called after packing / loading). */
export function syncOrderStatus(orderId) {
  const o = get('SELECT * FROM sales_docs WHERE id = ?', orderId);
  if (!o || o.type !== 'order' || ['draft', 'cancelled', 'closed', 'delivered'].includes(o.status)) return;
  const f = orderFulfilment(orderId).filter((x) => x.tracked);
  if (!f.length) return;
  let status = o.status;
  if (f.every((x) => x.state === 'shipped')) status = 'shipped';
  else if (f.every((x) => ['ready', 'loaded', 'shipped'].includes(x.state))) status = o.status === 'shipped' ? 'shipped' : 'ready';
  else if (f.some((x) => x.in_production > 0)) status = 'in_production';
  if (status !== o.status) update('sales_docs', orderId, { status, updated_at: nowTs() });
}

export function listDocs({ type, status, client_id, q, limit = 300, overdue, open } = {}) {
  const where = [];
  const params = [];
  if (type) {
    where.push('d.type = ?');
    params.push(type);
  }
  if (status && status !== 'overdue') {
    where.push('d.status = ?');
    params.push(status);
  }
  if (client_id) {
    where.push('d.client_id = ?');
    params.push(client_id);
  }
  if (q) {
    where.push('(d.number LIKE ? OR c.company LIKE ? OR d.project LIKE ? OR d.client_ref LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (open) where.push("d.status NOT IN ('cancelled','closed','rejected','expired','paid','accepted','delivered')");
  const rows = all(
    `SELECT ${DOC_SELECT}, (SELECT COUNT(*) FROM doc_lines x WHERE x.doc_id = d.id) AS line_count,
       (SELECT image_id FROM doc_lines x WHERE x.doc_id = d.id AND x.product_id IS NOT NULL ORDER BY x.position LIMIT 1) AS first_image_id,
       (SELECT product_id FROM doc_lines x WHERE x.doc_id = d.id AND x.product_id IS NOT NULL ORDER BY x.position LIMIT 1) AS first_product_id
     FROM ${DOC_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY d.issue_date DESC, d.id DESC LIMIT ?`,
    ...params,
    Number(limit) || 300,
  );
  let out = rows.map((d) => {
    const paid = ['order', 'invoice', 'proforma'].includes(d.type) ? paidFor(d) : 0;
    return {
      ...d,
      display_status: displayStatus(d),
      paid,
      balance: round2(d.total - paid),
      thumb_url: d.first_product_id ? `/api/products/${d.first_product_id}/image` : null,
      gates_missing: d.type === 'order' && ['confirmed', 'draft'].includes(d.status) ? [!d.colour_approved_at && 'colour', !d.deposit_received_at && 'deposit'].filter(Boolean) : [],
    };
  });
  if (status === 'overdue' || overdue) out = out.filter((d) => d.display_status === 'overdue');
  return out;
}
