import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb, all, get, insert, update, tx } from '../db.js';
import { config } from '../config.js';
import { requireRole } from '../auth.js';
import { bad } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { parseCsv, toCsv } from '../lib/csv.js';
import { createTileProducts } from '../seed.js';
import { createUnit, findLocation } from '../services/stock.js';
import { defaultTierId } from '../services/docs.js';

const r = Router();

/** A consistent copy of the live database (safe while the app is running). */
r.get('/data/backup', requireRole(), async (req, res) => {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const name = `zelligerar-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.db`;
  const file = path.join(config.backupDir, name);
  await getDb().backup(file);
  audit(req, 'data', null, 'backup', name);
  res.download(file, name);
});

const EXPORTS = {
  clients: `SELECT c.code, c.company, c.type, t.code AS tier, c.currency, c.region, c.country, c.city, c.address, c.contact_name, c.email, c.phone,
              c.website, c.vat_number, c.incoterm, c.incoterm_place, c.payment_terms, c.deposit_pct, c.source, c.tags, c.notes
            FROM clients c LEFT JOIN price_tiers t ON t.id = c.tier_id ORDER BY c.company`,
  colours: 'SELECT code, name, hex, finish, glaze_family, lead_free, colour_group, price_adjust_pct, fast_seller, sds_available, notes, active FROM colours ORDER BY sort, code',
  products: `SELECT p.sku, p.kind, f.code AS format, c.code AS colour, p.name, p.unit, p.cost, p.reserve_target_boxes, p.hs_code, p.active
             FROM products p LEFT JOIN formats f ON f.id = p.format_id LEFT JOIN colours c ON c.id = p.colour_id ORDER BY p.sku`,
  stock: `SELECT u.code, u.kind, p.sku, m.code AS material, l.code AS lot, u.grade, u.boxes, u.loose_pcs, u.qty, loc.code AS location, u.pool, u.status,
            d.number AS order_number, u.updated_at
          FROM stock_units u LEFT JOIN products p ON p.id = u.product_id LEFT JOIN materials m ON m.id = u.material_id LEFT JOIN lots l ON l.id = u.lot_id
          LEFT JOIN locations loc ON loc.id = u.location_id LEFT JOIN doc_lines dl ON dl.id = u.order_line_id LEFT JOIN sales_docs d ON d.id = dl.doc_id
          WHERE u.status IN ('in_stock','reserved','picked','hold') ORDER BY loc.code, u.code`,
  locations: `SELECT w.code AS warehouse, z.code AS zone, z.kind, loc.code, loc.label, loc.rack, loc.level, loc.position, loc.capacity, loc.capacity_unit, loc.blocked
              FROM locations loc JOIN zones z ON z.id = loc.zone_id JOIN warehouses w ON w.id = z.warehouse_id ORDER BY loc.code`,
  documents: `SELECT d.number, d.type, d.status, d.issue_date, d.valid_until, c.company AS client, d.currency, d.subtotal, d.total, d.incoterm, d.incoterm_place, d.project
              FROM sales_docs d JOIN clients c ON c.id = d.client_id ORDER BY d.issue_date, d.number`,
  lines: `SELECT d.number, d.type, dl.position, p.sku, dl.description, dl.net_qty, dl.overage_pct, dl.qty, dl.unit, dl.boxes, dl.pieces, dl.weight_kg, dl.unit_price, dl.discount_pct, dl.line_total
          FROM doc_lines dl JOIN sales_docs d ON d.id = dl.doc_id LEFT JOIN products p ON p.id = dl.product_id ORDER BY d.number, dl.position`,
  payments: `SELECT d.number, p.date, p.amount, p.currency, p.kind, p.method, p.reference FROM payments p JOIN sales_docs d ON d.id = p.doc_id ORDER BY p.date`,
  moves: `SELECT sm.at, sm.type, sm.unit_code, lf.code AS from_location, lt.code AS to_location, sm.boxes, sm.qty, sm.ref, sm.notes, u.name AS user
          FROM stock_moves sm LEFT JOIN locations lf ON lf.id = sm.from_location_id LEFT JOIN locations lt ON lt.id = sm.to_location_id LEFT JOIN users u ON u.id = sm.user_id
          ORDER BY sm.id DESC LIMIT 20000`,
  production: `SELECT mo.number, p.sku, mo.purpose, mo.status, mo.boxes_required, mo.target_pcs, mo.good_pcs, mo.grade_b_pcs, l.code AS lot, mo.due_date, mo.completed_at
               FROM manufacturing_orders mo JOIN products p ON p.id = mo.product_id LEFT JOIN lots l ON l.id = mo.lot_id ORDER BY mo.id`,
  materials: `SELECT m.code, m.name, m.category, m.unit, m.min_stock, m.reorder_qty, m.unit_cost,
                (SELECT COALESCE(SUM(u.qty), 0) FROM stock_units u WHERE u.material_id = m.id AND u.status IN ('in_stock','reserved','picked','hold')) AS stock
              FROM materials m ORDER BY m.category, m.code`,
};

r.get('/data/export/:what', requireRole('sales'), (req, res) => {
  const sql = EXPORTS[req.params.what];
  if (!sql) throw bad('Unknown export');
  const rows = all(sql);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.attachment(`${req.params.what}-${new Date().toISOString().slice(0, 10)}.csv`);
  res.send(`﻿${toCsv(rows, rows[0] ? Object.keys(rows[0]) : [])}`);
});

const bool = (v) => (['1', 'true', 'yes', 'y', 'oui'].includes(String(v || '').trim().toLowerCase()) ? 1 : 0);
const numOr = (v, d = null) => (v === undefined || v === null || String(v).trim() === '' ? d : Number(String(v).replace(',', '.')));

const IMPORTERS = {
  colours(rows) {
    let created = 0;
    let updated = 0;
    for (const x of rows) {
      if (!x.code || !x.name) continue;
      const code = String(x.code).trim().toUpperCase();
      const values = {
        name: x.name.trim(),
        hex: /^#?[0-9a-f]{6}$/i.test(x.hex || '') ? `#${x.hex.replace('#', '').toLowerCase()}` : undefined,
        finish: ['glazed', 'natural'].includes((x.finish || '').toLowerCase()) ? x.finish.toLowerCase() : undefined,
        glaze_family: x.glaze_family || undefined,
        lead_free: x.lead_free !== undefined && x.lead_free !== '' ? bool(x.lead_free) : undefined,
        colour_group: x.colour_group || undefined,
        price_adjust_pct: numOr(x.price_adjust_pct, undefined),
        fast_seller: x.fast_seller !== undefined && x.fast_seller !== '' ? bool(x.fast_seller) : undefined,
        sds_available: x.sds_available !== undefined && x.sds_available !== '' ? bool(x.sds_available) : undefined,
        notes: x.notes || undefined,
      };
      Object.keys(values).forEach((k) => values[k] === undefined && delete values[k]);
      const ex = get('SELECT id FROM colours WHERE code = ?', code);
      if (ex) {
        update('colours', ex.id, values);
        updated++;
      } else {
        insert('colours', { code, hex: '#cccccc', finish: 'glazed', ...values, sort: 50 });
        created++;
      }
    }
    const products = createTileProducts();
    return { created, updated, note: `${products} new products generated for the new colours` };
  },
  clients(rows) {
    let created = 0;
    let updated = 0;
    const errors = [];
    rows.forEach((x, i) => {
      const company = (x.company || x.name || '').trim();
      if (!company) {
        errors.push(`Row ${i + 2}: company is empty`);
        return;
      }
      const type = ['end_user', 'trade', 'wholesale', 'programme', 'distributor'].includes(x.type) ? x.type : 'end_user';
      const tier = x.tier ? get('SELECT id FROM price_tiers WHERE code = ? COLLATE NOCASE', x.tier)?.id : null;
      const values = {
        company, type, tier_id: tier || defaultTierId(type), currency: (x.currency || 'EUR').toUpperCase().slice(0, 3),
        region: ['US', 'EU', 'UK', 'GCC', 'MA', 'OTHER'].includes((x.region || '').toUpperCase()) ? x.region.toUpperCase() : 'OTHER',
        country: x.country || null, city: x.city || null, address: x.address || null, contact_name: x.contact_name || null, email: x.email || null,
        phone: x.phone || null, website: x.website || null, vat_number: x.vat_number || null, incoterm: x.incoterm || null,
        incoterm_place: x.incoterm_place || null, payment_terms: x.payment_terms || null, deposit_pct: numOr(x.deposit_pct),
        source: x.source || 'import', tags: x.tags || null, notes: x.notes || null,
      };
      const ex = x.code ? get('SELECT id FROM clients WHERE code = ?', x.code.toUpperCase()) : get('SELECT id FROM clients WHERE company = ? COLLATE NOCASE', company);
      if (ex) {
        update('clients', ex.id, values);
        updated++;
      } else {
        const id = insert('clients', { ...values, code: x.code ? x.code.toUpperCase() : null });
        if (!x.code) update('clients', id, { code: `C${String(id).padStart(4, '0')}` });
        if (values.contact_name) insert('contacts', { client_id: id, name: values.contact_name, email: values.email, phone: values.phone, is_primary: 1 });
        created++;
      }
    });
    return { created, updated, errors };
  },
  products(rows) {
    let created = 0;
    let updated = 0;
    const errors = [];
    rows.forEach((x, i) => {
      const sku = (x.sku || '').trim().toUpperCase();
      if (!sku) return errors.push(`Row ${i + 2}: sku is empty`);
      const f = x.format ? get('SELECT * FROM formats WHERE code = ? COLLATE NOCASE', x.format) : null;
      const c = x.colour ? get('SELECT * FROM colours WHERE code = ? COLLATE NOCASE', x.colour) : null;
      if (x.format && !f) return errors.push(`Row ${i + 2}: format ${x.format} not found`);
      if (x.colour && !c) return errors.push(`Row ${i + 2}: colour ${x.colour} not found`);
      const values = {
        kind: ['tile', 'custom', 'sample', 'service'].includes(x.kind) ? x.kind : f && c ? 'tile' : 'custom',
        format_id: f?.id ?? null, colour_id: c?.id ?? null,
        name: x.name || (f && c ? `${c.code} ${c.name} · ${f.name}` : sku),
        unit: ['m2', 'pc', 'lm', 'box', 'unit'].includes(x.unit) ? x.unit : f?.sell_unit || 'unit',
        cost: numOr(x.cost, 0), reserve_target_boxes: numOr(x.reserve_target_boxes, 0) || 0, hs_code: x.hs_code || null,
        active: x.active === undefined || x.active === '' ? 1 : bool(x.active),
      };
      const ex = get('SELECT id FROM products WHERE sku = ?', sku);
      if (ex) {
        update('products', ex.id, values);
        updated++;
      } else {
        if (values.kind === 'tile' && get("SELECT 1 FROM products WHERE kind = 'tile' AND format_id = ? AND colour_id = ?", values.format_id, values.colour_id)) {
          return errors.push(`Row ${i + 2}: a product for ${x.format} + ${x.colour} already exists`);
        }
        insert('products', { sku, ...values });
        created++;
      }
      return null;
    });
    return { created, updated, errors };
  },
  stock(rows, req) {
    let created = 0;
    const errors = [];
    rows.forEach((x, i) => {
      const p = x.sku ? get('SELECT * FROM products WHERE sku = ? COLLATE NOCASE', x.sku) : null;
      const m = x.material ? get('SELECT * FROM materials WHERE code = ? COLLATE NOCASE', x.material) : null;
      if (!p && !m) return errors.push(`Row ${i + 2}: unknown sku / material`);
      const loc = x.location ? findLocation(x.location) : null;
      if (x.location && !loc) return errors.push(`Row ${i + 2}: location ${x.location} not found`);
      let lotId = null;
      if (p && x.lot) {
        const lot = get('SELECT * FROM lots WHERE code = ?', x.lot.toUpperCase());
        lotId = lot ? lot.id : insert('lots', { code: x.lot.toUpperCase(), product_id: p.id, status: 'released', notes: 'Opening stock import' });
      }
      createUnit(
        req,
        {
          kind: m ? 'material' : Number(x.boxes) >= 10 ? 'pallet' : 'boxes', product_id: p?.id ?? null, material_id: m?.id ?? null, lot_id: lotId,
          grade: ['A', 'B', 'C'].includes((x.grade || 'A').toUpperCase()) ? (x.grade || 'A').toUpperCase() : 'A',
          boxes: Math.round(numOr(x.boxes, 0)), loose_pcs: Math.round(numOr(x.loose_pcs, 0)), qty: numOr(x.qty, 0), location_id: loc?.id ?? null,
          pool: ['general', 'export_reserve', 'samples'].includes(x.pool) ? x.pool : 'general',
        },
        { ref: 'Opening stock import' },
      );
      created++;
      return null;
    });
    return { created, updated: 0, errors };
  },
};

r.post('/data/import/:what', requireRole(), (req, res) => {
  const fn = IMPORTERS[req.params.what];
  if (!fn) throw bad('Unknown import');
  const rows = parseCsv(req.body.csv || '');
  if (!rows.length) throw bad('The file has no rows. The first line must be the column names.');
  if (rows.length > 20000) throw bad('Too many rows (max 20 000).');
  const result = tx(() => fn(rows, req));
  audit(req, 'data', null, 'import', `${req.params.what}: ${result.created} created, ${result.updated} updated`);
  res.json({ rows: rows.length, ...result });
});

r.get('/data/stats', requireRole(), (req, res) => {
  const tables = all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((t) => t.name);
  const size = fs.existsSync(config.dbFile) ? fs.statSync(config.dbFile).size : 0;
  res.json({
    file: config.dbFile,
    size,
    tables: tables.map((name) => ({ name, rows: get(`SELECT COUNT(*) AS n FROM "${name}"`).n })),
    backups: fs.existsSync(config.backupDir) ? fs.readdirSync(config.backupDir).filter((f) => f.endsWith('.db')).sort().reverse().slice(0, 10) : [],
  });
});

r.get('/audit', requireRole(), (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.entity) {
    where.push('a.entity = ?');
    params.push(req.query.entity);
  }
  if (req.query.entity_id) {
    where.push('a.entity_id = ?');
    params.push(req.query.entity_id);
  }
  res.json({ rows: all(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT 500`, ...params) });
});

export default r;
