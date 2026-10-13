import { UNITS } from '/shared/constants.js';

const nf = new Map();
function numberFormat(min, max) {
  const k = `${min}|${max}`;
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat('en-GB', { minimumFractionDigits: min, maximumFractionDigits: max }));
  return nf.get(k);
}

const empty = (n) => n === null || n === undefined || n === '' || Number.isNaN(Number(n));

export const fmtNum = (n, d = 0) => (empty(n) ? '—' : numberFormat(d, d).format(Number(n)));
/** Up to `max` decimals, no trailing zeros. */
export const fmtQty = (n, max = 2) => (empty(n) ? '—' : numberFormat(0, max).format(Number(n)));

const SYMBOL = { EUR: '€', USD: '$', GBP: '£' };
export function money(n, cur = '', { decimals = 2 } = {}) {
  if (empty(n)) return '—';
  const v = numberFormat(decimals, decimals).format(Math.abs(Number(n)));
  const sign = Number(n) < 0 ? '−' : '';
  return SYMBOL[cur] ? `${sign}${SYMBOL[cur]}${v}` : `${sign}${v}${cur ? ` ${cur}` : ''}`;
}
export function moneyCompact(n, cur = '') {
  if (empty(n)) return '—';
  const a = Math.abs(Number(n));
  const v = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `${Math.round(a / 1e3)}K` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : `${Math.round(a)}`;
  return SYMBOL[cur] ? `${SYMBOL[cur]}${v}` : `${v} ${cur}`.trim();
}
export const compact = (n) => {
  if (empty(n)) return '—';
  const a = Math.abs(n);
  return a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K` : String(Math.round(n));
};

function parse(d) {
  if (!d) return null;
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
  return new Date(`${s.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'}`);
}
export const fmtDate = (d) => {
  const x = parse(d);
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
};
export const fmtDateShort = (d) => {
  const x = parse(d);
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
};
export const fmtDateTime = (d) => {
  const x = parse(d);
  return x && !Number.isNaN(x.getTime()) ? x.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
};
export function ago(d) {
  const x = parse(d);
  if (!x) return '—';
  const s = (Date.now() - x.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}
export function daysUntil(d) {
  const x = parse(d);
  if (!x) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((x - today) / 86400000);
}
export const today = () => new Date().toISOString().slice(0, 10);
export const unitLabel = (u) => UNITS[u] || u || '';
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
export const plural = (n, one, many) => `${fmtNum(n)} ${Number(n) === 1 ? one : many || `${one}s`}`;
export const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
