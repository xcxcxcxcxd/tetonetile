import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, qs } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import { useStore, setState, openKb } from '../lib/store.js';
import { useDebounced, useHotkey } from '../lib/hooks.js';
import { Icon } from './icons.js';

const ACTIONS = [
  { title: 'New quote', icon: 'quote', url: '/docs/new?type=quote', keys: 'create quotation devis' },
  { title: 'New client', icon: 'users', url: '/clients?new=1', keys: 'add customer' },
  { title: 'Scan a QR code', icon: 'scan', url: '/scan', keys: 'camera label pallet' },
  { title: 'Production board', icon: 'factory', url: '/production', keys: 'mo stages kanban' },
  { title: 'Warehouse map', icon: 'map', url: '/warehouse', keys: 'locations racks positioning' },
  { title: 'Where is a product?', icon: 'pin', url: '/stock?tab=where', keys: 'find locate stock' },
  { title: 'Put away pallets', icon: 'pallet', url: '/warehouse/putaway', keys: 'putaway receiving' },
  { title: 'Kilns', icon: 'flame', url: '/production/kilns', keys: 'firing load' },
  { title: 'Print labels', icon: 'printer', url: '/labels', keys: 'qr label sticker' },
  { title: 'Shipments', icon: 'truck', url: '/shipments', keys: 'container loading' },
  { title: 'Knowledge base', icon: 'book', url: '/knowledge', keys: 'help procedure sop guide' },
  { title: 'Settings', icon: 'settings', url: '/settings', keys: 'configuration' },
];

export function CommandPalette() {
  const open = useStore((s) => s.palette);
  useHotkey((e) => (e.key === 'k' && (e.metaKey || e.ctrlKey)) || e.key === '/', (e) => {
    e.preventDefault();
    setState({ palette: true });
  }, { allowInInput: false });
  useHotkey((e) => e.key === 'k' && (e.metaKey || e.ctrlKey), (e) => {
    e.preventDefault();
    setState({ palette: true });
  }, { allowInInput: true });
  if (!open) return null;
  return html`<${Palette} />`;
}

function Palette() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 160);
  const input = useRef();
  const close = () => setState({ palette: false });

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    let alive = true;
    if (dq.trim().length < 2) {
      setRes(null);
      return;
    }
    get(`/search${qs({ q: dq.trim() })}`).then((r) => alive && (setRes(r), setActive(0))).catch(() => {});
    return () => {
      alive = false;
    };
  }, [dq]);

  const lower = q.trim().toLowerCase();
  const actions = ACTIONS.filter((a) => !lower || a.title.toLowerCase().includes(lower) || a.keys.includes(lower));
  const items = [];
  if (res?.exact) items.push({ group: 'Exact match', title: res.exact.title, subtitle: res.exact.subtitle || res.exact.type, url: res.exact.url, icon: 'target' });
  for (const g of res?.groups || []) for (const r of g.rows) items.push({ group: g.label, title: r.title, subtitle: r.subtitle, url: r.url, image: r.image, icon: 'arrowRight' });
  if (lower.length >= 2) items.push({ group: 'Knowledge', title: `Search the knowledge base for "${q.trim()}"`, icon: 'book', kb: q.trim() });
  for (const a of actions) items.push({ group: 'Go to', ...a });

  const go = (it) => {
    close();
    if (it.kb) {
      navigate(`/knowledge?q=${encodeURIComponent(it.kb)}`);
      return;
    }
    navigate(it.url);
  };

  let lastGroup = null;
  return html`<div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && close()}>
    <div class="palette" role="dialog" aria-label="Search">
      <div class="palette-input">
        <${Icon} name="search" />
        <input
          ref=${input}
          value=${q}
          placeholder="Search clients, documents, SKUs, lots, pallets, locations… or type a code"
          onInput=${(e) => setQ(e.target.value)}
          onKeyDown=${(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && items[active]) go(items[active]);
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div class="palette-results">
        ${items.map((it, i) => {
          const header = it.group !== lastGroup ? html`<div class="palette-group">${it.group}</div>` : null;
          lastGroup = it.group;
          return html`${header}<div class=${`palette-item ${i === active ? 'on' : ''}`} onMouseEnter=${() => setActive(i)} onClick=${() => go(it)}>
            <span class="pi-icon">${it.image ? html`<img src=${it.image} alt="" />` : html`<${Icon} name=${it.icon || 'arrowRight'} />`}</span>
            <span class="truncate"><b>${it.title}</b>${it.subtitle && html` <span class="muted small">${it.subtitle}</span>`}</span>
          </div>`;
        })}
        ${!items.length && html`<div class="combo-empty">Nothing found.</div>`}
      </div>
      <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Ctrl</kbd> <kbd>K</kbd> anywhere</span>
        <span style="margin-left:auto;cursor:pointer" onClick=${() => (close(), openKb('start-here'))}>How the system works →</span></div>
    </div>
  </div>`;
}
