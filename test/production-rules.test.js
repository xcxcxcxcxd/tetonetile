// Production-cycle rules: QC holds and re-releasing an order, cancelled orders,
// and what visitors can read from the knowledge base through a QR label.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootWithAdmin, ok } from './helpers.js';

let api;
const ctx = {};

before(async () => {
  api = await bootWithAdmin();
  ctx.client = ok(await api.post('/api/clients', { company: 'Rules Test Studio', type: 'trade', currency: 'EUR', region: 'EU' }), 201);
});
after(async () => {
  await api.close();
});

const product = async (sku) => ok(await api.get(`/api/products?q=${sku}`)).rows.find((p) => p.sku === sku);

/** A confirmed order with both gates recorded, released to production. Returns { order, moId }. */
async function orderInProduction(sku, boxes) {
  const p = await product(sku);
  const order = ok(await api.post('/api/docs', { type: 'order', client_id: ctx.client.id, lines: [{ product_id: p.id, unit: 'box', qty: boxes, unit_price: 40 }] }), 201);
  ok(await api.post(`/api/docs/${order.id}/status`, { status: 'confirmed' }));
  ok(await api.post(`/api/docs/${order.id}/gates`, { colour_approved_at: '2026-05-01', deposit_received_at: '2026-05-02' }));
  const rel = ok(await api.post(`/api/orders/${order.id}/release`, {}));
  assert.equal(rel.results[0].action, 'produce');
  return { order, moId: rel.results[0].mo_id };
}

/** Records every stage of an MO with no scrap, up to (not including) `stopAt`. */
async function produce(moId, { stopAt = null, qcFail = false } = {}) {
  const mo = ok(await api.get(`/api/mos/${moId}`));
  if (mo.mo.status === 'planned') ok(await api.post(`/api/mos/${moId}/release`));
  for (const { stage } of mo.progress.routing) {
    if (stage.code === stopAt) return;
    const st = ok(await api.get(`/api/mos/${moId}`)).progress.routing.find((x) => x.stage.id === stage.id);
    if (st.done) continue;
    const n = st.waiting;
    if (stage.is_kiln) {
      const kilnId = ok(await api.get('/api/kiln-overview')).kilns[0].id;
      const load = ok(await api.post('/api/kiln-loads', { kiln_id: kilnId }), 201).load;
      ok(await api.post(`/api/kiln-loads/${load.id}/items`, { mo_id: moId, pcs: n }));
      ok(await api.post(`/api/kiln-loads/${load.id}/status`, { status: 'firing' }));
      ok(await api.post(`/api/kiln-loads/${load.id}/status`, { status: 'cooling' }));
      const item = ok(await api.get(`/api/kiln-loads/${load.id}`)).load.items[0];
      ok(await api.post(`/api/kiln-loads/${load.id}/unload`, { items: [{ item_id: item.id, pcs_good: n, pcs_defect: 0, complete: true }] }));
    } else if (stage.is_qc) {
      const qc = qcFail ? { colour_var: 4, matches_reference: 0, inspector: 'Test' } : { colour_var: 2, matches_reference: 1, inspector: 'Test' };
      ok(await api.post(`/api/mos/${moId}/log`, { stage_id: stage.id, grade_a: n, grade_b: 0, rejects: 0, completes_stage: true, qc }));
    } else if (stage.is_packing) {
      ok(await api.post(`/api/mos/${moId}/log`, { stage_id: stage.id, completes_stage: true }));
    } else {
      ok(await api.post(`/api/mos/${moId}/log`, { stage_id: stage.id, qty_good: n, completes_stage: true }));
    }
  }
}

test('a lot held at QC goes to quarantine unreserved; re-releasing the order starts a new lot', async () => {
  const { order, moId } = await orderInProduction('ZR10-25', 10);
  await produce(moId, { qcFail: true });
  const mo = ok(await api.get(`/api/mos/${moId}`));
  assert.equal(mo.mo.status, 'completed');
  assert.equal(mo.mo.lot_status, 'hold', 'the lot stays on hold after completion');
  assert.ok(mo.units.length > 0);
  for (const u of mo.units) {
    assert.equal(u.status, 'hold');
    assert.equal(u.order_line_id, null, 'held pallets are not reserved');
    assert.match(u.location_code, /^TET-Q/, 'held pallets go to quarantine');
  }
  const fulfil = ok(await api.get(`/api/orders/${order.id}/fulfilment`)).lines[0];
  assert.equal(fulfil.reserved, 0);
  const again = ok(await api.post(`/api/orders/${order.id}/release`, {}));
  assert.equal(again.results[0].action, 'produce', 'a finished but unusable batch does not count as planned');
  assert.notEqual(again.results[0].mo_id, moId);
});

test('releasing a held lot reserves its pallets for the order; unreserve gives them back', async () => {
  const { order, moId } = await orderInProduction('ZR10-14', 8);
  await produce(moId, { qcFail: true });
  const lotId = ok(await api.get(`/api/mos/${moId}`)).mo.lot_id;
  ok(await api.post(`/api/lots/${lotId}/release`, { notes: 'Client approved the shade in writing' }));
  let fulfil = ok(await api.get(`/api/orders/${order.id}/fulfilment`)).lines[0];
  assert.equal(fulfil.reserved, 8);
  const un = ok(await api.post(`/api/orders/${order.id}/unallocate`, { line_id: fulfil.line_id }));
  assert.ok(un.released >= 1);
  fulfil = ok(await api.get(`/api/orders/${order.id}/fulfilment`)).lines[0];
  assert.equal(fulfil.reserved, 0);
});

test('pallets of a batch finished after its order was cancelled stay free stock', async () => {
  const { order, moId } = await orderInProduction('ZR10-39', 6);
  await produce(moId, { stopAt: 'SHAPE' }); // in progress
  ok(await api.post(`/api/docs/${order.id}/status`, { status: 'cancelled' }));
  assert.equal(ok(await api.get(`/api/mos/${moId}`)).mo.status, 'in_progress', 'work in progress is not thrown away');
  await produce(moId);
  const units = ok(await api.get(`/api/mos/${moId}`)).units;
  assert.ok(units.length > 0);
  for (const u of units) {
    assert.equal(u.status, 'in_stock');
    assert.equal(u.order_line_id, null);
  }
});

test('visitors can read the public installation guide from its QR, not internal procedures', async () => {
  api.clearCookie();
  const r = ok(await api.get('/api/resolve/KB-installation-care'));
  assert.equal(r.type, 'article');
  assert.equal(r.url, null, 'visitors are not sent into the app');
  assert.equal(r.public.article, 'installation-care');
  ok(await api.get('/api/knowledge/installation-care'));
  assert.equal((await api.get('/api/knowledge/production-cycle')).status, 401);
  const list = ok(await api.get('/api/knowledge')).rows;
  assert.ok(list.length > 0 && list.every((a) => a.public));
  const internal = ok(await api.get('/api/resolve/KB-production-cycle'));
  assert.equal(internal.needsLogin, true);
  ok(await api.post('/api/auth/login', { email: 'admin@example.com', password: 'secret123' }));
  const staff = ok(await api.get('/api/resolve/KB-production-cycle'));
  assert.equal(staff.url, '/knowledge/production-cycle');
});
