// End-to-end: quote -> order -> gates -> production (kiln, QC, packing) -> reservation
// -> putaway -> shipment loading by scan -> shipped -> invoice and payments.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootWithAdmin, ok } from './helpers.js';

let api;
const ctx = {};

before(async () => {
  api = await bootWithAdmin();
});
after(async () => {
  await api.close();
});

test('catalogue: products exist with swatch images and costs can be set', async () => {
  const list = ok(await api.get('/api/products?q=ZR10-03'));
  assert.equal(list.rows.length, 1);
  ctx.product = list.rows[0];
  assert.equal(ctx.product.m2_per_box, 1);
  const svg = await api.get(`/api/products/${ctx.product.id}/swatch.svg`);
  assert.equal(svg.status, 200);
  assert.match(String(svg.data), /<svg/);
  ok(await api.put(`/api/products/${ctx.product.id}`, { cost: 350 }));
});

test('client gets the wholesale tier from its type', async () => {
  const c = ok(await api.post('/api/clients', { company: 'Atelier Test', type: 'wholesale', currency: 'EUR', region: 'EU', country: 'France', contact_name: 'Ana' }), 201);
  ctx.client = c;
  assert.ok(c.tier_id);
  assert.match(c.code, /^C\d{4}$/);
});

test('quote computes overage, boxes, weight, price and packing', async () => {
  const price = ok(await api.get(`/api/pricing?product_id=${ctx.product.id}&tier_id=${ctx.client.tier_id}&currency=EUR`));
  assert.equal(price.source, 'computed');
  assert.equal(price.price, 40.51); // 350 MAD x 1.25 / 10.8
  const q = ok(
    await api.post('/api/docs', {
      type: 'quote',
      client_id: ctx.client.id,
      project: 'Riad bathroom',
      lines: [
        { product_id: ctx.product.id, net_qty: 250, unit: 'm2', unit_price: price.price },
        { description: 'Sample box (4 colours x 25 pcs)', unit: 'unit', qty: 1, unit_price: 45 },
      ],
    }),
    201,
  );
  ctx.quote = q;
  assert.match(q.number, /^Q-\d{4}-\d{4}$/);
  const l = q.lines[0];
  assert.equal(l.boxes, 288);
  assert.equal(l.qty, 288);
  assert.equal(l.weight_kg, 5760);
  assert.match(l.image_url, /\/api\/products\/\d+\/image/);
  assert.equal(q.totals.linesTotal, 288 * 40.51 + 45);
  assert.equal(q.vat_rate, 0);
  assert.equal(q.packing.pallets, 4);
  assert.equal(q.packing.suggestion.mode, 'groupage'); // up to 3-4 pallets ships by groupage
  assert.equal(q.tier_check, null);
});

test('saving lines again does not compound the overage', async () => {
  const again = ok(await api.put(`/api/docs/${ctx.quote.id}`, { lines: ctx.quote.lines.map((l) => ({ ...l })) }));
  assert.equal(again.lines[0].boxes, 288);
  assert.equal(again.lines[0].id, ctx.quote.lines[0].id);
});

test('quote converts to an order; the order waits for colour approval and deposit', async () => {
  const conv = ok(await api.post(`/api/docs/${ctx.quote.id}/convert`, { to: 'order' }), 201);
  const order = ok(await api.get(`/api/docs/${conv.id}`));
  ctx.order = order;
  assert.equal(order.status, 'confirmed');
  assert.deepEqual(order.gates_missing, ['colour', 'deposit']);
  const quote = ok(await api.get(`/api/docs/${ctx.quote.id}`));
  assert.equal(quote.status, 'accepted');
  const blocked = await api.post(`/api/orders/${order.id}/release`, {});
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'gates');
});

test('deposit payment opens the gate and sets the promised date', async () => {
  ok(await api.post(`/api/docs/${ctx.order.id}/gates`, { colour_approved_at: '2026-01-05' }));
  const deposit = Math.round(ctx.order.total * 0.5 * 100) / 100;
  const d = ok(await api.post(`/api/docs/${ctx.order.id}/payments`, { date: '2026-01-10', amount: deposit, kind: 'deposit' }), 201);
  assert.equal(d.deposit_received_at, '2026-01-10');
  assert.equal(d.promised_date, '2026-04-04'); // 12 weeks from 2026-01-10
  assert.deepEqual(d.gates_missing, []);
});

test('release creates one MO + lot for the tile line (no stock yet)', async () => {
  const rel = ok(await api.post(`/api/orders/${ctx.order.id}/release`, {}));
  const produce = rel.results.find((x) => x.action === 'produce');
  assert.ok(produce, JSON.stringify(rel.results));
  assert.equal(produce.boxes, 288);
  ctx.moId = produce.mo_id;
  assert.equal(rel.doc.status, 'in_production');
  const mo = ok(await api.get(`/api/mos/${ctx.moId}`));
  assert.equal(mo.mo.target_pcs, 31680);
  assert.match(mo.mo.lot_code, /^L\d{2}-\d{4}$/);
  assert.deepEqual(
    mo.progress.routing.map((s) => s.stage.code),
    ['CLAY', 'SHAPE', 'DRY', 'GLAZE', 'FIRE', 'CHISEL', 'SORT', 'PACK'],
  );
  ctx.stages = Object.fromEntries(mo.progress.routing.map((s) => [s.stage.code, s.stage.id]));
});

test('stage logging enforces piece balances', async () => {
  const notReleased = await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.CLAY, qty_good: 10 });
  assert.equal(notReleased.status, 400);
  ok(await api.post(`/api/mos/${ctx.moId}/release`));
  ok(await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.CLAY, qty_good: 31680, completes_stage: true }));
  const tooMany = await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.SHAPE, qty_good: 40000 });
  assert.equal(tooMany.status, 400);
  ok(await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.SHAPE, qty_good: 31000, qty_scrap: 300 }));
  const unfinished = await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.SHAPE, qty_good: 0, completes_stage: true });
  assert.equal(unfinished.status, 409);
  assert.equal(unfinished.data.remaining, 380);
  ok(await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.SHAPE, qty_good: 0, completes_stage: true, close_remaining: true }));
  ok(await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.DRY, qty_good: 31000, completes_stage: true }));
  ok(await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.GLAZE, qty_good: 30900, qty_scrap: 100, completes_stage: true }));
});

test('kiln capacity: a load bigger than the kiln is refused unless confirmed', async () => {
  const kilns = ok(await api.get('/api/kiln-overview'));
  assert.equal(kilns.ready.find((r) => r.id === ctx.moId).waiting, 30900);
  const load = ok(await api.post('/api/kiln-loads', { kiln_id: kilns.kilns[0].id }), 201).load;
  const tooBig = await api.post(`/api/kiln-loads/${load.id}/items`, { mo_id: ctx.moId, pcs: 30900 });
  assert.equal(tooBig.status, 409);
  assert.equal(tooBig.data.code, 'over_capacity');
  assert.equal(tooBig.data.fit, 6000); // 60 m2 x 100 pcs/m2
  const second = await api.post('/api/kiln-loads', { kiln_id: kilns.kilns[0].id });
  assert.equal(second.status, 400, 'one open load per kiln');
  ctx.firstLoad = load.id;
});

test('kiln loads: a big batch is fired over several loads; unloading writes the firing stage', async () => {
  // 30 900 pieces in a 60 m2 kiln: 5 full loads of 6 000 and one of 900, 400 defective in total.
  const plan = [[6000, 70], [6000, 70], [6000, 70], [6000, 70], [6000, 70], [900, 50]];
  const kilnId = ok(await api.get('/api/kiln-overview')).kilns[0].id;
  for (const [i, [pcs, defect]] of plan.entries()) {
    const loadId = i === 0 ? ctx.firstLoad : ok(await api.post('/api/kiln-loads', { kiln_id: kilnId }), 201).load.id;
    ok(await api.post(`/api/kiln-loads/${loadId}/items`, { mo_id: ctx.moId, pcs }));
    ok(await api.post(`/api/kiln-loads/${loadId}/status`, { status: 'firing', fuel_kg: 500 }));
    ok(await api.post(`/api/kiln-loads/${loadId}/status`, { status: 'cooling', peak_temp_c: 980 }));
    const detail = ok(await api.get(`/api/kiln-loads/${loadId}`)).load;
    ok(await api.post(`/api/kiln-loads/${loadId}/unload`, { items: [{ item_id: detail.items[0].id, pcs_good: pcs - defect, pcs_defect: defect, complete: true }] }));
    const fire = ok(await api.get(`/api/mos/${ctx.moId}`)).progress.routing.find((s) => s.stage.code === 'FIRE');
    assert.equal(fire.done, i === plan.length - 1, 'the firing stage closes only with the last pieces');
  }
  const mo = ok(await api.get(`/api/mos/${ctx.moId}`));
  const fire = mo.progress.routing.find((s) => s.stage.code === 'FIRE');
  assert.equal(fire.good, 30500);
  assert.equal(fire.scrap, 400);
  assert.equal(mo.kiln_loads.length, 6);
});

test('sorting with QC inside the standard, then packing creates pallets reserved for the order', async () => {
  ok(await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.CHISEL, qty_good: 30200, qty_scrap: 300, completes_stage: true }));
  const sort = ok(
    await api.post(`/api/mos/${ctx.moId}/log`, {
      stage_id: ctx.stages.SORT, grade_a: 29050, grade_b: 1000, rejects: 150, completes_stage: true,
      qc: { colour_var: 3, texture_var: 3, size_var: 3, pits_chips: 2, crazing: 2, iron_spots: 1, matches_reference: 1 },
    }),
  );
  assert.equal(sort.qc.result, 'pass');
  const pack = ok(await api.post(`/api/mos/${ctx.moId}/log`, { stage_id: ctx.stages.PACK, completes_stage: true }));
  assert.equal(pack.completed, true);
  const mo = ok(await api.get(`/api/mos/${ctx.moId}`));
  assert.equal(mo.mo.status, 'completed');
  const a = mo.units.filter((u) => u.grade === 'A');
  const b = mo.units.filter((u) => u.grade === 'B');
  assert.equal(a.reduce((s, u) => s + u.boxes, 0), 290);
  assert.equal(b.reduce((s, u) => s + u.boxes, 0), 10);
  const reserved = a.filter((u) => u.status === 'reserved').reduce((s, u) => s + u.boxes, 0);
  assert.equal(reserved, 288);
  assert.ok(a.every((u) => u.location_code === 'TET-IN01'));
  const order = ok(await api.get(`/api/docs/${ctx.order.id}`));
  assert.equal(order.status, 'ready');
  assert.equal(order.fulfilment[0].state, 'ready');
  assert.equal(order.fulfilment[0].multi_lot, false);
  ctx.units = a;
  ctx.gradeB = b[0];
});

test('putaway suggestions and capacity-checked moves', async () => {
  const unit = ctx.units[0];
  const sug = ok(await api.get(`/api/stock/units/${unit.id}/putaway`)).suggestions;
  assert.ok(sug.length > 0);
  assert.ok(['rack', 'floor'].includes(sug[0].zone_kind));
  ok(await api.post(`/api/stock/units/${unit.id}/move`, { location_code: 'A01-1A' }));
  const full = await api.post(`/api/stock/units/${ctx.units[1].id}/move`, { location_code: 'TET-A01-1A' });
  assert.equal(full.status, 409);
  assert.equal(full.data.code, 'over_capacity');
  const next = ok(await api.get(`/api/stock/units/${ctx.units[1].id}/putaway`)).suggestions;
  assert.notEqual(next[0].label, 'A01-1A');
  ok(await api.post(`/api/stock/units/${ctx.units[1].id}/move`, { location_id: next[0].id }));
  const map = ok(await api.get('/api/warehouse/map'));
  const cell = map.cells.find((c) => c.label === 'A01-1A');
  assert.equal(cell.used, 1);
  assert.equal(cell.units[0].hex, '#a5372a');
});

test('QR resolve finds pallets, locations, lots and gives installers public product info', async () => {
  const unit = ctx.units[0];
  const r1 = ok(await api.get(`/api/resolve/${encodeURIComponent(`http://factory.local/q/${unit.code}`)}`));
  assert.equal(r1.type, 'unit');
  const r2 = ok(await api.get('/api/resolve/A01-1A'));
  assert.equal(r2.type, 'location');
  const lotCode = unit.lot_code;
  api.clearCookie();
  const pub = ok(await api.get(`/api/resolve/${lotCode}`));
  assert.equal(pub.type, 'lot');
  assert.equal(pub.public.product.sku, 'ZR10-03');
  assert.equal(pub.unit, undefined);
  const hidden = ok(await api.get(`/api/resolve/${unit.code}`));
  assert.equal(hidden.needsLogin, true);
  const denied = await api.get('/api/clients');
  assert.equal(denied.status, 401);
  ok(await api.post('/api/auth/login', { email: 'admin@example.com', password: 'secret123' }));
});

test('loading by scan accepts only this order\'s pallets; shipping updates the order', async () => {
  const sh = ok(await api.post('/api/shipments', { client_id: ctx.client.id, mode: 'container_20', order_ids: [ctx.order.id] }), 201);
  assert.ok(sh.docs.some((d) => d.code === 'eur1'), 'EU pack includes EUR.1');
  assert.equal(sh.units.length, 4);
  const wrong = ok(await api.post(`/api/shipments/${sh.id}/load`, { code: ctx.gradeB.code }));
  assert.equal(wrong.ok, false);
  for (const u of sh.units) {
    const res = ok(await api.post(`/api/shipments/${sh.id}/load`, { code: `http://x/q/${u.code}` }));
    assert.equal(res.ok, true, res.message);
  }
  const again = ok(await api.post(`/api/shipments/${sh.id}/load`, { code: sh.units[0].code }));
  assert.equal(again.already, true);
  const blocked = await api.post(`/api/shipments/${sh.id}/status`, { status: 'shipped' });
  assert.equal(blocked.status, 409);
  ok(await api.put(`/api/shipments/${sh.id}`, { seal_no: 'ml123', container_no: 'MSKU1234567' }));
  const shipped = ok(await api.post(`/api/shipments/${sh.id}/status`, { status: 'shipped', force: true }));
  assert.equal(shipped.status, 'shipped');
  assert.equal(shipped.seal_no, 'ML123');
  const order = ok(await api.get(`/api/docs/${ctx.order.id}`));
  assert.equal(order.status, 'shipped');
  const pl = ok(await api.get(`/api/shipments/${sh.id}/packing-list`));
  assert.equal(pl.rows.length, 4);
  assert.equal(pl.totals.boxes, 288);
});

test('invoice from order: deposit counts, balance settles it', async () => {
  const conv = ok(await api.post(`/api/docs/${ctx.order.id}/convert`, { to: 'invoice' }), 201);
  ok(await api.post(`/api/docs/${conv.id}/status`, { status: 'issued' }));
  let inv = ok(await api.get(`/api/docs/${conv.id}`));
  assert.equal(inv.status, 'partially_paid');
  assert.ok(Math.abs(inv.paid - inv.total / 2) < 0.02);
  const locked = await api.put(`/api/docs/${conv.id}`, { discount_pct: 5 });
  assert.equal(locked.status, 409);
  inv = ok(await api.post(`/api/docs/${conv.id}/payments`, { date: '2026-04-20', amount: inv.totals.balance, kind: 'balance' }), 201);
  assert.equal(inv.status, 'paid');
  assert.equal(inv.totals.balance, 0);
});

test('allocation keeps a line on one lot, warns when lots are mixed', async () => {
  // two lots of 50 boxes each in stock, an order line for 80 boxes
  const p = ctx.product;
  ok(await api.post('/api/stock/units', { kind: 'pallet', product_id: p.id, lot_code: 'L26-9001', boxes: 50, location_code: 'B01-1' }), 201);
  ok(await api.post('/api/stock/units', { kind: 'pallet', product_id: p.id, lot_code: 'L26-9002', boxes: 50, location_code: 'B01-2' }), 201);
  const o = ok(await api.post('/api/docs', { type: 'order', client_id: ctx.client.id, lines: [{ product_id: p.id, unit: 'box', qty: 80, unit_price: 40 }] }), 201);
  ok(await api.post(`/api/docs/${o.id}/status`, { status: 'confirmed' }));
  const single = ok(await api.post(`/api/orders/${o.id}/allocate`, {}));
  assert.equal(single.results[0].ok, false);
  assert.equal(single.results[0].reason, 'no_single_lot');
  const multi = ok(await api.post(`/api/orders/${o.id}/allocate`, { allow_multi_lot: true }));
  assert.equal(multi.results[0].ok, true);
  assert.equal(multi.results[0].warnings.length, 1);
  assert.equal(multi.doc.fulfilment[0].multi_lot, true);
});

test('cycle count moves found units and flags missing ones', async () => {
  const loc = ok(await api.get('/api/resolve/B01-1'));
  const detail = ok(await api.get(`/api/locations/${loc.id}/detail`));
  const here = detail.units.map((u) => u.code);
  assert.ok(here.length >= 1);
  const res = ok(await api.post('/api/stock/count', { location_code: 'B01-1', found: [] }));
  assert.deepEqual(res.missing.sort(), here.sort());
  const back = ok(await api.post('/api/stock/count', { location_code: 'B01-1', found: here.map((code) => ({ code })) }));
  assert.equal(back.moved.length, here.length);
});

test('dashboard and search respond', async () => {
  const d = ok(await api.get('/api/dashboard'));
  assert.ok(d.kpis);
  assert.ok(Array.isArray(d.attention));
  const s = ok(await api.get('/api/search?q=ZR10-03'));
  assert.equal(s.exact.type, 'product');
});

test('roles: a viewer cannot create quotes', async () => {
  ok(await api.post('/api/users', { name: 'View', email: 'view@example.com', password: 'secret123', role: 'viewer' }), 201);
  api.clearCookie();
  ok(await api.post('/api/auth/login', { email: 'view@example.com', password: 'secret123' }));
  const r = await api.post('/api/docs', { type: 'quote', client_id: ctx.client.id });
  assert.equal(r.status, 403);
  const csrf = await api.raw('POST', '/api/auth/logout', undefined);
  assert.equal(csrf.status, 200);
});
