import { useMemo, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { fmtQty } from '../lib/format.js';
import { boot } from '../lib/store.js';
import { Modal, Button, Loading, Seg } from './ui.js';

let cache = null;
let cacheAt = 0;
export async function loadProducts(force = false) {
  if (!cache || force || Date.now() - cacheAt > 60000) {
    cache = (await get('/products')).rows;
    cacheAt = Date.now();
  }
  return cache;
}

/** Visual product chooser. multi=true returns an array. */
export function ProductPicker({ onPick, onClose, title = 'Choose a product', multi = false, filter }) {
  const { data, loading } = useAsync(() => loadProducts(), []);
  const [q, setQ] = useState('');
  const [fmt, setFmt] = useState('');
  const [colour, setColour] = useState('');
  const [sel, setSel] = useState([]);
  const formats = boot().formats || [];
  const colours = boot().colours || [];

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (data || [])
      .filter((p) => (filter ? filter(p) : true))
      .filter((p) => !fmt || String(p.format_id) === fmt)
      .filter((p) => !colour || String(p.colour_id) === colour)
      .filter((p) => !ql || `${p.sku} ${p.name} ${p.colour_name || ''} ${p.format_name || ''}`.toLowerCase().includes(ql));
  }, [data, q, fmt, colour]);

  const toggle = (p) => setSel((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : [...s, p]));
  const usedFormats = formats.filter((f) => (data || []).some((p) => p.format_id === f.id));

  return html`<${Modal}
    title=${title}
    size="xwide"
    onClose=${onClose}
    footer=${multi
      ? html`<span class="muted small" style="margin-right:auto">${sel.length} selected</span><${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" disabled=${!sel.length} onClick=${() => onPick(sel)}>Add ${sel.length || ''} product${sel.length === 1 ? '' : 's'}<//>`
      : null}
  >
    <div class="row wrap mb-2">
      <input class="input" style="flex:1;min-width:200px" placeholder="Search SKU, colour or format…" value=${q} onInput=${(e) => setQ(e.target.value)} autoFocus />
      <select class="select" style="width:auto" value=${colour} onChange=${(e) => setColour(e.target.value)}>
        <option value="">All colours</option>
        ${colours.map((c) => html`<option value=${c.id}>${c.code} ${c.name}</option>`)}
      </select>
    </div>
    <div class="mb-2" style="overflow-x:auto">
      <${Seg} value=${fmt} onChange=${setFmt} options=${[{ value: '', label: 'All formats' }, ...usedFormats.map((f) => ({ value: String(f.id), label: f.code }))]} />
    </div>
    ${loading && !data
      ? html`<${Loading} />`
      : html`<div class="product-grid">
          ${rows.slice(0, 300).map((p) => {
            const on = sel.some((x) => x.id === p.id);
            return html`<button type="button" class=${`p-card ${on ? 'on' : ''}`} onClick=${() => (multi ? toggle(p) : onPick(p))}>
              <img src=${p.image_url} alt="" loading="lazy" />
              <div class="p-body">
                <span class="p-sku">${p.sku}</span>
                <span class="p-name">${p.colour_name || p.name}</span>
                <span class="p-name muted">${p.format_name || p.kind}</span>
                <span class="p-stock"><span>${p.available ? `${fmtQty(p.available_m2 || p.available)} ${p.available_m2 ? 'm²' : 'boxes'} free` : 'No free stock'}</span>${p.lead_free ? html`<span>Lead-free</span>` : null}</span>
              </div>
            </button>`;
          })}
        </div>
        ${!rows.length && html`<div class="empty"><p>No product matches. Add colours or formats in Settings → Catalogue.</p></div>`}`}
  <//>`;
}
