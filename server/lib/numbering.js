import { get, run, tx } from '../db.js';

// Document and label numbering. Yearly series restart every January.
const SERIES = {
  quote: { prefix: 'Q', yearly: true, table: 'sales_docs', col: 'number' },
  order: { prefix: 'SO', yearly: true, table: 'sales_docs', col: 'number' },
  proforma: { prefix: 'PF', yearly: true, table: 'sales_docs', col: 'number' },
  invoice: { prefix: 'INV', yearly: true, table: 'sales_docs', col: 'number' },
  credit: { prefix: 'CN', yearly: true, table: 'sales_docs', col: 'number' },
  mo: { prefix: 'MO', yearly: true, table: 'manufacturing_orders', col: 'number' },
  kiln_load: { prefix: 'KL', yearly: true, table: 'kiln_loads', col: 'number' },
  shipment: { prefix: 'SH', yearly: true, table: 'shipments', col: 'number' },
  claim: { prefix: 'CL', yearly: true, table: 'claims', col: 'number' },
  sample: { prefix: 'SMP', yearly: true, table: 'samples', col: 'number' },
  po: { prefix: 'PO', yearly: true, table: 'purchase_orders', col: 'number' },
  lot: { prefix: 'L', lot: true, table: 'lots', col: 'code' },
  pallet: { prefix: 'PAL', table: 'stock_units', col: 'code' },
  boxes: { prefix: 'BX', table: 'stock_units', col: 'code' },
  material: { prefix: 'MAT', table: 'stock_units', col: 'code' },
  shipping: { prefix: 'SHP', table: 'stock_units', col: 'code' },
};

const pad = (n, w) => String(n).padStart(w, '0');

export function nextNumber(kind, date = new Date()) {
  const s = SERIES[kind];
  if (!s) throw new Error(`Unknown numbering series ${kind}`);
  const year = date.getFullYear();
  const period = s.yearly || s.lot ? String(year) : 'all';
  return tx(() => {
    for (;;) {
      run(
        `INSERT INTO counters (name, period, value) VALUES (?, ?, 1)
         ON CONFLICT(name, period) DO UPDATE SET value = value + 1`,
        kind,
        period,
      );
      const { value } = get('SELECT value FROM counters WHERE name = ? AND period = ?', kind, period);
      let number;
      if (s.lot) number = `${s.prefix}${String(year).slice(2)}-${pad(value, 4)}`;
      else if (s.yearly) number = `${s.prefix}-${year}-${pad(value, 4)}`;
      else number = `${s.prefix}-${pad(value, 6)}`;
      const taken = get(`SELECT 1 FROM ${s.table} WHERE ${s.col} = ?`, number);
      if (!taken) return number;
    }
  });
}

export const unitSeriesFor = (kind) => ({ pallet: 'pallet', boxes: 'boxes', material: 'material', shipping: 'shipping' })[kind] || 'pallet';
