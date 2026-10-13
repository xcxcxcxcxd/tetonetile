import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put, del, qs } from '../lib/api.js';
import { useAsync, useTitle, usePref } from '../lib/hooks.js';
import { Link, navigate, useQuery, setQuery } from '../lib/router.js';
import { can, toast, toastError } from '../lib/store.js';
import { uploadFile } from '../lib/image.js';
import { fmtNum, fmtQty, fmtDate, money, daysUntil, today, unitLabel } from '../lib/format.js';
import { SAMPLE_STATUSES, CLAIM_CATEGORIES, CLAIM_STATUSES, CURRENCIES, DOC_TYPES } from '/shared/constants.js';
import {
  Button, LinkButton, IconButton, Card, PageHeader, Loading, ErrorBox, Seg, Badge, StatusBadge, EmptyState, Callout, KV, Modal, Drawer, Field, Check, confirmDialog,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';
import { ClientPicker } from '../components/Combobox.js';
import { ProductPicker } from '../components/ProductPicker.js';
import { NewMoModal } from './Production.js';

const METHODS = { groupage: 'Groupage', courier: 'Courier', hand: 'By hand', pickup: 'Client pickup' };
const SAMPLE_FLOW = ['requested', 'prepared', 'sent', 'delivered'];

// ---------------------------------------------------------------------------
// Samples: request -> prepare -> send -> follow up -> written colour approval
// ---------------------------------------------------------------------------
export function Samples() {
  useTitle('Samples');
  const query = useQuery();
  const [status, setStatus] = usePref('samples.status', 'open');
  const [creating, setCreating] = useState(false);
  const openId = Number(query.get('open')) || null;
  const { data, error, loading, reload } = useAsync(() => get(`/samples${qs(status === 'open' ? { open: 1 } : { status })}`), [status]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  const rows = data?.rows || [];
  const due = rows.filter((s) => s.status === 'sent' && s.follow_up && daysUntil(s.follow_up) <= 0).length;
  const selected = openId ? rows.find((s) => s.id === openId) : null;
  return html`<div>
    <${PageHeader}
      overline="CRM · Sales"
      title="Samples"
      sub=${`Samples are indicative only - colour varies between kiln loads${due ? ` · ${due} follow-up${due === 1 ? '' : 's'} due` : ''}`}
      help="crm"
      actions=${can('sales') && html`<${Button} variant="primary" icon="plus" onClick=${() => setCreating(true)}>New sample request<//>`}
    />
    <div class="card">
      <div class="table-toolbar">
        <${Seg} value=${status} onChange=${setStatus} options=${[{ value: 'open', label: 'In progress' }, ...Object.entries(SAMPLE_STATUSES).map(([value, [label]]) => ({ value, label })), { value: '', label: 'All' }]} />
      </div>
      ${loading && !data
        ? html`<${Loading} />`
        : html`<${DataTable}
            columns=${[
              { key: 'number', label: 'Sample', sort: true, render: (s) => html`<div class="cell-main mono">${s.number}</div><div class="cell-sub">${fmtDate(s.created_at)}</div>` },
              { key: 'client_name', label: 'Client', sort: true, render: (s) => html`<${Link} href=${`/clients/${s.client_id}`}>${s.client_name}<//>${s.opportunity_title ? html`<div class="cell-sub">${s.opportunity_title}</div>` : ''}` },
              { key: 'items', label: 'Colours', render: (s) => html`<div class="row" style="gap:4px">${s.items.slice(0, 6).map((it) => html`<img class="thumb sm" src=${it.image_url} alt=${it.sku || ''} title=${`${it.sku || ''} · ${it.pieces || ''} pcs`} />`)}${s.items.length > 6 ? html`<span class="small muted">+${s.items.length - 6}</span>` : ''}</div>` },
              { key: 'status', label: 'Status', sort: true, render: (s) => html`<${StatusBadge} map=${SAMPLE_STATUSES} value=${s.status} />` },
              { key: 'method', label: 'Sent by', render: (s) => html`${METHODS[s.method]}${s.tracking ? html`<div class="cell-sub mono">${s.tracking}</div>` : ''}` },
              { key: 'follow_up', label: 'Follow up', sort: true, render: (s) => (s.follow_up ? html`<span style=${s.status === 'sent' && daysUntil(s.follow_up) <= 0 ? 'color:var(--danger);font-weight:600' : ''}>${fmtDate(s.follow_up)}</span>` : html`<span class="muted">—</span>`) },
              { key: 'charge', label: 'Charge', align: 'num', render: (s) => (s.charge ? html`${money(s.charge, s.currency)}<div class="cell-sub">${s.paid ? 'paid' : 'not paid'}</div>` : html`<span class="muted">free</span>`) },
            ]}
            rows=${rows}
            onRowClick=${(s) => setQuery({ open: s.id })}
            empty=${html`<${EmptyState} icon="package" title="No samples here" text="Log every sample request: it moves the opportunity to the Samples stage and reminds you to follow up 10 days after sending." kb="crm" />`}
          />`}
    </div>
    ${selected && html`<${SampleDrawer} s=${selected} onClose=${() => setQuery({ open: '' })} onChange=${reload} />`}
    ${openId && !selected && data && html`<${SampleById} id=${openId} onClose=${() => setQuery({ open: '' })} onChange=${reload} />`}
    ${creating && html`<${NewSampleModal} onClose=${() => setCreating(false)} onDone=${(s) => (setCreating(false), reload(), setQuery({ open: s.id }))} />`}
  </div>`;
}

/** Opened from a QR scan or a link when the sample is outside the current filter. */
function SampleById({ id, onClose, onChange }) {
  const { data } = useAsync(() => get('/samples'), [id]);
  const s = data?.rows.find((x) => x.id === id);
  return s ? html`<${SampleDrawer} s=${s} onClose=${onClose} onChange=${onChange} />` : null;
}

function SampleDrawer({ s, onClose, onChange }) {
  const [v, setV] = useState({ tracking: s.tracking || '', follow_up: s.follow_up || '', feedback: s.feedback || '', notes: s.notes || '', charge: s.charge ?? '', currency: s.currency || 'EUR', paid: s.paid ? 1 : 0, method: s.method });
  const [busy, setBusy] = useState(false);
  useEffect(() => setV({ tracking: s.tracking || '', follow_up: s.follow_up || '', feedback: s.feedback || '', notes: s.notes || '', charge: s.charge ?? '', currency: s.currency || 'EUR', paid: s.paid ? 1 : 0, method: s.method }), [s.id]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async (patch = {}, msg = 'Saved') => {
    setBusy(true);
    try {
      await put(`/samples/${s.id}`, { ...v, charge: v.charge === '' ? null : Number(v.charge), ...patch });
      toast(msg);
      onChange();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const idx = SAMPLE_FLOW.indexOf(s.status);
  const next = idx >= 0 && idx < SAMPLE_FLOW.length - 1 ? SAMPLE_FLOW[idx + 1] : null;
  const editable = can('sales', 'warehouse');
  return html`<${Drawer} title=${s.number} onClose=${onClose}
    actions=${html`<${StatusBadge} map=${SAMPLE_STATUSES} value=${s.status} />`}
    footer=${editable && html`<${Button} onClick=${onClose}>Close<//><${Button} variant="primary" loading=${busy} onClick=${() => save()}>Save<//>`}>
    <div class="steps-inline mb-3">
      ${[...SAMPLE_FLOW, 'approved'].map((st, i) => html`<span class=${st === s.status ? 'on' : i < idx || s.status === 'approved' ? 'done' : ''}>${SAMPLE_STATUSES[st][0]}</span>`)}
    </div>
    <${KV} items=${[
      ['Client', html`<${Link} href=${`/clients/${s.client_id}`}>${s.client_name}<//>`],
      ['Opportunity', s.opportunity_title],
      ['Requested', fmtDate(s.created_at)],
      ['Sent', s.sent_at ? fmtDate(s.sent_at) : null],
    ]} />
    <div class="section-title mt-3">Colours in the box</div>
    <div class="stack sm">
      ${s.items.map((it) => html`<div class="row"><img class="thumb" src=${it.image_url} alt="" /><div style="flex:1"><div class="mono strong">${it.sku || '—'}</div><div class="small muted">${it.name || ''}</div></div><span class="num">${fmtNum(it.pieces)} pcs</span></div>`)}
      ${!s.items.length && html`<div class="muted small">No colours listed.</div>`}
    </div>
    ${editable &&
    html`<div class="row wrap mt-3">
      ${next && html`<${Button} variant="primary" icon="arrowRight" loading=${busy} onClick=${() => save({ status: next }, `Marked ${SAMPLE_STATUSES[next][0].toLowerCase()}`)}>Mark ${SAMPLE_STATUSES[next][0].toLowerCase()}<//>`}
      ${['sent', 'delivered'].includes(s.status) && html`<${Button} icon="checkCircle" onClick=${() => save({ status: 'approved' }, 'Colour approved')}>Colour approved<//><${Button} variant="ghost danger" onClick=${() => save({ status: 'rejected' }, 'Marked not approved')}>Not approved<//>`}
    </div>`}
    ${s.status === 'approved' && html`<div class="mt-2"><${Callout} tone="info" title="Next:">record the written colour approval on the sales order (Gates). Production only starts after the approval and the deposit.<//></div>`}
    <div class="form-grid mt-3">
      <${Field} label="Sent by"><select class="select" value=${v.method} onChange=${set('method')} disabled=${!editable}>${Object.entries(METHODS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
      <${Field} label="Tracking"><input class="input mono" value=${v.tracking} onInput=${set('tracking')} disabled=${!editable} /><//>
      <${Field} label="Follow up on"><input class="input" type="date" value=${v.follow_up} onInput=${set('follow_up')} disabled=${!editable} /><//>
      <${Field} label="Charge"><div class="input-group"><input class="input num" type="number" min="0" value=${v.charge} onInput=${set('charge')} disabled=${!editable} /><select class="select" style="width:84px" value=${v.currency} onChange=${set('currency')} disabled=${!editable}>${CURRENCIES.map((c) => html`<option>${c}</option>`)}</select></div><//>
      <${Field} label="Client feedback" class="span-2"><textarea class="textarea" value=${v.feedback} onInput=${set('feedback')} disabled=${!editable} placeholder="What did they say about the colours?"></textarea><//>
      <${Field} label="Notes" class="span-2"><textarea class="textarea" value=${v.notes} onInput=${set('notes')} disabled=${!editable}></textarea><//>
    </div>
    ${v.charge !== '' && Number(v.charge) > 0 && html`<${Check} label="Sample charge paid" checked=${!!Number(v.paid)} onChange=${(c) => setV({ ...v, paid: c ? 1 : 0 })} />`}
    ${can('sales') &&
    html`<div class="mt-3"><${Button} size="sm" variant="ghost danger" icon="trash" onClick=${async () => {
      if (!(await confirmDialog({ title: `Delete ${s.number}?`, confirmLabel: 'Delete', tone: 'danger' }))) return;
      try {
        await del(`/samples/${s.id}`);
        onClose();
        onChange();
      } catch (e) {
        toastError(e);
      }
    }}>Delete<//></div>`}
  <//>`;
}

function NewSampleModal({ onClose, onDone }) {
  const [client, setClient] = useState(null);
  const [items, setItems] = useState([]);
  const [picker, setPicker] = useState(false);
  const [v, setV] = useState({ method: 'groupage', charge: '', currency: 'EUR', notes: '', opportunity_id: '' });
  const [busy, setBusy] = useState(false);
  const opps = useAsync(() => (client ? get(`/opportunities${qs({ client_id: client.id, open: 1 })}`) : null), [client?.id]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const go = async () => {
    setBusy(true);
    try {
      const s = await post('/samples', {
        client_id: client.id, opportunity_id: v.opportunity_id || null, method: v.method, currency: v.currency, notes: v.notes || null,
        charge: v.charge === '' ? null : Number(v.charge), items: items.map((it) => ({ product_id: it.id, pieces: Number(it.pieces) || 1 })),
      });
      toast(`${s.number} created`);
      onDone(s);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title="New sample request" size="wide" onClose=${onClose} icon="package"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} disabled=${!client || !items.length} onClick=${go}>Create<//>`}>
    <div class="form-grid">
      <${Field} label="Client" class="span-2"><${ClientPicker} value=${client} onChange=${(c) => (setClient(c), setV({ ...v, opportunity_id: '', currency: c?.currency || v.currency }))} autoFocus /><//>
      ${client && (opps.data?.rows || []).length > 0 && html`<${Field} label="Opportunity" class="span-2"><select class="select" value=${v.opportunity_id} onChange=${set('opportunity_id')}><option value="">—</option>${opps.data.rows.map((o) => html`<option value=${o.id}>${o.title}</option>`)}</select><//>`}
    </div>
    <div class="section-title mt-3">Colours</div>
    <div class="stack sm">
      ${items.map((it, i) => html`<div class="row">
        <img class="thumb" src=${it.image_url} alt="" /><div style="flex:1"><div class="mono strong">${it.sku}</div><div class="small muted">${it.colour_name || it.name}</div></div>
        <input class="input num" style="width:90px" type="number" min="1" value=${it.pieces} onInput=${(e) => setItems(items.map((x, j) => (j === i ? { ...x, pieces: e.target.value } : x)))} /><span class="small muted">pcs</span>
        <${IconButton} icon="x" label="Remove" onClick=${() => setItems(items.filter((_, j) => j !== i))} />
      </div>`)}
      <div><${Button} size="sm" icon="plus" onClick=${() => setPicker(true)}>Add colours<//></div>
    </div>
    <div class="form-grid cols-3 mt-3">
      <${Field} label="Send by"><select class="select" value=${v.method} onChange=${set('method')}>${Object.entries(METHODS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
      <${Field} label="Charge (empty = free)"><input class="input num" type="number" min="0" value=${v.charge} onInput=${set('charge')} /><//>
      <${Field} label="Currency"><select class="select" value=${v.currency} onChange=${set('currency')}>${CURRENCIES.map((c) => html`<option>${c}</option>`)}</select><//>
      <${Field} label="Notes" class="span-all"><input class="input" value=${v.notes} onInput=${set('notes')} /><//>
    </div>
    ${picker && html`<${ProductPicker} multi title="Colours for the sample box" onClose=${() => setPicker(false)} onPick=${(ps) => (setItems([...items, ...ps.filter((p) => !items.some((x) => x.id === p.id)).map((p) => ({ ...p, pieces: 4 }))]), setPicker(false))} />`}
  <//>`;
}

// ---------------------------------------------------------------------------
// Claims: judged against the sale conditions and the Variation & Imperfection standard
// ---------------------------------------------------------------------------
export function Claims() {
  useTitle('Claims');
  const [status, setStatus] = usePref('claims.status', 'open');
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useAsync(() => get(`/claims${qs(status === 'open' ? { open: 1 } : { status })}`), [status]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  return html`<div>
    <${PageHeader} overline="CRM · After sales" title="Claims" sub="Breakage, shortages and quality complaints, traced to the lot and the shipment" help="claims"
      actions=${can('sales') && html`<${Button} variant="primary" icon="plus" onClick=${() => setCreating(true)}>New claim<//>`} />
    <div class="card">
      <div class="table-toolbar">
        <${Seg} value=${status} onChange=${setStatus} options=${[{ value: 'open', label: 'Open' }, ...Object.entries(CLAIM_STATUSES).map(([value, [label]]) => ({ value, label })), { value: '', label: 'All' }]} />
      </div>
      ${loading && !data
        ? html`<${Loading} />`
        : html`<${DataTable}
            columns=${[
              { key: 'number', label: 'Claim', sort: true, render: (c) => html`<div class="cell-main mono">${c.number}</div><div class="cell-sub">${fmtDate(c.reported_at)}</div>` },
              { key: 'client_name', label: 'Client', sort: true },
              { key: 'category', label: 'Type', render: (c) => CLAIM_CATEGORIES[c.category] },
              { key: 'status', label: 'Status', sort: true, render: (c) => html`<${StatusBadge} map=${CLAIM_STATUSES} value=${c.status} />` },
              { key: 'qty_affected', label: 'Affected', align: 'num', render: (c) => (c.qty_affected ? `${fmtQty(c.qty_affected)} ${unitLabel(c.unit)}` : '—') },
              { key: 'refs', label: 'Order / lot', render: (c) => html`<span class="small">${[c.order_number, c.shipment_number, c.lot_code].filter(Boolean).join(' · ') || '—'}</span>` },
              { key: 'valid', label: 'Conditions', render: (c) => (c.in_writing && c.before_installation ? html`<${Badge} tone="success" plain>covered<//>` : html`<${Badge} tone="warning" plain>${!c.before_installation ? 'after installation' : 'not in writing'}<//>`) },
            ]}
            rows=${data.rows}
            onRowClick=${(c) => navigate(`/claims/${c.id}`)}
            empty=${html`<${EmptyState} icon="flag" title="No claims" text="Record every complaint here with photos, so it is traced to the lot, the kiln firing and the shipment." kb="claims" />`}
          />`}
    </div>
    ${creating && html`<${ClaimModal} onClose=${() => setCreating(false)} onDone=${(c) => navigate(`/claims/${c.id}`)} />`}
  </div>`;
}

function ClaimModal({ onClose, onDone, claim }) {
  const isNew = !claim;
  const [client, setClient] = useState(claim ? { id: claim.client_id, company: claim.client_name } : null);
  const [v, setV] = useState({
    reported_at: claim?.reported_at || today(), category: claim?.category || 'breakage', description: claim?.description || '', qty_affected: claim?.qty_affected ?? '',
    unit: claim?.unit || 'm2', in_writing: claim ? claim.in_writing : 1, before_installation: claim ? claim.before_installation : 1, order_id: claim?.order_id || '', shipment_id: claim?.shipment_id || '', lot_code: claim?.lot_code || '',
  });
  const [busy, setBusy] = useState(false);
  const orders = useAsync(() => (client ? get(`/docs${qs({ type: 'order', client_id: client.id })}`) : null), [client?.id]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const go = async () => {
    setBusy(true);
    try {
      let lotId = null;
      if (v.lot_code.trim()) {
        const lots = (await get(`/lots${qs({ q: v.lot_code.trim() })}`)).rows;
        const lot = lots.find((l) => l.code.toUpperCase() === v.lot_code.trim().toUpperCase()) || (lots.length === 1 ? lots[0] : null);
        if (!lot) throw new Error(`Lot ${v.lot_code} not found. Copy it from the carton label.`);
        lotId = lot.id;
      }
      const body = {
        client_id: client.id, reported_at: v.reported_at, category: v.category, description: v.description || null, qty_affected: v.qty_affected === '' ? null : Number(v.qty_affected),
        unit: v.unit, in_writing: v.in_writing ? 1 : 0, before_installation: v.before_installation ? 1 : 0, order_id: v.order_id || null, lot_id: lotId,
      };
      const c = isNew ? await post('/claims', body) : await put(`/claims/${claim.id}`, body);
      toast(isNew ? `${c.number} opened` : 'Saved');
      onDone(c);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${isNew ? 'New claim' : `Edit ${claim.number}`} size="wide" onClose=${onClose} icon="flag"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} disabled=${!client} onClick=${go}>${isNew ? 'Open claim' : 'Save'}<//>`}>
    <div class="form-grid">
      <${Field} label="Client" class="span-2"><${ClientPicker} value=${client} onChange=${(c) => (setClient(c), setV({ ...v, order_id: '' }))} autoFocus=${isNew} /><//>
      <${Field} label="Order">
        <select class="select" value=${v.order_id} onChange=${set('order_id')} disabled=${!client}>
          <option value="">—</option>
          ${(orders.data?.rows || []).map((o) => html`<option value=${o.id}>${o.number} · ${fmtDate(o.issue_date)}</option>`)}
        </select>
      <//>
      <${Field} label="Lot (from the carton label)"><input class="input mono" value=${v.lot_code} onInput=${set('lot_code')} placeholder="e.g. L26-0012" /><//>
      <${Field} label="Type"><select class="select" value=${v.category} onChange=${set('category')}>${Object.entries(CLAIM_CATEGORIES).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
      <${Field} label="Reported on"><input class="input" type="date" value=${v.reported_at} onInput=${set('reported_at')} /><//>
      <${Field} label="Quantity affected"><div class="input-group"><input class="input num" type="number" min="0" value=${v.qty_affected} onInput=${set('qty_affected')} /><select class="select" style="width:90px" value=${v.unit} onChange=${set('unit')}><option value="m2">m²</option><option value="box">boxes</option><option value="pc">pcs</option></select></div><//>
      <div class="stack sm" style="justify-content:flex-end">
        <${Check} label="Reported in writing (email, letter)" checked=${!!v.in_writing} onChange=${(c) => setV({ ...v, in_writing: c ? 1 : 0 })} />
        <${Check} label="Reported before installation" checked=${!!v.before_installation} onChange=${(c) => setV({ ...v, before_installation: c ? 1 : 0 })} />
      </div>
      <${Field} label="What happened" class="span-2"><textarea class="textarea" rows="4" value=${v.description} onInput=${set('description')} placeholder="What the client reports, how many boxes, photos received…"></textarea><//>
    </div>
  <//>`;
}

const GUIDE = {
  breakage: 'Compare with the overage on the order (15 % minimum covers cutting, transit breakage and future repairs). Ask for photos of the pallets on arrival and of the broken boxes. Check the loading photos and the seal number of the shipment.',
  shortage: 'Compare the delivered boxes with the packing list and the loading scan of the shipment (every pallet is scanned at loading). Ask for the delivery note signed by the receiver.',
  wrong_item: 'Check the SKU and glaze suffix on the carton labels against the order. The loading scan refuses pallets not reserved for the order, so ask for photos of the labels.',
  colour: 'Colour varies between kiln loads; each line ships from one lot. Check that the delivered lot is the one on the packing list, that the client approved the colour in writing, and the QC record of the lot.',
  quality: 'Judge against the Variation & Imperfection standard (Material Specification §06), not against machine-made tile. Open the lot to see the QC levels recorded at sorting.',
  other: 'Collect photos and the order and lot references before deciding.',
};

export function ClaimDetail({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/claims/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [mo, setMo] = useState(false);
  useTitle(data?.claim?.number || 'Claim');
  const c = data?.claim;
  const invoices = useAsync(() => (c?.order_id ? get(`/docs${qs({ client_id: c.client_id })}`) : null), [c?.order_id]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const covered = c.in_writing && c.before_installation;
  const related = (invoices.data?.rows || []).filter((d) => d.order_id === c.order_id && ['invoice', 'credit'].includes(d.type));
  const setStatus = async (status, extra = {}) => {
    try {
      await put(`/claims/${c.id}`, { status, ...extra });
      toast(`${c.number}: ${CLAIM_STATUSES[status][0].toLowerCase()}`);
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  const credit = async (inv) => {
    if (!(await confirmDialog({ title: 'Create a credit note', message: `A draft credit note is created from ${inv.number} with all its lines. Reduce it to the accepted quantity, then issue it.`, confirmLabel: 'Create draft' }))) return;
    try {
      const r = await post(`/docs/${inv.id}/convert`, { to: 'credit' });
      navigate(`/docs/${r.id}`);
    } catch (e) {
      toastError(e);
    }
  };
  return html`<div>
    <${PageHeader}
      back=${{ href: '/claims', label: 'Claims' }}
      overline=${CLAIM_CATEGORIES[c.category]}
      title=${html`<span class="mono">${c.number}</span> <${StatusBadge} map=${CLAIM_STATUSES} value=${c.status} />`}
      sub=${html`<${Link} href=${`/clients/${c.client_id}`}>${c.client_name}<//> · reported ${fmtDate(c.reported_at)}`}
      help="claims"
      actions=${can('sales') &&
      html`${c.status === 'open' && html`<${Button} icon="search" onClick=${() => setStatus('investigating')}>Investigate<//>`}
        ${['open', 'investigating'].includes(c.status) && html`<${Button} variant="primary" icon="check" onClick=${() => setStatus('accepted')}>Accept<//><${Button} variant="ghost danger" icon="x" onClick=${() => setStatus('rejected')}>Reject<//>`}
        ${c.status === 'accepted' && html`<${Button} variant="primary" icon="checkCircle" onClick=${() => setStatus('resolved')}>Mark resolved<//>`}
        <${Button} icon="edit" onClick=${() => setEdit(true)}>Edit<//>`}
    />
    <div class="grid side">
      <div class="stack">
        ${covered
          ? html`<${Callout} tone="success" title="Within the conditions:">reported in writing, before installation.<//>`
          : html`<${Callout} tone="warning" title="Outside the sale conditions.">${!c.before_installation ? 'The material was installed - installation constitutes acceptance. ' : ''}${!c.in_writing ? 'The claim was not made in writing. ' : ''}Any settlement is goodwill.<//>`}
        <${Card} title="What happened" icon="flag">
          <p style="white-space:pre-wrap" class="ink2">${c.description || html`<span class="muted">No description.</span>`}</p>
          <${KV} items=${[
            ['Quantity affected', c.qty_affected ? `${fmtQty(c.qty_affected)} ${unitLabel(c.unit)}` : null],
            ['Order', c.order_id ? html`<${Link} href=${`/docs/${c.order_id}`}>${c.order_number}<//>` : null],
            ['Shipment', c.shipment_id ? html`<${Link} href=${`/shipments/${c.shipment_id}`}>${c.shipment_number}<//>` : null],
            ['Lot', c.lot_id ? html`<${Link} class="mono" href=${`/lots/${c.lot_id}`}>${c.lot_code}<//>` : null],
          ]} />
        <//>
        <${Photos} claim=${c} photos=${data.photos} reload=${reload} />
        <${Card} title="Resolution" icon="checkCircle">
          <${Resolution} claim=${c} onSaved=${reload} />
        <//>
      </div>
      <div class="stack">
        <${Card} title="How to judge it" icon="book">
          <p class="small ink2">${GUIDE[c.category]}</p>
          ${c.lot_id && html`<${LinkButton} size="sm" href=${`/lots/${c.lot_id}`} icon="link">Lot traceability & QC<//>`}
        <//>
        ${can('sales') &&
        html`<${Card} title="Settle" icon="coins">
          <div class="small ink2 mb-2">Accepted claims are settled by a credit note against the invoice, or by replacement tiles from a new batch.</div>
          ${related.filter((d) => d.type === 'invoice' && d.status !== 'draft' && d.status !== 'cancelled').map((d) => html`<div class="row small mb-1"><${Link} href=${`/docs/${d.id}`} style="flex:1">${d.number}<//><span class="num">${money(d.total, d.currency)}</span><${Button} size="sm" onClick=${() => credit(d)}>Credit note<//></div>`)}
          ${related.filter((d) => d.type === 'credit').map((d) => html`<div class="row small mb-1"><${Link} href=${`/docs/${d.id}`} style="flex:1">${d.number}<//><${Badge} plain tone="info">${DOC_TYPES.credit.label}<//></div>`)}
          ${c.order_id && !related.length && html`<div class="small muted mb-2">No issued invoice on this order yet.</div>`}
          ${can('production') && html`<div class="mt-2"><${Button} size="sm" icon="factory" onClick=${() => setMo(true)}>Replacement batch<//></div>`}
        <//>`}
      </div>
    </div>
    ${edit && html`<${ClaimModal} claim=${c} onClose=${() => setEdit(false)} onDone=${() => (setEdit(false), reload())} />`}
    ${mo && html`<${NewMoModal} initial=${{ purpose: 'rework' }} onClose=${() => setMo(false)} onDone=${(m) => navigate(`/production/mo/${m.id}`)} />`}
  </div>`;
}

function Resolution({ claim, onSaved }) {
  const [v, setV] = useState({ resolution: claim.resolution || '', credit_amount: claim.credit_amount ?? '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await put(`/claims/${claim.id}`, { resolution: v.resolution || null, credit_amount: v.credit_amount === '' ? null : Number(v.credit_amount) });
      toast('Saved');
      onSaved();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<div class="form-grid">
    <${Field} label="Decision and what was agreed" class="span-2"><textarea class="textarea" value=${v.resolution} onInput=${(e) => setV({ ...v, resolution: e.target.value })} disabled=${!can('sales')}></textarea><//>
    <${Field} label="Credit amount" hint="In the currency of the order / invoice"><input class="input num" type="number" min="0" value=${v.credit_amount} onInput=${(e) => setV({ ...v, credit_amount: e.target.value })} disabled=${!can('sales')} /><//>
    ${can('sales') && html`<div style="align-self:end"><${Button} loading=${busy} onClick=${save}>Save<//></div>`}
  </div>`;
}

function Photos({ claim, photos, reload }) {
  const input = useRef();
  const [busy, setBusy] = useState(false);
  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of files) await uploadFile(f, { entity: 'claim', entity_id: claim.id });
      toast('Added');
      reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Card} title="Photos & documents" sub="Photos from the client, delivery notes" icon="camera"
    actions=${can('sales', 'warehouse', 'production') && html`<${Button} size="sm" icon="upload" loading=${busy} onClick=${() => input.current.click()}>Add<//>`}>
    <input ref=${input} type="file" accept="image/*,application/pdf" multiple hidden onChange=${(e) => upload([...e.target.files])} />
    <div class="img-strip">
      ${photos.map((p) =>
        p.mime === 'application/pdf'
          ? html`<a class="chip" href=${`/files/${p.stored_name}`} target="_blank" rel="noopener"><${Icon} name="file" size="14" />${p.filename}</a>`
          : html`<a class="img-tile" href=${`/files/${p.stored_name}`} target="_blank" rel="noopener"><img src=${`/files/${p.stored_name}`} alt=${p.filename} loading="lazy" /></a>`,
      )}
    </div>
    ${!photos.length && html`<div class="small muted">No photos yet. Ask the client for photos of the pallets on arrival, the damaged boxes and the carton labels (they carry the lot).</div>`}
  <//>`;
}
