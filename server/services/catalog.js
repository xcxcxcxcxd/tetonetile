import { all, get } from '../db.js';

// Product joined with its format, colour and main image. Used everywhere a product is shown.
export const PRODUCT_COLS = `
  p.id, p.sku, p.kind, p.name, p.description, p.unit, p.cost, p.image_id, p.active, p.hs_code,
  p.reserve_target_boxes, p.format_id, p.colour_id,
  f.code AS format_code, f.name AS format_name, f.family, f.shape, f.width_cm, f.length_cm, f.thickness_cm,
  f.pcs_per_m2, f.pcs_per_box, f.m2_per_box, f.kg_per_box, f.boxes_per_pallet, f.sell_unit, f.painted,
  f.production_loss_pct, f.packing_confirmed, f.box_dims,
  c.code AS colour_code, c.name AS colour_name, c.hex, c.finish, c.lead_free, c.price_adjust_pct,
  c.fast_seller, c.glaze_family, c.sds_available,
  a.stored_name AS image_file`;

export const PRODUCT_FROM = `products p
  LEFT JOIN formats f ON f.id = p.format_id
  LEFT JOIN colours c ON c.id = p.colour_id
  LEFT JOIN attachments a ON a.id = p.image_id`;

export function withImage(p) {
  if (!p) return p;
  p.image_url = p.image_file ? `/files/${p.image_file}` : `/api/products/${p.id}/swatch.svg`;
  p.swatch_url = `/api/products/${p.id}/swatch.svg`;
  return p;
}

export function productRow(id) {
  return withImage(get(`SELECT ${PRODUCT_COLS} FROM ${PRODUCT_FROM} WHERE p.id = ?`, id));
}

export function productBySku(sku) {
  return withImage(get(`SELECT ${PRODUCT_COLS} FROM ${PRODUCT_FROM} WHERE p.sku = ? COLLATE NOCASE`, sku));
}

export function productsByIds(ids) {
  if (!ids.length) return new Map();
  const rows = all(`SELECT ${PRODUCT_COLS} FROM ${PRODUCT_FROM} WHERE p.id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return new Map(rows.map((r) => [r.id, withImage(r)]));
}

/** The production routing for a product: which stages apply, in order. */
export function routingFor(product) {
  const stages = all('SELECT * FROM stages WHERE active = 1 ORDER BY sort');
  const fam = product.family || 'zellige';
  const isCement = fam === 'cement';
  const finish = product.finish || 'glazed';
  return stages.filter((s) => {
    switch (s.applies_to) {
      case 'all': return true;
      case 'zellige': return !isCement;
      case 'glazed': return !isCement && finish === 'glazed';
      case 'natural': return !isCement && finish === 'natural';
      case 'painted': return !isCement && !!product.painted;
      case 'cement': return isCement;
      default: return true;
    }
  });
}
