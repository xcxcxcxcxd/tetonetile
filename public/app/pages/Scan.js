import { useEffect, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post } from '../lib/api.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import { navigate, useQuery, setQuery } from '../lib/router.js';
import { toast, toastError, can } from '../lib/store.js';
import { fmtNum, fmtQty } from '../lib/format.js';
import { beep } from '../lib/feedback.js';
import { TECH_DATA, APPLICATIONS, INSTALL_SEQUENCE, CARE, TRAFFIC } from '/shared/product-data.js';
import { Button, LinkButton, Card, PageHeader, Loading, Badge, Callout, KV, confirmDialog, Meter } from '../components/ui.js';
import { Icon, BrandMark } from '../components/icons.js';
import { ScannerView } from '../components/Scanner.js';
import { UnitSummary, MoveModal, SplitModal, AdjustModal } from '../components/StockActions.js';
import { renderMarkdown } from '../components/markdown.js';

const MODES = [
  { key: 'lookup', icon: 'search', title: 'Look up', sub: 'What is this? Where does it go?' },
  { key: 'putaway', icon: 'pallet', title: 'Put away / move', sub: 'Scan pallet, then location' },
  { key: 'pick', icon: 'boxes', title: 'Pick an order', sub: 'Scan reserved pallets' },
  { key: 'load', icon: 'truck', title: 'Load a shipment', sub: 'Verify every pallet' },
  { key: 'count', icon: 'clipboard', title: 'Count', sub: 'Cycle count a location' },
  { key: 'production', icon: 'factory', title: 'Record production', sub: 'Scan the MO card' },
];

// A move started by scanning a pallet with the phone's camera app, finished by scanning the location.
const PENDING_KEY = 'zr.pendingMove';
export function setPendingMove(unit) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ id: unit.id, code: unit.code, at: Date.now() }));
  } catch {
    /* private mode */
  }
}
function takePendingMove() {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (p && Date.now() - p.at < 15 * 60000) return p;
  } catch {
    /* ignore */
  }
  return null;
}
const clearPendingMove = () => {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
};

export function ScanPage() {
  useTitle('Scan');
  const query = useQuery();
  const mode = query.get('mode') || 'lookup';
  const [log, setLog] = useState([]);
  const [flash, setFlash] = useState(null);
  const [result, setResult] = useState(null);
  const [pending, setPending] = useState(null); // putaway: unit waiting for its location
  const [order, setOrder] = useState(null); // pick: the order
  const [dock, setDock] = useState(null);
  const [act, setAct] = useState(null);

  const push = (ok, text) => {
    setLog((l) => [{ ok, text, at: new Date() }, ...l].slice(0, 30));
    setFlash(ok ? 'ok' : 'bad');
    beep(ok);
    setTimeout(() => setFlash(null), 450);
  };

  useEffect(() => {
    setResult(null);
    setPending(null);
    if (mode === 'count') navigate('/stock/count', { replace: true });
  }, [mode]);

  const onCode = async (code) => {
    try {
      if (mode === 'production') {
        const r = await get(`/resolve/${encodeURIComponent(code)}`);
        if (r.type !== 'mo') return push(false, `${code} is not a production card (MO).`);
        push(true, `${r.title}`);
        return navigate(`/floor/mo/${r.id}`);
      }
      if (mode === 'load') {
        const r = await get(`/resolve/${encodeURIComponent(code)}`);
        if (r.type !== 'shipment') return push(false, `Scan the shipment loading sheet first (${code} is a ${r.type}).`);
        return navigate(`/shipments/${r.id}/load`);
      }
      if (mode === 'putaway') {
        const r = await get(`/resolve/${encodeURIComponent(code)}`);
        if (!pending) {
          if (r.type !== 'unit') return push(false, `Scan a pallet or box label first (${code} is a ${r.type}).`);
          setPending(r.unit);
          return push(true, `${r.unit.code} - now scan the location`);
        }
        if (r.type === 'unit') {
          setPending(r.unit);
          return push(true, `${r.unit.code} - now scan the location`);
        }
        if (r.type !== 'location') return push(false, `${code} is not a location label.`);
        try {
          const m = await post(`/stock/units/${pending.id}/move`, { location_id: r.id });
          push(true, `${pending.code} → ${m.location.label}`);
          (m.warnings || []).forEach((w) => toast(w, 'warning', 6000));
        } catch (e) {
          if (e.data?.code === 'over_capacity' && (await confirmDialog({ title: 'Location is full', message: `${e.message}\nPut it there anyway?`, confirmLabel: 'Put it there', tone: 'danger' }))) {
            const m = await post(`/stock/units/${pending.id}/move`, { location_id: r.id, force: true });
            push(true, `${pending.code} → ${m.location.label} (over capacity)`);
          } else return push(false, e.message);
        }
        return setPending(null);
      }
      if (mode === 'pick') {
        const r = await get(`/resolve/${encodeURIComponent(code)}`);
        if (!order) {
          if (r.type !== 'doc') return push(false, 'Scan or type the order number (SO-…) first.');
          const d = await get(`/orders/${r.id}/picklist`);
          setOrder(d);
          return push(true, `Picking ${d.order.number} - ${d.units.length} unit(s) reserved`);
        }
        if (r.type === 'location') {
          setDock(r);
          return push(true, `Picked pallets will go to ${r.title.replace('Location ', '')}`);
        }
        if (r.type !== 'unit') return push(false, `${code} is not a pallet label.`);
        const u = r.unit;
        if (u.order_id !== order.order.id) return push(false, `${u.code} is ${u.order_number ? `for ${u.order_number}` : 'not reserved'} - not for ${order.order.number}.`);
        if (u.status === 'picked') return push(true, `${u.code} already picked`);
        await post(`/stock/units/${u.id}/pick`, { location_id: dock?.id });
        const d = await get(`/orders/${order.order.id}/picklist`);
        setOrder(d);
        return push(true, `${u.code} picked (${u.boxes} bx)`);
      }
      // lookup
      const r = await get(`/resolve/${encodeURIComponent(code)}`);
      setResult(r);
      push(true, `${r.title}`);
    } catch (e) {
      push(false, e.message);
    }
  };

  const picked = order ? order.units.filter((u) => u.status === 'picked').length : 0;
  return html`<div class="scan-page">
    <${PageHeader} overline="QR" title="Scan" sub="Every pallet, box, rack position, lot, production card, kiln and shipment carries a QR label." help="qr-codes" />
    <div class="scan-modes">
      ${MODES.map((m) => html`<button class=${`scan-mode ${mode === m.key ? 'on' : ''}`} onClick=${() => setQuery({ mode: m.key }, { replace: true })}>
        <${Icon} name=${m.icon} /><b>${m.title}</b><span>${m.sub}</span>
      </button>`)}
    </div>

    ${mode === 'putaway' &&
    html`<div class="stack sm mb-2">
      <div class=${`big-step ${!pending ? 'on' : 'done'}`}><span class="bs-num">${pending ? html`<${Icon} name="check" size="16" />` : '1'}</span><div><b>Scan the pallet / box label</b>${pending && html`<div class="small muted">${pending.code} · ${pending.sku || pending.material_code} · ${pending.boxes || fmtQty(pending.qty)} ${pending.boxes ? 'boxes' : ''} · now at ${pending.location_label || 'no location'}</div>`}</div></div>
      <div class=${`big-step ${pending ? 'on' : ''}`}><span class="bs-num">2</span><div><b>Scan the location label</b><div class="small muted">The rack beam / floor lane / shelf label</div></div>
        ${pending && html`<${Button} size="sm" icon="target" onClick=${() => setAct({ kind: 'move', u: pending })}>Suggest a place<//>`}</div>
    </div>`}

    ${mode === 'pick' &&
    html`<div class="stack sm mb-2">
      <div class=${`big-step ${!order ? 'on' : 'done'}`}><span class="bs-num">${order ? html`<${Icon} name="check" size="16" />` : '1'}</span><div style="flex:1"><b>Scan or type the order number</b>${order && html`<div class="small muted">${order.order.number} · ${order.order.client_name} · ${picked}/${order.units.length} picked</div>`}</div>
        ${order && html`<a class="btn sm" href=${`/print/picklist/${order.order.id}`} target="_blank"><${Icon} name="list" />Pick list</a>`}</div>
      <div class=${`big-step ${order ? 'on' : ''}`}><span class="bs-num">2</span><div><b>Scan each reserved pallet</b><div class="small muted">Optional: scan a dispatch lane label first so picked pallets are moved there${dock ? ` (now ${dock.title.replace('Location ', '')})` : ''}.</div></div></div>
      ${order && html`<${Meter} value=${picked} max=${order.units.length || 1} />`}
    </div>`}

    <${ScannerView} flash=${flash} onCode=${onCode} hint=${mode === 'putaway' ? (pending ? 'Now scan the location' : 'Scan the pallet label') : mode === 'pick' ? (order ? 'Scan a reserved pallet' : 'Scan the order') : mode === 'production' ? 'Scan the MO card' : mode === 'load' ? 'Scan the shipment sheet' : 'Point at any QR label'} />

    ${result && mode === 'lookup' && html`<div class="scan-result"><${ResultCard} r=${result} onAct=${setAct} /></div>`}

    ${log.length > 0 &&
    html`<div class="section-title mt-3">This session</div>
      <div class="scan-log">${log.map((l) => html`<div class=${`sl ${l.ok ? 'ok' : 'bad'}`}><${Icon} name=${l.ok ? 'checkCircle' : 'alertCircle'} size="16" /><span style="flex:1">${l.text}</span><span class="muted tiny">${l.at.toLocaleTimeString('en-GB')}</span></div>`)}</div>`}

    ${act?.kind === 'move' && html`<${MoveModal} unit=${act.u} onClose=${() => setAct(null)} onDone=${(m) => {
      setAct(null);
      setPending(null);
      push(true, `${act.u.code} → ${m.location.label}`);
    }} />`}
    ${act?.kind === 'split' && html`<${SplitModal} unit=${act.u} onClose=${() => setAct(null)} onDone=${() => setAct(null)} />`}
    ${act?.kind === 'adjust' && html`<${AdjustModal} unit=${act.u} onClose=${() => setAct(null)} onDone=${() => setAct(null)} />`}
  </div>`;
}

/** What a scanned code is, with the next useful actions. */
function ResultCard({ r, onAct }) {
  if (r.type === 'unit') {
    const u = r.unit;
    const present = ['in_stock', 'reserved', 'picked', 'hold'].includes(u.status);
    return html`<${Card} title="Pallet / box" icon="pallet">
      <${UnitSummary} u=${u} />
      <div class="row wrap mt-2">
        ${present && can('warehouse', 'production') && html`<${Button} variant="primary" icon="move" onClick=${() => onAct({ kind: 'move', u })}>Move / put away<//>`}
        ${present && u.boxes > 1 && can('warehouse', 'production') && html`<${Button} icon="split" onClick=${() => onAct({ kind: 'split', u })}>Split<//>`}
        ${present && can('warehouse', 'production') && html`<${Button} icon="edit" onClick=${() => onAct({ kind: 'adjust', u })}>Correct qty<//>`}
        <${LinkButton} href=${`/stock/units/${u.id}`} icon="arrowRight">Details<//>
      </div>
    <//>`;
  }
  if (r.type === 'location') {
    return html`<${Card} title=${r.title} sub=${r.subtitle} icon="pin">
      ${r.occupancy?.capacity ? html`<div style="max-width:260px"><${Meter} value=${r.occupancy.used} max=${r.occupancy.capacity} /><div class="small muted mt-1">${r.occupancy.used} of ${r.occupancy.capacity} ${r.occupancy.unit}s used</div></div>` : html`<div class="small muted">${r.occupancy?.units || 0} unit(s)</div>`}
      <div class="row wrap mt-2"><${LinkButton} variant="primary" href=${r.url} icon="arrowRight">What is here<//><${LinkButton} href=${`/stock/count?location=${encodeURIComponent(r.code)}`} icon="clipboard">Count it<//></div>
    <//>`;
  }
  const actions = {
    mo: [['Record work at this stage', `/floor/mo/${r.id}`, 'factory'], ['MO details', `/production/mo/${r.id}`, 'list']],
    lot: [['Lot traceability', r.url, 'link']],
    product: [['Product page', r.url, 'tile'], ['Where is it stored?', `/stock?tab=where&q=${encodeURIComponent(r.code)}`, 'pin']],
    kiln: [['Kiln station', r.url, 'flame']],
    kiln_load: [['Kiln load', r.url, 'flame']],
    material: [['Material stock', r.url, 'layers']],
    shipment: [['Load by scanning', `/shipments/${r.id}/load`, 'truck'], ['Shipment', r.url, 'arrowRight']],
    doc: [['Open document', r.url, 'file']],
  }[r.type] || [['Open', r.url, 'arrowRight']];
  return html`<${Card} title=${r.title} sub=${r.subtitle} icon="qr">
    <div class="row wrap">${actions.map(([label, href, icon], i) => html`<${LinkButton} variant=${i === 0 ? 'primary' : ''} href=${href} icon=${icon}>${label}<//>`)}</div>
  <//>`;
}

/** Landing page of every QR label: /q/<code>. */
export function Resolve({ code }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    get(`/resolve/${encodeURIComponent(code)}`)
      .then((r) => {
        if (!alive) return;
        // r.url is only present for signed-in staff; visitors get public product data or a sign-in card.
        const pend = takePendingMove();
        if (r.type === 'location' && r.url && pend) return setState({ r, pending: pend });
        if (r.type === 'unit' && r.url) return setState({ r, unitActions: true });
        if (r.url) return navigate(r.url, { replace: true });
        setState({ r });
      })
      .catch((e) => alive && setState({ error: e }));
    return () => {
      alive = false;
    };
  }, [code]);
  useTitle('Scan');
  if (state.loading) return html`<${Loading} />`;
  if (state.error) {
    return html`<${PublicFrame}><${Card}><${Callout} tone="warning" title="Unknown label">${state.error.message}<//><div class="mt-2"><${LinkButton} href="/scan" icon="scan">Scan another<//></div><//><//>`;
  }
  const r = state.r;
  if (state.pending) return html`<${PublicFrame} staff><${PendingMove} r=${r} pending=${state.pending} /><//>`;
  if (state.unitActions) return html`<${PublicFrame} staff><${UnitScanned} r=${r} /><//>`;
  if (r.public?.product) return html`<${PublicFrame}><${PublicProduct} pub=${r.public} type=${r.type} /><//>`;
  if (r.type === 'article' && r.public) return html`<${PublicFrame}><${PublicArticle} id=${r.public.article} /><//>`;
  return html`<${PublicFrame}><${Card}>
    <div class="center" style="padding:20px">
      <${Icon} name="lock" size="28" />
      <h2 class="mt-2">Factory label</h2>
      <p class="muted">This ${r.type ? r.type.replace('_', ' ') : 'label'} (${r.code}) is for Zelligerar staff. Sign in to see it.</p>
      <${LinkButton} variant="primary" href=${`/login?next=${encodeURIComponent(`/q/${code}`)}`}>Staff sign in<//>
    </div>
  <//><//>`;
}

function PublicFrame({ children, staff }) {
  const company = useAsync(() => get('/public/company'), []);
  const c = company.data?.company || {};
  return html`<div class="public">
    <div class="public-head">
      <${BrandMark} size=${34} />
      <div style="flex:1"><div class="strong" style="letter-spacing:.24em">${(c.brand || c.name || 'ZELLIGERAR').toUpperCase()}</div><div class="muted tiny" style="letter-spacing:.14em;text-transform:uppercase">${c.footer_note || 'Handmade Moroccan zellige'}</div></div>
      ${staff ? html`<${LinkButton} size="sm" href="/" icon="home">App<//>` : html`<${LinkButton} size="sm" variant="ghost" href="/login">Staff<//>`}
    </div>
    ${children}
    ${(company.data?.docs || []).length > 0 &&
    html`<div class="card card-pad mt-3">
      <div class="section-title">Downloads</div>
      <div class="stack sm">${company.data.docs.map((d) => html`<a href=${d.url} target="_blank" rel="noopener" class="row"><${Icon} name="file" size="16" />${d.filename.replace(/\.(pdf|png|jpe?g)$/i, '').replace(/[_-]+/g, ' ')}</a>`)}</div>
    </div>`}
    <p class="muted small center mt-4">${[c.email, c.website].filter(Boolean).join(' · ')}</p>
  </div>`;
}

function UnitScanned({ r }) {
  const [act, setAct] = useState(null);
  const u = r.unit;
  const present = ['in_stock', 'reserved', 'picked', 'hold'].includes(u.status);
  return html`<div class="stack">
    <${Card} title="Scanned" icon="pallet">
      <${UnitSummary} u=${u} />
      ${present &&
      html`<div class="stack sm mt-3">
        <${Button} variant="primary" size="lg" icon="move" onClick=${() => setAct('move')}>Move / put away here in the app<//>
        <${Button} size="lg" icon="scan" onClick=${() => {
          setPendingMove(u);
          toast('Now scan the location label with the camera - it will ask to put the pallet there.', 'success', 7000);
        }}>Next: I will scan the location label<//>
      </div>`}
      <div class="row wrap mt-2"><${LinkButton} href=${`/stock/units/${u.id}`} icon="arrowRight">All details<//>${u.lot_id && html`<${LinkButton} href=${`/lots/${u.lot_id}`} icon="link">Lot ${u.lot_code}<//>`}</div>
    <//>
    ${act === 'move' && html`<${MoveModal} unit=${u} onClose=${() => setAct(null)} onDone=${(m) => (setAct(null), toast(`${u.code} → ${m.location.label}`), navigate(`/stock/units/${u.id}`))} />`}
  </div>`;
}

function PendingMove({ r, pending }) {
  const [busy, setBusy] = useState(false);
  const go = async (force = false) => {
    setBusy(true);
    try {
      const m = await post(`/stock/units/${pending.id}/move`, { location_id: r.id, force });
      clearPendingMove();
      beep(true);
      toast(`${pending.code} → ${m.location.label}`);
      navigate(`/warehouse/location/${r.id}`, { replace: true });
    } catch (e) {
      if (e.data?.code === 'over_capacity' && (await confirmDialog({ title: 'Location is full', message: `${e.message}\nPut it there anyway?`, confirmLabel: 'Put it there', tone: 'danger' }))) return go(true);
      beep(false);
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Card} title="Put away" icon="pallet">
    <div class="center" style="padding:10px">
      <div class="muted">Put</div>
      <div class="mono strong" style="font-size:26px">${pending.code}</div>
      <div class="muted">at</div>
      <div class="mono strong" style="font-size:30px;color:var(--accent)">${r.title.replace('Location ', '')}</div>
      <div class="muted small">${r.subtitle}</div>
      ${r.occupancy?.capacity ? html`<div class="small mt-1">${r.occupancy.used} of ${r.occupancy.capacity} used</div>` : ''}
    </div>
    <div class="stack sm mt-2">
      <${Button} variant="primary" size="xl" block loading=${busy} onClick=${() => go(false)} icon="check">Yes, put it here<//>
      <${Button} block onClick=${() => (clearPendingMove(), navigate(r.url, { replace: true }))}>No - just show this location<//>
    </div>
  <//>`;
}

function PublicProduct({ pub, type }) {
  const p = pub.product;
  const fin = p.finish === 'natural' ? 'natural' : 'glazed';
  const mark = { yes: '✓', cond: '✓*', no: '—' };
  return html`<div class="stack">
    <div class="card card-pad">
      <div class="public-hero">
        <img src=${p.image_url} alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px" />
        <div>
          <div class="overline">${p.family === 'cement' ? 'Cement tile' : 'Handmade zellige'}</div>
          <h1 style="font-size:24px">${p.colour_name || p.name}</h1>
          <div class="ink2">${p.format_name}</div>
          <div class="row wrap mt-2" style="gap:6px">
            <span class="code-chip">${p.sku}</span>
            <${Badge} plain>${fin === 'natural' ? 'Natural (unglazed)' : 'Glazed'}<//>
            ${p.lead_free && html`<${Badge} tone="success" plain>Lead-free glaze<//>`}
          </div>
          ${pub.lot && html`<div class="callout info mt-2"><${Icon} name="tag" /><div class="callout-body"><b>Lot ${pub.lot}</b>${pub.produced ? ` · made ${pub.produced}` : ''}${pub.workshop ? ` · ${pub.workshop} workshop` : ''}<div class="small">Keep this number. Quote it for claims or repairs - colour varies between production lots, so blend all boxes before laying.</div></div></div>`}
        </div>
      </div>
    </div>
    <${Card} title="Format and packing" icon="ruler">
      <${KV} items=${[
        ['Size', p.width_cm ? `${p.width_cm} × ${p.length_cm} cm (nominal, ± 6 mm by hand)` : null],
        ['Thickness', p.thickness_cm ? `${p.thickness_cm} cm - not a controlled dimension` : null],
        ['Pieces per m²', p.pcs_per_m2 ? `≈ ${fmtNum(p.pcs_per_m2)}` : null],
        ['Box', p.pcs_per_box ? `${p.pcs_per_box} pieces · ${fmtQty(p.m2_per_box)} m² · ≈ ${p.kg_per_box} kg` : null],
        ['Box size', p.box_dims],
      ]} />
    <//>
    <${Card} title="Before you install" icon="alert">
      <ol class="small" style="margin:0;padding-left:20px;line-height:1.7">${INSTALL_SEQUENCE[fin].map((s) => html`<li>${s}</li>`)}</ol>
      <p class="small muted mt-2">Read the full installation guide with your installer before you start. Inspect the tiles on arrival - claims must be made in writing before installation.</p>
      <${LinkButton} href="/q/KB-installation-care" size="sm" icon="book">Full installation & care guide<//>
    <//>
    <${Card} title="Where it can go" icon="grid" pad=${false}>
      <div class="table-wrap"><table class="table compact app-matrix">
        <thead><tr><th>Application</th><th class="center">${fin === 'natural' ? 'Natural' : 'Glazed'}</th><th>Condition</th></tr></thead>
        <tbody>${APPLICATIONS.map(([a, g, n, cond]) => {
          const v = fin === 'natural' ? n : g;
          return html`<tr><td>${a}</td><td class=${`center ${v}`}>${mark[v]}</td><td class="small muted">${v === 'no' ? '' : cond}</td></tr>`;
        })}</tbody>
      </table></div>
      <div class="small muted" style="padding:10px 14px">${TRAFFIC}</div>
    <//>
    <${Card} title="Technical data" icon="info" pad=${false}>
      <div class="table-wrap"><table class="table compact"><tbody>${TECH_DATA.map((t) => html`<tr><td>${t.label}</td><td>${t[fin]}</td></tr>`)}</tbody></table></div>
      <div class="small muted" style="padding:10px 14px">Typical of current production, not batch-certified values.</div>
    <//>
    <${Card} title="Care" icon="droplet"><ul class="small" style="margin:0;padding-left:18px;line-height:1.7">${CARE.map((c) => html`<li>${c}</li>`)}</ul><//>
  </div>`;
}

function PublicArticle({ id }) {
  const { data, loading } = useAsync(() => get(`/knowledge/${id}`), [id]);
  if (loading && !data) return html`<${Loading} />`;
  return html`<div class="card card-pad"><div class="prose" dangerouslySetInnerHTML=${{ __html: renderMarkdown(data?.body || '') }}></div></div>`;
}
