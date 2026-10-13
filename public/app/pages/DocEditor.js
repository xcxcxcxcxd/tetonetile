import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put, del, qs } from '../lib/api.js';
import { useAsync, useTitle, useHotkey } from '../lib/hooks.js';
import { Link, navigate } from '../lib/router.js';
import { boot, can, toast, toastError } from '../lib/store.js';
import { money, fmtDate, fmtNum, fmtQty, unitLabel, today, titleCase, ago } from '../lib/format.js';
import { uploadFile } from '../lib/image.js';
import { lineQuantities, lineTotal, docTotals, packingSummary, tierCheck, toSqft } from '/shared/calc.js';
import { DOC_TYPES, INCOTERMS, CURRENCIES, UNITS, MO_STATUSES } from '/shared/constants.js';
import {
  Button, IconButton, Card, PageHeader, Loading, ErrorBox, Field, Modal, Badge, StatusBadge, Callout, KV, confirmDialog, promptDialog, EmptyState,
} from '../components/ui.js';
import { ProductPicker } from '../components/ProductPicker.js';
import { ActivityFeed } from './Clients.js';
import { Icon } from '../components/icons.js';

const HEADER_KEYS = ['entity_id', 'issue_date', 'valid_until', 'currency', 'tier_id', 'incoterm', 'incoterm_place', 'payment_terms', 'deposit_pct', 'lead_time_weeks', 'overage_pct', 'project', 'client_ref', 'delivery_address', 'discount_pct', 'freight', 'handling_fee', 'vat_rate', 'vat_note', 'notes', 'internal_notes'];
const CONVERT = { quote: [['order', 'Sales order'], ['proforma', 'Proforma invoice']], order: [['proforma', 'Deposit proforma'], ['invoice', 'Invoice']], proforma: [['invoice', 'Invoice']], invoice: [['credit', 'Credit note']] };
const NEXT_STATUS = {
  quote: { draft: ['sent', 'accepted', 'rejected'], sent: ['accepted', 'rejected', 'expired'], rejected: ['draft'], expired: ['draft', 'sent'] },
  order: { draft: ['confirmed', 'cancelled'], confirmed: ['cancelled'], in_production: ['cancelled'], ready: ['in_production', 'cancelled'], shipped: ['delivered', 'closed'], delivered: ['closed'], cancelled: ['draft'] },
  proforma: { draft: ['issued', 'cancelled'], issued: ['paid', 'cancelled'] },
  invoice: { draft: ['issued', 'cancelled'], issued: ['cancelled'] },
  credit: { draft: ['issued', 'cancelled'] },
};
const TITLE = { quote: 'Quotation', order: 'Order confirmation', proforma: 'Proforma invoice', invoice: 'Invoice', credit: 'Credit note' };

let uid = 0;
function toEditLine(l) {
  return {
    key: ++uid,
    id: l.id,
    product_id: l.product_id,
    product: l.product,
    description: l.description || '',
    unit: l.unit,
    net_qty: l.net_qty ?? '',
    overage_pct: l.overage_pct ?? '',
    qty: l.qty ?? '',
    unit_price: l.unit_price ?? 0,
    price_source: l.price_source,
    discount_pct: l.discount_pct || '',
    image_id: l.image_id,
    image_url: l.image_url,
    notes: l.notes || '',
  };
}

function calc(l, doc) {
  const p = l.product;
  const ov = l.overage_pct === '' || l.overage_pct === null || l.overage_pct === undefined ? Number(doc.overage_pct || 0) : Number(l.overage_pct);
  const net = l.net_qty === '' || l.net_qty === null || l.net_qty === undefined ? null : Number(l.net_qty);
  const q = p && (p.m2_per_box || p.pcs_per_box) ? lineQuantities(p, { unit: l.unit, net_qty: net, overage_pct: ov, qty: l.qty }) : { qty: Number(l.qty) || 0, boxes: null, pieces: null, weight_kg: null };
  return { ...q, ov, line_total: lineTotal(q.qty, l.unit_price, l.discount_pct) };
}

function isLocked(d) {
  return (['invoice', 'credit'].includes(d.type) && d.status !== 'draft') || (d.type === 'quote' && d.status === 'accepted') || (d.type === 'order' && ['shipped', 'delivered', 'closed', 'cancelled'].includes(d.status)) || (d.type === 'proforma' && ['paid', 'cancelled'].includes(d.status));
}

export function DocEditor({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/docs/${id}`), [id]);
  useTitle(data ? `${data.number} · ${data.client_name}` : 'Document');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  return html`<${Editor} key=${`${data.id}:${data.updated_at}:${data.status}:${data.payments.length}`} initial=${data} reload=${reload} />`;
}

function Editor({ initial, reload }) {
  const T = DOC_TYPES[initial.type];
  const settings = boot().settings;
  const locked = isLocked(initial) || !can('sales');
  const [doc, setDoc] = useState(() => Object.fromEntries(HEADER_KEYS.map((k) => [k, initial[k] ?? ''])));
  const [lines, setLines] = useState(() => initial.lines.map(toEditLine));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const [modal, setModal] = useState(null);
  const fileRef = useRef();

  const setH = (k, v) => {
    setDoc((d) => ({ ...d, [k]: v }));
    setDirty(true);
  };
  const setL = (key, patch) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  const computed = useMemo(() => lines.map((l) => ({ ...l, c: calc(l, doc) })), [lines, doc.overage_pct]);
  const totals = docTotals(computed.map((l) => ({ line_total: l.c.line_total })), { ...doc, paid: initial.paid });
  const packing = packingSummary(computed.filter((l) => l.c.boxes).map((l) => ({ boxes: l.c.boxes, weight_kg: l.c.weight_kg, family: l.product?.family, boxes_per_pallet: l.product?.boxes_per_pallet })), settings.logistics);
  const tier = (boot().tiers || []).find((t) => t.id === Number(doc.tier_id));
  const tierWarn = tierCheck(tier, packing.pallets);
  const us = initial.client_region === 'US';

  useEffect(() => {
    const warn = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...doc };
      for (const k of ['deposit_pct', 'lead_time_weeks', 'overage_pct', 'discount_pct', 'freight', 'handling_fee', 'vat_rate']) body[k] = body[k] === '' ? (['discount_pct', 'freight', 'handling_fee', 'vat_rate', 'overage_pct'].includes(k) ? 0 : null) : body[k];
      for (const k of ['entity_id', 'tier_id']) body[k] = body[k] === '' ? null : body[k];
      body.lines = lines.map((l) => ({
        id: l.id, product_id: l.product_id, description: l.description, unit: l.unit, net_qty: l.net_qty, overage_pct: l.overage_pct, qty: l.qty,
        unit_price: l.unit_price, price_source: l.price_source, discount_pct: l.discount_pct, image_id: l.image_id, notes: l.notes,
      }));
      await put(`/docs/${initial.id}`, body);
      setDirty(false);
      toast(`${initial.number} saved`);
      reload();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setSaving(false);
    }
  };
  useHotkey((e) => e.key === 's' && (e.metaKey || e.ctrlKey), (e) => {
    e.preventDefault();
    if (dirty && !locked) save();
  }, { allowInInput: true });

  const ensureSaved = async () => (dirty && !locked ? save() : true);

  const addProducts = async (products) => {
    setPicker(false);
    let prices = {};
    try {
      prices = await post('/pricing/batch', { product_ids: products.map((p) => p.id), client_id: initial.client_id, tier_id: doc.tier_id || null, currency: doc.currency });
    } catch (e) {
      toastError(e);
    }
    setLines((ls) => [
      ...ls,
      ...products.map((p) =>
        toEditLine({
          product_id: p.id,
          product: p,
          description: p.name,
          unit: p.sell_unit || p.unit || 'm2',
          net_qty: p.kind === 'tile' && (p.sell_unit || p.unit) === 'm2' ? '' : null,
          qty: p.kind === 'tile' ? '' : 1,
          unit_price: prices[p.id]?.price || 0,
          price_source: prices[p.id]?.source || 'manual',
          image_url: p.image_url,
        }),
      ),
    ]);
    setDirty(true);
    if (products.some((p) => prices[p.id]?.source === 'no_cost')) toast('Some products have no cost set - enter the unit price by hand or set the cost in the catalogue.', 'warning', 7000);
  };

  const reprice = async () => {
    const ids = lines.filter((l) => l.product_id).map((l) => l.product_id);
    if (!ids.length) return;
    try {
      const prices = await post('/pricing/batch', { product_ids: ids, client_id: initial.client_id, tier_id: doc.tier_id || null, currency: doc.currency });
      setLines((ls) => ls.map((l) => (l.product_id && prices[l.product_id] && prices[l.product_id].source !== 'no_cost' ? { ...l, unit_price: prices[l.product_id].price, price_source: prices[l.product_id].source } : l)));
      setDirty(true);
      toast('Prices updated from the price rules');
    } catch (e) {
      toastError(e);
    }
  };

  const status = async (s) => {
    if (!(await ensureSaved())) return;
    try {
      await post(`/docs/${initial.id}/status`, { status: s });
      toast(`Marked ${s.replace('_', ' ')}`);
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  const convertTo = async (to, label) => {
    if (!(await ensureSaved())) return;
    if (!(await confirmDialog({ title: `Create a ${label.toLowerCase()} from ${initial.number}?`, message: to === 'order' ? 'The quote is marked accepted. The order then waits for written colour approval and the deposit before production can start.' : 'All lines and terms are copied. You can edit the new document before issuing it.', confirmLabel: `Create ${label.toLowerCase()}` }))) return;
    try {
      const r = await post(`/docs/${initial.id}/convert`, { to });
      toast(`${r.number} created`);
      navigate(`/docs/${r.id}`);
    } catch (e) {
      toastError(e);
    }
  };
  const duplicate = async () => {
    const r = await post(`/docs/${initial.id}/duplicate`);
    navigate(`/docs/${r.id}`);
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete draft ${initial.number}?`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await del(`/docs/${initial.id}`);
      navigate(`/docs?type=${initial.type}`);
    } catch (e) {
      toastError(e);
    }
  };
  const print = async () => {
    if (!(await ensureSaved())) return;
    window.open(`/print/doc/${initial.id}`, '_blank');
  };

  const moveLine = (i, dir) => {
    setLines((ls) => {
      const n = [...ls];
      const j = i + dir;
      if (j < 0 || j >= n.length) return ls;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
    setDirty(true);
  };

  const uploadLineImage = async (line, file) => {
    try {
      const a = await uploadFile(file, { entity: 'doc', entity_id: initial.id, caption: `Line image ${line.description || ''}` });
      setL(line.key, { image_id: a.id, image_url: a.url });
    } catch (e) {
      toastError(e);
    }
  };

  const nextStatuses = (NEXT_STATUS[initial.type] || {})[initial.status] || [];
  const conversions = CONVERT[initial.type] || [];
  const curWarn = initial.client?.currency && doc.currency && initial.client.currency !== doc.currency;

  return html`<div>
    <${PageHeader}
      back=${{ href: `/docs?type=${initial.type}`, label: T.plural }}
      overline=${html`${TITLE[initial.type]} · <${Link} href=${`/clients/${initial.client_id}`}>${initial.client_name}<//>`}
      title=${html`<span class="mono">${initial.number}</span> <${StatusBadge} map=${T.statuses} value=${initial.display_status} />${dirty ? html` <${Badge} tone="warning" plain>Unsaved<//>` : ''}`}
      sub=${initial.project || (initial.opportunity_title && `Opportunity: ${initial.opportunity_title}`)}
      help="quotes-orders-invoices"
      actions=${html`
        ${!locked && html`<${Button} variant=${dirty ? 'primary' : ''} icon="check" loading=${saving} disabled=${!dirty} onClick=${save} title="Ctrl + S">Save<//>`}
        <${Button} icon="printer" onClick=${print}>Print / PDF<//>
        ${can('sales') && html`<${Button} icon="send" onClick=${async () => (await ensureSaved()) && setModal('send')}>Send<//>`}
        ${can('sales') && conversions.map(([to, label]) => html`<${Button} icon="arrowRight" variant=${(initial.type === 'quote' && to === 'order') || (initial.type === 'order' && to === 'invoice' && ['shipped', 'delivered'].includes(initial.status)) ? 'primary' : ''} onClick=${() => convertTo(to, label)}>${label}<//>`)}
        ${can('sales') && html`<${MoreMenu} items=${[
          ...nextStatuses.map((s) => ({ label: `Mark ${T.statuses[s]?.[0]?.toLowerCase() || s}`, icon: 'flag', onClick: () => status(s) })),
          { label: 'Duplicate', icon: 'copy', onClick: duplicate },
          ...(initial.status === 'draft' ? [{ label: 'Delete draft', icon: 'trash', danger: true, onClick: remove }] : []),
        ]} />`}
      `}
    />

    ${initial.related.length > 0 &&
    html`<div class="chain mb-2">
      ${[...initial.related.filter((r) => r.id < initial.id), { id: initial.id, number: initial.number, type: initial.type, current: true }, ...initial.related.filter((r) => r.id > initial.id)].map(
        (r, i) => html`${i > 0 && html`<span class="sep"><${Icon} name="chevronRight" size="12" /></span>`}${r.current ? html`<span class="cur">${DOC_TYPES[r.type].label} ${r.number}</span>` : html`<${Link} href=${`/docs/${r.id}`}>${DOC_TYPES[r.type].label} ${r.number} <${StatusBadge} map=${DOC_TYPES[r.type].statuses} value=${r.status} /><//>`}`,
      )}
    </div>`}

    <div class="stack sm mb-2">
      ${locked && can('sales') && html`<${Callout} tone="info" icon="lock">${initial.type === 'invoice' ? 'This invoice is issued and locked (legal record). To correct it, create a credit note.' : `This ${T.label.toLowerCase()} is ${initial.status} and can no longer be edited.`}<//>`}
      ${doc.incoterm === 'DDP' && html`<${Callout} tone="warning" title="DDP makes you the importer of record">: you pay import duties (including extra US duties) and answer customs audits. Offer FCA Tanger Med or CFR instead.<//>`}
      ${curWarn && html`<${Callout} tone="warning" title="Currency differs from the client's (${initial.client.currency}).">Keep one currency per buyer - never show both USD and EUR lists to the same client.<//>`}
      ${tierWarn && html`<${Callout} tone=${tierWarn.level === 'warn' ? 'warning' : 'info'}>${tierWarn.text}<//>`}
      ${initial.type === 'order' && initial.gates_missing.length > 0 && !['cancelled', 'draft'].includes(initial.status) && html`<${Callout} tone="warning" title="Production cannot start yet.">Waiting for ${initial.gates_missing.map((g) => (g === 'colour' ? 'written colour approval' : 'the deposit')).join(' and ')}. The lead time counts from the later of the two.<//>`}
    </div>

    <div class="doc-layout">
      <div class="stack">
        <${Card} title="Lines" sub=${`${lines.length} line${lines.length === 1 ? '' : 's'}`} icon="list" pad=${false}
          actions=${!locked && html`<${Button} size="sm" icon="refresh" variant="ghost" onClick=${reprice} title="Recalculate prices from the client's contract, tier and currency">Reprice<//>
            <${Button} size="sm" icon="edit" onClick=${() => {
              setLines((ls) => [...ls, toEditLine({ description: '', unit: 'unit', qty: 1, unit_price: 0, price_source: 'manual' })]);
              setDirty(true);
            }}>Free line<//>
            <${Button} size="sm" variant="primary" icon="plus" onClick=${() => setPicker(true)}>Add products<//>`}
        >
          ${lines.length === 0
            ? html`<${EmptyState} icon="tile" title="No lines yet" text="Add products from the catalogue - each line shows the tile's picture, boxes, pallets and weight, and prints with its image." action=${!locked && html`<${Button} variant="primary" icon="plus" onClick=${() => setPicker(true)}>Add products<//>`} />`
            : html`<div class="table-wrap"><table class="table lines-table">
                <thead><tr>
                  <th style="width:64px"></th><th>Product</th><th class="num" style="width:190px">Quantity</th><th class="num" style="width:120px">Unit price</th><th class="num" style="width:110px">Total</th>${!locked && html`<th style="width:34px"></th>`}
                </tr></thead>
                <tbody>
                  ${computed.map((l, i) => {
                    const tile = l.product && (l.product.m2_per_box || l.product.pcs_per_box);
                    const measured = tile && ['m2', 'lm'].includes(l.unit);
                    const hasNet = l.net_qty !== '' && l.net_qty !== null && l.net_qty !== undefined;
                    return html`<tr key=${l.key}>
                      <td>
                        <label style="cursor:${locked ? 'default' : 'pointer'};display:block" title=${locked ? '' : 'Click to use a different photo for this line'}>
                          ${l.image_url ? html`<img class="line-img" src=${l.image_url} alt="" />` : html`<span class="line-img" style="display:grid;place-items:center"><${Icon} name="image" size="18" /></span>`}
                          ${!locked && html`<input type="file" accept="image/*" style="display:none" onChange=${(e) => e.target.files[0] && uploadLineImage(l, e.target.files[0])} />`}
                        </label>
                        ${l.image_id && !locked ? html`<a class="tiny" href="#" onClick=${(e) => (e.preventDefault(), setL(l.key, { image_id: null, image_url: l.product_id ? `/api/products/${l.product_id}/image` : null }))}>reset</a>` : null}
                      </td>
                      <td class="line-desc">
                        ${l.product && html`<div class="row" style="gap:6px;margin-bottom:4px"><span class="code-chip">${l.product.sku}</span>${l.product.lead_free ? html`<${Badge} tone="success" plain>Lead-free<//>` : null}${l.product?.packing_confirmed === 0 ? html`<${Badge} tone="warning" plain>packing to confirm<//>` : null}</div>`}
                        ${locked ? html`<div class="strong">${l.description}</div>` : html`<input class="input sm" value=${l.description} placeholder="Description" onInput=${(e) => setL(l.key, { description: e.target.value })} />`}
                        <div class="line-meta">
                          ${tile && l.c.boxes !== null ? html`<b>${fmtNum(l.c.boxes)} boxes</b> · ${fmtNum(l.c.pieces)} pcs · ${fmtNum(l.c.weight_kg)} kg${us && l.unit === 'm2' ? ` · ${fmtNum(toSqft(l.c.qty))} sq ft` : ''}` : ''}
                        </div>
                        ${locked ? (l.notes ? html`<div class="small ink2">${l.notes}</div>` : null) : html`<input class="input sm mt-1" style="font-size:12px" value=${l.notes} placeholder="Note: room, wall, area…" onInput=${(e) => setL(l.key, { notes: e.target.value })} />`}
                      </td>
                      <td class="num">
                        ${measured
                          ? html`${locked
                              ? hasNet && html`<div class="small muted">${fmtQty(l.net_qty)} ${unitLabel(l.unit)} measured + ${l.c.ov} %</div>`
                              : html`<div class="row" style="justify-content:flex-end;gap:4px">
                                  <div class="input-group" style="width:104px"><input class="input sm num" type="number" min="0" step="0.01" value=${l.net_qty} onInput=${(e) => setL(l.key, { net_qty: e.target.value })} placeholder="measured" aria-label="Measured" /><span class="addon">${unitLabel(l.unit)}</span></div>
                                  <div class="input-group" style="width:74px" title="Overage - empty uses the document default"><input class="input sm num" type="number" min="0" max="100" value=${l.overage_pct} placeholder=${doc.overage_pct} onInput=${(e) => setL(l.key, { overage_pct: e.target.value })} aria-label="Overage %" /><span class="addon">%</span></div>
                                </div>`}
                            ${hasNet
                              ? html`<div class="mt-1"><b>${fmtQty(l.c.qty)}</b> ${unitLabel(l.unit)} <span class="line-meta">billed · full boxes</span></div>`
                              : !locked && html`<div class="mt-1 row" style="justify-content:flex-end;gap:4px"><span class="line-meta">or billed qty</span><input class="input sm num" style="width:80px" type="number" min="0" step="0.01" value=${l.qty} onInput=${(e) => setL(l.key, { qty: e.target.value })} /></div>`}
                            ${locked && !hasNet && html`<b>${fmtQty(l.c.qty)}</b> ${unitLabel(l.unit)}`}`
                          : locked
                            ? html`<b>${fmtQty(l.c.qty)}</b> ${unitLabel(l.unit)}`
                            : html`<div class="input-group" style="width:140px;margin-left:auto">
                                <input class="input sm num" type="number" min="0" step="0.01" value=${l.qty} onInput=${(e) => setL(l.key, { qty: e.target.value })} aria-label="Quantity" />
                                <select class="addon" style="border-left:0;padding:0 4px" value=${l.unit} onChange=${(e) => setL(l.key, { unit: e.target.value })} aria-label="Unit">
                                  ${Object.entries(UNITS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
                                </select>
                              </div>`}
                      </td>
                      <td class="num">
                        ${locked
                          ? money(l.unit_price, doc.currency)
                          : html`<input class="input sm num" style="width:100px" type="number" min="0" step="0.01" value=${l.unit_price} onInput=${(e) => setL(l.key, { unit_price: e.target.value, price_source: 'manual' })} aria-label="Unit price" />`}
                        <div class="line-meta">${l.price_source ? titleCase(l.price_source.replace('_', ' ')) : ''}</div>
                        ${locked
                          ? l.discount_pct ? html`<div class="line-meta">−${l.discount_pct} %</div>` : null
                          : html`<div class="row mt-1" style="justify-content:flex-end;gap:4px"><span class="line-meta">disc.</span><input class="input sm num" style="width:52px" type="number" min="0" max="100" value=${l.discount_pct} placeholder="0" onInput=${(e) => setL(l.key, { discount_pct: e.target.value })} aria-label="Discount %" /></div>`}
                      </td>
                      <td class="num strong">${money(l.c.line_total, doc.currency)}</td>
                      ${!locked && html`<td style="padding-left:0;padding-right:6px">
                        <div style="display:flex;flex-direction:column;gap:2px">
                          <${IconButton} icon="chevronUp" label="Move up" onClick=${() => moveLine(i, -1)} />
                          <${IconButton} icon="trash" label="Remove line" onClick=${() => (setLines((ls) => ls.filter((x) => x.key !== l.key)), setDirty(true))} />
                          <${IconButton} icon="chevronDown" label="Move down" onClick=${() => moveLine(i, 1)} />
                        </div>
                      </td>`}
                    </tr>`;
                  })}
                </tbody>
              </table></div>`}
        <//>

        ${initial.type === 'order' && html`<${Fulfilment} doc=${initial} reload=${reload} ensureSaved=${ensureSaved} />`}

        <${Card} title="Terms" icon="sliders">
          <div class="form-grid cols-3">
            <${Field} label="Project"><input class="input" disabled=${locked} value=${doc.project} onInput=${(e) => setH('project', e.target.value)} /><//>
            <${Field} label="Client reference / PO"><input class="input" disabled=${locked} value=${doc.client_ref} onInput=${(e) => setH('client_ref', e.target.value)} /><//>
            <${Field} label="Issue date"><input class="input" type="date" disabled=${locked} value=${doc.issue_date} onInput=${(e) => setH('issue_date', e.target.value)} /><//>
            <${Field} label=${initial.type === 'quote' ? 'Valid until' : initial.type === 'order' ? 'Requested delivery' : 'Due date'}><input class="input" type="date" disabled=${locked} value=${doc.valid_until} onInput=${(e) => setH('valid_until', e.target.value)} /><//>
            <${Field} label="Currency"><select class="select" disabled=${locked} value=${doc.currency} onChange=${(e) => setH('currency', e.target.value)}>${CURRENCIES.map((c) => html`<option>${c}</option>`)}</select><//>
            <${Field} label="Price tier"><select class="select" disabled=${locked} value=${doc.tier_id} onChange=${(e) => setH('tier_id', e.target.value)}><option value="">—</option>${(boot().tiers || []).map((t) => html`<option value=${t.id}>${t.name} ×${t.multiplier}</option>`)}</select><//>
            <${Field} label="Incoterm" hint=${INCOTERMS[doc.incoterm]?.note}><select class="select" disabled=${locked} value=${doc.incoterm} onChange=${(e) => setH('incoterm', e.target.value)}><option value="">—</option>${Object.keys(INCOTERMS).map((k) => html`<option>${k}</option>`)}</select><//>
            <${Field} label="Incoterm place"><input class="input" disabled=${locked} value=${doc.incoterm_place} onInput=${(e) => setH('incoterm_place', e.target.value)} /><//>
            <${Field} label="Lead time (weeks)" hint="From colour approval + deposit"><input class="input num" type="number" min="0" disabled=${locked} value=${doc.lead_time_weeks} onInput=${(e) => setH('lead_time_weeks', e.target.value)} /><//>
            <${Field} label="Default overage %" hint="15 % minimum; 20-30 % for selection or contrasting grout"><input class="input num" type="number" min="0" max="100" disabled=${locked} value=${doc.overage_pct} onInput=${(e) => setH('overage_pct', e.target.value)} /><//>
            <${Field} label="Deposit %"><input class="input num" type="number" min="0" max="100" disabled=${locked} value=${doc.deposit_pct} onInput=${(e) => setH('deposit_pct', e.target.value)} /><//>
            ${(boot().entities || []).length > 1 && html`<${Field} label="Issued by"><select class="select" disabled=${locked} value=${doc.entity_id} onChange=${(e) => setH('entity_id', e.target.value)}>${boot().entities.map((en) => html`<option value=${en.id}>${en.name}</option>`)}</select><//>`}
            <${Field} label="Payment terms" class="span-all"><input class="input" disabled=${locked} value=${doc.payment_terms} onInput=${(e) => setH('payment_terms', e.target.value)} /><//>
            <${Field} label="Delivery address" class="span-all"><textarea class="textarea" rows="2" disabled=${locked} value=${doc.delivery_address} onInput=${(e) => setH('delivery_address', e.target.value)}></textarea><//>
            <${Field} label="Notes printed on the document" class="span-all"><textarea class="textarea" disabled=${locked} value=${doc.notes} onInput=${(e) => setH('notes', e.target.value)} placeholder="E.g. wet areas: glazed walls only; floors in natural bejmat."></textarea><//>
            <${Field} label="Internal notes (never printed)" class="span-all"><textarea class="textarea" disabled=${!can('sales')} value=${doc.internal_notes} onInput=${(e) => setH('internal_notes', e.target.value)}></textarea><//>
          </div>
        <//>

        <${Card} title="Activity" icon="chat">
          <${DocActivity} doc=${initial} />
        <//>
      </div>

      <div class="stack doc-side">
        <${Card} title="Totals" icon="coins">
          <div class="totals-box">
            <div class="t-row"><span>Lines</span><span>${money(totals.linesTotal, doc.currency)}</span></div>
            <div class="t-row"><span class="row" style="gap:6px">Discount ${locked ? `${doc.discount_pct || 0} %` : html`<input class="input sm num" style="width:58px" type="number" min="0" max="100" value=${doc.discount_pct} onInput=${(e) => setH('discount_pct', e.target.value)} /> %`}</span><span>−${money(totals.discount, doc.currency)}</span></div>
            <div class="t-row"><span>Freight</span>${locked ? html`<span>${money(totals.freight, doc.currency)}</span>` : html`<input class="input sm num" style="width:110px" type="number" min="0" step="0.01" value=${doc.freight} onInput=${(e) => setH('freight', e.target.value)} />`}</div>
            <div class="t-row"><span>Handling fee</span>${locked ? html`<span>${money(totals.handling, doc.currency)}</span>` : html`<input class="input sm num" style="width:110px" type="number" min="0" step="0.01" value=${doc.handling_fee} onInput=${(e) => setH('handling_fee', e.target.value)} />`}</div>
            <div class="t-row"><span class="row" style="gap:6px">VAT ${locked ? `${doc.vat_rate || 0} %` : html`<input class="input sm num" style="width:58px" type="number" min="0" max="100" value=${doc.vat_rate} onInput=${(e) => setH('vat_rate', e.target.value)} /> %`}</span><span>${money(totals.vat, doc.currency)}</span></div>
            ${Number(doc.vat_rate || 0) === 0 && html`<input class="input sm" disabled=${locked} value=${doc.vat_note} placeholder="VAT exemption note" onInput=${(e) => setH('vat_note', e.target.value)} />`}
            <div class="t-row big"><span>Total</span><span>${money(totals.total, doc.currency)}</span></div>
            ${['quote', 'order', 'proforma'].includes(initial.type) && Number(doc.deposit_pct) > 0 && html`<div class="t-row"><span class="muted">Deposit ${doc.deposit_pct} %</span><span>${money(totals.deposit, doc.currency)}</span></div>`}
            ${['order', 'invoice', 'proforma'].includes(initial.type) && html`<div class="t-row"><span class="muted">Received</span><span>${money(initial.paid, doc.currency)}</span></div>
              <div class="t-row strong"><span>Balance</span><span>${money(totals.balance, doc.currency)}</span></div>`}
          </div>
        <//>
        <${Card} title="Packing" icon="pallet">
          ${packing.boxes
            ? html`<${KV} items=${[
                ['Boxes', fmtNum(packing.boxes)],
                ['Pallets', html`${fmtNum(packing.pallets)} <span class="muted small">(${Object.entries(packing.families).map(([f, v]) => `${v.per}/pallet ${f}`).join(', ')})</span>`],
                ['Gross weight', `${fmtNum(packing.grossKg)} kg${us ? ` · ${fmtNum(packing.grossKg * 2.20462)} lb` : ''}`],
                ['Ships as', html`<b>${packing.suggestion.label}</b>${packing.suggestion.volumePct ? html`<div class="muted small">${packing.suggestion.volumePct} % of the pallet slots · ${packing.suggestion.weightPct} % of the payload</div>` : ''}`],
              ]} />`
            : html`<div class="muted small">Add tile lines to see boxes, pallets and the container fill.</div>`}
        <//>
        ${['order', 'invoice', 'proforma'].includes(initial.type) && html`<${Payments} doc=${initial} totals=${totals} reload=${reload} />`}
        <${Attachments} doc=${initial} reload=${reload} />
      </div>
    </div>

    ${picker && html`<${ProductPicker} multi title="Add products" onPick=${addProducts} onClose=${() => setPicker(false)} />`}
    ${modal === 'send' && html`<${SendModal} doc=${initial} totals=${totals} onClose=${() => setModal(null)} onSent=${() => (setModal(null), reload())} />`}
  </div>`;
}

function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return html`<div style="position:relative">
    <${IconButton} icon="more" label="More actions" size="" variant="" onClick=${() => setOpen(!open)} />
    ${open &&
    html`<div class="combo-list" style="left:auto;right:0;width:220px" onMouseLeave=${() => setOpen(false)}>
      ${items.map(
        (it) => html`<div class="combo-item" style=${it.danger ? 'color:var(--danger)' : ''} onClick=${() => {
          setOpen(false);
          it.onClick();
        }}><${Icon} name=${it.icon} size="15" />${it.label}</div>`,
      )}
    </div>`}
  </div>`;
}

function DocActivity({ doc }) {
  const { data, reload } = useAsync(() => get(`/activities${qs({ doc_id: doc.id })}`), [doc.id]);
  return html`<${ActivityFeed} clientId=${doc.client_id} docId=${doc.id} opportunityId=${doc.opportunity_id} rows=${data?.rows || []} onChange=${reload} />`;
}

function Payments({ doc, totals, reload }) {
  const [open, setOpen] = useState(false);
  const onOrder = doc.payment_doc_id !== doc.id;
  return html`<${Card}
    title="Payments"
    icon="coins"
    actions=${can('sales') && !['cancelled'].includes(doc.status) && html`<${Button} size="sm" icon="plus" onClick=${() => setOpen(true)}>Record<//>`}
  >
    ${onOrder && html`<div class="muted small mb-1">Payments are recorded on the order ${doc.order_number} and settle its invoices in date order.</div>`}
    ${doc.payments.length
      ? doc.payments.map(
          (p) => html`<div class="row small mb-1">
            <span class="badge plain">${titleCase(p.kind)}</span>
            <span>${fmtDate(p.date)}</span>
            <span class="muted truncate" style="flex:1">${[p.method && titleCase(p.method), p.reference].filter(Boolean).join(' · ')}</span>
            <b class="num">${money(p.kind === 'refund' ? -p.amount : p.amount, p.currency)}</b>
            ${can('sales') && html`<${IconButton} icon="x" label="Delete payment" onClick=${async () => {
              if (!(await confirmDialog({ title: 'Delete this payment?', confirmLabel: 'Delete', tone: 'danger' }))) return;
              await del(`/payments/${p.id}`);
              reload();
            }} />`}
          </div>`,
        )
      : html`<div class="muted small">No payment received yet.</div>`}
    ${open && html`<${PaymentModal} doc=${doc} totals=${totals} onClose=${() => setOpen(false)} onSaved=${() => (setOpen(false), reload())} />`}
  <//>`;
}

function PaymentModal({ doc, totals, onClose, onSaved }) {
  const suggested = doc.paid <= 0 && totals.deposit > 0 && doc.type !== 'invoice' ? totals.deposit : Math.max(0, totals.balance);
  const [v, setV] = useState({ date: today(), amount: suggested ? suggested.toFixed(2) : '', kind: doc.paid <= 0 && doc.type !== 'invoice' ? 'deposit' : 'balance', method: 'bank_transfer', reference: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post(`/docs/${doc.id}/payments`, v);
      toast('Payment recorded');
      onSaved();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  return html`<${Modal} title="Record a payment" onClose=${onClose} footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${save}>Record payment<//>`}>
    <div class="form-grid">
      <${Field} label="Date"><input class="input" type="date" value=${v.date} onInput=${set('date')} /><//>
      <${Field} label=${`Amount (${doc.currency})`}><input class="input num" type="number" min="0" step="0.01" value=${v.amount} onInput=${set('amount')} /><//>
      <${Field} label="Type"><select class="select" value=${v.kind} onChange=${set('kind')}><option value="deposit">Deposit</option><option value="balance">Balance</option><option value="payment">Payment</option><option value="refund">Refund</option></select><//>
      <${Field} label="Method"><select class="select" value=${v.method} onChange=${set('method')}><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option><option value="lc">Letter of credit</option></select><//>
      <${Field} label="Reference" class="span-2"><input class="input" value=${v.reference} onInput=${set('reference')} placeholder="Bank reference, cheque number…" /><//>
    </div>
    ${doc.type === 'order' && !doc.deposit_received_at && html`<div class="mt-2"><${Callout} tone="info">When payments reach the ${doc.deposit_pct || 0} % deposit (${money(totals.deposit, doc.currency)}), the deposit gate opens automatically.<//></div>`}
  <//>`;
}

function Attachments({ doc, reload }) {
  const [busy, setBusy] = useState(false);
  const files = doc.attachments || [];
  return html`<${Card} title="Files" icon="link" actions=${can('sales') && html`<label class="btn sm"><${Icon} name="upload" />${busy ? 'Uploading…' : 'Add'}<input type="file" accept="image/*,application/pdf" style="display:none" onChange=${async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setBusy(true);
    try {
      await uploadFile(f, { entity: 'doc', entity_id: doc.id });
      reload();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }} /></label>`}>
    ${files.length
      ? files.map((a) => html`<div class="row small mb-1"><${Icon} name=${a.mime === 'application/pdf' ? 'file' : 'image'} size="15" /><a class="truncate" style="flex:1" href=${`/files/${a.stored_name}`} target="_blank" rel="noopener">${a.filename}</a><span class="muted">${ago(a.created_at)}</span></div>`)
      : html`<div class="muted small">Client PO, drawings, colour approval email, proof of payment…</div>`}
  <//>`;
}

function SendModal({ doc, totals, onClose, onSent }) {
  const entity = doc.entity || {};
  const label = TITLE[doc.type];
  const subject = `${label} ${doc.number}${doc.project ? ` - ${doc.project}` : ''} - ${entity.brand || entity.name || ''}`.trim();
  const body = `Dear ${doc.client?.contact_name || 'client'},\n\nPlease find attached our ${label.toLowerCase()} ${doc.number}${doc.project ? ` for ${doc.project}` : ''}: ${money(totals.total, doc.currency)}${doc.incoterm ? ` ${doc.incoterm} ${doc.incoterm_place || ''}` : ''}.\n${doc.type === 'quote' ? `\nThe quantities include ${doc.overage_pct || 15} % overage for cutting, breakage and future repairs. Lead time is counted from your written colour approval and the deposit.\n` : ''}\nKind regards,\n${boot().user?.name || ''}\n${entity.name || ''}`;
  const phone = String(doc.client?.phone || '').replace(/[^\d]/g, '');
  const log = async (channel) => {
    try {
      await post(`/docs/${doc.id}/send-log`, { channel });
      toast(`${doc.number} marked as sent`);
      onSent();
    } catch (e) {
      toastError(e);
    }
  };
  return html`<${Modal} title=${`Send ${doc.number}`} onClose=${onClose} icon="send">
    <div class="stack">
      <div class="big-step"><span class="bs-num">1</span><div style="flex:1"><b>Save the PDF</b><div class="muted small">Open the print view and choose "Save as PDF". Product images are included on every line.</div></div><a class="btn" href=${`/print/doc/${doc.id}`} target="_blank"><${Icon} name="printer" />Print view</a></div>
      <div class="big-step"><span class="bs-num">2</span><div style="flex:1"><b>Send it</b><div class="muted small">Opens a draft with the text ready - attach the PDF.</div></div>
        <div class="row">
          <a class="btn" href=${`mailto:${doc.client?.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}><${Icon} name="mail" />Email</a>
          ${phone && html`<a class="btn" href=${`https://wa.me/${phone}?text=${encodeURIComponent(body)}`} target="_blank" rel="noopener"><${Icon} name="chat" />WhatsApp</a>`}
        </div>
      </div>
      <div class="big-step"><span class="bs-num">3</span><div style="flex:1"><b>Record it</b><div class="muted small">${doc.type === 'quote' ? 'Marks the quote sent and logs it on the client timeline.' : 'Issues the document and logs it on the client timeline.'}</div></div>
        <div class="row"><${Button} variant="primary" onClick=${() => log('email')}>Sent by email<//><${Button} onClick=${() => log('whatsapp')}>Sent by WhatsApp<//></div>
      </div>
    </div>
  <//>`;
}

function Fulfilment({ doc, reload, ensureSaved }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const f = doc.fulfilment || [];
  const tracked = f.filter((x) => x.tracked);
  const gate = async (field) => {
    const date = await promptDialog({ title: field === 'colour_approved_at' ? 'Written colour approval received' : 'Deposit received', label: 'Date', type: 'date', initial: today(), confirmLabel: 'Record' });
    if (!date) return;
    try {
      await post(`/docs/${doc.id}/gates`, { [field]: date });
      toast('Recorded');
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  const release = async (force = false) => {
    if (!(await ensureSaved())) return;
    setBusy(true);
    try {
      const r = await post(`/orders/${doc.id}/release`, { force });
      setResult(r.results);
      reload();
    } catch (e) {
      if (e.data?.code === 'gates' && can()) {
        if (await confirmDialog({ title: 'Start production before the gates?', message: `${e.message}\n\nOnly do this with the owner's agreement - colours cannot be changed once glazing starts.`, confirmLabel: 'Start anyway', tone: 'danger' })) release(true);
      } else toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const allocate = async (allowMulti) => {
    setBusy(true);
    try {
      const r = await post(`/orders/${doc.id}/allocate`, { allow_multi_lot: allowMulti });
      const failed = r.results.filter((x) => !x.ok && x.reason === 'no_single_lot');
      if (failed.length && !allowMulti) {
        if (await confirmDialog({ title: 'No single lot covers some lines', message: 'Mixing lots on one line shows as banding on the wall. You can produce a new lot instead (Release to production), or allocate from several lots and ask the installer to blend all boxes.', confirmLabel: 'Allocate from several lots', tone: 'danger' })) return allocate(true);
      } else toast('Stock reserved');
      reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const unallocate = async (x) => {
    if (!(await confirmDialog({ title: `Unreserve ${x.sku}?`, message: `${fmtNum(x.reserved)} boxes go back to free stock. Use this when the order changed or another lot must be used - then reserve again or release to production.`, confirmLabel: 'Unreserve', tone: 'danger' }))) return;
    setBusy(true);
    try {
      const r = await post(`/orders/${doc.id}/unallocate`, { line_id: x.line_id });
      toast(`${r.released} unit(s) back to free stock`);
      reload();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const shipment = async () => {
    try {
      const s = await post('/shipments', { client_id: doc.client_id, order_ids: [doc.id], region: doc.client_region, incoterm: doc.incoterm, incoterm_place: doc.incoterm_place, mode: doc.packing?.suggestion?.mode || 'container_40' });
      navigate(`/shipments/${s.id}`);
    } catch (e) {
      toastError(e);
    }
  };
  const STATE = { open: ['Not started', 'neutral'], partial: ['Partly reserved', 'warning'], in_production: ['In production', 'progress'], ready: ['Reserved - ready', 'success'], loaded: ['Loaded', 'info'], shipped: ['Shipped', 'success'] };
  return html`<${Card} title="Production & stock" icon="factory"
    actions=${html`${['confirmed', 'in_production', 'ready'].includes(doc.status) && can('sales', 'production') && html`<${Button} size="sm" variant="primary" icon="factory" loading=${busy} onClick=${() => release(false)}>Release to production<//>`}
      ${['confirmed', 'in_production'].includes(doc.status) && can('sales', 'warehouse') && html`<${Button} size="sm" icon="boxes" loading=${busy} onClick=${() => allocate(false)}>Reserve stock<//>`}
      ${tracked.some((x) => x.reserved > 0) && html`<a class="btn sm" href=${`/print/picklist/${doc.id}`} target="_blank"><${Icon} name="list" />Pick list</a>`}
      ${['ready', 'in_production'].includes(doc.status) && can('sales', 'warehouse') && html`<${Button} size="sm" icon="truck" onClick=${shipment}>Plan shipment<//>`}`}
  >
    <div class="grid cols-3 mb-2">
      <div class=${`gate ${doc.colour_approved_at ? 'ok' : 'todo'}`}>
        <span class="g-icon"><${Icon} name=${doc.colour_approved_at ? 'check' : 'palette'} /></span>
        <div style="flex:1"><div class="strong small">Colour approval</div><div class="muted tiny">${doc.colour_approved_at ? fmtDate(doc.colour_approved_at) : 'Written approval needed'}</div></div>
        ${!doc.colour_approved_at && can('sales') && html`<${Button} size="sm" onClick=${() => gate('colour_approved_at')}>Record<//>`}
      </div>
      <div class=${`gate ${doc.deposit_received_at ? 'ok' : 'todo'}`}>
        <span class="g-icon"><${Icon} name=${doc.deposit_received_at ? 'check' : 'coins'} /></span>
        <div style="flex:1"><div class="strong small">Deposit</div><div class="muted tiny">${doc.deposit_received_at ? fmtDate(doc.deposit_received_at) : `${doc.deposit_pct || 0} % not yet received`}</div></div>
        ${!doc.deposit_received_at && can('sales') && html`<${Button} size="sm" onClick=${() => gate('deposit_received_at')}>Record<//>`}
      </div>
      <div class=${`gate ${doc.promised_date ? 'ok' : 'todo'}`}>
        <span class="g-icon"><${Icon} name="calendar" /></span>
        <div><div class="strong small">Promised ready date</div><div class="muted tiny">${doc.promised_date ? fmtDate(doc.promised_date) : `${doc.lead_time_weeks || '?'} weeks after both gates`}</div></div>
      </div>
    </div>
    ${tracked.length
      ? html`<div class="table-wrap"><table class="table compact">
          <thead><tr><th>Line</th><th class="num">Boxes</th><th class="num">Reserved</th><th class="num">In production</th><th class="num">Shipped</th><th>Lots</th><th>State</th></tr></thead>
          <tbody>${tracked.map((x) => {
            const st = STATE[x.state] || STATE.open;
            return html`<tr>
              <td><span class="code-chip">${x.sku}</span></td>
              <td class="num">${fmtNum(x.required)}</td>
              <td class="num">${fmtNum(x.reserved)}${x.reserved - x.loaded - x.shipped > 0 && can('sales', 'warehouse') && !['shipped', 'delivered', 'closed', 'cancelled'].includes(doc.status) ? html`<div><a href="#" class="tiny" onClick=${(e) => (e.preventDefault(), unallocate(x))}>unreserve</a></div>` : ''}</td>
              <td class="num">${x.mos.length ? x.mos.map((m) => html`<div><${Link} href=${`/production/mo/${m.id}`}>${m.number}<//> <span class="muted tiny">${m.stage_name || MO_STATUSES[m.status]?.[0]}</span></div>`) : '—'}</td>
              <td class="num">${fmtNum(x.shipped + x.loaded)}</td>
              <td>${x.lots.join(', ') || '—'} ${x.multi_lot ? html`<${Badge} tone="warning" plain title="Several lots on one line - blend boxes on site">blend<//>` : ''}</td>
              <td><${Badge} tone=${st[1]}>${st[0]}<//></td>
            </tr>`;
          })}</tbody>
        </table></div>`
      : html`<div class="muted small">No tile lines to produce.</div>`}
    ${doc.shipments?.length > 0 && html`<div class="mt-2 small">Shipments: ${doc.shipments.map((s) => html`<${Link} href=${`/shipments/${s.id}`} class="code-chip">${s.number}<//> `)}</div>`}
    ${result &&
    html`<${Modal} title="Released to production" onClose=${() => setResult(null)} footer=${html`<${Button} variant="primary" onClick=${() => setResult(null)}>OK<//>`}>
      <div class="stack sm">
        ${result.map((r) => html`<div class="row top">
          <${Icon} name=${r.action === 'produce' ? 'factory' : r.action === 'reserved' ? 'boxes' : 'check'} size="18" />
          <div><b>${r.sku}</b> - ${r.action === 'produce' ? html`new lot to produce: <${Link} href=${`/production/mo/${r.mo_id}`}>${r.mo}<//> (${fmtNum(r.boxes)} boxes)` : r.action === 'reserved' ? `${fmtNum(r.boxes)} boxes reserved from stock lot ${(r.lots || []).join(', ')}` : 'already covered'}
            ${(r.warnings || []).map((w) => html`<div class="small" style="color:var(--warning)">${w}</div>`)}</div>
        </div>`)}
      </div>
    <//>`}
  <//>`;
}
