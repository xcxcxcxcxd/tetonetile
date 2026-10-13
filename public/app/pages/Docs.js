import { useEffect, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, qs } from '../lib/api.js';
import { useAsync, useTitle, useDebounced } from '../lib/hooks.js';
import { navigate, useQuery, setQuery } from '../lib/router.js';
import { can, toastError } from '../lib/store.js';
import { money } from '../lib/format.js';
import { DOC_TYPES } from '/shared/constants.js';
import { Button, LinkButton, PageHeader, Loading, ErrorBox, Seg, Card, Field, Callout } from '../components/ui.js';
import { DocTable } from './Clients.js';
import { ClientPicker } from '../components/Combobox.js';
import { Icon } from '../components/icons.js';

const TYPES = ['quote', 'order', 'proforma', 'invoice', 'credit'];

export function DocsList() {
  const query = useQuery();
  const type = TYPES.includes(query.get('type')) ? query.get('type') : 'quote';
  const status = query.get('status') || '';
  const [q, setQ] = useState(query.get('q') || '');
  const dq = useDebounced(q, 200);
  const T = DOC_TYPES[type];
  useTitle(T.plural);
  const { data, error, loading, reload } = useAsync(() => get(`/docs${qs({ type, q: dq })}`), [type, dq]);
  const all = data?.rows || [];
  const rows = status ? all.filter((d) => d.display_status === status || (status === 'open' && !['cancelled', 'closed', 'rejected', 'expired', 'paid', 'accepted', 'delivered'].includes(d.status))) : all;
  const counts = {};
  for (const d of all) counts[d.display_status] = (counts[d.display_status] || 0) + 1;
  const totals = {};
  for (const d of rows) totals[d.currency] = (totals[d.currency] || 0) + (type === 'invoice' ? d.balance : d.total);

  return html`<div>
    <${PageHeader}
      overline="CRM · Documents"
      title=${T.plural}
      sub=${Object.entries(totals).length ? html`${type === 'invoice' ? 'Balance due: ' : 'Total: '}${Object.entries(totals).map(([c, v], i) => html`${i ? ' · ' : ''}<b>${money(v, c)}</b>`)}` : ''}
      help="quotes-orders-invoices"
      actions=${can('sales') && ['quote', 'order'].includes(type) && html`<${LinkButton} href=${`/docs/new?type=${type}`} variant="primary" icon="plus">New ${T.label.toLowerCase()}<//>`}
    />
    <div class="row wrap mb-2">
      <${Seg} value=${type} onChange=${(v) => setQuery({ type: v, status: '' })} options=${TYPES.map((t) => ({ value: t, label: DOC_TYPES[t].plural }))} />
    </div>
    <div class="card">
      <div class="table-toolbar">
        <div class="search"><${Icon} name="search" /><input class="input" placeholder="Number, client, project, client PO…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
        <${Seg}
          value=${status}
          onChange=${(v) => setQuery({ status: v })}
          options=${[{ value: '', label: 'All', count: all.length }, ...Object.entries(T.statuses).map(([k, [label]]) => ({ value: k, label, count: counts[k] || 0 })).filter((o) => o.count || o.value === status)]}
        />
      </div>
      ${loading && !data ? html`<${Loading} />` : html`<${DocTable} rows=${rows} showClient />`}
    </div>
    ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
  </div>`;
}

/** Creates a document for a client and opens the editor. */
export function DocNew() {
  const query = useQuery();
  const type = TYPES.includes(query.get('type')) ? query.get('type') : 'quote';
  const clientId = Number(query.get('client_id')) || null;
  const [client, setClient] = useState(null);
  const [busy, setBusy] = useState(false);
  useTitle(`New ${DOC_TYPES[type].label.toLowerCase()}`);
  const create = async (cid) => {
    setBusy(true);
    try {
      const d = await post('/docs', { type, client_id: cid, opportunity_id: Number(query.get('opportunity_id')) || undefined });
      navigate(`/docs/${d.id}`, { replace: true });
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };
  useEffect(() => {
    if (clientId) create(clientId);
  }, []);
  if (clientId) return html`<${Loading} label="Creating…" />`;
  return html`<div style="max-width:560px;margin:4vh auto 0">
    <${PageHeader} overline="CRM" title=${`New ${DOC_TYPES[type].label.toLowerCase()}`} sub="Choose the client. Currency, price tier, incoterm, deposit and VAT come from the client." />
    <${Card}>
      <div class="stack">
        <${Field} label="Client"><${ClientPicker} value=${client} onChange=${setClient} autoFocus /><//>
        <div class="row">
          <${LinkButton} href="/clients?new=1" variant="ghost" icon="plus">New client<//>
          <span class="spacer"></span>
          <${Button} variant="primary" disabled=${!client} loading=${busy} onClick=${() => create(client.id)}>Create ${DOC_TYPES[type].label.toLowerCase()}<//>
        </div>
        ${type === 'order' && html`<${Callout} tone="info">Orders usually come from an accepted quote (open the quote → Convert → Order). Create one directly only for repeat or phone orders.<//>`}
      </div>
    <//>
  </div>`;
}
