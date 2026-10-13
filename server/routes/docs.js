import { Router } from 'express';
import { all, get, insert, update, run, tx, nowTs } from '../db.js';
import { requireRole } from '../auth.js';
import { clean } from '../lib/validate.js';
import { bad, idParam, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { nextNumber } from '../lib/numbering.js';
import { DOC_TYPES } from '../../shared/constants.js';
import {
  newDocDefaults, saveDoc, docDetail, listDocs, changeStatus, convertDoc, duplicateDoc, paymentTarget,
  afterPaymentChange, refreshPromised, orderFulfilment,
} from '../services/docs.js';
import { releaseOrder } from '../services/production.js';
import { allocateLine, unreserveUnit, pickList, availableByLot } from '../services/stock.js';

const r = Router();
const TYPES = Object.keys(DOC_TYPES);

const HEADER_SPEC = {
  entity_id: { type: 'fk' },
  issue_date: { type: 'date' },
  valid_until: { type: 'date' },
  currency: { type: 'text', upper: true, max: 3 },
  tier_id: { type: 'fk' },
  incoterm: { type: 'text', upper: true, max: 6 },
  incoterm_place: { type: 'text', max: 100 },
  payment_terms: { type: 'text', max: 500 },
  deposit_pct: { type: 'num', min: 0, max: 100 },
  lead_time_weeks: { type: 'num', min: 0, max: 104 },
  overage_pct: { type: 'num', min: 0, max: 100 },
  project: { type: 'text', max: 200 },
  client_ref: { type: 'text', max: 100 },
  delivery_address: { type: 'text', max: 500 },
  discount_pct: { type: 'num', min: 0, max: 100 },
  freight: { type: 'num', min: 0 },
  handling_fee: { type: 'num', min: 0 },
  vat_rate: { type: 'num', min: 0, max: 100 },
  vat_note: { type: 'text', max: 300 },
  notes: { type: 'text', max: 4000 },
  internal_notes: { type: 'text', max: 4000 },
  opportunity_id: { type: 'fk' },
};

r.get('/docs', (req, res) => {
  const type = req.query.type && TYPES.includes(req.query.type) ? req.query.type : null;
  res.json({
    rows: listDocs({
      type,
      status: req.query.status || null,
      client_id: req.query.client_id || null,
      q: String(req.query.q || '').trim() || null,
      open: req.query.open === '1',
      limit: req.query.limit,
    }),
  });
});

r.get('/docs/:id', (req, res) => res.json(docDetail(idParam(req))));

r.post('/docs', requireRole('sales'), (req, res) => {
  const type = req.body.type;
  if (!TYPES.includes(type) || type === 'credit') throw bad('Choose a document type.');
  const client = get('SELECT * FROM clients WHERE id = ?', Number(req.body.client_id));
  if (!client) throw bad('Choose a client.');
  const header = clean(HEADER_SPEC, req.body, { partial: true });
  const id = tx(() => {
    const docId = insert('sales_docs', {
      ...newDocDefaults(type, client),
      ...header,
      number: nextNumber(type),
      created_by: req.user.id,
    });
    if (Array.isArray(req.body.lines) && req.body.lines.length) saveDoc(req, docId, {}, req.body.lines);
    return docId;
  });
  audit(req, 'doc', id, 'create', `${type} for ${client.company}`);
  res.status(201).json(docDetail(id));
});

r.put('/docs/:id', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const header = clean(HEADER_SPEC, req.body, { partial: true });
  if (req.body.client_id !== undefined) {
    const doc = get('SELECT * FROM sales_docs WHERE id = ?', id);
    if (doc && Number(req.body.client_id) !== doc.client_id) {
      if (doc.status !== 'draft') throw bad('The client can only be changed on a draft.');
      if (!get('SELECT 1 FROM clients WHERE id = ?', Number(req.body.client_id))) throw bad('Client not found');
      header.client_id = Number(req.body.client_id);
    }
  }
  header.updated_at = nowTs();
  saveDoc(req, id, header, Array.isArray(req.body.lines) ? req.body.lines : undefined);
  audit(req, 'doc', id, 'update', null);
  res.json(docDetail(id));
});

r.delete('/docs/:id', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const d = get('SELECT * FROM sales_docs WHERE id = ?', id);
  if (!d) throw notFound('Document not found');
  if (d.status !== 'draft') throw bad('Only drafts can be deleted. Cancel the document instead.');
  if (get('SELECT 1 FROM sales_docs WHERE source_id = ? OR order_id = ?', id, id)) throw bad('Other documents were created from this one.');
  if (get('SELECT 1 FROM payments WHERE doc_id = ?', id)) throw bad('This document has payments.');
  tx(() => {
    run("UPDATE stock_units SET status = 'in_stock', order_line_id = NULL WHERE order_line_id IN (SELECT id FROM doc_lines WHERE doc_id = ?) AND status = 'reserved'", id);
    run('DELETE FROM sales_docs WHERE id = ?', id);
  });
  audit(req, 'doc', id, 'delete', d.number);
  res.json({ ok: true });
});

r.post('/docs/:id/status', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const d = changeStatus(req, id, String(req.body.status || ''));
  audit(req, 'doc', id, 'status', `${d.number} → ${d.status}`);
  res.json(docDetail(id));
});

r.post('/docs/:id/convert', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const newId = convertDoc(req, id, String(req.body.to || ''));
  const d = get('SELECT number, type FROM sales_docs WHERE id = ?', newId);
  audit(req, 'doc', newId, 'convert', `from #${id} → ${d.number}`);
  res.status(201).json({ id: newId, number: d.number, type: d.type });
});

r.post('/docs/:id/duplicate', requireRole('sales'), (req, res) => {
  const newId = duplicateDoc(req, idParam(req));
  res.status(201).json({ id: newId });
});

r.post('/docs/:id/send-log', requireRole('sales'), (req, res) => {
  // Records that the document was sent (email/WhatsApp happen outside the app).
  const id = idParam(req);
  const d = get('SELECT * FROM sales_docs WHERE id = ?', id);
  if (!d) throw notFound('Document not found');
  insert('activities', {
    client_id: d.client_id, opportunity_id: d.opportunity_id, doc_id: id, type: req.body.channel === 'whatsapp' ? 'whatsapp' : 'email',
    subject: `${DOC_TYPES[d.type].label} ${d.number} sent`, body: req.body.note || null, done: 1, done_at: nowTs(), user_id: req.user.id,
  });
  if (d.type === 'quote' && d.status === 'draft') changeStatus(req, id, 'sent');
  if (['proforma', 'invoice', 'credit'].includes(d.type) && d.status === 'draft') changeStatus(req, id, 'issued');
  res.json(docDetail(id));
});

// ---- gates before production ----
r.post('/docs/:id/gates', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const d = get("SELECT * FROM sales_docs WHERE id = ? AND type = 'order'", id);
  if (!d) throw notFound('Order not found');
  const v = clean({ colour_approved_at: { type: 'date' }, deposit_received_at: { type: 'date' } }, req.body, { partial: true });
  update('sales_docs', id, { ...v, updated_at: nowTs() });
  refreshPromised(id);
  if (v.colour_approved_at) {
    insert('activities', { client_id: d.client_id, doc_id: id, type: 'note', subject: `Written colour approval received for ${d.number}`, done: 1, done_at: nowTs(), user_id: req.user.id });
  }
  audit(req, 'doc', id, 'gates', JSON.stringify(v));
  res.json(docDetail(id));
});

// ---- payments ----
const PAY_SPEC = {
  date: { type: 'date', required: true },
  amount: { type: 'num', required: true, min: 0.01 },
  kind: { type: 'enum', values: ['deposit', 'balance', 'payment', 'refund'], default: 'payment' },
  method: { type: 'text', default: 'bank_transfer' },
  reference: { type: 'text' },
  notes: { type: 'text' },
};

r.post('/docs/:id/payments', requireRole('sales'), (req, res) => {
  const id = idParam(req);
  const d = get('SELECT * FROM sales_docs WHERE id = ?', id);
  if (!d) throw notFound('Document not found');
  if (d.type === 'quote') throw bad('Record payments on the order, proforma or invoice.');
  if (d.status === 'cancelled') throw bad('This document is cancelled.');
  const v = clean(PAY_SPEC, req.body);
  const target = paymentTarget(d);
  const currency = get('SELECT currency FROM sales_docs WHERE id = ?', target).currency;
  insert('payments', { ...v, doc_id: target, currency, reference: v.reference || (target !== id ? d.number : null), created_by: req.user.id });
  afterPaymentChange(req, target);
  audit(req, 'payment', target, 'create', `${v.amount} ${currency}`);
  res.status(201).json(docDetail(id));
});

r.delete('/payments/:id', requireRole('sales'), (req, res) => {
  const p = get('SELECT * FROM payments WHERE id = ?', idParam(req));
  if (!p) throw notFound('Payment not found');
  run('DELETE FROM payments WHERE id = ?', p.id);
  const doc = get('SELECT * FROM sales_docs WHERE id = ?', p.doc_id);
  if (doc?.type === 'order' && doc.deposit_received_at) {
    // the deposit gate may no longer be met
    const paid = get('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE doc_id = ?', doc.id).s;
    if (paid < (doc.total * (doc.deposit_pct || 0)) / 100 - 0.005) update('sales_docs', doc.id, { deposit_received_at: null, promised_date: null });
  }
  afterPaymentChange(req, p.doc_id);
  audit(req, 'payment', p.doc_id, 'delete', `${p.amount} ${p.currency}`);
  res.json({ ok: true });
});

// ---- order fulfilment ----
r.get('/orders/:id/fulfilment', (req, res) => res.json({ lines: orderFulfilment(idParam(req)) }));

r.post('/orders/:id/release', requireRole('sales', 'production'), (req, res) => {
  const id = idParam(req);
  const results = releaseOrder(req, id, { force: !!req.body.force, allowMultiLot: !!req.body.allow_multi_lot });
  audit(req, 'doc', id, 'release', results.map((x) => `${x.sku}:${x.action}`).join(', '));
  res.json({ results, doc: docDetail(id) });
});

r.post('/orders/:id/allocate', requireRole('sales', 'warehouse'), (req, res) => {
  const id = idParam(req);
  const lineIds = req.body.line_id
    ? [Number(req.body.line_id)]
    : all("SELECT dl.id FROM doc_lines dl WHERE dl.doc_id = ? AND dl.boxes > 0", id).map((l) => l.id);
  const results = lineIds.map((lid) => ({ line_id: lid, ...allocateLine(req, lid, { allowMultiLot: !!req.body.allow_multi_lot, pools: req.body.include_reserve ? ['general', 'export_reserve'] : ['general'] }) }));
  res.json({ results, doc: docDetail(id) });
});

r.post('/orders/:id/unallocate', requireRole('sales', 'warehouse'), (req, res) => {
  const id = idParam(req);
  const lineId = Number(req.body.line_id);
  const order = get('SELECT number FROM sales_docs WHERE id = ?', id);
  const units = all("SELECT u.id FROM stock_units u JOIN doc_lines dl ON dl.id = u.order_line_id WHERE dl.doc_id = ? AND (? = 0 OR dl.id = ?) AND u.status IN ('reserved','picked')", id, lineId || 0, lineId || 0);
  tx(() => units.forEach((u) => unreserveUnit(req, u.id, order?.number)));
  res.json({ released: units.length, doc: docDetail(id) });
});

r.get('/orders/:id/availability', (req, res) => {
  const id = idParam(req);
  const lines = all('SELECT dl.id, dl.product_id, dl.boxes, p.sku FROM doc_lines dl JOIN products p ON p.id = dl.product_id WHERE dl.doc_id = ? AND dl.boxes > 0', id);
  res.json({ lines: lines.map((l) => ({ ...l, lots: availableByLot(l.product_id, { pools: ['general', 'export_reserve'] }) })) });
});

r.get('/orders/:id/picklist', (req, res) => {
  const id = idParam(req);
  const order = get(`SELECT d.*, c.company AS client_name FROM sales_docs d JOIN clients c ON c.id = d.client_id WHERE d.id = ?`, id);
  if (!order) throw notFound('Order not found');
  res.json({ order, units: pickList(id) });
});

export default r;
