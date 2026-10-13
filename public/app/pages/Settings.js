import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put, del, qs } from '../lib/api.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import { navigate } from '../lib/router.js';
import { boot, can, toast, toastError, refreshBoot, applyTheme, useStore } from '../lib/store.js';
import { uploadFile } from '../lib/image.js';
import { fmtNum, fmtQty, fmtDate, fmtDateTime, ago, unitLabel } from '../lib/format.js';
import { ROLES, CURRENCIES, INCOTERMS, ZONE_KINDS } from '/shared/constants.js';
import {
  Button, LinkButton, IconButton, Card, PageHeader, Loading, ErrorBox, Seg, Tabs, Badge, Callout, Modal, Field, Swatch, Toggle, confirmDialog,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';

const TABS = [
  { key: 'company', label: 'Company' },
  { key: 'sales', label: 'Sales defaults' },
  { key: 'logistics', label: 'Logistics' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'production', label: 'Production' },
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'users', label: 'Users' },
  { key: 'data', label: 'Data & backup' },
  { key: 'account', label: 'My account' },
];

// Tabs each role may open (admin: all). The server enforces the same rules on every save.
const ROLE_TABS = { production: ['production', 'account'], warehouse: ['warehouse', 'account'], sales: ['account'], viewer: ['account'] };

export function Settings({ tab }) {
  useTitle('Settings');
  const role = boot().user?.role;
  const allowed = role === 'admin' ? TABS.map((x) => x.key) : ROLE_TABS[role] || ['account'];
  const t = allowed.includes(tab) ? tab : allowed[0];
  return html`<div>
    <${PageHeader} overline="Knowledge & data" title="Settings" sub="The shared database: company, prices, catalogue, factory, warehouse and users" help="database" />
    ${allowed.length > 1 && html`<${Tabs} value=${t} onChange=${(k) => navigate(`/settings/${k}`, { replace: true })} tabs=${TABS.filter((x) => allowed.includes(x.key))} />`}
    ${t === 'company' && html`<${CompanyTab} />`}
    ${t === 'sales' && html`<${SalesTab} />`}
    ${t === 'logistics' && html`<${LogisticsTab} />`}
    ${t === 'catalogue' && html`<${CatalogueTab} />`}
    ${t === 'production' && html`<${ProductionTab} />`}
    ${t === 'warehouse' && html`<${WarehouseTab} />`}
    ${t === 'users' && html`<${UsersTab} />`}
    ${t === 'data' && html`<${DataTab} />`}
    ${t === 'account' && html`<${AccountTab} />`}
  </div>`;
}

// ---------------------------------------------------------------------------
// Generic editor for the reference tables (formats, colours, stages, kilns…)
// fields: [{ key, label, type: text|number|select|color|check|textarea|date, options: [[v, l]], hint, span, mono, required, step }]
// ---------------------------------------------------------------------------
function RefTable({ title, sub, icon, endpoint, query, columns, fields, defaults = {}, editable = true, refresh = true, empty, actions, onRow, pad = false, newLabel = 'Add' }) {
  const { data, error, loading, reload } = useAsync(() => get(`${endpoint}${qs(query || {})}`), [endpoint, JSON.stringify(query || {})]);
  const [edit, setEdit] = useState(null);
  const save = async (values, row) => {
    const out = row?.id ? await put(`${endpoint}/${row.id}`, values) : await post(endpoint, values);
    toast(row?.id ? 'Saved' : 'Added');
    setEdit(null);
    reload();
    if (refresh) refreshBoot().catch(() => {});
    return out;
  };
  const remove = async (row) => {
    if (!(await confirmDialog({ title: 'Delete?', message: 'This cannot be undone. Records that use it may block the delete - deactivate it instead.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await del(`${endpoint}/${row.id}`);
      toast('Deleted');
      setEdit(null);
      reload();
      if (refresh) refreshBoot().catch(() => {});
    } catch (e) {
      toastError(e);
    }
  };
  return html`<${Card} title=${title} sub=${sub} icon=${icon} pad=${pad}
    actions=${html`${actions}${editable && html`<${Button} size="sm" icon="plus" onClick=${() => setEdit({ ...defaults })}>${newLabel}<//>`}`}>
    ${error ? html`<div class="card-pad"><${ErrorBox} error=${error} retry=${reload} /></div>` : loading && !data ? html`<${Loading} />`
      : html`<${DataTable} compact columns=${columns} rows=${data.rows} onRowClick=${editable ? (r) => (onRow ? onRow(r) : setEdit(r)) : undefined} empty=${empty || html`<div class="muted small" style="padding:14px">Nothing yet.</div>`} />`}
    ${edit && html`<${RecordModal} title=${edit.id ? `Edit ${edit.code || edit.name || ''}` : `${newLabel} · ${title}`} fields=${fields} row=${edit} onSave=${save} onDelete=${edit.id ? () => remove(edit) : null} onClose=${() => setEdit(null)} />`}
  <//>`;
}

function RecordModal({ title, fields, row, onSave, onDelete, onClose, size = 'wide' }) {
  const [v, setV] = useState(() => Object.fromEntries(fields.map((f) => [f.key, row[f.key] ?? (f.type === 'check' ? 0 : '')])));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const go = async () => {
    setBusy(true);
    try {
      const body = {};
      for (const f of fields) {
        let x = v[f.key];
        if (f.type === 'number') x = x === '' || x === null ? null : Number(x);
        if (f.type === 'check') x = x ? 1 : 0;
        if (f.type === 'select' && x === '') x = null;
        if ((f.type === 'text' || f.type === 'textarea' || f.type === 'date' || !f.type) && x === '') x = null;
        if (f.readonlyOnEdit && row.id) continue;
        body[f.key] = x;
      }
      await onSave(body, row);
    } catch (e) {
      setErrors(e.data?.fields || {});
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const input = (f) => {
    const val = v[f.key];
    const set = (x) => setV({ ...v, [f.key]: x });
    const dis = f.readonlyOnEdit && row.id;
    if (f.type === 'select') return html`<select class="select" value=${val ?? ''} disabled=${dis} onChange=${(e) => set(e.target.value)}>${f.placeholder !== false && html`<option value="">${f.placeholder || '—'}</option>`}${(typeof f.options === 'function' ? f.options(v) : f.options).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>`;
    if (f.type === 'check') return html`<label class="check"><input type="checkbox" checked=${!!Number(val)} onChange=${(e) => set(e.target.checked ? 1 : 0)} />${f.checkLabel || f.label}</label>`;
    if (f.type === 'textarea') return html`<textarea class="textarea" value=${val ?? ''} onInput=${(e) => set(e.target.value)}></textarea>`;
    if (f.type === 'color') return html`<div class="row"><input type="color" value=${val || '#cccccc'} onInput=${(e) => set(e.target.value)} style="width:44px;height:36px;border:0;background:none;padding:0" /><input class="input mono" value=${val ?? ''} onInput=${(e) => set(e.target.value)} /></div>`;
    return html`<input class=${`input ${f.type === 'number' ? 'num' : ''} ${f.mono ? 'mono' : ''} ${errors[f.key] ? 'invalid' : ''}`} type=${f.type === 'number' ? 'number' : f.type || 'text'} step=${f.step || 'any'} value=${val ?? ''} disabled=${dis} onInput=${(e) => set(e.target.value)} placeholder=${f.placeholderText || ''} />`;
  };
  return html`<${Modal} title=${title} size=${size} onClose=${onClose} icon="edit"
    footer=${html`${onDelete && html`<${Button} variant="ghost danger" icon="trash" onClick=${onDelete} style="margin-right:auto">Delete<//>`}<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${go}>Save<//>`}>
    <div class="form-grid">
      ${fields.filter((f) => !f.showIf || f.showIf(v)).map((f) => (f.type === 'check' ? html`<div class=${f.span === 2 ? 'span-2' : ''} style="align-self:end">${input(f)}${f.hint && html`<div class="hint">${f.hint}</div>`}</div>` : html`<${Field} label=${f.label} hint=${f.hint} error=${errors[f.key]} required=${f.required} class=${f.span === 2 ? 'span-2' : ''}>${input(f)}<//>`))}
    </div>
  <//>`;
}

const yes = (v) => (v ? html`<${Icon} name="check" size="14" />` : html`<span class="muted">—</span>`);

/** A settings section stored in the settings table (defaults, logistics, production…). */
function useSettingsForm(key) {
  const { data, error, loading, reload } = useAsync(() => get('/settings'), []);
  const [v, setV] = useState(null);
  useEffect(() => {
    if (data) setV(JSON.parse(JSON.stringify(key ? data[key] : data)));
  }, [data]);
  const save = async (patch) => {
    try {
      await put('/settings', patch || { [key]: v });
      toast('Settings saved');
      reload();
      refreshBoot().catch(() => {});
    } catch (e) {
      toastError(e);
    }
  };
  return { all: data, v, setV, error, loading: loading || !v, save, reload };
}

// ---------------------------------------------------------------------------
function CompanyTab() {
  const st = useSettingsForm(null);
  const [url, setUrl] = useState(null);
  const docs = useAsync(() => get('/public/company'), []);
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (st.all) setUrl(st.all.public_url || '');
  }, [st.all]);
  const entity = (boot().entities || [])[0];
  const upload = async (files) => {
    if (!files?.length || !entity) return;
    setBusy(true);
    try {
      for (const f of files) await uploadFile(f, { entity: 'entity', entity_id: entity.id, kind: 'document' });
      toast('Added to the document library');
      docs.reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const legal = [
    ['ice', 'ICE'], ['if_number', 'IF (identifiant fiscal)'], ['rc', 'RC (registre de commerce)'], ['patente', 'Patente'], ['cnss', 'CNSS'], ['vat_number', 'VAT / TVA number'], ['capital', 'Share capital'],
  ];
  return html`<div class="stack">
    <${RefTable}
      title="Issuing companies"
      sub="Printed on quotes, orders and invoices"
      icon="factory"
      endpoint="/entities"
      columns=${[
        { key: 'name', label: 'Company', render: (e) => html`<div class="cell-main">${e.name}</div><div class="cell-sub">${e.brand || ''}</div>` },
        { key: 'city', label: 'City', render: (e) => [e.city, e.country].filter(Boolean).join(', ') },
        { key: 'ice', label: 'Legal IDs', render: (e) => html`<span class="small">${legal.filter(([k]) => e[k]).map(([, l]) => l.split(' ')[0]).join(' · ') || html`<${Badge} tone="warning" plain>missing<//>`}</span>` },
        { key: 'iban', label: 'Bank', render: (e) => (e.iban || e.bank_account ? html`<span class="small">${e.bank_name || 'Account'} set</span>` : html`<${Badge} tone="warning" plain>missing<//>`) },
        { key: 'is_default', label: 'Default', render: (e) => yes(e.is_default) },
      ]}
      fields=${[
        { key: 'name', label: 'Legal name', required: true }, { key: 'brand', label: 'Brand' },
        { key: 'address', label: 'Address', span: 2 }, { key: 'city', label: 'City' }, { key: 'country', label: 'Country' },
        { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'website', label: 'Website' },
        ...legal.map(([key, label]) => ({ key, label, mono: true })),
        { key: 'bank_name', label: 'Bank' }, { key: 'bank_account', label: 'Account number (RIB)', mono: true }, { key: 'iban', label: 'IBAN', mono: true }, { key: 'swift', label: 'SWIFT / BIC', mono: true },
        { key: 'footer_note', label: 'Document footer', type: 'textarea', span: 2 },
        { key: 'is_default', label: 'Default', type: 'check', checkLabel: 'Default issuing company' }, { key: 'active', label: 'Active', type: 'check', checkLabel: 'Active' },
      ]}
      defaults=${{ active: 1, country: 'Morocco' }}
    />
    <${Callout} tone="info" title="Moroccan invoices must show:">ICE, IF, RC, Patente and CNSS of the issuing company, plus the bank details for payment. Fill them in once here - they print on every document.<//>
    <${Card} title="Address printed in the QR codes" icon="qr">
      ${!url && url !== '' ? html`<${Loading} />` : html`<div class="form-grid">
        <${Field} label="Public address" hint=${`Now used: ${st.all?.public_url_effective || ''}`} class="span-2"><input class="input mono" value=${url} placeholder="https://crm.example.com" onInput=${(e) => setUrl(e.target.value)} /><//>
      </div>
      <div class="small ink2 mt-2">Every label encodes <span class="mono">${(url || st.all?.public_url_effective || '').replace(/\/$/, '')}/q/CODE</span>. Phones must be able to reach this address (factory Wi-Fi or the internet). The in-app camera scanner needs <b>https</b>; the phone's own camera app works either way. Set this <b>before</b> printing labels.</div>
      <div class="mt-2"><${Button} variant="primary" onClick=${() => st.save({ public_url: url })}>Save address<//></div>`}
    <//>
    <${Card} title="Document library" sub="Technical Data Sheet, Material Specification, Installation Guide…" icon="file"
      actions=${html`<${Button} size="sm" icon="upload" loading=${busy} onClick=${() => fileRef.current.click()}>Upload PDF<//>`}>
      <input ref=${fileRef} type="file" accept="application/pdf,image/*" multiple hidden onChange=${(e) => upload([...e.target.files])} />
      ${(docs.data?.docs || []).map((d) => html`<div class="row small mb-1"><${Icon} name="file" size="15" /><a href=${d.url} target="_blank" rel="noopener" style="flex:1">${d.filename}</a><${IconButton} icon="trash" label="Delete" onClick=${async () => {
        if (!(await confirmDialog({ title: `Delete ${d.filename}?`, confirmLabel: 'Delete', tone: 'danger' }))) return;
        try {
          await del(`/files/${d.id}`);
          docs.reload();
        } catch (e) {
          toastError(e);
        }
      }} /></div>`)}
      <div class="small muted ${(docs.data?.docs || []).length ? 'mt-2' : ''}">Upload your product PDFs once. They are offered as downloads on the public pages that installers open by scanning carton labels, and linked from the document pack of each shipment. <b>Files here are public</b> - only upload documents meant for clients.</div>
    <//>
  </div>`;
}

// ---------------------------------------------------------------------------
function SalesTab() {
  const st = useSettingsForm(null);
  if (st.error) return html`<${ErrorBox} error=${st.error} />`;
  if (st.loading) return html`<${Loading} />`;
  const d = st.v.defaults;
  const setD = (k, x) => st.setV({ ...st.v, defaults: { ...d, [k]: x } });
  const num = (k, label, hint, step) => html`<${Field} label=${label} hint=${hint}><input class="input num" type="number" step=${step || 'any'} value=${d[k]} onInput=${(e) => setD(k, e.target.value === '' ? '' : Number(e.target.value))} /><//>`;
  const rates = st.v.rates || {};
  const base = st.v.base_currency;
  return html`<div class="stack">
    <${Card} title="Quotes, orders and invoices" icon="file" foot=${html`<${Button} variant="primary" onClick=${() => st.save({ defaults: d })}>Save defaults<//>`}>
      <div class="form-grid cols-3">
        <${Field} label="Default currency"><select class="select" value=${d.currency} onChange=${(e) => setD('currency', e.target.value)}>${CURRENCIES.map((c) => html`<option>${c}</option>`)}</select><//>
        ${num('overage_pct', 'Overage %', 'Added to the net area for cutting, breakage and repairs. Minimum 15 %.')}
        ${num('deposit_pct', 'Deposit %', 'Production starts after the deposit and the written colour approval.')}
        ${num('quote_validity_days', 'Quote valid for (days)')}
        ${num('lead_time_weeks', 'Lead time (weeks)', 'Counted from colour approval + deposit, whichever is later.')}
        ${num('invoice_due_days', 'Invoice due after (days)')}
        ${num('vat_rate_domestic', 'VAT for Moroccan clients %')}
        <${Field} label="Default incoterm"><select class="select" value=${d.incoterm} onChange=${(e) => setD('incoterm', e.target.value)}>${Object.entries(INCOTERMS).map(([k, t]) => html`<option value=${k}>${k}${t.warn ? ' (avoid)' : ''}</option>`)}</select><//>
        <${Field} label="Named place"><input class="input" value=${d.incoterm_place} onInput=${(e) => setD('incoterm_place', e.target.value)} /><//>
        ${num('small_order_fee', `Small-order fee (${d.currency})`, 'Added below the pallet threshold. 0 = none.')}
        ${num('small_order_below_pallets', 'Small order below (pallets)')}
        <${Field} label="Export VAT note" class="span-2"><input class="input" value=${d.vat_note_export} onInput=${(e) => setD('vat_note_export', e.target.value)} /><//>
        <${Field} label="Payment terms" class="span-all"><input class="input" value=${d.payment_terms} onInput=${(e) => setD('payment_terms', e.target.value)} /><//>
      </div>
    <//>
    <${Card} title="Exchange rates" sub=${`Value of 1 unit in ${base}${st.v.rates_updated ? ` · updated ${fmtDate(st.v.rates_updated)}` : ''}`} icon="coins" foot=${html`<${Button} variant="primary" onClick=${() => st.save({ rates })}>Save rates<//>`}>
      <div class="form-grid cols-4">
        ${CURRENCIES.filter((c) => c !== base).map((c) => html`<${Field} label=${`1 ${c} =`}><div class="input-group"><input class="input num" type="number" step="0.0001" min="0" value=${rates[c] ?? ''} onInput=${(e) => st.setV({ ...st.v, rates: { ...rates, [c]: Number(e.target.value) } })} /><span class="addon">${base}</span></div><//>`)}
      </div>
      <div class="small muted mt-2">Computed prices are converted with these rates. Contract and fixed list prices are not affected. Check them at least monthly.</div>
    <//>
    <${Card} title="Sale conditions" sub="Printed on every quote, proforma and order" icon="clipboard" foot=${html`<${Button} variant="primary" onClick=${() => st.save({ terms: st.v.terms.filter((t) => t.trim()) })}>Save conditions<//>`}>
      <div class="stack sm">
        ${st.v.terms.map((t, i) => html`<div class="row top"><span class="small muted" style="width:18px;padding-top:8px">${i + 1}.</span><textarea class="textarea" rows="2" style="min-height:0" value=${t} onInput=${(e) => st.setV({ ...st.v, terms: st.v.terms.map((x, j) => (j === i ? e.target.value : x)) })}></textarea><${IconButton} icon="x" label="Remove" onClick=${() => st.setV({ ...st.v, terms: st.v.terms.filter((_, j) => j !== i) })} /></div>`)}
        <div><${Button} size="sm" icon="plus" onClick=${() => st.setV({ ...st.v, terms: [...st.v.terms, ''] })}>Add a condition<//></div>
      </div>
    <//>
  </div>`;
}

// ---------------------------------------------------------------------------
function LogisticsTab() {
  const st = useSettingsForm('logistics');
  if (st.error) return html`<${ErrorBox} error=${st.error} />`;
  if (st.loading) return html`<${Loading} />`;
  const v = st.v;
  const set = (k, x) => st.setV({ ...v, [k]: x });
  const fw = (v.forwarders || []).map((f) => (typeof f === 'string' ? { name: f } : f));
  const setFw = (i, k, x) => set('forwarders', fw.map((f, j) => (j === i ? { ...f, [k]: x } : f)));
  return html`<div class="stack">
    <${Card} title="Pallets and containers" icon="truck" foot=${html`<${Button} variant="primary" onClick=${() => st.save()}>Save<//>`}>
      <div class="form-grid cols-3">
        <${Field} label="Empty pallet weight (kg)"><input class="input num" type="number" value=${v.pallet_kg} onInput=${(e) => set('pallet_kg', Number(e.target.value))} /><//>
        <${Field} label="Max payload 20 ft (kg)"><input class="input num" type="number" value=${v.max_payload_20} onInput=${(e) => set('max_payload_20', Number(e.target.value))} /><//>
        <${Field} label="Max payload 40 ft (kg)"><input class="input num" type="number" value=${v.max_payload_40} onInput=${(e) => set('max_payload_40', Number(e.target.value))} /><//>
        <${Field} label="Port of loading"><input class="input" value=${v.port_loading} onInput=${(e) => set('port_loading', e.target.value)} /><//>
        <${Field} label="Book transport (weeks before ready)"><input class="input num" type="number" value=${v.book_weeks_before_ready} onInput=${(e) => set('book_weeks_before_ready', Number(e.target.value))} /><//>
      </div>
    <//>
    <${Card} title="Forwarders" sub="Stored in your database only" icon="ship" foot=${html`<${Button} variant="primary" onClick=${() => st.save({ logistics: { ...v, forwarders: fw.filter((f) => f.name?.trim()) } })}>Save forwarders<//>`}>
      <div class="stack sm">
        ${fw.map((f, i) => html`<div class="po-line">
          <input class="input" placeholder="Name" value=${f.name || ''} onInput=${(e) => setFw(i, 'name', e.target.value)} />
          <input class="input" placeholder="Contact / email" value=${f.contact || ''} onInput=${(e) => setFw(i, 'contact', e.target.value)} />
          <input class="input" placeholder="Used for (e.g. groupage EU)" value=${f.notes || ''} onInput=${(e) => setFw(i, 'notes', e.target.value)} />
          <${IconButton} icon="x" label="Remove" onClick=${() => set('forwarders', fw.filter((_, j) => j !== i))} />
        </div>`)}
        <div><${Button} size="sm" icon="plus" onClick=${() => set('forwarders', [...fw, { name: '' }])}>Add a forwarder<//></div>
      </div>
    <//>
  </div>`;
}

// ---------------------------------------------------------------------------
function CatalogueTab() {
  const [gen, setGen] = useState(false);
  const fam = [['zellige', 'Zellige'], ['cement', 'Cement'], ['terracotta', 'Terracotta'], ['other', 'Other']];
  const generate = async () => {
    setGen(true);
    try {
      const r = await post('/products/generate');
      toast(r.created ? `${r.created} products created` : 'Every colour × format product already exists');
      refreshBoot().catch(() => {});
    } catch (e) {
      toastError(e);
    } finally {
      setGen(false);
    }
  };
  return html`<div class="stack">
    <${RefTable}
      title="Colours"
      sub="The glaze range"
      icon="palette"
      endpoint="/colours"
      columns=${[
        { key: 'code', label: 'Colour', render: (c) => html`<div class="row"><${Swatch} hex=${c.hex} size="lg" /><div><div class="cell-main mono">${c.code}</div><div class="cell-sub">${c.name}</div></div></div>` },
        { key: 'finish', label: 'Finish', render: (c) => `${c.finish}${c.lead_free ? ' · lead-free' : ''}` },
        { key: 'glaze_family', label: 'Glaze family' },
        { key: 'price_adjust_pct', label: 'Price adj.', align: 'num', render: (c) => (c.price_adjust_pct ? `${c.price_adjust_pct > 0 ? '+' : ''}${c.price_adjust_pct} %` : '—') },
        { key: 'fast_seller', label: 'Fast seller', render: (c) => yes(c.fast_seller) },
        { key: 'sds_available', label: 'SDS', render: (c) => yes(c.sds_available) },
        { key: 'active', label: 'Active', render: (c) => yes(c.active) },
      ]}
      fields=${[
        { key: 'code', label: 'Code', required: true, mono: true, hint: 'Short code used in SKUs' }, { key: 'name', label: 'Name', required: true },
        { key: 'hex', label: 'Colour (for swatches)', type: 'color' }, { key: 'finish', label: 'Finish', type: 'select', options: [['glazed', 'Glazed'], ['natural', 'Natural clay']], placeholder: false },
        { key: 'glaze_family', label: 'Glaze family', hint: 'One SDS per glaze family' }, { key: 'colour_group', label: 'Colour group' },
        { key: 'price_adjust_pct', label: 'Price adjustment %', type: 'number', hint: 'E.g. +10 for costly pigments' }, { key: 'sort', label: 'Order', type: 'number' },
        { key: 'lead_free', label: 'Lead-free', type: 'check', checkLabel: 'Lead-free glaze' }, { key: 'fast_seller', label: 'Fast seller', type: 'check', checkLabel: 'Fast seller (kept in export reserve)' },
        { key: 'sds_available', label: 'SDS', type: 'check', checkLabel: 'Safety data sheet available' }, { key: 'active', label: 'Active', type: 'check', checkLabel: 'Active' },
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      ]}
      defaults=${{ finish: 'glazed', hex: '#cccccc', active: 1 }}
      actions=${html`<${Button} size="sm" icon="zap" loading=${gen} onClick=${generate}>Create missing products<//>`}
    />
    <${RefTable}
      title="Formats"
      sub="Sizes, packing and pallets"
      icon="ruler"
      endpoint="/formats"
      columns=${[
        { key: 'code', label: 'Format', render: (f) => html`<div class="cell-main mono">${f.code}</div><div class="cell-sub">${f.name}</div>` },
        { key: 'size', label: 'Size', render: (f) => (f.width_cm ? `${fmtQty(f.width_cm, 1)} × ${fmtQty(f.length_cm || f.width_cm, 1)} × ${fmtQty(f.thickness_cm, 1)} cm` : '—') },
        { key: 'pcs_per_box', label: 'Pcs/box', align: 'num' },
        { key: 'm2_per_box', label: 'm²/box', align: 'num', render: (f) => fmtQty(f.m2_per_box, 3) },
        { key: 'kg_per_box', label: 'kg/box', align: 'num', render: (f) => fmtQty(f.kg_per_box, 1) },
        { key: 'boxes_per_pallet', label: 'Boxes/pallet', align: 'num' },
        { key: 'sell_unit', label: 'Sold per', render: (f) => unitLabel(f.sell_unit) },
        { key: 'packing_confirmed', label: 'Packing', render: (f) => (f.packing_confirmed ? html`<${Badge} tone="success" plain>confirmed<//>` : html`<${Badge} tone="warning" plain>to confirm<//>`) },
      ]}
      fields=${[
        { key: 'code', label: 'Code', required: true, mono: true }, { key: 'name', label: 'Name', required: true },
        { key: 'family', label: 'Family', type: 'select', options: fam, placeholder: false }, { key: 'shape', label: 'Shape', type: 'select', options: [['square', 'Square'], ['rect', 'Rectangle'], ['hexagon', 'Hexagon'], ['custom', 'Other shape']], placeholder: false },
        { key: 'width_cm', label: 'Width (cm)', type: 'number' }, { key: 'length_cm', label: 'Length (cm)', type: 'number' }, { key: 'thickness_cm', label: 'Thickness (cm)', type: 'number' },
        { key: 'pcs_per_m2', label: 'Pieces per m²', type: 'number' }, { key: 'pcs_per_box', label: 'Pieces per box', type: 'number' }, { key: 'm2_per_box', label: 'm² per box', type: 'number' },
        { key: 'kg_per_box', label: 'kg per box', type: 'number' }, { key: 'boxes_per_pallet', label: 'Boxes per pallet', type: 'number', hint: '78 zellige, 60 cement' }, { key: 'box_dims', label: 'Box size' },
        { key: 'sell_unit', label: 'Sold per', type: 'select', options: [['m2', 'm²'], ['pc', 'piece'], ['lm', 'linear metre'], ['box', 'box']], placeholder: false },
        { key: 'production_loss_pct', label: 'Production loss %', type: 'number', hint: 'Extra pieces started to end with full boxes' }, { key: 'sort', label: 'Order', type: 'number' },
        { key: 'painted', label: 'Painted', type: 'check', checkLabel: 'Hand-painted (adds the painting stage)' }, { key: 'packing_confirmed', label: 'Packing confirmed', type: 'check', checkLabel: 'Packing data confirmed' },
        { key: 'active', label: 'Active', type: 'check', checkLabel: 'Active' }, { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      ]}
      defaults=${{ family: 'zellige', shape: 'square', sell_unit: 'm2', boxes_per_pallet: 78, production_loss_pct: 10, packing_confirmed: 1, active: 1 }}
    />
    <${RefTable}
      title="Price tiers"
      sub="List price = cost × multiplier × (1 + colour adjustment)"
      icon="coins"
      endpoint="/tiers"
      columns=${[
        { key: 'name', label: 'Tier', render: (t) => html`<div class="cell-main">${t.name}</div><div class="cell-sub mono">${t.code}</div>` },
        { key: 'multiplier', label: 'Multiplier', align: 'num', render: (t) => `× ${t.multiplier}` },
        { key: 'min_pallets', label: 'Minimum', align: 'num', render: (t) => (t.min_pallets ? `${fmtQty(t.min_pallets)} pallets` : '—') },
        { key: 'max_pallets', label: 'Maximum', align: 'num', render: (t) => (t.max_pallets ? `${fmtQty(t.max_pallets)} pallets` : '—') },
        { key: 'notes', label: 'Notes', render: (t) => html`<span class="small">${t.notes || ''}</span>` },
      ]}
      fields=${[
        { key: 'code', label: 'Code', required: true, mono: true }, { key: 'name', label: 'Name', required: true }, { key: 'multiplier', label: 'Multiplier', type: 'number', required: true },
        { key: 'min_pallets', label: 'Minimum order (pallets)', type: 'number' }, { key: 'max_pallets', label: 'Maximum (pallets)', type: 'number' }, { key: 'sort', label: 'Order', type: 'number' },
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      ]}
      defaults=${{ multiplier: 1 }}
    />
    <${ImportCard} />
  </div>`;
}

function ImportCard() {
  const [what, setWhat] = useState('colours');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef();
  const COLS = {
    colours: 'code, name, hex, finish, glaze_family, lead_free, colour_group, price_adjust_pct, fast_seller, sds_available, notes',
    products: 'sku, kind, format, colour, name, unit, cost, reserve_target_boxes, hs_code, active',
    clients: 'code, company, type, tier, currency, region, country, city, address, contact_name, email, phone, website, vat_number, incoterm, incoterm_place, payment_terms, deposit_pct, source, tags, notes',
    stock: 'sku or material, lot, grade, boxes, loose_pcs, qty, location, pool',
  };
  const go = async (file) => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const csv = await file.text();
      const r = await post(`/data/import/${what}`, { csv });
      setResult(r);
      toast(`${r.created} created, ${r.updated} updated`);
      refreshBoot().catch(() => {});
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
      ref.current.value = '';
    }
  };
  return html`<${Card} title="Import from a spreadsheet" sub="CSV, first line = column names" icon="upload">
    <div class="row wrap mb-2">
      <${Seg} value=${what} onChange=${(w) => (setWhat(w), setResult(null))} options=${[{ value: 'colours', label: 'Colours' }, { value: 'products', label: 'Products & costs' }, { value: 'clients', label: 'Clients' }, { value: 'stock', label: 'Opening stock' }]} />
      <${Button} icon="upload" variant="primary" loading=${busy} onClick=${() => ref.current.click()}>Choose CSV file<//>
      <a class="btn ghost sm" href=${`/api/data/export/${what === 'stock' ? 'stock' : what}`} download><${Icon} name="download" />Export current as template<//>
      <input ref=${ref} type="file" accept=".csv,text/csv" hidden onChange=${(e) => go(e.target.files[0])} />
    </div>
    <div class="small muted">Columns: <span class="mono">${COLS[what]}</span>. Rows with an existing code / SKU are updated; others are created. ${what === 'colours' ? 'New colours automatically get a product for every format.' : ''}</div>
    ${result && html`<div class="mt-2"><${Callout} tone=${result.errors?.length ? 'warning' : 'success'} title=${`${result.rows} rows: ${result.created} created, ${result.updated} updated.`}>${result.note || ''}${result.errors?.length ? html`<ul class="small" style="margin:6px 0 0;padding-left:18px">${result.errors.slice(0, 20).map((e) => html`<li>${e}</li>`)}</ul>` : ''}<//></div>`}
  <//>`;
}

// ---------------------------------------------------------------------------
function ProductionTab() {
  const st = useSettingsForm('production');
  const stages = useAsync(() => get('/stages'), []);
  const mats = useAsync(() => get('/materials?all=1'), []);
  const whs = boot().warehouses || [];
  const stageOpts = (stages.data?.rows || []).map((s) => [s.id, s.name]);
  return html`<div class="stack">
    ${!can() ? null : st.loading ? html`<${Loading} />` : html`<${Card} title="Production settings" icon="sliders" foot=${html`<${Button} variant="primary" onClick=${() => st.save()}>Save<//>`}>
      <div class="form-grid cols-3">
        <${Field} label="Default workshop"><select class="select" value=${st.v.default_workshop} onChange=${(e) => st.setV({ ...st.v, default_workshop: e.target.value })}>${whs.map((w) => html`<option value=${w.code}>${w.name}</option>`)}</select><//>
        <${Field} label="Packing-out location" hint="Where new pallets are created before put-away"><input class="input mono" value=${st.v.receiving_location_code} onInput=${(e) => st.setV({ ...st.v, receiving_location_code: e.target.value.toUpperCase() })} /><//>
        <div style="align-self:end"><${Toggle} checked=${!!st.v.auto_consume} onChange=${(c) => st.setV({ ...st.v, auto_consume: c })} label="Deduct raw materials automatically (bill of materials)" /></div>
      </div>
    <//>`}
    <${RefTable}
      title="Production stages"
      sub="The route every batch follows"
      icon="factory"
      endpoint="/stages"
      columns=${[
        { key: 'sort', label: '#', align: 'num' },
        { key: 'name', label: 'Stage', render: (s) => html`<div class="row"><span class="dot" style=${{ background: s.color }}></span><div><div class="cell-main">${s.name}</div><div class="cell-sub mono">${s.code}</div></div></div>` },
        { key: 'applies_to', label: 'Applies to' },
        { key: 'flags', label: 'Type', render: (s) => [s.is_kiln && 'kiln', s.is_qc && 'QC / sorting', s.is_packing && 'packing'].filter(Boolean).join(', ') || '—' },
        { key: 'typical_days', label: 'Typical days', align: 'num' },
        { key: 'active', label: 'Active', render: (s) => yes(s.active) },
      ]}
      fields=${[
        { key: 'code', label: 'Code', required: true, mono: true }, { key: 'name', label: 'Name', required: true }, { key: 'sort', label: 'Order in the route', type: 'number', required: true },
        { key: 'applies_to', label: 'Applies to', type: 'select', options: [['all', 'All products'], ['zellige', 'Zellige only'], ['glazed', 'Glazed zellige'], ['natural', 'Natural zellige'], ['painted', 'Painted formats'], ['cement', 'Cement tiles']], placeholder: false },
        { key: 'typical_days', label: 'Typical days', type: 'number' }, { key: 'daily_capacity_m2', label: 'Daily capacity (m²)', type: 'number' }, { key: 'color', label: 'Colour on the board', type: 'color' },
        { key: 'is_kiln', label: 'Kiln', type: 'check', checkLabel: 'Firing stage (recorded per kiln load)' }, { key: 'is_qc', label: 'QC', type: 'check', checkLabel: 'Sorting / QC stage (grades A, B)' },
        { key: 'is_packing', label: 'Packing', type: 'check', checkLabel: 'Packing stage (creates pallets)' }, { key: 'active', label: 'Active', type: 'check', checkLabel: 'Active' },
        { key: 'instructions', label: 'Instructions shown on the shop floor', type: 'textarea', span: 2 },
      ]}
      defaults=${{ applies_to: 'all', active: 1, color: '#8a6d3b' }}
    />
    <div class="grid cols-2">
      <${RefTable}
        title="Kilns"
        icon="flame"
        endpoint="/kilns"
        columns=${[
          { key: 'name', label: 'Kiln', render: (k) => html`<div class="cell-main">${k.name}</div><div class="cell-sub mono">KILN-${k.code}</div>` },
          { key: 'workshop', label: 'Workshop' },
          { key: 'capacity_m2', label: 'm²', align: 'num' },
          { key: 'active', label: 'Active', render: (k) => yes(k.active) },
        ]}
        fields=${[
          { key: 'code', label: 'Code', required: true, mono: true }, { key: 'name', label: 'Name', required: true },
          { key: 'workshop', label: 'Workshop', type: 'select', options: whs.map((w) => [w.code, w.name]) }, { key: 'capacity_m2', label: 'Capacity (m²)', type: 'number' },
          { key: 'fuel', label: 'Fuel' }, { key: 'active', label: 'Active', type: 'check', checkLabel: 'Active' }, { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
        ]}
        defaults=${{ fuel: 'Olive pits', active: 1 }}
      />
      <${RefTable}
        title="Workers"
        sub="Chosen on the shop-floor screen"
        icon="users"
        endpoint="/workers"
        columns=${[
          { key: 'name', label: 'Name', render: (w) => html`<div class="cell-main">${w.name}</div><div class="cell-sub">${w.team || ''}</div>` },
          { key: 'piece_rate', label: 'Piece rate', align: 'num', render: (w) => (w.piece_rate ? fmtQty(w.piece_rate, 3) : '—') },
          { key: 'active', label: 'Active', render: (w) => yes(w.active) },
        ]}
        fields=${[
          { key: 'name', label: 'Name', required: true }, { key: 'team', label: 'Team / workshop' }, { key: 'phone', label: 'Phone' },
          { key: 'piece_rate', label: `Piece rate (${boot().settings?.base_currency || 'MAD'} per good piece)`, type: 'number' }, { key: 'active', label: 'Active', type: 'check', checkLabel: 'Active' },
          { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
        ]}
        defaults=${{ active: 1 }}
      />
    </div>
    <${RefTable}
      title="Bill of materials"
      sub="What one m², piece or box consumes at each stage"
      icon="layers"
      endpoint="/bom-rules"
      refresh=${false}
      columns=${[
        { key: 'stage_name', label: 'Stage' },
        { key: 'material_name', label: 'Material', render: (b) => (b.colour_specific ? html`<i>Glaze of the product colour</i>` : html`${b.material_name}<div class="cell-sub mono">${b.material_code}</div>`) },
        { key: 'qty', label: 'Quantity', align: 'num', render: (b) => `${fmtQty(b.qty, 3)} ${b.colour_specific ? 'kg' : b.material_unit || ''} / ${b.per === 'm2' ? 'm²' : b.per}` },
        { key: 'scope', label: 'For', render: (b) => html`<span class="small">${[b.family !== 'all' && b.family, b.finish !== 'all' && b.finish, b.format_code].filter(Boolean).join(' · ') || 'all products'}</span>` },
      ]}
      fields=${[
        { key: 'stage_id', label: 'Stage', type: 'select', options: stageOpts },
        { key: 'colour_specific', label: 'Colour glaze', type: 'check', checkLabel: 'Glaze of the product colour (linked on the material)' },
        { key: 'material_id', label: 'Material', type: 'select', options: (mats.data?.rows || []).map((m) => [m.id, `${m.code} · ${m.name} (${m.unit})`]), showIf: (v) => !Number(v.colour_specific) },
        { key: 'qty', label: 'Quantity', type: 'number', required: true }, { key: 'per', label: 'Per', type: 'select', options: [['m2', 'm²'], ['piece', 'piece'], ['box', 'box']], placeholder: false },
        { key: 'family', label: 'Family', type: 'select', options: [['all', 'All'], ['zellige', 'Zellige'], ['cement', 'Cement']], placeholder: false },
        { key: 'finish', label: 'Finish', type: 'select', options: [['all', 'All'], ['glazed', 'Glazed'], ['natural', 'Natural']], placeholder: false },
        { key: 'format_id', label: 'Only for format', type: 'select', options: (boot().formats || []).map((f) => [f.id, `${f.code} · ${f.name}`]) },
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      ]}
      defaults=${{ per: 'm2', family: 'all', finish: 'all' }}
    />
    <${RefTable}
      title="Suppliers"
      icon="inbox"
      endpoint="/suppliers"
      refresh=${false}
      columns=${[
        { key: 'name', label: 'Supplier', render: (s) => html`<div class="cell-main">${s.name}</div><div class="cell-sub">${s.category || ''}</div>` },
        { key: 'contact_name', label: 'Contact', render: (s) => html`${s.contact_name || ''}<div class="cell-sub">${[s.phone, s.email].filter(Boolean).join(' · ')}</div>` },
        { key: 'active', label: 'Active', render: (s) => yes(s.active) },
      ]}
      fields=${[
        { key: 'name', label: 'Name', required: true }, { key: 'category', label: 'Supplies', hint: 'Clay, glazes, fuel, cartons…' }, { key: 'contact_name', label: 'Contact' },
        { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'address', label: 'Address' }, { key: 'active', label: 'Active', type: 'check', checkLabel: 'Active' },
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      ]}
      defaults=${{ active: 1 }}
    />
  </div>`;
}

// ---------------------------------------------------------------------------
function WarehouseTab() {
  const whs = useStore((s) => s.boot?.warehouses) || [];
  const [wh, setWh] = useState(String(whs[0]?.id || ''));
  const [wizard, setWizard] = useState(null);
  const kinds = Object.entries(ZONE_KINDS).map(([k, z]) => [k, z.label]);
  return html`<div class="stack">
    <${Callout} tone="info" title="How positions are named:">zone letter + rack number + level + position, e.g. <span class="mono">A01-2B</span> = zone A, rack 01, level 2, position B. Floor lanes: <span class="mono">F03-2</span> = lane 3, second pallet deep. Every position gets a QR label on its beam or lane front.<//>
    <${RefTable}
      title="Warehouses & workshops"
      icon="warehouse"
      endpoint="/warehouses"
      columns=${[
        { key: 'code', label: 'Code', render: (w) => html`<span class="mono strong">${w.code}</span>` },
        { key: 'name', label: 'Name' },
        { key: 'address', label: 'Address', render: (w) => html`<span class="small">${w.address || ''}</span>` },
        { key: 'active', label: 'Active', render: (w) => yes(w.active) },
      ]}
      fields=${[
        { key: 'code', label: 'Code', required: true, mono: true, hint: 'Prefix of every location code', readonlyOnEdit: true }, { key: 'name', label: 'Name', required: true },
        { key: 'address', label: 'Address', span: 2 }, { key: 'active', label: 'Active', type: 'check', checkLabel: 'Active' }, { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      ]}
      defaults=${{ active: 1 }}
    />
    <div class="row wrap"><span class="section-title" style="margin:0">Zones of</span><${Seg} value=${wh} onChange=${setWh} options=${whs.map((w) => ({ value: String(w.id), label: w.name }))} /></div>
    ${wh && html`<${RefTable}
      key=${wh}
      title="Zones"
      sub="Racking, floor lanes, shelves, quarantine, dispatch…"
      icon="map"
      endpoint="/zones"
      query=${{ warehouse_id: wh }}
      columns=${[
        { key: 'code', label: 'Zone', render: (z) => html`<div class="row"><span class="z-chip" style=${{ background: z.color || ZONE_KINDS[z.kind]?.color }}>${z.code}</span><div class="cell-main">${z.name}</div></div>` },
        { key: 'kind', label: 'Kind', render: (z) => ZONE_KINDS[z.kind]?.label || z.kind },
        { key: 'act', label: '', align: 'right', render: (z) => html`<${Button} size="sm" icon="grid" onClick=${(e) => (e.stopPropagation(), setWizard(z))}>Add positions<//> <${LinkButton} size="sm" variant="ghost" href=${`/labels?type=location&zone_id=${z.id}`} icon="qr">Labels<//>` },
      ]}
      fields=${[
        { key: 'warehouse_id', label: 'Warehouse', type: 'select', options: whs.map((w) => [w.id, w.name]), placeholder: false },
        { key: 'code', label: 'Zone letter(s)', required: true, mono: true, hint: 'A, B, F, S, Q…' }, { key: 'name', label: 'Name', required: true },
        { key: 'kind', label: 'Kind', type: 'select', options: kinds, placeholder: false }, { key: 'color', label: 'Colour on the map', type: 'color' }, { key: 'sort', label: 'Order', type: 'number' },
        { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
      ]}
      defaults=${{ warehouse_id: wh, kind: 'rack' }}
    />`}
    <div class="row"><${LinkButton} href="/warehouse" icon="map">Open the warehouse map<//><${LinkButton} href="/labels?type=location" icon="qr">Print location labels<//></div>
    ${wizard && html`<${ZoneWizard} zone=${wizard} onClose=${() => setWizard(null)} />`}
  </div>`;
}

function ZoneWizard({ zone, onClose }) {
  const defMode = { rack: 'rack', shelf: 'rack', floor: 'lane', quarantine: 'lane', dispatch: 'lane' }[zone.kind] || 'count';
  const [v, setV] = useState({ mode: defMode, racks: 2, levels: zone.kind === 'shelf' ? 5 : 3, positions: 3, lanes: 4, depth: 3, count: 4, startRack: 1, capacity: zone.kind === 'shelf' ? 30 : 1 });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const two = (n) => String(n).padStart(2, '0');
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const n = v.mode === 'rack' ? v.racks * v.levels * v.positions : v.mode === 'lane' ? v.lanes * v.depth : v.count;
  const example = v.mode === 'rack' ? `${zone.code}${two(v.startRack)}-1A … ${zone.code}${two(Number(v.startRack) + Number(v.racks) - 1)}-${v.levels}${L[v.positions - 1] || '?'}` : v.mode === 'lane' ? `${zone.code}${two(v.startRack)}-1 … ${zone.code}${two(Number(v.startRack) + Number(v.lanes) - 1)}-${v.depth}` : `${zone.code}${two(v.startRack)} … ${zone.code}${two(Number(v.startRack) + Number(v.count) - 1)}`;
  const go = async () => {
    setBusy(true);
    try {
      const r = await post(`/zones/${zone.id}/generate`, { ...v, capacity: v.capacity === '' ? null : Number(v.capacity) });
      toast(`${r.created} positions created - print their labels`);
      onClose();
      navigate(`/labels?type=location&zone_id=${zone.id}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const numF = (k, label, hint) => html`<${Field} label=${label} hint=${hint}><input class="input num" type="number" min="1" value=${v[k]} onInput=${set(k)} /><//>`;
  return html`<${Modal} title=${`Add positions to zone ${zone.code} · ${zone.name}`} onClose=${onClose} icon="grid" size="wide"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${go}>Create ${fmtNum(n)} positions<//>`}>
    <${Seg} value=${v.mode} onChange=${(m) => setV({ ...v, mode: m })} options=${[{ value: 'rack', label: 'Racks / shelving' }, { value: 'lane', label: 'Floor lanes' }, { value: 'count', label: 'Single bays' }]} />
    <div class="form-grid cols-3 mt-3">
      ${v.mode === 'rack' && html`${numF('racks', 'Racks (bays)')}${numF('levels', 'Levels per rack', 'Level 1 = floor')}${numF('positions', 'Positions per level', 'A, B, C… from the left')}`}
      ${v.mode === 'lane' && html`${numF('lanes', 'Lanes')}${numF('depth', 'Pallets deep')}`}
      ${v.mode === 'count' && numF('count', 'Bays')}
      ${numF('startRack', 'Start numbering at', 'To extend an existing zone')}
      <${Field} label=${`Capacity per position (${ZONE_KINDS[zone.kind]?.unit || 'units'})`} hint="Empty = no limit"><input class="input num" type="number" min="0" value=${v.capacity} onInput=${set('capacity')} /><//>
    </div>
    <div class="mt-2"><${Callout} tone="info">Creates <b>${fmtNum(n)}</b> positions: <span class="mono">${example}</span>. Existing codes are skipped.<//></div>
  <//>`;
}

// ---------------------------------------------------------------------------
function UsersTab() {
  const { data, error, loading, reload } = useAsync(() => get('/users'), []);
  const [edit, setEdit] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  const save = async (values, row) => {
    const body = { ...values };
    if (!body.password) delete body.password;
    if (row.id) await put(`/users/${row.id}`, body);
    else await post('/users', body);
    toast(row.id ? 'Saved' : 'User created - give them their password');
    setEdit(null);
    reload();
  };
  return html`<div class="stack">
    <${Card} title="Users" sub="Each person signs in with their own account" icon="users" pad=${false} actions=${html`<${Button} size="sm" icon="plus" onClick=${() => setEdit({ role: 'sales', active: 1 })}>Add user<//>`}>
      ${loading && !data
        ? html`<${Loading} />`
        : html`<${DataTable}
            compact
            columns=${[
              { key: 'name', label: 'Name', render: (u) => html`<div class="cell-main">${u.name}</div><div class="cell-sub">${u.email}</div>` },
              { key: 'role', label: 'Role', render: (u) => html`<${Badge} tone=${u.role === 'admin' ? 'accent' : 'neutral'}>${ROLES[u.role]?.label || u.role}<//>` },
              { key: 'last_login_at', label: 'Last sign-in', render: (u) => (u.last_login_at ? ago(u.last_login_at) : html`<span class="muted">never</span>`) },
              { key: 'active', label: 'Active', render: (u) => yes(u.active) },
            ]}
            rows=${data.rows}
            onRowClick=${(u) => setEdit(u)}
          />`}
    <//>
    <${Card} title="What each role can do" icon="lock">
      <div class="table-wrap"><table class="table compact"><tbody>
        ${Object.entries(ROLES).map(([k, r]) => html`<tr><td class="strong" style="width:140px">${r.label}</td><td class="small">${r.note || ''}</td></tr>`)}
      </tbody></table></div>
    <//>
    ${edit && html`<${RecordModal} title=${edit.id ? `Edit ${edit.name}` : 'New user'} size="" row=${edit} onSave=${save} onClose=${() => setEdit(null)}
      fields=${[
        { key: 'name', label: 'Name', required: true, span: 2 }, { key: 'email', label: 'Email (sign-in)', required: true, span: 2 },
        { key: 'role', label: 'Role', type: 'select', options: Object.entries(ROLES).map(([k, r]) => [k, r.label]), placeholder: false },
        { key: 'active', label: 'Active', type: 'check', checkLabel: 'Can sign in' },
        { key: 'password', label: edit.id ? 'New password (leave empty to keep)' : 'Password', type: 'password', span: 2, hint: 'At least 8 characters' },
      ]} />`}
  </div>`;
}

// ---------------------------------------------------------------------------
function DataTab() {
  const stats = useAsync(() => get('/data/stats'), []);
  const auditLog = useAsync(() => get('/audit'), []);
  const exports = [['clients', 'Clients'], ['products', 'Products & costs'], ['colours', 'Colours'], ['documents', 'Quotes, orders, invoices'], ['lines', 'Document lines'], ['payments', 'Payments'], ['stock', 'Stock by position'], ['locations', 'Locations'], ['moves', 'Stock movements'], ['production', 'Manufacturing orders'], ['materials', 'Raw materials']];
  const big = (stats.data?.tables || []).filter((t) => t.rows > 0).sort((a, b) => b.rows - a.rows);
  return html`<div class="stack">
    <div class="grid cols-2">
      <${Card} title="Backup" icon="database">
        <p class="small ink2">Download a complete copy of the database (one file). Keep copies off the server - a USB key, a cloud drive. The server also keeps a daily copy of the database by itself (last 14 days). Photos and PDFs are separate files: the command <span class="mono">npm run backup</span> on the server copies both.</p>
        <a class="btn primary" href="/api/data/backup" download><${Icon} name="download" />Download a backup now<//>
        ${stats.data?.backups?.length > 0 && html`<div class="small muted mt-2">On the server: ${stats.data.backups.slice(0, 5).join(', ')}</div>`}
        ${stats.data && html`<div class="small muted mt-2">Database size ${fmtQty(stats.data.size / 1048576, 1)} MB.</div>`}
      <//>
      <${Card} title="Export to a spreadsheet" icon="download">
        <div class="row wrap" style="gap:6px">${exports.map(([k, l]) => html`<a class="btn sm" href=${`/api/data/export/${k}`} download><${Icon} name="download" />${l}<//>`)}</div>
        <div class="small muted mt-2">CSV files open in Excel, Numbers or Google Sheets.</div>
      <//>
    </div>
    <${Card} title="What is in the database" icon="layers">
      ${stats.loading && !stats.data ? html`<${Loading} />` : html`<div class="row wrap" style="gap:6px">${big.map((t) => html`<span class="chip"><span class="mono">${t.name}</span> <b>${fmtNum(t.rows)}</b></span>`)}</div>`}
    <//>
    <${Card} title="Activity log" sub="Who changed what (last 500)" icon="history" pad=${false}>
      ${auditLog.loading && !auditLog.data
        ? html`<${Loading} />`
        : html`<${DataTable}
            compact
            columns=${[
              { key: 'at', label: 'When', render: (a) => html`<span class="small">${fmtDateTime(a.at)}</span>` },
              { key: 'user_name', label: 'Who', render: (a) => a.user_name || html`<span class="muted">system</span>` },
              { key: 'action', label: 'Action', render: (a) => html`<span class="small"><b>${a.action}</b> ${a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}</span>` },
              { key: 'summary', label: 'Detail', render: (a) => html`<span class="small muted">${a.summary || ''}</span>` },
            ]}
            rows=${auditLog.data?.rows || []}
          />`}
    <//>
  </div>`;
}

// ---------------------------------------------------------------------------
function AccountTab() {
  const user = boot().user || {};
  const theme = useStore((s) => s.theme);
  const [v, setV] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (v.next !== v.again) return toastError({ message: 'The two new passwords are different.' });
    setBusy(true);
    try {
      await post('/auth/password', { current: v.current, next: v.next });
      toast('Password changed');
      setV({ current: '', next: '', again: '' });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="grid cols-2">
    <${Card} title="Change my password" icon="lock" foot=${html`<${Button} variant="primary" loading=${busy} disabled=${!v.current || v.next.length < 8} onClick=${go}>Change password<//>`}>
      <div class="small muted mb-2">Signed in as <b>${user.name}</b> (${user.email || ''}) · ${ROLES[user.role]?.label || user.role}</div>
      <div class="form-grid">
        <${Field} label="Current password" class="span-2"><input class="input" type="password" autocomplete="current-password" value=${v.current} onInput=${(e) => setV({ ...v, current: e.target.value })} /><//>
        <${Field} label="New password" hint="At least 8 characters"><input class="input" type="password" autocomplete="new-password" value=${v.next} onInput=${(e) => setV({ ...v, next: e.target.value })} /><//>
        <${Field} label="Repeat"><input class="input" type="password" autocomplete="new-password" value=${v.again} onInput=${(e) => setV({ ...v, again: e.target.value })} /><//>
      </div>
    <//>
    <${Card} title="Display" icon="sun">
      <${Seg} value=${theme} onChange=${applyTheme} options=${[{ value: 'auto', label: 'Follow the device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      <div class="small muted mt-2">Dark mode is easier on the eyes in the kiln area at night; light is better in daylight on the warehouse floor.</div>
    <//>
  </div>`;
}
