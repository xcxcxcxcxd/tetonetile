import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, qs } from '../lib/api.js';
import { useAsync, useTitle, usePref, useDebounced } from '../lib/hooks.js';
import { Link, navigate, useQuery } from '../lib/router.js';
import { boot, can, toast, toastError } from '../lib/store.js';
import { fmtNum, fmtQty, fmtDate, fmtDateShort, fmtDateTime, daysUntil, ago } from '../lib/format.js';
import { MO_STATUSES, MO_PURPOSES, SCRAP_REASONS, UNIT_STATUSES } from '/shared/constants.js';
import { VARIATION_SCALES, allowedVariation } from '/shared/calc.js';
import {
  Button, LinkButton, Card, PageHeader, Loading, ErrorBox, Seg, Badge, StatusBadge, EmptyState, Callout, KV, Modal, Field, confirmDialog, promptDialog, Check,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';
import { ProductPicker } from '../components/ProductPicker.js';

const PRIORITY = { 1: ['High', 'danger'], 2: ['Normal', 'neutral'], 3: ['Low', 'neutral'] };

export function Board() {
  useTitle('Production board');
  const query = useQuery();
  const [purpose, setPurpose] = usePref('board.purpose', '');
  const [q, setQ] = useState('');
  const [newMo, setNewMo] = useState(query.get('new') === '1');
  const { data, error, loading, reload } = useAsync(() => get('/mos/board'), []);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const ql = q.trim().toLowerCase();
  const cards = data.cards.filter((c) => (!purpose || c.purpose === purpose) && (!ql || `${c.number} ${c.sku} ${c.lot_code} ${c.order_number || ''} ${c.client_name || ''} ${c.colour_name || ''}`.toLowerCase().includes(ql)));
  const cols = [{ id: 'planned', name: 'Planned', color: 'var(--faint)' }, ...data.stages.map((s) => ({ ...s, id: String(s.id) }))].filter((c) => c.id === 'planned' || cards.some((k) => k.column === c.id) || !['MOULD', 'CURE', 'PAINT'].includes(c.code));
  const late = cards.filter((c) => c.late).length;
  const wip = cards.reduce((s, c) => s + (c.status !== 'planned' ? c.waiting + c.in_kiln : 0), 0);
  const release = async (c, e) => {
    e.stopPropagation();
    try {
      const materials = (await post(`/mos/${c.id}/release`)).materials || [];
      const short = materials.filter((m) => m.short > 0);
      toast(short.length ? `${c.number} released - short of ${short.map((m) => m.name).join(', ')}` : `${c.number} released to the workshop`, short.length ? 'warning' : 'success', 6000);
      reload();
    } catch (err) {
      toastError(err);
    }
  };
  return html`<div>
    <${PageHeader}
      overline="Factory"
      title="Production board"
      sub=${`${cards.length} manufacturing orders · ${fmtNum(wip)} pieces in work${late ? ` · ${late} late` : ''}`}
      help="production-cycle"
      actions=${html`<${LinkButton} href="/production/kilns" icon="flame">Kilns<//><${LinkButton} href="/scan?mode=production" icon="scan">Scan a card<//>
        ${can('production') && html`<${Button} variant="primary" icon="plus" onClick=${() => setNewMo(true)}>New MO<//>`}`}
    />
    <div class="row wrap mb-2">
      <${Seg} value=${purpose} onChange=${setPurpose} options=${[{ value: '', label: 'All' }, ...Object.entries(MO_PURPOSES).map(([value, label]) => ({ value, label }))]} />
      <input class="input" style="max-width:300px" placeholder="Filter: SKU, lot, order, client" value=${q} onInput=${(e) => setQ(e.target.value)} />
    </div>
    <div class="kanban">
      ${cols.map((col) => {
        const items = cards.filter((c) => c.column === col.id);
        const pcs = items.reduce((s, c) => s + c.waiting + c.in_kiln, 0);
        return html`<div class="kanban-col">
          <div class="kanban-head"><span class="k-dot" style=${{ background: col.color }}></span>${col.name}<span class="k-count">${items.length}${col.id !== 'planned' && pcs ? ` · ${fmtNum(pcs)} pcs` : ''}</span></div>
          <div class="kanban-body">
            ${items.map((c) => html`<${Link} href=${`/production/mo/${c.id}`} class=${`k-card ${c.late ? 'late' : ''} ${c.status === 'hold' || c.lot_status === 'hold' ? 'hold' : ''}`}>
              <div class="k-top"><img class="thumb sm" src=${c.image_url} alt="" /><div style="min-width:0;flex:1"><div class="k-title mono">${c.number}</div><div class="small truncate">${c.sku} · ${c.colour_name || ''}</div></div>${c.priority === 1 ? html`<${Badge} tone="danger" plain>High<//>` : ''}</div>
              ${col.id !== 'planned'
                ? html`<div class="row between"><span class="small muted">${c.in_kiln ? 'In the kiln' : 'Waiting here'}</span><b class="num">${fmtNum(c.in_kiln || c.waiting)} pcs</b></div>`
                : html`<div class="row between"><span class="small muted">To start</span><b class="num">${fmtNum(c.target_pcs)} pcs</b></div>`}
              <div class="k-meta mt-1">
                <span class="mono">${c.lot_code}</span>
                ${c.order_number ? html`<span>${c.order_number}</span>` : html`<span>${MO_PURPOSES[c.purpose]}</span>`}
                ${c.due_date && html`<span style=${c.late ? 'color:var(--danger);font-weight:600' : ''}>due ${fmtDateShort(c.due_date)}</span>`}
              </div>
              ${(c.status === 'hold' || c.lot_status === 'hold') && html`<div class="mt-1"><${Badge} tone="warning">${c.lot_status === 'hold' ? 'Lot on QC hold' : 'On hold'}<//></div>`}
              <div class="flow">${c.flow.map((f) => html`<i class=${f.done ? 'done' : f.waiting > 0 || f.id === Number(col.id) ? 'active' : ''} title=${f.code}></i>`)}</div>
              ${c.status === 'planned' && can('production') && html`<div class="mt-2"><${Button} size="sm" variant="primary" block onClick=${(e) => release(c, e)}>Release to workshop<//></div>`}
            <//>`)}
            ${!items.length && html`<div class="muted small center" style="padding:14px 4px">—</div>`}
          </div>
        </div>`;
      })}
    </div>
    ${newMo && html`<${NewMoModal} onClose=${() => setNewMo(false)} onDone=${(mo) => (setNewMo(false), navigate(`/production/mo/${mo.id}`))} />`}
  </div>`;
}

export function NewMoModal({ onClose, onDone, initial = {} }) {
  const [product, setProduct] = useState(initial.product || null);
  const [picker, setPicker] = useState(!initial.product);
  const [v, setV] = useState({ boxes_required: initial.boxes || '', purpose: initial.purpose || 'stock', due_date: '', priority: 2, workshop: boot().settings?.production?.default_workshop || 'TET', notes: '', release: true });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const target = product?.pcs_per_box && v.boxes_required ? Math.ceil(v.boxes_required * product.pcs_per_box * (1 + (product.production_loss_pct ?? 10) / 100)) : null;
  const go = async () => {
    setBusy(true);
    try {
      const mo = await post('/mos', { ...v, product_id: product.id, boxes_required: Number(v.boxes_required), priority: Number(v.priority) });
      toast(`${mo.number} created - lot ${mo.lot_code}`);
      onDone(mo);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title="New manufacturing order" size="wide" onClose=${onClose} icon="factory"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} disabled=${!product || !(Number(v.boxes_required) > 0)} onClick=${go}>Create MO<//>`}>
    <div class="form-grid">
      <${Field} label="Product" class="span-2">
        <button class="input" style="text-align:left;display:flex;align-items:center;gap:8px;height:auto;min-height:36px;padding:6px 10px;cursor:pointer" onClick=${() => setPicker(true)}>
          ${product ? html`<img class="thumb sm" src=${product.image_url} alt="" /><b>${product.sku}</b><span class="muted truncate">${product.name}</span>` : html`<span class="muted">Choose a product…</span>`}
        </button>
      <//>
      <${Field} label="Boxes to produce" hint=${product ? `${product.pcs_per_box} pcs/box · ${product.m2_per_box} m²/box` : ''}><input class="input num" type="number" min="1" value=${v.boxes_required} onInput=${set('boxes_required')} /><//>
      <${Field} label="Pieces to start" hint=${product ? `Includes ${product.production_loss_pct ?? 10} % production loss` : ''}><input class="input num" disabled value=${target ? fmtNum(target) : ''} /><//>
      <${Field} label="Purpose"><select class="select" value=${v.purpose} onChange=${set('purpose')}>${Object.entries(MO_PURPOSES).filter(([k]) => k !== 'order').map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
      <${Field} label="Workshop"><select class="select" value=${v.workshop} onChange=${set('workshop')}>${(boot().warehouses || []).map((w) => html`<option value=${w.code}>${w.name}</option>`)}</select><//>
      <${Field} label="Due date"><input class="input" type="date" value=${v.due_date} onInput=${set('due_date')} /><//>
      <${Field} label="Priority"><select class="select" value=${v.priority} onChange=${set('priority')}><option value="1">High</option><option value="2">Normal</option><option value="3">Low</option></select><//>
      <${Field} label="Notes" class="span-2"><input class="input" value=${v.notes} onInput=${set('notes')} /><//>
      <label class="check span-2"><input type="checkbox" checked=${v.release} onChange=${(e) => setV({ ...v, release: e.target.checked })} />Release to the workshop now</label>
    </div>
    <div class="mt-2"><${Callout} tone="info">Each MO is one lot: one colour batch, produced and shipped together. For client orders use "Release to production" on the order - it reuses stock from a single lot or creates the MO for you.<//></div>
    ${picker && html`<${ProductPicker} title="What to produce" filter=${(p) => !!p.pcs_per_box} onPick=${(p) => (setProduct(p), setPicker(false))} onClose=${() => (setPicker(false), !product && onClose())} />`}
  <//>`;
}

export function MoList() {
  useTitle('Manufacturing orders');
  const [status, setStatus] = usePref('mos.status', 'open');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 220);
  const { data, error, loading, reload } = useAsync(() => get(`/mos${qs({ status, q: dq })}`), [status, dq]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  return html`<div>
    <${PageHeader} overline="Factory" title="Manufacturing orders" sub="One MO = one lot = one colour batch" help="production-cycle" actions=${html`<${LinkButton} href="/production?new=1" variant="primary" icon="plus">New MO<//>`} />
    <div class="card">
      <div class="table-toolbar">
        <div class="search"><${Icon} name="search" /><input class="input" placeholder="MO, SKU, lot, order, client" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
        <${Seg} value=${status} onChange=${setStatus} options=${[{ value: 'open', label: 'Open' }, { value: 'completed', label: 'Completed' }, { value: 'closed', label: 'Closed' }, { value: 'cancelled', label: 'Cancelled' }, { value: '', label: 'All' }]} />
      </div>
      ${loading && !data
        ? html`<${Loading} />`
        : html`<${DataTable}
            columns=${[
              { key: 'number', label: 'MO', sort: true, render: (m) => html`<div class="prod-cell"><img class="thumb sm" src=${m.image_url} alt="" /><div><div class="cell-main mono">${m.number}</div><div class="cell-sub">${m.sku} · lot ${m.lot_code}</div></div></div>` },
              { key: 'status', label: 'Status', sort: true, render: (m) => html`<${StatusBadge} map=${MO_STATUSES} value=${m.status} />${m.lot_status === 'hold' ? html` <${Badge} tone="warning" plain>QC hold<//>` : ''}` },
              { key: 'stage_name', label: 'Stage', render: (m) => m.stage_name || html`<span class="muted">—</span>` },
              { key: 'purpose', label: 'For', render: (m) => (m.order_number ? html`<${Link} href=${`/docs/${m.order_id}`}>${m.order_number}<//><div class="cell-sub">${m.client_name}</div>` : MO_PURPOSES[m.purpose]) },
              { key: 'boxes_required', label: 'Boxes', align: 'num', sort: true, render: (m) => fmtNum(m.boxes_required) },
              { key: 'target_pcs', label: 'Pieces', align: 'num', render: (m) => fmtNum(m.target_pcs) },
              { key: 'due_date', label: 'Due', sort: true, render: (m) => html`<span style=${m.late ? 'color:var(--danger);font-weight:600' : ''}>${fmtDate(m.due_date)}</span>` },
            ]}
            rows=${data?.rows || []}
            onRowClick=${(m) => navigate(`/production/mo/${m.id}`)}
            empty=${html`<${EmptyState} icon="factory" title="No manufacturing orders" kb="production-cycle" />`}
          />`}
    </div>
  </div>`;
}

export function MoDetail({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/mos/${id}`), [id]);
  const [logStage, setLogStage] = useState(null);
  useTitle(data?.mo?.number || 'MO');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const mo = data.mo;
  const prog = data.progress;
  const cur = prog.routing.find((s) => s.stage.id === prog.current_stage_id);
  const open = ['released', 'in_progress'].includes(mo.status);
  const act = async (path, body, msg) => {
    try {
      await post(`/mos/${mo.id}/${path}`, body);
      toast(msg);
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  const statusChange = async (status, label) => {
    const reason = await promptDialog({ title: `${label} ${mo.number}`, label: 'Reason', required: status !== 'in_progress' });
    if (reason === null) return;
    act('status', { status, reason }, `${mo.number}: ${label.toLowerCase()}`);
  };
  const packedA = data.units.filter((u) => u.grade === 'A').reduce((s, u) => s + u.boxes, 0);
  return html`<div>
    <${PageHeader}
      back=${{ href: '/production', label: 'Production board' }}
      overline=${MO_PURPOSES[mo.purpose]}
      title=${html`<span class="mono">${mo.number}</span> <${StatusBadge} map=${MO_STATUSES} value=${mo.status} />`}
      sub=${html`${mo.sku} · ${mo.product_name}`}
      help="production-cycle"
      actions=${html`<${LinkButton} href=${`/print/labels?type=mo&ids=${mo.id}&format=a4-2`} icon="printer">Production card<//>
        ${mo.status === 'planned' && can('production') && html`<${Button} variant="primary" icon="play" onClick=${async () => {
          try {
            const r = await post(`/mos/${mo.id}/release`);
            const short = (r.materials || []).filter((m) => m.short > 0);
            toast(short.length ? `Released - short of ${short.map((m) => m.name).join(', ')}` : 'Released to the workshop', short.length ? 'warning' : 'success', 6000);
            reload();
          } catch (e) {
            toastError(e);
          }
        }}>Release<//>`}
        ${open && can('production') && html`<${LinkButton} variant="primary" href=${`/floor/mo/${mo.id}`} icon="factory">Record work<//>`}
        ${open && can('production') && html`<${Button} icon="alert" onClick=${() => statusChange('hold', 'Hold')}>Hold<//>`}
        ${mo.status === 'hold' && can('production') && html`<${Button} icon="check" onClick=${() => act('status', { status: 'in_progress' }, 'Resumed')}>Resume<//>`}
        ${['planned', 'released', 'hold', 'in_progress'].includes(mo.status) && can('production') && html`<${Button} variant="ghost danger" icon="x" onClick=${() => statusChange('cancelled', 'Cancel')}>Cancel<//>`}
        ${mo.status === 'completed' && can('production') && html`<${Button} icon="archive" onClick=${() => act('status', { status: 'closed' }, 'Closed')}>Close<//>`}`}
    />
    ${mo.lot_status === 'hold' && html`<div class="mb-2"><${Callout} tone="warning" title="Lot on QC hold.">Packed units go to quarantine and are not reserved until the lot is released. <${Link} href=${`/lots/${mo.lot_id}`}>Open lot ${mo.lot_code}<//><//></div>`}
    <div class="grid side">
      <div class="stack">
        <${Card} title="Route" sub=${`${prog.pct} % of stages done · scrap ${prog.scrap_pct} %`} icon="factory">
          <div class="route">
            ${prog.routing.map((s) => html`<button class=${`route-step ${s.done ? 'done' : s.status === 'active' ? 'active' : ''}`} style="text-align:left;cursor:${open && can('production') ? 'pointer' : 'default'}" onClick=${() => open && can('production') && setLogStage(s)}>
              <div class="rs-name"><span class="dot" style=${{ background: s.stage.color }}></span>${s.stage.name}</div>
              <div class="rs-num">${fmtNum(s.done ? s.good : s.waiting + s.in_kiln)}</div>
              <div class="rs-sub">${s.done ? `done · ${fmtNum(s.scrap)} scrap` : s.in_kiln ? `${fmtNum(s.in_kiln)} in kiln` : s.status === 'active' ? 'waiting here' : 'not started'}</div>
            </button>`)}
          </div>
          ${cur && html`<div class="callout mt-2"><${Icon} name="info" /><div class="callout-body"><b>Now: ${cur.stage.name}.</b> ${cur.stage.instructions || ''}</div></div>`}
        <//>
        <${Card} title="Work recorded" icon="history" pad=${false}>
          <${DataTable}
            compact
            columns=${[
              { key: 'created_at', label: 'When', render: (l) => html`<span class="small">${fmtDateTime(l.created_at)}</span>` },
              { key: 'stage_name', label: 'Stage', render: (l) => html`${l.stage_name}${l.completes_stage ? html` <${Badge} tone="success" plain>closed<//>` : ''}` },
              { key: 'qty_good', label: 'Good', align: 'num', render: (l) => html`${fmtNum(l.qty_good)}${l.grade_b ? html`<div class="cell-sub">A ${fmtNum(l.grade_a)} · B ${fmtNum(l.grade_b)}</div>` : ''}` },
              { key: 'qty_scrap', label: 'Scrap', align: 'num', render: (l) => (l.qty_scrap ? html`${fmtNum(l.qty_scrap)}<div class="cell-sub">${l.scrap_reason || ''}</div>` : html`<span class="muted">0</span>`) },
              { key: 'who', label: 'By', render: (l) => html`<span class="small">${l.worker_name || l.operator || l.user_name || ''}</span>${l.kiln_load_number ? html`<div class="cell-sub">${l.kiln_load_number}</div>` : ''}` },
            ]}
            rows=${[...prog.logs].reverse()}
            empty=${html`<div class="muted small" style="padding:14px">Nothing recorded yet. Scan the production card at each stage.</div>`}
          />
        <//>
        ${data.units.length > 0 &&
        html`<${Card} title="Packed" sub=${`${fmtNum(packedA)} boxes grade A`} icon="pallet" actions=${html`<${LinkButton} size="sm" href=${`/labels?type=unit&ids=${data.units.map((u) => u.id).join(',')}`} icon="printer">Pallet labels<//><${LinkButton} size="sm" href=${`/print/labels?type=box&lot=${mo.lot_code}&format=a4-24`} icon="package">Carton labels<//>`} pad=${false}>
          <${DataTable}
            compact
            columns=${[
              { key: 'code', label: 'Unit', render: (u) => html`<${Link} class="mono" href=${`/stock/units/${u.id}`}>${u.code}<//>` },
              { key: 'grade', label: 'Grade' },
              { key: 'boxes', label: 'Boxes', align: 'num' },
              { key: 'status', label: 'Status', render: (u) => html`<${StatusBadge} map=${UNIT_STATUSES} value=${u.status} />` },
              { key: 'location_label', label: 'Position', render: (u) => html`<span class="mono">${u.location_label || '—'}</span>` },
              { key: 'order_number', label: 'For', render: (u) => u.order_number || '' },
            ]}
            rows=${data.units}
          />
        <//>`}
      </div>
      <div class="stack">
        <${Card} title="Batch" icon="tile">
          <div class="row top mb-2"><img class="thumb xl" src=${mo.image_url} alt="" /><div><div class="mono strong">${mo.sku}</div><div class="small">${mo.colour_name}</div><div class="small muted">${mo.format_name}</div></div></div>
          <${KV} items=${[
            ['Lot', html`<${Link} href=${`/lots/${mo.lot_id}`} class="mono">${mo.lot_code}<//> ${mo.lot_status !== 'open' ? html`<${Badge} plain tone=${mo.lot_status === 'hold' ? 'warning' : 'success'}>${mo.lot_status}<//>` : ''}`],
            ['Boxes needed', fmtNum(mo.boxes_required)],
            ['Pieces started', `${fmtNum(mo.target_pcs)} (+${mo.loss_pct} % loss)`],
            ['Surface', `${fmtQty(mo.qty_m2)} m²`],
            ['Grade A / B', mo.good_pcs ? `${fmtNum(mo.good_pcs)} / ${fmtNum(mo.grade_b_pcs)} pcs` : null],
            ['Order', mo.order_number ? html`<${Link} href=${`/docs/${mo.order_id}`}>${mo.order_number}<//> · ${mo.client_name}` : null],
            ['Ready by (order)', mo.promised_date ? fmtDate(mo.promised_date) : null],
            ['Due', html`<span style=${mo.due_date && daysUntil(mo.due_date) < 0 && open ? 'color:var(--danger)' : ''}>${fmtDate(mo.due_date)}</span>`],
            ['Priority', PRIORITY[mo.priority]?.[0]],
            ['Workshop', mo.workshop],
            ['Created', ago(mo.created_at)],
          ]} />
          ${mo.notes && html`<p class="small ink2 mt-2" style="white-space:pre-wrap">${mo.notes}</p>`}
        <//>
        <${Card} title="Materials for what is left" icon="layers">
          ${data.materials.length
            ? data.materials.map((m) => html`<div class="row small mb-1"><span class="truncate" style="flex:1">${m.name}</span><span class="num">${fmtQty(m.qty)} ${m.unit}</span>${m.short > 0 ? html`<${Badge} tone="danger" plain>short ${fmtQty(m.short)}<//>` : html`<${Badge} tone="success" plain>OK<//>`}</div>`)
            : html`<div class="muted small">No bill of materials set for this product.</div>`}
          <div class="tiny muted mt-1">Estimates from Settings → Production → Bill of materials.</div>
        <//>
        ${data.kiln_loads.length > 0 && html`<${Card} title="Kiln loads" icon="flame">${data.kiln_loads.map((k) => html`<div class="row small mb-1"><${Link} class="mono" href=${`/production/kilns/load/${k.kiln_load_id}`}>${k.number}<//><span class="muted" style="flex:1">${k.kiln_name}</span><span>${fmtNum(k.pcs_loaded)} pcs${k.pcs_defect ? ` · ${fmtNum(k.pcs_defect)} defect` : ''}</span></div>`)}<//>`}
        ${data.qc.length > 0 && html`<${Card} title="QC inspections" icon="shield">${data.qc.map((q) => html`<div class="mb-2"><div class="row"><${Badge} tone=${q.result === 'pass' ? 'success' : 'warning'}>${q.result}<//><span class="small muted">${fmtDateTime(q.at)} · ${q.inspector || ''}</span></div>${q.notes && html`<div class="small mt-1">${q.notes}</div>`}</div>`)}<//>`}
      </div>
    </div>
    ${logStage && html`<${LogModal} mo=${mo} stage=${logStage} workers=${data.workers} onClose=${() => setLogStage(null)} onDone=${() => (setLogStage(null), reload())} />`}
  </div>`;
}

/** Desk version of the shop-floor entry (the floor screen is the big-button version). */
function LogModal({ mo, stage, workers, onClose, onDone }) {
  const st = stage.stage;
  const [v, setV] = useState({ qty_good: '', qty_scrap: '', scrap_reason: '', worker_id: '', completes_stage: false, notes: '', grade_a: '', grade_b: '', rejects: '' });
  const [qc, setQc] = useState({ colour_var: '', texture_var: '', size_var: '', pits_chips: '', crazing: '', iron_spots: '', matches_reference: '1', inspector: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const allowed = allowedVariation(mo.finish, mo.hex);
  const save = async (extra = {}) => {
    setBusy(true);
    try {
      const body = { stage_id: st.id, ...v, ...extra };
      if (st.is_qc) body.qc = qc;
      const r = await post(`/mos/${mo.id}/log`, body);
      if (r.qc && r.qc.result !== 'pass') toast(`QC hold: ${r.qc.exceeded.map((x) => x.label).join(', ')}`, 'warning', 8000);
      else toast(r.completed ? `${mo.number} completed` : r.next_stage ? `Saved - next: ${r.next_stage.name}` : 'Saved');
      onDone();
    } catch (e) {
      if (e.data?.code === 'remaining' && (await confirmDialog({ title: 'Pieces still waiting', message: `${e.message}\n\nClose the stage and count them as shortfall?`, confirmLabel: 'Close stage', tone: 'danger' }))) return save({ close_remaining: true });
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${`${st.name} · ${mo.number}`} onClose=${onClose} size="wide" icon="factory"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${() => save()}>Save<//>`}>
    <div class="callout mb-2"><${Icon} name="info" /><div class="callout-body"><b>${fmtNum(stage.waiting)} pieces waiting.</b> ${st.instructions || ''}</div></div>
    <div class="form-grid cols-3">
      ${st.is_qc
        ? html`<${Field} label="Grade A pieces"><input class="input num" type="number" min="0" value=${v.grade_a} onInput=${set('grade_a')} autoFocus /><//>
          <${Field} label="Grade B pieces"><input class="input num" type="number" min="0" value=${v.grade_b} onInput=${set('grade_b')} /><//>
          <${Field} label="Rejects"><input class="input num" type="number" min="0" value=${v.rejects} onInput=${set('rejects')} /><//>`
        : st.is_packing
          ? html`<${Field} label="Grade A pieces to pack" hint="Empty = everything sorted" class="span-2"><input class="input num" type="number" min="0" value=${v.pack_a} onInput=${set('pack_a')} /><//><${Field} label="Grade B pieces"><input class="input num" type="number" min="0" value=${v.pack_b} onInput=${set('pack_b')} /><//>`
          : html`<${Field} label="Good pieces"><input class="input num" type="number" min="0" value=${v.qty_good} onInput=${set('qty_good')} autoFocus /><//>
            <${Field} label="Scrap"><input class="input num" type="number" min="0" value=${v.qty_scrap} onInput=${set('qty_scrap')} /><//>
            <${Field} label="Scrap reason"><select class="select" value=${v.scrap_reason} onChange=${set('scrap_reason')}><option value="">—</option>${SCRAP_REASONS.map((r) => html`<option>${r}</option>`)}</select><//>`}
      <${Field} label="Worker"><select class="select" value=${v.worker_id} onChange=${set('worker_id')}><option value="">—</option>${workers.map((w) => html`<option value=${w.id}>${w.name}</option>`)}</select><//>
      <${Field} label="Notes" class="span-2"><input class="input" value=${v.notes} onInput=${set('notes')} /><//>
    </div>
    ${st.is_qc &&
    html`<div class="section-title mt-3">QC against the Variation & Imperfection standard (${mo.finish})</div>
      <div class="form-grid cols-3">
        ${Object.entries(VARIATION_SCALES).map(([k, sc]) => html`<${Field} label=${sc.label} hint=${`Standard: level ${allowed[k]} - ${sc.scale[allowed[k] - 1]}`}>
          <select class="select" value=${qc[k]} onChange=${(e) => setQc({ ...qc, [k]: e.target.value })}><option value="">Not assessed</option>${sc.scale.map((label, i) => html`<option value=${i + 1}>${i + 1} · ${label}${i + 1 > allowed[k] ? ' (outside standard)' : ''}</option>`)}</select>
        <//>`)}
        <${Field} label="Matches the approved colour reference?"><select class="select" value=${qc.matches_reference} onChange=${(e) => setQc({ ...qc, matches_reference: e.target.value })}><option value="1">Yes</option><option value="0">No - hold the lot</option></select><//>
        <${Field} label="Inspector"><input class="input" value=${qc.inspector} onInput=${(e) => setQc({ ...qc, inspector: e.target.value })} /><//>
      </div>`}
    <div class="mt-3"><${Check} label=${`This finishes ${st.name} for the whole batch`} checked=${v.completes_stage} onChange=${(c) => setV({ ...v, completes_stage: c })} /></div>
  <//>`;
}
