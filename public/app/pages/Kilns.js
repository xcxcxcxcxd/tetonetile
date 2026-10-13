import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put, del } from '../lib/api.js';
import { useAsync, useTitle } from '../lib/hooks.js';
import { Link, navigate, useQuery } from '../lib/router.js';
import { can, toast, toastError } from '../lib/store.js';
import { fmtNum, fmtQty, fmtDateTime, ago } from '../lib/format.js';
import { KILN_STATUSES, SCRAP_REASONS } from '/shared/constants.js';
import {
  Button, LinkButton, Card, PageHeader, Loading, ErrorBox, Badge, StatusBadge, EmptyState, Callout, KV, Modal, Field, Meter, Swatch, QrImg, promptDialog, confirmDialog,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import { Icon } from '../components/icons.js';

const hours = (from, to) => {
  if (!from) return null;
  const a = new Date(`${from.replace(' ', 'T')}Z`).getTime();
  const b = to ? new Date(`${to.replace(' ', 'T')}Z`).getTime() : Date.now();
  const h = (b - a) / 3600000;
  return h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`;
};

export function Kilns() {
  useTitle('Kilns');
  const query = useQuery();
  const focusKiln = Number(query.get('kiln')) || null;
  const moId = Number(query.get('mo')) || null;
  const { data, error, loading, reload } = useAsync(() => get('/kiln-overview'), []);
  const [adding, setAdding] = useState(null);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const firing = data.kilns.filter((k) => k.current?.status === 'firing').length;
  const readyPcs = data.ready.reduce((s, r) => s + r.waiting, 0);
  const focusMo = moId ? data.ready.find((r) => r.id === moId) : null;

  const start = async (k) => {
    try {
      const r = await post('/kiln-loads', { kiln_id: k.id });
      toast(`${r.load.number} started in ${k.name}`);
      navigate(`/production/kilns/load/${r.load.id}`);
    } catch (e) {
      toastError(e);
    }
  };
  const step = async (load, status, label) => {
    try {
      await post(`/kiln-loads/${load.id}/status`, { status });
      toast(`${load.number}: ${label}`);
      reload();
    } catch (e) {
      toastError(e);
    }
  };

  return html`<div>
    <${PageHeader}
      overline="Factory"
      title="Kilns"
      sub=${`${data.kilns.length} kilns · ${firing} firing · ${fmtNum(readyPcs)} pieces ready to load`}
      help="sop-kiln"
      actions=${html`<${LinkButton} href="/labels?type=kiln" icon="qr">Kiln door labels<//><${LinkButton} href="/scan" icon="scan">Scan<//>`}
    />
    ${focusMo && html`<div class="mb-2"><${Callout} tone="info" title=${`Load ${focusMo.number}:`}>${fmtNum(focusMo.waiting)} pieces are ready. Choose a kiln that is loading, or start a load in an idle kiln.<//></div>`}
    ${moId && !focusMo && html`<div class="mb-2"><${Callout} tone="info">That batch has no pieces waiting for firing right now.<//></div>`}
    <div class="kiln-grid mb-3">
      ${data.kilns.map((k) => {
        const cur = k.current;
        const pcs = cur ? cur.items.reduce((s, i) => s + i.pcs_loaded, 0) : 0;
        return html`<div class=${`kiln-card ${cur ? cur.status : 'idle'} ${focusKiln === k.id ? 'focus' : ''}`}>
          <div class="row between">
            <div class="row"><span class="kiln-icon"><${Icon} name="flame" /></span><div><div class="strong">${k.name}</div><div class="tiny muted"><span class="mono">KILN-${k.code}</span>${k.workshop ? ` · ${k.workshop}` : ''}${k.capacity_m2 ? ` · ${fmtQty(k.capacity_m2, 0)} m²` : ''}</div></div></div>
            ${cur ? html`<${StatusBadge} map=${KILN_STATUSES} value=${cur.status} />` : html`<${Badge} tone="neutral">Idle<//>`}
          </div>
          ${cur
            ? html`<div class="mt-2">
                <div class="row between small"><${Link} class="mono strong" href=${`/production/kilns/load/${cur.id}`}>${cur.number}<//><span class="muted">${cur.items.length} batch${cur.items.length === 1 ? '' : 'es'} · ${fmtNum(pcs)} pcs</span></div>
                ${k.capacity_m2 ? html`<div class="mt-1"><${Meter} value=${cur.m2} max=${k.capacity_m2} /><div class="tiny muted mt-1">${fmtQty(cur.m2, 1)} of ${fmtQty(k.capacity_m2, 1)} m²</div></div>` : ''}
                <div class="small muted mt-1">
                  ${cur.status === 'loading' && `Loading since ${fmtDateTime(cur.loaded_at)}`}
                  ${cur.status === 'firing' && `Firing for ${hours(cur.fire_start)}`}
                  ${cur.status === 'cooling' && `Cooling for ${hours(cur.fire_end)} (fired ${hours(cur.fire_start, cur.fire_end)})`}
                </div>
                ${can('production') &&
                html`<div class="row wrap mt-2">
                  ${cur.status === 'loading' && html`<${LinkButton} size="sm" href=${`/production/kilns/load/${cur.id}`} icon="plus">Add pieces<//><${Button} size="sm" variant="primary" icon="flame" disabled=${!cur.items.length} onClick=${() => step(cur, 'firing', 'firing started')}>Start firing<//>`}
                  ${cur.status === 'firing' && html`<${LinkButton} size="sm" variant="primary" href=${`/production/kilns/load/${cur.id}?end=1`} icon="thermometer">Firing finished<//>`}
                  ${cur.status === 'cooling' && html`<${LinkButton} size="sm" variant="primary" href=${`/production/kilns/load/${cur.id}`} icon="checkCircle">Unload & count<//>`}
                </div>`}
              </div>`
            : html`<div class="mt-2 small muted">${k.last ? `Last: ${k.last.number}, unloaded ${ago(k.last.unloaded_at)}` : 'No loads yet'} · ${k.loads_30d} loads in 30 days</div>
              ${can('production') && html`<div class="mt-2"><${Button} size="sm" variant=${focusMo ? 'primary' : ''} icon="plus" onClick=${() => start(k)}>Start a load<//></div>`}`}
        </div>`;
      })}
      ${!data.kilns.length && html`<${EmptyState} icon="flame" title="No kilns set up" text="Add your kilns in Settings → Production." action=${html`<${LinkButton} href="/settings/production" variant="primary">Settings<//>`} />`}
    </div>

    <div class="grid cols-2" style="align-items:start">
      <${Card} title="Ready to fire" sub=${`${data.ready.length} batch${data.ready.length === 1 ? '' : 'es'}`} icon="clock" pad=${false}>
        <${DataTable}
          compact
          columns=${[
            { key: 'number', label: 'Batch', render: (r) => html`<div class="prod-cell"><img class="thumb sm" src=${r.image_url} alt="" /><div><${Link} class="cell-main mono" href=${`/production/mo/${r.id}`}>${r.number}<//><div class="cell-sub">${r.sku} · ${r.lot_code}</div></div></div>` },
            { key: 'waiting', label: 'Pieces', align: 'num', render: (r) => html`${fmtNum(r.waiting)}<div class="cell-sub">${r.pcs_per_m2 ? `${fmtQty(r.waiting / r.pcs_per_m2, 1)} m²` : ''}</div>` },
            { key: 'act', label: '', align: 'right', render: (r) => (can('production') ? html`<${Button} size="sm" variant=${r.id === moId ? 'primary' : ''} onClick=${() => setAdding(r)}>Load<//>` : '') },
          ]}
          rows=${data.ready}
          rowClass=${(r) => (r.id === moId ? 'hl' : '')}
          empty=${html`<div class="muted small" style="padding:14px">Nothing waiting for the kiln.</div>`}
        />
      <//>
      <${Card} title="Recent loads" icon="history" pad=${false}>
        <${DataTable}
          compact
          columns=${[
            { key: 'number', label: 'Load', render: (l) => html`<${Link} class="mono" href=${`/production/kilns/load/${l.id}`}>${l.number}<//><div class="cell-sub">${l.kiln_name}</div>` },
            { key: 'status', label: 'Status', render: (l) => html`<${StatusBadge} map=${KILN_STATUSES} value=${l.status} />` },
            { key: 'pcs', label: 'Pieces', align: 'num', render: (l) => fmtNum(l.pcs) },
            { key: 'defects', label: 'Defects', align: 'num', render: (l) => (l.status === 'unloaded' ? html`${fmtNum(l.defects)}<div class="cell-sub">${l.pcs ? `${((l.defects / l.pcs) * 100).toFixed(1)} %` : ''}</div>` : html`<span class="muted">—</span>`) },
            { key: 'fire_start', label: 'Fired', render: (l) => html`<span class="small">${l.fire_start ? fmtDateTime(l.fire_start) : '—'}</span>` },
          ]}
          rows=${data.recent}
          onRowClick=${(l) => navigate(`/production/kilns/load/${l.id}`)}
          empty=${html`<div class="muted small" style="padding:14px">No kiln loads yet.</div>`}
        />
      <//>
    </div>
    ${adding && html`<${AddToKilnModal} mo=${adding} kilns=${data.kilns} onClose=${() => setAdding(null)} onDone=${(loadId) => (setAdding(null), navigate(`/production/kilns/load/${loadId}`))} />`}
  </div>`;
}

/** Pieces of a batch that still fit in a kiln (null when the capacity is unknown). */
function fitPcs(kiln, loadedM2, pcsPerM2) {
  if (!kiln?.capacity_m2 || !pcsPerM2) return null;
  return Math.max(0, Math.floor((kiln.capacity_m2 - (loadedM2 || 0)) * pcsPerM2));
}

/** Add pieces to a load; over the kiln capacity the operator confirms explicitly. */
async function loadPieces(loadId, moId, pcs) {
  try {
    return await post(`/kiln-loads/${loadId}/items`, { mo_id: moId, pcs });
  } catch (e) {
    if (e.data?.code !== 'over_capacity') throw e;
    const ok = await confirmDialog({ title: 'Kiln over capacity', message: `${e.message}\n\nAn overloaded kiln fires unevenly. Load anyway?`, confirmLabel: 'Load anyway', tone: 'danger' });
    if (!ok) return null;
    return post(`/kiln-loads/${loadId}/items`, { mo_id: moId, pcs, force: true });
  }
}

function AddToKilnModal({ mo, kilns, onClose, onDone }) {
  const options = kilns.filter((k) => !k.current || k.current.status === 'loading');
  const suggest = (k) => {
    const fit = fitPcs(k, k?.current?.m2, mo.pcs_per_m2);
    return String(fit === null ? mo.waiting : Math.min(mo.waiting, fit));
  };
  const first = options.find((k) => k.current) || options[0];
  const [kilnId, setKilnId] = useState(String(first?.id || ''));
  const [pcs, setPcs] = useState(suggest(first));
  const [busy, setBusy] = useState(false);
  const sel = kilns.find((x) => String(x.id) === kilnId);
  const fit = fitPcs(sel, sel?.current?.m2, mo.pcs_per_m2);
  const go = async () => {
    setBusy(true);
    try {
      let loadId = sel.current?.id;
      if (!loadId) loadId = (await post('/kiln-loads', { kiln_id: sel.id })).load.id;
      const r = await loadPieces(loadId, mo.id, Number(pcs));
      if (!r) return;
      toast(`${fmtNum(pcs)} pcs of ${mo.number} loaded`);
      onDone(loadId);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${`Load ${mo.number}`} onClose=${onClose} icon="flame"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} disabled=${!kilnId || !(Number(pcs) > 0)} onClick=${go}>Load into kiln<//>`}>
    ${options.length
      ? html`<div class="stack sm">
          ${options.map(
            (k) => html`<label class=${`pick-row ${String(k.id) === kilnId ? 'on' : ''}`}>
              <input type="radio" name="kiln" checked=${String(k.id) === kilnId} onChange=${() => (setKilnId(String(k.id)), setPcs(suggest(k)))} />
              <span style="flex:1"><b>${k.name}</b><span class="small muted"> · ${k.current ? `${k.current.number} loading, ${fmtQty(k.current.m2, 1)}${k.capacity_m2 ? ` / ${fmtQty(k.capacity_m2, 1)}` : ''} m²` : 'idle - a new load starts'}</span></span>
            </label>`,
          )}
        </div>`
      : html`<${Callout} tone="warning">Every kiln is firing or cooling. Wait for one to be unloaded.<//>`}
    <div class="mt-3" style="max-width:220px"><${Field} label="Pieces on the trolley" hint=${`${fmtNum(mo.waiting)} waiting${fit !== null ? ` · about ${fmtNum(fit)} fit` : ''}`}><input class="input num" type="number" min="1" max=${mo.waiting} value=${pcs} onInput=${(e) => setPcs(e.target.value)} /><//></div>
  <//>`;
}

export function KilnLoad({ id }) {
  const query = useQuery();
  const { data, error, loading, reload, setData } = useAsync(() => get(`/kiln-loads/${id}`), [id]);
  const [endModal, setEndModal] = useState(query.get('end') === '1');
  useTitle(data?.load?.number || 'Kiln load');
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const load = data.load;
  const pcs = load.items.reduce((s, i) => s + i.pcs_loaded, 0);
  const good = load.items.reduce((s, i) => s + (i.pcs_good || 0), 0);
  const defects = load.items.reduce((s, i) => s + (i.pcs_defect || 0), 0);
  const prod = can('production');

  const status = async (s, extra = {}, msg) => {
    try {
      const r = await post(`/kiln-loads/${load.id}/status`, { status: s, ...extra });
      setData((d) => ({ ...d, load: r.load }));
      toast(msg);
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async (item) => {
    try {
      const r = await del(`/kiln-loads/${load.id}/items/${item.id}`);
      setData(r);
    } catch (e) {
      toastError(e);
    }
  };

  return html`<div>
    <${PageHeader}
      back=${{ href: '/production/kilns', label: 'Kilns' }}
      overline=${load.kiln_name}
      title=${html`<span class="mono">${load.number}</span> <${StatusBadge} map=${KILN_STATUSES} value=${load.status} />`}
      sub=${`${load.items.length} batch${load.items.length === 1 ? '' : 'es'} · ${fmtNum(pcs)} pieces · ${fmtQty(load.m2, 1)} m²`}
      help="sop-kiln"
      actions=${prod &&
      html`${load.status === 'loading' && html`<${Button} variant="primary" icon="flame" disabled=${!load.items.length} onClick=${() => status('firing', {}, 'Firing started')}>Start firing<//>`}
        ${load.status === 'firing' && html`<${Button} variant="primary" icon="thermometer" onClick=${() => setEndModal(true)}>Firing finished<//>`}`}
    />
    <div class="steps-inline mb-3">
      ${['loading', 'firing', 'cooling', 'unloaded'].map((s, i, arr) => {
        const idx = arr.indexOf(load.status);
        return html`<span class=${i < idx ? 'done' : i === idx ? 'on' : ''}>${i + 1}. ${KILN_STATUSES[s][0]}</span>`;
      })}
    </div>
    <div class="grid side">
      <div class="stack">
        ${load.status === 'cooling' && prod
          ? html`<${UnloadForm} load=${load} onDone=${(r) => (setData((d) => ({ ...d, load: r.load })), toast('Unloaded - firing recorded on every batch'))} />`
          : html`<${Card} title="In this load" icon="layers" pad=${false}>
              <${DataTable}
                compact
                columns=${[
                  { key: 'mo_number', label: 'Batch', render: (i) => html`<div class="row"><${Swatch} hex=${i.hex} /><div><${Link} class="mono strong" href=${`/production/mo/${i.mo_id}`}>${i.mo_number}<//><div class="cell-sub">${i.sku} · ${i.lot_code}</div></div></div>` },
                  { key: 'pcs_loaded', label: 'Loaded', align: 'num', render: (i) => html`${fmtNum(i.pcs_loaded)}<div class="cell-sub">${i.m2 ? `${fmtQty(i.m2, 1)} m²` : ''}</div>` },
                  ...(load.status === 'unloaded'
                    ? [
                        { key: 'pcs_good', label: 'Good', align: 'num', render: (i) => fmtNum(i.pcs_good) },
                        { key: 'pcs_defect', label: 'Defects', align: 'num', render: (i) => (i.pcs_defect ? html`<span style="color:var(--danger)">${fmtNum(i.pcs_defect)}</span><div class="cell-sub">${i.defect_notes || ''}</div>` : '0') },
                      ]
                    : []),
                  ...(load.status === 'loading' && prod ? [{ key: 'x', label: '', align: 'right', render: (i) => html`<${Button} size="sm" variant="ghost danger" icon="x" onClick=${() => remove(i)}>Remove<//>` }] : []),
                ]}
                rows=${load.items}
                empty=${html`<div class="muted small" style="padding:14px">Empty. Add batches from the list${load.status === 'loading' ? ' below' : ''}.</div>`}
              />
            <//>`}
        ${load.status === 'loading' && prod && html`<${ReadyList} load=${load} ready=${data.ready} onChange=${setData} />`}
      </div>
      <div class="stack">
        <${Card} title="Firing record" icon="thermometer">
          ${load.capacity_m2 ? html`<div class="mb-2"><${Meter} value=${load.m2} max=${load.capacity_m2} /><div class="tiny muted mt-1">${fmtQty(load.m2, 1)} of ${fmtQty(load.capacity_m2, 1)} m² capacity</div></div>` : ''}
          <${KV} items=${[
            ['Kiln', load.kiln_name],
            ['Operator', load.operator],
            ['Loaded', load.loaded_at ? fmtDateTime(load.loaded_at) : null],
            ['Fire start', load.fire_start ? fmtDateTime(load.fire_start) : null],
            ['Fire end', load.fire_end ? `${fmtDateTime(load.fire_end)} (${hours(load.fire_start, load.fire_end)})` : null],
            ['Unloaded', load.unloaded_at ? fmtDateTime(load.unloaded_at) : null],
            ['Peak temperature', load.peak_temp_c ? `${fmtNum(load.peak_temp_c)} °C` : null],
            ['Fuel used', load.fuel_kg ? `${fmtNum(load.fuel_kg)} kg` : null],
            load.status === 'unloaded' && ['Yield', pcs ? `${((good / pcs) * 100).toFixed(1)} % good · ${fmtNum(defects)} defects` : null],
          ]} />
          ${load.notes && html`<p class="small ink2 mt-2" style="white-space:pre-wrap">${load.notes}</p>`}
          ${prod && html`<div class="mt-2"><${Button} size="sm" variant="ghost" icon="edit" onClick=${async () => {
            const n = await promptDialog({ title: 'Kiln notes', label: 'Notes (weather, fuel quality, incidents)', initial: load.notes || '', multiline: true, required: false });
            if (n === null) return;
            try {
              const r = await put(`/kiln-loads/${load.id}`, { notes: n });
              setData((d) => ({ ...d, load: r.load }));
              toast('Notes saved');
            } catch (e) {
              toastError(e);
            }
          }}>Notes<//></div>`}
        <//>
        <${Card} title="Kiln trolley card" icon="qr">
          <div class="row top"><${QrImg} code=${load.number} size=${96} /><div class="small ink2">Scanning this code opens this load. Clip the printed kiln door label to the kiln; this load is found from there too.</div></div>
        <//>
      </div>
    </div>
    ${endModal && load.status === 'firing' && html`<${EndFiringModal} load=${load} onClose=${() => setEndModal(false)} onDone=${(r) => (setEndModal(false), setData((d) => ({ ...d, load: r.load })), toast('Firing finished - cooling'))} />`}
  </div>`;
}

function ReadyList({ load, ready, onChange }) {
  const [pcs, setPcs] = useState({});
  const kiln = { capacity_m2: load.capacity_m2 };
  const suggest = (r) => {
    const fit = fitPcs(kiln, load.m2, r.pcs_per_m2);
    return fit === null ? r.waiting : Math.min(r.waiting, fit);
  };
  const add = async (r) => {
    try {
      const out = await loadPieces(load.id, r.id, Number(pcs[r.id] || suggest(r)));
      if (!out) return;
      onChange(out);
      setPcs({ ...pcs, [r.id]: '' });
      toast(`${r.number} added`);
    } catch (e) {
      toastError(e);
    }
  };
  return html`<${Card} title="Add batches ready for firing" icon="plus" pad=${false}>
    <${DataTable}
      compact
      columns=${[
        { key: 'number', label: 'Batch', render: (r) => html`<div class="prod-cell"><img class="thumb sm" src=${r.image_url} alt="" /><div><div class="cell-main mono">${r.number}</div><div class="cell-sub">${r.sku} · ${r.lot_code}</div></div></div>` },
        { key: 'waiting', label: 'Waiting', align: 'num', render: (r) => html`${fmtNum(r.waiting)}${load.capacity_m2 && r.pcs_per_m2 ? html`<div class="cell-sub">${fmtNum(suggest(r))} fit</div>` : ''}` },
        { key: 'pcs', label: 'Load pcs', render: (r) => html`<input class="input num" style="width:96px;height:32px" type="number" min="1" max=${r.waiting} placeholder=${suggest(r)} value=${pcs[r.id] || ''} onInput=${(e) => setPcs({ ...pcs, [r.id]: e.target.value })} />` },
        { key: 'act', label: '', align: 'right', render: (r) => html`<${Button} size="sm" variant="primary" icon="plus" onClick=${() => add(r)}>Add<//>` },
      ]}
      rows=${ready}
      empty=${html`<div class="muted small" style="padding:14px">No batch is waiting for the kiln.</div>`}
    />
  <//>`;
}

function EndFiringModal({ load, onClose, onDone }) {
  const [v, setV] = useState({ peak_temp_c: '', fuel_kg: '', notes: load.notes || '' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      onDone(await post(`/kiln-loads/${load.id}/status`, { status: 'cooling', peak_temp_c: v.peak_temp_c === '' ? undefined : Number(v.peak_temp_c), fuel_kg: v.fuel_kg === '' ? undefined : Number(v.fuel_kg), notes: v.notes || undefined }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Modal} title=${`End firing · ${load.number}`} onClose=${onClose} icon="thermometer"
    footer=${html`<${Button} onClick=${onClose}>Cancel<//><${Button} variant="primary" loading=${busy} onClick=${go}>Start cooling<//>`}>
    <p class="ink2">Firing ran for ${hours(load.fire_start)}. Record what you know - it helps explain colour differences between loads later.</p>
    <div class="form-grid">
      <${Field} label="Peak temperature (°C)"><input class="input num" type="number" value=${v.peak_temp_c} onInput=${(e) => setV({ ...v, peak_temp_c: e.target.value })} /><//>
      <${Field} label="Fuel used (kg)"><input class="input num" type="number" value=${v.fuel_kg} onInput=${(e) => setV({ ...v, fuel_kg: e.target.value })} /><//>
      <${Field} label="Notes" class="span-2"><textarea class="textarea" value=${v.notes} onInput=${(e) => setV({ ...v, notes: e.target.value })}></textarea><//>
    </div>
  <//>`;
}

function UnloadForm({ load, onDone }) {
  const [rows, setRows] = useState(() => Object.fromEntries(load.items.map((i) => [i.id, { pcs_good: String(i.pcs_loaded), pcs_defect: '0', defect_notes: '', complete: true }])));
  const [busy, setBusy] = useState(false);
  const set = (id, k, val) =>
    setRows((r) => {
      const it = load.items.find((x) => x.id === id);
      const next = { ...r[id], [k]: val };
      if (k === 'pcs_defect') next.pcs_good = String(Math.max(0, it.pcs_loaded - Number(val || 0)));
      if (k === 'pcs_good') next.pcs_defect = String(Math.max(0, it.pcs_loaded - Number(val || 0)));
      return { ...r, [id]: next };
    });
  const bad = load.items.filter((i) => Number(rows[i.id].pcs_good || 0) + Number(rows[i.id].pcs_defect || 0) !== i.pcs_loaded);
  const go = async () => {
    setBusy(true);
    try {
      onDone(await post(`/kiln-loads/${load.id}/unload`, { items: load.items.map((i) => ({ item_id: i.id, ...rows[i.id], pcs_good: Number(rows[i.id].pcs_good), pcs_defect: Number(rows[i.id].pcs_defect) })) }));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return html`<${Card} title="Unload and count" sub="Good + defective must equal what was loaded" icon="checkCircle">
    <div class="stack sm">
      ${load.items.map((i) => {
        const r = rows[i.id];
        return html`<div class="unload-row">
          <div class="row" style="min-width:180px"><${Swatch} hex=${i.hex} size="lg" /><div><div class="mono strong">${i.mo_number}</div><div class="small muted">${i.sku} · ${fmtNum(i.pcs_loaded)} loaded</div></div></div>
          <${Field} label="Good"><input class="input num" type="number" min="0" value=${r.pcs_good} onInput=${(e) => set(i.id, 'pcs_good', e.target.value)} /><//>
          <${Field} label="Defective"><input class="input num" type="number" min="0" value=${r.pcs_defect} onInput=${(e) => set(i.id, 'pcs_defect', e.target.value)} /><//>
          <${Field} label="Defect"><select class="select" value=${r.defect_notes} onChange=${(e) => set(i.id, 'defect_notes', e.target.value)}><option value="">—</option>${SCRAP_REASONS.map((x) => html`<option>${x}</option>`)}</select><//>
          <label class="check small" title="Close firing for this batch when nothing else is waiting"><input type="checkbox" checked=${r.complete} onChange=${(e) => set(i.id, 'complete', e.target.checked)} />Firing done for this batch</label>
        </div>`;
      })}
    </div>
    ${bad.length > 0 && html`<div class="mt-2"><${Callout} tone="danger">Check ${bad.map((i) => i.mo_number).join(', ')}: good + defective must equal the pieces loaded.<//></div>`}
    <div class="row mt-3"><${Button} variant="primary" size="lg" icon="check" loading=${busy} disabled=${bad.length > 0} onClick=${go}>Unload and record<//><span class="small muted">Firing is closed per batch only when no more of its pieces are waiting.</span></div>
  <//>`;
}
