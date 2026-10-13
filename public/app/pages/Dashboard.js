import { html } from '../lib/html.js';
import { get, put } from '../lib/api.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import { Link, navigate } from '../lib/router.js';
import { useStore, toastError } from '../lib/store.js';
import { moneyCompact, fmtNum, fmtDateShort, compact, daysUntil } from '../lib/format.js';
import { Card, Stat, Loading, ErrorBox, EmptyState } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { BarList, LineChart } from '../components/Charts.js';

const QUICK = [
  { href: '/docs/new?type=quote', icon: 'quote', title: 'New quote', sub: 'With product images' },
  { href: '/clients?new=1', icon: 'users', title: 'New client', sub: 'Lead or account' },
  { href: '/scan', icon: 'scan', title: 'Scan', sub: 'Pallet, location, MO' },
  { href: '/production', icon: 'factory', title: 'Record production', sub: 'Stages & kilns' },
  { href: '/warehouse/putaway', icon: 'pallet', title: 'Put away', sub: 'Pallets to position' },
  { href: '/labels', icon: 'qr', title: 'Print labels', sub: 'QR for racks & pallets' },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  useTitle('Dashboard');
  const user = useStore((s) => s.boot?.user);
  const { data, error, loading, reload } = useAsync(() => get('/dashboard'), []);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const k = data.kpis;
  const cur = data.currency;
  const urgent = data.attention.filter((a) => a.tone === 'danger').length;
  const monthLabel = (m, long) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', long ? { month: 'long', year: 'numeric' } : { month: 'short' });

  return html`<div>
    <section class="hero-band">
      <div class="zellige-deco" aria-hidden="true">
        ${[3, 40, 12, 27, 44, 9, 20, 35, 5, 47, 16, 31, 38, 2, 24, 45, 11, 29].map((id) => html`<img src=${`/api/products/${id}/swatch.svg?size=96`} alt="" />`)}
      </div>
      <div style="position:relative;max-width:640px">
        <div class="overline" style="color:#d9a441">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        <h1>${greeting()}, ${user?.name?.split(' ')[0] || ''}.</h1>
        <div class="muted mt-1">
          ${data.attention.length
            ? html`${data.attention.length} item${data.attention.length === 1 ? '' : 's'} need attention${urgent ? html` · <b style="color:#ffb4a8">${urgent} urgent</b>` : ''}.`
            : 'Nothing is blocked. Production, stock and sales are on track.'}
        </div>
      </div>
    </section>

    <div class="quick-actions">
      ${QUICK.map(
        (q) => html`<${Link} href=${q.href} class="quick">
          <span class="q-icon"><${Icon} name=${q.icon} /></span>
          <span><div>${q.title}${q.href === '/warehouse/putaway' && k.putaway ? html` <span class="badge warning plain">${k.putaway}</span>` : ''}</div><div class="q-sub">${q.sub}</div></span>
        <//>`,
      )}
    </div>

    <div class="kpis">
      <${Stat} icon="quote" label="Open quotes" value=${fmtNum(k.open_quotes.count)} note=${`${moneyCompact(k.open_quotes.value, cur)} quoted`} href="/docs?type=quote&status=sent" />
      <${Stat} icon="order" label="Orders in progress" value=${fmtNum(k.open_orders.count)} note=${k.open_orders.waiting_gates ? `${k.open_orders.waiting_gates} waiting deposit / colour OK` : moneyCompact(k.open_orders.value, cur)} noteTone=${k.open_orders.waiting_gates ? 'warn' : ''} href="/docs?type=order" />
      <${Stat} icon="factory" label="In production" value=${fmtNum(k.in_production.mos)} note=${`MOs · ${compact(k.in_production.pcs)} pcs in work · ${k.in_production.planned} planned`} href="/production" />
      <${Stat} icon="truck" label="Ready to ship" value=${fmtNum(k.ready_to_ship)} note="orders fully reserved" href="/docs?type=order&status=ready" />
      <${Stat} icon="coins" label="To collect" value=${moneyCompact(k.receivables.value, cur)} note=${k.receivables.overdue ? `${k.receivables.overdue} overdue invoice${k.receivables.overdue === 1 ? '' : 's'}` : 'nothing overdue'} noteTone=${k.receivables.overdue ? 'bad' : ''} href="/docs?type=invoice&status=overdue" />
      <${Stat} icon="boxes" label="Free stock" value=${`${compact(k.stock_m2)} m²`} note="grade A, not reserved" href="/stock" />
    </div>

    <div class="grid side">
      <div class="stack">
        <${Card} title="Needs attention" sub=${data.attention.length ? `${data.attention.length}` : ''} pad=${false} icon="bell">
          ${data.attention.length
            ? html`<div>${data.attention.slice(0, 14).map(
                (a) => html`<${Link} class="attention-item" href=${a.url}>
                  <span class=${`attention-dot dot-${a.tone}`}></span>
                  <span style="min-width:0;flex:1"><div class="strong">${a.title}</div><div class="muted small truncate">${a.detail}</div></span>
                  <${Icon} name="chevronRight" size="16" class="muted" />
                <//>`,
              )}</div>`
            : html`<${EmptyState} icon="checkCircle" title="All clear" text="No blocked orders, late production, QC holds or overdue invoices." />`}
        <//>
        <${Card} title="Sales" sub=${`last 12 months · ${cur}`} icon="trend">
          <${LineChart}
            labels=${data.charts.sales.map((s) => s.month)}
            xFormat=${monthLabel}
            format=${(v) => moneyCompact(v, cur)}
            series=${[
              { name: 'Orders confirmed', color: 'var(--series-1)', values: data.charts.sales.map((s) => s.ordered) },
              { name: 'Invoiced', color: 'var(--series-2)', values: data.charts.sales.map((s) => s.invoiced) },
            ]}
          />
        <//>
      </div>
      <div class="stack">
        <${Card} title="My tasks" icon="clipboard" actions=${html`<${Link} href="/tasks" class="small">All tasks<//>`} pad=${false}>
          ${data.tasks.length
            ? data.tasks.map((t) => {
                const d = daysUntil(t.due_date);
                return html`<div class="list-row">
                  <input type="checkbox" style="width:17px;height:17px;accent-color:var(--accent)" onChange=${async () => {
                    try {
                      await put(`/activities/${t.id}`, { done: 1 });
                      reload();
                    } catch (e) {
                      toastError(e);
                    }
                  }} />
                  <span style="flex:1;min-width:0"><div class="truncate">${t.subject}</div><div class="muted tiny">${t.client_name || ''}</div></span>
                  <span class=${`badge ${d < 0 ? 'danger' : d === 0 ? 'warning' : ''} plain`}>${d < 0 ? `${-d} d late` : d === 0 ? 'Today' : fmtDateShort(t.due_date)}</span>
                </div>`;
              })
            : html`<div class="card-body muted small">No tasks due this week.</div>`}
        <//>
        <${Card} title="Production in progress" sub="pieces waiting per stage" icon="factory">
          <${BarList} items=${data.charts.wip.map((s) => ({ label: s.name, value: s.pcs, unit: 'pieces', extra: [{ name: 'MOs', value: s.mos }] }))} format=${compact} empty="No pieces in work." onClick=${() => navigate('/production')} />
        <//>
        <${Card} title="Pipeline" sub=${`open opportunities · ${cur}`} icon="pipeline">
          <${BarList} items=${data.charts.pipeline.map((s) => ({ label: s.label, value: s.value, unit: cur, extra: [{ name: 'opportunities', value: s.count }] }))} format=${(v) => moneyCompact(v, cur)} empty="No open opportunities." onClick=${() => navigate('/pipeline')} />
        <//>
        <${Card} title="Free stock by colour" sub="m², grade A" icon="palette">
          <${BarList} items=${data.charts.stock_by_colour.map((s) => ({ label: `${s.code} ${s.name}`, value: s.m2, unit: 'm²', swatch: s.hex }))} format=${(v) => `${compact(v)} m²`} empty="No stock recorded yet." onClick=${() => navigate('/stock')} />
        <//>
      </div>
    </div>
  </div>`;
}

export default Dashboard;
