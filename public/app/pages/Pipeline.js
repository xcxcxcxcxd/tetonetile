import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, post, put, del, qs } from '../lib/api.js';
import { useAsync, useTitle, usePref } from '../lib/hooks.js';
import { Link, useQuery, setQuery } from '../lib/router.js';
import { boot, can, toast, toastError } from '../lib/store.js';
import { money, moneyCompact, fmtDate, fmtDateShort, fmtNum, daysUntil } from '../lib/format.js';
import { convert } from '/shared/calc.js';
import { OPP_STAGES, CURRENCIES } from '/shared/constants.js';
import { Button, PageHeader, Loading, ErrorBox, Field, Input, Select, Textarea, Modal, Badge, useForm, promptDialog, confirmDialog, Seg, EmptyState } from '../components/ui.js';
import { ClientPicker } from '../components/Combobox.js';
import { Icon } from '../components/icons.js';

export function Pipeline() {
  useTitle('Pipeline');
  const query = useQuery();
  const { data, error, loading, reload, setData } = useAsync(() => get('/opportunities'), []);
  const [form, setForm] = useState(query.get('new') ? { client_id: query.get('client_id') ? Number(query.get('client_id')) : null } : null);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [showClosed, setShowClosed] = usePref('pipeline.closed', false);
  const s = boot().settings;
  const cur = s?.defaults?.currency || 'EUR';
  const inCur = (o) => convert(o.value || 0, o.currency || cur, cur, s?.rates) ?? 0;

  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  if (loading && !data) return html`<${Loading} />`;
  const rows = data.rows;
  const stages = Object.entries(OPP_STAGES).filter(([k]) => showClosed || !['won', 'lost'].includes(k));

  const move = async (opp, stage) => {
    if (opp.stage === stage) return;
    let lost_reason;
    if (stage === 'lost') {
      lost_reason = await promptDialog({ title: `Why was "${opp.title}" lost?`, label: 'Reason', placeholder: 'Price, lead time, chose machine-made tile…' });
      if (!lost_reason) return;
    }
    setData((d) => ({ ...d, rows: d.rows.map((x) => (x.id === opp.id ? { ...x, stage } : x)) }));
    try {
      await put(`/opportunities/${opp.id}`, { stage, lost_reason });
      if (stage === 'won') toast('Won - convert the accepted quote into an order.');
      reload();
    } catch (e) {
      toastError(e);
      reload();
    }
  };

  const weighted = rows.filter((o) => !['won', 'lost'].includes(o.stage)).reduce((sum, o) => sum + inCur(o) * ((o.probability ?? OPP_STAGES[o.stage].probability) / 100), 0);
  return html`<div>
    <${PageHeader}
      overline="CRM"
      title="Pipeline"
      sub=${`${rows.filter((o) => !['won', 'lost'].includes(o.stage)).length} open opportunities · weighted ${moneyCompact(weighted, cur)}`}
      help="crm"
      actions=${html`<label class="check small"><input type="checkbox" checked=${showClosed} onChange=${(e) => setShowClosed(e.target.checked)} />Show won / lost</label>
        ${can('sales') && html`<${Button} variant="primary" icon="plus" onClick=${() => setForm({})}>New opportunity<//>`}`}
    />
    <div class="kanban">
      ${stages.map(([key, st]) => {
        const items = rows.filter((o) => o.stage === key);
        const total = items.reduce((sum, o) => sum + inCur(o), 0);
        return html`<div
          class=${`kanban-col ${over === key ? 'drop' : ''}`}
          onDragOver=${(e) => {
            e.preventDefault();
            setOver(key);
          }}
          onDragLeave=${() => setOver(null)}
          onDrop=${(e) => {
            e.preventDefault();
            setOver(null);
            const o = rows.find((x) => x.id === dragId);
            if (o) move(o, key);
          }}
        >
          <div class="kanban-head">
            <span class="k-dot" style=${{ background: `var(--${st.tone === 'neutral' ? 'faint' : st.tone})` }}></span>${st.label}
            <span class="k-count">${items.length} · ${moneyCompact(total, cur)}</span>
          </div>
          <div class="kanban-body">
            ${items.map((o) => {
              const d = daysUntil(o.expected_close);
              return html`<div class="k-card" draggable=${can('sales') ? 'true' : 'false'} onDragStart=${() => setDragId(o.id)} onClick=${() => setForm(o)}>
                <div class="k-title">${o.title}</div>
                <div class="muted small truncate mb-1"><${Link} href=${`/clients/${o.client_id}`} onClick=${(e) => e.stopPropagation()}>${o.client_name}</${Link}>${o.country ? ` · ${o.country}` : ''}</div>
                <div class="row between">
                  <b class="num">${money(o.value, o.currency, { decimals: 0 })}</b>
                  ${o.expected_close && html`<span class=${`badge plain ${d < 0 && !['won', 'lost'].includes(o.stage) ? 'danger' : ''}`}>${fmtDateShort(o.expected_close)}</span>`}
                </div>
                <div class="k-meta mt-1">
                  ${o.area_m2 ? html`<span>${fmtNum(o.area_m2)} m²</span>` : null}
                  ${o.samples ? html`<span><${Icon} name="package" size="12" /> ${o.samples}</span>` : null}
                  ${o.last_quote ? html`<${Link} href=${`/docs/${o.last_quote_id}`} onClick=${(e) => e.stopPropagation()}>${o.last_quote}</${Link}>` : null}
                  ${o.next_task ? html`<span><${Icon} name="clock" size="12" /> ${fmtDateShort(o.next_task)}</span>` : null}
                </div>
                ${o.stage === 'lost' && o.lost_reason && html`<div class="small muted mt-1">${o.lost_reason}</div>`}
              </div>`;
            })}
            ${!items.length && html`<div class="muted small center" style="padding:14px 4px">Drop here</div>`}
          </div>
        </div>`;
      })}
    </div>
    ${form &&
    html`<${OppForm}
      opp=${form}
      onClose=${() => (setForm(null), query.get('new') && setQuery({ new: '', client_id: '' }))}
      onSaved=${() => {
        setForm(null);
        reload();
      }}
    />`}
  </div>`;
}

function OppForm({ opp, onClose, onSaved }) {
  const isNew = !opp.id;
  const f = useForm({ stage: 'new', currency: boot().settings?.defaults?.currency || 'EUR', ...opp });
  const [client, setClient] = useState(opp.client_id ? { id: opp.client_id, company: opp.client_name || `Client #${opp.client_id}` } : null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f.values, client_id: client?.id };
      if (isNew) await post('/opportunities', body);
      else await put(`/opportunities/${opp.id}`, body);
      toast('Saved');
      onSaved();
    } catch (e) {
      f.fail(e);
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete this opportunity?', confirmLabel: 'Delete', tone: 'danger' }))) return;
    await del(`/opportunities/${opp.id}`);
    onSaved();
  };
  return html`<${Modal}
    title=${isNew ? 'New opportunity' : opp.title}
    size="wide"
    onClose=${onClose}
    footer=${html`${!isNew && can('sales') && html`<${Button} variant="ghost danger" icon="trash" onClick=${remove} style="margin-right:auto">Delete<//>`}
      ${!isNew && html`<a class="btn" href=${`/docs/new?type=quote&client_id=${opp.client_id}&opportunity_id=${opp.id}`}><${Icon} name="quote" />Quote it<//>`}
      <${Button} onClick=${onClose}>Close<//>${can('sales') && html`<${Button} variant="primary" loading=${busy} onClick=${save}>Save<//>`}`}
  >
    <div class="form-grid">
      <${Field} label="Client" required class="span-2"><${ClientPicker} value=${client} onChange=${setClient} autoFocus=${isNew} /><//>
      <${Field} label="Title" required class="span-2" error=${f.errors.title}><${Input} form=${f} name="title" placeholder="Hotel bathrooms, villa pool, showroom restock…" /><//>
      <${Field} label="Stage"><${Select} form=${f} name="stage" options=${Object.entries(OPP_STAGES).map(([k, v]) => [k, v.label])} /><//>
      <${Field} label="Expected close"><${Input} form=${f} name="expected_close" type="date" /><//>
      <${Field} label="Estimated value"><${Input} form=${f} name="value" type="number" min="0" /><//>
      <${Field} label="Currency"><${Select} form=${f} name="currency" options=${CURRENCIES.map((c) => [c, c])} /><//>
      <${Field} label="Surface (m²)"><${Input} form=${f} name="area_m2" type="number" min="0" /><//>
      <${Field} label="Probability %" hint="Defaults from the stage"><${Input} form=${f} name="probability" type="number" min="0" max="100" /><//>
      ${f.values.stage === 'lost' && html`<${Field} label="Why lost" class="span-2"><${Input} form=${f} name="lost_reason" /><//>`}
      <${Field} label="Notes" class="span-2"><${Textarea} form=${f} name="notes" /><//>
    </div>
  <//>`;
}

export function Tasks() {
  useTitle('Tasks');
  const [scope, setScope] = usePref('tasks.scope', 'mine');
  const { data, error, loading, reload } = useAsync(() => get(`/activities${qs({ type: 'task', mine: scope === 'mine' ? 1 : '' })}`), [scope]);
  if (error) return html`<${ErrorBox} error=${error} retry=${reload} />`;
  const rows = (data?.rows || []).filter((a) => a.type === 'task');
  const groups = [
    ['Overdue', (a) => !a.done && a.due_date && daysUntil(a.due_date) < 0],
    ['Today', (a) => !a.done && a.due_date && daysUntil(a.due_date) === 0],
    ['Next 7 days', (a) => !a.done && a.due_date && daysUntil(a.due_date) > 0 && daysUntil(a.due_date) <= 7],
    ['Later', (a) => !a.done && (!a.due_date || daysUntil(a.due_date) > 7)],
    ['Done', (a) => !!a.done],
  ];
  const toggle = async (a) => {
    try {
      await put(`/activities/${a.id}`, { done: a.done ? 0 : 1 });
      reload();
    } catch (e) {
      toastError(e);
    }
  };
  return html`<div>
    <${PageHeader} overline="CRM" title="Tasks" sub="Follow-ups from clients, opportunities and documents" help="crm" actions=${html`<${Seg} value=${scope} onChange=${setScope} options=${[{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'Everyone' }]} />`} />
    ${loading && !data
      ? html`<${Loading} />`
      : !rows.length
        ? html`<div class="card"><${EmptyState} icon="clipboard" title="No tasks" text="Add tasks from a client's activity panel - they show up here and on the dashboard." /></div>`
        : groups.map(([label, test]) => {
            const items = rows.filter(test);
            if (!items.length) return null;
            return html`<div class="card mb-3">
              <div class="card-head"><h3>${label} <span class="sub">${items.length}</span></h3></div>
              ${items.map(
                (a) => html`<div class="list-row">
                  <input type="checkbox" style="width:18px;height:18px;accent-color:var(--accent)" checked=${!!a.done} onChange=${() => toggle(a)} />
                  <div style="flex:1;min-width:0">
                    <div class=${a.done ? 'muted' : 'strong'} style=${a.done ? 'text-decoration:line-through' : ''}>${a.subject}</div>
                    <div class="small muted">
                      ${a.client_name && html`<${Link} href=${`/clients/${a.client_id}`}>${a.client_name}<//>`}
                      ${a.opportunity_title ? ` · ${a.opportunity_title}` : ''}${a.doc_number ? ` · ${a.doc_number}` : ''}${scope === 'all' && a.assigned_name ? ` · ${a.assigned_name}` : ''}
                    </div>
                  </div>
                  ${a.due_date && html`<${Badge} tone=${!a.done && daysUntil(a.due_date) < 0 ? 'danger' : 'neutral'} plain>${fmtDate(a.due_date)}<//>`}
                </div>`,
              )}
            </div>`;
          })}
  </div>`;
}
