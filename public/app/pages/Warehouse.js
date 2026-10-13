import { useMemo, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put, qs } from '../lib/api.js';
import { useAsync, useTitle, useDebounced, usePref } from '../lib/hooks.js';
import { Link, navigate, useQuery } from '../lib/router.js';
import { can, toast, toastError } from '../lib/store.js';
import { fmtNum, fmtQty, fmtDateTime, ago, titleCase } from '../lib/format.js';
import { ZONE_KINDS, UNIT_STATUSES } from '/shared/constants.js';
import { Button, LinkButton, Card, PageHeader, Loading, ErrorBox, Seg, Drawer, Badge, StatusBadge, EmptyState, Callout, Meter, QrImg, KV, confirmDialog } from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';
import { MoveModal, SplitModal, AdjustModal, ReceiveModal, UnitSummary } from '../components/StockActions.js';

export function WarehouseMap() {
  useTitle('Warehouse map');
  const query = useQuery();
  const [wh, setWh] = usePref('warehouse.current', '');
  const [find, setFind] = useState(query.get('find') || '');
  const dfind = useDebounced(find, 200);
  const [cellId, setCellId] = useState(null);
  const [receive, setReceive] = useState(null);
  const { data, error, loading, reload } = useAsync(() => get(`/warehouse/map${qs({ warehouse_id: wh })}`), [wh]);
  const where = useAsync(() => (dfind.trim().length >= 2 ? get(`/stock/where${qs({ q: dfind.trim() })}`) : null), [dfind]);

  const matches = useMemo(() => new Set((where.data?.rows || []).map((u) => u.location_id).filter(Boolean)), [where.data]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const searching = dfind.trim().length >= 2 && where.data;
  const cell = cellId ? data.cells.find((c) => c.id === cellId) : null;
  const totals = data.cells.reduce((s, c) => ({ cap: s.cap + (c.capacity_unit === 'pallet' && c.capacity ? c.capacity : 0), used: s.used + (c.capacity_unit === 'pallet' ? c.used : 0) }), { cap: 0, used: 0 });

  return html`<div>
    <${PageHeader}
      overline="Stock · Positioning"
      title="Warehouse map"
      sub=${`${data.warehouse.name} · ${fmtNum(totals.used)} of ${fmtNum(totals.cap)} pallet positions used`}
      help="stock-positioning"
      actions=${html`${data.warehouses.length > 1 && html`<${Seg} value=${String(data.warehouse.id)} onChange=${setWh} options=${data.warehouses.map((w) => ({ value: String(w.id), label: w.code }))} />`}
        <${LinkButton} href="/stock/count" icon="clipboard">Count<//>
        <${LinkButton} href=${`/labels?type=location&warehouse_id=${data.warehouse.id}`} icon="qr">Location labels<//>
        ${can('warehouse', 'production') && html`<${Button} variant="primary" icon="inbox" onClick=${() => setReceive({})}>Receive stock<//>`}`}
    />
    <div class="map-toolbar">
      <div class="table-toolbar card" style="flex:1;min-width:260px;padding:8px 10px;border-bottom:1px solid var(--border)">
        <div class="search" style="max-width:none"><${Icon} name="search" /><input class="input" placeholder="Where is…? SKU, colour, lot, pallet code (e.g. ZR10-39, Rabat, L26-0004)" value=${find} onInput=${(e) => setFind(e.target.value)} /></div>
        ${searching && html`<span class="small"><b>${where.data.rows.length}</b> unit${where.data.rows.length === 1 ? '' : 's'} in <b>${matches.size}</b> location${matches.size === 1 ? '' : 's'}</span>`}
        ${find && html`<${Button} size="sm" variant="ghost" icon="x" onClick=${() => setFind('')}>Clear<//>`}
      </div>
    </div>
    <div class="map-legend mb-3">
      <span><i style="background:var(--surface)"></i>Empty</span>
      <span><i style="background:var(--accent-soft)"></i>Partly used</span>
      <span><i style="background:color-mix(in srgb, var(--accent) 22%, var(--surface))"></i>Full</span>
      <span><i style="border-color:var(--info);border-width:2px"></i>Reserved for an order</span>
      <span><i style="background:var(--warning-soft);border-color:var(--warning)"></i>QC hold</span>
      <span><i class="cell blocked" style="width:14px;height:14px;padding:0"></i>Blocked</span>
      <span>Small squares = the glaze colours stored there</span>
    </div>
    ${data.unlocated > 0 && html`<div class="mb-3"><${Callout} tone="warning" title=${`${data.unlocated} unit(s) have no location.`}>They were not found during a count or were received without a position. <${Link} href="/warehouse/putaway">Put them away<//> or count the location where they are.<//></div>`}
    ${data.zones.map((z) => {
      const cells = data.cells.filter((c) => c.zone_id === z.id);
      const kind = ZONE_KINDS[z.kind] || {};
      const used = cells.reduce((s, c) => s + c.used, 0);
      const cap = cells.reduce((s, c) => s + (c.capacity || 0), 0);
      const racks = [...new Set(cells.map((c) => c.rack))];
      const isGrid = cells.some((c) => c.level);
      const isLane = !isGrid && cells.some((c) => c.position);
      return html`<section class="zone card card-pad">
        <div class="zone-head">
          <span class="z-code" style=${{ background: z.color || kind.color || 'var(--accent)' }}>${z.code}</span>
          <div style="flex:1;min-width:0"><div class="z-name">${z.name}</div><div class="z-meta">${kind.label || z.kind} · ${cells.length} positions${cap ? ` · ${fmtNum(used)}/${fmtNum(cap)} ${kind.unit === 'box' ? 'boxes' : 'pallets'}` : ''}</div></div>
          <${LinkButton} href=${`/labels?type=location&zone_id=${z.id}`} size="sm" variant="ghost" icon="qr">Labels<//>
        </div>
        ${isGrid
          ? html`<div class="racks">
              ${racks.map((r) => {
                const rc = cells.filter((c) => c.rack === r);
                const levels = [...new Set(rc.map((c) => c.level))].sort((a, b) => b - a);
                const positions = [...new Set(rc.map((c) => c.position))].sort();
                return html`<div class="rack">
                  <div class="rack-name"><span>${z.code}${r}</span><span>${rc.filter((c) => c.units.length).length}/${rc.length}</span></div>
                  <div class="rack-grid" style=${{ gridTemplateColumns: `repeat(${positions.length}, auto)` }}>
                    ${levels.map((lv) => positions.map((pos) => {
                      const c = rc.find((x) => x.level === lv && x.position === pos);
                      return c ? html`<${Cell} c=${c} short=${`${lv}${pos}`} searching=${searching} match=${matches.has(c.id)} selected=${c.id === cellId} onClick=${() => setCellId(c.id)} />` : html`<span></span>`;
                    }))}
                  </div>
                </div>`;
              })}
            </div>`
          : isLane
            ? html`<div class="lanes">
                ${racks.map((r) => {
                  const rc = cells.filter((c) => c.rack === r).sort((a, b) => Number(b.position) - Number(a.position));
                  return html`<div class="rack"><div class="rack-name"><span>Lane ${z.code}${r}</span></div><div class="rack-grid">${rc.map((c) => html`<${Cell} c=${c} short=${c.label} searching=${searching} match=${matches.has(c.id)} selected=${c.id === cellId} onClick=${() => setCellId(c.id)} />`)}</div></div>`;
                })}
              </div>`
            : html`<div class="lanes">${cells.map((c) => html`<${Cell} c=${c} short=${c.label} wide searching=${searching} match=${matches.has(c.id)} selected=${c.id === cellId} onClick=${() => setCellId(c.id)} />`)}</div>`}
      </section>`;
    })}
    ${cell && html`<${LocationDrawer} cellId=${cell.id} label=${cell.label} onClose=${() => setCellId(null)} onChanged=${reload} />`}
    ${receive && html`<${ReceiveModal} initialLocation=${receive.location || ''} onClose=${() => setReceive(null)} onDone=${(units) => {
      setReceive(null);
      reload();
      navigate(`/labels?type=unit&ids=${units.map((u) => u.id).join(',')}`);
    }} />`}
  </div>`;
}

function Cell({ c, short, wide, searching, match, selected, onClick }) {
  const reserved = c.units.some((u) => ['reserved', 'picked'].includes(u.status));
  const hold = c.units.some((u) => u.status === 'hold');
  const full = c.capacity && c.used >= c.capacity;
  const hexes = [...new Set(c.units.map((u) => u.hex || (u.unit ? '#9c8f80' : null)).filter(Boolean))].slice(0, 4);
  const cls = ['cell', wide && 'single', full && 'full', reserved && 'reserved', hold && 'hold', c.blocked && 'blocked', searching && (match ? 'match' : 'dim'), selected && 'selected'].filter(Boolean).join(' ');
  const qty = c.units.length ? (c.capacity_unit === 'box' ? `${fmtNum(c.boxes)} bx` : c.capacity_unit === 'pallet' ? `${c.used}${c.capacity ? `/${c.capacity}` : ''} pal` : `${c.units.length} lot${c.units.length > 1 ? 's' : ''}`) : '';
  const title = `${c.label}${c.units.length ? `\n${c.units.map((u) => `${u.code} ${u.sku || ''} ${u.boxes ? `${u.boxes} bx` : `${u.qty} ${u.unit || ''}`}${u.lot ? ` lot ${u.lot}` : ''}${u.order ? ` → ${u.order}` : ''}`).join('\n')}` : '\nEmpty'}`;
  return html`<button class=${cls} title=${title} onClick=${onClick} aria-label=${title}>
    <span class="c-fill" style=${{ height: `${Math.round((c.fill || 0) * 100)}%` }}></span>
    <span class="c-label">${short}</span>
    <span class="c-swatches">${hexes.map((h) => html`<i style=${{ background: h }}></i>`)}</span>
    <span class="c-qty">${qty}</span>
  </button>`;
}

function LocationDrawer({ cellId, label, onClose, onChanged }) {
  const { data, loading, reload } = useAsync(() => get(`/locations/${cellId}/detail`), [cellId]);
  const [act, setAct] = useState(null);
  const done = () => {
    setAct(null);
    reload();
    onChanged();
  };
  const l = data?.location;
  return html`<${Drawer} title=${`Location ${label}`} onClose=${onClose}
    actions=${html`<${LinkButton} href=${`/warehouse/location/${cellId}`} size="sm" variant="ghost" icon="external">Open<//>`}>
    ${loading && !data
      ? html`<${Loading} />`
      : html`<div class="stack">
          <div class="row top">
            <div style="flex:1">
              <div class="muted small">${l.warehouse_code} · ${l.zone_name}</div>
              <div class="mono strong" style="font-size:20px">${l.code}</div>
              ${data.occupancy.capacity ? html`<div class="mt-1" style="max-width:220px"><${Meter} value=${data.occupancy.used} max=${data.occupancy.capacity} /><div class="small muted mt-1">${data.occupancy.used} of ${data.occupancy.capacity} ${data.occupancy.unit}s used</div></div>` : html`<div class="small muted mt-1">${data.occupancy.units} unit(s)</div>`}
              ${l.blocked ? html`<${Badge} tone="danger" class="mt-1">Blocked<//>` : null}
            </div>
            <${QrImg} code=${l.code} size=${92} />
          </div>
          <div class="row wrap">
            <${LinkButton} href=${`/labels?type=location&ids=${l.id}`} size="sm" icon="printer">Print label<//>
            <${LinkButton} href=${`/stock/count?location=${encodeURIComponent(l.code)}`} size="sm" icon="clipboard">Count<//>
            ${can('warehouse') && html`<${Button} size="sm" icon=${l.blocked ? 'check' : 'lock'} onClick=${async () => {
              await put(`/locations/${l.id}`, { blocked: l.blocked ? 0 : 1 });
              reload();
              onChanged();
            }}>${l.blocked ? 'Unblock' : 'Block'}<//>`}
          </div>
          <div class="section-title">On this location</div>
          ${data.units.length
            ? data.units.map((u) => html`<div class="card card-pad">
                <${UnitSummary} u=${u} />
                <div class="row wrap mt-2">
                  ${can('warehouse', 'production') && html`<${Button} size="sm" icon="move" onClick=${() => setAct({ kind: 'move', u })}>Move<//>`}
                  ${can('warehouse', 'production') && u.boxes > 1 && html`<${Button} size="sm" icon="split" onClick=${() => setAct({ kind: 'split', u })}>Split<//>`}
                  ${can('warehouse', 'production') && html`<${Button} size="sm" icon="edit" onClick=${() => setAct({ kind: 'adjust', u })}>Correct qty<//>`}
                  <${LinkButton} size="sm" href=${`/labels?type=unit&ids=${u.id}`} icon="qr">Label<//>
                  <${LinkButton} size="sm" variant="ghost" href=${`/stock/units/${u.id}`} icon="arrowRight">Details<//>
                </div>
              </div>`)
            : html`<${EmptyState} icon="pallet" title="Empty" text="Scan a pallet and choose this location, or use Move from a pallet." />`}
        </div>`}
    ${act?.kind === 'move' && html`<${MoveModal} unit=${act.u} onClose=${() => setAct(null)} onDone=${done} />`}
    ${act?.kind === 'split' && html`<${SplitModal} unit=${act.u} onClose=${() => setAct(null)} onDone=${done} />`}
    ${act?.kind === 'adjust' && html`<${AdjustModal} unit=${act.u} onClose=${() => setAct(null)} onDone=${done} />`}
  <//>`;
}

export function LocationDetail({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/locations/${id}/detail`), [id]);
  const [act, setAct] = useState(null);
  const [receive, setReceive] = useState(false);
  useTitle(data ? `Location ${data.location.label}` : 'Location');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const l = data.location;
  const done = () => {
    setAct(null);
    reload();
  };
  return html`<div>
    <${PageHeader}
      back=${{ href: '/warehouse', label: 'Warehouse map' }}
      overline=${`${l.warehouse_code} · ${l.zone_name}`}
      title=${html`<span class="mono">${l.label}</span>`}
      sub=${`${l.code}${data.occupancy.capacity ? ` · ${data.occupancy.used}/${data.occupancy.capacity} ${data.occupancy.unit}s` : ''}${l.blocked ? ' · BLOCKED' : ''}`}
      help="stock-positioning"
      actions=${html`<${LinkButton} href=${`/labels?type=location&ids=${l.id}`} icon="printer">Print label<//>
        <${LinkButton} href=${`/stock/count?location=${encodeURIComponent(l.code)}`} icon="clipboard">Count this location<//>
        ${can('warehouse', 'production') && html`<${Button} variant="primary" icon="inbox" onClick=${() => setReceive(true)}>Receive here<//>`}`}
    />
    <div class="grid side">
      <div class="stack">
        <${Card} title="Stock here" sub=${`${data.units.length} unit(s)`} icon="pallet">
          ${data.units.length
            ? html`<div class="stack sm">${data.units.map((u) => html`<div class="card card-pad">
                <${UnitSummary} u=${u} />
                <div class="row wrap mt-2">
                  ${can('warehouse', 'production') && html`<${Button} size="sm" icon="move" onClick=${() => setAct({ kind: 'move', u })}>Move<//><${Button} size="sm" icon="split" onClick=${() => setAct({ kind: 'split', u })}>Split<//><${Button} size="sm" icon="edit" onClick=${() => setAct({ kind: 'adjust', u })}>Correct qty<//>`}
                  <${LinkButton} size="sm" variant="ghost" href=${`/stock/units/${u.id}`} icon="arrowRight">Details<//>
                </div>
              </div>`)}</div>`
            : html`<${EmptyState} icon="pallet" title="This location is empty" />`}
        <//>
        <${Card} title="Recent movements" icon="history" pad=${false}>
          <${MovesTable} rows=${data.moves} />
        <//>
      </div>
      <${Card} title="Location label" icon="qr">
        <div class="center"><${QrImg} code=${l.code} size=${180} /></div>
        <p class="small muted mt-2">Stick this label on the rack beam under the position. Scanning it shows what is stored here and lets staff put a pallet away or count it.</p>
        <${KV} items=${[['Code', html`<span class="mono">${l.code}</span>`], ['Rack', l.rack], ['Level', l.level], ['Position', l.position], ['Capacity', l.capacity ? `${l.capacity} ${l.capacity_unit}(s)` : 'Not limited']]} />
      <//>
    </div>
    ${act?.kind === 'move' && html`<${MoveModal} unit=${act.u} onClose=${() => setAct(null)} onDone=${done} />`}
    ${act?.kind === 'split' && html`<${SplitModal} unit=${act.u} onClose=${() => setAct(null)} onDone=${done} />`}
    ${act?.kind === 'adjust' && html`<${AdjustModal} unit=${act.u} onClose=${() => setAct(null)} onDone=${done} />`}
    ${receive && html`<${ReceiveModal} initialLocation=${l.code} onClose=${() => setReceive(false)} onDone=${(units) => (setReceive(false), navigate(`/labels?type=unit&ids=${units.map((u) => u.id).join(',')}`))} />`}
  </div>`;
}

export function MovesTable({ rows }) {
  const TONE = { receive: 'success', move: 'info', reserve: 'progress', unreserve: 'neutral', pick: 'progress', load: 'info', ship: 'success', adjust: 'warning', scrap: 'danger', consume: 'neutral', count: 'warning', split: 'neutral', hold: 'warning', release: 'success', unload: 'warning', pool: 'neutral' };
  return html`<${DataTable}
    compact
    columns=${[
      { key: 'at', label: 'When', render: (m) => html`<span class="small">${fmtDateTime(m.at)}</span>` },
      { key: 'type', label: 'Move', render: (m) => html`<${Badge} tone=${TONE[m.type] || 'neutral'} plain>${titleCase(m.type)}<//>` },
      { key: 'unit_code', label: 'Unit', render: (m) => html`<${Link} href=${`/stock/units/${m.unit_id}`} class="code-chip">${m.unit_code || '—'}<//>` },
      { key: 'where', label: 'From → to', render: (m) => html`<span class="small mono">${m.from_label || '·'} → ${m.to_label || '·'}</span>` },
      { key: 'boxes', label: 'Qty', align: 'num', render: (m) => (m.boxes ? `${fmtNum(m.boxes)} bx` : m.qty ? fmtQty(m.qty) : '—') },
      { key: 'ref', label: 'Ref / note', render: (m) => html`<span class="small muted">${[m.ref, m.notes].filter(Boolean).join(' · ')}</span>` },
      { key: 'user_name', label: 'By', hideSm: true, render: (m) => html`<span class="small">${m.user_name || ''}</span>` },
    ]}
    rows=${rows}
    empty=${html`<div class="muted small" style="padding:14px">No movements yet.</div>`}
  />`;
}

export function Putaway() {
  useTitle('Put away');
  const { data, error, loading, reload } = useAsync(() => get('/stock/putaway-queue'), []);
  const [move, setMove] = useState(null);
  const [busyId, setBusyId] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  const rows = data?.rows || [];
  const quick = async (u) => {
    setBusyId(u.id);
    try {
      const { suggestions } = await get(`/stock/units/${u.id}/putaway`);
      if (!suggestions.length) {
        setMove(u);
        return;
      }
      const s = suggestions[0];
      if (!(await confirmDialog({ title: `Put ${u.code} in ${s.label}?`, message: `${s.zone}\n${s.reasons.join(' · ')}`, confirmLabel: `Put away in ${s.label}` }))) return;
      const r = await post(`/stock/units/${u.id}/move`, { location_id: s.id });
      toast(`${u.code} → ${r.location.label}`);
      reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusyId(null);
    }
  };
  return html`<div>
    <${PageHeader}
      overline="Stock · Positioning"
      title="Put away"
      sub="Pallets and boxes in the packing-out area or without a position. Every unit gets a place - then anyone can find it on the map."
      help="stock-positioning"
      actions=${rows.length > 0 && html`<${LinkButton} href=${`/labels?type=unit&ids=${rows.map((u) => u.id).join(',')}`} icon="printer">Print their labels<//><${LinkButton} href="/scan?mode=putaway" variant="primary" icon="scan">Put away by scanning<//>`}
    />
    ${loading && !data
      ? html`<${Loading} />`
      : !rows.length
        ? html`<div class="card"><${EmptyState} icon="checkCircle" title="Nothing waiting" text="Everything has a position. New pallets appear here when production packs them." /></div>`
        : html`<div class="card"><${DataTable}
            columns=${[
              { key: 'code', label: 'Unit', render: (u) => html`<div class="prod-cell">${u.image_url ? html`<img class="thumb" src=${u.image_url} alt="" />` : html`<span class="thumb"></span>`}<div><div class="cell-main mono">${u.code}</div><div class="cell-sub">${u.sku || u.material_code} ${u.lot_code ? `· lot ${u.lot_code}` : ''}</div></div></div>` },
              { key: 'boxes', label: 'Qty', align: 'num', render: (u) => (u.kind === 'material' ? `${fmtQty(u.qty)} ${u.material_unit}` : `${fmtNum(u.boxes)} boxes`) },
              { key: 'status', label: 'Status', render: (u) => html`<${StatusBadge} map=${UNIT_STATUSES} value=${u.status} />${u.order_number ? html` <span class="small muted">${u.order_number}</span>` : ''}` },
              { key: 'location_label', label: 'Now at', render: (u) => html`<span class="mono small">${u.location_label || 'no location'}</span>` },
              { key: 'created_at', label: 'Since', render: (u) => html`<span class="small muted">${ago(u.created_at)}</span>` },
              { key: 'x', label: '', render: (u) => can('warehouse', 'production') && html`<div class="row" style="justify-content:flex-end"><${Button} size="sm" variant="primary" icon="target" loading=${busyId === u.id} onClick=${() => quick(u)}>Suggest & place<//><${Button} size="sm" icon="move" onClick=${() => setMove(u)}>Choose…<//></div>` },
            ]}
            rows=${rows}
          /></div>`}
    ${move && html`<${MoveModal} unit=${move} title=${`Put away ${move.code}`} onClose=${() => setMove(null)} onDone=${() => (setMove(null), reload())} />`}
  </div>`;
}
