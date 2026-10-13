// Packaging, quantity, price and QC maths shared by the server and the browser.
// Every rule here comes from the Zelligerar Material Specification / Technical
// Data Sheet unless noted. Keep this file dependency-free (it is served as-is).

export const SQFT_PER_M2 = 10.7639;
export const LB_PER_KG = 2.20462;

export const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
export const round3 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 1000) / 1000;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const ceilSafe = (n) => Math.ceil(n - 1e-9);

/**
 * Billed quantities for one document line.
 *
 * fmt   - the product format { pcs_per_m2, pcs_per_box, m2_per_box, kg_per_box, length_cm }
 * input - { unit, net_qty, overage_pct, qty }
 *   unit 'm2'  : net_qty is the net measured surface. Overage is added, then the
 *                quantity is rounded UP to full boxes (tiles ship in full boxes).
 *                Without net_qty, qty is taken as the gross m2 wanted (no overage).
 *   unit 'pc'  : qty pieces.
 *   unit 'lm'  : net_qty linear metres + overage (or qty as gross lm) - plint / frieze.
 *   unit 'box' : qty boxes.
 *   unit 'unit': services, freight, sample boxes - qty as entered.
 */
export function lineQuantities(fmt, input) {
  const unit = input.unit || 'm2';
  const ov = num(input.overage_pct) ?? 0;
  const f = fmt || {};
  const pcsPerBox = num(f.pcs_per_box);
  const m2PerBox = num(f.m2_per_box);
  const kgPerBox = num(f.kg_per_box);
  const pcsPerM2 = num(f.pcs_per_m2);
  const out = { qty: 0, boxes: null, pieces: null, weight_kg: null, gross_m2: null };

  const net = num(input.net_qty);
  if (unit === 'm2') {
    const gross = net !== null ? net * (1 + ov / 100) : num(input.qty) ?? 0;
    out.gross_m2 = round2(gross);
    if (m2PerBox) {
      const boxes = gross > 0 ? ceilSafe(gross / m2PerBox) : 0;
      out.boxes = boxes;
      out.qty = round2(boxes * m2PerBox);
      out.pieces = pcsPerBox ? boxes * pcsPerBox : pcsPerM2 ? Math.round(out.qty * pcsPerM2) : null;
      out.weight_kg = kgPerBox ? round2(boxes * kgPerBox) : null;
    } else {
      out.qty = round2(gross);
      out.pieces = pcsPerM2 ? ceilSafe(gross * pcsPerM2) : null;
    }
    return out;
  }

  if (unit === 'pc') {
    const pcs = Math.max(0, ceilSafe(num(input.qty) ?? 0));
    out.qty = pcs;
    out.pieces = pcs;
    if (pcsPerBox) {
      out.boxes = ceilSafe(pcs / pcsPerBox);
      out.weight_kg = kgPerBox ? round2((pcs / pcsPerBox) * kgPerBox) : null;
    }
    return out;
  }

  if (unit === 'lm') {
    const lm = net !== null ? net * (1 + ov / 100) : num(input.qty) ?? 0;
    out.qty = round2(lm);
    const len = num(f.length_cm);
    if (len) {
      const pcs = ceilSafe((lm * 100) / len);
      out.pieces = pcs;
      if (pcsPerBox) {
        out.boxes = ceilSafe(pcs / pcsPerBox);
        out.weight_kg = kgPerBox ? round2((pcs / pcsPerBox) * kgPerBox) : null;
      }
    }
    return out;
  }

  if (unit === 'box') {
    const boxes = Math.max(0, ceilSafe(num(input.qty) ?? 0));
    out.qty = boxes;
    out.boxes = boxes;
    out.pieces = pcsPerBox ? boxes * pcsPerBox : null;
    out.gross_m2 = m2PerBox ? round2(boxes * m2PerBox) : null;
    out.weight_kg = kgPerBox ? round2(boxes * kgPerBox) : null;
    return out;
  }

  out.qty = round2(num(input.qty) ?? 0);
  return out;
}

export function lineTotal(qty, unitPrice, discountPct) {
  return round2((Number(qty) || 0) * (Number(unitPrice) || 0) * (1 - (Number(discountPct) || 0) / 100));
}

/** Totals for a quote / order / invoice. `paid` is what has been received so far. */
export function docTotals(lines, doc = {}) {
  const linesTotal = round2((lines || []).reduce((s, l) => s + (Number(l.line_total) || 0), 0));
  const discount = round2((linesTotal * (Number(doc.discount_pct) || 0)) / 100);
  const freight = round2(doc.freight);
  const handling = round2(doc.handling_fee);
  const taxable = round2(linesTotal - discount + freight + handling);
  const vat = round2((taxable * (Number(doc.vat_rate) || 0)) / 100);
  const total = round2(taxable + vat);
  const deposit = round2((total * (Number(doc.deposit_pct) || 0)) / 100);
  const paid = round2(doc.paid);
  return { linesTotal, discount, freight, handling, taxable, vat, total, deposit, paid, balance: round2(total - paid) };
}

// ---------------------------------------------------------------------------
// Pallets and containers (Material Specification §09-10, Characteristics sheet)
// ---------------------------------------------------------------------------
export const CONTAINER_PALLETS = {
  zellige: { container_20: 10, container_40: 18 },
  cement: { container_20: 20, container_40: 22 },
  terracotta: { container_20: 10, container_40: 18 },
  other: { container_20: 10, container_40: 18 },
};

/**
 * lines: [{ boxes, weight_kg, family, boxes_per_pallet }]
 * opts : { pallet_kg, max_payload_20, max_payload_40 }
 * Colours and formats of the same family can share a pallet.
 */
export function packingSummary(lines, opts = {}) {
  const palletKg = Number(opts.pallet_kg ?? 25);
  const fams = {};
  let boxes = 0;
  let netKg = 0;
  for (const l of lines || []) {
    if (!l.boxes) continue;
    const fam = l.family || 'zellige';
    const per = Number(l.boxes_per_pallet) || (fam === 'cement' ? 60 : 78);
    fams[fam] = fams[fam] || { boxes: 0, per };
    fams[fam].boxes += Number(l.boxes);
    boxes += Number(l.boxes);
    netKg += Number(l.weight_kg) || 0;
  }
  let pallets = 0;
  let fill20 = 0;
  let fill40 = 0;
  for (const [fam, v] of Object.entries(fams)) {
    const p = ceilSafe(v.boxes / v.per);
    v.pallets = p;
    pallets += p;
    const cap = CONTAINER_PALLETS[fam] || CONTAINER_PALLETS.other;
    fill20 += p / cap.container_20;
    fill40 += p / cap.container_40;
  }
  const grossKg = round2(netKg + pallets * palletKg);
  const max20 = Number(opts.max_payload_20 ?? 21500);
  const max40 = Number(opts.max_payload_40 ?? 26500);
  let suggestion;
  if (boxes === 0) suggestion = { mode: null, label: 'No tiles' };
  else if (pallets <= 4 && fill20 < 0.5) suggestion = { mode: 'groupage', label: `Groupage · ${pallets} pallet${pallets === 1 ? '' : 's'}` };
  else if (fill20 <= 1 && grossKg <= max20) suggestion = { mode: 'container_20', label: '1 × 20 ft container', volumePct: Math.round(fill20 * 100), weightPct: Math.round((grossKg / max20) * 100) };
  else if (fill40 <= 1 && grossKg <= max40) suggestion = { mode: 'container_40', label: '1 × 40 ft container', volumePct: Math.round(fill40 * 100), weightPct: Math.round((grossKg / max40) * 100) };
  else {
    const n = Math.max(ceilSafe(fill40), ceilSafe(grossKg / max40));
    suggestion = { mode: 'container_40', label: `${n} × 40 ft containers`, count: n, volumePct: Math.round((fill40 / n) * 100), weightPct: Math.round((grossKg / (max40 * n)) * 100) };
  }
  return { boxes, pallets, netKg: round2(netKg), grossKg, families: fams, fill20: round3(fill20), fill40: round3(fill40), suggestion };
}

/** Container load check for a shipment (pallets by family + weight). */
export function containerCheck(mode, pallets, grossKg, maxPayloadKg) {
  if (!mode || !mode.startsWith('container')) return { ok: true, volumePct: null, weightPct: null, messages: [] };
  const messages = [];
  let fill = 0;
  for (const [fam, p] of Object.entries(pallets || {})) {
    const cap = (CONTAINER_PALLETS[fam] || CONTAINER_PALLETS.other)[mode];
    fill += p / cap;
  }
  const volumePct = Math.round(fill * 100);
  const weightPct = maxPayloadKg ? Math.round((grossKg / maxPayloadKg) * 100) : null;
  if (volumePct > 100) messages.push(`Pallets exceed the ${mode === 'container_20' ? '20 ft' : '40 ft'} capacity (${volumePct}%).`);
  if (weightPct !== null && weightPct > 100) messages.push(`Gross weight ${Math.round(grossKg).toLocaleString('en')} kg is over the payload limit of ${Math.round(maxPayloadKg).toLocaleString('en')} kg.`);
  return { ok: messages.length === 0, volumePct, weightPct, messages };
}

// ---------------------------------------------------------------------------
// Pricing: price = cost x tier multiplier x (1 + colour adjustment), converted
// ---------------------------------------------------------------------------
/** rates: { MAD: 1, EUR: 10.8, USD: 9.3 } = base-currency units for 1 unit of currency. */
export function convert(amount, from, to, rates) {
  if (from === to) return Number(amount) || 0;
  const rFrom = Number(rates?.[from]);
  const rTo = Number(rates?.[to]);
  if (!rFrom || !rTo) return null;
  return ((Number(amount) || 0) * rFrom) / rTo;
}

export function computedPrice({ cost, multiplier, adjustPct, baseCurrency, currency, rates }) {
  const base = (Number(cost) || 0) * (Number(multiplier) || 1) * (1 + (Number(adjustPct) || 0) / 100);
  const v = convert(base, baseCurrency, currency, rates);
  return v === null ? null : round2(v);
}

/** Checks the order size against a pricing tier's minimum (Logistics & Pricing plan). */
export function tierCheck(tier, pallets) {
  if (!tier) return null;
  const min = num(tier.min_pallets);
  const max = num(tier.max_pallets);
  if (min !== null && pallets < min) return { level: 'warn', text: `${tier.name} pricing starts at ${min} pallet${min === 1 ? '' : 's'}; this order is ${pallets}.` };
  if (max !== null && pallets > max) return { level: 'info', text: `${pallets} pallets is above the ${tier.name} band; a better tier may apply.` };
  return null;
}

// ---------------------------------------------------------------------------
// Lead time and production
// ---------------------------------------------------------------------------
export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/** Lead time is counted from written colour approval AND receipt of the deposit. */
export function promisedDate(colourApprovedAt, depositReceivedAt, leadTimeWeeks) {
  if (!colourApprovedAt || !depositReceivedAt || !leadTimeWeeks) return null;
  const start = [String(colourApprovedAt).slice(0, 10), String(depositReceivedAt).slice(0, 10)].sort()[1];
  return addDays(start, Number(leadTimeWeeks) * 7);
}

/** Pieces to start so that `boxes` full boxes survive production losses. */
export function targetPieces(boxes, fmt) {
  const per = Number(fmt?.pcs_per_box) || 0;
  const loss = Number(fmt?.production_loss_pct ?? 10);
  return ceilSafe(boxes * per * (1 + loss / 100));
}

/** Split good pieces into full boxes and pallets. */
export function packPieces(goodPcs, fmt) {
  const per = Number(fmt?.pcs_per_box) || 0;
  const perPallet = Number(fmt?.boxes_per_pallet) || 78;
  if (!per) return { boxes: 0, loose: goodPcs, pallets: [] };
  const boxes = Math.floor(goodPcs / per);
  const loose = goodPcs - boxes * per;
  const pallets = [];
  let left = boxes;
  while (left > 0) {
    pallets.push(Math.min(perPallet, left));
    left -= perPallet;
  }
  return { boxes, loose, pallets };
}

export function m2FromBoxes(boxes, fmt) {
  return round2((Number(boxes) || 0) * (Number(fmt?.m2_per_box) || 0));
}

// ---------------------------------------------------------------------------
// Quality: Variation & Imperfection standard (Material Specification §06)
// ---------------------------------------------------------------------------
export const VARIATION_SCALES = {
  colour_var: { label: 'Colour variation', scale: ['low', 'slight', 'medium', 'heavy', 'extreme'] },
  texture_var: { label: 'Texture variation', scale: ['smooth', 'slight', 'medium', 'heavy'] },
  size_var: { label: 'Size variation', scale: ['slight', 'medium', 'heavy', 'extreme'] },
  pits_chips: { label: 'Pits / chips', scale: ['will occur', 'prevalent', 'heavy'] },
  crazing: { label: 'Cracks / crazing', scale: ['will occur', 'prevalent', 'heavy'] },
  iron_spots: { label: 'Iron spots', scale: ['will occur', 'prevalent', 'heavy'] },
};

export const VARIATION_STANDARD = {
  glazed: { colour_var: 3, texture_var: 3, size_var: 3, pits_chips: 2, crazing: 2, iron_spots: 1 },
  natural: { colour_var: 2, texture_var: 3, size_var: 3, pits_chips: 2, crazing: 1, iron_spots: 1 },
};

export function isDarkHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L < 0.12;
}

/** Allowed levels for a colour. Dark glazes may be rated one level higher for pits, chips and crazing. */
export function allowedVariation(finish, hex) {
  const base = { ...(VARIATION_STANDARD[finish] || VARIATION_STANDARD.glazed) };
  if (finish !== 'natural' && isDarkHex(hex)) {
    base.pits_chips = Math.min(3, base.pits_chips + 1);
    base.crazing = Math.min(3, base.crazing + 1);
  }
  return base;
}

/** Returns { result: 'pass'|'hold', exceeded: [{key,label,level,allowed}] } */
export function evaluateQc(levels, finish, hex) {
  const allowed = allowedVariation(finish, hex);
  const exceeded = [];
  for (const [key, max] of Object.entries(allowed)) {
    const v = num(levels?.[key]);
    if (v !== null && v > max) exceeded.push({ key, label: VARIATION_SCALES[key].label, level: v, allowed: max });
  }
  if (levels && Number(levels.matches_reference) === 0) {
    exceeded.push({ key: 'matches_reference', label: 'Colour does not match the approved reference', level: 0, allowed: 1 });
  }
  return { result: exceeded.length ? 'hold' : 'pass', exceeded, allowed };
}

export const toSqft = (m2) => round2((Number(m2) || 0) * SQFT_PER_M2);
export const toLb = (kg) => Math.round((Number(kg) || 0) * LB_PER_KG);
