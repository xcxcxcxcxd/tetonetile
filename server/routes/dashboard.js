import { Router } from 'express';
import { all, get, today } from '../db.js';
import { getSettings } from '../lib/settings.js';
import { convert, round2, addDays } from '../../shared/calc.js';
import { OPP_STAGES } from '../../shared/constants.js';
import { listDocs } from '../services/docs.js';
import { board, requirements } from '../services/production.js';
import { resolveCode } from './qr.js';

const r = Router();

r.get('/dashboard', (req, res) => {
  const s = getSettings();
  const cur = s.defaults.currency || 'EUR';
  const toCur = (amount, from) => round2(convert(amount, from, cur, s.rates) ?? 0);
  const t = today();
  const in7 = addDays(t, 7);
  const in14 = addDays(t, 14);

  const quotes = listDocs({ type: 'quote', limit: 2000 }).filter((d) => ['draft', 'sent'].includes(d.display_status));
  const orders = listDocs({ type: 'order', limit: 2000 }).filter((d) => !['cancelled', 'closed', 'delivered', 'draft'].includes(d.status));
  const invoices = listDocs({ type: 'invoice', limit: 5000 }).filter((d) => ['issued', 'partially_paid'].includes(d.status));
  const prod = board();
  const reqs = requirements();
  const lowMaterials = all(
    `SELECT m.id, m.code, m.name, m.unit, m.min_stock,
       (SELECT COALESCE(SUM(u.qty), 0) FROM stock_units u WHERE u.material_id = m.id AND u.status IN ('in_stock','reserved','picked','hold')) AS stock
     FROM materials m WHERE m.active = 1 AND m.min_stock > 0`,
  ).filter((m) => m.stock < m.min_stock);

  const attention = [];
  const push = (tone, title, detail, url, kind) => attention.push({ tone, title, detail, url, kind });

  for (const o of orders.filter((o) => o.gates_missing.length)) {
    const what = o.gates_missing.map((g) => (g === 'colour' ? 'written colour approval' : 'deposit')).join(' + ');
    push('warning', `${o.number} waiting for ${what}`, `${o.client_name} · production cannot start`, `/docs/${o.id}`, 'gate');
  }
  for (const o of orders.filter((o) => o.status === 'ready')) push('success', `${o.number} is ready to ship`, `${o.client_name} · plan the shipment`, `/docs/${o.id}`, 'ready');
  for (const inv of invoices.filter((d) => d.display_status === 'overdue')) {
    push('danger', `${inv.number} overdue`, `${inv.client_name} · ${inv.balance.toLocaleString('en', { minimumFractionDigits: 2 })} ${inv.currency} due ${inv.valid_until}`, `/docs/${inv.id}`, 'overdue');
  }
  for (const c of prod.cards.filter((c) => c.late)) push('danger', `${c.number} is late`, `${c.sku} · due ${c.due_date} · at ${c.stage_name || 'planning'}`, `/production/mo/${c.id}`, 'late');
  for (const l of all("SELECT l.id, l.code, l.notes, p.sku FROM lots l JOIN products p ON p.id = l.product_id WHERE l.status = 'hold'")) {
    push('danger', `Lot ${l.code} on QC hold`, `${l.sku} · ${l.notes || 'decide: release or rework'}`, `/lots/${l.id}`, 'qc');
  }
  for (const q of quotes.filter((q) => q.status === 'sent' && q.valid_until && q.valid_until <= in7)) {
    push('info', `${q.number} expires ${q.valid_until}`, `${q.client_name} · follow up`, `/docs/${q.id}`, 'quote');
  }
  for (const sh of all(
    `SELECT s.*, c.company AS client_name, (SELECT COUNT(*) FROM shipment_docs d WHERE d.shipment_id = s.id AND d.status = 'todo') AS docs_todo
     FROM shipments s LEFT JOIN clients c ON c.id = s.client_id WHERE s.status IN ('planning','booked','loading','loaded') AND s.etd IS NOT NULL AND s.etd <= ?`,
    in14,
  )) {
    if (sh.docs_todo) push('warning', `${sh.number} leaves ${sh.etd} - ${sh.docs_todo} document(s) not ready`, sh.client_name || '', `/shipments/${sh.id}`, 'docs');
  }
  for (const m of lowMaterials) push('warning', `Low stock: ${m.name}`, `${round2(m.stock)} ${m.unit} left · minimum ${m.min_stock}`, `/materials/${m.id}`, 'material');
  for (const x of reqs.filter((x) => x.short > 0)) push('warning', `Material short for open production: ${x.name}`, `Need ${x.qty} ${x.unit}, have ${round2(x.stock)} (${x.mos.slice(0, 3).join(', ')})`, `/materials/${x.material_id}`, 'material');
  for (const sm of all(
    `SELECT s.*, c.company AS client_name FROM samples s JOIN clients c ON c.id = s.client_id WHERE s.status IN ('sent','delivered') AND s.follow_up IS NOT NULL AND s.follow_up <= ?`,
    t,
  )) {
    push('info', `Follow up sample ${sm.number}`, `${sm.client_name} · sent ${sm.sent_at || ''}`, `/samples?open=${sm.id}`, 'sample');
  }
  const putaway = get(`SELECT COUNT(*) AS n FROM stock_units u LEFT JOIN locations l ON l.id = u.location_id LEFT JOIN zones z ON z.id = l.zone_id
    WHERE u.status IN ('in_stock','reserved','hold') AND u.parent_id IS NULL AND (u.location_id IS NULL OR z.kind = 'receiving')`).n;
  if (putaway) push('info', `${putaway} pallet(s) / box group(s) waiting to be put away`, 'Packing-out area or no location', '/warehouse/putaway', 'putaway');
  const claims = all("SELECT cl.*, c.company AS client_name FROM claims cl JOIN clients c ON c.id = cl.client_id WHERE cl.status IN ('open','investigating')");
  for (const c of claims) push('warning', `Claim ${c.number} - ${c.category.replace('_', ' ')}`, c.client_name, `/claims/${c.id}`, 'claim');

  const tasks = all(
    `SELECT a.*, c.company AS client_name FROM activities a LEFT JOIN clients c ON c.id = a.client_id
     WHERE a.done = 0 AND a.due_date IS NOT NULL AND a.due_date <= ? AND (a.assigned_to = ? OR (a.assigned_to IS NULL AND a.user_id = ?))
     ORDER BY a.due_date LIMIT 20`,
    in7,
    req.user.id,
    req.user.id,
  );

  const sumBy = (rows, field = 'total') => rows.reduce((acc, d) => acc + toCur(d[field], d.currency), 0);
  const wipStages = prod.stages.map((st) => {
    const cards = prod.cards.filter((c) => c.column === String(st.id));
    return { id: st.id, name: st.name, color: st.color, mos: cards.length, pcs: cards.reduce((s, c) => s + (c.waiting || 0) + (c.in_kiln || 0), 0) };
  });
  const opps = all("SELECT stage, value, currency FROM opportunities WHERE stage NOT IN ('won','lost')");
  const pipeline = Object.entries(OPP_STAGES)
    .filter(([k]) => !['won', 'lost'].includes(k))
    .map(([k, v]) => {
      const rows = opps.filter((o) => o.stage === k);
      return { stage: k, label: v.label, count: rows.length, value: round2(rows.reduce((s, o) => s + toCur(o.value || 0, o.currency || cur), 0)) };
    });
  const months = [];
  const d0 = new Date(`${t.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(d0);
    d.setUTCMonth(d.getUTCMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }
  const inv12 = all("SELECT issue_date, total, currency FROM sales_docs WHERE type = 'invoice' AND status NOT IN ('draft','cancelled') AND issue_date >= ?", `${months[0]}-01`);
  const ord12 = all("SELECT issue_date, total, currency FROM sales_docs WHERE type = 'order' AND status NOT IN ('draft','cancelled') AND issue_date >= ?", `${months[0]}-01`);
  const sales = months.map((m) => ({
    month: m,
    invoiced: round2(inv12.filter((x) => x.issue_date.startsWith(m)).reduce((s, x) => s + toCur(x.total, x.currency), 0)),
    ordered: round2(ord12.filter((x) => x.issue_date.startsWith(m)).reduce((s, x) => s + toCur(x.total, x.currency), 0)),
  }));
  const stockByColour = all(
    `SELECT c.code, c.name, c.hex, SUM(u.boxes * f.m2_per_box) AS m2
     FROM stock_units u JOIN products p ON p.id = u.product_id JOIN colours c ON c.id = p.colour_id JOIN formats f ON f.id = p.format_id
     WHERE u.status = 'in_stock' AND u.grade = 'A' GROUP BY c.id ORDER BY m2 DESC LIMIT 10`,
  ).map((x) => ({ ...x, m2: round2(x.m2) }));

  res.json({
    currency: cur,
    kpis: {
      open_quotes: { count: quotes.length, value: round2(sumBy(quotes)) },
      open_orders: { count: orders.length, value: round2(sumBy(orders)), waiting_gates: orders.filter((o) => o.gates_missing.length).length },
      in_production: { mos: prod.cards.filter((c) => c.status !== 'planned').length, planned: prod.cards.filter((c) => c.status === 'planned').length, pcs: wipStages.reduce((s, x) => s + x.pcs, 0) },
      ready_to_ship: orders.filter((o) => o.status === 'ready').length,
      receivables: { value: round2(invoices.reduce((s, d) => s + toCur(d.balance, d.currency), 0)), overdue: invoices.filter((d) => d.display_status === 'overdue').length },
      stock_m2: round2(stockByColour.reduce((s, x) => s + x.m2, 0)),
      low_materials: lowMaterials.length,
      open_claims: claims.length,
      putaway,
    },
    attention,
    tasks,
    charts: { wip: wipStages, pipeline, sales, stock_by_colour: stockByColour },
  });
});

/** Small counters for the navigation badges (cheap queries only). */
r.get('/nav-counts', (req, res) => {
  const t = today();
  res.json({
    putaway: get(`SELECT COUNT(*) AS n FROM stock_units u LEFT JOIN locations l ON l.id = u.location_id LEFT JOIN zones z ON z.id = l.zone_id
      WHERE u.status IN ('in_stock','reserved','hold') AND u.parent_id IS NULL AND (u.location_id IS NULL OR z.kind = 'receiving')`).n,
    holds: get("SELECT COUNT(*) AS n FROM lots WHERE status = 'hold'").n,
    gates: get(`SELECT COUNT(*) AS n FROM sales_docs WHERE type = 'order' AND status IN ('confirmed','draft') AND (colour_approved_at IS NULL OR deposit_received_at IS NULL)`).n,
    overdue: get(`SELECT COUNT(*) AS n FROM sales_docs WHERE type = 'invoice' AND status IN ('issued','partially_paid') AND valid_until < ?`, t).n,
    tasks: get(`SELECT COUNT(*) AS n FROM activities WHERE done = 0 AND due_date IS NOT NULL AND due_date <= ? AND (assigned_to = ? OR (assigned_to IS NULL AND user_id = ?))`, t, req.user.id, req.user.id).n,
    claims: get("SELECT COUNT(*) AS n FROM claims WHERE status IN ('open','investigating')").n,
    late_mos: get("SELECT COUNT(*) AS n FROM manufacturing_orders WHERE status IN ('planned','released','in_progress') AND due_date < ?", t).n,
  });
});

/** Global search for the command palette. */
r.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ exact: null, groups: [] });
  const like = `%${q}%`;
  const exact = resolveCode(q, req.user);
  const groups = [
    ['Clients', all('SELECT id, company AS title, country AS subtitle FROM clients WHERE company LIKE ? OR code LIKE ? OR contact_name LIKE ? OR email LIKE ? ORDER BY archived, company LIMIT 6', like, like, like, like).map((x) => ({ ...x, url: `/clients/${x.id}` }))],
    ['Documents', all(`SELECT d.id, d.number || ' · ' || c.company AS title, d.type || ' · ' || d.status AS subtitle FROM sales_docs d JOIN clients c ON c.id = d.client_id WHERE d.number LIKE ? OR d.project LIKE ? OR d.client_ref LIKE ? ORDER BY d.id DESC LIMIT 6`, like, like, like).map((x) => ({ ...x, url: `/docs/${x.id}` }))],
    ['Products', all('SELECT p.id, p.sku AS title, p.name AS subtitle, c.hex FROM products p LEFT JOIN colours c ON c.id = p.colour_id WHERE p.sku LIKE ? OR p.name LIKE ? LIMIT 6', like, like).map((x) => ({ ...x, url: `/catalog/${x.id}`, image: `/api/products/${x.id}/image` }))],
    ['Production', all("SELECT mo.id, mo.number AS title, p.sku || ' · ' || mo.status AS subtitle FROM manufacturing_orders mo JOIN products p ON p.id = mo.product_id WHERE mo.number LIKE ? OR p.sku LIKE ? ORDER BY mo.id DESC LIMIT 6", like, like).map((x) => ({ ...x, url: `/production/mo/${x.id}` }))],
    ['Lots', all("SELECT l.id, l.code AS title, p.sku || ' · ' || l.status AS subtitle FROM lots l JOIN products p ON p.id = l.product_id WHERE l.code LIKE ? ORDER BY l.id DESC LIMIT 6", like).map((x) => ({ ...x, url: `/lots/${x.id}` }))],
    ['Stock units', all("SELECT u.id, u.code AS title, COALESCE(p.sku, m.code) || ' · ' || u.status AS subtitle FROM stock_units u LEFT JOIN products p ON p.id = u.product_id LEFT JOIN materials m ON m.id = u.material_id WHERE u.code LIKE ? ORDER BY u.id DESC LIMIT 6", like).map((x) => ({ ...x, url: `/stock/units/${x.id}` }))],
    ['Locations', all("SELECT l.id, l.label AS title, z.name AS subtitle FROM locations l JOIN zones z ON z.id = l.zone_id WHERE l.code LIKE ? OR l.label LIKE ? ORDER BY l.code LIMIT 6", like, like).map((x) => ({ ...x, url: `/warehouse/location/${x.id}` }))],
    ['Shipments', all('SELECT s.id, s.number AS title, s.status AS subtitle FROM shipments s WHERE s.number LIKE ? OR s.container_no LIKE ? OR s.bl_no LIKE ? ORDER BY s.id DESC LIMIT 6', like, like, like).map((x) => ({ ...x, url: `/shipments/${x.id}` }))],
    ['Materials', all('SELECT id, code AS title, name AS subtitle FROM materials WHERE code LIKE ? OR name LIKE ? LIMIT 6', like, like).map((x) => ({ ...x, url: `/materials/${x.id}` }))],
  ]
    .filter(([, rows]) => rows.length)
    .map(([label, rows]) => ({ label, rows }));
  res.json({ exact: exact && !exact.needsLogin ? exact : null, groups });
});

export default r;
