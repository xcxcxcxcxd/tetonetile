import { html } from '../lib/html.js';
import { get } from '../lib/api.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import { boot } from '../lib/store.js';
import { money, fmtDate, fmtNum, fmtQty, unitLabel, fmtDateTime } from '../lib/format.js';
import { toSqft, toLb } from '/shared/calc.js';
import { DOC_TYPES, SHIPMENT_MODES, DEFAULT_TERMS } from '/shared/constants.js';
import { Loading, ErrorBox, Button } from '../components/ui.js';
import { Icon } from '../components/icons.js';

const TITLE = { quote: 'Quotation', order: 'Order confirmation', proforma: 'Proforma invoice', invoice: 'Invoice', credit: 'Credit note' };

function Toolbar({ title, back }) {
  return html`<div class="print-toolbar">
    ${back && html`<a class="btn sm" href=${back}><${Icon} name="arrowLeft" />Back</a>`}
    <span class="pt-title">${title}</span>
    <span class="muted small hide-sm">Use "Save as PDF" in the print dialog to send it.</span>
    <${Button} variant="primary" icon="printer" onClick=${() => window.print()}>Print / Save PDF<//>
  </div>`;
}

function Brand({ entity }) {
  const e = entity || {};
  const name = (e.brand || e.name || 'Zelligerar').toUpperCase();
  return html`<div class="dp-brand">
    <svg class="dp-logo" viewBox="0 0 32 32" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="2" fill="#e8dcc3"/><rect x="17" y="1" width="14" height="14" rx="2" fill="#d9a441"/><rect x="1" y="17" width="14" height="14" rx="2" fill="#c4683f"/><rect x="17" y="17" width="14" height="14" rx="2" fill="#2f6f5e"/></svg>
    <div>
      <div class="dp-brandname">${name}</div>
      <div class="dp-tagline">${e.footer_note || 'Handmade Moroccan zellige'}</div>
      <div class="dp-company">
        ${e.brand && e.name && e.brand !== e.name ? html`<b>${e.name}</b><br />` : null}
        ${[e.address, [e.city, e.country].filter(Boolean).join(', ')].filter(Boolean).map((x) => html`${x}<br />`)}
        ${[e.phone, e.email, e.website].filter(Boolean).join(' · ')}
      </div>
    </div>
  </div>`;
}

function LegalFooter({ entity, page }) {
  const e = entity || {};
  const ids = [e.ice && `ICE ${e.ice}`, e.if_number && `IF ${e.if_number}`, e.rc && `RC ${e.rc}`, e.patente && `Patente ${e.patente}`, e.cnss && `CNSS ${e.cnss}`, e.capital && `Capital ${e.capital}`, e.vat_number && `VAT ${e.vat_number}`].filter(Boolean);
  return html`<div class="dp-foot">
    <div>${e.name}${ids.length ? html` · ${ids.join(' · ')}` : ''}</div>
    <div>${page || ''}</div>
  </div>`;
}

export function PrintDoc({ id }) {
  const { data: d, error, loading } = useAsync(() => get(`/docs/${id}`), [id]);
  useTitle(d ? `${d.number} ${d.client_name}` : 'Print');
  if (error) return html`<div class="content"><${ErrorBox} error=${error} /></div>`;
  if (loading || !d) return html`<${Loading} />`;
  const e = d.entity || {};
  const c = d.client || {};
  const us = d.client_region === 'US';
  const terms = boot().settings?.terms?.length ? boot().settings.terms : DEFAULT_TERMS;
  const showTerms = ['quote', 'order', 'proforma'].includes(d.type);
  const showBank = ['proforma', 'invoice', 'order'].includes(d.type) && (e.iban || e.bank_account);
  const stamp = d.status === 'cancelled' ? 'CANCELLED' : d.display_status === 'paid' ? 'PAID' : d.status === 'draft' ? 'DRAFT' : null;
  const dueLabel = d.type === 'quote' ? 'Valid until' : d.type === 'order' ? 'Requested delivery' : 'Due date';
  const kbUrl = `${boot().settings?.public_url_effective || location.origin}/q/KB-installation-care`;

  return html`<div class="print-page">
    <${Toolbar} title=${`${TITLE[d.type]} ${d.number}`} back=${`/docs/${d.id}`} />
    <div class="sheet doc-print">
      <div class="dp-head">
        <${Brand} entity=${e} />
        <div class="dp-type">
          <h1>${TITLE[d.type]}</h1>
          <div class="dp-num">${d.number}</div>
          <table>
            <tr><td>Date</td><td>${fmtDate(d.issue_date)}</td></tr>
            ${d.valid_until && html`<tr><td>${dueLabel}</td><td>${fmtDate(d.valid_until)}</td></tr>`}
            ${d.client_ref && html`<tr><td>Your reference</td><td>${d.client_ref}</td></tr>`}
            ${d.source_number && html`<tr><td>Based on</td><td>${d.source_number}</td></tr>`}
            ${d.order_number && d.order_number !== d.source_number && html`<tr><td>Order</td><td>${d.order_number}</td></tr>`}
          </table>
          ${stamp && html`<div class="mt-1"><span class="dp-stamp">${stamp}</span></div>`}
        </div>
      </div>

      <div class="dp-parties">
        <div class="dp-box">
          <h4>${d.type === 'quote' ? 'Prepared for' : 'Bill to'}</h4>
          <b>${c.company}</b><br />
          ${c.contact_name && html`${c.contact_name}<br />`}
          ${c.address && html`<span style="white-space:pre-line">${c.address}</span><br />`}
          ${[c.city, c.country].filter(Boolean).join(', ')}${c.vat_number ? html`<br />VAT ${c.vat_number}` : ''}
        </div>
        <div class="dp-box">
          <h4>Delivery</h4>
          ${d.incoterm ? html`<b>${d.incoterm} ${d.incoterm_place || ''}</b><br />` : null}
          ${d.delivery_address ? html`<span style="white-space:pre-line">${d.delivery_address}</span>` : html`<span>As agreed</span>`}
          ${d.project && html`<br />Project: ${d.project}`}
        </div>
        <div class="dp-box">
          <h4>Terms</h4>
          Currency: <b>${d.currency}</b><br />
          ${d.payment_terms && html`${d.payment_terms}<br />`}
          ${['quote', 'order'].includes(d.type) && d.lead_time_weeks ? html`Lead time: ${fmtNum(d.lead_time_weeks)} weeks from written colour approval and deposit` : ''}
        </div>
      </div>

      <table class="dp-lines">
        <thead><tr>
          <th style="width:5mm">#</th><th class="img"></th><th>Reference / description</th><th class="n">Surface</th><th class="n">Quantity</th><th class="n">Boxes</th><th class="n">Unit price</th><th class="n">Total</th>
        </tr></thead>
        <tbody>
          ${d.lines.map(
            (l, i) => html`<tr>
              <td class="n">${i + 1}</td>
              <td class="img">${l.image_url ? html`<img src=${l.image_url} alt="" />` : null}</td>
              <td>
                ${l.product && html`<div class="ref">${l.product.sku}</div>`}
                <div class="desc">${l.description}</div>
                ${l.product?.colour_name && html`<div class="meta swatchline"><i style=${{ background: l.product.hex }}></i>${[l.product.finish === 'natural' ? 'Natural (unglazed)' : 'Glazed', l.product.thickness_cm && `${l.product.thickness_cm} cm thick`, l.product.lead_free && 'lead-free glaze'].filter(Boolean).join(' · ')}</div>`}
                ${l.boxes ? html`<div class="meta">${fmtNum(l.pieces)} pcs · ${fmtNum(l.weight_kg)} kg${us ? ` (${fmtNum(toLb(l.weight_kg))} lb)` : ''}</div>` : null}
                ${l.notes && html`<div class="meta">${l.notes}</div>`}
              </td>
              <td class="n">${l.net_qty !== null && l.net_qty !== undefined ? html`${fmtQty(l.net_qty)} ${unitLabel(l.unit)}<div class="meta">+${l.overage_pct ?? d.overage_pct} % overage</div>` : '—'}</td>
              <td class="n"><b>${fmtQty(l.qty)}</b> ${unitLabel(l.unit)}${us && l.unit === 'm2' ? html`<div class="meta">${fmtNum(toSqft(l.qty))} sq ft</div>` : ''}</td>
              <td class="n">${l.boxes ? fmtNum(l.boxes) : '—'}</td>
              <td class="n">${money(l.unit_price, d.currency)}${l.discount_pct ? html`<div class="meta">−${l.discount_pct} %</div>` : ''}</td>
              <td class="n"><b>${money(l.line_total, d.currency)}</b></td>
            </tr>`,
          )}
        </tbody>
      </table>

      <div class="dp-bottom keep">
        <div>
          ${d.packing.boxes > 0 &&
          html`<div class="dp-pack">
            <div><span>Boxes</span><b>${fmtNum(d.packing.boxes)}</b></div>
            <div><span>Pallets</span><b>${fmtNum(d.packing.pallets)}</b></div>
            <div><span>Gross weight</span><b>${fmtNum(d.packing.grossKg)} kg</b></div>
            <div><span>Ships as</span><b style="font-size:8.5pt">${d.packing.suggestion.label}</b></div>
          </div>`}
          ${d.notes && html`<div class="dp-notes">${d.notes}</div>`}
          ${showBank &&
          html`<div class="dp-bank">
            <b>Bank details</b><br />
            ${e.bank_name && html`${e.bank_name}<br />`}
            ${e.bank_account && html`RIB ${e.bank_account}<br />`}
            ${e.iban && html`IBAN ${e.iban}`} ${e.swift && html` · SWIFT ${e.swift}`}<br />
            Payment reference: <b>${d.number}</b>
          </div>`}
        </div>
        <table class="dp-totals">
          <tr><td>Subtotal</td><td>${money(d.totals.linesTotal, d.currency)}</td></tr>
          ${d.totals.discount > 0 && html`<tr><td>Discount ${d.discount_pct} %</td><td>−${money(d.totals.discount, d.currency)}</td></tr>`}
          ${d.totals.freight > 0 && html`<tr><td>Freight</td><td>${money(d.totals.freight, d.currency)}</td></tr>`}
          ${d.totals.handling > 0 && html`<tr><td>Handling</td><td>${money(d.totals.handling, d.currency)}</td></tr>`}
          ${d.vat_rate > 0 ? html`<tr><td>VAT ${d.vat_rate} %</td><td>${money(d.totals.vat, d.currency)}</td></tr>` : d.vat_note && html`<tr class="sub"><td colspan="2">${d.vat_note}</td></tr>`}
          <tr class="grand"><td>Total ${d.currency}</td><td>${money(d.totals.total, d.currency)}</td></tr>
          ${['quote', 'order', 'proforma'].includes(d.type) && d.deposit_pct > 0 && html`<tr class="sub"><td>Deposit ${d.deposit_pct} % ${d.type === 'proforma' ? 'due now' : 'with order'}</td><td>${money(d.totals.deposit, d.currency)}</td></tr>`}
          ${['invoice', 'order', 'proforma'].includes(d.type) && d.paid > 0 && html`<tr class="sub"><td>Received</td><td>−${money(d.paid, d.currency)}</td></tr><tr><td><b>Balance due</b></td><td><b>${money(d.totals.balance, d.currency)}</b></td></tr>`}
        </table>
      </div>

      ${showTerms &&
      html`<div class="dp-terms keep">
        <h4>Conditions</h4>
        <ol>${terms.map((t) => html`<li>${t}</li>`)}</ol>
      </div>`}
      ${['quote', 'order'].includes(d.type) &&
      html`<div class="dp-sign keep">
        <div>Accepted by the client - name, date and signature${d.type === 'quote' ? ' (confirms colours and quantities)' : ''}</div>
        <div>For ${e.name || 'the supplier'}</div>
      </div>`}
      <div class="dp-foot">
        <div class="dp-qr"><img src=${`/api/qr.svg?text=${encodeURIComponent(kbUrl)}`} alt="" /><span>Installation, care and<br />technical data - scan</span></div>
        <div style="text-align:right">${e.name}${[e.ice && `ICE ${e.ice}`, e.if_number && `IF ${e.if_number}`, e.rc && `RC ${e.rc}`, e.patente && `Patente ${e.patente}`, e.cnss && `CNSS ${e.cnss}`, e.vat_number && `VAT ${e.vat_number}`].filter(Boolean).map((x) => ` · ${x}`)}<br />${DOC_TYPES[d.type].label} ${d.number}</div>
      </div>
    </div>
  </div>`;
}

export function PrintPackingList({ id }) {
  const { data, error, loading } = useAsync(() => get(`/shipments/${id}/packing-list`), [id]);
  useTitle('Packing list');
  if (error) return html`<div class="content"><${ErrorBox} error=${error} /></div>`;
  if (loading || !data) return html`<${Loading} />`;
  const s = data.shipment;
  const e = (boot().entities || [])[0] || {};
  const t = data.totals;
  return html`<div class="print-page">
    <${Toolbar} title=${`Packing list ${s.number}`} back=${`/shipments/${s.id}`} />
    <div class="sheet doc-print">
      <div class="dp-head">
        <${Brand} entity=${e} />
        <div class="dp-type">
          <h1>Packing list</h1>
          <div class="dp-num">${s.number}</div>
          <table>
            <tr><td>Date</td><td>${fmtDate(s.etd || new Date().toISOString().slice(0, 10))}</td></tr>
            <tr><td>Orders</td><td>${s.orders.map((o) => o.number).join(', ')}</td></tr>
          </table>
        </div>
      </div>
      <div class="dp-parties">
        <div class="dp-box"><h4>Consignee</h4><b>${s.client_name || s.orders[0]?.client_name || ''}</b></div>
        <div class="dp-box"><h4>Transport</h4>${SHIPMENT_MODES[s.mode]}<br />${s.incoterm || ''} ${s.incoterm_place || ''}<br />${[s.port_loading, s.port_discharge].filter(Boolean).join(' → ')}</div>
        <div class="dp-box"><h4>References</h4>${s.container_no && html`Container ${s.container_no}<br />`}${s.seal_no && html`Seal ${s.seal_no}<br />`}${s.bl_no && html`B/L ${s.bl_no}<br />`}${s.vessel && html`Vessel ${s.vessel}`}</div>
      </div>
      <table class="dp-lines">
        <thead><tr><th>#</th><th>Pallet / unit</th><th>SKU</th><th>Description</th><th>Lot</th><th class="n">Boxes</th><th class="n">Pieces</th><th class="n">m²</th><th class="n">Net kg</th><th class="n">Gross kg</th></tr></thead>
        <tbody>
          ${data.rows.map((r) => html`<tr>
            <td class="n">${r.no}</td><td class="ref">${r.code}</td><td class="ref">${r.sku}</td>
            <td>${r.description}<div class="meta">${r.colour}${r.grade !== 'A' ? ` · grade ${r.grade}` : ''} · HS ${r.hs_code}</div></td>
            <td>${r.lot || '—'}</td><td class="n">${fmtNum(r.boxes)}</td><td class="n">${fmtNum(r.pieces)}</td><td class="n">${fmtQty(r.m2)}</td><td class="n">${fmtNum(r.net_kg)}</td><td class="n">${fmtNum(r.gross_kg)}</td>
          </tr>`)}
        </tbody>
      </table>
      <div class="dp-bottom">
        <div class="dp-notes">Country of origin: Kingdom of Morocco (Fès / Tétouan workshops). Handmade glazed terracotta tiles (zellige), packed in sawdust in cartons ${e.footer_note ? '' : ''}34 × 22 × 23 cm on 100 × 120 cm pallets.</div>
        <table class="dp-totals">
          <tr><td>Pallets</td><td>${fmtNum(t.pallet_count)}</td></tr>
          <tr><td>Boxes</td><td>${fmtNum(t.boxes)}</td></tr>
          <tr><td>Surface</td><td>${fmtQty(t.m2)} m²</td></tr>
          <tr><td>Net weight</td><td>${fmtNum(t.net_kg)} kg</td></tr>
          <tr class="grand"><td>Gross weight</td><td>${fmtNum(t.gross_kg)} kg</td></tr>
        </table>
      </div>
      <${LegalFooter} entity=${e} page=${`Packing list ${s.number}`} />
    </div>
  </div>`;
}

export function PrintPickList({ id }) {
  const { data, error, loading } = useAsync(() => get(`/orders/${id}/picklist`), [id]);
  useTitle('Pick list');
  if (error) return html`<div class="content"><${ErrorBox} error=${error} /></div>`;
  if (loading || !data) return html`<${Loading} />`;
  const o = data.order;
  return html`<div class="print-page">
    <${Toolbar} title=${`Pick list ${o.number}`} back=${`/docs/${o.id}`} />
    <div class="sheet doc-print">
      <div class="dp-head">
        <div><div class="dp-brandname" style="font-size:13pt">PICK LIST</div><div class="dp-company">${o.client_name} · ${o.project || ''}</div></div>
        <div class="dp-type" style="display:flex;gap:4mm;align-items:center"><div><div class="dp-num">${o.number}</div><div class="dp-company">Printed ${fmtDateTime(new Date().toISOString())}</div></div><img src=${`/api/qr.svg?code=${encodeURIComponent(o.number)}`} style="width:24mm;height:24mm" alt="" /></div>
      </div>
      <p class="dp-notes mt-2">Scan → Pick an order: scan this QR, then the dispatch bay label, then each pallet as you take it. Walk the route in this order. One lot per line - never swap a pallet for another lot.</p>
      <table class="dp-lines">
        <thead><tr><th>✓</th><th>Location</th><th>Pallet / unit</th><th>SKU</th><th>Lot</th><th class="n">Boxes</th><th>Status</th></tr></thead>
        <tbody>${data.units.map((u) => html`<tr>
          <td style="width:8mm"><span style="display:inline-block;width:4mm;height:4mm;border:1px solid #151310"></span></td>
          <td class="ref" style="font-size:12pt">${u.location_label || '—'}</td><td class="ref">${u.code}</td><td class="ref">${u.sku}</td><td>${u.lot_code || '—'}</td><td class="n">${fmtNum(u.boxes)}</td><td>${u.status}</td>
        </tr>`)}</tbody>
      </table>
    </div>
  </div>`;
}

export function PrintOriginFile({ id }) {
  const { data, error, loading } = useAsync(() => get(`/shipments/${id}/origin-file`), [id]);
  useTitle('Batch production records');
  if (error) return html`<div class="content"><${ErrorBox} error=${error} /></div>`;
  if (loading || !data) return html`<${Loading} />`;
  const e = (boot().entities || [])[0] || {};
  return html`<div class="print-page">
    <${Toolbar} title=${`Batch records ${data.shipment.number}`} back=${`/shipments/${id}`} />
    ${data.lots.map(
      (t) => html`<div class="sheet doc-print" style="page-break-after:always">
        <div class="dp-head">
          <${Brand} entity=${e} />
          <div class="dp-type"><h1 style="font-size:13pt">Batch production record</h1><div class="dp-num">Lot ${t.lot.code}</div>
            <table><tr><td>Shipment</td><td>${data.shipment.number}</td></tr><tr><td>Product</td><td>${t.lot.sku}</td></tr>${t.mo && html`<tr><td>MO</td><td>${t.mo.number}</td></tr>`}</table></div>
        </div>
        <p class="dp-notes mt-2">${t.lot.product_name}. Made by hand from clay of the Fès and Tétouan regions: hand-shaped, sun-dried, glazed with mineral pigments, fired in traditional kilns fuelled by olive pits, chiselled to size, sorted and packed in Morocco. Workshop: ${t.lot.workshop === 'FES' ? 'Fès' : 'Tétouan'}.</p>
        ${t.progress &&
        html`<table class="dp-lines"><thead><tr><th>Stage</th><th>First record</th><th>Last record</th><th class="n">Pieces in</th><th class="n">Good</th><th class="n">Scrap</th></tr></thead>
          <tbody>${t.progress.routing.map((s) => html`<tr><td>${s.stage.name}</td><td>${fmtDateTime(s.first_at)}</td><td>${fmtDateTime(s.last_at)}</td><td class="n">${fmtNum(s.input)}</td><td class="n">${fmtNum(s.good)}</td><td class="n">${fmtNum(s.scrap)}</td></tr>`)}</tbody></table>`}
        ${t.kiln_loads.length > 0 &&
        html`<table class="dp-lines mt-2"><thead><tr><th>Kiln load</th><th>Kiln</th><th>Fired</th><th class="n">Fuel (olive pits)</th><th class="n">Pieces</th><th class="n">Good</th></tr></thead>
          <tbody>${t.kiln_loads.map((k) => html`<tr><td class="ref">${k.number}</td><td>${k.kiln_name}</td><td>${fmtDateTime(k.fire_start)}</td><td class="n">${k.fuel_kg ? `${fmtNum(k.fuel_kg)} kg` : '—'}</td><td class="n">${fmtNum(k.pcs_loaded)}</td><td class="n">${fmtNum(k.pcs_good)}</td></tr>`)}</tbody></table>`}
        ${t.qc.length > 0 && html`<p class="dp-notes mt-2">Quality control: ${t.qc.map((q) => `${fmtDate(q.at)} ${q.result.toUpperCase()} (inspector ${q.inspector || '—'})`).join('; ')}.</p>`}
        <${LegalFooter} entity=${e} page=${`Lot ${t.lot.code}`} />
      </div>`,
    )}
    ${!data.lots.length && html`<div class="sheet doc-print"><p>No lots are recorded on this shipment yet.</p></div>`}
  </div>`;
}
