import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put, del, qs } from '../lib/api.js';
import { useAsync, useTitle, useDebounced } from '../lib/hooks.js';
import { navigate, useQuery, setQuery } from '../lib/router.js';
import { boot, can, toast, toastError } from '../lib/store.js';
import { money, moneyCompact, fmtDate, ago, fmtNum, titleCase } from '../lib/format.js';
import { CLIENT_TYPES, REGIONS, CURRENCIES, INCOTERMS, OPP_STAGES, DOC_TYPES, SAMPLE_STATUSES, CLAIM_STATUSES, SHIPMENT_STATUSES } from '/shared/constants.js';
import {
  Button, LinkButton, Card, PageHeader, EmptyState, Loading, ErrorBox, Field, Input, Select, Textarea, Seg, Tabs, Modal, Badge,
  StatusBadge, KV, Stat, useForm, confirmDialog, Callout,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';

const TYPE_TONE = { end_user: 'neutral', trade: 'info', wholesale: 'accent', programme: 'progress', distributor: 'accent' };

export function Clients() {
  useTitle('Clients');
  const query = useQuery();
  const [q, setQ] = useState(query.get('q') || '');
  const dq = useDebounced(q, 200);
  const type = query.get('type') || '';
  const region = query.get('region') || '';
  const archived = query.get('archived') === '1';
  const [form, setForm] = useState(query.get('new') === '1' ? {} : null);
  const { data, error, loading, reload } = useAsync(() => get(`/clients${qs({ q: dq, type, region, archived: archived ? 1 : '' })}`), [dq, type, region, archived]);

  const rows = data?.rows || [];
  return html`<div>
    <${PageHeader}
      overline="CRM"
      title="Clients"
      sub=${data ? `${rows.length} ${archived ? 'archived' : 'active'} accounts` : ''}
      help="crm"
      actions=${html`<${LinkButton} href="/settings/data" icon="upload" variant="ghost">Import<//>
        <a class="btn ghost" href="/api/data/export/clients"><${Icon} name="download" />Export<//>
        ${can('sales') && html`<${Button} variant="primary" icon="plus" onClick=${() => setForm({})}>New client<//>`}`}
    />
    <div class="card">
      <${DataTable}
        toolbar=${html`<div class="search"><${Icon} name="search" /><input class="input" placeholder="Search company, contact, country, tag…" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
          <${Seg} value=${type} onChange=${(v) => setQuery({ type: v })} options=${[{ value: '', label: 'All' }, ...Object.entries(CLIENT_TYPES).map(([value, label]) => ({ value, label }))]} />
          <select class="select" style="width:auto" value=${region} onChange=${(e) => setQuery({ region: e.target.value })}>
            <option value="">All regions</option>${Object.entries(REGIONS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
          </select>
          <label class="check small"><input type="checkbox" checked=${archived} onChange=${(e) => setQuery({ archived: e.target.checked ? 1 : '' })} />Archived</label>`}
        columns=${[
          { key: 'company', label: 'Company', sort: true, render: (c) => html`<div class="cell-main">${c.company}</div><div class="cell-sub">${[c.code, c.city, c.country].filter(Boolean).join(' · ')}</div>` },
          { key: 'type', label: 'Type', sort: true, render: (c) => html`<${Badge} tone=${TYPE_TONE[c.type]} plain>${CLIENT_TYPES[c.type]}<//>` },
          { key: 'region', label: 'Market', sort: true, hideSm: true, render: (c) => html`<span>${c.region}</span> <span class="muted">· ${c.currency}</span>` },
          { key: 'contact_name', label: 'Contact', hideSm: true, render: (c) => html`<div>${c.contact_name || '—'}</div><div class="cell-sub">${c.email || c.phone || ''}</div>` },
          { key: 'open_quotes', label: 'Quotes', align: 'num', sort: true, render: (c) => (c.open_quotes ? fmtNum(c.open_quotes) : html`<span class="muted">0</span>`) },
          { key: 'open_orders', label: 'Orders', align: 'num', sort: true, render: (c) => (c.open_orders ? fmtNum(c.open_orders) : html`<span class="muted">0</span>`) },
          { key: 'invoiced', label: 'Invoiced', align: 'num', sort: true, render: (c) => (c.invoiced ? moneyCompact(c.invoiced, c.currency) : html`<span class="muted">—</span>`) },
          { key: 'last_activity', label: 'Last activity', sort: true, hideSm: true, render: (c) => html`<span class="muted small">${c.last_activity ? ago(c.last_activity) : '—'}</span>` },
        ]}
        rows=${rows}
        onRowClick=${(c) => navigate(`/clients/${c.id}`)}
        empty=${loading ? html`<${Loading} />` : html`<${EmptyState} icon="users" title=${q ? 'No client matches' : 'No clients yet'} text="Add your first client, or import a CSV from your previous CRM." kb="crm" action=${can('sales') && html`<${Button} variant="primary" icon="plus" onClick=${() => setForm({})}>New client<//>`} />`}
      />
    </div>
    ${error && html`<${ErrorBox} error=${error} retry=${reload} />`}
    ${form &&
    html`<${ClientForm}
      client=${form}
      onClose=${() => (setForm(null), query.get('new') && setQuery({ new: '' }))}
      onSaved=${(c) => {
        setForm(null);
        navigate(`/clients/${c.id}`);
      }}
    />`}
  </div>`;
}

export function ClientForm({ client, onClose, onSaved }) {
  const isNew = !client.id;
  const d = boot().settings?.defaults || {};
  const f = useForm({ type: 'end_user', currency: d.currency || 'EUR', region: 'EU', incoterm: d.incoterm, incoterm_place: d.incoterm_place, deposit_pct: d.deposit_pct, ...client });
  const [busy, setBusy] = useState(false);
  const tiers = boot().tiers || [];
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f.values };
      const res = isNew ? await post('/clients', body) : await put(`/clients/${client.id}`, body);
      toast(isNew ? 'Client created' : 'Client saved');
      onSaved(res);
    } catch (e) {
      f.fail(e);
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal}
    title=${isNew ? 'New client' : `Edit ${client.company}`}
    size="wide"
    onClose=${onClose}
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${save}>${isNew ? 'Create client' : 'Save'}<//>`}
  >
    <div class="form-grid">
      <${Field} label="Company" required class="span-2" error=${f.errors.company}><${Input} form=${f} name="company" placeholder="Company or person" /><//>
      <${Field} label="Type" hint="Sets the default price tier"><${Select} form=${f} name="type" options=${Object.entries(CLIENT_TYPES)} /><//>
      <${Field} label="Price tier" hint="Leave empty to follow the type"><${Select} form=${f} name="tier_id" placeholder="Automatic" options=${tiers.map((t) => [t.id, `${t.name} (×${t.multiplier})`])} /><//>
      <${Field} label="Market / region" hint="Decides the document pack and VAT"><${Select} form=${f} name="region" options=${Object.entries(REGIONS)} /><//>
      <${Field} label="Currency" hint="Never quote one buyer in two currencies"><${Select} form=${f} name="currency" options=${CURRENCIES.map((c) => [c, c])} /><//>
      <${Field} label="Country"><${Input} form=${f} name="country" /><//>
      <${Field} label="City"><${Input} form=${f} name="city" /><//>
      <${Field} label="Address" class="span-2"><${Textarea} form=${f} name="address" rows="2" /><//>
      <${Field} label="Main contact"><${Input} form=${f} name="contact_name" /><//>
      <${Field} label="Email" error=${f.errors.email}><${Input} form=${f} name="email" type="email" /><//>
      <${Field} label="Phone / WhatsApp"><${Input} form=${f} name="phone" /><//>
      <${Field} label="Website"><${Input} form=${f} name="website" /><//>
      <${Field} label="Incoterm" hint=${INCOTERMS[f.values.incoterm]?.note}><${Select} form=${f} name="incoterm" placeholder="—" options=${Object.keys(INCOTERMS).map((k) => [k, k])} /><//>
      <${Field} label="Incoterm place"><${Input} form=${f} name="incoterm_place" placeholder="Tanger Med" /><//>
      <${Field} label="Deposit %"><${Input} form=${f} name="deposit_pct" type="number" min="0" max="100" /><//>
      <${Field} label="VAT / tax number"><${Input} form=${f} name="vat_number" /><//>
      <${Field} label="Payment terms" class="span-2"><${Input} form=${f} name="payment_terms" placeholder=${d.payment_terms} /><//>
      <${Field} label="Source"><${Input} form=${f} name="source" placeholder="Website, trade show, referral…" /><//>
      <${Field} label="Tags"><${Input} form=${f} name="tags" placeholder="architect, hotel, distributor" /><//>
      <${Field} label="Notes" class="span-2"><${Textarea} form=${f} name="notes" /><//>
    </div>
    ${f.values.incoterm === 'DDP' && html`<div class="mt-2"><${Callout} tone="warning" title="DDP makes you the importer of record.">You would pay import duties and answer customs origin audits. Offer FCA or CFR instead.<//></div>`}
  <//>`;
}

const ACT_ICONS = { note: 'edit', call: 'phone', email: 'mail', meeting: 'users', whatsapp: 'chat', task: 'clipboard' };

export function ClientDetail({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/clients/${id}`), [id]);
  const [tab, setTab] = useState('activity');
  const [edit, setEdit] = useState(false);
  const [contact, setContact] = useState(null);
  useTitle(data?.client?.company || 'Client');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const c = data.client;
  const s = data.stats;
  const digits = (p) => String(p || '').replace(/[^\d]/g, '');
  const archive = async () => {
    if (!(await confirmDialog({ title: `Archive ${c.company}?`, message: 'Clients with documents are archived (hidden from lists), never deleted.', confirmLabel: 'Archive', tone: 'danger' }))) return;
    try {
      await del(`/clients/${c.id}`);
      toast('Client archived');
      navigate('/clients');
    } catch (e) {
      toastError(e);
    }
  };
  const tabs = [
    { key: 'activity', label: 'Activity', count: data.activities.length },
    { key: 'docs', label: 'Documents', count: data.docs.length },
    { key: 'opps', label: 'Opportunities', count: data.opportunities.length },
    { key: 'samples', label: 'Samples', count: data.samples.length },
    { key: 'shipments', label: 'Shipments', count: data.shipments.length },
    { key: 'claims', label: 'Claims', count: data.claims.length },
    { key: 'prices', label: 'Contract prices', count: data.contract_prices.length },
  ];
  return html`<div>
    <${PageHeader}
      back=${{ href: '/clients', label: 'Clients' }}
      overline=${c.code}
      title=${c.company}
      sub=${html`<span class="row wrap" style="gap:6px">
        <${Badge} tone=${TYPE_TONE[c.type]} plain>${CLIENT_TYPES[c.type]}<//>
        ${c.tier_name && html`<${Badge} plain>${c.tier_name} pricing<//>`}
        <${Badge} plain>${REGIONS[c.region] || c.region} · ${c.currency}<//>
        ${c.archived ? html`<${Badge} tone="warning">Archived<//>` : null}
      </span>`}
      help="crm"
      actions=${html`${can('sales') &&
        html`<${LinkButton} href=${`/docs/new?type=quote&client_id=${c.id}`} variant="primary" icon="quote">New quote<//>
          <${LinkButton} href=${`/docs/new?type=order&client_id=${c.id}`} icon="order">New order<//>
          <${Button} icon="edit" onClick=${() => setEdit(true)}>Edit<//>
          ${!c.archived && html`<${Button} icon="archive" variant="ghost" onClick=${archive}>Archive<//>`}`}`}
    />
    <div class="kpis">
      <${Stat} label="Quoted" value=${moneyCompact(s.quoted, c.currency)} />
      <${Stat} label="Ordered" value=${moneyCompact(s.ordered, c.currency)} />
      <${Stat} label="Invoiced" value=${moneyCompact(s.invoiced, c.currency)} />
      <${Stat} label="Outstanding" value=${moneyCompact(s.outstanding, c.currency)} note=${s.overdue ? `${s.overdue} overdue` : 'nothing overdue'} noteTone=${s.overdue ? 'bad' : ''} />
    </div>
    <div class="grid side">
      <div class="card">
        <div style="padding:0 16px"><${Tabs} tabs=${tabs} value=${tab} onChange=${setTab} /></div>
        <div style="padding:0 16px 16px">
          ${tab === 'activity' && html`<${ActivityFeed} clientId=${c.id} rows=${data.activities} onChange=${reload} />`}
          ${tab === 'docs' && html`<${DocTable} rows=${data.docs} />`}
          ${tab === 'opps' &&
          html`<${DataTable}
            columns=${[
              { key: 'title', label: 'Opportunity', render: (o) => html`<div class="cell-main">${o.title}</div><div class="cell-sub">${o.area_m2 ? `${fmtNum(o.area_m2)} m²` : ''}</div>` },
              { key: 'stage', label: 'Stage', render: (o) => html`<${StatusBadge} map=${OPP_STAGES} value=${o.stage} />` },
              { key: 'value', label: 'Value', align: 'num', render: (o) => money(o.value, o.currency, { decimals: 0 }) },
              { key: 'expected_close', label: 'Close', render: (o) => fmtDate(o.expected_close) },
            ]}
            rows=${data.opportunities}
            onRowClick=${() => navigate('/pipeline')}
            empty=${html`<${EmptyState} icon="pipeline" title="No opportunities" action=${html`<${LinkButton} href=${`/pipeline?new=1&client_id=${c.id}`} icon="plus">New opportunity<//>`} />`}
          />`}
          ${tab === 'samples' &&
          html`<${DataTable}
            columns=${[
              { key: 'number', label: 'Sample', render: (x) => html`<span class="code-chip">${x.number}</span>` },
              { key: 'status', label: 'Status', render: (x) => html`<${StatusBadge} map=${SAMPLE_STATUSES} value=${x.status} />` },
              { key: 'sent_at', label: 'Sent', render: (x) => fmtDate(x.sent_at) },
              { key: 'follow_up', label: 'Follow up', render: (x) => fmtDate(x.follow_up) },
            ]}
            rows=${data.samples}
            onRowClick=${(x) => navigate(`/samples?open=${x.id}`)}
            empty=${html`<${EmptyState} icon="package" title="No samples sent" action=${html`<${LinkButton} href=${`/samples?new=1&client_id=${c.id}`} icon="plus">Send samples<//>`} />`}
          />`}
          ${tab === 'shipments' &&
          html`<${DataTable}
            columns=${[
              { key: 'number', label: 'Shipment', render: (x) => html`<span class="code-chip">${x.number}</span>` },
              { key: 'mode', label: 'Mode', render: (x) => titleCase(x.mode) },
              { key: 'status', label: 'Status', render: (x) => html`<${StatusBadge} map=${SHIPMENT_STATUSES} value=${x.status} />` },
              { key: 'etd', label: 'ETD', render: (x) => fmtDate(x.etd) },
            ]}
            rows=${data.shipments}
            onRowClick=${(x) => navigate(`/shipments/${x.id}`)}
            empty=${html`<${EmptyState} icon="truck" title="No shipments yet" />`}
          />`}
          ${tab === 'claims' &&
          html`<${DataTable}
            columns=${[
              { key: 'number', label: 'Claim', render: (x) => html`<span class="code-chip">${x.number}</span>` },
              { key: 'category', label: 'Type', render: (x) => titleCase(x.category) },
              { key: 'status', label: 'Status', render: (x) => html`<${StatusBadge} map=${CLAIM_STATUSES} value=${x.status} />` },
              { key: 'reported_at', label: 'Reported', render: (x) => fmtDate(x.reported_at) },
            ]}
            rows=${data.claims}
            onRowClick=${(x) => navigate(`/claims/${x.id}`)}
            empty=${html`<${EmptyState} icon="flag" title="No claims" text="Claims must be raised in writing before installation." />`}
          />`}
          ${tab === 'prices' && html`<${ContractPrices} client=${c} rows=${data.contract_prices} onChange=${reload} />`}
        </div>
      </div>
      <div class="stack">
        <${Card} title="Contact" icon="user" actions=${can('sales') && html`<${Button} size="sm" variant="ghost" icon="plus" onClick=${() => setContact({ client_id: c.id })}>Add<//>`}>
          ${data.contacts.length
            ? data.contacts.map(
                (p) => html`<div class="row top mb-2">
                  <span class="avatar sm">${(p.name || '?').slice(0, 1)}</span>
                  <div style="flex:1;min-width:0">
                    <div class="strong">${p.name} ${p.is_primary ? html`<${Badge} tone="accent" plain>Main<//>` : null}</div>
                    ${p.role && html`<div class="muted small">${p.role}</div>`}
                    <div class="row wrap small" style="gap:10px;margin-top:2px">
                      ${p.email && html`<a href=${`mailto:${p.email}`}><${Icon} name="mail" size="13" /> ${p.email}</a>`}
                      ${p.phone && html`<a href=${`tel:${p.phone}`}><${Icon} name="phone" size="13" /> ${p.phone}</a>`}
                      ${(p.whatsapp || p.phone) && html`<a href=${`https://wa.me/${digits(p.whatsapp || p.phone)}`} target="_blank" rel="noopener"><${Icon} name="chat" size="13" /> WhatsApp</a>`}
                    </div>
                  </div>
                  ${can('sales') && html`<${Button} size="sm" variant="ghost" icon="edit" aria-label="Edit contact" onClick=${() => setContact(p)} />`}
                </div>`,
              )
            : html`<div class="muted small">No contact yet.</div>`}
        <//>
        <${Card} title="Commercial terms" icon="coins">
          <${KV}
            items=${[
              ['Price tier', c.tier_name],
              ['Currency', c.currency],
              ['Incoterm', c.incoterm ? `${c.incoterm} ${c.incoterm_place || ''}` : null],
              ['Deposit', c.deposit_pct !== null && c.deposit_pct !== undefined ? `${c.deposit_pct} %` : null],
              ['Payment', c.payment_terms],
              ['VAT number', c.vat_number],
            ]}
          />
        <//>
        <${Card} title="Details" icon="info">
          <${KV} items=${[['Address', c.address], ['City', [c.city, c.country].filter(Boolean).join(', ')], ['Website', c.website && html`<a href=${c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noopener">${c.website}</a>`], ['Source', c.source], ['Tags', c.tags], ['Owner', c.owner_name], ['Since', fmtDate(c.created_at)]]} />
          ${c.notes && html`<p class="mt-2 small ink2" style="white-space:pre-wrap">${c.notes}</p>`}
        <//>
      </div>
    </div>
    ${edit && html`<${ClientForm} client=${c} onClose=${() => setEdit(false)} onSaved=${() => (setEdit(false), reload())} />`}
    ${contact && html`<${ContactForm} contact=${contact} onClose=${() => setContact(null)} onSaved=${() => (setContact(null), reload())} />`}
  </div>`;
}

function ContactForm({ contact, onClose, onSaved }) {
  const f = useForm(contact);
  const save = async () => {
    try {
      if (contact.id) await put(`/contacts/${contact.id}`, f.values);
      else await post('/contacts', f.values);
      onSaved();
    } catch (e) {
      f.fail(e);
      toastError(e);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete this contact?', confirmLabel: 'Delete', tone: 'danger' }))) return;
    await del(`/contacts/${contact.id}`);
    onSaved();
  };
  return html`<${Modal}
    title=${contact.id ? 'Edit contact' : 'New contact'}
    onClose=${onClose}
    footer=${html`${contact.id && html`<${Button} variant="ghost danger" icon="trash" onClick=${remove} style="margin-right:auto">Delete<//>`}<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" onClick=${save}>Save<//>`}
  >
    <div class="form-grid">
      <${Field} label="Name" required class="span-2"><${Input} form=${f} name="name" /><//>
      <${Field} label="Role"><${Input} form=${f} name="role" placeholder="Buyer, architect…" /><//>
      <${Field} label="Email"><${Input} form=${f} name="email" type="email" /><//>
      <${Field} label="Phone"><${Input} form=${f} name="phone" /><//>
      <${Field} label="WhatsApp (if different)"><${Input} form=${f} name="whatsapp" /><//>
      <label class="check span-2"><input type="checkbox" checked=${!!f.values.is_primary} onChange=${(e) => f.set('is_primary', e.target.checked ? 1 : 0)} />Main contact</label>
    </div>
  <//>`;
}

function ContractPrices({ client, rows, onChange }) {
  return html`<div>
    <p class="muted small mt-1">A contract price overrides the tier price for this client, in their currency. Set it from a product page (Prices tab).</p>
    <${DataTable}
      columns=${[
        { key: 'sku', label: 'Product', render: (p) => html`<div class="prod-cell"><img class="thumb sm" src=${`/api/products/${p.product_id}/image`} alt="" /><div><div class="cell-main">${p.sku}</div><div class="cell-sub">${p.product_name}</div></div></div>` },
        { key: 'price', label: 'Price', align: 'num', render: (p) => money(p.price, p.currency) },
        { key: 'valid_until', label: 'Valid until', render: (p) => fmtDate(p.valid_until) },
        { key: 'x', label: '', render: (p) => can('sales') && html`<${Button} size="sm" variant="ghost" icon="trash" aria-label="Remove price" onClick=${async () => (await del(`/price-list/${p.id}`), onChange())} />` },
      ]}
      rows=${rows}
      onRowClick=${(p) => navigate(`/catalog/${p.product_id}?tab=prices`)}
      empty=${html`<${EmptyState} icon="tag" title="No contract prices" text=${`${client.company} pays the ${client.tier_name || 'tier'} prices.`} />`}
    />
  </div>`;
}

export function DocTable({ rows, showClient = false }) {
  return html`<${DataTable}
    columns=${[
      { key: 'number', label: 'Document', sort: true, render: (d) => html`<div class="prod-cell">${d.thumb_url ? html`<img class="thumb sm" src=${d.thumb_url} alt="" />` : html`<span class="thumb sm"></span>`}<div><div class="cell-main mono">${d.number}</div><div class="cell-sub">${DOC_TYPES[d.type].label}${d.project ? ` · ${d.project}` : ''}</div></div></div>` },
      ...(showClient ? [{ key: 'client_name', label: 'Client', sort: true }] : []),
      { key: 'issue_date', label: 'Date', sort: true, render: (d) => fmtDate(d.issue_date) },
      { key: 'status', label: 'Status', render: (d) => html`<${StatusBadge} map=${DOC_TYPES[d.type].statuses} value=${d.display_status} />${d.gates_missing?.length ? html` <${Badge} tone="warning" plain title="Waiting before production">${d.gates_missing.join(' + ')}<//>` : ''}` },
      { key: 'total', label: 'Total', align: 'num', sort: true, render: (d) => money(d.total, d.currency) },
      { key: 'balance', label: 'Balance', align: 'num', render: (d) => (['invoice', 'order', 'proforma'].includes(d.type) && d.balance > 0.005 ? money(d.balance, d.currency) : html`<span class="muted">—</span>`) },
    ]}
    rows=${rows}
    onRowClick=${(d) => navigate(`/docs/${d.id}`)}
    empty=${html`<${EmptyState} icon="file" title="No documents" />`}
  />`;
}

export function ActivityFeed({ clientId, opportunityId, docId, rows, onChange }) {
  const [type, setType] = useState('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!subject.trim()) return;
    setBusy(true);
    try {
      await post('/activities', { client_id: clientId, opportunity_id: opportunityId, doc_id: docId, type, subject, body, due_date: type === 'task' ? due || null : null, done: type === 'task' ? 0 : 1 });
      setSubject('');
      setBody('');
      setDue('');
      onChange();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (a) => {
    await put(`/activities/${a.id}`, { done: a.done ? 0 : 1 });
    onChange();
  };
  return html`<div>
    ${can('sales', 'production', 'warehouse') &&
    html`<div class="card card-pad mt-1" style="background:var(--surface-2)">
      <${Seg} value=${type} onChange=${setType} options=${[['note', 'Note'], ['call', 'Call'], ['email', 'Email'], ['whatsapp', 'WhatsApp'], ['meeting', 'Meeting'], ['task', 'Task']].map(([value, label]) => ({ value, label }))} />
      <div class="stack sm mt-2">
        <input class="input" placeholder=${type === 'task' ? 'What needs to be done?' : 'Summary'} value=${subject} onInput=${(e) => setSubject(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && !e.shiftKey && add()} />
        <textarea class="textarea" rows="2" placeholder="Details (optional)" value=${body} onInput=${(e) => setBody(e.target.value)}></textarea>
        <div class="row">
          ${type === 'task' && html`<label class="small muted">Due</label><input class="input sm" type="date" style="width:auto" value=${due} onInput=${(e) => setDue(e.target.value)} />`}
          <span class="spacer"></span>
          <${Button} variant="primary" size="sm" loading=${busy} onClick=${add} disabled=${!subject.trim()}>${type === 'task' ? 'Add task' : 'Log'}<//>
        </div>
      </div>
    </div>`}
    <div class="timeline mt-2">
      ${rows.map(
        (a) => html`<div class="tl-item">
          <span class="tl-icon" style=${a.type === 'task' && !a.done ? 'background:var(--warning-soft);color:var(--warning)' : ''}><${Icon} name=${ACT_ICONS[a.type] || 'edit'} /></span>
          <div class="tl-body">
            <div class="row top">
              <div class="tl-title" style=${a.done && a.type === 'task' ? 'text-decoration:line-through;color:var(--muted)' : ''}>${a.subject}</div>
              <span class="spacer"></span>
              ${a.type === 'task' && html`<label class="check small"><input type="checkbox" checked=${!!a.done} onChange=${() => toggle(a)} />Done</label>`}
            </div>
            ${a.body && html`<div class="small ink2" style="white-space:pre-wrap">${a.body}</div>`}
            <div class="tl-meta">${titleCase(a.type)} · ${a.user_name || ''} · ${ago(a.created_at)}${a.due_date ? ` · due ${fmtDate(a.due_date)}` : ''}${a.doc_number ? ` · ${a.doc_number}` : ''}</div>
          </div>
        </div>`,
      )}
      ${!rows.length && html`<div class="muted small mt-2">No activity yet. Log calls, emails and WhatsApp conversations here so the whole team sees the history.</div>`}
    </div>
  </div>`;
}
