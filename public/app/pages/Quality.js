import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, qs } from '../lib/api.js';
import { useAsync, useTitle, useDebounced } from '../lib/hooks.js';
import { Link, navigate, useQuery, setQuery } from '../lib/router.js';
import { can, toast, toastError, boot, openKb } from '../lib/store.js';
import { fmtNum, fmtQty, fmtDate, fmtDateTime, today, money } from '../lib/format.js';
import { MO_STATUSES, UNIT_STATUSES, CLAIM_STATUSES, KILN_STATUSES, POOLS } from '/shared/constants.js';
import { VARIATION_SCALES, VARIATION_STANDARD, allowedVariation } from '/shared/calc.js';
import {
  Button, LinkButton, Card, PageHeader, Loading, ErrorBox, Seg, Tabs, Badge, StatusBadge, EmptyState, Callout, KV, Swatch, Stat, promptDialog,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';
import { NewMoModal } from './Production.js';

const LOT_STATUS = { open: ['In production', 'progress'], released: ['Released', 'success'], hold: ['QC hold', 'warning'], closed: ['Closed', 'neutral'] };
const QC_KEYS = Object.keys(VARIATION_SCALES);
const SHORT = { colour_var: 'Col', texture_var: 'Tex', size_var: 'Size', pits_chips: 'Pits', crazing: 'Craz', iron_spots: 'Iron' };

async function releaseLot(lot, after) {
  const notes = await promptDialog({ title: `Release lot ${lot.code}`, message: 'Pallets in quarantine become available and order lines waiting for this lot are reserved. Record who decided and why.', label: 'Decision / reason', confirmLabel: 'Release lot' });
  if (notes === null) return;
  try {
    await post(`/lots/${lot.id}/release`, { notes });
    toast(`Lot ${lot.code} released`);
    after();
  } catch (e) {
    toastError(e);
  }
}

async function holdLot(lot, after) {
  const notes = await promptDialog({ title: `Put lot ${lot.code} on hold`, message: 'Every pallet of this lot in stock is blocked until the lot is released. Reserved and shipped pallets are not changed.', label: 'Reason', confirmLabel: 'Hold lot' });
  if (notes === null) return;
  try {
    await post(`/lots/${lot.id}/hold`, { notes });
    toast(`Lot ${lot.code} on hold`, 'warning');
    after();
  } catch (e) {
    toastError(e);
  }
}

export function Quality() {
  useTitle('Quality & lots');
  const query = useQuery();
  const tab = query.get('tab') || 'holds';
  const { data, error, loading, reload } = useAsync(() => get('/qc'), []);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const fails = data.rows.filter((r) => r.result !== 'pass').length;
  return html`<div>
    <${PageHeader} overline="Factory" title="Quality & lots" sub="Every lot is checked against the Variation & Imperfection standard before it is packed" help="quality-control"
      actions=${html`<${LinkButton} href="/scan" icon="scan">Scan a lot<//>`} />
    <div class="kpis">
      <${Stat} label="Lots on hold" value=${data.holds.length} icon="alert" note=${data.holds.length ? 'Decide: release or rework' : 'Nothing blocked'} noteTone=${data.holds.length ? 'warn' : ''} />
      <${Stat} label="Inspections" value=${data.rows.length} icon="shield" note="Last 300" />
      <${Stat} label="Held at inspection" value=${fails} icon="flag" note=${data.rows.length ? `${((fails / data.rows.length) * 100).toFixed(1)} % of inspections` : ''} />
      <${Stat} label="Boxes in quarantine" value=${fmtNum(data.holds.reduce((s, h) => s + h.boxes, 0))} icon="pallet" />
    </div>
    <${Tabs} value=${tab} onChange=${(t) => setQuery({ tab: t === 'holds' ? '' : t })} tabs=${[
      { key: 'holds', label: 'On hold', count: data.holds.length },
      { key: 'inspections', label: 'Inspections' },
      { key: 'lots', label: 'All lots' },
      { key: 'standard', label: 'The standard' },
    ]} />
    ${tab === 'holds' && html`<${Holds} holds=${data.holds} reload=${reload} />`}
    ${tab === 'inspections' && html`<${Inspections} rows=${data.rows} />`}
    ${tab === 'lots' && html`<${Lots} />`}
    ${tab === 'standard' && html`<${Standard} />`}
  </div>`;
}

function Holds({ holds, reload }) {
  if (!holds.length) return html`<div class="card"><${EmptyState} icon="shield" title="No lot on hold" text="When an inspection is outside the standard, or the colour does not match the approved reference, the lot appears here and its pallets go to quarantine." kb="quality-control" /></div>`;
  return html`<div class="grid cols-2">
    ${holds.map(
      (l) => html`<div class="card card-pad">
        <div class="row between">
          <div class="row"><${Swatch} hex=${l.hex} size="lg" /><div><${Link} class="mono strong" href=${`/lots/${l.id}`}>${l.code}<//><div class="small muted">${l.sku}</div></div></div>
          ${l.boxes ? html`<${Badge} tone="warning">${fmtNum(l.boxes)} boxes in quarantine<//>` : html`<${Badge} tone="neutral">not packed yet<//>`}
        </div>
        ${l.notes && html`<div class="callout warning mt-2"><${Icon} name="alert" /><div class="callout-body small">${l.notes}</div></div>`}
        <div class="row wrap mt-2">
          <${LinkButton} size="sm" href=${`/lots/${l.id}`} icon="link">Traceability<//>
          ${can('production') && html`<${Button} size="sm" variant="primary" icon="check" onClick=${() => releaseLot(l, reload)}>Release<//>`}
        </div>
      </div>`,
    )}
  </div>`;
}

function Inspections({ rows }) {
  return html`<div class="card">
    <${DataTable}
      columns=${[
        { key: 'at', label: 'When', sort: true, render: (r) => html`<span class="small">${fmtDateTime(r.at)}</span>` },
        { key: 'lot_code', label: 'Lot', render: (r) => html`<div class="row"><${Swatch} hex=${r.hex} /><div>${r.lot_id ? html`<${Link} class="mono" href=${`/lots/${r.lot_id}`}>${r.lot_code}<//>` : '—'}<div class="cell-sub">${r.sku || ''}${r.mo_number ? ` · ${r.mo_number}` : ''}</div></div></div>` },
        { key: 'result', label: 'Result', sort: true, render: (r) => html`<${Badge} tone=${r.result === 'pass' ? 'success' : 'warning'}>${r.result === 'pass' ? 'Pass' : 'Hold'}<//>` },
        { key: 'levels', label: 'Levels seen', render: (r) => html`<span class="small mono">${QC_KEYS.filter((k) => r[k]).map((k) => `${SHORT[k]} ${r[k]}`).join(' · ') || '—'}${r.matches_reference === 0 ? html` <${Badge} tone="danger" plain>colour ≠ ref<//>` : ''}</span>` },
        { key: 'grade', label: 'A / B / rej', align: 'num', render: (r) => (r.grade_a !== null ? `${fmtNum(r.grade_a)} / ${fmtNum(r.grade_b)} / ${fmtNum(r.rejects)}` : '—') },
        { key: 'inspector', label: 'Inspector', render: (r) => html`<span class="small">${r.inspector || ''}</span>` },
      ]}
      rows=${rows}
      onRowClick=${(r) => r.lot_id && navigate(`/lots/${r.lot_id}`)}
      empty=${html`<${EmptyState} icon="shield" title="No inspections yet" text="Inspections are recorded at the sorting stage on the shop-floor screen." />`}
    />
  </div>`;
}

function Lots() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 220);
  const { data, error, loading, reload } = useAsync(() => get(`/lots${qs({ status, q: dq })}`), [status, dq]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  return html`<div class="card">
    <div class="table-toolbar">
      <div class="search"><${Icon} name="search" /><input class="input" placeholder="Lot code or SKU" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <${Seg} value=${status} onChange=${setStatus} options=${[{ value: '', label: 'All' }, ...Object.entries(LOT_STATUS).map(([value, [label]]) => ({ value, label }))]} />
    </div>
    ${loading && !data
      ? html`<${Loading} />`
      : html`<${DataTable}
          columns=${[
            { key: 'code', label: 'Lot', sort: true, render: (l) => html`<div class="row"><${Swatch} hex=${l.hex} /><div><span class="mono cell-main">${l.code}</span><div class="cell-sub">${l.sku}</div></div></div>` },
            { key: 'status', label: 'Status', render: (l) => html`<${StatusBadge} map=${LOT_STATUS} value=${l.status} />` },
            { key: 'mo_number', label: 'MO', render: (l) => (l.mo_id ? html`<${Link} class="mono" href=${`/production/mo/${l.mo_id}`}>${l.mo_number}<//>` : html`<span class="muted">—</span>`) },
            { key: 'workshop', label: 'Workshop' },
            { key: 'produced_at', label: 'Produced', sort: true, render: (l) => fmtDate(l.produced_at) },
            { key: 'boxes_on_hand', label: 'Boxes on hand', align: 'num', sort: true, render: (l) => fmtNum(l.boxes_on_hand) },
          ]}
          rows=${data.rows}
          onRowClick=${(l) => navigate(`/lots/${l.id}`)}
          empty=${html`<${EmptyState} icon="tile" title="No lots" text="A lot is created with every manufacturing order." />`}
        />`}
  </div>`;
}

function Standard() {
  const dark = allowedVariation('glazed', '#111111');
  return html`<div class="grid side">
    <${Card} title="Variation & Imperfection standard" sub="Material Specification §06" icon="shield" pad=${false}>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Characteristic</th><th>Scale</th><th class="num">Glazed</th><th class="num">Dark glazes</th><th class="num">Natural clay</th></tr></thead>
          <tbody>
            ${QC_KEYS.map(
              (k) => html`<tr>
                <td class="strong">${VARIATION_SCALES[k].label}</td>
                <td class="small">${VARIATION_SCALES[k].scale.map((s, i) => `${i + 1} ${s}`).join(' · ')}</td>
                <td class="num">≤ ${VARIATION_STANDARD.glazed[k]}</td>
                <td class="num">≤ ${dark[k]}</td>
                <td class="num">≤ ${VARIATION_STANDARD.natural[k]}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
    <//>
    <div class="stack">
      <${Callout} tone="info" title="How it is used.">At sorting, the inspector rates a sample of the batch on each scale. Anything above the standard - or a colour that does not match the approved reference - puts the lot on QC hold automatically and its pallets go to quarantine.<//>
      <${Callout} tone="warning" title="Variation is not a defect.">Handmade zellige varies in colour, size and surface by nature. The standard defines what is normal so that claims are judged against it, not against a perfect machine-made tile.<//>
      <${Button} icon="book" onClick=${() => openKb('quality-control')}>Read the QC procedure<//>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Lot traceability: one page answers "where did this batch come from and where did it go?"
// ---------------------------------------------------------------------------
export function LotDetail({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/lots/${id}`), [id]);
  useTitle(data?.lot ? `Lot ${data.lot.code}` : 'Lot');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const { lot, mo, progress, kiln_loads: kilns, qc, units, claims, totals } = data;
  const shipments = [...new Map(units.filter((u) => u.shipment_id).map((u) => [u.shipment_id, u])).values()];
  const orders = [...new Map(units.filter((u) => u.order_id).map((u) => [u.order_id, u])).values()];
  const m2 = (b) => (lot.m2_per_box ? `${fmtQty(b * lot.m2_per_box, 1)} m²` : '');
  return html`<div>
    <${PageHeader}
      back=${{ href: '/production/qc?tab=lots', label: 'Lots' }}
      overline="Lot traceability"
      title=${html`<span class="mono">${lot.code}</span> <${StatusBadge} map=${LOT_STATUS} value=${lot.status} />`}
      sub=${`${lot.sku} · ${lot.product_name}`}
      help="quality-control"
      actions=${html`<${LinkButton} href=${`/print/labels?type=box&lot=${lot.code}&format=a4-24`} icon="package">Carton labels<//>
        ${units.length > 0 && html`<${LinkButton} href=${`/labels?type=unit&ids=${units.filter((u) => ['in_stock', 'reserved', 'picked', 'hold'].includes(u.status)).map((u) => u.id).join(',')}`} icon="printer">Pallet labels<//>`}
        ${can('production') && lot.status === 'hold' && html`<${Button} variant="primary" icon="check" onClick=${() => releaseLot(lot, reload)}>Release lot<//>`}
        ${can('production') && lot.status !== 'hold' && html`<${Button} icon="alert" onClick=${() => holdLot(lot, reload)}>Put on hold<//>`}`}
    />
    ${lot.status === 'hold' && html`<div class="mb-2"><${Callout} tone="warning" title="On QC hold.">${lot.notes || 'Pallets of this lot are blocked in quarantine.'}<//></div>`}
    <div class="kpis">
      <${Stat} label="Boxes produced" value=${fmtNum(totals.boxes)} note=${m2(totals.boxes)} icon="package" />
      <${Stat} label="In stock" value=${fmtNum(totals.in_stock)} note=${m2(totals.in_stock)} icon="boxes" />
      <${Stat} label="Reserved for orders" value=${fmtNum(totals.reserved)} note=${orders.length ? `${orders.length} order(s)` : ''} icon="order" />
      <${Stat} label="Shipped" value=${fmtNum(totals.shipped)} note=${shipments.length ? `${shipments.length} shipment(s)` : ''} icon="truck" />
    </div>
    <div class="grid side">
      <div class="stack">
        <${Card} title="Batch history" icon="history">
          <div class="timeline">
            ${mo && html`<${Tl} icon="factory" title=${html`Manufacturing order <${Link} class="mono" href=${`/production/mo/${mo.id}`}>${mo.number}<//>`} meta=${`${fmtDateTime(mo.created_at)} · ${fmtNum(mo.target_pcs)} pieces started for ${fmtNum(mo.boxes_required)} boxes · ${mo.order_number ? `order ${mo.order_number} (${mo.client_name})` : 'stock'}`} />`}
            ${progress &&
            progress.routing
              .filter((s) => s.first_at)
              .map((s) => html`<${Tl} icon=${s.stage.is_kiln ? 'flame' : s.stage.is_qc ? 'shield' : s.stage.is_packing ? 'pallet' : 'hammer'} title=${html`${s.stage.name} ${s.done ? html`<${Badge} tone="success" plain>done<//>` : html`<${Badge} tone="progress" plain>in progress<//>`}`}
                meta=${`${fmtDateTime(s.first_at)}${s.last_at !== s.first_at ? ` → ${fmtDateTime(s.last_at)}` : ''} · ${fmtNum(s.good)} good${s.scrap ? ` · ${fmtNum(s.scrap)} scrap` : ''}${s.grade_b ? ` · grade B ${fmtNum(s.grade_b)}` : ''}`} />`)}
            ${shipments.map((u) => html`<${Tl} icon="truck" title=${html`Shipped in <${Link} class="mono" href=${`/shipments/${u.shipment_id}`}>${u.shipment_number}<//>`} meta=${u.client_name || ''} />`)}
            ${claims.map((c) => html`<${Tl} icon="flag" title=${html`Claim <${Link} class="mono" href=${`/claims/${c.id}`}>${c.number}<//> <${StatusBadge} map=${CLAIM_STATUSES} value=${c.status} />`} meta=${fmtDate(c.reported_at)} />`)}
            ${!mo && html`<div class="muted small">This lot was received without a manufacturing order (opening stock or purchased).</div>`}
          </div>
        <//>
        <${Card} title="Pallets & boxes" sub=${`${units.length} units`} icon="pallet" pad=${false}>
          <${DataTable}
            compact
            columns=${[
              { key: 'code', label: 'Unit', render: (u) => html`<${Link} class="mono" href=${`/stock/units/${u.id}`}>${u.code}<//><div class="cell-sub">${u.kind} · grade ${u.grade}${u.pool !== 'general' ? ` · ${POOLS[u.pool]}` : ''}</div>` },
              { key: 'boxes', label: 'Boxes', align: 'num', render: (u) => html`${fmtNum(u.boxes)}${u.loose_pcs ? html`<div class="cell-sub">+${u.loose_pcs} pcs</div>` : ''}` },
              { key: 'status', label: 'Status', render: (u) => html`<${StatusBadge} map=${UNIT_STATUSES} value=${u.status} />` },
              { key: 'location_label', label: 'Position', render: (u) => html`<span class="mono">${u.location_label || '—'}</span>` },
              { key: 'order_number', label: 'For / shipped', render: (u) => html`${u.order_id ? html`<${Link} href=${`/docs/${u.order_id}`}>${u.order_number}<//>` : ''}${u.client_name ? html`<div class="cell-sub">${u.client_name}</div>` : ''}${u.shipment_number ? html`<div class="cell-sub">${u.shipment_number}</div>` : ''}` },
            ]}
            rows=${units}
            empty=${html`<div class="muted small" style="padding:14px">Nothing packed yet.</div>`}
          />
        <//>
      </div>
      <div class="stack">
        <${Card} title="Product" icon="tile">
          <div class="row top mb-2"><img class="thumb xl" src=${lot.image_url} alt="" /><div><${Link} class="mono strong" href=${`/catalog/${lot.product_id}`}>${lot.sku}<//><div class="small">${lot.colour_name || ''}</div><div class="small muted">${lot.finish || ''} · ${lot.format_code || ''}</div></div></div>
          <${KV} items=${[
            ['Workshop', lot.workshop],
            ['Produced', fmtDate(lot.produced_at)],
            ['MO status', mo ? html`<${StatusBadge} map=${MO_STATUSES} value=${mo.status} />` : null],
            ['Scrap rate', progress ? `${progress.scrap_pct} %` : null],
          ]} />
        <//>
        <${Card} title="Kiln firings" icon="flame">
          ${kilns.length
            ? kilns.map((k) => html`<div class="mb-2">
                <div class="row"><${Link} class="mono strong" href=${`/production/kilns/load/${k.id}`}>${k.number}<//><span class="small muted" style="flex:1">${k.kiln_name}</span><${StatusBadge} map=${KILN_STATUSES} value=${k.status} /></div>
                <div class="small muted">${fmtDateTime(k.fire_start)}${k.peak_temp_c ? ` · ${fmtNum(k.peak_temp_c)} °C` : ''}${k.fuel_kg ? ` · ${fmtNum(k.fuel_kg)} kg fuel` : ''} · ${fmtNum(k.pcs_loaded)} pcs${k.pcs_defect ? `, ${fmtNum(k.pcs_defect)} defective` : ''}</div>
              </div>`)
            : html`<div class="muted small">Not fired yet.</div>`}
        <//>
        <${Card} title="QC inspections" icon="shield">
          ${qc.length
            ? qc.map((q) => html`<div class="mb-2">
                <div class="row"><${Badge} tone=${q.result === 'pass' ? 'success' : 'warning'}>${q.result === 'pass' ? 'Pass' : 'Hold'}<//><span class="small muted">${fmtDateTime(q.at)} · ${q.inspector || ''}</span></div>
                <div class="small mono mt-1">${QC_KEYS.filter((k) => q[k]).map((k) => `${SHORT[k]} ${q[k]}`).join(' · ') || 'no levels recorded'}</div>
                ${q.notes && html`<div class="small mt-1">${q.notes}</div>`}
              </div>`)
            : html`<div class="muted small">No inspection recorded.</div>`}
        <//>
      </div>
    </div>
  </div>`;
}

const Tl = ({ icon, title, meta }) => html`<div class="tl-item"><span class="tl-icon"><${Icon} name=${icon} /></span><div class="tl-body"><div class="tl-title">${title}</div><div class="tl-meta">${meta}</div></div></div>`;

// ---------------------------------------------------------------------------
// Planning: what to buy, what to make for the export reserve, who made what.
// ---------------------------------------------------------------------------
export function Planning() {
  useTitle('Planning');
  const query = useQuery();
  const tab = query.get('tab') || 'materials';
  return html`<div>
    <${PageHeader} overline="Factory" title="Planning" sub="Material needs of open MOs, reserved export stock and labour" help="production-cycle" />
    <${Tabs} value=${tab} onChange=${(t) => setQuery({ tab: t === 'materials' ? '' : t })} tabs=${[
      { key: 'materials', label: 'Materials needed' },
      { key: 'reserve', label: 'Export reserve' },
      { key: 'labour', label: 'Labour & piece work' },
    ]} />
    ${tab === 'materials' && html`<${Requirements} />`}
    ${tab === 'reserve' && html`<${Reserve} />`}
    ${tab === 'labour' && html`<${Labour} />`}
  </div>`;
}

function Requirements() {
  const { data, error, loading, reload } = useAsync(() => get('/production/requirements'), []);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const short = data.rows.filter((r) => r.short > 0);
  return html`<div class="stack">
    ${short.length > 0
      ? html`<${Callout} tone="warning" title=${`${short.length} material${short.length === 1 ? '' : 's'} short.`}>Open MOs need more than what is in stock. Order now or the batch stops at that stage.<//>`
      : data.rows.length > 0 && html`<${Callout} tone="success">Stock covers every open MO.<//>`}
    <div class="card">
      <${DataTable}
        columns=${[
          { key: 'name', label: 'Material', sort: true, render: (r) => html`<${Link} href=${`/materials/${r.material_id}`} class="cell-main">${r.name}<//><div class="cell-sub mono">${r.code}</div>` },
          { key: 'qty', label: 'Needed', align: 'num', sort: true, render: (r) => `${fmtQty(r.qty)} ${r.unit}` },
          { key: 'stock', label: 'In stock', align: 'num', render: (r) => `${fmtQty(r.stock)} ${r.unit}` },
          { key: 'short', label: 'Short', align: 'num', sort: true, render: (r) => (r.short > 0 ? html`<${Badge} tone="danger">${fmtQty(r.short)} ${r.unit}<//>` : html`<${Badge} tone="success" plain>OK<//>`) },
          { key: 'mos', label: 'For', render: (r) => html`<span class="small muted">${r.mos.slice(0, 4).join(', ')}${r.mos.length > 4 ? ` +${r.mos.length - 4}` : ''}</span>` },
          { key: 'act', label: '', align: 'right', render: (r) => (r.short > 0 && can('production') ? html`<${LinkButton} size="sm" href=${`/purchase-orders?new=1&material=${r.material_id}&qty=${Math.ceil(r.short)}`} icon="plus">Order<//>` : '') },
        ]}
        rows=${data.rows}
        empty=${html`<${EmptyState} icon="layers" title="No material needs" text="Needs come from the bill of materials of open MOs (Settings → Production → Bill of materials)." />`}
      />
    </div>
  </div>`;
}

function Reserve() {
  const { data, error, loading, reload } = useAsync(() => get('/production/reserve'), []);
  const [mo, setMo] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const gaps = data.rows.filter((r) => r.gap > 0);
  const plan = async (r) => {
    try {
      const { product } = await get(`/products/${r.id}`);
      setMo({ product, boxes: r.gap });
    } catch (e) {
      toastError(e);
    }
  };
  return html`<div class="stack">
    <${Callout} tone="info" title="Reserved export stock.">Fast-selling colours are kept in stock for small export buyers who cannot wait for production. Set the target per product in the catalogue; this list shows what to produce to refill it.<//>
    <div class="card">
      <${DataTable}
        columns=${[
          { key: 'sku', label: 'Product', sort: true, render: (r) => html`<div class="prod-cell"><img class="thumb" src=${r.image_url} alt="" /><div><${Link} class="cell-main mono" href=${`/catalog/${r.id}`}>${r.sku}<//><div class="cell-sub">${r.name}${r.fast_seller ? ' · fast seller' : ''}</div></div></div>` },
          { key: 'reserve_target_boxes', label: 'Target', align: 'num', render: (r) => fmtNum(r.reserve_target_boxes) },
          { key: 'reserve_boxes', label: 'In reserve', align: 'num', render: (r) => fmtNum(r.reserve_boxes) },
          { key: 'in_production', label: 'In production', align: 'num', render: (r) => fmtNum(r.in_production) },
          { key: 'gap', label: 'To make', align: 'num', sort: true, render: (r) => (r.gap > 0 ? html`<${Badge} tone="warning">${fmtNum(r.gap)} boxes<//>` : html`<${Badge} tone="success" plain>full<//>`) },
          { key: 'act', label: '', align: 'right', render: (r) => (r.gap > 0 && can('production') ? html`<${Button} size="sm" icon="plus" onClick=${() => plan(r)}>Create MO<//>` : '') },
        ]}
        rows=${data.rows}
        initialSort=${{ key: 'gap', dir: 'desc' }}
        empty=${html`<${EmptyState} icon="boxes" title="No reserve targets" text="Mark colours as fast sellers or set a reserve target on products in the catalogue." />`}
      />
    </div>
    ${gaps.length > 0 && html`<div class="small muted">${gaps.length} product(s) below target · ${fmtNum(gaps.reduce((s, r) => s + r.gap, 0))} boxes to produce.</div>`}
    ${mo && html`<${NewMoModal} initial=${{ product: mo.product, boxes: mo.boxes, purpose: 'export_reserve' }} onClose=${() => setMo(null)} onDone=${(m) => (setMo(null), navigate(`/production/mo/${m.id}`))} />`}
  </div>`;
}

function Labour() {
  const [range, setRange] = useState(() => ({ from: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10), to: today() }));
  const { data, error, loading, reload } = useAsync(() => get(`/production/labour${qs(range)}`), [range.from, range.to]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  const rows = data?.rows || [];
  const byWorker = new Map();
  for (const r of rows) {
    const w = byWorker.get(r.worker_id) || { worker: r.worker, good: 0, scrap: 0, pay: 0, hasPay: false };
    w.good += r.good;
    w.scrap += r.scrap;
    if (r.pay !== null) {
      w.pay += r.pay;
      w.hasPay = true;
    }
    byWorker.set(r.worker_id, w);
  }
  const cur = boot().settings?.base_currency || 'MAD';
  return html`<div class="stack">
    <div class="row wrap">
      <label class="small muted">From</label><input class="input" style="width:160px" type="date" value=${range.from} onInput=${(e) => setRange({ ...range, from: e.target.value })} />
      <label class="small muted">To</label><input class="input" style="width:160px" type="date" value=${range.to} onInput=${(e) => setRange({ ...range, to: e.target.value })} />
      <span class="small muted">Only work recorded with a worker selected is counted.</span>
    </div>
    ${loading && !data
      ? html`<${Loading} />`
      : html`<div class="grid side">
          <div class="card">
            <${DataTable}
              columns=${[
                { key: 'worker', label: 'Worker', sort: true },
                { key: 'stage', label: 'Stage' },
                { key: 'good', label: 'Good pcs', align: 'num', sort: true, render: (r) => fmtNum(r.good) },
                { key: 'scrap', label: 'Scrap', align: 'num', render: (r) => html`${fmtNum(r.scrap)}${r.good + r.scrap ? html`<div class="cell-sub">${((r.scrap / (r.good + r.scrap)) * 100).toFixed(1)} %</div>` : ''}` },
                { key: 'entries', label: 'Entries', align: 'num' },
                { key: 'pay', label: 'Piece pay', align: 'num', render: (r) => (r.pay === null ? html`<span class="muted">—</span>` : money(r.pay, cur)) },
              ]}
              rows=${rows}
              empty=${html`<${EmptyState} icon="users" title="No work recorded in this period" text="Workers are chosen on the shop-floor screen when work is recorded." />`}
            />
          </div>
          <${Card} title="Per worker" icon="users">
            ${[...byWorker.values()].map((w) => html`<div class="row small mb-1"><b style="flex:1">${w.worker}</b><span class="num">${fmtNum(w.good)} pcs</span>${w.hasPay ? html`<span class="num muted">${money(w.pay, cur)}</span>` : ''}</div>`)}
            ${!byWorker.size && html`<div class="muted small">—</div>`}
            <div class="tiny muted mt-2">Piece rates are set per worker in Settings → Production → Workers.</div>
          <//>
        </div>`}
  </div>`;
}
