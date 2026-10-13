import { Router } from 'express';
import { get, all } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad } from '../lib/http.js';
import { qrSvg } from '../lib/qr.js';
import { publicBase } from '../lib/settings.js';
import { productBySku, productRow } from '../services/catalog.js';
import { unitByCode, findLocation, occupancy } from '../services/stock.js';
import { listArticles } from './knowledge.js';

const r = Router();

/** QR image. ?code=PAL-000123 encodes <public url>/q/PAL-000123; ?text= encodes raw text. */
r.get('/qr.svg', requireAuth, async (req, res) => {
  let text = req.query.text ? String(req.query.text) : null;
  if (!text && req.query.code) text = `${publicBase(req)}/q/${encodeURIComponent(String(req.query.code).trim())}`;
  if (!text) throw bad('code or text is required');
  if (text.length > 500) throw bad('Too long for a label QR');
  res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'private, max-age=3600');
  res.send(await qrSvg(text, { ecl: req.query.ecl === 'H' ? 'H' : 'M', margin: Number(req.query.margin ?? 1) }));
});

export function normaliseCode(raw) {
  let s = String(raw || '').trim();
  if (s.includes('/q/')) s = s.split('/q/').pop();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep as is */
  }
  return s.split(/[?#]/)[0].trim();
}

function publicProduct(p) {
  if (!p) return null;
  return {
    sku: p.sku, name: p.name, kind: p.kind, colour_code: p.colour_code, colour_name: p.colour_name, hex: p.hex, finish: p.finish,
    lead_free: !!p.lead_free, format_code: p.format_code, format_name: p.format_name, family: p.family, shape: p.shape,
    width_cm: p.width_cm, length_cm: p.length_cm, thickness_cm: p.thickness_cm, pcs_per_m2: p.pcs_per_m2, pcs_per_box: p.pcs_per_box,
    m2_per_box: p.m2_per_box, kg_per_box: p.kg_per_box, box_dims: p.box_dims, image_url: `/api/products/${p.id}/image?v=${p.image_id || 0}`,
  };
}

/**
 * Identify a scanned code. Signed-in users get the record and where to go; anyone
 * else only gets the public product information (box labels are read by installers).
 */
export function resolveCode(rawCode, user) {
  const code = normaliseCode(rawCode);
  if (!code) return null;
  const up = code.toUpperCase();
  const signed = !!user;
  const hit = (type, row, title, subtitle, url, extra = {}) => ({ type, id: row.id, code: up, title, subtitle, url, ...extra });

  const unit = unitByCode(up);
  if (unit) {
    if (!signed) return { type: 'unit', code: up, needsLogin: true, public: unit.product_id ? { product: publicProduct(productRow(unit.product_id)), lot: unit.lot_code } : null };
    return hit('unit', unit, `${unit.code} · ${unit.sku || unit.material_code}`, `${unit.boxes ? `${unit.boxes} boxes` : `${unit.qty} ${unit.material_unit || ''}`} · ${unit.location_label || 'no location'} · ${unit.status.replace('_', ' ')}`, `/stock/units/${unit.id}`, { unit });
  }

  if (up.startsWith('KB-')) {
    const slug = code.slice(3).toLowerCase();
    const art = listArticles(true).find((a) => a.id === slug);
    // Staff open the article in the app; visitors read public articles on the public page.
    if (art) return { type: 'article', code: up, id: slug, title: art.title, url: signed ? `/knowledge/${slug}` : null, public: art.public ? { article: slug } : null, needsLogin: !signed && !art.public };
  }

  const loc = findLocation(up.replace(/^LOC[-:]/, ''));
  if (loc) {
    if (!signed) return { type: 'location', code: up, needsLogin: true };
    return hit('location', loc, `Location ${loc.label}`, `${loc.warehouse_code} · ${loc.zone_name}`, `/warehouse/location/${loc.id}`, { occupancy: occupancy(loc.id) });
  }

  const lot = get(
    `SELECT l.*, p.id AS pid, p.sku FROM lots l JOIN products p ON p.id = l.product_id WHERE l.code = ? COLLATE NOCASE`,
    up,
  );
  if (lot) {
    const pub = { product: publicProduct(productRow(lot.pid)), lot: lot.code, produced: lot.produced_at ? lot.produced_at.slice(0, 7) : null, workshop: lot.workshop === 'FES' ? 'Fès' : 'Tétouan' };
    if (!signed) return { type: 'lot', code: up, public: pub };
    return hit('lot', lot, `Lot ${lot.code}`, lot.sku, `/lots/${lot.id}`, { public: pub });
  }

  const mo = get('SELECT * FROM manufacturing_orders WHERE number = ? COLLATE NOCASE', up);
  if (mo) {
    if (!signed) return { type: 'mo', code: up, needsLogin: true };
    return hit('mo', mo, mo.number, 'Manufacturing order', `/floor/mo/${mo.id}`);
  }

  const kl = get('SELECT * FROM kiln_loads WHERE number = ? COLLATE NOCASE', up);
  if (kl) return signed ? hit('kiln_load', kl, kl.number, 'Kiln load', `/production/kilns/load/${kl.id}`) : { type: 'kiln_load', code: up, needsLogin: true };

  const kiln = get('SELECT * FROM kilns WHERE code = ? COLLATE NOCASE', up.replace(/^KILN-/, ''));
  if (kiln && up.startsWith('KILN-')) return signed ? hit('kiln', kiln, kiln.name, 'Kiln station', `/production/kilns?kiln=${kiln.id}`) : { type: 'kiln', code: up, needsLogin: true };

  const product = productBySku(up);
  if (product) {
    const pub = { product: publicProduct(product) };
    if (!signed) return { type: 'product', code: up, public: pub };
    return hit('product', product, product.sku, product.name, `/catalog/${product.id}`, { public: pub });
  }

  const mat = get('SELECT * FROM materials WHERE code = ? COLLATE NOCASE', up.replace(/^MAT:/, ''));
  if (mat) return signed ? hit('material', mat, mat.code, mat.name, `/materials/${mat.id}`) : { type: 'material', code: up, needsLogin: true };

  const sh = get('SELECT * FROM shipments WHERE number = ? COLLATE NOCASE', up);
  if (sh) return signed ? hit('shipment', sh, sh.number, 'Shipment', `/shipments/${sh.id}`) : { type: 'shipment', code: up, needsLogin: true };

  const doc = get('SELECT * FROM sales_docs WHERE number = ? COLLATE NOCASE', up);
  if (doc) return signed ? hit('doc', doc, doc.number, doc.type, `/docs/${doc.id}`) : { type: 'doc', code: up, needsLogin: true };

  const sample = get('SELECT * FROM samples WHERE number = ? COLLATE NOCASE', up);
  if (sample) return signed ? hit('sample', sample, sample.number, 'Sample', `/samples?open=${sample.id}`) : { type: 'sample', code: up, needsLogin: true };

  const claim = get('SELECT * FROM claims WHERE number = ? COLLATE NOCASE', up);
  if (claim) return signed ? hit('claim', claim, claim.number, 'Claim', `/claims/${claim.id}`) : { type: 'claim', code: up, needsLogin: true };

  const po = get('SELECT * FROM purchase_orders WHERE number = ? COLLATE NOCASE', up);
  if (po) return signed ? hit('po', po, po.number, 'Purchase order', `/purchase-orders/${po.id}`) : { type: 'po', code: up, needsLogin: true };

  return null;
}

r.get('/resolve/:code', (req, res) => {
  const out = resolveCode(req.params.code, req.user);
  if (!out) return res.status(404).json({ error: `Nothing found for "${normaliseCode(req.params.code)}".` });
  res.json(out);
});

/** Public company card for public pages (no internal data). */
r.get('/public/company', (req, res) => {
  const e = get('SELECT name, brand, city, country, email, website, phone, footer_note FROM entities WHERE is_default = 1 AND active = 1') || get('SELECT name, brand, email, website FROM entities ORDER BY id LIMIT 1');
  res.json({ company: e || null, docs: all("SELECT id, filename, stored_name FROM attachments WHERE entity = 'entity' AND kind = 'document' ORDER BY id").map((d) => ({ ...d, url: `/files/${d.stored_name}` })) });
});

export default r;
