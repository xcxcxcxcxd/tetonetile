import { useEffect, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, qs } from '../lib/api.js';
import { useAsync, useTitle, useDebounced } from '../lib/hooks.js';
import { Link, navigate, useQuery, setQuery } from '../lib/router.js';
import { can, toast, toastError } from '../lib/store.js';
import { fmtNum, fmtQty, fmtDate, ago, titleCase } from '../lib/format.js';
import { UNIT_STATUSES, POOLS } from '/shared/constants.js';
import { beep } from '../lib/feedback.js';
import { Button, LinkButton, Card, PageHeader, Loading, ErrorBox, Seg, Badge, StatusBadge, EmptyState, Callout, QrImg, KV, confirmDialog, promptDialog } from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';
import { MoveModal, SplitModal, AdjustModal, ReceiveModal, UnitSummary } from '../components/StockActions.js';
import { ScannerView } from '../components/Scanner.js';
import { MovesTable } from './Warehouse.js';

export function Stock() {
  useTitle('Stock');
  const query = useQuery();
  const tab = query.get('tab') || 'summary';
  const [q, setQ] = useState(query.get('q') || '');
  const dq = useDebounced(q, 220);
  const [receive, setReceive] = useState(false);
  const summary = useAsync(() => (tab === 'summary' ? get(`/stock/summary${qs({ q: dq })}`) : null), [tab, dq]);
  const units = useAsync(() => (tab === 'units' ? get(`/stock/units${qs({ q: dq })}`) : null), [tab, dq]);
  const where = useAsync(() => (tab === 'where' && dq.trim().length >= 2 ? get(`/stock/where${qs({ q: dq.trim() })}`) : null), [tab, dq]);

  return html`<div>
    <${PageHeader}
      overline="Stock"
      title="Stock"
      sub="Finished tiles and raw materials, by product, unit and position"
      help="stock-positioning"
      actions=${html`<a class="btn ghost" href="/api/data/export/stock"><${Icon} name="download" />Export<//>
        <${LinkButton} href="/warehouse" icon="map">Map<//>
        ${can('warehouse', 'production') && html`<${Button} variant="primary" icon="inbox" onClick=${() => setReceive(true)}>Receive stock<//>`}`}
    />
    <div class="row wrap mb-2">
      <${Seg} value=${tab} onChange=${(v) => setQuery({ tab: v })} options=${[{ value: 'summary', label: 'By product' }, { value: 'units', label: 'All units' }, { value: 'where', label: 'Where is…?' }]} />
      <div class="search card" style="flex:1;min-width:220px;max-width:420px;position:relative;border:0;box-shadow:none;background:none">
        <input class="input" placeholder=${tab === 'where' ? 'SKU, colour, lot or pallet code' : 'Search'} value=${q} onInput=${(e) => setQ(e.target.value)} autoFocus=${tab === 'where'} />
      </div>
    </div>
    ${tab === 'summary' &&
    html`<div class="card">${summary.loading && !summary.data
      ? html`<${Loading} />`
      : html`<${DataTable}
          columns=${[
            { key: 'sku', label: 'Product', sort: true, render: (r) => html`<div class="prod-cell"><img class="thumb" src=${r.image_url} alt="" /><div><div class="cell-main mono">${r.sku}</div><div class="cell-sub">${r.colour_code} ${r.colour_name} · ${r.format_code}</div></div></div>` },
            { key: 'on_hand', label: 'On hand', align: 'num', sort: true, render: (r) => html`${fmtNum(r.on_hand)} bx<div class="cell-sub">${r.on_hand_m2 ? `${fmtQty(r.on_hand_m2)} m²` : ''}</div>` },
            { key: 'reserved', label: 'Reserved', align: 'num', sort: true, render: (r) => (r.reserved ? fmtNum(r.reserved) : html`<span class="muted">0</span>`) },
            { key: 'available', label: 'Free (A)', align: 'num', sort: true, render: (r) => html`<b>${fmtNum(r.available)}</b> bx<div class="cell-sub">${r.available_m2 ? `${fmtQty(r.available_m2)} m²` : ''}</div>` },
            { key: 'export_reserve', label: 'Export reserve', align: 'num', sort: true, render: (r) => (r.export_reserve ? html`${fmtNum(r.export_reserve)}${r.reserve_target_boxes ? html`<div class="cell-sub">target ${fmtNum(r.reserve_target_boxes)}</div>` : ''}` : html`<span class="muted">—</span>`) },
            { key: 'grade_b', label: 'Grade B', align: 'num', render: (r) => (r.grade_b ? fmtNum(r.grade_b) : html`<span class="muted">—</span>`) },
            { key: 'on_hold', label: 'QC hold', align: 'num', render: (r) => (r.on_hold ? html`<${Badge} tone="warning" plain>${fmtNum(r.on_hold)}<//>` : html`<span class="muted">—</span>`) },
            { key: 'lots', label: 'Lots', align: 'num', render: (r) => html`<span title="Each lot is one production batch - do not mix lots on one wall">${r.lots}</span>` },
            { key: 'locations', label: 'Positions', align: 'num' },
          ]}
          rows=${summary.data?.rows || []}
          onRowClick=${(r) => navigate(`/catalog/${r.product_id}?tab=stock`)}
          empty=${html`<${EmptyState} icon="boxes" title="No stock recorded" text="Stock appears when production packs pallets, or receive opening stock by hand." kb="stock-positioning" />`}
        />`}</div>`}
    ${tab === 'units' && html`<div class="card">${units.loading && !units.data ? html`<${Loading} />` : html`<${UnitsTable} rows=${units.data?.rows || []} />`}</div>`}
    ${tab === 'where' &&
    html`<div class="card">${dq.trim().length < 2
      ? html`<${EmptyState} icon="pin" title="Find any product in the warehouse" text="Type a SKU (ZR10-39), a colour name (Rabat), a lot (L26-0004) or a pallet code. You get every position, lot and quantity - and can open it on the map." />`
      : where.loading && !where.data
        ? html`<${Loading} />`
        : html`${where.data?.rows?.length ? html`<div class="table-toolbar"><span class="small"><b>${where.data.rows.length}</b> units found</span><span class="spacer"></span><${LinkButton} size="sm" href=${`/warehouse?find=${encodeURIComponent(dq.trim())}`} icon="map">Show on the map<//></div>` : ''}
            <${UnitsTable} rows=${where.data?.rows || []} showWhere />`}</div>`}
    ${receive && html`<${ReceiveModal} onClose=${() => setReceive(false)} onDone=${(u) => (setReceive(false), navigate(`/labels?type=unit&ids=${u.map((x) => x.id).join(',')}`))} />`}
  </div>`;
}

export function UnitsTable({ rows, showWhere }) {
  return html`<${DataTable}
    columns=${[
      ...(showWhere ? [{ key: 'location_label', label: 'Position', sort: true, render: (u) => html`<div class="cell-main mono" style="font-size:15px">${u.location_label || '—'}</div><div class="cell-sub">${u.zone_name || ''}</div>` }] : []),
      { key: 'code', label: 'Unit', sort: true, render: (u) => html`<div class="prod-cell">${u.image_url ? html`<img class="thumb sm" src=${u.image_url} alt="" />` : html`<span class="thumb sm"></span>`}<div><div class="cell-main mono">${u.code}</div><div class="cell-sub">${titleCase(u.kind)}</div></div></div>` },
      { key: 'sku', label: 'Item', sort: true, render: (u) => html`<div class="mono">${u.sku || u.material_code}</div><div class="cell-sub">${u.lot_code ? `lot ${u.lot_code}` : u.supplier_lot || ''}${u.grade && u.grade !== 'A' && u.kind !== 'material' ? ` · grade ${u.grade}` : ''}</div>` },
      { key: 'boxes', label: 'Qty', align: 'num', sort: (u) => u.boxes || u.qty, render: (u) => (u.kind === 'material' ? `${fmtQty(u.qty)} ${u.material_unit}` : html`${fmtNum(u.boxes)} bx<div class="cell-sub">${u.m2 ? `${fmtQty(u.m2)} m²` : ''}</div>`) },
      ...(!showWhere ? [{ key: 'location_label', label: 'Position', sort: true, render: (u) => html`<span class="mono">${u.location_label || html`<span style="color:var(--warning)">none</span>`}</span>` }] : []),
      { key: 'status', label: 'Status', sort: true, render: (u) => html`<${StatusBadge} map=${UNIT_STATUSES} value=${u.status} />${u.pool !== 'general' ? html` <${Badge} plain tone="info">${POOLS[u.pool]}<//>` : ''}` },
      { key: 'order_number', label: 'For', render: (u) => (u.order_number ? html`<${Link} href=${`/docs/${u.order_id}`}>${u.order_number}<//>` : html`<span class="muted">—</span>`) },
    ]}
    rows=${rows}
    onRowClick=${(u) => navigate(`/stock/units/${u.id}`)}
    empty=${html`<${EmptyState} icon="boxes" title="Nothing found" />`}
  />`;
}

export function UnitDetail({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/stock/units/${id}`), [id]);
  const [act, setAct] = useState(null);
  useTitle(data ? data.unit.code : 'Stock unit');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const u = data.unit;
  const done = () => {
    setAct(null);
    reload();
  };
  const present = ['in_stock', 'reserved', 'picked', 'hold'].includes(u.status);
  const setStatus = async (status) => {
    const notes = await promptDialog({ title: status === 'hold' ? `Put ${u.code} on hold` : status === 'scrapped' ? `Scrap ${u.code}` : `Release ${u.code}`, label: 'Reason', placeholder: status === 'hold' ? 'Damaged, wrong shade, waiting for QC…' : '', required: status !== 'in_stock' });
    if (notes === null) return;
    try {
      await post(`/stock/units/${u.id}/status`, { status, notes });
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  const setPool = async (pool) => {
    try {
      await post(`/stock/units/${u.id}/pool`, { pool });
      toast(`Moved to ${POOLS[pool]}`);
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  return html`<div>
    <${PageHeader}
      back=${{ href: '/stock?tab=units', label: 'Stock' }}
      overline=${titleCase(u.kind)}
      title=${html`<span class="mono">${u.code}</span>`}
      sub=${`${u.sku || u.material_code} · ${u.product_name || u.material_name}`}
      help="stock-positioning"
      actions=${html`<${LinkButton} href=${`/labels?type=unit&ids=${u.id}`} icon="printer">Print label<//>
        ${present && can('warehouse', 'production') && html`<${Button} variant="primary" icon="move" onClick=${() => setAct('move')}>Move<//>`}`}
    />
    <div class="grid side">
      <div class="stack">
        <${Card}>
          <${UnitSummary} u=${u} />
          ${present && can('warehouse', 'production') &&
          html`<div class="row wrap mt-3">
            ${u.boxes > 1 && html`<${Button} size="sm" icon="split" onClick=${() => setAct('split')}>Split<//>`}
            <${Button} size="sm" icon="edit" onClick=${() => setAct('adjust')}>Correct quantity<//>
            ${u.status !== 'hold' ? html`<${Button} size="sm" icon="alert" onClick=${() => setStatus('hold')}>Put on hold<//>` : html`<${Button} size="sm" icon="check" onClick=${() => setStatus('in_stock')}>Release hold<//>`}
            ${u.status === 'in_stock' && u.kind !== 'material' && html`<select class="select sm" style="width:auto" value=${u.pool} onChange=${(e) => setPool(e.target.value)} aria-label="Stock pool">${Object.entries(POOLS).map(([k, l]) => html`<option value=${k}>${l}</option>`)}</select>`}
            <${Button} size="sm" variant="ghost danger" icon="trash" onClick=${() => setStatus('scrapped')}>Scrap<//>
          </div>`}
        <//>
        ${data.children.length > 0 && html`<${Card} title="On this shipping pallet" pad=${false}><${UnitsTable} rows=${data.children} /><//>`}
        <${Card} title="History" icon="history" pad=${false}><${MovesTable} rows=${data.moves} /><//>
      </div>
      <div class="stack">
        <${Card} title="Label" icon="qr">
          <div class="center"><${QrImg} code=${u.code} size=${170} /></div>
          <p class="small muted mt-2">Scan to see this unit, move it, or load it on a shipment.</p>
        <//>
        <${Card} title="Traceability" icon="link">
          <${KV} items=${[
            ['Lot', u.lot_id ? html`<${Link} href=${`/lots/${u.lot_id}`}>${u.lot_code}<//> ${u.lot_status !== 'released' ? html`<${Badge} plain tone="warning">${u.lot_status}<//>` : ''}` : u.supplier_lot],
            ['Made by', u.mo_id ? html`<${Link} href=${`/production/mo/${u.mo_id}`}>production order<//>` : null],
            ['Reserved for', u.order_number ? html`<${Link} href=${`/docs/${u.order_id}`}>${u.order_number}<//> · ${u.order_client}` : null],
            ['Shipment', u.shipment_number ? html`<${Link} href=${`/shipments/${u.shipment_id}`}>${u.shipment_number}<//>` : null],
            ['Received', fmtDate(u.created_at)],
            ['Last change', ago(u.updated_at)],
            ['Notes', u.notes],
          ]} />
        <//>
      </div>
    </div>
    ${act === 'move' && html`<${MoveModal} unit=${u} onClose=${() => setAct(null)} onDone=${done} />`}
    ${act === 'split' && html`<${SplitModal} unit=${u} onClose=${() => setAct(null)} onDone=${done} />`}
    ${act === 'adjust' && html`<${AdjustModal} unit=${u} onClose=${() => setAct(null)} onDone=${done} />`}
  </div>`;
}

export function Moves() {
  useTitle('Movements');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 220);
  const { data, error, loading, reload } = useAsync(() => get(`/stock/moves${qs({ type, q: dq, limit: 500 })}`), [type, dq]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  return html`<div>
    <${PageHeader} overline="Stock" title="Movements" sub="Every receipt, move, reservation, pick, load and correction - who, when, from where to where" help="stock-positioning"
      actions=${html`<a class="btn ghost" href="/api/data/export/moves"><${Icon} name="download" />Export<//>`} />
    <div class="card">
      <div class="table-toolbar">
        <div class="search"><${Icon} name="search" /><input class="input" placeholder="Unit code, reference, note" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
        <select class="select" style="width:auto" value=${type} onChange=${(e) => setType(e.target.value)}>
          <option value="">All movements</option>
          ${['receive', 'move', 'split', 'reserve', 'unreserve', 'pick', 'load', 'unload', 'ship', 'adjust', 'count', 'hold', 'release', 'scrap', 'consume', 'pool'].map((t) => html`<option value=${t}>${titleCase(t)}</option>`)}
        </select>
      </div>
      ${loading && !data ? html`<${Loading} />` : html`<${MovesTable} rows=${data?.rows || []} />`}
    </div>
  </div>`;
}

/** Cycle count: scan the location, then scan every label you see. */
export function Count() {
  useTitle('Count');
  const query = useQuery();
  const [loc, setLoc] = useState(null);
  const [found, setFound] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);

  const openLoc = async (code) => {
    try {
      const r = await get(`/resolve/${encodeURIComponent(code)}`);
      if (r.type !== 'location') throw new Error(`${code} is not a location label.`);
      const d = await get(`/locations/${r.id}/detail`);
      setLoc(d);
      setFound([]);
      setResult(null);
    } catch (e) {
      toastError(e);
    }
  };
  useEffect(() => {
    if (query.get('location')) openLoc(query.get('location'));
  }, []);

  const onScan = (code) => {
    if (!loc) return;
    const c = code.toUpperCase();
    if (found.some((f) => f.code === c)) {
      beep(true);
      return;
    }
    const expected = loc.units.find((u) => u.code === c);
    beep(!!expected);
    setFlash(expected ? 'ok' : 'bad');
    setTimeout(() => setFlash(null), 500);
    setFound((f) => [...f, { code: c, boxes: expected ? expected.boxes : '', qty: expected?.kind === 'material' ? expected.qty : '', expected: !!expected, kind: expected?.kind }]);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await post('/stock/count', { location_id: loc.location.id, found: found.map((f) => ({ code: f.code, boxes: f.kind === 'material' ? undefined : f.boxes, qty: f.kind === 'material' ? f.qty : undefined })) });
      setResult(r);
      toast(`Count saved for ${r.location}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return html`<div class="scan-page">
    <${PageHeader} overline="Stock" title="Count a location" sub="Cycle count: scan the location, then every pallet / box label you see there." help="stock-positioning" />
    ${!loc
      ? html`<${Card} title="1. Scan or type the location" icon="pin">
          <${ScannerView} hint="Scan the location label on the rack beam" onCode=${openLoc} />
        <//>`
      : html`<div class="stack">
          <${Card} title=${`Location ${loc.location.label}`} sub=${`${loc.units.length} unit(s) expected`} icon="pin" actions=${html`<${Button} size="sm" variant="ghost" onClick=${() => setLoc(null)}>Change<//>`}>
            ${result
              ? html`<div class="stack sm">
                  <${Callout} tone=${result.missing.length || result.unknown.length ? 'warning' : 'success'} title="Count saved.">
                    ${result.confirmed} confirmed · ${result.moved.length} moved here · ${result.adjusted.length} corrected · ${result.missing.length} not found${result.unknown.length ? ` · unknown: ${result.unknown.join(', ')}` : ''}
                  <//>
                  ${result.missing.length > 0 && html`<div class="small">Not found (now "no location" - look for them): <b class="mono">${result.missing.join(', ')}</b></div>`}
                  <div class="row"><${Button} variant="primary" onClick=${() => (setLoc(null), setResult(null))}>Count another location<//><${LinkButton} href="/warehouse">Back to the map<//></div>
                </div>`
              : html`<${ScannerView} hint="Scan each label at this location" flash=${flash} onCode=${onScan} />
                <div class="section-title mt-3">Expected here</div>
                <div class="scan-log">
                  ${loc.units.map((u) => {
                    const f = found.find((x) => x.code === u.code);
                    return html`<div class=${`sl ${f ? 'ok' : ''}`}><${Icon} name=${f ? 'checkCircle' : 'pallet'} size="16" /><span class="mono strong">${u.code}</span><span class="muted truncate" style="flex:1">${u.sku || u.material_code} · ${u.kind === 'material' ? `${fmtQty(u.qty)} ${u.material_unit}` : `${u.boxes} bx`}</span>
                      ${f && html`<input class="input sm num" style="width:80px" type="number" min="0" value=${u.kind === 'material' ? f.qty : f.boxes} onInput=${(e) => setFound((all) => all.map((x) => (x.code === u.code ? { ...x, [u.kind === 'material' ? 'qty' : 'boxes']: e.target.value } : x)))} aria-label="Counted" />`}</div>`;
                  })}
                  ${found.filter((f) => !f.expected).map((f) => html`<div class="sl bad"><${Icon} name="alert" size="16" /><span class="mono strong">${f.code}</span><span class="muted" style="flex:1">not expected here - will be moved to this location</span><${Button} size="sm" variant="ghost" icon="x" onClick=${() => setFound((all) => all.filter((x) => x.code !== f.code))} /></div>`)}
                </div>
                <div class="row mt-3">
                  <span class="small muted">${found.length} scanned · ${loc.units.filter((u) => !found.some((f) => f.code === u.code)).length} expected not scanned yet</span>
                  <span class="spacer"></span>
                  <${Button} variant="primary" loading=${busy} onClick=${async () => {
                    const missing = loc.units.filter((u) => !found.some((f) => f.code === u.code)).length;
                    if (missing && !(await confirmDialog({ title: `${missing} unit(s) not scanned`, message: 'Units you did not scan lose their position (they show as "no location" until found). Finish the count?', confirmLabel: 'Finish count' }))) return;
                    submit();
                  }}>Finish count<//>
                </div>`}
          <//>
        </div>`}
  </div>`;
}
