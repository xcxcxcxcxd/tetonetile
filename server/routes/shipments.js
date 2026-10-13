import { Router } from 'express';
import { all, get, update, run, nowTs } from '../db.js';
import { requireRole } from '../auth.js';
import { clean } from '../lib/validate.js';
import { bad, idParam, notFound } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { createShipment, addOrder, shipmentDetail, loadScan, unloadUnit, setShipmentStatus, packingList } from '../services/shipments.js';
import { lotTrace } from '../services/production.js';

const r = Router();

const SPEC = {
  client_id: { type: 'fk' },
  mode: { type: 'enum', values: ['container_20', 'container_40', 'groupage', 'courier', 'pickup'] },
  region: { type: 'enum', values: ['US', 'EU', 'UK', 'GCC', 'MA', 'OTHER'] },
  incoterm: { type: 'text', upper: true }, incoterm_place: { type: 'text' }, forwarder: { type: 'text' }, booking_ref: { type: 'text' },
  container_no: { type: 'text', upper: true }, seal_no: { type: 'text', upper: true }, bl_no: { type: 'text', upper: true }, vessel: { type: 'text' },
  port_loading: { type: 'text' }, port_discharge: { type: 'text' }, ready_date: { type: 'date' }, etd: { type: 'date' }, eta: { type: 'date' },
  max_payload_kg: { type: 'num', min: 0 }, notes: { type: 'text' },
};

r.get('/shipments', (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status === 'open') where.push("s.status NOT IN ('shipped','delivered','cancelled')");
  else if (req.query.status) {
    where.push('s.status = ?');
    params.push(req.query.status);
  }
  res.json({
    rows: all(
      `SELECT s.*, c.company AS client_name,
         (SELECT GROUP_CONCAT(d.number, ', ') FROM shipment_orders so JOIN sales_docs d ON d.id = so.order_id WHERE so.shipment_id = s.id) AS orders,
         (SELECT COUNT(*) FROM stock_units u WHERE u.shipment_id = s.id AND u.parent_id IS NULL) AS loaded_units,
         (SELECT COUNT(*) FROM shipment_docs sd WHERE sd.shipment_id = s.id) AS docs_total,
         (SELECT COUNT(*) FROM shipment_docs sd WHERE sd.shipment_id = s.id AND sd.status IN ('ready','sent','na')) AS docs_done
       FROM shipments s LEFT JOIN clients c ON c.id = s.client_id WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT 300`,
      ...params,
    ),
  });
});

r.get('/shipments/:id', (req, res) => res.json(shipmentDetail(idParam(req))));

r.post('/shipments', requireRole('sales', 'warehouse'), (req, res) => {
  const v = clean(SPEC, req.body, { partial: true });
  const id = createShipment(req, { ...v, order_ids: (req.body.order_ids || []).map(Number).filter(Boolean) });
  audit(req, 'shipment', id, 'create', null);
  res.status(201).json(shipmentDetail(id));
});

r.put('/shipments/:id', requireRole('sales', 'warehouse'), (req, res) => {
  const id = idParam(req);
  if (!get('SELECT 1 FROM shipments WHERE id = ?', id)) throw notFound('Shipment not found');
  update('shipments', id, clean(SPEC, req.body, { partial: true }));
  res.json(shipmentDetail(id));
});

r.post('/shipments/:id/orders', requireRole('sales', 'warehouse'), (req, res) => {
  const id = idParam(req);
  addOrder(id, Number(req.body.order_id));
  res.json(shipmentDetail(id));
});

r.delete('/shipments/:id/orders/:orderId', requireRole('sales', 'warehouse'), (req, res) => {
  const id = idParam(req);
  const orderId = Number(req.params.orderId);
  if (get("SELECT 1 FROM stock_units u JOIN doc_lines dl ON dl.id = u.order_line_id WHERE dl.doc_id = ? AND u.shipment_id = ? LIMIT 1", orderId, id)) {
    throw bad('Unload this order\'s pallets first.');
  }
  run('DELETE FROM shipment_orders WHERE shipment_id = ? AND order_id = ?', id, orderId);
  res.json(shipmentDetail(id));
});

r.post('/shipments/:id/load', requireRole('warehouse', 'sales'), (req, res) => {
  const id = idParam(req);
  const result = loadScan(req, id, req.body.code);
  res.json(result);
});

r.post('/shipments/:id/unload', requireRole('warehouse'), (req, res) => {
  const id = idParam(req);
  unloadUnit(req, id, Number(req.body.unit_id));
  res.json(shipmentDetail(id));
});

r.post('/shipments/:id/status', requireRole('warehouse', 'sales'), (req, res) => {
  const id = idParam(req);
  setShipmentStatus(req, id, String(req.body.status || ''), { force: !!req.body.force });
  audit(req, 'shipment', id, 'status', req.body.status);
  res.json(shipmentDetail(id));
});

r.put('/shipment-docs/:id', requireRole('sales', 'warehouse'), (req, res) => {
  const id = idParam(req);
  const d = get('SELECT * FROM shipment_docs WHERE id = ?', id);
  if (!d) throw notFound();
  const v = clean({ status: { type: 'enum', values: ['todo', 'ready', 'sent', 'na'] }, notes: { type: 'text' }, attachment_id: { type: 'fk' } }, req.body, { partial: true });
  update('shipment_docs', id, { ...v, updated_at: nowTs() });
  res.json(shipmentDetail(d.shipment_id));
});

r.get('/shipments/:id/packing-list', (req, res) => res.json(packingList(idParam(req))));

/** Batch production records for every lot in the shipment (US origin file, claims). */
r.get('/shipments/:id/origin-file', (req, res) => {
  const d = shipmentDetail(idParam(req));
  const lots = all(`SELECT id FROM lots WHERE code IN (${d.lots.map(() => '?').join(',') || "''"})`, ...d.lots);
  res.json({ shipment: d, lots: lots.map((l) => lotTrace(l.id)) });
});

export default r;
