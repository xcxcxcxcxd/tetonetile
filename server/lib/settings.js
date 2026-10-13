import { all, setSetting } from '../db.js';
import { DEFAULT_TERMS } from '../../shared/constants.js';

// Every setting has a default here; what is stored in the database overrides it.
export const DEFAULT_SETTINGS = {
  base_currency: 'MAD',
  // Base-currency units for 1 unit of each currency. Approximate - update in Settings.
  rates: { MAD: 1, EUR: 10.8, USD: 9.3, GBP: 12.6, AED: 2.53 },
  rates_updated: null,
  public_url: '',
  defaults: {
    currency: 'EUR',
    overage_pct: 15,
    deposit_pct: 50,
    quote_validity_days: 30,
    lead_time_weeks: 12,
    invoice_due_days: 30,
    vat_rate_domestic: 20,
    vat_note_export: 'Export sale - exempt from Moroccan VAT.',
    payment_terms: '50% deposit on order confirmation; balance before loading.',
    incoterm: 'FCA',
    incoterm_place: 'Tanger Med',
    small_order_fee: 0,
    small_order_below_pallets: 1,
  },
  logistics: {
    pallet_kg: 25,
    max_payload_20: 21500,
    max_payload_40: 26500,
    port_loading: 'Tanger Med',
    forwarders: [],
    book_weeks_before_ready: 3,
  },
  production: {
    default_workshop: 'TET',
    auto_consume: false,
    receiving_location_code: 'TET-IN01',
  },
  terms: DEFAULT_TERMS,
  setup_done: false,
};

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function getSettings() {
  const stored = {};
  for (const r of all('SELECT key, value FROM settings')) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore broken values */
    }
  }
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = stored[k];
    out[k] = isObj(def) && isObj(v) ? { ...def, ...v } : v !== undefined ? v : def;
  }
  return out;
}

export function saveSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    setSetting(k, v);
  }
  return getSettings();
}

export function publicBase(req) {
  const s = getSettings();
  const fromSettings = (s.public_url || '').replace(/\/+$/, '');
  if (fromSettings) return fromSettings;
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
