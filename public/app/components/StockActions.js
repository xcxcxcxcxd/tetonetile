import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { boot, toast, toastError } from '../lib/store.js';
import { fmtNum, fmtQty } from '../lib/format.js';
import { UNIT_STATUSES, POOLS } from '/shared/constants.js';
import { Button, Modal, Field, Badge, StatusBadge, Callout, Loading, confirmDialog, Meter } from './ui.js';
import { ScanInput } from './Scanner.js';
import { ProductPicker } from './ProductPicker.js';
import { Icon } from './icons.js';

/** One-line summary of a stock unit with its picture. */
export function UnitSummary({ u }) {
  return html`<div class="row top">
    ${u.image_url ? html`<img class="thumb lg" src=${u.image_url} alt="" />` : html`<span class="thumb lg" style="display:grid;place-items:center"><${Icon} name="layers" /></span>`}
    <div style="min-width:0;flex:1">
      <div class="row wrap" style="gap:6px"><span class="code-chip">${u.code}</span><${StatusBadge} map=${UNIT_STATUSES} value=${u.status} />${u.grade !== 'A' && u.kind !== 'material' ? html`<${Badge} tone="warning" plain>Grade ${u.grade}<//>` : null}${u.pool !== 'general' ? html`<${Badge} tone="info" plain>${POOLS[u.pool]}<//>` : null}</div>
      <div class="strong mt-1 truncate">${u.sku || u.material_code} · ${u.product_name || u.material_name}</div>
      <div class="muted small">
        ${u.kind === 'material' ? `${fmtQty(u.qty)} ${u.material_unit}` : `${fmtNum(u.boxes)} boxes${u.loose_pcs ? ` + ${u.loose_pcs} pcs` : ''}${u.m2 ? ` · ${fmtQty(u.m2)} m²` : ''}${u.weight_kg ? ` · ${fmtNum(u.weight_kg)} kg` : ''}`}
        ${u.lot_code ? ` · lot ${u.lot_code}` : ''}${u.order_number ? ` · for ${u.order_number}` : ''}
      </div>
      <div class="small mt-1"><${Icon} name="pin" size="13" /> ${u.location_label ? html`<b>${u.location_label}</b> <span class="muted">${u.zone_name || ''} · ${u.warehouse_code || ''}</span>` : html`<span style="color:var(--warning)">No location</span>`}</div>
    </div>
  </div>`;
}

export function MoveModal({ unit, onClose, onDone, title }) {
  const sugg = useAsync(() => get(`/stock/units/${unit.id}/putaway`), [unit.id]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const move = async (loc, force = false) => {
    setBusy(true);
    try {
      const r = await post(`/stock/units/${unit.id}/move`, { location_code: typeof loc === 'string' ? loc : undefined, location_id: typeof loc === 'number' ? loc : undefined, force });
      (r.warnings || []).forEach((w) => toast(w, 'warning', 6000));
      toast(`${unit.code} → ${r.location.label}`);
      onDone(r);
    } catch (e) {
      if (e.data?.code === 'over_capacity' || e.data?.code === 'blocked') {
        if (await confirmDialog({ title: 'Location is full', message: `${e.message}\n\nPut it there anyway?`, confirmLabel: 'Put it there', tone: 'danger' })) return move(loc, true);
      } else toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${title || `Move ${unit.code}`} onClose=${onClose} icon="move">
    <${UnitSummary} u=${unit} />
    <div class="section-title mt-3">Suggested positions</div>
    ${sugg.loading && !sugg.data
      ? html`<${Loading} />`
      : sugg.data?.suggestions?.length
        ? html`<div class="stack sm">
            ${sugg.data.suggestions.map(
              (s, i) => html`<button class=${`big-step ${i === 0 ? 'on' : ''}`} style="text-align:left;cursor:pointer;width:100%" disabled=${busy} onClick=${() => move(s.id)}>
                <span class="bs-num" style="width:auto;border-radius:8px;padding:0 10px;font-family:var(--mono)">${s.label}</span>
                <span style="flex:1;min-width:0"><div class="strong">${s.zone}</div><div class="muted small">${s.reasons.join(' · ') || 'Free space'}</div></span>
                ${s.occupancy?.capacity ? html`<span style="width:70px"><${Meter} value=${s.occupancy.used} max=${s.occupancy.capacity} /><div class="tiny muted right">${s.occupancy.used}/${s.occupancy.capacity}</div></span>` : null}
              </button>`,
            )}
          </div>`
        : html`<div class="muted small">No free position found in the right zones. Type a location, or add racks in Settings → Warehouse.</div>`}
    <div class="divider-text">or any location</div>
    <div class="row">
      <div style="flex:1"><${ScanInput} value=${code} onInput=${setCode} placeholder="Location code, e.g. A01-2B" onEnter=${(c) => c && move(c.trim())} title="Scan the location label" /></div>
      <${Button} variant="primary" loading=${busy} disabled=${!code.trim()} onClick=${() => move(code.trim())}>Move<//>
    </div>
  <//>`;
}

export function SplitModal({ unit, onClose, onDone }) {
  const [boxes, setBoxes] = useState('');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState(unit.kind === 'pallet' ? 'boxes' : unit.kind);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await post(`/stock/units/${unit.id}/split`, { boxes: Number(boxes), location_code: code || undefined, kind });
      toast(`${r.created.code} created with ${r.created.boxes} boxes - print its label`);
      onDone(r);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${`Split ${unit.code}`} onClose=${onClose} icon="split"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} disabled=${!(Number(boxes) > 0)} onClick=${go}>Split<//>`}>
    <${UnitSummary} u=${unit} />
    <div class="form-grid mt-3">
      <${Field} label="Boxes to take off" hint=${`Leaves ${Math.max(0, unit.boxes - (Number(boxes) || 0))} on ${unit.code}`}><input class="input num" type="number" min="1" max=${unit.boxes - 1} value=${boxes} onInput=${(e) => setBoxes(e.target.value)} autoFocus /><//>
      <${Field} label="New unit is a"><select class="select" value=${kind} onChange=${(e) => setKind(e.target.value)}><option value="pallet">Pallet</option><option value="boxes">Box group (shelf)</option></select><//>
      <${Field} label="Put the new unit at (optional)" class="span-2"><${ScanInput} value=${code} onInput=${setCode} placeholder="Same location if empty" /><//>
    </div>
  <//>`;
}

export function AdjustModal({ unit, onClose, onDone }) {
  const [boxes, setBoxes] = useState(unit.boxes);
  const [loose, setLoose] = useState(unit.loose_pcs || 0);
  const [qty, setQty] = useState(unit.qty);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await post(`/stock/units/${unit.id}/adjust`, unit.kind === 'material' ? { qty: Number(qty), reason } : { boxes: Number(boxes), loose_pcs: Number(loose), reason });
      toast('Quantity corrected');
      onDone(r);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${`Correct the quantity of ${unit.code}`} onClose=${onClose} icon="edit"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} disabled=${!reason.trim()} onClick=${go}>Save correction<//>`}>
    <div class="form-grid">
      ${unit.kind === 'material'
        ? html`<${Field} label=${`Quantity counted (${unit.material_unit})`} class="span-2"><input class="input num" type="number" min="0" step="0.01" value=${qty} onInput=${(e) => setQty(e.target.value)} autoFocus /><//>`
        : html`<${Field} label="Full boxes counted"><input class="input num" type="number" min="0" value=${boxes} onInput=${(e) => setBoxes(e.target.value)} autoFocus /><//>
          <${Field} label="Loose pieces"><input class="input num" type="number" min="0" value=${loose} onInput=${(e) => setLoose(e.target.value)} /><//>`}
      <${Field} label="Reason (kept in the movement log)" class="span-2"><input class="input" value=${reason} onInput=${(e) => setReason(e.target.value)} placeholder="Count, breakage in handling, found extra box…" /><//>
    </div>
    <div class="mt-2"><${Callout} tone="info">Counting to 0 marks the unit as scrapped (tiles) or used up (materials) and removes it from its location.<//></div>
  <//>`;
}

/** Receive stock by hand: opening stock, returns, bought-in goods, raw material deliveries. */
export function ReceiveModal({ onClose, onDone, initialLocation = '', initialKind = 'pallet' }) {
  const [kind, setKind] = useState(initialKind);
  const [product, setProduct] = useState(null);
  const [picker, setPicker] = useState(false);
  const [v, setV] = useState({ material_id: '', lot_code: '', supplier_lot: '', grade: 'A', boxes: '', loose_pcs: '', qty: '', location_code: initialLocation, pool: 'general', copies: 1, notes: '' });
  const [busy, setBusy] = useState(false);
  const mats = useAsync(() => (kind === 'material' ? get('/materials') : null), [kind]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const go = async () => {
    setBusy(true);
    try {
      const body = { ...v, kind, product_id: product?.id, material_id: v.material_id || undefined, copies: Number(v.copies) || 1 };
      for (const k of ['boxes', 'loose_pcs', 'qty']) body[k] = Number(body[k]) || 0;
      if (!body.location_code) delete body.location_code;
      const r = await post('/stock/units', body);
      toast(`${r.units.length} unit${r.units.length === 1 ? '' : 's'} received - print the labels`);
      onDone(r.units);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const perPallet = product?.boxes_per_pallet || 78;
  return html`<${Modal} title="Receive stock" size="wide" onClose=${onClose} icon="inbox"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${go}>Receive ${Number(v.copies) > 1 ? `${v.copies} units` : ''}<//>`}>
    <div class="seg mb-3">
      ${[['pallet', 'Pallet of tiles'], ['boxes', 'Boxes on a shelf'], ['material', 'Raw material']].map(([k, l]) => html`<button class=${kind === k ? 'on' : ''} onClick=${() => setKind(k)}>${l}</button>`)}
    </div>
    <div class="form-grid">
      ${kind === 'material'
        ? html`<${Field} label="Material" class="span-2"><select class="select" value=${v.material_id} onChange=${set('material_id')}><option value="">Choose…</option>${(mats.data?.rows || []).map((m) => html`<option value=${m.id}>${m.code} · ${m.name} (${m.unit})</option>`)}</select><//>
          <${Field} label="Quantity"><input class="input num" type="number" min="0" step="0.01" value=${v.qty} onInput=${set('qty')} /><//>
          <${Field} label="Supplier lot / delivery note"><input class="input" value=${v.supplier_lot} onInput=${set('supplier_lot')} /><//>`
        : html`<${Field} label="Product" class="span-2">
            <button class="input" style="text-align:left;display:flex;align-items:center;gap:8px;height:auto;min-height:36px;padding:6px 10px;cursor:pointer" onClick=${() => setPicker(true)}>
              ${product ? html`<img class="thumb sm" src=${product.image_url} alt="" /><b>${product.sku}</b><span class="muted truncate">${product.name}</span>` : html`<span class="muted">Choose a product…</span>`}
            </button>
          <//>
          <${Field} label="Boxes per unit" hint=${kind === 'pallet' ? `A full pallet is ${perPallet} boxes` : ''}><input class="input num" type="number" min="0" value=${v.boxes} onInput=${set('boxes')} /><//>
          <${Field} label="Loose pieces"><input class="input num" type="number" min="0" value=${v.loose_pcs} onInput=${set('loose_pcs')} /><//>
          <${Field} label="Lot code" hint="Keeps batches apart - leave empty if unknown"><input class="input" style="font-family:var(--mono)" value=${v.lot_code} onInput=${set('lot_code')} placeholder="L26-0012" /><//>
          <${Field} label="Grade"><select class="select" value=${v.grade} onChange=${set('grade')}><option value="A">A - first choice</option><option value="B">B - second choice</option><option value="C">C - for cutting / mosaic</option></select><//>
          <${Field} label="Stock pool"><select class="select" value=${v.pool} onChange=${set('pool')}>${Object.entries(POOLS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select><//>
          <${Field} label="How many identical units" hint="E.g. 4 pallets of 78 boxes"><input class="input num" type="number" min="1" max="100" value=${v.copies} onInput=${set('copies')} /><//>`}
      <${Field} label="Location" class="span-2" hint="Leave empty to put it away later (it then shows in Put away)"><${ScanInput} value=${v.location_code} onInput=${(c) => setV({ ...v, location_code: c })} placeholder="A01-2B, S02-3C, M01…" /><//>
      <${Field} label="Notes" class="span-2"><input class="input" value=${v.notes} onInput=${set('notes')} /><//>
    </div>
    ${picker && html`<${ProductPicker} title="Choose the product" onPick=${(p) => (setProduct(p), setPicker(false))} onClose=${() => setPicker(false)} />`}
  <//>`;
}

export function warehouseOptions() {
  return (boot().warehouses || []).map((w) => ({ value: String(w.id), label: w.name }));
}
