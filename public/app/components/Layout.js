import { useEffect, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { Link, navigate, useLocation } from '../lib/router.js';
import { useStore, setState, openKb, applyTheme, can } from '../lib/store.js';
import { get, post } from '../lib/api.js';
import { initials } from '../lib/format.js';
import { Icon, BrandMark } from './icons.js';
import { Toasts, DialogHost, IconButton } from './ui.js';
import { CommandPalette } from './CommandPalette.js';
import { KnowledgePanel } from './KnowledgePanel.js';

// Navigation grouped by the three systems (plus the shared database / settings).
const NAV = [
  {
    title: 'Overview',
    items: [
      { href: '/', label: 'Dashboard', icon: 'dashboard', exact: true },
      { href: '/scan', label: 'Scan', icon: 'scan' },
      { href: '/tasks', label: 'My tasks', icon: 'clipboard', count: 'tasks' },
    ],
  },
  {
    title: 'CRM · Sales',
    sys: '#4f84d1',
    items: [
      { href: '/clients', label: 'Clients', icon: 'users' },
      { href: '/pipeline', label: 'Pipeline', icon: 'pipeline' },
      { href: '/docs?type=quote', label: 'Quotes', icon: 'quote', match: 'type=quote' },
      { href: '/docs?type=order', label: 'Sales orders', icon: 'order', match: 'type=order', count: 'gates', warn: true },
      { href: '/docs?type=invoice', label: 'Invoices', icon: 'receipt', match: 'type=invoice', count: 'overdue', warn: true },
      { href: '/samples', label: 'Samples', icon: 'package' },
      { href: '/claims', label: 'Claims', icon: 'flag', count: 'claims' },
    ],
  },
  {
    title: 'Factory · Production',
    sys: '#d0784a',
    items: [
      { href: '/production', label: 'Production board', icon: 'factory', exact: true, count: 'late_mos', warn: true },
      { href: '/production/mos', label: 'Manufacturing orders', icon: 'list' },
      { href: '/production/kilns', label: 'Kilns', icon: 'flame' },
      { href: '/production/qc', label: 'Quality & lots', icon: 'shield', count: 'holds', warn: true },
      { href: '/production/planning', label: 'Planning', icon: 'calendar' },
      { href: '/materials', label: 'Raw materials', icon: 'layers' },
      { href: '/purchase-orders', label: 'Purchasing', icon: 'inbox' },
    ],
  },
  {
    title: 'Stock · Logistics',
    sys: '#3fa07f',
    items: [
      { href: '/warehouse', label: 'Warehouse map', icon: 'map', exact: true },
      { href: '/stock', label: 'Stock', icon: 'boxes', exact: true },
      { href: '/warehouse/putaway', label: 'Put away', icon: 'pallet', count: 'putaway', warn: true },
      { href: '/shipments', label: 'Shipments', icon: 'truck' },
      { href: '/stock/moves', label: 'Movements', icon: 'history' },
      { href: '/labels', label: 'QR labels', icon: 'qr' },
    ],
  },
  {
    title: 'Knowledge & data',
    sys: '#8a76d6',
    items: [
      { href: '/catalog', label: 'Catalogue', icon: 'tile' },
      { href: '/knowledge', label: 'Knowledge base', icon: 'book' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

function isActive(item, loc) {
  const [path, query = ''] = loc.split('?');
  const [ipath] = item.href.split('?');
  if (item.match) return path === ipath && query.includes(item.match);
  if (item.exact) return path === ipath;
  return path === ipath || path.startsWith(`${ipath}/`);
}

function Sidebar({ loc, counts }) {
  const user = useStore((s) => s.boot?.user);
  const theme = useStore((s) => s.theme);
  const [menu, setMenu] = useState(false);
  return html`<nav class="sidebar" aria-label="Main">
    <${Link} href="/" class="brand">
      <${BrandMark} />
      <span><div class="brand-name">ZELLIGERAR</div><div class="brand-sub">Factory CRM</div></span>
    <//>
    ${NAV.map(
      (g) => html`<div class="nav-group">
        <div class="nav-title">${g.sys && html`<i class="sys" style=${{ background: g.sys }}></i>`}${g.title}</div>
        ${g.items
          .filter((it) => !it.admin || can())
          .map(
            (it) => html`<${Link} href=${it.href} class=${`nav-link ${isActive(it, loc) ? 'active' : ''}`} onClick=${() => setState({ navOpen: false })}>
              <${Icon} name=${it.icon} />${it.label}
              ${it.count && counts?.[it.count] ? html`<span class=${`nav-count ${it.warn ? 'warn' : ''}`}>${counts[it.count]}</span>` : null}
            <//>`,
          )}
      </div>`,
    )}
    <div class="sidebar-foot">
      ${menu &&
      html`<div style="padding:4px 0 8px">
        <button class="user-chip" onClick=${() => applyTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')}>
          <${Icon} name=${theme === 'dark' ? 'moon' : 'sun'} size="16" /> Theme: ${theme}
        </button>
        <button class="user-chip" onClick=${() => navigate('/settings/account')}><${Icon} name="lock" size="16" /> Password</button>
        <button class="user-chip" onClick=${async () => {
          await post('/auth/logout');
          location.href = '/login';
        }}><${Icon} name="logout" size="16" /> Sign out</button>
      </div>`}
      <button class="user-chip" onClick=${() => setMenu(!menu)} aria-expanded=${menu}>
        <span class="avatar">${initials(user?.name)}</span>
        <span class="truncate" style="flex:1"><div class="strong truncate">${user?.name}</div><div class="tiny" style="color:var(--sidebar-muted)">${user?.role}</div></span>
        <${Icon} name=${menu ? 'chevronDown' : 'chevronUp'} size="14" />
      </button>
    </div>
  </nav>`;
}

function Topbar() {
  return html`<header class="topbar">
    <${IconButton} class="menu-btn" icon="menu" label="Menu" variant="ghost" size="" onClick=${() => setState({ navOpen: true })} />
    <button class="search-trigger" onClick=${() => setState({ palette: true })}>
      <${Icon} name="search" size="16" /><span class="truncate">Search or type a code…</span><kbd>Ctrl K</kbd>
    </button>
    <div class="topbar-actions">
      <${IconButton} icon="scan" label="Scan a QR code" size="" variant="ghost" onClick=${() => navigate('/scan')} />
      <${IconButton} icon="book" label="Knowledge panel - how this page works" size="" variant="ghost" onClick=${() => openKb()} />
    </div>
  </header>`;
}

function BottomNav({ loc }) {
  const items = [
    { href: '/', label: 'Home', icon: 'home', exact: true },
    { href: '/clients', label: 'Sales', icon: 'users', any: ['/clients', '/docs', '/pipeline', '/samples'] },
    { href: '/scan', label: 'Scan', icon: 'scan', fab: true },
    { href: '/production', label: 'Factory', icon: 'factory', any: ['/production', '/floor', '/lots', '/materials'] },
    { href: '/warehouse', label: 'Stock', icon: 'boxes', any: ['/warehouse', '/stock', '/shipments'] },
  ];
  const path = loc.split('?')[0];
  return html`<nav class="bottom-nav" aria-label="Quick">
    ${items.map((it) => {
      const on = it.exact ? path === it.href : (it.any || [it.href]).some((p) => path.startsWith(p));
      return it.fab
        ? html`<${Link} href=${it.href} class="scan-fab"><span class="fab"><${Icon} name="scan" /></span><//>`
        : html`<${Link} href=${it.href} class=${on ? 'on' : ''}><${Icon} name=${it.icon} />${it.label}<//>`;
    })}
  </nav>`;
}

export function Layout({ children, wide }) {
  const loc = useLocation();
  const navOpen = useStore((s) => s.navOpen);
  const [counts, setCounts] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => get('/nav-counts').then((c) => alive && setCounts(c)).catch(() => {});
    load();
    const t = setInterval(load, 90000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [loc.split('?')[0]]);
  return html`<div class=${`shell ${navOpen ? 'nav-open' : ''}`}>
    <${Sidebar} loc=${loc} counts=${counts} />
    ${navOpen && html`<div class="nav-scrim" onClick=${() => setState({ navOpen: false })}></div>`}
    <div class="main">
      <${Topbar} />
      <main class=${`content ${wide ? 'wide' : ''}`} id="main">${children}</main>
    </div>
    <${BottomNav} loc=${loc} />
    <${KnowledgePanel} />
    <${CommandPalette} />
    <${Toasts} />
    <${DialogHost} />
  </div>`;
}

/** Bare frame for print pages and public QR pages (no navigation). */
export function Bare({ children }) {
  return html`<div>${children}<${Toasts} /><${DialogHost} /><${KnowledgePanel} /></div>`;
}
