// Reference data loaded on first start (only into empty tables).
// Sources: Zelligerar Material Specification, Technical Data Sheet, Installation
// Guide and the Characteristics packing sheet. Values marked packing_confirmed = 0
// are estimates - the specification says "packing data issued with the quotation".
import { all, get, insert, tx } from './db.js';

export const FORMATS = [
  // code, name, family, shape, w, l, thickness, pcs/m2, pcs/box, m2/box, kg/box, boxes/pallet, sell unit, painted, loss %, confirmed, notes
  ['ZR05', 'Square 5 × 5 cm', 'zellige', 'square', 5, 5, 0.95, 400, 400, 1.0, 19, 78, 'm2', 0, 10, 1, '2″ × 2″'],
  ['ZR07', 'Square 7 × 7 cm', 'zellige', 'square', 7, 7, 0.95, 205, 205, 1.0, 19.5, 78, 'm2', 0, 10, 0, '2¾″ × 2¾″ - packing data to confirm'],
  ['ZR10', 'Square 10 × 10 cm', 'zellige', 'square', 10, 10, 0.95, 100, 100, 1.0, 20, 78, 'm2', 0, 10, 1, '4″ × 4″'],
  ['HX09', 'Hexagon 9 × 10 cm', 'zellige', 'hexagon', 9, 10, 0.95, 137, 100, 0.73, 12, 78, 'm2', 0, 10, 1, '3½″ × 4″'],
  ['BE', 'Bejmat original 4.5 × 14.5 cm', 'zellige', 'rect', 4.5, 14.5, 1.8, 153, 90, 0.59, 21, 78, 'm2', 0, 12, 1, '1¾″ × 5¾″ - more pits and chips than squares'],
  ['BB', 'Bejmat 5 × 15 cm', 'zellige', 'rect', 5, 15, 1.8, 135, 83, 0.61, 22, 78, 'm2', 0, 12, 1, '2″ × 6″'],
  ['BS', 'Plint / skirting 5 × 15 cm', 'zellige', 'rect', 5, 15, 1.2, 135, 110, 0.81, 20, 78, 'lm', 0, 12, 0, '2″ × 6″ base course - packing data to confirm'],
  ['HP10', 'Hand-painted square 10 × 10 cm', 'zellige', 'square', 10, 10, 0.95, 100, 76, 0.76, 22, 78, 'm2', 1, 12, 1, '4″ × 4″'],
  ['HP15', 'Hand-painted square 15 × 15 cm', 'zellige', 'square', 15, 15, 0.95, 45, 25, 0.55, 20, 78, 'm2', 1, 12, 1, '6″ × 6″'],
  ['CT20', 'Cement tile square 20 × 20 cm', 'cement', 'square', 20, 20, 1.6, 25, 13, 0.52, 20, 60, 'm2', 0, 5, 1, '8″ × 8″ - box 24.5 × 19.5 × 19 cm'],
  ['CH20', 'Cement tile hexagon 20 × 23 cm', 'cement', 'hexagon', 20, 23, 1.6, 30, 12, 0.4, 15, 60, 'm2', 0, 5, 1, '8″ × 9″ - box 24.5 × 19.5 × 19 cm'],
];

// Only the colour references confirmed in the documents. Import the full
// 36-colour range from the Colour Range sheet (Settings > Catalogue > Import CSV).
export const COLOURS = [
  ['01', 'Casablanca white', '#f1ece1', 'glazed', 1],
  ['03', 'Marrakech red', '#a5372a', 'glazed', 2],
  ['14', 'Taza tagine', '#8a4a2c', 'glazed', 3],
  ['25', 'Tata snow white', '#f8f7f3', 'glazed', 4],
  ['39', 'Rabat black', '#1e1d1f', 'glazed', 5],
  ['NAT', 'Natural terracotta (unglazed)', '#c47a4c', 'natural', 99],
];

export const TIERS = [
  ['END', 'End user', 1.7, null, 1, 'Under 1 pallet. Delivered price or courier for small lots.', 1],
  ['TRADE', 'Architect / trade', 1.35, 1, 3, '1-3 pallets. Delivered price table.', 2],
  ['WHOLESALE', 'Wholesale', 1.25, 3, null, '3-4 pallets and up. FCA or delivered price table.', 3],
  ['PROGRAMME', 'Programme', 1.2, 18, null, 'At least 1 container a month, sustained. Negotiated yearly.', 4],
];

export const STAGES = [
  // code, name, sort, applies to, typical days, kiln, qc, packing, colour, instructions
  ['CLAY', 'Clay preparation', 10, 'zellige', 1, 0, 0, 0, '#9c5a3c', 'Soak, knead and wedge the Fès / Tétouan clay. Record the clay batch used.'],
  ['SHAPE', 'Hand shaping', 20, 'zellige', 1, 0, 0, 0, '#b07a4f', 'Shape by hand in wooden moulds. Count pieces at the end of the shift.'],
  ['MOULD', 'Cement moulding & pressing', 25, 'cement', 1, 0, 0, 0, '#6d7f8c', 'Pour the coloured layer into the pattern mould, back-fill and press.'],
  ['DRY', 'Sun drying', 30, 'zellige', 3, 0, 0, 0, '#c9a227', 'Dry in the sun on racks. Do not fire pieces that are still damp.'],
  ['CURE', 'Cement curing', 35, 'cement', 14, 0, 0, 0, '#8d99a6', 'Cure in water / shade before sorting. Keep stacks covered.'],
  ['GLAZE', 'Glazing', 40, 'glazed', 1, 0, 0, 0, '#2f6f5e', 'Check the colour code on the MO card against the colour reference board before glazing. One colour batch per MO.'],
  ['PAINT', 'Hand painting', 50, 'painted', 2, 0, 0, 0, '#3d5a80', 'Paint the pattern by hand on the glazed face.'],
  ['FIRE', 'Kiln firing', 60, 'zellige', 2, 1, 0, 0, '#b23a3a', 'Fire with olive pits. Log the kiln load number - colour varies between kiln loads.'],
  ['CHISEL', 'Hand chiselling', 70, 'zellige', 2, 0, 0, 0, '#5b6770', 'Chisel each piece to size. Separate broken pieces and record them as scrap.'],
  ['SORT', 'Sorting & QC', 80, 'all', 1, 0, 1, 0, '#7b4b94', 'Grade A / B / reject against the Variation & Imperfection standard. Compare with the approved colour reference.'],
  ['PACK', 'Packing & palletising', 90, 'all', 1, 0, 0, 1, '#2b4c7e', 'Pack in sawdust, label every box with the lot QR, build pallets (78 boxes zellige, 60 boxes cement).'],
];

export const MATERIALS = [
  ['CLAY-TET', 'Clay - Tétouan', 'clay', 'kg', 5000],
  ['CLAY-FES', 'Clay - Fès', 'clay', 'kg', 5000],
  ['FRIT', 'Glaze base / frit', 'glaze', 'kg', 200],
  ['FUEL-OLIVE', 'Olive pits (kiln fuel)', 'fuel', 'kg', 3000],
  ['BOX-ZEL', 'Carton box 34 × 22 × 23 cm', 'packaging', 'pc', 800],
  ['BOX-CEM', 'Carton box 24.5 × 19.5 × 19 cm', 'packaging', 'pc', 300],
  ['SAWDUST', 'Sawdust (packing)', 'packaging', 'kg', 300],
  ['PALLET', 'Wooden pallet 100 × 120 cm', 'packaging', 'pc', 20],
  ['FILM', 'Stretch film roll', 'packaging', 'pc', 10],
  ['LABELS', 'Label roll', 'consumable', 'pc', 5],
  ['MESH', 'Mounting mesh', 'consumable', 'm2', 50],
];

// [zone code, name, kind, layout]
// layout: { racks, levels, positions } for racking/shelving, { lanes, depth } for floor, { count } for single spots
const TET_ZONES = [
  ['IN', 'Receiving / packing out', 'receiving', { count: 2, capacity: 20 }],
  ['A', 'Finished goods racking', 'rack', { racks: 4, levels: 3, positions: 3, capacity: 1 }],
  ['B', 'Floor stacking', 'floor', { lanes: 6, depth: 3, capacity: 2 }],
  ['S', 'Shelving - loose boxes', 'shelf', { racks: 3, levels: 4, positions: 4, capacity: 30 }],
  ['X', 'Samples & sample boxes', 'samples', { racks: 1, levels: 4, positions: 3, capacity: 40 }],
  ['M', 'Raw materials', 'raw', { count: 6, capacity: null }],
  ['Q', 'Quarantine / QC hold', 'quarantine', { count: 4, capacity: 2 }],
  ['D', 'Dispatch staging', 'dispatch', { count: 4, capacity: 10 }],
];

const FES_ZONES = [
  ['IN', 'Receiving / packing out', 'receiving', { count: 1, capacity: 10 }],
  ['A', 'Finished goods racking', 'rack', { racks: 2, levels: 3, positions: 3, capacity: 1 }],
  ['M', 'Raw materials', 'raw', { count: 4, capacity: null }],
];

const ZONE_COLORS = {
  receiving: '#5b6770',
  rack: '#2f6f5e',
  floor: '#8a6d3b',
  shelf: '#3d5a80',
  samples: '#7b4b94',
  raw: '#9c5a3c',
  quarantine: '#b23a3a',
  dispatch: '#c27c0e',
};

const two = (n) => String(n).padStart(2, '0');
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Creates the locations for one zone. Returns the number created. */
export function buildZoneLocations(zone, warehouseCode, layout) {
  const unit = { rack: 'pallet', floor: 'pallet', shelf: 'box', samples: 'box', raw: 'any', quarantine: 'pallet', dispatch: 'pallet', receiving: 'pallet' }[zone.kind] || 'any';
  let n = 0;
  const add = (label, rack, level, position, capacity) => {
    const code = `${warehouseCode}-${label}`;
    if (get('SELECT 1 FROM locations WHERE code = ?', code)) return;
    insert('locations', { zone_id: zone.id, code, label, rack, level, position, capacity: capacity ?? null, capacity_unit: unit });
    n++;
  };
  const startRack = Number(layout.startRack || 1);
  if (layout.racks) {
    for (let r = startRack; r < startRack + layout.racks; r++) {
      for (let lv = 1; lv <= layout.levels; lv++) {
        for (let p = 0; p < layout.positions; p++) {
          add(`${zone.code}${two(r)}-${lv}${letters[p]}`, two(r), lv, letters[p], layout.capacity);
        }
      }
    }
  } else if (layout.lanes) {
    for (let r = startRack; r < startRack + layout.lanes; r++) {
      for (let d = 1; d <= layout.depth; d++) add(`${zone.code}${two(r)}-${d}`, two(r), null, String(d), layout.capacity);
    }
  } else {
    for (let i = startRack; i < startRack + (layout.count || 1); i++) add(`${zone.code}${two(i)}`, two(i), null, null, layout.capacity);
  }
  return n;
}

function seedWarehouse(code, name, zones) {
  const whId = insert('warehouses', { code, name });
  zones.forEach(([zcode, zname, kind, layout], i) => {
    const zid = insert('zones', { warehouse_id: whId, code: zcode, name: zname, kind, color: ZONE_COLORS[kind], sort: i });
    buildZoneLocations({ id: zid, code: zcode, kind }, code, layout);
  });
}

export function seedReference() {
  if (get('SELECT COUNT(*) AS n FROM formats').n > 0) return false;
  tx(() => {
    insert('entities', {
      name: 'The Zellige Factory',
      brand: 'Zelligerar',
      city: 'Tétouan',
      country: 'Morocco',
      email: 'contact@zelligerar.com',
      website: 'zelligerar.com',
      footer_note: 'Handmade Moroccan zellige · Fès & Tétouan · est. 1974',
      is_default: 1,
    });

    FORMATS.forEach((f, i) => {
      const [code, name, family, shape, w, l, t, pcsM2, pcsBox, m2Box, kgBox, perPallet, unit, painted, loss, confirmed, notes] = f;
      insert('formats', {
        code, name, family, shape, width_cm: w, length_cm: l, thickness_cm: t, pcs_per_m2: pcsM2, pcs_per_box: pcsBox,
        m2_per_box: m2Box, kg_per_box: kgBox, boxes_per_pallet: perPallet, sell_unit: unit, painted, production_loss_pct: loss,
        packing_confirmed: confirmed, notes, sort: i,
        box_dims: family === 'cement' ? '24.5 × 19.5 × 19 cm' : '34 × 22 × 23 cm',
      });
    });

    for (const [code, name, hex, finish, sort] of COLOURS) {
      insert('colours', { code, name, hex, finish, sort });
    }

    TIERS.forEach(([code, name, mult, min, max, notes, sort]) =>
      insert('price_tiers', { code, name, multiplier: mult, min_pallets: min, max_pallets: max, notes, sort }),
    );

    for (const [code, name, sort, applies, days, kiln, qc, pack, color, instructions] of STAGES) {
      insert('stages', { code, name, sort, applies_to: applies, typical_days: days, is_kiln: kiln, is_qc: qc, is_packing: pack, color, instructions });
    }

    insert('kilns', { code: 'K1', name: 'Kiln 1', workshop: 'TET', capacity_m2: 60 });
    insert('kilns', { code: 'K2', name: 'Kiln 2', workshop: 'TET', capacity_m2: 60 });

    seedWarehouse('TET', 'Tétouan factory', TET_ZONES);
    seedWarehouse('FES', 'Fès workshop', FES_ZONES);

    for (const [code, name, category, unit, min] of MATERIALS) insert('materials', { code, name, category, unit, min_stock: min });

    createTileProducts();
    seedBom();
  });
  return true;
}

/** One tile product per format x colour (glazed colours on glazed formats, natural on plain formats). */
export function createTileProducts() {
  const formats = all("SELECT * FROM formats WHERE family = 'zellige' AND active = 1");
  const colours = all('SELECT * FROM colours WHERE active = 1');
  let created = 0;
  for (const c of colours) {
    // glaze material per glazed colour (used by the BOM)
    if (c.finish === 'glazed' && !get('SELECT 1 FROM materials WHERE colour_id = ?', c.id)) {
      const code = `GLZ-${c.code}`;
      if (!get('SELECT 1 FROM materials WHERE code = ?', code)) {
        insert('materials', { code, name: `Glaze ${c.code} ${c.name}`, category: 'glaze', unit: 'kg', min_stock: 50, colour_id: c.id });
      }
    }
    for (const f of formats) {
      if (c.finish === 'natural' && f.painted) continue;
      if (f.painted && isVeryLight(c.hex)) continue;
      if (get("SELECT 1 FROM products WHERE kind = 'tile' AND format_id = ? AND colour_id = ?", f.id, c.id)) continue;
      const sku = `${f.code}-${c.code}`;
      if (get('SELECT 1 FROM products WHERE sku = ?', sku)) continue;
      insert('products', {
        sku,
        kind: 'tile',
        format_id: f.id,
        colour_id: c.id,
        name: `${c.code} ${c.name} · ${f.name}`,
        unit: f.sell_unit,
        hs_code: '6907',
      });
      created++;
    }
  }
  return created;
}

function isVeryLight(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const l = (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
  return l > 225;
}

function seedBom() {
  const st = Object.fromEntries(all('SELECT id, code FROM stages').map((s) => [s.code, s.id]));
  const mat = Object.fromEntries(all('SELECT id, code FROM materials').map((m) => [m.code, m.id]));
  const fmt = Object.fromEntries(all('SELECT id, code FROM formats').map((f) => [f.code, f.id]));
  const rule = (material, stage, format, finish, per, qty, colourSpecific = 0, notes = 'Estimate - set your measured figure', family = 'zellige') =>
    insert('bom_rules', {
      material_id: material ? mat[material] : null,
      stage_id: st[stage],
      format_id: format ? fmt[format] : null,
      family,
      finish,
      per,
      qty,
      colour_specific: colourSpecific,
      notes,
    });
  rule('CLAY-TET', 'SHAPE', null, 'all', 'm2', 24);
  rule('CLAY-TET', 'SHAPE', 'BE', 'all', 'm2', 42);
  rule('CLAY-TET', 'SHAPE', 'BB', 'all', 'm2', 42);
  rule('CLAY-TET', 'SHAPE', 'BS', 'all', 'm2', 30);
  rule(null, 'GLAZE', null, 'glazed', 'm2', 1.2, 1, 'Glaze of the product colour - estimate');
  rule('FUEL-OLIVE', 'FIRE', null, 'all', 'm2', 5);
  rule('BOX-ZEL', 'PACK', null, 'all', 'box', 1, 0, 'One carton per box');
  rule('SAWDUST', 'PACK', null, 'all', 'box', 0.5);
  rule('PALLET', 'PACK', null, 'all', 'box', 1 / 78, 0, 'One pallet per 78 boxes');
  rule('BOX-CEM', 'PACK', null, 'all', 'box', 1, 0, 'One carton per box', 'cement');
  rule('PALLET', 'PACK', null, 'all', 'box', 1 / 60, 0, 'One pallet per 60 boxes', 'cement');
}
