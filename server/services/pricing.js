import { get } from '../db.js';
import { computedPrice } from '../../shared/calc.js';
import { getSettings } from '../lib/settings.js';
import { productRow } from './catalog.js';

/**
 * Unit price for a product, in order of precedence:
 *   1. the client's contract price (price_list with client_id)
 *   2. the tier price list (price_list with tier_id)
 *   3. cost x tier multiplier x (1 + colour adjustment), converted to the currency
 */
export function priceFor({ productId, clientId, tierId, currency }) {
  const p = productRow(productId);
  if (!p) return { price: 0, source: 'unknown' };
  if (clientId) {
    const r = get(
      `SELECT price FROM price_list WHERE product_id = ? AND client_id = ? AND currency = ?
       AND (valid_until IS NULL OR valid_until >= date('now')) ORDER BY id DESC LIMIT 1`,
      productId, clientId, currency,
    );
    if (r) return { price: r.price, source: 'contract' };
  }
  if (tierId) {
    const r = get(
      `SELECT price FROM price_list WHERE product_id = ? AND tier_id = ? AND client_id IS NULL AND currency = ?
       AND (valid_until IS NULL OR valid_until >= date('now')) ORDER BY id DESC LIMIT 1`,
      productId, tierId, currency,
    );
    if (r) return { price: r.price, source: 'list' };
  }
  if (!p.cost) return { price: 0, source: 'no_cost' };
  const s = getSettings();
  const tier = tierId ? get('SELECT multiplier FROM price_tiers WHERE id = ?', tierId) : null;
  const price = computedPrice({
    cost: p.cost,
    multiplier: tier?.multiplier ?? 1,
    adjustPct: p.price_adjust_pct,
    baseCurrency: s.base_currency,
    currency,
    rates: s.rates,
  });
  if (price === null) return { price: 0, source: 'no_rate' };
  return { price, source: 'computed' };
}
