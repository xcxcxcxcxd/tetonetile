import { useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put, del, qs } from '../lib/api.js';
import { useAsync, useTitle, usePref } from '../lib/hooks.js';
import { Link, navigate } from '../lib/router.js';
import { boot, can, toast, toastError } from '../lib/store.js';
import { beep } from '../lib/feedback.js';
import { uploadFile } from '../lib/image.js';
import { fmtNum, fmtQty, fmtDate, ago } from '../lib/format.js';
import { SHIPMENT_MODES, SHIPMENT_STATUSES, UNIT_STATUSES, REGIONS, INCOTERMS, DOC_TYPES } from '/shared/constants.js';
import {
  Button, LinkButton, IconButton, Card, PageHeader, Loading, ErrorBox, Seg, Tabs, Badge, StatusBadge, EmptyState, Callout, Modal, Field, Meter, Stat, confirmDialog, promptDialog,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';
import { ClientPicker } from '../components/Combobox.js';
import { ScannerView } from '../components/Scanner.js';

const FLOW = ['planning', 'booked', 'loading', 'loaded', 'shipped', 'delivered'];
const DOC_STATUS = { todo: ['To do', 'warning'], ready: ['Ready', 'success'], sent: ['Sent', 'info'], na: ['Not needed', 'neutral'] };

export function Shipments() {
  useTitle('Shipments');
  const [status, setStatus] = usePref('shipments.status', 'open');
  const [creating, setCreating] = useState(false);
  const { data, error, loading, reload } = useAsync(() => get(`/shipments${qs({ status })}`), [status]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  return html`<div>
    <${PageHeader} overline="Stock · Logistics" title="Shipments" sub="Containers and groupage loads: document pack, container fill and scan-to-load" help="shipping"
      actions=${can('sales', 'warehouse') && html`<${Button} variant="primary" icon="plus" onClick=${() => setCreating(true)}>New shipment<//>`} />
    <div class="card">
      <div class="table-toolbar">
        <${Seg} value=${status} onChange=${setStatus} options=${[{ value: 'open', label: 'Open' }, ...Object.entries(SHIPMENT_STATUSES).map(([value, [label]]) => ({ value, label })), { value: '', label: 'All' }]} />
      </div>
      ${loading && !data
        ? html`<${Loading} />`
        : html`<${DataTable}
            columns=${[
              { key: 'number', label: 'Shipment', sort: true, render: (s) => html`<div class="cell-main mono">${s.number}</div><div class="cell-sub">${SHIPMENT_MODES[s.mode]}</div>` },
              { key: 'client_name', label: 'Client / orders', render: (s) => html`${s.client_name || html`<span class="muted">Several clients</span>`}<div class="cell-sub">${s.orders || 'No order yet'}</div>` },
              { key: 'status', label: 'Status', sort: true, render: (s) => html`<${StatusBadge} map=${SHIPMENT_STATUSES} value=${s.status} />` },
              { key: 'ready_date', label: 'Ready / ETD', sort: true, render: (s) => html`${fmtDate(s.ready_date)}<div class="cell-sub">${s.etd ? `ETD ${fmtDate(s.etd)}` : ''}${s.eta ? ` · ETA ${fmtDate(s.eta)}` : ''}</div>` },
              { key: 'loaded_units', label: 'Loaded', align: 'num', render: (s) => fmtNum(s.loaded_units) },
              { key: 'docs', label: 'Documents', render: (s) => (s.docs_total ? html`<div style="width:110px"><${Meter} value=${s.docs_done} max=${s.docs_total} tone=${s.docs_done === s.docs_total ? 'ok' : 'warn'} /><div class="tiny muted mt-1">${s.docs_done} / ${s.docs_total} ready</div></div>` : '—') },
            ]}
            rows=${data.rows}
            onRowClick=${(s) => navigate(`/shipments/${s.id}`)}
            empty=${html`<${EmptyState} icon="truck" title="No shipments" text="Create a shipment for one or more sales orders when their pallets are reserved. It builds the document pack for the destination." kb="shipping" />`}
          />`}
    </div>
    ${creating && html`<${NewShipmentModal} onClose=${() => setCreating(false)} onDone=${(s) => navigate(`/shipments/${s.id}`)} />`}
  </div>`;
}

function NewShipmentModal({ onClose, onDone }) {
  const s = boot().settings || {};
  const [client, setClient] = useState(null);
  const [orderIds, setOrderIds] = useState([]);
  const [v, setV] = useState({ mode: 'container_40', region: '', incoterm: '', incoterm_place: '', ready_date: '', forwarder: '' });
  const [busy, setBusy] = useState(false);
  const orders = useAsync(() => (client ? get(`/docs${qs({ type: 'order', client_id: client.id, open: 1 })}`) : null), [client?.id]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const forwarders = s.logistics?.forwarders || [];
  const go = async () => {
    setBusy(true);
    try {
      const body = { client_id: client?.id || null, order_ids: orderIds };
      for (const [k, val] of Object.entries(v)) if (val) body[k] = val;
      const sh = await post('/shipments', body);
      toast(`${sh.number} created with its document pack`);
      onDone(sh);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const eligible = (orders.data?.rows || []).filter((o) => ['confirmed', 'in_production', 'ready'].includes(o.status));
  return html`<${Modal} title="New shipment" size="wide" onClose=${onClose} icon="truck"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${go}>Create shipment<//>`}>
    <div class="form-grid">
      <${Field} label="Client" class="span-2" hint="Leave empty for a consolidated groupage with several clients"><${ClientPicker} value=${client} onChange=${(c) => (setClient(c), setOrderIds([]), setV({ ...v, region: c?.region || '', incoterm: c?.incoterm || '', incoterm_place: c?.incoterm_place || '' }))} autoFocus /><//>
      ${client &&
      html`<${Field} label="Orders in this shipment" class="span-2">
        ${eligible.length
          ? html`<div class="stack sm">${eligible.map((o) => html`<label class=${`pick-row ${orderIds.includes(o.id) ? 'on' : ''}`}><input type="checkbox" checked=${orderIds.includes(o.id)} onChange=${(e) => setOrderIds(e.target.checked ? [...orderIds, o.id] : orderIds.filter((x) => x !== o.id))} /><span style="flex:1"><b>${o.number}</b> <span class="small muted">${DOC_TYPES.order.statuses[o.status]?.[0] || o.status}${o.project ? ` · ${o.project}` : ''}</span></span></label>`)}</div>`
          : html`<div class="small muted">${orders.loading ? 'Loading…' : 'No open order for this client.'}</div>`}
      <//>`}
      <${Field} label="Transport"><select class="select" value=${v.mode} onChange=${set('mode')}>${Object.entries(SHIPMENT_MODES).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
      <${Field} label="Destination region" hint="Decides the document pack"><select class="select" value=${v.region} onChange=${set('region')}><option value="">From the client</option>${Object.entries(REGIONS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
      <${Field} label="Incoterm"><select class="select" value=${v.incoterm} onChange=${set('incoterm')}><option value="">${s.defaults?.incoterm || 'Default'}</option>${Object.entries(INCOTERMS).map(([k, t]) => html`<option value=${k} title=${t.note}>${k}${t.warn ? ' (avoid)' : ''}</option>`)}</select><//>
      <${Field} label="Named place"><input class="input" value=${v.incoterm_place} onInput=${set('incoterm_place')} placeholder=${s.defaults?.incoterm_place || ''} /><//>
      <${Field} label="Ready to load on"><input class="input" type="date" value=${v.ready_date} onInput=${set('ready_date')} /><//>
      <${Field} label="Forwarder">${forwarders.length
        ? html`<select class="select" value=${v.forwarder} onChange=${set('forwarder')}><option value="">—</option>${forwarders.map((f) => html`<option value=${f.name || f}>${f.name || f}</option>`)}</select>`
        : html`<input class="input" value=${v.forwarder} onInput=${set('forwarder')} />`}<//>
    </div>
    ${v.incoterm === 'DDP' && html`<div class="mt-2"><${Callout} tone="warning" title="DDP:">we pay import duties and taxes at destination. Make sure they are priced into the quote.<//></div>`}
  <//>`;
}

export function ShipmentDetail({ id }) {
  const { data, error, loading, reload, setData } = useAsync(() => get(`/shipments/${id}`), [id]);
  const [tab, setTab] = useState('pending');
  useTitle(data?.number || 'Shipment');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const sh = data;
  const idx = FLOW.indexOf(sh.status);
  const ops = can('sales', 'warehouse');
  const closed = ['shipped', 'delivered', 'cancelled'].includes(sh.status);
  const container = sh.mode.startsWith('container');
  const lotIds = new Map(sh.units.filter((u) => u.lot_id).map((u) => [u.lot_code, u.lot_id]));

  const setStatus = async (status, force = false) => {
    try {
      setData(await post(`/shipments/${sh.id}/status`, { status, force }));
      toast(`${sh.number}: ${SHIPMENT_STATUSES[status][0].toLowerCase()}`);
    } catch (e) {
      if (e.data?.code === 'ship_warnings') {
        const ok = await confirmDialog({ title: 'Ship anyway?', message: e.data.warnings.join('\n'), confirmLabel: 'Ship anyway', tone: 'danger' });
        if (ok) return setStatus(status, true);
      } else toastError(e);
    }
  };
  const unload = async (u) => {
    if (!(await confirmDialog({ title: `Take ${u.code} off?`, message: 'It goes back to the dispatch area as picked.', confirmLabel: 'Unload' }))) return;
    try {
      setData(await post(`/shipments/${sh.id}/unload`, { unit_id: u.id }));
    } catch (e) {
      toastError(e);
    }
  };
  const nextStep = { planning: 'booked', booked: 'loading', loading: 'loaded', loaded: 'shipped', shipped: 'delivered' }[sh.status];

  return html`<div>
    <${PageHeader}
      back=${{ href: '/shipments', label: 'Shipments' }}
      overline=${`${SHIPMENT_MODES[sh.mode]} · ${sh.region}`}
      title=${html`<span class="mono">${sh.number}</span> <${StatusBadge} map=${SHIPMENT_STATUSES} value=${sh.status} />`}
      sub=${`${sh.client_name || 'Consolidated'} · ${sh.incoterm || ''} ${sh.incoterm_place || ''}${sh.forwarder ? ` · ${sh.forwarder}` : ''}`}
      help="shipping"
      actions=${html`<${LinkButton} href=${`/print/packing-list/${sh.id}`} icon="printer">Packing list<//>
        ${sh.region === 'US' && html`<${LinkButton} href=${`/print/origin/${sh.id}`} icon="file">Origin file<//>`}
        <${LinkButton} href=${`/labels?type=shipment&ids=${sh.id}`} icon="qr">Loading sheet<//>
        ${!closed && ops && html`<${LinkButton} variant="primary" href=${`/shipments/${sh.id}/load`} icon="scan">Scan to load<//>`}`}
    />
    <div class="steps-inline mb-3">
      ${FLOW.map((st, i) => html`<span class=${i < idx ? 'done' : i === idx ? 'on' : ''}>${SHIPMENT_STATUSES[st][0]}</span>`)}
      ${sh.status === 'cancelled' && html`<${Badge} tone="danger">Cancelled<//>`}
      ${ops && nextStep && nextStep !== 'loading' && html`<${Button} size="sm" variant=${nextStep === 'shipped' ? 'primary' : ''} onClick=${() => setStatus(nextStep)}>Mark ${SHIPMENT_STATUSES[nextStep][0].toLowerCase()}<//>`}
      ${ops && ['planning', 'booked'].includes(sh.status) && html`<${Button} size="sm" variant="ghost danger" onClick=${() => setStatus('cancelled')}>Cancel<//>`}
    </div>
    <div class="kpis">
      <${Stat} label="Pallets" value=${`${fmtNum(sh.done.pallet_count)} / ${fmtNum(sh.plan.pallet_count)}`} note="loaded / planned" icon="pallet" />
      <${Stat} label="Boxes" value=${fmtNum(sh.plan.boxes)} note=${`${fmtQty(sh.plan.m2, 0)} m²`} icon="package" />
      <${Stat} label="Gross weight" value=${`${fmtNum(sh.plan.gross_kg)} kg`} note=${sh.max_payload_kg ? `limit ${fmtNum(sh.max_payload_kg)} kg` : ''} icon="weight" />
      <${Stat} label="Documents" value=${`${sh.docs_progress.done} / ${sh.docs_progress.total}`} note="ready" noteTone=${sh.docs_progress.done < sh.docs_progress.total ? 'warn' : ''} icon="file" />
    </div>
    ${container &&
    html`<div class="card card-pad mb-3">
      <div class="grid cols-2">
        <div><div class="row between small mb-1"><b>Floor space</b><span>${sh.check.volumePct ?? 0} %</span></div><${Meter} value=${sh.check.volumePct || 0} max=${100} /></div>
        <div><div class="row between small mb-1"><b>Payload</b><span>${sh.check.weightPct ?? '—'} %</span></div><${Meter} value=${sh.check.weightPct || 0} max=${100} /></div>
      </div>
      ${sh.check.messages.map((m) => html`<div class="mt-2"><${Callout} tone="danger">${m}<//></div>`)}
      <div class="tiny muted mt-2">A 20 ft takes 10 zellige pallets (20 cement), a 40 ft 18 (22 cement). Zellige fills the floor before the weight limit; cement hits the weight limit first.</div>
    </div>`}
    <div class="grid side">
      <div class="stack">
        <${Card} pad=${false} title="Pallets" icon="pallet">
          <div style="padding:0 16px"><${Tabs} value=${tab} onChange=${setTab} tabs=${[{ key: 'pending', label: 'To load', count: sh.pending.length }, { key: 'loaded', label: 'Loaded', count: sh.loaded.length }]} /></div>
          <${DataTable}
            compact
            columns=${[
              { key: 'code', label: 'Unit', render: (u) => html`<div class="prod-cell"><img class="thumb sm" src=${u.image_url} alt="" /><div><${Link} class="mono cell-main" href=${`/stock/units/${u.id}`}>${u.code}<//><div class="cell-sub">${u.sku} · lot ${u.lot_code || '—'}</div></div></div>` },
              { key: 'boxes', label: 'Boxes', align: 'num', render: (u) => fmtNum(u.boxes) },
              { key: 'order_number', label: 'Order', render: (u) => u.order_number || '' },
              tab === 'pending'
                ? { key: 'location_label', label: 'Pick from', render: (u) => html`<span class="mono strong">${u.location_label || '—'}</span>${u.status === 'picked' ? html` <${Badge} tone="progress" plain>picked<//>` : ''}` }
                : { key: 'status', label: 'Status', render: (u) => html`<${StatusBadge} map=${UNIT_STATUSES} value=${u.status} />` },
              ...(tab === 'loaded' && can('warehouse') && !closed ? [{ key: 'x', label: '', align: 'right', render: (u) => (u.status === 'loaded' && !u.parent_id ? html`<${Button} size="sm" variant="ghost" icon="undo" onClick=${() => unload(u)}>Unload<//>` : '') }] : []),
            ]}
            rows=${(tab === 'pending' ? sh.pending : sh.loaded).filter((u) => !u.parent_id)}
            empty=${html`<div class="muted small" style="padding:14px">${tab === 'pending' ? (sh.orders.length ? 'Nothing left to load. Reserve stock on the orders to see their pallets here.' : 'Add an order to this shipment.') : 'Nothing loaded yet.'}</div>`}
          />
        <//>
        <${DocsCard} sh=${sh} onChange=${setData} />
        <${PhotosCard} sh=${sh} reload=${reload} />
      </div>
      <div class="stack">
        <${OrdersCard} sh=${sh} onChange=${setData} />
        <${DetailsCard} sh=${sh} onChange=${setData} />
        ${sh.lots.length > 0 &&
        html`<${Card} title="Lots on board" icon="link">
          <div class="row wrap" style="gap:6px">${sh.lots.map((l) => (lotIds.get(l) ? html`<${Link} class="chip mono" href=${`/lots/${lotIds.get(l)}`}>${l}<//>` : html`<span class="chip mono">${l}</span>`))}</div>
          <div class="tiny muted mt-2">Each lot is one kiln batch. The packing list shows the lot per pallet so the installer can keep batches apart.</div>
        <//>`}
      </div>
    </div>
  </div>`;
}

function OrdersCard({ sh, onChange }) {
  const [adding, setAdding] = useState(false);
  const [orderId, setOrderId] = useState('');
  const candidates = useAsync(() => (adding ? get(`/docs${qs({ type: 'order', open: 1, client_id: sh.client_id || '' })}`) : null), [adding]);
  const ops = can('sales', 'warehouse');
  const add = async () => {
    try {
      onChange(await post(`/shipments/${sh.id}/orders`, { order_id: Number(orderId) }));
      setAdding(false);
      setOrderId('');
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (o) => {
    try {
      onChange(await del(`/shipments/${sh.id}/orders/${o.id}`));
    } catch (e) {
      toastError(e);
    }
  };
  return html`<${Card} title="Orders" icon="order" actions=${ops && !['shipped', 'delivered', 'cancelled'].includes(sh.status) && html`<${Button} size="sm" icon="plus" onClick=${() => setAdding(!adding)}>Add<//>`}>
    ${sh.orders.map((o) => html`<div class="row small mb-1">
      <${Link} href=${`/docs/${o.id}`} class="strong">${o.number}<//>
      <span class="muted truncate" style="flex:1">${o.client_name}</span>
      <${StatusBadge} map=${DOC_TYPES.order.statuses} value=${o.status} />
      ${ops && sh.status !== 'shipped' && html`<${IconButton} icon="x" label="Remove from shipment" onClick=${() => remove(o)} />`}
    </div>`)}
    ${!sh.orders.length && html`<div class="small muted">No order yet.</div>`}
    ${adding &&
    html`<div class="row mt-2">
      <select class="select" value=${orderId} onChange=${(e) => setOrderId(e.target.value)}>
        <option value="">Choose an order…</option>
        ${(candidates.data?.rows || []).filter((o) => !sh.orders.some((x) => x.id === o.id)).map((o) => html`<option value=${o.id}>${o.number} · ${o.client_name}</option>`)}
      </select>
      <${Button} variant="primary" disabled=${!orderId} onClick=${add}>Add<//>
    </div>`}
  <//>`;
}

function DetailsCard({ sh, onChange }) {
  const fields = [
    ['forwarder', 'Forwarder'], ['booking_ref', 'Booking ref'], ['container_no', 'Container no.'], ['seal_no', 'Seal no.'], ['bl_no', 'B/L no.'], ['vessel', 'Vessel'],
    ['port_loading', 'Port of loading'], ['port_discharge', 'Port of discharge'], ['ready_date', 'Ready', 'date'], ['etd', 'ETD', 'date'], ['eta', 'ETA', 'date'], ['max_payload_kg', 'Max payload kg', 'number'],
  ];
  const init = () => Object.fromEntries([...fields.map(([k]) => [k, sh[k] ?? '']), ['notes', sh.notes || '']]);
  const [v, setV] = useState(init);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(init());
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...v, max_payload_kg: v.max_payload_kg === '' ? null : Number(v.max_payload_kg) };
      onChange(await put(`/shipments/${sh.id}`, body));
      toast('Saved');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const ro = !can('sales', 'warehouse');
  return html`<${Card} title="Transport details" icon="ship" foot=${!ro && dirty && html`<${Button} variant="primary" size="sm" loading=${busy} onClick=${save}>Save details<//>`}>
    <div class="form-grid">
      ${fields.map(([k, label, type]) => html`<${Field} label=${label}><input class=${`input ${['container_no', 'seal_no', 'bl_no', 'booking_ref'].includes(k) ? 'mono' : ''}`} type=${type || 'text'} value=${v[k]} disabled=${ro} onInput=${(e) => setV({ ...v, [k]: e.target.value })} /><//>`)}
      <${Field} label="Notes" class="span-2"><textarea class="textarea" value=${v.notes} disabled=${ro} onInput=${(e) => setV({ ...v, notes: e.target.value })}></textarea><//>
    </div>
    ${sh.mode.startsWith('container') && !sh.seal_no && sh.status !== 'planning' && html`<div class="mt-2"><${Callout} tone="warning">Record the seal number and photograph the sealed doors before the truck leaves.<//></div>`}
  <//>`;
}

function DocsCard({ sh, onChange }) {
  const [uploading, setUploading] = useState(null);
  const library = useAsync(() => get('/public/company'), []);
  const ops = can('sales', 'warehouse');
  const update = async (d, patch) => {
    try {
      onChange(await put(`/shipment-docs/${d.id}`, patch));
    } catch (e) {
      toastError(e);
    }
  };
  const attach = async (d, file) => {
    setUploading(d.id);
    try {
      const a = await uploadFile(file, { entity: 'shipment', entity_id: sh.id, kind: 'document', caption: d.name });
      await update(d, { attachment_id: a.id, status: d.status === 'todo' ? 'ready' : d.status });
      toast(`${d.name} attached`);
    } catch (e) {
      toastError(e);
    } finally {
      setUploading(null);
    }
  };
  return html`<${Card} title="Document pack" sub=${`${sh.region} · ${sh.docs_progress.done} of ${sh.docs_progress.total} ready`} icon="clipboard" pad=${false}>
    <div class="doc-list">
      ${sh.docs.map((d) => html`<div class=${`doc-item ${d.status}`}>
        <span class="doc-check"><${Icon} name=${d.status === 'todo' ? 'clock' : d.status === 'na' ? 'minus' : 'check'} size="15" /></span>
        <div style="flex:1;min-width:0">
          <div class="strong">${d.name}</div>
          ${d.hint && html`<div class="small muted">${d.hint}</div>`}
          ${d.stored_name && html`<a class="small" href=${`/files/${d.stored_name}`} target="_blank" rel="noopener"><${Icon} name="file" size="12" /> ${d.filename}</a>`}
          ${d.code === 'tds_spec' && (library.data?.docs || []).length > 0 && html`<div class="row wrap small" style="gap:8px">${library.data.docs.map((f) => html`<a href=${f.url} target="_blank" rel="noopener"><${Icon} name="file" size="12" /> ${f.filename}</a>`)}</div>`}
        </div>
        ${ops
          ? html`<label class="btn sm ghost icon" title="Attach the file">${uploading === d.id ? html`<span class="spinner" style="width:14px;height:14px"></span>` : html`<${Icon} name="upload" />`}<input type="file" hidden accept="image/*,application/pdf" onChange=${(e) => e.target.files[0] && attach(d, e.target.files[0])} /></label>
            <select class="select" style="width:auto;height:30px;font-size:12.5px" value=${d.status} onChange=${(e) => update(d, { status: e.target.value })}>${Object.entries(DOC_STATUS).map(([k, [l]]) => html`<option value=${k}>${l}</option>`)}</select>`
          : html`<${StatusBadge} map=${DOC_STATUS} value=${d.status} />`}
      </div>`)}
    </div>
  <//>`;
}

function PhotosCard({ sh, reload }) {
  const input = useRef();
  const [busy, setBusy] = useState(false);
  const photos = sh.photos.filter((p) => p.kind !== 'document');
  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const f of files) await uploadFile(f, { entity: 'shipment', entity_id: sh.id, kind: 'loading_photo' });
      toast('Photos added');
      reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Card} title="Loading photos" sub="Each pallet row and the sealed doors" icon="camera"
    actions=${can('sales', 'warehouse') && html`<${Button} size="sm" icon="camera" loading=${busy} onClick=${() => input.current.click()}>Add photos<//>`}>
    <input ref=${input} type="file" accept="image/*" capture="environment" multiple hidden onChange=${(e) => upload([...e.target.files])} />
    <div class="img-strip">${photos.map((p) => html`<a class="img-tile" href=${`/files/${p.stored_name}`} target="_blank" rel="noopener"><img src=${`/files/${p.stored_name}`} alt="" loading="lazy" /></a>`)}</div>
    ${!photos.length && html`<div class="small muted">Photos protect you against transit-breakage claims. Take them from the phone while loading.</div>`}
  <//>`;
}

// ---------------------------------------------------------------------------
// Scan-to-load at the dock: every pallet is checked against the shipment's orders.
// ---------------------------------------------------------------------------
export function LoadScreen({ id }) {
  const { data, error, loading, reload, setData } = useAsync(() => get(`/shipments/${id}`), [id]);
  const [log, setLog] = useState([]);
  const [flash, setFlash] = useState(null);
  const [busy, setBusy] = useState(false);
  useTitle(data ? `Loading ${data.number}` : 'Loading');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const sh = data;
  const pending = sh.pending.filter((u) => !u.parent_id);
  const loaded = sh.loaded.filter((u) => !u.parent_id);
  const total = pending.length + loaded.length;

  const onCode = async (code) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await post(`/shipments/${sh.id}/load`, { code });
      beep(r.ok);
      setFlash(r.ok ? 'ok' : 'bad');
      setTimeout(() => setFlash(null), 700);
      setLog((l) => [{ ok: r.ok, msg: r.message, at: Date.now(), already: r.already }, ...l].slice(0, 30));
      if (r.ok && !r.already) setData(await get(`/shipments/${sh.id}`));
    } catch (e) {
      beep(false);
      setLog((l) => [{ ok: false, msg: e.message, at: Date.now() }, ...l].slice(0, 30));
    } finally {
      setBusy(false);
    }
  };
  const finish = async () => {
    let seal = sh.seal_no;
    if (sh.mode.startsWith('container') && !seal) {
      seal = await promptDialog({ title: 'Seal number', message: 'Record the seal number before the container leaves.', label: 'Seal number', required: false });
      if (seal === null) return;
      if (seal) await put(`/shipments/${sh.id}`, { seal_no: seal });
    }
    try {
      await post(`/shipments/${sh.id}/status`, { status: 'loaded' });
      toast('Loading finished');
      navigate(`/shipments/${sh.id}`);
    } catch (e) {
      toastError(e);
    }
  };
  return html`<div class="scan-page">
    <div class="row between mb-2">
      <${Link} href=${`/shipments/${sh.id}`} class="small"><${Icon} name="arrowLeft" size="12" /> ${sh.number}<//>
      <span class="small muted">${sh.client_name || ''} · ${SHIPMENT_MODES[sh.mode]}</span>
    </div>
    <div class="floor-card mb-2">
      <div class="row between">
        <div><div class="floor-stage">Loading ${sh.number}</div><div class="small muted">Scan every pallet label as it goes in. Wrong or held pallets are refused.</div></div>
        <div class="right"><div class="floor-big">${loaded.length}<span class="muted" style="font-size:22px"> / ${total}</span></div><div class="small muted">pallets loaded</div></div>
      </div>
      <div class="mt-2"><${Meter} value=${loaded.length} max=${total || 1} tone="ok" /></div>
    </div>
    <${ScannerView} onCode=${onCode} flash=${flash} paused=${busy} hint="Scan the pallet label" />
    ${log.length > 0 &&
    html`<div class="scan-log mt-2">
      ${log.slice(0, 6).map((l) => html`<div class=${`sl ${l.ok ? 'ok' : 'bad'}`}><${Icon} name=${l.ok ? 'checkCircle' : 'alertCircle'} size="16" /><span style="flex:1">${l.msg}</span><span class="tiny muted">${ago(new Date(l.at).toISOString())}</span></div>`)}
    </div>`}
    <div class="section-title mt-3">Still to load (${pending.length})</div>
    <div class="scan-log">
      ${pending.slice(0, 40).map((u) => html`<div class="sl"><span class="mono strong" style="min-width:86px">${u.location_label || '—'}</span><span class="mono">${u.code}</span><span class="muted small truncate" style="flex:1">${u.sku} · lot ${u.lot_code || '—'} · ${fmtNum(u.boxes)} boxes</span>${u.status === 'picked' ? html`<${Badge} tone="progress" plain>at dock<//>` : ''}</div>`)}
      ${!pending.length && html`<${Callout} tone="success" title="Everything is loaded.">Photograph the last row and the sealed doors, then finish.<//>`}
    </div>
    <div class="row wrap mt-3">
      <${Button} variant=${pending.length ? '' : 'primary'} size="lg" icon="check" disabled=${!loaded.length} onClick=${finish}>Loading finished<//>
      <${LinkButton} size="lg" href=${`/shipments/${sh.id}`} icon="camera">Photos & seal<//>
    </div>
  </div>`;
}
