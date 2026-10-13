import { useMemo, useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put, del } from '../lib/api.js';
import { useAsync, useTitle, usePref } from '../lib/hooks.js';
import { Link, navigate, useQuery, setQuery } from '../lib/router.js';
import { boot, can, toast, toastError } from '../lib/store.js';
import { uploadFile } from '../lib/image.js';
import { fmtNum, fmtQty, fmtDate, money, unitLabel } from '../lib/format.js';
import { MO_STATUSES, DOC_TYPES, CURRENCIES } from '/shared/constants.js';
import { TECH_DATA, APPLICATIONS, TRAFFIC } from '/shared/product-data.js';
import {
  Button, LinkButton, IconButton, Card, PageHeader, Loading, ErrorBox, Seg, Badge, StatusBadge, EmptyState, Callout, KV, Modal, Field, Swatch, QrImg, Toggle, confirmDialog,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';
import { ClientPicker } from '../components/Combobox.js';
import { loadProducts } from '../components/ProductPicker.js';
import { NewMoModal } from './Production.js';

const FAMILY = { zellige: 'Zellige', cement: 'Cement tiles', terracotta: 'Terracotta', other: 'Other' };

export function Catalog() {
  useTitle('Catalogue');
  const query = useQuery();
  const [view, setView] = usePref('catalog.view', 'grid');
  const [inStock, setInStock] = usePref('catalog.instock', false);
  const [edit, setEdit] = useState(null);
  const q = query.get('q') || '';
  const family = query.get('family') || '';
  const finish = query.get('finish') || '';
  const fmt = query.get('format') || '';
  const colour = query.get('colour') || '';
  const { data, error, loading, reload } = useAsync(() => get('/products'), []);
  const formats = boot().formats || [];
  const colours = (boot().colours || []).filter((c) => c.active !== 0);
  const seeCost = boot().can_see_cost;

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (data?.rows || []).filter(
      (p) =>
        (!family || p.family === family) &&
        (!finish || p.finish === finish) &&
        (!fmt || String(p.format_id) === fmt) &&
        (!colour || String(p.colour_id) === colour) &&
        (!inStock || p.available > 0) &&
        (!ql || `${p.sku} ${p.name} ${p.colour_name || ''} ${p.format_name || ''} ${p.colour_code || ''}`.toLowerCase().includes(ql)),
    ).sort((a, b) => (a.kind === 'tile' ? 0 : 1) - (b.kind === 'tile' ? 0 : 1));
  }, [data, q, family, finish, fmt, colour, inStock]);

  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  const all = data?.rows || [];
  const usedFormats = formats.filter((f) => all.some((p) => p.format_id === f.id));
  const noCost = seeCost ? all.filter((p) => p.kind === 'tile' && !p.cost).length : 0;
  return html`<div>
    <${PageHeader}
      overline="Database"
      title="Catalogue"
      sub=${`${fmtNum(all.length)} products · ${colours.length} colours · ${usedFormats.length} formats`}
      help="product-knowledge"
      actions=${html`<${LinkButton} href="/labels?type=product" icon="qr">Showroom labels<//>
        ${can() && html`<${LinkButton} href="/settings/catalogue" icon="settings">Formats & colours<//><${Button} variant="primary" icon="plus" onClick=${() => setEdit({})}>New product<//>`}`}
    />
    ${noCost > 0 && html`<div class="mb-2"><${Callout} tone="warning" title=${`${noCost} tiles have no cost price.`}>List prices are cost × tier multiplier, so these show no computed price on quotes. Set costs on the product pages or import them (Settings → Catalogue).<//></div>`}
    <div class="colour-strip mb-2" role="list" aria-label="Filter by colour">
      ${colours.map(
        (c) => html`<button type="button" role="listitem" class=${`cs ${String(c.id) === colour ? 'on' : ''}`} title=${`${c.code} ${c.name}${c.fast_seller ? ' · fast seller' : ''}`} onClick=${() => setQuery({ colour: String(c.id) === colour ? '' : c.id })}>
          <span class="cs-chip" style=${{ background: c.hex }}></span><span class="cs-code">${c.code}</span>
        </button>`,
      )}
    </div>
    <div class="card">
      <div class="table-toolbar">
        <div class="search"><${Icon} name="search" /><input class="input" placeholder="SKU, colour or format" value=${q} onInput=${(e) => setQuery({ q: e.target.value })} /></div>
        <${Seg} value=${family} onChange=${(v) => setQuery({ family: v })} options=${[{ value: '', label: 'All' }, ...Object.entries(FAMILY).filter(([k]) => all.some((p) => p.family === k)).map(([value, label]) => ({ value, label }))]} />
        <${Seg} value=${finish} onChange=${(v) => setQuery({ finish: v })} options=${[{ value: '', label: 'Any finish' }, { value: 'glazed', label: 'Glazed' }, { value: 'natural', label: 'Natural' }]} />
        <select class="select" style="width:auto;max-width:190px" value=${fmt} onChange=${(e) => setQuery({ format: e.target.value })}>
          <option value="">All formats</option>
          ${usedFormats.map((f) => html`<option value=${f.id}>${f.code} · ${f.name}</option>`)}
        </select>
        <${Toggle} checked=${inStock} onChange=${setInStock} label="Free stock only" />
        <div class="spacer"></div>
        <${Seg} value=${view} onChange=${setView} options=${[{ value: 'grid', label: 'Grid' }, { value: 'table', label: 'Table' }]} />
      </div>
      ${loading && !data
        ? html`<${Loading} />`
        : view === 'grid'
          ? html`<div class="card-pad">
              <div class="product-grid">
                ${rows.slice(0, 400).map(
                  (p) => html`<${Link} class="p-card" href=${`/catalog/${p.id}`}>
                    <img src=${p.image_url} alt="" loading="lazy" />
                    <div class="p-body">
                      <span class="p-sku">${p.sku}</span>
                      <span class="p-name">${p.colour_name || p.name}</span>
                      <span class="p-name muted">${p.format_name || p.kind}</span>
                      <span class="p-stock">
                        <span>${p.available ? `${fmtNum(p.available)} boxes free${p.available_m2 ? ` · ${fmtQty(p.available_m2, 0)} m²` : ''}` : 'Made to order'}</span>
                        ${p.fast_seller ? html`<span title="Fast seller - kept in reserved export stock">★</span>` : null}
                      </span>
                    </div>
                  <//>`,
                )}
              </div>
              ${rows.length > 400 && html`<div class="small muted mt-2">Showing 400 of ${fmtNum(rows.length)}. Narrow the filters.</div>`}
            </div>`
          : html`<${DataTable}
              columns=${[
                { key: 'sku', label: 'Product', sort: true, render: (p) => html`<div class="prod-cell"><img class="thumb" src=${p.image_url} alt="" loading="lazy" /><div><div class="cell-main mono">${p.sku}</div><div class="cell-sub">${p.name}</div></div></div>` },
                { key: 'format_code', label: 'Format', sort: true, render: (p) => p.format_name || p.kind },
                { key: 'colour_code', label: 'Colour', sort: true, render: (p) => (p.colour_code ? html`<span class="row"><${Swatch} hex=${p.hex} />${p.colour_code} ${p.colour_name}</span>` : '—') },
                { key: 'available', label: 'Free boxes', align: 'num', sort: true, render: (p) => fmtNum(p.available) },
                { key: 'reserved', label: 'Reserved', align: 'num', sort: true, render: (p) => fmtNum(p.reserved) },
                { key: 'export_reserve', label: 'Export reserve', align: 'num', render: (p) => (p.export_reserve ? fmtNum(p.export_reserve) : html`<span class="muted">—</span>`) },
                ...(seeCost ? [{ key: 'cost', label: 'Cost', align: 'num', sort: true, render: (p) => (p.cost ? money(p.cost, boot().settings?.base_currency) : html`<${Badge} tone="warning" plain>none<//>`) }] : []),
              ]}
              rows=${rows}
              onRowClick=${(p) => navigate(`/catalog/${p.id}`)}
            />`}
      ${!loading && !rows.length && html`<${EmptyState} icon="tile" title="No product matches" text="Clear the filters, or generate the colour × format matrix in Settings → Catalogue." kb="product-knowledge" />`}
    </div>
    ${edit && html`<${ProductModal} product=${edit} onClose=${() => setEdit(null)} onSaved=${(p) => (setEdit(null), loadProducts(true), navigate(`/catalog/${p.id}`))} />`}
  </div>`;
}

export function ProductModal({ product, onClose, onSaved }) {
  const isNew = !product.id;
  const [v, setV] = useState({
    sku: product.sku || '', name: product.name || '', kind: product.kind || 'tile', format_id: product.format_id || '', colour_id: product.colour_id || '',
    unit: product.unit || 'm2', cost: product.cost ?? '', reserve_target_boxes: product.reserve_target_boxes ?? 0, hs_code: product.hs_code || '',
    description: product.description || '', active: product.active ?? 1,
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const formats = boot().formats || [];
  const colours = boot().colours || [];
  const suggest = () => {
    const f = formats.find((x) => String(x.id) === String(v.format_id));
    const c = colours.find((x) => String(x.id) === String(v.colour_id));
    if (f && c) setV({ ...v, sku: v.sku || `${f.code}-${c.code}`, name: v.name || `${f.name} · ${c.code} ${c.name}`, unit: f.sell_unit || v.unit });
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...v, format_id: v.format_id || null, colour_id: v.colour_id || null, cost: v.cost === '' ? 0 : Number(v.cost), reserve_target_boxes: Number(v.reserve_target_boxes || 0) };
      if (!boot().can_see_cost) delete body.cost;
      const p = isNew ? await post('/products', body) : await put(`/products/${product.id}`, body);
      toast(isNew ? `${p.sku} created` : 'Saved');
      onSaved(p);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${isNew ? 'New product' : `Edit ${product.sku}`} size="wide" onClose=${onClose} icon="tile"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${save}>${isNew ? 'Create' : 'Save'}<//>`}>
    <div class="form-grid">
      <${Field} label="Kind"><select class="select" value=${v.kind} onChange=${set('kind')}><option value="tile">Tile (format × colour)</option><option value="custom">Custom / bespoke</option><option value="sample">Sample</option><option value="service">Service (transport, packing…)</option></select><//>
      <${Field} label="Sell unit"><select class="select" value=${v.unit} onChange=${set('unit')}>${['m2', 'pc', 'lm', 'box', 'unit'].map((u) => html`<option value=${u}>${unitLabel(u)}</option>`)}</select><//>
      <${Field} label="Format"><select class="select" value=${v.format_id} onChange=${set('format_id')} onBlur=${suggest}><option value="">—</option>${formats.map((f) => html`<option value=${f.id}>${f.code} · ${f.name}</option>`)}</select><//>
      <${Field} label="Colour"><select class="select" value=${v.colour_id} onChange=${set('colour_id')} onBlur=${suggest}><option value="">—</option>${colours.map((c) => html`<option value=${c.id}>${c.code} · ${c.name}</option>`)}</select><//>
      <${Field} label="SKU" required hint="Format code + colour code, e.g. Z10-W05"><input class="input mono" value=${v.sku} onInput=${set('sku')} onFocus=${suggest} /><//>
      <${Field} label="Name" required><input class="input" value=${v.name} onInput=${set('name')} /><//>
      ${boot().can_see_cost && html`<${Field} label=${`Cost per ${unitLabel(v.unit)} (${boot().settings?.base_currency || 'MAD'})`} hint="List prices = cost × tier multiplier × colour adjustment"><input class="input num" type="number" min="0" step="0.01" value=${v.cost} onInput=${set('cost')} /><//>`}
      <${Field} label="Export reserve target (boxes)" hint="Kept in stock for small export buyers"><input class="input num" type="number" min="0" value=${v.reserve_target_boxes} onInput=${set('reserve_target_boxes')} /><//>
      <${Field} label="HS code" hint="Customs tariff code for invoices and origin files"><input class="input mono" value=${v.hs_code} onInput=${set('hs_code')} /><//>
      <${Field} label="Status"><select class="select" value=${v.active} onChange=${set('active')}><option value="1">Active</option><option value="0">Inactive (hidden from pickers)</option></select><//>
      <${Field} label="Description" class="span-2"><textarea class="textarea" value=${v.description} onInput=${set('description')}></textarea><//>
    </div>
  <//>`;
}

export function ProductDetail({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/products/${id}`), [id]);
  const [edit, setEdit] = useState(false);
  const [mo, setMo] = useState(false);
  const [contract, setContract] = useState(false);
  useTitle(data?.product?.sku || 'Product');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const p = data.product;
  const tile = p.kind === 'tile' && p.format_id;
  const freeA = data.lots.reduce((s, l) => s + l.available, 0);
  const finishKey = p.finish === 'natural' ? 'natural' : 'glazed';
  const removePrice = async (row) => {
    if (!(await confirmDialog({ title: 'Remove price', message: `Remove the ${row.client_name ? `contract price for ${row.client_name}` : `${row.tier_name} list price`} (${money(row.price, row.currency)})?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await del(`/price-list/${row.id}`);
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  return html`<div>
    <${PageHeader}
      back=${{ href: '/catalog', label: 'Catalogue' }}
      overline=${p.format_name || p.kind}
      title=${html`<span class="mono">${p.sku}</span>${!p.active ? html` <${Badge} tone="neutral">Inactive<//>` : ''}`}
      sub=${p.name}
      help="product-knowledge"
      actions=${html`<${LinkButton} href=${`/labels?type=product&ids=${p.id}`} icon="qr">Label<//>
        <${LinkButton} href=${`/stock?tab=where&q=${encodeURIComponent(p.sku)}`} icon="pin">Where stored<//>
        ${tile && can('production') && html`<${Button} icon="factory" onClick=${() => setMo(true)}>Produce<//>`}
        ${can() && html`<${Button} variant="primary" icon="edit" onClick=${() => setEdit(true)}>Edit<//>`}`}
    />
    <div class="grid side">
      <div class="stack">
        <${Gallery} product=${p} images=${data.images} reload=${reload} />
        <${Card} title="Stock by lot" sub=${`${fmtNum(freeA)} boxes free grade A`} icon="boxes" pad=${false}
          actions=${html`<${LinkButton} size="sm" variant="ghost" href=${`/stock?q=${encodeURIComponent(p.sku)}`}>All units<//>`}>
          <${DataTable}
            compact
            columns=${[
              { key: 'lot_code', label: 'Lot', render: (l) => (l.lot_id ? html`<${Link} class="mono" href=${`/lots/${l.lot_id}`}>${l.lot_code}<//>` : html`<span class="muted">${l.lot_code}</span>`) },
              { key: 'boxes', label: 'Boxes', align: 'num', render: (l) => html`${fmtNum(l.boxes)}${l.m2 ? html`<div class="cell-sub">${fmtQty(l.m2, 1)} m²</div>` : ''}` },
              { key: 'available', label: 'Free (A)', align: 'num', render: (l) => fmtNum(l.available) },
              { key: 'reserved', label: 'Reserved', align: 'num', render: (l) => fmtNum(l.reserved) },
              { key: 'locations', label: 'Positions', render: (l) => html`<div class="row wrap" style="gap:4px">${l.locations.slice(0, 6).map((x) => html`<span class="chip mono">${x}</span>`)}${l.locations.length > 6 ? html`<span class="chip">+${l.locations.length - 6}</span>` : ''}</div>` },
            ]}
            rows=${data.lots}
            rowKey="lot_code"
            empty=${html`<div class="muted small" style="padding:14px">No stock. ${tile ? 'Made to order.' : ''}</div>`}
          />
          ${data.lots.length > 1 && html`<div class="card-pad" style="padding-top:8px"><div class="small muted"><${Icon} name="info" size="13" /> Serve each order line from one lot - different kiln loads differ in colour.</div></div>`}
        <//>
        ${data.open_mos.length > 0 &&
        html`<${Card} title="In production" icon="factory" pad=${false}>
          <${DataTable}
            compact
            columns=${[
              { key: 'number', label: 'MO', render: (m) => html`<${Link} class="mono" href=${`/production/mo/${m.id}`}>${m.number}<//>` },
              { key: 'status', label: 'Status', render: (m) => html`<${StatusBadge} map=${MO_STATUSES} value=${m.status} />` },
              { key: 'stage_name', label: 'Stage', render: (m) => m.stage_name || '—' },
              { key: 'boxes_required', label: 'Boxes', align: 'num', render: (m) => fmtNum(m.boxes_required) },
              { key: 'due_date', label: 'Due', render: (m) => fmtDate(m.due_date) },
            ]}
            rows=${data.open_mos}
          />
        <//>`}
        ${data.recent_lines.length > 0 &&
        html`<${Card} title="Recent quotes & orders" icon="file" pad=${false}>
          <${DataTable}
            compact
            columns=${[
              { key: 'number', label: 'Document', render: (l) => html`<${Link} href=${`/docs/${l.doc_id}`}>${l.number}<//><div class="cell-sub">${DOC_TYPES[l.type]?.label || l.type}</div>` },
              { key: 'client_name', label: 'Client' },
              { key: 'qty', label: 'Qty', align: 'num', render: (l) => `${fmtQty(l.qty)} ${unitLabel(l.unit)}` },
              { key: 'unit_price', label: 'Price', align: 'num', render: (l) => money(l.unit_price, l.currency) },
              { key: 'issue_date', label: 'Date', render: (l) => fmtDate(l.issue_date) },
            ]}
            rows=${data.recent_lines}
            rowKey="number"
          />
        <//>`}
        ${tile &&
        html`<${Card} title="Where it can be used" sub=${p.finish === 'natural' ? 'Natural clay' : 'Glazed'} icon="tile" pad=${false}>
          <div class="table-wrap">
            <table class="table compact">
              <tbody>
                ${APPLICATIONS.map(([app, g, n, cond]) => {
                  const v = finishKey === 'natural' ? n : g;
                  return html`<tr><td>${app}</td><td><${Badge} tone=${v === 'yes' ? 'success' : v === 'cond' ? 'warning' : 'danger'} plain>${v === 'yes' ? 'Yes' : v === 'cond' ? 'With conditions' : 'No'}<//></td><td class="small muted">${v !== 'no' ? cond : ''}</td></tr>`;
                })}
              </tbody>
            </table>
          </div>
          <div class="card-pad small muted">${TRAFFIC}</div>
        <//>`}
      </div>
      <div class="stack">
        <${Card} title="Specification" icon="ruler">
          <${KV} items=${[
            ['Format', p.format_name ? `${p.format_code} · ${p.format_name}` : null],
            ['Family', FAMILY[p.family] || p.family],
            ['Size', p.width_cm ? `${fmtQty(p.width_cm, 1)} × ${fmtQty(p.length_cm || p.width_cm, 1)} cm${p.thickness_cm ? ` · ${fmtQty(p.thickness_cm, 1)} cm thick` : ''}` : null],
            ['Colour', p.colour_code ? html`<span class="row"><${Swatch} hex=${p.hex} />${p.colour_code} · ${p.colour_name}</span>` : null],
            ['Finish', p.finish ? `${p.finish === 'natural' ? 'Natural clay (unglazed)' : 'Glazed'}${p.lead_free ? ' · lead-free' : ''}` : null],
            ['Glaze family', p.glaze_family],
            ['Pieces / m²', p.pcs_per_m2 ? fmtQty(p.pcs_per_m2, 1) : null],
            ['Pieces / box', p.pcs_per_box],
            ['m² / box', p.m2_per_box ? fmtQty(p.m2_per_box, 3) : null],
            ['kg / box', p.kg_per_box ? fmtQty(p.kg_per_box, 1) : null],
            ['Boxes / pallet', p.boxes_per_pallet],
            ['Box size', p.box_dims],
            ['Production loss', p.production_loss_pct !== null && p.production_loss_pct !== undefined ? `${p.production_loss_pct} %` : null],
            ['HS code', p.hs_code],
            ['Sold per', unitLabel(p.unit)],
            p.cost !== undefined && ['Cost', p.cost ? money(p.cost, boot().settings?.base_currency) : html`<${Badge} tone="warning" plain>not set<//>`],
            ['Export reserve target', p.reserve_target_boxes ? `${fmtNum(p.reserve_target_boxes)} boxes` : null],
          ]} />
          ${p.packing_confirmed === 0 && html`<div class="mt-2"><${Callout} tone="warning">Packing data for this format is provisional - confirm the pieces per box and box weight.<//></div>`}
          ${p.description && html`<p class="small ink2 mt-2" style="white-space:pre-wrap">${p.description}</p>`}
        <//>
        ${data.prices.length > 0 &&
        html`<${Card} title="Prices" sub=${`per ${unitLabel(p.unit)}`} icon="coins" actions=${can('sales') && html`<${Button} size="sm" icon="plus" onClick=${() => setContract(true)}>Fixed price<//>`}>
          <div class="table-wrap"><table class="table compact price-table">
            <thead><tr><th>Tier</th>${data.currencies.map((c) => html`<th class="num">${c}</th>`)}</tr></thead>
            <tbody>
              ${data.prices.map((r) => html`<tr><td>${r.tier}</td>${data.currencies.map((c) => html`<td class="num" title=${r[c]?.source || ''}>${r[c]?.price ? fmtNum(r[c].price, 2) : '—'}${r[c]?.source === 'list' ? html`<sup>*</sup>` : ''}</td>`)}</tr>`)}
            </tbody>
          </table></div>
          <div class="tiny muted mt-1">Computed from cost × tier multiplier × colour adjustment. * = fixed list price.</div>
          ${data.price_list.length > 0 &&
          html`<div class="section-title mt-3">Fixed & contract prices</div>
            ${data.price_list.map((r) => html`<div class="row small mb-1">
              <span style="flex:1" class="truncate">${r.client_name ? html`<b>${r.client_name}</b>` : r.tier_name}${r.valid_until ? html` <span class="muted">until ${fmtDate(r.valid_until)}</span>` : ''}</span>
              <span class="num strong">${money(r.price, r.currency)}</span>
              ${can('sales') && html`<${IconButton} icon="trash" label="Remove" onClick=${() => removePrice(r)} />`}
            </div>`)}`}
        <//>`}
        <${Card} title="Technical data" sub=${p.finish === 'natural' ? 'Natural' : 'Glazed'} icon="clipboard">
          ${tile
            ? html`<dl class="kv">${TECH_DATA.map((t) => html`<dt>${t.label}</dt><dd>${t[finishKey]}</dd>`)}</dl>`
            : html`<div class="muted small">Technical data applies to tiles.</div>`}
        <//>
        <${Card} title="Public QR page" icon="qr">
          <div class="row top"><${QrImg} code=${p.sku} size=${104} /><div class="small ink2">Installers and visitors who scan this code see the product, technical data and installation guide - no prices or stock. <${Link} href=${`/q/${encodeURIComponent(p.sku)}`}>Open the public page<//></div></div>
        <//>
      </div>
    </div>
    ${edit && html`<${ProductModal} product=${p} onClose=${() => setEdit(false)} onSaved=${() => (setEdit(false), loadProducts(true), reload())} />`}
    ${mo && html`<${NewMoModal} initial=${{ product: p }} onClose=${() => setMo(false)} onDone=${(m) => navigate(`/production/mo/${m.id}`)} />`}
    ${contract && html`<${PriceModal} product=${p} onClose=${() => setContract(false)} onDone=${() => (setContract(false), reload())} />`}
  </div>`;
}

function Gallery({ product, images, reload }) {
  const input = useRef();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const canEdit = can('sales', 'production');
  const upload = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      let first = !product.image_id;
      for (const f of files) {
        await uploadFile(f, { entity: 'product', entity_id: product.id, set_main: first ? 1 : 0 });
        first = false;
      }
      toast(`${files.length} image${files.length === 1 ? '' : 's'} added`);
      reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const setMain = async (img) => {
    try {
      await put(`/products/${product.id}`, { image_id: img ? img.id : null });
      loadProducts(true);
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (img) => {
    if (!(await confirmDialog({ title: 'Delete image', message: `Delete ${img.filename}? Quotes that used it fall back to the main image.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await del(`/files/${img.id}`);
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  return html`<${Card} title="Images" sub="Shown on quotes, orders, invoices and labels" icon="image">
    <div class="gallery">
      <img class="gallery-main" src=${`${product.image_url}${product.image_url.includes('?') ? '&' : '?'}v=${product.image_id || 0}`} alt=${product.sku} />
      <div class="stack sm" style="flex:1;min-width:0">
        <div class="img-strip">
          ${images.map(
            (img) => html`<div class=${`img-tile ${product.image_id === img.id ? 'main' : ''}`}>
              <img src=${`/files/${img.stored_name}`} alt=${img.filename} loading="lazy" />
              ${canEdit && html`<div class="img-actions">
                ${product.image_id !== img.id && html`<${IconButton} icon="star" label="Use as main image" variant="" onClick=${() => setMain(img)} />`}
                <${IconButton} icon="trash" label="Delete" variant="" onClick=${() => remove(img)} />
              </div>`}
            </div>`,
          )}
        </div>
        ${!images.length && html`<div class="small muted">No photo yet - a colour swatch is generated from the glaze colour and format. Add a real photo of the tile for documents and the showroom.</div>`}
        ${product.image_id && canEdit ? html`<div><${Button} size="sm" variant="ghost" onClick=${() => setMain(null)}>Use the generated swatch instead<//></div>` : ''}
        ${canEdit &&
        html`<div
          class=${`dropzone ${over ? 'over' : ''}`}
          onClick=${() => input.current.click()}
          onDragOver=${(e) => (e.preventDefault(), setOver(true))}
          onDragLeave=${() => setOver(false)}
          onDrop=${(e) => (e.preventDefault(), setOver(false), upload([...e.dataTransfer.files]))}
        >
          ${busy ? html`<span class="spinner"></span> Uploading…` : html`<${Icon} name="upload" size="18" /> Drop photos here or click to add (JPG, PNG)`}
          <input ref=${input} type="file" accept="image/*" multiple hidden onChange=${(e) => upload([...e.target.files])} />
        </div>`}
      </div>
    </div>
  <//>`;
}

function PriceModal({ product, onClose, onDone }) {
  const tiers = boot().tiers || [];
  const [mode, setMode] = useState('client');
  const [client, setClient] = useState(null);
  const [v, setV] = useState({ tier_id: tiers[0]?.id || '', currency: 'EUR', price: '', valid_until: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const go = async () => {
    setBusy(true);
    try {
      await post('/price-list', {
        product_id: product.id, currency: v.currency, price: Number(v.price), valid_until: v.valid_until || null, notes: v.notes || null,
        ...(mode === 'client' ? { client_id: client?.id } : { tier_id: Number(v.tier_id) }),
      });
      toast('Price saved');
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${`Fixed price · ${product.sku}`} onClose=${onClose} icon="coins"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} disabled=${!(Number(v.price) > 0) || (mode === 'client' && !client)} onClick=${go}>Save price<//>`}>
    <${Seg} value=${mode} onChange=${setMode} options=${[{ value: 'client', label: 'Contract price for a client' }, { value: 'tier', label: 'Fixed list price for a tier' }]} />
    <div class="form-grid mt-2">
      ${mode === 'client' ? html`<${Field} label="Client" class="span-2"><${ClientPicker} value=${client} onChange=${setClient} /><//>` : html`<${Field} label="Tier" class="span-2"><select class="select" value=${v.tier_id} onChange=${set('tier_id')}>${tiers.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select><//>`}
      <${Field} label="Currency"><select class="select" value=${v.currency} onChange=${set('currency')}>${CURRENCIES.map((c) => html`<option>${c}</option>`)}</select><//>
      <${Field} label=${`Price per ${unitLabel(product.unit)}`}><input class="input num" type="number" min="0" step="0.01" value=${v.price} onInput=${set('price')} /><//>
      <${Field} label="Valid until"><input class="input" type="date" value=${v.valid_until} onInput=${set('valid_until')} /><//>
      <${Field} label="Notes"><input class="input" value=${v.notes} onInput=${set('notes')} /><//>
    </div>
    <div class="mt-2 small muted">Contract prices win over list prices on that client's quotes. A buyer is invoiced in one currency only.</div>
  <//>`;
}
