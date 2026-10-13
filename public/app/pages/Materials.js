import { useEffect, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put } from '../lib/api.js';
import { useAsync, useTitle, usePref } from '../lib/hooks.js';
import { Link, navigate, useQuery, setQuery } from '../lib/router.js';
import { boot, can, toast, toastError } from '../lib/store.js';
import { fmtNum, fmtQty, fmtDate, fmtDateTime, money, today, titleCase } from '../lib/format.js';
import {
  Button, LinkButton, IconButton, Card, PageHeader, Loading, ErrorBox, Seg, StatusBadge, EmptyState, Callout, Modal, Field, Meter, Swatch, Stat, confirmDialog, promptDialog,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';
import { ScanInput } from '../components/Scanner.js';
import { ReceiveModal } from '../components/StockActions.js';

const CATEGORIES = { clay: 'Clay', glaze: 'Glazes', pigment: 'Pigments & oxides', fuel: 'Kiln fuel', packaging: 'Packaging', consumable: 'Consumables', other: 'Other' };
const PO_STATUSES = { draft: ['Draft', 'neutral'], ordered: ['Ordered', 'info'], partial: ['Part received', 'warning'], received: ['Received', 'success'], cancelled: ['Cancelled', 'danger'] };
const base = () => boot().settings?.base_currency || 'MAD';

export function Materials() {
  useTitle('Raw materials');
  const [cat, setCat] = usePref('materials.cat', '');
  const [receive, setReceive] = useState(false);
  const [edit, setEdit] = useState(null);
  const { data, error, loading, reload } = useAsync(() => get('/materials'), []);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const rows = data.rows.filter((m) => !cat || m.category === cat);
  const low = data.rows.filter((m) => m.low);
  const ops = can('production', 'warehouse');
  return html`<div>
    <${PageHeader}
      overline="Factory"
      title="Raw materials"
      sub=${`${data.rows.length} materials · ${boot().settings?.production?.auto_consume ? 'used stock is deducted automatically from the bill of materials' : 'record use here, or switch on automatic deduction in Settings → Production'}`}
      help="raw-materials"
      actions=${html`<${LinkButton} href="/labels?type=material" icon="qr">Bay labels<//><${LinkButton} href="/purchase-orders" icon="inbox">Purchasing<//>
        ${ops && html`<${Button} icon="plus" onClick=${() => setEdit({})}>New material<//><${Button} variant="primary" icon="download" onClick=${() => setReceive(true)}>Receive delivery<//>`}`}
    />
    ${low.length > 0 &&
    html`<div class="mb-2"><${Callout} tone="warning" title=${`${low.length} below minimum:`}>
      ${low.map((m, i) => html`${i ? ', ' : ''}<${Link} href=${`/materials/${m.id}`}>${m.name}<//> (${fmtQty(m.stock)} / ${fmtQty(m.min_stock)} ${m.unit})`)}.
      ${ops && html` <${Link} href=${`/purchase-orders?new=1&material=${low.map((m) => m.id).join(',')}`}>Order them<//>`}
    <//></div>`}
    <div class="card">
      <div class="table-toolbar">
        <${Seg} value=${cat} onChange=${setCat} options=${[{ value: '', label: 'All' }, ...Object.entries(CATEGORIES).filter(([k]) => data.rows.some((m) => m.category === k)).map(([value, label]) => ({ value, label, count: data.rows.filter((m) => m.category === value).length }))]} />
      </div>
      <${DataTable}
        columns=${[
          { key: 'code', label: 'Material', sort: true, render: (m) => html`<div class="row">${m.hex ? html`<${Swatch} hex=${m.hex} />` : html`<span class="kiln-icon" style="width:24px;height:24px"><${Icon} name="layers" size="13" /></span>`}<div><div class="cell-main">${m.name}</div><div class="cell-sub mono">${m.code}</div></div></div>` },
          { key: 'category', label: 'Type', render: (m) => CATEGORIES[m.category] },
          { key: 'stock', label: 'In stock', align: 'num', sort: true, render: (m) => html`<span style=${m.low ? 'color:var(--danger);font-weight:650' : ''}>${fmtQty(m.stock)} ${m.unit}</span>${m.min_stock ? html`<div style="width:90px;margin-left:auto" class="mt-1"><${Meter} value=${m.stock} max=${m.min_stock * 2} tone=${m.low ? 'bad' : 'ok'} /></div>` : ''}` },
          { key: 'min_stock', label: 'Minimum', align: 'num', render: (m) => (m.min_stock ? `${fmtQty(m.min_stock)} ${m.unit}` : html`<span class="muted">—</span>`) },
          { key: 'on_order', label: 'On order', align: 'num', render: (m) => (m.on_order ? `${fmtQty(m.on_order)} ${m.unit}` : html`<span class="muted">—</span>`) },
          { key: 'supplier_name', label: 'Supplier', render: (m) => m.supplier_name || html`<span class="muted">—</span>` },
          { key: 'units', label: 'Lots', align: 'num', render: (m) => fmtNum(m.units) },
        ]}
        rows=${rows}
        onRowClick=${(m) => navigate(`/materials/${m.id}`)}
        empty=${html`<${EmptyState} icon="layers" title="No materials" text="Add clay, glazes, kiln fuel and packaging so production can check them before a batch starts." kb="raw-materials" />`}
      />
    </div>
    ${receive && html`<${ReceiveModal} initialKind="material" onClose=${() => setReceive(false)} onDone=${(units) => (setReceive(false), reload(), navigate(`/labels?type=unit&ids=${units.map((u) => u.id).join(',')}`))} />`}
    ${edit && html`<${MaterialModal} material=${edit} onClose=${() => setEdit(null)} onSaved=${(m) => (setEdit(null), navigate(`/materials/${m.id}`))} />`}
  </div>`;
}

function useSuppliers() {
  return useAsync(() => get('/suppliers'), []);
}

function MaterialModal({ material, onClose, onSaved }) {
  const isNew = !material.id;
  const sup = useSuppliers();
  const [v, setV] = useState({
    code: material.code || '', name: material.name || '', category: material.category || 'glaze', unit: material.unit || 'kg', min_stock: material.min_stock ?? 0,
    reorder_qty: material.reorder_qty ?? '', supplier_id: material.supplier_id || '', unit_cost: material.unit_cost ?? '', colour_id: material.colour_id || '', notes: material.notes || '', active: material.active ?? 1,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...v, min_stock: Number(v.min_stock || 0), reorder_qty: v.reorder_qty === '' ? null : Number(v.reorder_qty), unit_cost: v.unit_cost === '' ? null : Number(v.unit_cost), supplier_id: v.supplier_id || null, colour_id: v.colour_id || null };
      const m = isNew ? await post('/materials', body) : await put(`/materials/${material.id}`, body);
      toast(isNew ? `${m.code} added` : 'Saved');
      onSaved(m);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${isNew ? 'New material' : `Edit ${material.code}`} size="wide" onClose=${onClose} icon="layers"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${save}>${isNew ? 'Add' : 'Save'}<//>`}>
    <div class="form-grid">
      <${Field} label="Code" required hint="Short code printed on the bay label"><input class="input mono" value=${v.code} onInput=${set('code')} /><//>
      <${Field} label="Name" required><input class="input" value=${v.name} onInput=${set('name')} /><//>
      <${Field} label="Type"><select class="select" value=${v.category} onChange=${set('category')}>${Object.entries(CATEGORIES).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
      <${Field} label="Unit" hint="kg, L, pcs, rolls…"><input class="input" value=${v.unit} onInput=${set('unit')} /><//>
      <${Field} label="Minimum stock" hint="Below this it shows as low"><input class="input num" type="number" min="0" value=${v.min_stock} onInput=${set('min_stock')} /><//>
      <${Field} label="Usual order quantity"><input class="input num" type="number" min="0" value=${v.reorder_qty} onInput=${set('reorder_qty')} /><//>
      <${Field} label="Supplier"><select class="select" value=${v.supplier_id} onChange=${set('supplier_id')}><option value="">—</option>${(sup.data?.rows || []).map((s) => html`<option value=${s.id}>${s.name}</option>`)}</select><//>
      <${Field} label=${`Unit cost (${base()})`}><input class="input num" type="number" min="0" step="0.01" value=${v.unit_cost} onInput=${set('unit_cost')} /><//>
      ${v.category === 'glaze' && html`<${Field} label="Glaze of colour" hint="Links the glaze to the colour so the bill of materials picks the right one" class="span-2"><select class="select" value=${v.colour_id} onChange=${set('colour_id')}><option value="">—</option>${(boot().colours || []).map((c) => html`<option value=${c.id}>${c.code} · ${c.name}</option>`)}</select><//>`}
      <${Field} label="Notes" class="span-2"><input class="input" value=${v.notes} onInput=${set('notes')} /><//>
    </div>
  <//>`;
}

export function MaterialDetail({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/materials/${id}`), [id]);
  const [modal, setModal] = useState(null);
  useTitle(data?.material?.name || 'Material');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const m = data.material;
  const low = m.min_stock > 0 && m.stock < m.min_stock;
  const ops = can('production', 'warehouse');
  return html`<div>
    <${PageHeader}
      back=${{ href: '/materials', label: 'Raw materials' }}
      overline=${CATEGORIES[m.category]}
      title=${m.name}
      sub=${html`<span class="mono">${m.code}</span>${m.supplier_name ? ` · ${m.supplier_name}` : ''}`}
      help="raw-materials"
      actions=${html`<${LinkButton} href=${`/labels?type=material&ids=${m.id}`} icon="qr">Bay label<//>
        ${ops && html`<${Button} icon="edit" onClick=${() => setModal('edit')}>Edit<//><${Button} icon="minus" onClick=${() => setModal('use')}>Record use<//><${Button} variant="primary" icon="download" onClick=${() => setModal('receive')}>Receive<//>`}`}
    />
    <div class="kpis">
      <${Stat} label="In stock" value=${`${fmtQty(m.stock)} ${m.unit}`} note=${low ? `Below the minimum of ${fmtQty(m.min_stock)}` : m.min_stock ? `Minimum ${fmtQty(m.min_stock)}` : ''} noteTone=${low ? 'bad' : ''} icon="layers" />
      <${Stat} label="Lots in store" value=${data.units.length} icon="pallet" />
      <${Stat} label="Usual order" value=${m.reorder_qty ? `${fmtQty(m.reorder_qty)} ${m.unit}` : '—'} icon="inbox" />
      <${Stat} label="Unit cost" value=${m.unit_cost ? money(m.unit_cost, base()) : '—'} icon="coins" />
    </div>
    ${low && ops && html`<div class="mb-2"><${Callout} tone="warning" title="Low stock.">Batches that need this material will show it as short when released. <${Link} href=${`/purchase-orders?new=1&material=${m.id}&qty=${m.reorder_qty || Math.ceil(m.min_stock * 2 - m.stock)}`}>Create a purchase order<//><//></div>`}
    <div class="grid cols-2">
      <${Card} title="Where it is stored" sub="Oldest lots are used first" icon="pin" pad=${false}>
        <${DataTable}
          compact
          columns=${[
            { key: 'code', label: 'Lot label', render: (u) => html`<${Link} class="mono" href=${`/stock/units/${u.id}`}>${u.code}<//>${u.supplier_lot ? html`<div class="cell-sub">${u.supplier_lot}</div>` : ''}` },
            { key: 'qty', label: 'Quantity', align: 'num', render: (u) => `${fmtQty(u.qty)} ${m.unit}` },
            { key: 'location_label', label: 'Position', render: (u) => (u.location_id ? html`<${Link} class="mono" href=${`/warehouse/location/${u.location_id}`}>${u.location_label}<//>` : html`<span class="muted">—</span>`) },
            { key: 'created_at', label: 'Received', render: (u) => fmtDate(u.created_at) },
          ]}
          rows=${data.units}
          empty=${html`<div class="muted small" style="padding:14px">Nothing in store.</div>`}
        />
      <//>
      <${Card} title="Movements" icon="history" pad=${false}>
        <${DataTable}
          compact
          columns=${[
            { key: 'created_at', label: 'When', render: (x) => html`<span class="small">${fmtDateTime(x.created_at)}</span>` },
            { key: 'type', label: 'What', render: (x) => titleCase(x.type) },
            { key: 'qty', label: 'Qty', align: 'num', render: (x) => (x.qty !== null ? fmtQty(x.qty) : '') },
            { key: 'ref', label: 'Reference', render: (x) => html`<span class="small">${x.ref || ''}${x.notes ? html`<div class="cell-sub">${x.notes}</div>` : ''}</span>` },
            { key: 'user_name', label: 'By', render: (x) => html`<span class="small">${x.user_name || ''}</span>` },
          ]}
          rows=${data.moves}
          empty=${html`<div class="muted small" style="padding:14px">No movement yet.</div>`}
        />
      <//>
    </div>
    ${m.notes && html`<div class="card card-pad mt-3 small ink2" style="white-space:pre-wrap">${m.notes}</div>`}
    ${modal === 'edit' && html`<${MaterialModal} material=${m} onClose=${() => setModal(null)} onSaved=${() => (setModal(null), reload())} />`}
    ${modal === 'receive' && html`<${ReceiveMaterial} m=${m} onClose=${() => setModal(null)} onDone=${(u) => (setModal(null), reload(), toast(`${u.code} received - print its label`), navigate(`/labels?type=unit&ids=${u.id}`))} />`}
    ${modal === 'use' && html`<${UseMaterial} m=${m} onClose=${() => setModal(null)} onDone=${() => (setModal(null), reload())} />`}
  </div>`;
}

function ReceiveMaterial({ m, onClose, onDone }) {
  const [v, setV] = useState({ qty: m.reorder_qty || '', supplier_lot: '', location_code: '', ref: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await post(`/materials/${m.id}/receive`, { ...v, qty: Number(v.qty) });
      onDone(r.unit);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${`Receive ${m.name}`} onClose=${onClose} icon="download"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} disabled=${!(Number(v.qty) > 0) || !v.location_code} onClick=${go}>Receive<//>`}>
    <div class="form-grid">
      <${Field} label=${`Quantity (${m.unit})`}><input class="input num" type="number" min="0" step="0.01" value=${v.qty} onInput=${(e) => setV({ ...v, qty: e.target.value })} autoFocus /><//>
      <${Field} label="Supplier lot / delivery note"><input class="input" value=${v.supplier_lot} onInput=${(e) => setV({ ...v, supplier_lot: e.target.value })} /><//>
      <${Field} label="Stored at" class="span-2" hint="Scan the bay label, e.g. M01"><${ScanInput} value=${v.location_code} onInput=${(c) => setV({ ...v, location_code: c })} placeholder="Raw material bay" /><//>
      <${Field} label="Reference (PO, invoice)" class="span-2"><input class="input" value=${v.ref} onInput=${(e) => setV({ ...v, ref: e.target.value })} /><//>
    </div>
    <div class="small muted mt-2">Each delivery becomes a lot with its own QR label, so the oldest is used first and a bad batch of glaze can be traced.</div>
  <//>`;
}

function UseMaterial({ m, onClose, onDone }) {
  const [v, setV] = useState({ qty: '', ref: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await post(`/materials/${m.id}/consume`, { ...v, qty: Number(v.qty) });
      toast(`Recorded - ${fmtQty(r.stock)} ${m.unit} left`);
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${`Record use of ${m.name}`} onClose=${onClose} icon="minus"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} disabled=${!(Number(v.qty) > 0)} onClick=${go}>Record<//>`}>
    <div class="form-grid">
      <${Field} label=${`Quantity used (${m.unit})`} hint=${`${fmtQty(m.stock)} in stock`}><input class="input num" type="number" min="0" step="0.01" value=${v.qty} onInput=${(e) => setV({ ...v, qty: e.target.value })} autoFocus /><//>
      <${Field} label="For (MO number, kiln load…)"><input class="input mono" value=${v.ref} onInput=${(e) => setV({ ...v, ref: e.target.value })} /><//>
      <${Field} label="Notes" class="span-2"><input class="input" value=${v.notes} onInput=${(e) => setV({ ...v, notes: e.target.value })} /><//>
    </div>
    <div class="small muted mt-2">${boot().settings?.production?.auto_consume ? 'Only for use outside the bill of materials (tests, repairs, waste) - normal production use is deducted automatically when work is recorded.' : 'Oldest lots are used first. Automatic deduction from the bill of materials can be switched on in Settings → Production.'}</div>
  <//>`;
}

// ---------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------
export function PurchaseOrders() {
  useTitle('Purchasing');
  const query = useQuery();
  const [status, setStatus] = usePref('po.status', 'open');
  const creating = query.get('new') === '1';
  const { data, error, loading, reload } = useAsync(() => get('/purchase-orders'), []);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  const rows = (data?.rows || []).filter((p) => (status === 'open' ? ['draft', 'ordered', 'partial'].includes(p.status) : !status || p.status === status));
  const late = (data?.rows || []).filter((p) => ['ordered', 'partial'].includes(p.status) && p.expected_date && p.expected_date < today()).length;
  return html`<div>
    <${PageHeader} overline="Factory" title="Purchasing" sub=${`Purchase orders for raw materials${late ? ` · ${late} overdue delivery` : ''}`} help="raw-materials"
      actions=${can('production', 'warehouse') && html`<${Button} variant="primary" icon="plus" onClick=${() => setQuery({ new: 1 })}>New purchase order<//>`} />
    <div class="card">
      <div class="table-toolbar">
        <${Seg} value=${status} onChange=${setStatus} options=${[{ value: 'open', label: 'Open' }, ...Object.entries(PO_STATUSES).map(([value, [label]]) => ({ value, label })), { value: '', label: 'All' }]} />
      </div>
      ${loading && !data
        ? html`<${Loading} />`
        : html`<${DataTable}
            columns=${[
              { key: 'number', label: 'PO', sort: true, render: (p) => html`<span class="mono cell-main">${p.number}</span>` },
              { key: 'supplier_name', label: 'Supplier', sort: true },
              { key: 'status', label: 'Status', render: (p) => html`<${StatusBadge} map=${PO_STATUSES} value=${p.status} />` },
              { key: 'order_date', label: 'Ordered', sort: true, render: (p) => fmtDate(p.order_date) },
              { key: 'expected_date', label: 'Expected', sort: true, render: (p) => html`<span style=${['ordered', 'partial'].includes(p.status) && p.expected_date && p.expected_date < today() ? 'color:var(--danger);font-weight:600' : ''}>${fmtDate(p.expected_date)}</span>` },
              { key: 'lines', label: 'Lines', align: 'num' },
              { key: 'value', label: 'Value', align: 'num', render: (p) => (p.value ? money(p.value, base()) : '—') },
            ]}
            rows=${rows}
            onRowClick=${(p) => navigate(`/purchase-orders/${p.id}`)}
            empty=${html`<${EmptyState} icon="inbox" title="No purchase orders" text="Order clay, glazes, olive pits and packaging here; receiving a PO puts the material into stock with a QR label." kb="raw-materials" />`}
          />`}
    </div>
    ${creating && html`<${NewPoModal} materialIds=${(query.get('material') || '').split(',').filter(Boolean).map(Number)} qty=${Number(query.get('qty')) || null} onClose=${() => setQuery({ new: '', material: '', qty: '' })} onDone=${(id) => navigate(`/purchase-orders/${id}`)} />`}
  </div>`;
}

function NewPoModal({ materialIds = [], qty, onClose, onDone }) {
  const mats = useAsync(() => get('/materials'), []);
  const sup = useSuppliers();
  const [supplierId, setSupplierId] = useState('');
  const [lines, setLines] = useState(null);
  const [v, setV] = useState({ expected_date: '', notes: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!mats.data || lines !== null) return;
    const pre = materialIds.map((mid) => mats.data.rows.find((m) => m.id === mid)).filter(Boolean);
    setLines(pre.length ? pre.map((m) => ({ material_id: String(m.id), qty: String((materialIds.length === 1 && qty) || m.reorder_qty || ''), unit_cost: m.unit_cost ?? '' })) : [{ material_id: '', qty: '', unit_cost: '' }]);
    if (pre[0]?.supplier_id) setSupplierId(String(pre[0].supplier_id));
  }, [mats.data]);
  const matOf = (id) => mats.data?.rows.find((m) => String(m.id) === String(id));
  const setLine = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addSupplier = async () => {
    const name = await promptDialog({ title: 'New supplier', label: 'Supplier name', confirmLabel: 'Add' });
    if (!name) return;
    try {
      const s = await post('/suppliers', { name });
      sup.reload();
      setSupplierId(String(s.id));
    } catch (e) {
      toastError(e);
    }
  };
  const go = async (status) => {
    setBusy(true);
    try {
      const r = await post('/purchase-orders', { supplier_id: Number(supplierId), status, ...v, lines: lines.map((l) => ({ material_id: Number(l.material_id), qty: Number(l.qty), unit_cost: l.unit_cost === '' ? null : Number(l.unit_cost) })) });
      toast(status === 'ordered' ? 'Purchase order sent' : 'Draft saved');
      onDone(r.id);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const total = (lines || []).reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  const valid = supplierId && (lines || []).some((l) => l.material_id && Number(l.qty) > 0);
  return html`<${Modal} title="New purchase order" size="wide" onClose=${onClose} icon="inbox"
    footer=${html`<span class="small muted" style="margin-right:auto">${total ? `Total ${money(total, base())}` : ''}</span><${Button} onClick=${onClose}>Cancel<//><${Button} loading=${busy} disabled=${!valid} onClick=${() => go('draft')}>Save draft<//><${Button} variant="primary" loading=${busy} disabled=${!valid} onClick=${() => go('ordered')}>Mark as ordered<//>`}>
    ${!mats.data || !lines
      ? html`<${Loading} />`
      : html`<div class="form-grid">
          <${Field} label="Supplier" class="span-2"><div class="row"><select class="select" value=${supplierId} onChange=${(e) => setSupplierId(e.target.value)}><option value="">Choose…</option>${(sup.data?.rows || []).filter((s) => s.active !== 0).map((s) => html`<option value=${s.id}>${s.name}${s.category ? ` · ${s.category}` : ''}</option>`)}</select><${Button} icon="plus" onClick=${addSupplier}>New<//></div><//>
        </div>
        <div class="section-title mt-3">Materials</div>
        <div class="stack sm">
          ${lines.map((l, i) => {
            const m = matOf(l.material_id);
            return html`<div class="po-line">
              <select class="select" value=${l.material_id} onChange=${(e) => {
                const mm = matOf(e.target.value);
                setLine(i, { material_id: e.target.value, qty: l.qty || String(mm?.reorder_qty || ''), unit_cost: l.unit_cost === '' ? mm?.unit_cost ?? '' : l.unit_cost });
              }}><option value="">Material…</option>${mats.data.rows.map((x) => html`<option value=${x.id}>${x.code} · ${x.name}</option>`)}</select>
              <div class="input-group"><input class="input num" type="number" min="0" placeholder="Qty" value=${l.qty} onInput=${(e) => setLine(i, { qty: e.target.value })} /><span class="addon">${m?.unit || ''}</span></div>
              <div class="input-group"><input class="input num" type="number" min="0" step="0.01" placeholder="Unit cost" value=${l.unit_cost} onInput=${(e) => setLine(i, { unit_cost: e.target.value })} /><span class="addon">${base()}</span></div>
              <${IconButton} icon="x" label="Remove line" onClick=${() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ material_id: '', qty: '', unit_cost: '' }])} />
              ${m && html`<div class="tiny muted po-hint">In stock ${fmtQty(m.stock)} ${m.unit}${m.on_order ? ` · ${fmtQty(m.on_order)} already on order` : ''}${m.min_stock ? ` · minimum ${fmtQty(m.min_stock)}` : ''}</div>`}
            </div>`;
          })}
          <div><${Button} size="sm" icon="plus" onClick=${() => setLines([...lines, { material_id: '', qty: '', unit_cost: '' }])}>Add a line<//></div>
        </div>
        <div class="form-grid mt-3">
          <${Field} label="Expected delivery"><input class="input" type="date" value=${v.expected_date} onInput=${(e) => setV({ ...v, expected_date: e.target.value })} /><//>
          <${Field} label="Notes"><input class="input" value=${v.notes} onInput=${(e) => setV({ ...v, notes: e.target.value })} /><//>
        </div>`}
  <//>`;
}

export function PoDetail({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/purchase-orders/${id}`), [id]);
  const [receiving, setReceiving] = useState(false);
  useTitle(data?.po?.number || 'Purchase order');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const { po, lines } = data;
  const total = lines.reduce((s, l) => s + l.qty * (l.unit_cost || 0), 0);
  const ops = can('production', 'warehouse');
  const setStatus = async (status, label) => {
    if (status === 'cancelled' && !(await confirmDialog({ title: `Cancel ${po.number}?`, confirmLabel: 'Cancel PO', tone: 'danger' }))) return;
    try {
      await post(`/purchase-orders/${po.id}/status`, { status });
      toast(label);
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  return html`<div>
    <${PageHeader}
      back=${{ href: '/purchase-orders', label: 'Purchasing' }}
      overline=${po.supplier_name}
      title=${html`<span class="mono">${po.number}</span> <${StatusBadge} map=${PO_STATUSES} value=${po.status} />`}
      sub=${`Ordered ${fmtDate(po.order_date)}${po.expected_date ? ` · expected ${fmtDate(po.expected_date)}` : ''}`}
      help="raw-materials"
      actions=${ops &&
      html`${po.status === 'draft' && html`<${Button} icon="send" onClick=${() => setStatus('ordered', 'Marked as ordered')}>Mark as ordered<//>`}
        ${['draft', 'ordered'].includes(po.status) && html`<${Button} variant="ghost danger" icon="x" onClick=${() => setStatus('cancelled', 'Cancelled')}>Cancel<//>`}
        ${['ordered', 'partial', 'draft'].includes(po.status) && html`<${Button} variant="primary" icon="download" onClick=${() => setReceiving(true)}>Receive delivery<//>`}`}
    />
    <div class="card">
      <${DataTable}
        columns=${[
          { key: 'name', label: 'Material', render: (l) => html`<${Link} href=${`/materials/${l.material_id}`} class="cell-main">${l.name}<//><div class="cell-sub mono">${l.code}</div>` },
          { key: 'qty', label: 'Ordered', align: 'num', render: (l) => `${fmtQty(l.qty)} ${l.unit}` },
          { key: 'qty_received', label: 'Received', align: 'num', render: (l) => html`${fmtQty(l.qty_received)} ${l.unit}${l.qty_received >= l.qty ? html` <${Icon} name="check" size="13" />` : ''}` },
          { key: 'unit_cost', label: 'Unit cost', align: 'num', render: (l) => (l.unit_cost ? money(l.unit_cost, base()) : '—') },
          { key: 'total', label: 'Total', align: 'num', render: (l) => (l.unit_cost ? money(l.qty * l.unit_cost, base()) : '—') },
        ]}
        rows=${lines}
        footer=${total ? html`<tr><td colspan="4" class="right strong">Total</td><td class="num strong">${money(total, base())}</td></tr>` : null}
      />
    </div>
    ${po.notes && html`<div class="card card-pad mt-3 small ink2" style="white-space:pre-wrap">${po.notes}</div>`}
    ${receiving && html`<${ReceivePo} po=${po} lines=${lines} onClose=${() => setReceiving(false)} onDone=${(units) => (setReceiving(false), reload(), toast(`${units.length} lot${units.length === 1 ? '' : 's'} received - print the labels`), navigate(`/labels?type=unit&ids=${units.map((u) => u.id).join(',')}`))} />`}
  </div>`;
}

function ReceivePo({ po, lines, onClose, onDone }) {
  const open = lines.filter((l) => l.qty_received < l.qty);
  const [rows, setRows] = useState(() => Object.fromEntries(open.map((l) => [l.id, { qty: String(Math.max(0, l.qty - l.qty_received)), location_code: '', supplier_lot: '' }])));
  const [allLoc, setAllLoc] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (id, k, val) => setRows({ ...rows, [id]: { ...rows[id], [k]: val } });
  const go = async () => {
    setBusy(true);
    try {
      const r = await post(`/purchase-orders/${po.id}/receive`, { lines: open.map((l) => ({ line_id: l.id, ...rows[l.id], qty: Number(rows[l.id].qty), location_code: rows[l.id].location_code || allLoc })) });
      onDone(r.units);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${`Receive ${po.number}`} size="wide" onClose=${onClose} icon="download"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${go}>Receive and print labels<//>`}>
    <${Field} label="Store everything at" hint="Or set a bay per line below"><${ScanInput} value=${allLoc} onInput=${setAllLoc} placeholder="Raw material bay, e.g. M01" /><//>
    <div class="stack sm mt-2">
      ${open.map((l) => html`<div class="po-line">
        <div><div class="strong">${l.name}</div><div class="small muted">${fmtQty(l.qty - l.qty_received)} ${l.unit} outstanding</div></div>
        <div class="input-group"><input class="input num" type="number" min="0" value=${rows[l.id].qty} onInput=${(e) => set(l.id, 'qty', e.target.value)} /><span class="addon">${l.unit}</span></div>
        <input class="input" placeholder="Supplier lot" value=${rows[l.id].supplier_lot} onInput=${(e) => set(l.id, 'supplier_lot', e.target.value)} />
        <input class="input mono" placeholder=${allLoc || 'Bay'} value=${rows[l.id].location_code} onInput=${(e) => set(l.id, 'location_code', e.target.value)} />
      </div>`)}
      ${!open.length && html`<div class="muted small">Everything on this PO has been received.</div>`}
    </div>
    <div class="small muted mt-2">Set a line to 0 if it did not arrive. The PO stays "part received" until every line is complete.</div>
  <//>`;
}
