import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { useDebounced } from '../lib/hooks.js';
import { get, qs } from '../lib/api.js';
import { Icon } from './icons.js';

/** Searchable select. search(q) returns a list; getLabel(item) shows it in the field. */
export function Combobox({ value, onChange, search, getLabel = (x) => x?.label || '', renderItem, placeholder = 'Search…', autoFocus, allowClear = true, footer }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const dq = useDebounced(q, 180);
  const box = useRef();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    Promise.resolve(search(dq))
      .then((r) => alive && (setItems(r || []), setActive(0)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dq, open]);

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (it) => {
    onChange(it);
    setOpen(false);
    setQ('');
  };

  return html`<div class="combo" ref=${box}>
    <div class="input-group">
      <input
        class="input"
        value=${open ? q : getLabel(value)}
        placeholder=${placeholder}
        autoFocus=${autoFocus}
        onFocus=${() => setOpen(true)}
        onInput=${(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown=${(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && open && items[active]) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === 'Escape') setOpen(false);
        }}
        style="border-radius:8px 0 0 8px"
      />
      <span class="addon" style="cursor:pointer" onClick=${() => (value && allowClear ? onChange(null) : setOpen(!open))}>
        <${Icon} name=${value && allowClear ? 'x' : 'chevronDown'} size="14" />
      </span>
    </div>
    ${open &&
    html`<div class="combo-list">
      ${loading && !items.length ? html`<div class="combo-empty">Searching…</div>` : null}
      ${!loading && !items.length ? html`<div class="combo-empty">No match</div>` : null}
      ${items.map(
        (it, i) => html`<div class=${`combo-item ${i === active ? 'on' : ''}`} onMouseDown=${(e) => (e.preventDefault(), pick(it))} onMouseEnter=${() => setActive(i)}>
          ${renderItem ? renderItem(it) : getLabel(it)}
        </div>`,
      )}
      ${footer}
    </div>`}
  </div>`;
}

export function ClientPicker({ value, onChange, autoFocus }) {
  return html`<${Combobox}
    value=${value}
    onChange=${onChange}
    autoFocus=${autoFocus}
    placeholder="Search clients…"
    getLabel=${(c) => (c ? c.company : '')}
    search=${async (q) => (await get(`/clients${qs({ q })}`)).rows.slice(0, 30)}
    renderItem=${(c) => html`<div class="truncate"><b>${c.company}</b> <span class="muted small">${[c.country, c.code].filter(Boolean).join(' · ')}</span></div>`}
  />`;
}
