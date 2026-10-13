import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post } from '../lib/api.js';
import { useAsync, useTitle, usePref } from '../lib/hooks.js';
import { Link } from '../lib/router.js';
import { can, toast, toastError } from '../lib/store.js';
import { beep } from '../lib/feedback.js';
import { fmtNum, fmtDateTime, ago } from '../lib/format.js';
import { MO_STATUSES, MO_PURPOSES, SCRAP_REASONS } from '/shared/constants.js';
import { VARIATION_SCALES, allowedVariation } from '/shared/calc.js';
import { Button, LinkButton, Loading, ErrorBox, Badge, StatusBadge, Callout, HelpButton, confirmDialog } from '../components/ui.js';
import { Icon } from '../components/icons.js';

// Shop-floor screen: opened by scanning the production card (MO traveller) clipped to the batch.
// Big targets, a keypad and as little typing as possible - it is used with dusty hands on a tablet.

export function FloorMo({ id }) {
  const { data, error, loading, reload } = useAsync(() => get(`/mos/${id}`), [id]);
  const [stageId, setStageId] = useState(null);
  const [saved, setSaved] = useState(null);
  useTitle(data?.mo ? `${data.mo.number} · shop floor` : 'Shop floor');
  if (error) return html`<div class="floor"><${ErrorBox} error=${error} retry=${reload} /></div>`;
  if (loading && !data) return html`<${Loading} />`;
  const mo = data.mo;
  const prog = data.progress;
  const routing = prog.routing;
  const sel = routing.find((s) => s.stage.id === (stageId ?? prog.current_stage_id)) || routing.find((s) => !s.done) || routing[routing.length - 1];
  const open = ['released', 'in_progress'].includes(mo.status);

  const release = async () => {
    try {
      const r = await post(`/mos/${mo.id}/release`);
      const short = (r.materials || []).filter((m) => m.short > 0);
      toast(short.length ? `Released - short of ${short.map((m) => m.name).join(', ')}` : 'Released to the workshop', short.length ? 'warning' : 'success', 6000);
      reload();
    } catch (e) {
      toastError(e);
    }
  };

  return html`<div class="floor">
    <div class="row between mb-2">
      <${Link} href=${`/production/mo/${mo.id}`} class="small"><${Icon} name="arrowLeft" size="12" /> MO details<//>
      <div class="row">
        <${LinkButton} size="sm" variant="ghost" icon="scan" href="/scan?mode=production">Scan another card<//>
        <${HelpButton} id="sop-record-work" label="Procedure" />
      </div>
    </div>

    <div class="floor-card mb-2">
      <div class="row top" style="gap:14px">
        <img class="thumb lg" src=${mo.image_url} alt="" />
        <div style="flex:1;min-width:0">
          <div class="row wrap"><span class="mono strong" style="font-size:20px">${mo.number}</span><${StatusBadge} map=${MO_STATUSES} value=${mo.status} />${mo.priority === 1 && html`<${Badge} tone="danger" plain>High priority<//>`}</div>
          <div class="strong">${mo.sku} · ${mo.colour_name || ''}</div>
          <div class="small muted">Lot <span class="mono">${mo.lot_code}</span> · ${mo.order_number ? `${mo.order_number} · ${mo.client_name}` : MO_PURPOSES[mo.purpose]} · ${fmtNum(mo.target_pcs)} pcs started</div>
        </div>
      </div>
      <div class="flow" style="margin-top:12px">${routing.map((s) => html`<i class=${s.done ? 'done' : s.stage.id === sel?.stage.id ? 'active' : ''} title=${s.stage.name}></i>`)}</div>
    </div>

    ${mo.lot_status === 'hold' && html`<div class="mb-2"><${Callout} tone="warning" title="Lot on QC hold.">Keep working; packed pallets go to quarantine until the lot is released.<//></div>`}

    ${mo.status === 'planned' &&
    html`<div class="floor-card mb-2">
      <div class="floor-stage">Not released yet</div>
      <p class="ink2 mt-1">This batch has not been released to the workshop. Release it before recording work, so the material check and the lot start now.</p>
      ${can('production') ? html`<${Button} variant="primary" size="xl" block icon="check" onClick=${release}>Release to the workshop<//>` : html`<${Callout} tone="info">Ask the production manager to release it.<//>`}
    </div>`}
    ${mo.status === 'hold' && html`<${Callout} tone="warning" title="This MO is on hold.">Do not continue work on this batch. ${mo.notes ? html`<div class="mt-1 small" style="white-space:pre-wrap">${mo.notes}</div>` : ''}<//>`}
    ${['completed', 'closed'].includes(mo.status) &&
    html`<div class="floor-card mb-2">
      <div class="floor-stage"><${Icon} name="checkCircle" size="26" /> Batch finished</div>
      <p class="ink2 mt-1">All stages are done. Print or re-print the pallet labels if one is missing.</p>
      <div class="row wrap"><${LinkButton} href=${`/labels?type=unit&ids=${data.units.map((u) => u.id).join(',')}`} icon="printer" size="lg">Pallet labels<//><${LinkButton} href=${`/print/labels?type=box&lot=${mo.lot_code}&format=a4-24`} icon="package" size="lg">Carton labels<//></div>
    </div>`}
    ${mo.status === 'cancelled' && html`<${Callout} tone="danger" title="Cancelled.">This MO was cancelled. Do not work on it.<//>`}

    ${open &&
    html`<div>
      <div class="section-title">Stage</div>
      <div class="chips mb-2">
        ${routing.map(
          (s) => html`<button class=${s.stage.id === sel?.stage.id ? 'on' : ''} onClick=${() => (setStageId(s.stage.id), setSaved(null))} style="padding:9px 14px;font-size:14px">
            ${s.done ? '✓ ' : ''}${s.stage.name}${!s.done && s.waiting + s.in_kiln > 0 ? html` <b>${fmtNum(s.waiting + s.in_kiln)}</b>` : ''}
          </button>`,
        )}
      </div>
      ${saved && html`<${SavedPanel} saved=${saved} mo=${mo} onAgain=${() => setSaved(null)} />`}
      ${!saved && sel && html`<${StagePanel} key=${sel.stage.id} mo=${mo} st=${sel} prog=${prog} workers=${data.workers} onSaved=${(r) => (setSaved(r), setStageId(null), reload())} />`}
    </div>`}

    ${prog.logs.length > 0 &&
    html`<div class="mt-3">
      <div class="section-title">Last entries</div>
      <div class="scan-log">
        ${[...prog.logs].reverse().slice(0, 6).map(
          (l) => html`<div class="sl ok">
            <b style="min-width:92px">${l.stage_name}</b>
            <span class="num">+${fmtNum(l.qty_good)}${l.qty_scrap ? html` <span style="color:var(--danger)">· ${fmtNum(l.qty_scrap)} scrap</span>` : ''}</span>
            <span class="muted small truncate" style="flex:1">${l.worker_name || l.operator || ''}${l.kiln_load_number ? ` · ${l.kiln_load_number}` : ''}</span>
            <span class="muted small" title=${fmtDateTime(l.created_at)}>${ago(l.created_at)}</span>
          </div>`,
        )}
      </div>
    </div>`}
  </div>`;
}

function SavedPanel({ saved, mo, onAgain }) {
  const units = saved.units || [];
  return html`<div class="floor-card mb-2" style="border-color:var(--success)">
    <div class="floor-stage" style="color:var(--success)"><${Icon} name="checkCircle" size="26" /> Saved</div>
    <p class="ink2 mt-1">
      ${saved.completed ? `${mo.number} is complete.` : saved.next_stage ? `Next stage: ${saved.next_stage.name}. Move the batch and its card there.` : 'The batch stays at this stage until it is finished.'}
    </p>
    ${saved.qc && saved.qc.result !== 'pass' && html`<div class="mb-2"><${Callout} tone="warning" title="Lot put on QC hold:">${saved.qc.exceeded.map((x) => x.label).join(', ')}. Tell the quality manager.<//></div>`}
    ${units.length > 0 &&
    html`<div class="mb-2"><${Callout} tone="success" title=${`${units.length} pallet / box group${units.length === 1 ? '' : 's'} created.`}>Print the labels now: two per pallet (front and side), then put the pallets away by scanning.<//></div>
      <div class="row wrap mb-2">
        <${LinkButton} variant="primary" size="lg" icon="printer" href=${`/labels?type=unit&ids=${units.join(',')}`}>Print pallet labels<//>
        <${LinkButton} size="lg" icon="package" href=${`/print/labels?type=box&lot=${mo.lot_code}&format=a4-24`}>Carton labels<//>
        <${LinkButton} size="lg" icon="pallet" href="/scan?mode=putaway">Put away<//>
      </div>`}
    <div class="row wrap">
      <${LinkButton} size="lg" variant=${units.length ? '' : 'primary'} icon="scan" href="/scan?mode=production">Scan the next card<//>
      <${Button} size="lg" icon="plus" onClick=${onAgain}>Record more here<//>
    </div>
  </div>`;
}

function FloorHead({ title, sub, big, label }) {
  return html`<div class="floor-head">
    <div style="flex:1;min-width:0"><div class="floor-stage">${title}</div>${sub && html`<div class="small ink2">${sub}</div>`}</div>
    <div class="right" style="flex:none"><div class="floor-big">${big}</div><div class="small muted">${label}</div></div>
  </div>`;
}

function Keypad({ onKey }) {
  return html`<div class="keypad">
    ${['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map(
      (k) => html`<button type="button" onClick=${() => onKey(k)} aria-label=${k === '⌫' ? 'Delete' : k === 'C' ? 'Clear' : k}>${k}</button>`,
    )}
  </div>`;
}

const press = (cur, k) => (k === 'C' ? '' : k === '⌫' ? String(cur || '').slice(0, -1) : `${cur || ''}${k}`.replace(/^0+(?=\d)/, '').slice(0, 6));

function Counter({ label, value, on, tone, onClick, hint }) {
  return html`<button type="button" class=${`counter ${on ? 'on' : ''} ${tone || ''}`} onClick=${onClick}>
    <span class="c-k">${label}</span>
    <span class="c-v">${value === '' ? '0' : fmtNum(value)}</span>
    ${hint && html`<span class="c-h">${hint}</span>`}
  </button>`;
}

function WorkerPick({ workers, value, onChange, team }) {
  if (!workers.length) return null;
  // The team of this stage first, then everyone else.
  const sorted = team ? [...workers].sort((a, b) => (b.team === team) - (a.team === team)) : workers;
  return html`<div class="mt-3">
    <div class="section-title">Who did the work?</div>
    <div class="worker-grid">
      ${sorted.map(
        (w) => html`<button type="button" class=${String(value) === String(w.id) ? 'on' : ''} onClick=${() => onChange(String(value) === String(w.id) ? '' : String(w.id))}>
          <span class="avatar">${w.name.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()}</span>
          <span class="small">${w.name}</span>
          ${w.team && html`<span class="tiny muted">${w.team}</span>`}
        </button>`,
      )}
    </div>
  </div>`;
}

function StagePanel({ mo, st, prog, workers, onSaved }) {
  const stage = st.stage;
  if (stage.is_kiln) return html`<${KilnStagePanel} mo=${mo} st=${st} />`;
  if (st.done) {
    return html`<div class="floor-card">
      <div class="floor-stage">${stage.name}</div>
      <p class="ink2 mt-1">Finished for this batch: ${fmtNum(st.good)} good, ${fmtNum(st.scrap)} scrap.</p>
    </div>`;
  }
  if (stage.is_qc) return html`<${SortPanel} mo=${mo} st=${st} workers=${workers} onSaved=${onSaved} />`;
  if (stage.is_packing) return html`<${PackPanel} mo=${mo} st=${st} prog=${prog} workers=${workers} onSaved=${onSaved} />`;
  return html`<${WorkPanel} mo=${mo} st=${st} workers=${workers} onSaved=${onSaved} />`;
}

/** Shared save with the "pieces still waiting" confirmation. */
async function saveLog(mo, body, onSaved, setBusy) {
  setBusy(true);
  try {
    const r = await post(`/mos/${mo.id}/log`, body);
    beep(true);
    if (r.qc && r.qc.result !== 'pass') toast(`QC hold: ${r.qc.exceeded.map((x) => x.label).join(', ')}`, 'warning', 8000);
    onSaved(r);
  } catch (e) {
    beep(false);
    if (e.data?.code === 'remaining') {
      const ok = await confirmDialog({ title: 'Pieces still waiting', message: `${e.message}\n\nClose the stage and count them as a shortfall?`, confirmLabel: 'Close stage', tone: 'danger' });
      if (ok) return saveLog(mo, { ...body, close_remaining: true }, onSaved, setBusy);
    } else toastError(e);
  } finally {
    setBusy(false);
  }
}

function WorkPanel({ mo, st, workers, onSaved }) {
  const stage = st.stage;
  const [v, setV] = useState({ good: '', scrap: '' });
  const [active, setActive] = useState('good');
  const [reason, setReason] = useState('');
  const [worker, setWorker] = usePref('floor.worker', '');
  const [finish, setFinish] = useState(null);
  const [busy, setBusy] = useState(false);
  const good = Number(v.good || 0);
  const scrap = Number(v.scrap || 0);
  const total = good + scrap;
  const over = total > st.waiting;
  const autoFinish = total > 0 && total === st.waiting && !st.in_kiln;
  const completes = finish === null ? autoFinish : finish;
  const save = () =>
    saveLog(mo, { stage_id: stage.id, qty_good: good, qty_scrap: scrap, scrap_reason: scrap ? reason || null : null, worker_id: worker || null, completes_stage: completes }, onSaved, setBusy);
  return html`<div class="floor-card">
    <${FloorHead} title=${stage.name} sub=${stage.instructions} big=${fmtNum(st.waiting)} label="pieces waiting here" />
    <div class="counters mt-3">
      <${Counter} label="Good pieces" value=${v.good} on=${active === 'good'} onClick=${() => setActive('good')} />
      <${Counter} label="Scrap" value=${v.scrap} on=${active === 'scrap'} tone=${scrap ? 'bad' : ''} onClick=${() => setActive('scrap')} />
    </div>
    <div class="row wrap mt-2 mb-2">
      <${Button} size="sm" onClick=${() => (setV({ ...v, good: String(Math.max(0, st.waiting - scrap)) }), setActive('scrap'))}>All waiting (${fmtNum(Math.max(0, st.waiting - scrap))})<//>
      ${[10, 50, 100].map((n) => html`<${Button} size="sm" onClick=${() => setV({ ...v, [active]: String(Number(v[active] || 0) + n) })}>+${n}<//>`)}
    </div>
    <${Keypad} onKey=${(k) => setV({ ...v, [active]: press(v[active], k) })} />
    ${scrap > 0 &&
    html`<div class="mt-3">
      <div class="section-title">Why scrapped?</div>
      <div class="chips">${SCRAP_REASONS.map((r) => html`<button type="button" class=${reason === r ? 'on' : ''} onClick=${() => setReason(reason === r ? '' : r)}>${r}</button>`)}</div>
    </div>`}
    <${WorkerPick} workers=${workers} value=${worker} onChange=${setWorker} team=${stage.code} />
    ${over && html`<div class="mt-2"><${Callout} tone="danger">Only ${fmtNum(st.waiting)} pieces are waiting at ${stage.name}${st.in_kiln ? ` (${fmtNum(st.in_kiln)} are in the kiln)` : ''}.<//></div>`}
    <label class="finish-toggle mt-3">
      <input type="checkbox" checked=${completes} onChange=${(e) => setFinish(e.target.checked)} />
      <span><b>${stage.name} is finished for the whole batch</b><span class="small muted">The card moves to the next stage. Leave unticked if more pieces will come.</span></span>
    </label>
    <${Button} class="mt-3" variant="primary" size="xl" block loading=${busy} disabled=${over || (total === 0 && !completes)} onClick=${save}>
      Save · ${fmtNum(good)} good${scrap ? ` · ${fmtNum(scrap)} scrap` : ''}
    <//>
  </div>`;
}

function KilnStagePanel({ mo, st }) {
  return html`<div class="floor-card">
    <${FloorHead} title=${st.stage.name} sub="Firing is recorded per kiln load, so every piece is traced to the firing it went through." big=${fmtNum(st.waiting)} label=${`ready to load${st.in_kiln ? ` · ${fmtNum(st.in_kiln)} in the kiln` : ''}`} />
    <ol class="steps-list mt-2">
      <li>Scan the <b>kiln door label</b> (or open Kilns) and start a load.</li>
      <li>Add this batch (${mo.number}) with the number of pieces on the trolley.</li>
      <li>Fire, then cool. At unloading, count good and defective pieces per batch.</li>
    </ol>
    <div class="row wrap mt-2">
      <${LinkButton} variant="primary" size="lg" icon="flame" href=${`/production/kilns?mo=${mo.id}`}>Go to kilns<//>
      <${LinkButton} size="lg" icon="scan" href="/scan?mode=lookup">Scan the kiln label<//>
    </div>
  </div>`;
}

/** Sorting / QC: grade A, grade B and rejects, plus the quick check against the standard. */
function SortPanel({ mo, st, workers, onSaved }) {
  const [v, setV] = useState({ a: '', b: '', rej: '' });
  const [active, setActive] = useState('a');
  const [worker, setWorker] = usePref('floor.worker', '');
  const [qc, setQc] = useState({ matches_reference: '1' });
  const [inspector, setInspector] = usePref('floor.inspector', '');
  const [finish, setFinish] = useState(null);
  const [busy, setBusy] = useState(false);
  const allowed = allowedVariation(mo.finish, mo.hex);
  const a = Number(v.a || 0);
  const b = Number(v.b || 0);
  const rej = Number(v.rej || 0);
  const total = a + b + rej;
  const over = total > st.waiting;
  const outside = Object.entries(VARIATION_SCALES).filter(([k]) => qc[k] && Number(qc[k]) > allowed[k]);
  const completes = finish === null ? total > 0 && total === st.waiting : finish;
  const save = () =>
    saveLog(
      mo,
      { stage_id: st.stage.id, grade_a: a, grade_b: b, rejects: rej, worker_id: worker || null, completes_stage: completes, qc: { ...qc, inspector: inspector || undefined } },
      onSaved,
      setBusy,
    );
  return html`<div class="floor-card">
    <${FloorHead} title=${st.stage.name} sub=${st.stage.instructions || 'Sort every piece into grade A, grade B or reject. Check against the approved colour reference.'} big=${fmtNum(st.waiting)} label="pieces to sort" />
    <div class="counters mt-3">
      <${Counter} label="Grade A" value=${v.a} on=${active === 'a'} onClick=${() => setActive('a')} />
      <${Counter} label="Grade B" value=${v.b} on=${active === 'b'} onClick=${() => setActive('b')} />
      <${Counter} label="Rejects" value=${v.rej} on=${active === 'rej'} tone=${rej ? 'bad' : ''} onClick=${() => setActive('rej')} />
    </div>
    <div class="row wrap mt-2 mb-2">
      <${Button} size="sm" onClick=${() => setV({ ...v, a: String(Math.max(0, st.waiting - b - rej)) })}>Rest is grade A (${fmtNum(Math.max(0, st.waiting - b - rej))})<//>
      ${[10, 50, 100].map((n) => html`<${Button} size="sm" onClick=${() => setV({ ...v, [active]: String(Number(v[active] || 0) + n) })}>+${n}<//>`)}
    </div>
    <${Keypad} onKey=${(k) => setV({ ...v, [active]: press(v[active], k) })} />

    <div class="section-title mt-3">Quick check against the Variation & Imperfection standard</div>
    <div class="small muted mb-2">Tap the level you see on a sample of the batch. Levels above the standard for ${mo.finish === 'natural' ? 'natural clay' : 'this glaze'} put the lot on QC hold.</div>
    <div class="qc-grid">
      ${Object.entries(VARIATION_SCALES).map(
        ([k, sc]) => html`<div class="qc-row">
          <div class="qc-name">${sc.label}<span class="tiny muted">standard ≤ ${allowed[k]}</span></div>
          <div class="chips">
            ${sc.scale.map((label, i) => {
              const lvl = i + 1;
              const on = Number(qc[k]) === lvl;
              return html`<button type="button" class=${`${on ? 'on' : ''} ${lvl > allowed[k] ? 'over' : ''}`} onClick=${() => setQc({ ...qc, [k]: on ? '' : String(lvl) })}>${lvl} ${label}</button>`;
            })}
          </div>
        </div>`,
      )}
      <div class="qc-row">
        <div class="qc-name">Matches the approved colour reference?</div>
        <div class="chips">
          <button type="button" class=${qc.matches_reference === '1' ? 'on' : ''} onClick=${() => setQc({ ...qc, matches_reference: '1' })}>Yes</button>
          <button type="button" class=${`over ${qc.matches_reference === '0' ? 'on' : ''}`} onClick=${() => setQc({ ...qc, matches_reference: '0' })}>No - hold the lot</button>
        </div>
      </div>
    </div>
    ${(outside.length > 0 || qc.matches_reference === '0') &&
    html`<div class="mt-2"><${Callout} tone="warning" title="This will put lot ${mo.lot_code} on QC hold:">${[...outside.map(([, sc]) => sc.label), ...(qc.matches_reference === '0' ? ['colour does not match the reference'] : [])].join(', ')}.<//></div>`}
    <div class="mt-2" style="max-width:320px"><label class="small muted">Inspector</label><input class="input" value=${inspector} onInput=${(e) => setInspector(e.target.value)} placeholder="Name" /></div>
    <${WorkerPick} workers=${workers} value=${worker} onChange=${setWorker} team=${st.stage.code} />
    ${over && html`<div class="mt-2"><${Callout} tone="danger">Only ${fmtNum(st.waiting)} pieces are waiting to be sorted.<//></div>`}
    <label class="finish-toggle mt-3">
      <input type="checkbox" checked=${completes} onChange=${(e) => setFinish(e.target.checked)} />
      <span><b>Sorting is finished for the whole batch</b><span class="small muted">The batch moves on to packing.</span></span>
    </label>
    <${Button} class="mt-3" variant="primary" size="xl" block loading=${busy} disabled=${over || (total === 0 && !completes)} onClick=${save}>
      Save · A ${fmtNum(a)} · B ${fmtNum(b)}${rej ? ` · ${fmtNum(rej)} rejects` : ''}
    <//>
  </div>`;
}

/** Packing: sorted pieces become full boxes and labelled pallets at the packing-out area. */
function PackPanel({ mo, st, prog, workers, onSaved }) {
  const sort = prog.routing.find((s) => s.stage.is_qc);
  const availA = Math.max(0, (sort ? sort.grade_a : st.input) - st.grade_a);
  const availB = Math.max(0, (sort ? sort.grade_b : 0) - st.grade_b);
  const [v, setV] = useState({ a: String(availA), b: String(availB) });
  const [active, setActive] = useState('a');
  const [worker, setWorker] = usePref('floor.worker', '');
  const [finish, setFinish] = useState(null);
  const [busy, setBusy] = useState(false);
  const a = Number(v.a || 0);
  const b = Number(v.b || 0);
  const per = mo.pcs_per_box || 0;
  const perPallet = mo.boxes_per_pallet || 78;
  const boxesA = per ? Math.floor(a / per) : 0;
  const looseA = per ? a - boxesA * per : a;
  const pallets = Math.ceil(boxesA / perPallet);
  const over = a > availA || b > availB;
  const completes = finish === null ? a === availA && b === availB && a + b > 0 && (!sort || sort.done) : finish;
  const save = () => saveLog(mo, { stage_id: st.stage.id, pack_a: a, pack_b: b, worker_id: worker || null, completes_stage: completes }, onSaved, setBusy);
  return html`<div class="floor-card">
    <${FloorHead} title=${st.stage.name} sub=${st.stage.instructions || 'Pack full boxes only. Each pallet gets two labels; cartons get the lot carton label.'} big=${fmtNum(availA + availB)} label="sorted pieces to pack" />
    <div class="counters mt-3">
      <${Counter} label="Grade A to pack" value=${v.a} on=${active === 'a'} onClick=${() => setActive('a')} hint=${`${fmtNum(availA)} sorted`} />
      <${Counter} label="Grade B to pack" value=${v.b} on=${active === 'b'} onClick=${() => setActive('b')} hint=${`${fmtNum(availB)} sorted`} />
    </div>
    <div class="callout mt-2"><${Icon} name="pallet" /><div class="callout-body">
      <b>${fmtNum(boxesA)} boxes grade A</b> (${per} pcs/box)${looseA ? `, ${fmtNum(looseA)} loose pieces` : ''} → <b>${fmtNum(pallets)} pallet${pallets === 1 ? '' : 's'}</b> of up to ${perPallet} boxes.
      ${mo.order_number ? ` Reserved automatically for ${mo.order_number}.` : ''}
    </div></div>
    <div class="mt-2"><${Keypad} onKey=${(k) => setV({ ...v, [active]: press(v[active], k) })} /></div>
    <${WorkerPick} workers=${workers} value=${worker} onChange=${setWorker} team=${st.stage.code} />
    ${over && html`<div class="mt-2"><${Callout} tone="danger">Only ${fmtNum(availA)} grade A and ${fmtNum(availB)} grade B pieces are sorted and waiting.<//></div>`}
    <label class="finish-toggle mt-3">
      <input type="checkbox" checked=${completes} onChange=${(e) => setFinish(e.target.checked)} />
      <span><b>Packing is finished - this completes the batch</b><span class="small muted">The lot is released to stock when the last stage closes.</span></span>
    </label>
    <${Button} class="mt-3" variant="primary" size="xl" block icon="pallet" loading=${busy} disabled=${over || (a + b === 0 && !completes)} onClick=${save}>Pack and create pallets<//>
  </div>`;
}
