import { bad } from './http.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce and validate a request body against a field spec.
 * spec: { field: { type, required, default, values, min, max, upper } }
 * types: text, email, int, fk, num, bool, date, datetime, enum, json, color
 */
export function clean(spec, body = {}, { partial = false } = {}) {
  const out = {};
  const errors = {};
  for (const [key, def] of Object.entries(spec)) {
    if (def.readonly) continue;
    const present = Object.prototype.hasOwnProperty.call(body, key);
    if (!present) {
      if (partial) continue;
      if (def.default !== undefined) out[key] = def.default;
      else if (def.required) errors[key] = 'Required';
      continue;
    }
    let v;
    try {
      v = coerce(def, body[key]);
    } catch (e) {
      errors[key] = e.message;
      continue;
    }
    if ((v === null || v === undefined) && def.required) {
      errors[key] = 'Required';
      continue;
    }
    if (v === null && def.default !== undefined && def.notNull) v = def.default;
    out[key] = v;
  }
  if (Object.keys(errors).length) {
    const first = Object.entries(errors)[0];
    throw bad(`${labelOf(spec, first[0])}: ${first[1]}`, { fields: errors });
  }
  return out;
}

const labelOf = (spec, key) => spec[key]?.label || key.replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function coerce(def, v) {
  if (v === undefined) return null;
  switch (def.type) {
    case 'text':
    case 'email': {
      if (v === null) return null;
      let s = String(v).trim();
      if (s === '') return null;
      if (def.max && s.length > def.max) throw new Error(`Maximum ${def.max} characters`);
      if (def.upper) s = s.toUpperCase();
      if (def.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error('Not a valid email');
      return s;
    }
    case 'int':
    case 'fk': {
      if (v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isInteger(n)) throw new Error('Must be a whole number');
      if (def.min !== undefined && n < def.min) throw new Error(`Must be at least ${def.min}`);
      if (def.max !== undefined && n > def.max) throw new Error(`Must be at most ${def.max}`);
      return n;
    }
    case 'num': {
      if (v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error('Must be a number');
      if (def.min !== undefined && n < def.min) throw new Error(`Must be at least ${def.min}`);
      if (def.max !== undefined && n > def.max) throw new Error(`Must be at most ${def.max}`);
      return n;
    }
    case 'bool':
      return v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
    case 'date': {
      if (v === null || v === '') return null;
      const s = String(v).slice(0, 10);
      if (!DATE_RE.test(s) || Number.isNaN(Date.parse(s))) throw new Error('Not a valid date');
      return s;
    }
    case 'datetime': {
      if (v === null || v === '') return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new Error('Not a valid date and time');
      return d.toISOString().replace('T', ' ').slice(0, 19);
    }
    case 'enum': {
      if (v === null || v === '') return def.default !== undefined ? def.default : null;
      if (!def.values.includes(v)) throw new Error('Not an allowed value');
      return v;
    }
    case 'json':
      return v === null ? null : typeof v === 'string' ? v : JSON.stringify(v);
    case 'color': {
      if (v === null || v === '') return null;
      if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) throw new Error('Use a #RRGGBB colour');
      return String(v).toLowerCase();
    }
    default:
      return v;
  }
}
