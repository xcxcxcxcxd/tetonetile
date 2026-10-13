import { useEffect, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, qs } from '../lib/api.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import { navigate, useQuery } from '../lib/router.js';
import { boot } from '../lib/store.js';
import { fmtNum, fmtQty, fmtDate } from '../lib/format.js';
import { Button, Card, PageHeader, Loading, ErrorBox, Field, Callout } from '../components/ui.js';
import { Icon } from '../components/icons.js';
import { ProductPicker } from '../components/ProductPicker.js';

// Sheet templates (mm). th-* are thermal rolls: one label per page.
const TEMPLATES = {
  'a4-24': { name: 'A4 · 24 labels 70 × 37 mm', page: 'A4', cols: 3, w: 70, h: 37.12 },
  'a4-8': { name: 'A4 · 8 labels 105 × 74 mm', page: 'A4', cols: 2, w: 105, h: 74.25 },
  'a4-4': { name: 'A4 · 4 labels A6 105 × 148 mm', page: 'A4', cols: 2, w: 105, h: 148.5 },
  'a4-2': { name: 'A4 · 2 cards A5 210 × 148 mm', page: 'A4', cols: 1, w: 210, h: 148.5 },
  'a4-1': { name: 'A4 poster', page: 'A4', cols: 1, w: 210, h: 297 },
  'th-100x150': { name: 'Thermal 100 × 150 mm', page: '100mm 150mm', cols: 1, w: 100, h: 150, thermal: true },
  'th-100x50': { name: 'Thermal 100 × 50 mm', page: '100mm 50mm', cols: 1, w: 100, h: 50, thermal: true },
};

// Every label type: where it goes in the factory and what scanning it does.
export const LABEL_TYPES = {
  location: { title: 'Rack & floor locations', icon: 'pin', where: 'On the beam under every pallet position, the front of every floor lane, every shelf bin.', scan: 'Shows what is stored there; finishes a put-away; starts a count.', templates: ['a4-24', 'a4-8', 'th-100x50'] },
  unit: { title: 'Pallets & box groups', icon: 'pallet', where: 'Two labels per pallet (front and side), on the stretch film. One per box group on shelves.', scan: 'Product, lot, boxes, position and order; move, pick or load it.', templates: ['a4-4', 'th-100x150', 'a4-8'] },
  box: { title: 'Carton labels (per lot)', icon: 'package', where: 'On every carton at the packing station. Travels to the client and the installer.', scan: 'Installers see the product, lot and installation & care guide. Staff see the lot traceability.', templates: ['a4-24', 'th-100x50', 'a4-8'] },
  mo: { title: 'Production cards (MO travellers)', icon: 'factory', where: 'Clipped to the batch: drying rack, glazing table, kiln trolley, chiselling bench.', scan: 'Opens the shop-floor screen to record pieces done and scrap at the current stage.', templates: ['a4-2'] },
  kiln: { title: 'Kiln stations', icon: 'flame', where: 'On each kiln door.', scan: 'Load, fire, cool and unload the kiln; log fuel and temperature.', templates: ['a4-2', 'a4-8'] },
  material: { title: 'Raw material bays', icon: 'layers', where: 'On clay bays, glaze drums, olive-pit store, carton and pallet stacks.', scan: 'Stock level, receive a delivery or record what was used.', templates: ['a4-8', 'a4-24'] },
  product: { title: 'Showroom & sample boards', icon: 'tile', where: 'Next to each sample on the showroom wall and on sample boxes sent to clients.', scan: 'Public product page: specs, applications, installation - and staff see stock.', templates: ['a4-8', 'a4-4'] },
  sop: { title: 'Procedure posters', icon: 'book', where: 'At each workstation: packing, kilns, dispatch, warehouse entrance, office.', scan: 'Opens the step-by-step procedure from the knowledge panel on the phone.', templates: ['a4-1'] },
  shipment: { title: 'Loading sheets', icon: 'truck', where: 'At the dispatch door while a container or truck is loaded.', scan: 'Opens scan-to-load: every pallet is checked against the order before it goes in.', templates: ['a4-1'] },
};

export function LabelCenter() {
  useTitle('QR labels');
  const query = useQuery();
  const [type, setType] = useState(query.get('type') || 'location');
  const [template, setTemplate] = useState('');
  const [zone, setZone] = useState(query.get('zone_id') || '');
  const [copies, setCopies] = useState(1);
  const [products, setProducts] = useState([]);
  const [picker, setPicker] = useState(false);
  const [sopIds, setSopIds] = useState([]);
  const [moId, setMoId] = useState('');
  const [shipId, setShipId] = useState('');
  const [lotCode, setLotCode] = useState('');
  const kb = useAsync(() => (type === 'sop' ? get('/knowledge') : null), [type]);
  const mos = useAsync(() => (type === 'mo' ? get('/mos?status=open') : null), [type]);
  const ships = useAsync(() => (type === 'shipment' ? get('/shipments?status=open') : null), [type]);
  const zones = boot().zones || [];
  const whs = boot().warehouses || [];
  const T = LABEL_TYPES[type];
  const tpl = template && T.templates.includes(template) ? template : T.templates[0];

  // Pre-filled links (from the map, MO page, etc.) go straight to the preview.
  const direct = !!(query.get('ids') || query.get('lot') || query.get('warehouse_id') || (query.get('zone_id') && query.get('type')));
  useEffect(() => {
    if (!direct) return;
    const p = new URLSearchParams(location.search);
    if (!p.get('format')) p.set('format', (LABEL_TYPES[p.get('type')] || T).templates[0]);
    navigate(`/print/labels?${p.toString()}`, { replace: true });
  }, [direct]);
  if (direct) return html`<${Loading} />`;

  const go = () => {
    const p = { type, format: tpl, copies };
    if (type === 'location') Object.assign(p, zone ? { zone_id: zone } : { warehouse_id: whs[0]?.id });
    if (type === 'product') p.ids = products.map((x) => x.id).join(',');
    if (type === 'sop') p.ids = sopIds.join(',');
    if (type === 'mo') p.ids = moId;
    if (type === 'shipment') p.ids = shipId;
    if (type === 'kiln') p.ids = (boot().kilns || []).map((k) => k.id).join(',');
    if (type === 'material') p.ids = 'all';
    if (type === 'box') p.lot = lotCode.trim().toUpperCase();
    navigate(`/print/labels${qs(p)}`);
  };

  return html`<div>
    <${PageHeader} overline="QR" title="QR labels" sub="Print labels for every place and thing in the factory - scanning any of them shows what it is and what to do next." help="qr-codes" />
    <div class="grid side-l">
      <div class="stack sm">
        ${Object.entries(LABEL_TYPES).map(([k, t]) => html`<button class=${`scan-mode ${type === k ? 'on' : ''}`} style="width:100%" onClick=${() => (setType(k), setTemplate(''))}>
          <span class="row"><${Icon} name=${t.icon} /><b>${t.title}</b></span>
        </button>`)}
      </div>
      <div class="stack">
        <${Card} title=${T.title} icon=${T.icon}>
          <div class="grid cols-2 mb-3">
            <div class="callout"><${Icon} name="pin" /><div class="callout-body"><b>Where it goes</b><div class="small">${T.where}</div></div></div>
            <div class="callout"><${Icon} name="scan" /><div class="callout-body"><b>Scanning it</b><div class="small">${T.scan}</div></div></div>
          </div>
          <div class="form-grid">
            <${Field} label="Label sheet"><select class="select" value=${tpl} onChange=${(e) => setTemplate(e.target.value)}>${T.templates.map((k) => html`<option value=${k}>${TEMPLATES[k].name}</option>`)}</select><//>
            ${['unit', 'location', 'product', 'material'].includes(type) && html`<${Field} label="Copies of each"><input class="input num" type="number" min="1" max="10" value=${copies} onInput=${(e) => setCopies(e.target.value)} /><//>`}
            ${type === 'location' && html`<${Field} label="Which locations" class="span-2"><select class="select" value=${zone} onChange=${(e) => setZone(e.target.value)}>
              <option value="">All of ${whs[0]?.name || 'the main warehouse'}</option>
              ${whs.map((w) => html`<optgroup label=${w.name}>${zones.filter((z) => z.warehouse_id === w.id).map((z) => html`<option value=${z.id}>${w.code} · ${z.code} ${z.name}</option>`)}</optgroup>`)}
            </select><//>`}
            ${type === 'product' && html`<${Field} label="Products" class="span-2"><div class="row wrap">${products.map((p) => html`<span class="chip"><img class="thumb sm" src=${p.image_url} alt="" />${p.sku}</span>`)}<${Button} size="sm" icon="plus" onClick=${() => setPicker(true)}>Choose products<//></div><//>`}
            ${type === 'sop' && html`<${Field} label="Procedures" class="span-2"><div class="stack sm">${(kb.data?.rows || []).map((a) => html`<label class="check"><input type="checkbox" checked=${sopIds.includes(a.id)} onChange=${(e) => setSopIds((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))} />${a.title}</label>`)}</div><//>`}
            ${type === 'mo' && html`<${Field} label="Manufacturing order" class="span-2"><select class="select" value=${moId} onChange=${(e) => setMoId(e.target.value)}><option value="">Choose…</option>${(mos.data?.rows || []).map((m) => html`<option value=${m.id}>${m.number} · ${m.sku} · ${m.status}</option>`)}</select><//>`}
            ${type === 'shipment' && html`<${Field} label="Shipment" class="span-2"><select class="select" value=${shipId} onChange=${(e) => setShipId(e.target.value)}><option value="">Choose…</option>${(ships.data?.rows || []).map((s) => html`<option value=${s.id}>${s.number} · ${s.client_name || ''} · ${s.status}</option>`)}</select><//>`}
            ${type === 'box' && html`<${Field} label="Lot code" class="span-2" hint="One label per carton - the number of copies is the lot's box count."><input class="input" style="font-family:var(--mono)" value=${lotCode} onInput=${(e) => setLotCode(e.target.value)} placeholder="L26-0007" /><//>`}
          </div>
          <div class="row mt-3"><span class="spacer"></span><${Button} variant="primary" icon="printer" onClick=${go}>Preview & print<//></div>
        <//>
        <${Callout} tone="info" title="Labels that last in a tile factory:">use waterproof polyester or thermal-transfer labels (not paper) for racks and pallets; laminate the A5 production cards. Print location labels once; pallet and carton labels are printed by the packing station as production is packed.<//>
      </div>
    </div>
    ${picker && html`<${ProductPicker} multi title="Products for showroom cards" onPick=${(ps) => (setProducts(ps), setPicker(false))} onClose=${() => setPicker(false)} />`}
  </div>`;
}

const qr = (code) => `/api/qr.svg?code=${encodeURIComponent(code)}&margin=0`;

export function PrintLabels() {
  const query = useQuery();
  const type = query.get('type') || 'location';
  const T = LABEL_TYPES[type] || LABEL_TYPES.location;
  const fmt = TEMPLATES[query.get('format')] ? query.get('format') : T.templates[0];
  const copies = Math.max(1, Math.min(10, Number(query.get('copies')) || 1));
  const ids = (query.get('ids') || '').split(',').filter(Boolean);
  useTitle('Print labels');
  const { data, error, loading } = useAsync(() => loadLabelData(type, query, ids), [location.search]);
  if (error) return html`<div class="content"><${ErrorBox} error=${error} /></div>`;
  if (loading || !data) return html`<${Loading} />`;
  const tp = TEMPLATES[fmt];
  const items = data.flatMap((d) => Array.from({ length: type === 'box' ? 1 : copies }, () => d));
  const perPage = tp.thermal ? 1 : tp.cols * Math.floor(297 / tp.h);
  const pages = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  const pageCss = `@page { size: ${tp.page}; margin: 0; } @media print { .label-sheet { page-break-after: always; break-after: page; } }`;
  return html`<div class="print-page">
    <style>${pageCss}</style>
    <div class="print-toolbar">
      <a class="btn sm" href="/labels"><${Icon} name="arrowLeft" />Labels</a>
      <span class="pt-title">${T.title} · ${items.length} label${items.length === 1 ? '' : 's'} · ${tp.name}</span>
      <span class="muted small hide-sm">Print at 100 % (no "fit to page"), margins: none.</span>
      <${Button} variant="primary" icon="printer" onClick=${() => window.print()}>Print<//>
    </div>
    ${!items.length && html`<div class="content"><${Callout} tone="warning">Nothing to print for this selection.<//></div>`}
    ${pages.map((pg) => html`<div class="label-sheet" style=${{ width: tp.thermal ? `${tp.w}mm` : '210mm', height: tp.thermal ? `${tp.h}mm` : '297mm', gridTemplateColumns: `repeat(${tp.cols}, ${tp.w}mm)`, gridAutoRows: `${tp.h}mm`, alignContent: 'start' }}>
      ${pg.map((d) => html`<div class="label outline" style=${{ width: `${tp.w}mm`, height: `${tp.h}mm` }}>${renderLabel(type, d, tp)}</div>`)}
    </div>`)}
  </div>`;
}

async function loadLabelData(type, query, ids) {
  const zones = boot().zones || [];
  const whs = boot().warehouses || [];
  if (type === 'location') {
    const params = query.get('zone_id') ? { zone_id: query.get('zone_id') } : {};
    const rows = (await get(`/locations${qs({ ...params, limit: 5000 })}`)).rows;
    const whId = Number(query.get('warehouse_id'));
    return rows
      .filter((l) => !ids.length || ids.includes(String(l.id)))
      .filter((l) => !whId || zones.find((z) => z.id === l.zone_id)?.warehouse_id === whId)
      .map((l) => {
        const z = zones.find((x) => x.id === l.zone_id) || {};
        return { ...l, zone: z, warehouse: whs.find((w) => w.id === z.warehouse_id) || {} };
      });
  }
  if (type === 'unit') return (await get(`/stock/units${qs({ ids: ids.join(',') })}`)).rows;
  if (type === 'box') {
    let lot = null;
    if (query.get('lot')) {
      const r = await get(`/resolve/${encodeURIComponent(query.get('lot'))}`);
      if (r.type !== 'lot') throw new Error(`${query.get('lot')} is not a lot code.`);
      lot = await get(`/lots/${r.id}`);
    } else if (ids[0]) lot = await get(`/lots/${ids[0]}`);
    if (!lot) return [];
    const product = (await get(`/products/${lot.lot.product_id}`)).product;
    const n = Number(query.get('count')) || Math.max(1, lot.totals.boxes);
    return Array.from({ length: n }, () => ({ lot: lot.lot, product }));
  }
  if (type === 'mo') return Promise.all(ids.map((id) => get(`/mos/${id}`)));
  if (type === 'kiln') return (boot().kilns || []).filter((k) => !ids.length || ids.includes(String(k.id)));
  if (type === 'material') return (await get('/materials')).rows.filter((m) => !ids.length || ids[0] === 'all' || ids.includes(String(m.id)));
  if (type === 'product') return (await get('/products')).rows.filter((p) => ids.includes(String(p.id)));
  if (type === 'sop') return Promise.all(ids.map((id) => get(`/knowledge/${id}`)));
  if (type === 'shipment') return Promise.all(ids.map((id) => get(`/shipments/${id}`)));
  return [];
}

const BRAND = () => ((boot().entities || [])[0]?.brand || 'ZELLIGERAR').toUpperCase();

function renderLabel(type, d, tp) {
  const small = tp.h < 60;
  switch (type) {
    case 'location': {
      const q = Math.min(tp.h - 6, tp.w * 0.42);
      return html`<div style=${{ display: 'flex', height: '100%', padding: '3mm 3mm 3mm 6mm', gap: '3mm', alignItems: 'center' }}>
        <span class="l-strip" style=${{ background: d.zone.color || '#2f6f5e' }}></span>
        <img class="l-qr" src=${qr(d.code)} style=${{ width: `${q}mm`, height: `${q}mm` }} alt="" />
        <div style="min-width:0">
          <div class="l-code" style=${{ fontSize: small ? '17pt' : '30pt' }}>${d.label}</div>
          <div class="l-small" style="margin-top:1mm"><b>${d.zone.name || ''}</b></div>
          <div class="l-small">${[d.rack && `Rack ${d.rack}`, d.level && `Level ${d.level}`, d.position && `Pos. ${d.position}`].filter(Boolean).join(' · ')}</div>
          <div class="l-small" style="margin-top:1mm;opacity:.7">${d.warehouse.code} · ${d.code}</div>
        </div>
      </div>`;
    }
    case 'unit': {
      const big = tp.h >= 140;
      return html`<div style=${{ padding: big ? '6mm' : '3mm', height: '100%', display: 'flex', flexDirection: 'column', gap: big ? '3mm' : '1.5mm' }}>
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="l-brand">${BRAND()}</span><span class="l-small"><b>${d.kind === 'material' ? 'RAW MATERIAL' : d.kind === 'boxes' ? 'BOXES' : 'PALLET'}</b></span></div>
        <div style="display:flex;gap:3mm;align-items:center">
          <img class="l-qr" src=${qr(d.code)} style=${{ width: big ? '46mm' : '30mm', height: big ? '46mm' : '30mm' }} alt="" />
          <div style="min-width:0">
            <div class="l-code" style=${{ fontSize: big ? '20pt' : '13pt' }}>${d.code}</div>
            <div class="l-code" style=${{ fontSize: big ? '15pt' : '10pt', marginTop: '2mm' }}>${d.sku || d.material_code}</div>
            <div class="l-small" style="margin-top:1mm">${d.colour_code ? `${d.colour_code} ${d.colour_name}` : d.material_name || ''}</div>
            <div class="l-small">${d.format_name || ''}</div>
          </div>
        </div>
        ${d.kind !== 'material'
          ? html`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.5mm;font-size:${big ? '9pt' : '7pt'}">
              <div style="border:0.3mm solid #000;border-radius:1mm;padding:1mm 1.5mm"><div style="font-size:6pt">LOT</div><b class="l-code" style=${{ fontSize: big ? '13pt' : '9pt' }}>${d.lot_code || '—'}</b></div>
              <div style="border:0.3mm solid #000;border-radius:1mm;padding:1mm 1.5mm"><div style="font-size:6pt">BOXES</div><b style=${{ fontSize: big ? '15pt' : '10pt' }}>${d.boxes}</b>${d.loose_pcs ? ` +${d.loose_pcs}pc` : ''}</div>
              <div style="border:0.3mm solid #000;border-radius:1mm;padding:1mm 1.5mm"><div style="font-size:6pt">GRADE</div><b style=${{ fontSize: big ? '15pt' : '10pt' }}>${d.grade}</b></div>
              <div style="padding:0 1.5mm"><div style="font-size:6pt">m²</div><b>${d.m2 ? fmtQty(d.m2) : '—'}</b></div>
              <div style="padding:0 1.5mm"><div style="font-size:6pt">PIECES</div><b>${d.pieces ? fmtNum(d.pieces) : '—'}</b></div>
              <div style="padding:0 1.5mm"><div style="font-size:6pt">NET KG</div><b>${d.weight_kg ? fmtNum(d.weight_kg) : '—'}</b></div>
            </div>`
          : html`<div class="l-code" style="font-size:16pt">${fmtQty(d.qty)} ${d.material_unit}</div>`}
        ${d.order_number && html`<div style="border:0.5mm solid #000;padding:1mm 2mm;font-size:${big ? '10pt' : '7pt'}"><b>FOR ${d.order_number}</b> · ${d.order_client || ''}</div>`}
        <div class="l-small" style="margin-top:auto;display:flex;justify-content:space-between;gap:2mm"><b>FRAGILE · HANDMADE TILES</b><span>Blend all boxes before laying</span></div>
      </div>`;
    }
    case 'box': {
      const p = d.product;
      const q = Math.min(tp.h - 6, 30);
      return html`<div style="display:flex;gap:2.5mm;height:100%;padding:2.5mm 3mm;align-items:center">
        <img class="l-qr" src=${qr(d.lot.code)} style=${{ width: `${q}mm`, height: `${q}mm` }} alt="" />
        <div style="min-width:0;flex:1">
          <div class="l-brand">${BRAND()}</div>
          <div class="l-code" style=${{ fontSize: small ? '12pt' : '16pt', marginTop: '0.5mm' }}>${p.sku}</div>
          <div class="l-small" style="display:flex;align-items:center;gap:1.5mm"><span class="l-swatch" style=${{ background: p.hex || '#ccc', width: '3mm', height: '3mm', display: 'inline-block' }}></span>${p.colour_code} ${p.colour_name}</div>
          <div class="l-small">${p.format_name}</div>
          <div class="l-code" style=${{ fontSize: small ? '10pt' : '13pt', marginTop: '0.8mm' }}>LOT ${d.lot.code}</div>
          <div class="l-small">${p.pcs_per_box} pcs · ${fmtQty(p.m2_per_box)} m² · ≈ ${p.kg_per_box} kg</div>
          <div class="l-small" style="opacity:.75">Scan: installation guide · lot info</div>
        </div>
      </div>`;
    }
    case 'mo': {
      const mo = d.mo;
      return html`<div style="padding:7mm;height:100%;display:flex;flex-direction:column;gap:3mm;font-size:8.5pt">
        <div style="display:flex;gap:4mm;align-items:flex-start">
          <img class="l-qr" src=${qr(mo.number)} style="width:30mm;height:30mm" alt="" />
          <img src=${mo.image_url} style="width:30mm;height:30mm;object-fit:cover;border-radius:1.5mm;border:0.3mm solid #000" alt="" />
          <div style="flex:1;min-width:0">
            <div class="l-brand">${BRAND()} · PRODUCTION CARD</div>
            <div class="l-code" style="font-size:20pt;margin-top:1mm">${mo.number}</div>
            <div style="font-size:12pt;font-weight:700;margin-top:1mm">${mo.sku} · ${mo.colour_name || ''}</div>
            <div>${mo.format_name || ''} · lot <b class="l-code">${mo.lot_code}</b></div>
            <div style="margin-top:1mm">Start <b>${fmtNum(mo.target_pcs)} pcs</b> → ${fmtNum(mo.boxes_required)} boxes · due <b>${fmtDate(mo.due_date)}</b>${mo.order_number ? html` · for <b>${mo.order_number}</b> ${mo.client_name || ''}` : ''}</div>
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:8pt">
          <thead><tr>${['Stage', 'Date', 'Good pcs', 'Scrap', 'Worker'].map((h) => html`<th style="border:0.3mm solid #000;padding:1mm 1.5mm;text-align:left">${h}</th>`)}</tr></thead>
          <tbody>${d.progress.routing.map((s) => html`<tr><td style="border:0.3mm solid #000;padding:1.2mm 1.5mm;width:38%"><b>${s.stage.name}</b><div style="font-size:6.5pt;opacity:.75">${(s.stage.instructions || '').slice(0, 90)}</div></td>${[1, 2, 3, 4].map(() => html`<td style="border:0.3mm solid #000"></td>`)}</tr>`)}</tbody>
        </table>
        <div style="font-size:7pt;margin-top:auto">Keep this card with the batch. Scan the QR at each stage to record pieces and scrap - one colour batch per card; never mix lots.</div>
      </div>`;
    }
    case 'kiln':
      return html`<div style="padding:10mm;height:100%;display:flex;gap:8mm;align-items:center">
        <img class="l-qr" src=${qr(`KILN-${d.code}`)} style=${{ width: `${Math.min(tp.h - 20, 90)}mm`, height: `${Math.min(tp.h - 20, 90)}mm` }} alt="" />
        <div><div class="l-brand">${BRAND()} · KILN STATION</div><div style="font-size:32pt;font-weight:800">${d.name}</div><div class="l-small" style="font-size:10pt;margin-top:3mm">Scan when you load, start firing, and unload.<br />Log the olive-pit fuel and the peak temperature.<br />Colour varies between kiln loads - record every load.</div></div>
      </div>`;
    case 'material':
      return html`<div style="display:flex;gap:3mm;height:100%;padding:3mm;align-items:center">
        <img class="l-qr" src=${qr(d.code)} style=${{ width: `${Math.min(tp.h - 6, 40)}mm`, height: `${Math.min(tp.h - 6, 40)}mm` }} alt="" />
        <div style="min-width:0"><div class="l-brand">${BRAND()} · RAW MATERIAL</div><div class="l-code" style=${{ fontSize: small ? '14pt' : '20pt' }}>${d.code}</div><div class="l-small" style="font-size:9pt">${d.name}</div><div class="l-small">Unit: ${d.unit}${d.min_stock ? ` · reorder below ${fmtNum(d.min_stock)}` : ''}</div></div>
      </div>`;
    case 'product':
      return html`<div style="display:flex;gap:3mm;height:100%;padding:4mm;align-items:center">
        <img src=${d.image_url} style="width:32mm;height:32mm;object-fit:cover;border-radius:1.5mm" alt="" />
        <div style="min-width:0;flex:1"><div class="l-brand">${BRAND()}</div><div style="font-size:13pt;font-weight:800;margin-top:1mm">${d.colour_name || d.name}</div><div class="l-small" style="font-size:8pt">${d.format_name || ''}</div><div class="l-code" style="font-size:10pt;margin-top:1mm">${d.sku}</div><div class="l-small" style="margin-top:1mm">Scan for specs, applications<br />and the installation guide</div></div>
        <img class="l-qr" src=${qr(d.sku)} style="width:24mm;height:24mm" alt="" />
      </div>`;
    case 'sop': {
      const steps = (d.body.match(/^\d+\.\s+.+$/gm) || []).slice(0, 9).map((l) => l.replace(/^\d+\.\s+/, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
      return html`<div style="padding:16mm;height:100%;display:flex;flex-direction:column;gap:6mm">
        <div class="l-brand" style="font-size:9pt">${BRAND()} · PROCEDURE</div>
        <div style="font-size:30pt;font-weight:800;line-height:1.1">${d.title}</div>
        <div style="font-size:12pt">${d.summary}</div>
        ${steps.length > 0 && html`<ol style="font-size:13pt;line-height:1.5;padding-left:8mm;margin:0">${steps.map((s) => html`<li>${s}</li>`)}</ol>`}
        <div style="margin-top:auto;display:flex;gap:8mm;align-items:center"><img class="l-qr" src=${qr(`KB-${d.id}`)} style="width:60mm;height:60mm" alt="" /><div style="font-size:14pt;font-weight:700">Scan with your phone<br />for the full procedure</div></div>
      </div>`;
    }
    case 'shipment':
      return html`<div style="padding:14mm;height:100%;display:flex;flex-direction:column;gap:4mm;font-size:9pt">
        <div style="display:flex;gap:6mm;align-items:center"><img class="l-qr" src=${qr(d.number)} style="width:45mm;height:45mm" alt="" />
          <div><div class="l-brand">${BRAND()} · LOADING SHEET</div><div class="l-code" style="font-size:24pt">${d.number}</div><div style="font-size:11pt">${d.client_name || ''} · ${d.orders.map((o) => o.number).join(', ')}</div><div>${d.container_no ? `Container ${d.container_no}` : ''} ${d.seal_no ? `· Seal ${d.seal_no}` : ''}</div><div style="margin-top:2mm"><b>Scan this QR, then scan every pallet as it goes in.</b> Wrong pallets are refused.</div></div></div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>${['✓', 'Pallet', 'SKU', 'Lot', 'Boxes', 'Position'].map((h) => html`<th style="border-bottom:0.5mm solid #000;text-align:left;padding:1mm">${h}</th>`)}</tr></thead>
          <tbody>${d.units.map((u) => html`<tr><td style="padding:1.2mm;border-bottom:0.2mm solid #999">☐</td><td class="l-code" style="padding:1.2mm;border-bottom:0.2mm solid #999">${u.code}</td><td style="border-bottom:0.2mm solid #999">${u.sku}</td><td style="border-bottom:0.2mm solid #999">${u.lot_code || ''}</td><td style="border-bottom:0.2mm solid #999">${u.boxes}</td><td style="border-bottom:0.2mm solid #999">${u.location_label || u.status}</td></tr>`)}</tbody>
        </table>
      </div>`;
    default:
      return null;
  }
}
