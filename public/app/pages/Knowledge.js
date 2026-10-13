import { useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, qs } from '../lib/api.js';
import { useAsync, useTitle, useDebounced } from '../lib/hooks.js';
import { Link, navigate } from '../lib/router.js';
import { toast } from '../lib/store.js';
import { LinkButton, Button, PageHeader, Loading, ErrorBox, QrImg } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { renderMarkdown } from '../components/markdown.js';

const SYSTEMS = [
  { key: 'general', label: 'Start here', icon: 'book' },
  { key: 'database', label: 'Database', icon: 'database' },
  { key: 'crm', label: 'CRM · Sales', icon: 'users' },
  { key: 'factory', label: 'Factory · Production', icon: 'factory' },
  { key: 'stock', label: 'Stock · Logistics', icon: 'boxes' },
];

/** The knowledge base as a full page: procedures, how the three systems work, product knowledge. */
export function Knowledge({ id }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const list = useAsync(() => get(`/knowledge${qs({ q: dq })}`), [dq]);
  const art = useAsync(() => (id ? get(`/knowledge/${id}`) : null), [id]);
  useTitle(art.data?.title || 'Knowledge base');
  const rows = list.data?.rows || [];
  return html`<div>
    <${PageHeader} overline="Knowledge & data" title="Knowledge base" sub="How the database, the CRM and the factory work - step by step, with the rules behind them" />
    <div class=${`grid side-l kb-page ${id ? 'reading' : ''}`}>
      <aside class="card kb-nav">
        <div class="card-pad" style="padding-bottom:8px"><div class="search"><input class="input" placeholder="Search procedures…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div></div>
        ${list.loading && !list.data && html`<${Loading} />`}
        ${dq
          ? html`<div class="kb-list" style="padding:0 8px 10px">
              ${rows.map((a) => html`<${Link} href=${`/knowledge/${a.id}`} class=${a.id === id ? 'on' : ''}><b>${a.title}</b><div class="kb-sum">${a.snippet || a.summary}</div><//>`)}
              ${!rows.length && html`<div class="small muted" style="padding:10px">Nothing found for "${dq}".</div>`}
            </div>`
          : SYSTEMS.map((s) => {
              const items = rows.filter((a) => (a.system || 'general') === s.key);
              if (!items.length) return null;
              return html`<div class="kb-group">
                <div class="kb-group-title"><span class=${`sys-pill ${s.key}`}><${Icon} name=${s.icon} size="11" />${s.label}</span></div>
                ${items.map((a) => html`<${Link} href=${`/knowledge/${a.id}`} class=${`kb-link ${a.id === id ? 'on' : ''}`}>${a.title}${a.public ? html`<span class="tiny muted"> · public</span>` : ''}<//>`)}
              </div>`;
            })}
      </aside>
      <div>
        ${!id
          ? html`<${Landing} rows=${rows} />`
          : art.error
            ? html`<${ErrorBox} error=${art.error} />`
            : art.loading && !art.data
              ? html`<${Loading} />`
              : art.data && html`<${Article} a=${art.data} />`}
      </div>
    </div>
  </div>`;
}

function Landing({ rows }) {
  const by = (sys) => rows.filter((a) => a.system === sys);
  const card = (sys, title, text, icon) => html`<div class="card card-pad sys-card">
    <div class="row mb-1"><span class=${`sys-pill ${sys}`}><${Icon} name=${icon} size="11" />${title}</span></div>
    <p class="small ink2">${text}</p>
    <div class="stack sm">${by(sys).map((a) => html`<${Link} href=${`/knowledge/${a.id}`} class="small"><${Icon} name="chevronRight" size="12" /> ${a.title}<//>`)}</div>
  </div>`;
  return html`<div class="stack">
    <div class="card card-pad">
      <h2>One system, three parts</h2>
      <p class="ink2 mt-1">Everything sits on one <b>database</b>. The <b>CRM</b> turns enquiries into quotes, orders and invoices. The <b>factory</b> system turns orders into manufacturing orders, lots, kiln firings, QC and labelled pallets, then positions every pallet in the warehouse and loads it onto a shipment. QR labels connect the physical world to the records.</p>
      <div class="row wrap mt-2"><${LinkButton} variant="primary" href="/knowledge/start-here" icon="book">Start here<//><${LinkButton} href="/knowledge/qr-codes" icon="qr">Where the QR codes go<//><${LinkButton} href="/knowledge/production-cycle" icon="factory">The production cycle<//></div>
    </div>
    <div class="grid cols-2">
      ${card('database', 'Database', 'Products, colours, formats, prices, clients, lots and locations. Set up once, used everywhere.', 'database')}
      ${card('crm', 'CRM · Sales', 'Enquiry → samples → quote → order → gates → invoice → payment, and claims after delivery.', 'users')}
      ${card('factory', 'Factory · Production', 'MO → lot → shaping, drying, glazing, firing, chiselling, sorting, packing; materials and QC.', 'factory')}
      ${card('stock', 'Stock · Logistics', 'Warehouse map, put-away, picking, counting, shipments and the document pack.', 'boxes')}
    </div>
    ${by('general').length > 0 && card('general', 'General', 'Glossary and reference for everyone.', 'book')}
  </div>`;
}

function Article({ a }) {
  const ref = useRef();
  const toc = [...a.body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].replace(/[*_`]/g, ''));
  const onClick = (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('kb:')) {
      e.preventDefault();
      navigate(`/knowledge/${href.slice(3).split('#')[0]}`);
    } else if (href.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    }
  };
  const jump = (i) => ref.current?.querySelectorAll('h2')[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return html`<div class="grid kb-article">
    <article class="card card-pad">
      <div class="row between mb-2 wrap">
        <span class="row"><${Link} href="/knowledge" class="kb-back small"><${Icon} name="arrowLeft" size="12" /> All articles<//><span class=${`sys-pill ${a.system}`}>${(SYSTEMS.find((s) => s.key === a.system) || SYSTEMS[0]).label}</span></span>
        <div class="row">
          <${Button} size="sm" variant="ghost" icon="copy" onClick=${() => navigator.clipboard?.writeText(`${location.origin}/knowledge/${a.id}`).then(() => toast('Link copied'))}>Link<//>
          <${LinkButton} size="sm" variant="ghost" icon="printer" href=${`/print/labels?type=sop&ids=${a.id}&format=a4-1`}>Workstation poster<//>
        </div>
      </div>
      <div class="prose" ref=${ref} onClick=${onClick} dangerouslySetInnerHTML=${{ __html: renderMarkdown(a.body) }}></div>
    </article>
    <aside class="stack kb-aside">
      ${toc.length > 2 && html`<div class="card card-pad"><div class="section-title">On this page</div><div class="stack sm">${toc.map((t, i) => html`<a href="#" class="small" onClick=${(e) => (e.preventDefault(), jump(i))}>${t}</a>`)}</div></div>`}
      <div class="card card-pad">
        <div class="section-title">At the workstation</div>
        <div class="row top"><${QrImg} code=${`KB-${a.id.toUpperCase()}`} size=${92} /><div class="small ink2">Print the poster and hang it where the work is done. Scanning it opens this procedure on any phone${a.public ? ' - no sign-in needed' : ' (staff sign-in)'}.</div></div>
      </div>
      ${a.tags?.length > 0 && html`<div class="row wrap" style="gap:6px">${a.tags.map((t) => html`<span class="chip">${t}</span>`)}</div>`}
    </aside>
  </div>`;
}
