import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lineQuantities, docTotals, packingSummary, containerCheck, computedPrice, tierCheck, promisedDate, targetPieces, packPieces, evaluateQc, isDarkHex,
} from '../shared/calc.js';

const ZR10 = { pcs_per_m2: 100, pcs_per_box: 100, m2_per_box: 1, kg_per_box: 20, length_cm: 10, boxes_per_pallet: 78 };
const HX09 = { pcs_per_m2: 137, pcs_per_box: 100, m2_per_box: 0.73, kg_per_box: 12 };
const BS = { pcs_per_m2: 135, pcs_per_box: 110, m2_per_box: 0.81, kg_per_box: 20, length_cm: 15 };

test('m² line adds overage and rounds up to full boxes', () => {
  const q = lineQuantities(ZR10, { unit: 'm2', net_qty: 250, overage_pct: 15 });
  assert.equal(q.gross_m2, 287.5);
  assert.equal(q.boxes, 288);
  assert.equal(q.qty, 288);
  assert.equal(q.pieces, 28800);
  assert.equal(q.weight_kg, 5760);
});

test('hexagon boxes cover 0.73 m² each', () => {
  const q = lineQuantities(HX09, { unit: 'm2', net_qty: 10, overage_pct: 15 });
  assert.equal(q.boxes, 16); // 11.5 / 0.73 = 15.75 -> 16
  assert.equal(q.qty, 11.68);
  assert.equal(q.pieces, 1600);
});

test('without a net surface, qty is the gross m² (no overage applied twice)', () => {
  const q = lineQuantities(ZR10, { unit: 'm2', qty: 100.2, overage_pct: 15 });
  assert.equal(q.boxes, 101);
  assert.equal(q.qty, 101);
});

test('linear metres of plint', () => {
  const q = lineQuantities(BS, { unit: 'lm', net_qty: 30, overage_pct: 10 });
  assert.equal(q.qty, 33);
  assert.equal(q.pieces, 220); // 3300 cm / 15 cm
  assert.equal(q.boxes, 2);
});

test('document totals with discount, freight, VAT and deposit', () => {
  const t = docTotals([{ line_total: 1000 }, { line_total: 500 }], { discount_pct: 10, freight: 100, handling_fee: 50, vat_rate: 20, deposit_pct: 50, paid: 300 });
  assert.equal(t.linesTotal, 1500);
  assert.equal(t.discount, 150);
  assert.equal(t.taxable, 1500);
  assert.equal(t.vat, 300);
  assert.equal(t.total, 1800);
  assert.equal(t.deposit, 900);
  assert.equal(t.balance, 1500);
});

test('pallets and container suggestion follow the spec (78 boxes per pallet, 18 pallets per 40 ft)', () => {
  const small = packingSummary([{ boxes: 150, weight_kg: 3000, family: 'zellige', boxes_per_pallet: 78 }]);
  assert.equal(small.pallets, 2);
  assert.equal(small.suggestion.mode, 'groupage');
  const twenty = packingSummary([{ boxes: 700, weight_kg: 14000, family: 'zellige', boxes_per_pallet: 78 }]);
  assert.equal(twenty.pallets, 9);
  assert.equal(twenty.suggestion.mode, 'container_20');
  const forty = packingSummary([{ boxes: 1056, weight_kg: 20592, family: 'zellige', boxes_per_pallet: 78 }], { max_payload_40: 26500 });
  assert.equal(forty.pallets, 14);
  assert.equal(forty.suggestion.mode, 'container_40');
  const two = packingSummary([{ boxes: 2000, weight_kg: 40000, family: 'zellige', boxes_per_pallet: 78 }], { max_payload_40: 26500 });
  assert.equal(two.suggestion.count, 2);
});

test('container check flags overweight loads', () => {
  const c = containerCheck('container_40', { zellige: 18 }, 28100, 26500);
  assert.equal(c.ok, false);
  assert.match(c.messages[0], /over the payload/);
});

test('price = cost × multiplier × colour adjustment, converted', () => {
  const p = computedPrice({ cost: 350, multiplier: 1.25, adjustPct: 9, baseCurrency: 'MAD', currency: 'EUR', rates: { MAD: 1, EUR: 10.8 } });
  assert.equal(p, 44.16);
});

test('tier minimums', () => {
  assert.equal(tierCheck({ name: 'Wholesale', min_pallets: 3 }, 2).level, 'warn');
  assert.equal(tierCheck({ name: 'Wholesale', min_pallets: 3 }, 4), null);
});

test('lead time counts from the later of colour approval and deposit', () => {
  assert.equal(promisedDate('2026-03-01', '2026-03-10', 2), '2026-03-24');
  assert.equal(promisedDate(null, '2026-03-10', 2), null);
});

test('production pieces include loss and pack into full boxes and pallets', () => {
  assert.equal(targetPieces(288, { pcs_per_box: 100, production_loss_pct: 10 }), 31680);
  const p = packPieces(29050, { pcs_per_box: 100, boxes_per_pallet: 78 });
  assert.equal(p.boxes, 290);
  assert.equal(p.loose, 50);
  assert.deepEqual(p.pallets, [78, 78, 78, 56]);
});

test('QC standard: glazed allows heavier variation than natural; dark glazes one level more chips', () => {
  assert.equal(evaluateQc({ colour_var: 3, pits_chips: 2, crazing: 2 }, 'glazed', '#f1ece1').result, 'pass');
  assert.equal(evaluateQc({ colour_var: 3 }, 'natural', '#c47a4c').result, 'hold');
  assert.equal(isDarkHex('#1e1d1f'), true);
  assert.equal(evaluateQc({ pits_chips: 3 }, 'glazed', '#1e1d1f').result, 'pass');
  assert.equal(evaluateQc({ pits_chips: 3 }, 'glazed', '#f1ece1').result, 'hold');
  assert.equal(evaluateQc({ matches_reference: 0 }, 'glazed', '#f1ece1').result, 'hold');
});
