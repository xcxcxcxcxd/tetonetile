// Demo data: fictional clients and a factory mid-season, built through the real
// services so every number is consistent. Run: npm run demo (or tick "demo" at setup).
// Delete the database file (data/zelligerar.db) before going live with real data.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, insert, update, run, tx, openDb, today } from './db.js';
import { seedReference } from './seed.js';
import { nextNumber } from './lib/numbering.js';
import { addDays } from '../shared/calc.js';
import { saveDoc, convertDoc, changeStatus, newDocDefaults, afterPaymentChange, refreshPromised } from './services/docs.js';
import { createMo, releaseMo, logStage, releaseOrder, addToKiln, setKilnStatus, unloadKiln } from './services/production.js';
import { createUnit, findLocation, moveUnit } from './services/stock.js';
import { createShipment, loadScan, setShipmentStatus } from './services/shipments.js';

const CLIENTS = [
  { company: 'Maison Atlas Interiors', type: 'wholesale', currency: 'USD', region: 'US', country: 'United States', city: 'Los Angeles', contact_name: 'Dana Whitfield', email: 'dana@maisonatlas.example', phone: '+1 310 555 0144', incoterm: 'FCA', incoterm_place: 'Tanger Med', source: 'Trade show', tags: 'container, west coast' },
  { company: 'Atelier Lumière', type: 'trade', currency: 'EUR', region: 'EU', country: 'France', city: 'Lyon', contact_name: 'Camille Roux', email: 'camille@atelier-lumiere.example', phone: '+33 4 55 01 22 10', incoterm: 'DAP', incoterm_place: 'Lyon', source: 'Website', tags: 'architect' },
  { company: 'Riad Al Andalus', type: 'end_user', currency: 'MAD', region: 'MA', country: 'Morocco', city: 'Marrakech', contact_name: 'Youssef Benali', email: 'contact@riad-alandalus.example', phone: '+212 6 00 11 22 33', source: 'Referral' },
  { company: 'Nordic Stone & Tile', type: 'wholesale', currency: 'EUR', region: 'EU', country: 'Sweden', city: 'Gothenburg', contact_name: 'Erik Lindqvist', email: 'erik@nordicstone.example', phone: '+46 31 555 210', incoterm: 'FCA', incoterm_place: 'Tanger Med', source: 'Distributor', tags: 'distributor, reserved stock' },
  { company: 'Studio Arquitectura Sol', type: 'trade', currency: 'EUR', region: 'EU', country: 'Spain', city: 'Sevilla', contact_name: 'Lucía Ortega', email: 'lucia@arqsol.example', phone: '+34 954 555 019', incoterm: 'DAP', incoterm_place: 'Sevilla', source: 'Instagram' },
  { company: 'Gulf Hospitality Projects', type: 'programme', currency: 'USD', region: 'GCC', country: 'United Arab Emirates', city: 'Dubai', contact_name: 'Omar Haddad', email: 'omar@gulfhp.example', phone: '+971 4 555 0199', incoterm: 'CFR', incoterm_place: 'Jebel Ali', source: 'Project', tags: 'hotel, programme' },
  { company: 'Harbour Tile Co.', type: 'trade', currency: 'GBP', region: 'UK', country: 'United Kingdom', city: 'Bristol', contact_name: 'Oliver Grant', email: 'oliver@harbourtile.example', phone: '+44 117 555 0170', incoterm: 'DAP', incoterm_place: 'Bristol', source: 'Website' },
  { company: 'Casa Verde Hôtel', type: 'trade', currency: 'MAD', region: 'MA', country: 'Morocco', city: 'Casablanca', contact_name: 'Salma Idrissi', email: 'achats@casaverde.example', phone: '+212 5 22 00 11 44', source: 'Architect' },
];

const WORKERS = [
  ['Hassan Bennani', 'SHAPE'], ['Fatima Zahra Alaoui', 'GLAZE'], ['Rachid Mansouri', 'FIRE'], ['Aicha Kabbaj', 'SORT'],
  ['Omar Tazi', 'CHISEL'], ['Nadia Lahlou', 'PACK'], ['Mustapha El Fassi', 'CHISEL'], ['Khadija Berrada', 'CLAY'],
];

const COSTS = { ZR05: 410, ZR07: 395, ZR10: 360, HX09: 390, BE: 380, BB: 385, BS: 300, HP10: 640, HP15: 690 };

function req(userId) {
  return { user: { id: userId, role: 'admin', name: 'Demo admin' } };
}

const pid = (sku) => get('SELECT id FROM products WHERE sku = ?', sku).id;
const tierOf = (code) => get('SELECT id FROM price_tiers WHERE code = ?', code).id;

function newDoc(r, type, clientId, header, lines, issueDate) {
  const client = get('SELECT * FROM clients WHERE id = ?', clientId);
  const id = insert('sales_docs', { ...newDocDefaults(type, client), ...header, number: nextNumber(type, new Date(issueDate || today())), created_by: r.user.id });
  if (issueDate) update('sales_docs', id, { issue_date: issueDate, valid_until: type === 'quote' ? addDays(issueDate, 30) : type === 'invoice' ? addDays(issueDate, 30) : null });
  saveDoc(r, id, {}, lines);
  return id;
}

function priceFor(sku, clientId) {
  // illustrative list price in the client's currency (cost x tier multiplier, converted)
  const c = get('SELECT c.currency, t.multiplier FROM clients c LEFT JOIN price_tiers t ON t.id = c.tier_id WHERE c.id = ?', clientId);
  const p = get('SELECT p.cost FROM products p WHERE p.sku = ?', sku);
  const rates = { MAD: 1, EUR: 10.8, USD: 9.3, GBP: 12.6, AED: 2.53 };
  return Math.round(((p.cost * (c.multiplier || 1.35)) / rates[c.currency]) * 100) / 100;
}

function lineFor(sku, clientId, net, extra = {}) {
  return { product_id: pid(sku), unit: 'm2', net_qty: net, unit_price: priceFor(sku, clientId), price_source: 'computed', ...extra };
}

/** Push an MO through stages up to (not including) `stopAt`. */
function produce(r, moId, stopAt, { workers, gradeB = 0.03, scrapPct = 0.01, kilnId } = {}) {
  const st = Object.fromEntries(all('SELECT id, code FROM stages').map((s) => [s.code, s.id]));
  const mo = get('SELECT * FROM manufacturing_orders WHERE id = ?', moId);
  const product = get('SELECT p.*, c.finish FROM products p JOIN colours c ON c.id = p.colour_id WHERE p.id = ?', mo.product_id);
  const fmt = get('SELECT * FROM formats WHERE id = ?', product.format_id);
  const route = all('SELECT * FROM stages WHERE active = 1 ORDER BY sort').filter((s) => {
    if (s.applies_to === 'all' || s.applies_to === 'zellige') return true;
    if (s.applies_to === 'glazed') return product.finish === 'glazed';
    if (s.applies_to === 'natural') return product.finish === 'natural';
    if (s.applies_to === 'painted') return !!fmt.painted;
    return false;
  });
  let pcs = mo.target_pcs;
  const w = (code) => workers.find((x) => x.team === code)?.id || null;
  for (const s of route) {
    if (s.code === stopAt) return;
    const scrap = Math.round(pcs * scrapPct);
    if (s.is_kiln) {
      // A batch is fired over as many loads as the kiln capacity needs.
      const cap = get('SELECT capacity_m2 FROM kilns WHERE id = ?', kilnId)?.capacity_m2 || 60;
      const perLoad = Math.max(1, Math.floor(cap * 0.95 * (fmt.pcs_per_m2 || 100)));
      let left = pcs;
      let defects = 0;
      while (left > 0) {
        const n = Math.min(left, perLoad);
        const bad = Math.round(n * scrapPct);
        const load = insert('kiln_loads', { number: nextNumber('kiln_load'), kiln_id: kilnId, status: 'loading', loaded_at: today(), operator: 'Rachid Mansouri' });
        addToKiln(r, load, moId, n);
        setKilnStatus(r, load, 'firing', { fuel_kg: Math.round(n / 12) });
        setKilnStatus(r, load, 'cooling', { peak_temp_c: 960 + Math.round(Math.random() * 40) });
        const item = get('SELECT id FROM kiln_load_items WHERE kiln_load_id = ?', load);
        unloadKiln(r, load, [{ item_id: item.id, pcs_good: n - bad, pcs_defect: bad, complete: left - n === 0 }]);
        left -= n;
        defects += bad;
      }
      pcs -= defects;
      continue;
    }
    if (s.is_qc) {
      const b = Math.round(pcs * gradeB);
      const rej = Math.round(pcs * 0.01);
      logStage(r, moId, {
        stage_id: st[s.code], grade_a: pcs - b - rej, grade_b: b, rejects: rej, completes_stage: true, worker_id: w(s.code),
        qc: { colour_var: 3, texture_var: 3, size_var: 3, pits_chips: 2, crazing: 2, iron_spots: 1, matches_reference: 1, inspector: 'Aicha Kabbaj' },
      });
      pcs -= b + rej;
      continue;
    }
    if (s.is_packing) {
      logStage(r, moId, { stage_id: st[s.code], completes_stage: true, worker_id: w(s.code) });
      continue;
    }
    logStage(r, moId, { stage_id: st[s.code], qty_good: pcs - scrap, qty_scrap: scrap, completes_stage: true, worker_id: w(s.code), scrap_reason: scrap ? 'Cracked' : null });
    pcs -= scrap;
  }
}

export function seedDemo({ adminId } = {}) {
  seedReference();
  if (get('SELECT COUNT(*) AS n FROM clients').n > 0) return false;
  const admin = adminId || get("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1")?.id;
  if (!admin) throw new Error('Create the admin account first.');
  const r = req(admin);
  const t = today();

  tx(() => {
    // catalogue: illustrative costs (MAD per sell unit), fast sellers, reserve targets
    for (const [f, cost] of Object.entries(COSTS)) {
      run(`UPDATE products SET cost = ? WHERE format_id = (SELECT id FROM formats WHERE code = ?)`, cost, f);
    }
    run("UPDATE products SET cost = cost * 0.9 WHERE colour_id = (SELECT id FROM colours WHERE code = 'NAT')");
    run("UPDATE colours SET fast_seller = 1 WHERE code IN ('01','25','39')");
    run("UPDATE colours SET lead_free = 1, glaze_family = 'Tétouan lead-free', price_adjust_pct = 9 WHERE code IN ('25','14')");
    run("UPDATE colours SET glaze_family = 'Fès' WHERE glaze_family IS NULL AND finish = 'glazed'");
    run("UPDATE products SET reserve_target_boxes = 160 WHERE sku IN ('ZR10-01','ZR10-25','ZR10-39','BB-01','BB-39')");
    insert('products', { sku: 'SAMPLE-BOX', kind: 'sample', name: 'Sample box - 4 colours × 25 pieces', unit: 'unit', cost: 280 });
    insert('products', { sku: 'MOUNT', kind: 'service', name: 'Mounting on mesh (surcharge)', unit: 'm2', cost: 150 });

    const workers = WORKERS.map(([name, team]) => ({ id: insert('workers', { name, team, piece_rate: team === 'CHISEL' ? 0.35 : null }), team }));
    insert('suppliers', { name: 'Argiles du Rif (demo)', category: 'clay', phone: '+212 5 39 00 00 01' });
    insert('suppliers', { name: 'Cartonnerie du Nord (demo)', category: 'packaging', phone: '+212 5 39 00 00 02' });
    insert('suppliers', { name: 'Coopérative Oléicole (demo)', category: 'fuel', phone: '+212 5 35 00 00 03' });

    // raw material stock in the M zone (some deliberately low)
    const mat = (code) => get('SELECT id FROM materials WHERE code = ?', code).id;
    const loc = (code) => findLocation(code).id;
    const recvMat = (code, qty, at) => createUnit(r, { kind: 'material', material_id: mat(code), qty, location_id: loc(at), supplier_lot: `DEMO-${code}` }, { ref: 'Opening stock' });
    recvMat('CLAY-TET', 18000, 'TET-M01');
    recvMat('CLAY-TET', 9000, 'TET-M01');
    recvMat('FUEL-OLIVE', 2400, 'TET-M02');
    recvMat('BOX-ZEL', 1450, 'TET-M03');
    recvMat('SAWDUST', 900, 'TET-M03');
    recvMat('PALLET', 14, 'TET-M04');
    recvMat('FRIT', 260, 'TET-M05');
    for (const c of ['01', '03', '14', '25', '39']) recvMat(`GLZ-${c}`, c === '03' ? 30 : 140, 'TET-M05');

    // clients
    const ids = CLIENTS.map((c) => {
      const id = insert('clients', { ...c, tier_id: tierOf({ end_user: 'END', trade: 'TRADE', wholesale: 'WHOLESALE', programme: 'PROGRAMME', distributor: 'WHOLESALE' }[c.type]), owner_id: admin });
      update('clients', id, { code: `C${String(id).padStart(4, '0')}` });
      insert('contacts', { client_id: id, name: c.contact_name, email: c.email, phone: c.phone, is_primary: 1, role: 'Buyer' });
      return id;
    });
    const [atlas, lumiere, riad, nordic, sol, gulf, harbour, casaverde] = ids;

    // historical sales (last 11 months) for the charts: orders + invoices, paid
    const hist = [
      [nordic, 'ZR10-01', 140, 320], [harbour, 'BB-39', 60, 290], [atlas, 'ZR10-25', 420, 270], [sol, 'HX09-03', 55, 250],
      [lumiere, 'BE-14', 70, 220], [nordic, 'ZR10-39', 160, 200], [casaverde, 'ZR05-01', 90, 180], [atlas, 'BB-01', 380, 150],
      [harbour, 'ZR10-03', 45, 120], [sol, 'BB-25', 80, 95], [nordic, 'HX09-01', 120, 70], [lumiere, 'ZR10-14', 66, 45],
    ];
    for (const [cid, sku, m2, daysAgo] of hist) {
      const d = addDays(t, -daysAgo);
      const o = newDoc(r, 'order', cid, { project: 'Earlier project', colour_approved_at: addDays(d, 2), deposit_received_at: addDays(d, 3) }, [lineFor(sku, cid, m2)], d);
      update('sales_docs', o, { status: 'closed' });
      const inv = convertDoc(r, o, 'invoice');
      update('sales_docs', inv, { issue_date: addDays(d, 70), valid_until: addDays(d, 100), status: 'issued' });
      const total = get('SELECT total FROM sales_docs WHERE id = ?', inv).total;
      insert('payments', { doc_id: o, date: addDays(d, 3), amount: Math.round(total * 50) / 100, currency: get('SELECT currency FROM sales_docs WHERE id = ?', o).currency, kind: 'deposit', method: 'bank_transfer', created_by: admin });
      insert('payments', { doc_id: o, date: addDays(d, 75), amount: total - Math.round(total * 50) / 100, currency: get('SELECT currency FROM sales_docs WHERE id = ?', o).currency, kind: 'balance', method: 'bank_transfer', created_by: admin });
      afterPaymentChange(r, o);
    }

    // finished stock from earlier production: produce lots straight to stock
    const stockMo = (sku, boxes, purpose = 'stock', daysAgo = 40) => {
      const id = createMo(r, { product_id: pid(sku), boxes_required: boxes, purpose, due_date: addDays(t, -daysAgo + 20) });
      releaseMo(r, id);
      produce(r, id, null, { workers, kilnId: 2 });
      run('UPDATE manufacturing_orders SET created_at = ?, completed_at = ? WHERE id = ?', `${addDays(t, -daysAgo)} 08:00:00`, `${addDays(t, -daysAgo + 18)} 17:00:00`, id);
      return id;
    };
    stockMo('ZR10-25', 330, 'stock', 60);
    stockMo('ZR10-01', 250, 'export_reserve', 50);
    stockMo('BB-39', 180, 'stock', 45);
    stockMo('HX09-01', 120, 'stock', 38);
    stockMo('ZR05-03', 90, 'stock', 30);
    stockMo('BB-01', 160, 'export_reserve', 28);

    // put most finished pallets into the racks / floor / shelves (leave a few in packing-out for the put-away queue)
    const units = all("SELECT u.id, u.kind, u.boxes FROM stock_units u JOIN locations l ON l.id = u.location_id WHERE l.code = 'TET-IN01' AND u.kind IN ('pallet','boxes') ORDER BY u.id");
    const rackLocs = all("SELECT l.code FROM locations l JOIN zones z ON z.id = l.zone_id JOIN warehouses w ON w.id = z.warehouse_id WHERE w.code = 'TET' AND z.kind = 'rack' ORDER BY l.level, l.code").map((x) => x.code);
    const floorLocs = all("SELECT l.code FROM locations l JOIN zones z ON z.id = l.zone_id JOIN warehouses w ON w.id = z.warehouse_id WHERE w.code = 'TET' AND z.kind = 'floor' ORDER BY l.code").map((x) => x.code);
    const shelfLocs = all("SELECT l.code FROM locations l JOIN zones z ON z.id = l.zone_id JOIN warehouses w ON w.id = z.warehouse_id WHERE w.code = 'TET' AND z.kind = 'shelf' ORDER BY l.code").map((x) => x.code);
    let ri = 0;
    let fi = 0;
    let si = 0;
    units.slice(0, units.length - 3).forEach((u, i) => {
      if (u.kind === 'boxes') moveUnit(r, u.id, shelfLocs[si++ % shelfLocs.length], { force: true });
      else if (i % 4 === 3 && fi < floorLocs.length) moveUnit(r, u.id, floorLocs[fi++], { force: true });
      else moveUnit(r, u.id, rackLocs[ri++ % rackLocs.length], { force: true });
    });

    // sample boxes on the samples shelf
    const sb = pid('SAMPLE-BOX');
    createUnit(r, { kind: 'boxes', product_id: sb, boxes: 24, location_id: loc('TET-X01-1A'), pool: 'samples' }, { ref: 'Opening stock' });

    // ---- opportunities ----
    const opp = (client_id, title, stage, value, currency, area, days) =>
      insert('opportunities', { client_id, title, project: title, stage, value, currency, area_m2: area, expected_close: addDays(t, days), probability: { new: 10, qualified: 25, samples: 40, quoted: 55, negotiation: 75, won: 100, lost: 0 }[stage], owner_id: admin });
    const oGulf = opp(gulf, 'Jumeirah hotel - guest bathrooms', 'negotiation', 186000, 'USD', 2400, 35);
    const oSol = opp(sol, 'Casa patio Triana', 'samples', 14200, 'EUR', 160, 25);
    opp(harbour, 'Clifton kitchen backsplashes', 'qualified', 6800, 'GBP', 70, 40);
    const oLum = opp(lumiere, 'Spa des Brotteaux', 'quoted', 21500, 'EUR', 190, 18);
    opp(casaverde, 'Lobby feature wall', 'new', 95000, 'MAD', 85, 60);
    opp(atlas, 'Spring collection - container 2', 'qualified', 64000, 'USD', 1056, 50);
    opp(riad, 'Hammam renovation', 'lost', 38000, 'MAD', 60, -10);
    run("UPDATE opportunities SET lost_reason = 'Chose a cheaper machine-made tile' WHERE stage = 'lost'");

    // ---- quotes ----
    newDoc(r, 'quote', lumiere, { project: 'Spa des Brotteaux', opportunity_id: oLum, status: 'sent', sent_at: addDays(t, -6), overage_pct: 20, notes: 'Wet areas: glazed walls only. Floors in natural bejmat for slip resistance (DCOF wet 0.80).' }, [
      lineFor('ZR10-03', lumiere, 95, { notes: 'Shower walls' }),
      lineFor('BB-NAT', lumiere, 60, { notes: 'Hammam floor - natural, sealed' }),
      lineFor('BS-03', lumiere, null, { unit: 'lm', net_qty: 42, notes: 'Plint base course' }),
    ], addDays(t, -6));
    run("UPDATE sales_docs SET status = 'sent' WHERE type = 'quote' AND project = 'Spa des Brotteaux'");
    const qGulf = newDoc(r, 'quote', gulf, { project: 'Jumeirah hotel - guest bathrooms', opportunity_id: oGulf, overage_pct: 15, lead_time_weeks: 14, incoterm: 'CFR', incoterm_place: 'Jebel Ali' }, [
      lineFor('ZR10-25', gulf, 1400, { notes: 'Bathroom walls, 120 rooms' }),
      lineFor('HX09-39', gulf, 520, { notes: 'Bathroom floors, dry zone' }),
      lineFor('BB-01', gulf, 480, { notes: 'Corridor feature' }),
    ], addDays(t, -3));
    update('sales_docs', qGulf, { status: 'sent', sent_at: addDays(t, -3) });
    newDoc(r, 'quote', sol, { project: 'Casa patio Triana', opportunity_id: oSol }, [lineFor('BB-NAT', sol, 140, { notes: 'Patio floor, covered' }), lineFor('ZR10-14', sol, 22)], t);

    // ---- order 1: container for Maison Atlas, gates OK, in production (in the kiln now) ----
    const o1 = newDoc(r, 'order', atlas, { project: 'Spring collection - container 1', client_ref: 'PO-MA-2291', colour_approved_at: addDays(t, -40), deposit_received_at: addDays(t, -38), lead_time_weeks: 12, incoterm: 'FCA', incoterm_place: 'Tanger Med' }, [
      lineFor('ZR10-03', atlas, 360),
      lineFor('ZR10-39', atlas, 320),
      lineFor('BB-25', atlas, 210),
    ], addDays(t, -41));
    update('sales_docs', o1, { status: 'confirmed' });
    const tot1 = get('SELECT total, currency FROM sales_docs WHERE id = ?', o1);
    insert('payments', { doc_id: o1, date: addDays(t, -38), amount: Math.round(tot1.total * 50) / 100, currency: tot1.currency, kind: 'deposit', method: 'bank_transfer', reference: 'Wire 88213', created_by: admin });
    refreshPromised(o1);
    releaseOrder(r, o1, {});
    const o1mos = all('SELECT id FROM manufacturing_orders WHERE order_id = ? ORDER BY id', o1).map((x) => x.id);
    if (o1mos[0]) {
      releaseMo(r, o1mos[0]);
      produce(r, o1mos[0], 'FIRE', { workers, kilnId: 1 });
    }
    if (o1mos[1]) {
      releaseMo(r, o1mos[1]);
      produce(r, o1mos[1], 'SORT', { workers, kilnId: 2 });
    }
    if (o1mos[2]) {
      releaseMo(r, o1mos[2]);
      produce(r, o1mos[2], 'GLAZE', { workers, kilnId: 1 });
    }
    // kiln 1 is loading with the first MO
    if (o1mos[0]) {
      const kl = insert('kiln_loads', { number: nextNumber('kiln_load'), kiln_id: 1, status: 'loading', loaded_at: today(), operator: 'Rachid Mansouri' });
      const waiting = get('SELECT target_pcs FROM manufacturing_orders WHERE id = ?', o1mos[0]).target_pcs;
      const glazeGood = get("SELECT COALESCE(SUM(qty_good),0) AS n FROM stage_logs sl JOIN stages s ON s.id = sl.stage_id WHERE sl.mo_id = ? AND s.code = 'GLAZE'", o1mos[0]).n || waiting;
      const perM2 = get('SELECT f.pcs_per_m2 FROM manufacturing_orders mo JOIN products p ON p.id = mo.product_id JOIN formats f ON f.id = p.format_id WHERE mo.id = ?', o1mos[0]).pcs_per_m2 || 100;
      addToKiln(r, kl, o1mos[0], Math.min(glazeGood, Math.floor(57 * perM2)));
      setKilnStatus(r, kl, 'firing', { fuel_kg: 480 });
    }

    // ---- order 2: waiting for the deposit ----
    const o2 = newDoc(r, 'order', lumiere, { project: 'Boutique Saint-Jean', colour_approved_at: addDays(t, -2) }, [lineFor('BB-03', lumiere, 120), lineFor('HX09-39', lumiere, 40)], addDays(t, -4));
    update('sales_docs', o2, { status: 'confirmed' });
    const pf = convertDoc(r, o2, 'proforma');
    changeStatus(r, pf, 'issued');

    // ---- order 3: Nordic from stock, reserved, shipment being prepared ----
    const o3 = newDoc(r, 'order', nordic, { project: 'Showroom restock', colour_approved_at: addDays(t, -12), deposit_received_at: addDays(t, -10), incoterm: 'FCA', incoterm_place: 'Tanger Med' }, [lineFor('ZR10-25', nordic, 260, { overage_pct: 0 })], addDays(t, -14));
    update('sales_docs', o3, { status: 'confirmed' });
    const tot3 = get('SELECT total, currency FROM sales_docs WHERE id = ?', o3);
    insert('payments', { doc_id: o3, date: addDays(t, -10), amount: Math.round(tot3.total * 50) / 100, currency: tot3.currency, kind: 'deposit', method: 'bank_transfer', created_by: admin });
    afterPaymentChange(r, o3);
    releaseOrder(r, o3, {});
    const sh = createShipment(r, { client_id: nordic, mode: 'groupage', region: 'EU', forwarder: 'Groupage partner (demo)', etd: addDays(t, 5), order_ids: [o3] });
    run("UPDATE shipment_docs SET status = 'ready' WHERE shipment_id = ? AND code IN ('commercial_invoice','packing_list','tds_spec')", sh);
    const o3units = all("SELECT u.code FROM stock_units u JOIN doc_lines dl ON dl.id = u.order_line_id WHERE dl.doc_id = ? AND u.status = 'reserved'", o3);
    if (o3units[0]) loadScan(r, sh, o3units[0].code);

    // ---- order 4: domestic, shipped and invoiced, part paid; a claim ----
    const o4 = newDoc(r, 'order', riad, { project: 'Courtyard fountain', colour_approved_at: addDays(t, -30), deposit_received_at: addDays(t, -29) }, [lineFor('HX09-01', riad, 30)], addDays(t, -31));
    update('sales_docs', o4, { status: 'confirmed' });
    const tot4 = get('SELECT total, currency FROM sales_docs WHERE id = ?', o4);
    insert('payments', { doc_id: o4, date: addDays(t, -29), amount: Math.round(tot4.total * 50) / 100, currency: tot4.currency, kind: 'deposit', method: 'cash', created_by: admin });
    afterPaymentChange(r, o4);
    releaseOrder(r, o4, {});
    const sh4 = createShipment(r, { client_id: riad, mode: 'pickup', region: 'MA', order_ids: [o4] });
    for (const u of all("SELECT u.code FROM stock_units u JOIN doc_lines dl ON dl.id = u.order_line_id WHERE dl.doc_id = ? AND u.status = 'reserved'", o4)) loadScan(r, sh4, u.code);
    run("UPDATE shipment_docs SET status = 'ready' WHERE shipment_id = ?", sh4);
    setShipmentStatus(r, sh4, 'shipped', { force: true });
    const inv4 = convertDoc(r, o4, 'invoice');
    update('sales_docs', inv4, { issue_date: addDays(t, -20), valid_until: addDays(t, -5) });
    changeStatus(r, inv4, 'issued');
    update('sales_docs', inv4, { valid_until: addDays(t, -5) });
    insert('claims', {
      number: nextNumber('claim'), client_id: riad, order_id: o4, shipment_id: sh4, reported_at: addDays(t, -12), in_writing: 1, before_installation: 1,
      category: 'breakage', description: '2 boxes with broken corners after transport - photos received by WhatsApp before installation.', qty_affected: 0.73, unit: 'm2', status: 'investigating', created_by: admin,
    });

    // ---- production for stock and reserve, at various stages ----
    const m1 = createMo(r, { product_id: pid('ZR10-39'), boxes_required: 240, purpose: 'stock', due_date: addDays(t, 12), priority: 2 });
    releaseMo(r, m1);
    produce(r, m1, 'CHISEL', { workers, kilnId: 2 });
    const m2 = createMo(r, { product_id: pid('BB-25'), boxes_required: 160, purpose: 'export_reserve', due_date: addDays(t, 20) });
    releaseMo(r, m2);
    produce(r, m2, 'DRY', { workers, kilnId: 2 });
    const m3 = createMo(r, { product_id: pid('HX09-03'), boxes_required: 90, purpose: 'stock', due_date: addDays(t, -3), priority: 1 });
    releaseMo(r, m3);
    produce(r, m3, 'SORT', { workers, kilnId: 2 });
    // QC finds the red glaze darker than the reference: lot on hold
    const st = Object.fromEntries(all('SELECT id, code FROM stages').map((s) => [s.code, s.id]));
    const waitingSort = get("SELECT COALESCE(SUM(qty_good),0) AS n FROM stage_logs sl JOIN stages s ON s.id = sl.stage_id WHERE sl.mo_id = ? AND s.code = 'CHISEL'", m3).n;
    logStage(r, m3, {
      stage_id: st.SORT, grade_a: waitingSort - 300, grade_b: 200, rejects: 100, completes_stage: true,
      qc: { colour_var: 4, texture_var: 3, size_var: 3, pits_chips: 2, crazing: 2, iron_spots: 1, matches_reference: 0, inspector: 'Aicha Kabbaj', notes: 'Kiln load ran hot - shade darker than the approved reference board.' },
    });
    createMo(r, { product_id: pid('BE-14'), boxes_required: 120, purpose: 'stock', due_date: addDays(t, 30), priority: 3, notes: 'Planned - waiting for clay delivery' });
    const m5 = createMo(r, { product_id: pid('ZR10-NAT'), boxes_required: 100, purpose: 'stock', due_date: addDays(t, 18) });
    releaseMo(r, m5);
    produce(r, m5, 'SHAPE', { workers, kilnId: 2 });

    // ---- samples, tasks ----
    insert('samples', { number: nextNumber('sample'), client_id: sol, opportunity_id: oSol, status: 'sent', items: JSON.stringify([{ product_id: pid('BB-NAT'), pieces: 25 }, { product_id: pid('ZR10-14'), pieces: 25 }]), method: 'courier', tracking: 'DHL 12 3456 7890', charge: 45, currency: 'EUR', paid: 1, sent_at: addDays(t, -9), follow_up: addDays(t, -1) });
    insert('samples', { number: nextNumber('sample'), client_id: gulf, opportunity_id: oGulf, status: 'approved', items: JSON.stringify([{ product_id: pid('ZR10-25'), pieces: 25 }, { product_id: pid('HX09-39'), pieces: 25 }, { product_id: pid('BB-01'), pieces: 25 }]), method: 'courier', charge: 0, currency: 'USD', sent_at: addDays(t, -30), feedback: 'Approved in writing by the interior designer.' });
    insert('samples', { number: nextNumber('sample'), client_id: harbour, status: 'requested', items: JSON.stringify([{ product_id: pid('ZR10-03'), pieces: 25 }, { product_id: pid('ZR10-01'), pieces: 25 }]), method: 'groupage', charge: 45, currency: 'GBP' });
    const task = (client_id, subject, due, extra = {}) => insert('activities', { client_id, type: 'task', subject, due_date: due, user_id: admin, assigned_to: admin, ...extra });
    task(lumiere, 'Chase deposit for Boutique Saint-Jean (proforma sent)', t, { doc_id: o2 });
    task(gulf, 'Send revised CFR Jebel Ali price for the hotel', addDays(t, 2), { opportunity_id: oGulf });
    task(sol, 'Ask Lucía for feedback on the patio samples', addDays(t, -1), { opportunity_id: oSol });
    task(riad, 'Ship 2 replacement boxes for the breakage claim', addDays(t, 1));
    insert('activities', { client_id: gulf, opportunity_id: oGulf, type: 'meeting', subject: 'Site visit with the design team', body: 'Walls in 25 Tata snow white, floors in Rabat black hexagon. They need 14 weeks lead time.', done: 1, done_at: `${addDays(t, -8)} 10:00:00`, user_id: admin });
    insert('activities', { client_id: atlas, type: 'call', subject: 'Booking for container 1', body: 'Ready date confirmed with the forwarder; book 3 weeks ahead.', done: 1, done_at: `${addDays(t, -5)} 15:30:00`, user_id: admin });
  });
  return true;
}

// CLI: node server/seed-demo.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  openDb();
  const ok = seedDemo();
  console.log(ok ? 'Demo data loaded.' : 'The database already has clients - demo data not loaded.');
}
