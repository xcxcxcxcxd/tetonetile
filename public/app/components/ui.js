import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { Icon } from './icons.js';
import { useStore, setState, openKb } from '../lib/store.js';
import { statusInfo } from '/shared/constants.js';
import { Link } from '../lib/router.js';

export function Button({ icon, iconRight, children, variant, size, loading, block, class: cls = '', type = 'button', ...rest }) {
  const classes = ['btn', variant, size, block && 'block', !children && icon && 'icon', cls].filter(Boolean).join(' ');
  return html`<button type=${type} class=${classes} disabled=${loading || rest.disabled} ...${rest}>
    ${loading ? html`<span class="spinner" style="width:15px;height:15px"></span>` : icon && html`<${Icon} name=${icon} />`}
    ${children}
    ${iconRight && html`<${Icon} name=${iconRight} />`}
  </button>`;
}

export function LinkButton({ href, icon, children, variant, size, class: cls = '', ...rest }) {
  const classes = ['btn', variant, size, !children && icon && 'icon', cls].filter(Boolean).join(' ');
  return html`<${Link} href=${href} class=${classes} ...${rest}>${icon && html`<${Icon} name=${icon} />`}${children}<//>`;
}

export function IconButton({ icon, label, size = 'sm', variant = 'ghost', ...rest }) {
  return html`<${Button} icon=${icon} variant=${variant} size=${size} aria-label=${label} title=${label} ...${rest} />`;
}

export function Badge({ tone = 'neutral', plain, class: cls = '', children, title }) {
  return html`<span class=${`badge ${tone} ${plain ? 'plain' : ''} ${cls}`} title=${title}>${children}</span>`;
}

export function StatusBadge({ map, value, label }) {
  const s = statusInfo(map, value);
  return html`<${Badge} tone=${s.tone}>${label || s.label}<//>`;
}

export function Card({ title, sub, actions, children, pad = true, foot, class: cls = '', icon, id }) {
  return html`<section class=${`card ${cls}`} id=${id}>
    ${(title || actions) &&
    html`<header class="card-head">
      ${icon && html`<${Icon} name=${icon} size="17" />`}
      <h3>${title} ${sub && html`<span class="sub">${sub}</span>`}</h3>
      ${actions}
    </header>`}
    ${pad ? html`<div class="card-body">${children}</div>` : children}
    ${foot && html`<footer class="card-foot">${foot}</footer>`}
  </section>`;
}

export function PageHeader({ overline, title, sub, actions, help, back }) {
  return html`<div class="page-head">
    <div class="titles">
      ${(overline || back) &&
      html`<div class="overline">
        ${back && html`<${Link} href=${back.href}><${Icon} name="arrowLeft" size="12" /> ${back.label}<//>`}
        ${back && overline && html`<span>·</span>`} ${overline && html`<span class="ov">${overline}</span>`}
      </div>`}
      <h1>${title}</h1>
      ${sub && html`<div class="page-sub">${sub}</div>`}
    </div>
    <div class="page-actions">
      ${actions}
      ${help && html`<${HelpButton} id=${help} />`}
    </div>
  </div>`;
}

export function HelpButton({ id, label = 'How this works' }) {
  return html`<${Button} icon="book" variant="ghost" size="sm" onClick=${() => openKb(id)} title="Open the knowledge panel">${label}<//>`;
}

export function EmptyState({ icon = 'inbox', title, text, action, kb }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} /></div>
    <h3>${title}</h3>
    ${text && html`<p>${text}</p>`}
    <div class="row" style="justify-content:center">
      ${action}
      ${kb && html`<${Button} variant="ghost" size="sm" icon="book" onClick=${() => openKb(kb)}>Read the procedure<//>`}
    </div>
  </div>`;
}

export const Loading = ({ label }) => html`<div class="loading-block"><div class="row muted"><span class="spinner"></span> ${label || 'Loading…'}</div></div>`;

export function ErrorBox({ error, retry }) {
  if (!error) return null;
  return html`<div class="callout danger" role="alert">
    <${Icon} name="alertCircle" />
    <div class="callout-body">
      <b>${error.status === 403 ? 'Not allowed' : 'Something went wrong'}</b>
      <div>${error.message}</div>
      ${retry && html`<${Button} size="sm" class="mt-1" icon="refresh" onClick=${retry}>Try again<//>`}
    </div>
  </div>`;
}

export function Callout({ tone = 'info', icon, title, children }) {
  const ic = icon || { info: 'info', warning: 'alert', danger: 'alertCircle', success: 'checkCircle' }[tone];
  return html`<div class=${`callout ${tone}`}>
    <${Icon} name=${ic} />
    <div class="callout-body">${title && html`<b>${title}</b> `}${children}</div>
  </div>`;
}

export function Field({ label, hint, error, children, class: cls = '', required }) {
  return html`<div class=${`field ${cls}`}>
    ${label && html`<label>${label}${required && html`<span style="color:var(--danger)">*</span>`}</label>`}
    ${children}
    ${error ? html`<div class="error">${error}</div>` : hint && html`<div class="hint">${hint}</div>`}
  </div>`;
}

/** Controlled input bound to form state: <Input form=${f} name="company" /> */
export function Input({ form, name, type = 'text', class: cls = '', ...rest }) {
  const value = form ? form.values[name] ?? '' : rest.value;
  return html`<input
    class=${`input ${type === 'number' ? 'num' : ''} ${form?.errors?.[name] ? 'invalid' : ''} ${cls}`}
    type=${type}
    value=${value}
    onInput=${(e) => form && form.set(name, type === 'number' ? (e.target.value === '' ? '' : e.target.value) : e.target.value)}
    ...${rest}
  />`;
}

export function Select({ form, name, options = [], placeholder, class: cls = '', ...rest }) {
  const value = form ? form.values[name] ?? '' : rest.value;
  return html`<select class=${`select ${cls}`} value=${value} onChange=${(e) => form && form.set(name, e.target.value)} ...${rest}>
    ${placeholder !== undefined && html`<option value="">${placeholder}</option>`}
    ${options.map((o) => (Array.isArray(o) ? html`<option value=${o[0]}>${o[1]}</option>` : html`<option value=${o.value}>${o.label}</option>`))}
  </select>`;
}

export function Textarea({ form, name, class: cls = '', ...rest }) {
  const value = form ? form.values[name] ?? '' : rest.value;
  return html`<textarea class=${`textarea ${cls}`} value=${value} onInput=${(e) => form && form.set(name, e.target.value)} ...${rest}></textarea>`;
}

export function Check({ form, name, label, checked, onChange, ...rest }) {
  const on = form ? !!Number(form.values[name]) || form.values[name] === true : !!checked;
  return html`<label class="check">
    <input type="checkbox" checked=${on} onChange=${(e) => (form ? form.set(name, e.target.checked ? 1 : 0) : onChange && onChange(e.target.checked))} ...${rest} />
    ${label}
  </label>`;
}

export function Toggle({ checked, onChange, label }) {
  return html`<label class="row" style="gap:10px;cursor:pointer">
    <span class="toggle"><input type="checkbox" checked=${checked} onChange=${(e) => onChange(e.target.checked)} /><span></span></span>
    ${label && html`<span>${label}</span>`}
  </label>`;
}

export function Seg({ options, value, onChange, class: cls = '' }) {
  return html`<div class=${`seg ${cls}`} role="tablist">
    ${options.map(
      (o) => html`<button type="button" role="tab" aria-selected=${String(o.value) === String(value)} class=${String(o.value) === String(value) ? 'on' : ''} onClick=${() => onChange(o.value)}>
        ${o.label}${o.count !== undefined && o.count !== null && html`<span class="count">${o.count}</span>`}
      </button>`,
    )}
  </div>`;
}

export function Tabs({ tabs, value, onChange }) {
  return html`<div class="tabs" role="tablist">
    ${tabs.map(
      (t) => html`<button type="button" role="tab" aria-selected=${t.key === value} class=${t.key === value ? 'on' : ''} onClick=${() => onChange(t.key)}>
        ${t.label}${t.count ? html`<span class="count">${t.count}</span>` : null}
      </button>`,
    )}
  </div>`;
}

function useEscape(onClose) {
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
}

export function Modal({ title, onClose, children, footer, size = '', icon }) {
  useEscape(onClose);
  const ref = useRef();
  useEffect(() => {
    const el = ref.current?.querySelector('input:not([type=hidden]), select, textarea, button.primary');
    if (el) setTimeout(() => el.focus(), 30);
  }, []);
  return html`<div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && onClose && onClose()}>
    <div class=${`modal ${size}`} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
      <div class="modal-head">${icon && html`<${Icon} name=${icon} size="18" />`}<h2>${title}</h2><${IconButton} icon="x" label="Close" onClick=${onClose} /></div>
      <div class="modal-body">${children}</div>
      ${footer && html`<div class="modal-foot">${footer}</div>`}
    </div>
  </div>`;
}

export function Drawer({ title, onClose, children, footer, actions }) {
  useEscape(onClose);
  return html`<div>
    <div class="drawer-overlay" onClick=${onClose}></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label=${title}>
      <div class="drawer-head"><h2>${title}</h2>${actions}<${IconButton} icon="x" label="Close" onClick=${onClose} /></div>
      <div class="drawer-body">${children}</div>
      ${footer && html`<div class="modal-foot">${footer}</div>`}
    </aside>
  </div>`;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return html`<div class="toasts" aria-live="polite">
    ${toasts.map(
      (t) => html`<div class=${`toast ${t.tone}`} key=${t.id}>
        <${Icon} name=${t.tone === 'success' ? 'checkCircle' : t.tone === 'danger' ? 'alertCircle' : t.tone === 'warning' ? 'alert' : 'info'} />
        <div>${t.message}</div>
      </div>`,
    )}
  </div>`;
}

// ---- imperative dialogs (confirm / prompt) ----
let dialogResolve = null;
export function confirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', tone = 'primary', cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    dialogResolve = resolve;
    setState({ dialog: { kind: 'confirm', title, message, confirmLabel, tone, cancelLabel } });
  });
}
export function promptDialog({ title, message, label, placeholder, initial = '', confirmLabel = 'Save', required = true, multiline = false, type = 'text' }) {
  return new Promise((resolve) => {
    dialogResolve = resolve;
    setState({ dialog: { kind: 'prompt', title, message, label, placeholder, initial, confirmLabel, required, multiline, type } });
  });
}

export function DialogHost() {
  const d = useStore((s) => s.dialog);
  const [val, setVal] = useState('');
  useEffect(() => {
    if (d) setVal(d.initial || '');
  }, [d]);
  if (!d) return null;
  const close = (result) => {
    setState({ dialog: null });
    if (dialogResolve) dialogResolve(result);
    dialogResolve = null;
  };
  const ok = () => {
    if (d.kind === 'prompt') {
      if (d.required && !String(val).trim()) return;
      close(val);
    } else close(true);
  };
  return html`<${Modal}
    title=${d.title}
    onClose=${() => close(d.kind === 'prompt' ? null : false)}
    footer=${html`<${Button} onClick=${() => close(d.kind === 'prompt' ? null : false)}>${d.cancelLabel || 'Cancel'}<//>
      <${Button} variant=${d.tone === 'danger' ? 'danger solid' : 'primary'} onClick=${ok}>${d.confirmLabel}<//>`}
  >
    ${d.message && html`<p class="ink2" style="white-space:pre-line">${d.message}</p>`}
    ${d.kind === 'prompt' &&
    html`<${Field} label=${d.label}>
      ${d.multiline
        ? html`<textarea class="textarea" value=${val} placeholder=${d.placeholder} onInput=${(e) => setVal(e.target.value)}></textarea>`
        : html`<input class="input" type=${d.type} value=${val} placeholder=${d.placeholder} onInput=${(e) => setVal(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && ok()} />`}
    <//>`}
  <//>`;
}

export function KV({ items }) {
  return html`<dl class="kv">
    ${items.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v === null || v === undefined || v === '' ? html`<span class="muted">—</span>` : v}</dd>`)}
  </dl>`;
}

export function Thumb({ src, size = '', alt = '', onClick }) {
  return html`<img class=${`thumb ${size}`} src=${src} alt=${alt} loading="lazy" onClick=${onClick} />`;
}

export const Swatch = ({ hex, size = '' }) => html`<span class=${`swatch ${size}`} style=${{ background: hex || '#ccc' }}></span>`;

export function QrImg({ code, text, size = 120, class: cls = 'qr-img' }) {
  const src = text ? `/api/qr.svg?text=${encodeURIComponent(text)}` : `/api/qr.svg?code=${encodeURIComponent(code)}`;
  return html`<img class=${cls} src=${src} width=${size} height=${size} alt=${`QR code ${code || ''}`} />`;
}

export function Meter({ value, max = 1, tone }) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const t = tone || (pct >= 100 ? 'bad' : pct >= 85 ? 'warn' : '');
  return html`<div class=${`meter ${t}`}><i style=${{ width: `${pct}%` }}></i></div>`;
}

export function Stat({ label, value, note, noteTone, icon, href }) {
  const body = html`<span class="stat-label">${icon && html`<${Icon} name=${icon} />`}${label}</span>
    <span class="stat-value">${value}</span>
    ${note && html`<span class=${`stat-note ${noteTone || ''}`}>${note}</span>`}`;
  return href ? html`<${Link} class="stat" href=${href}>${body}<//>` : html`<div class="stat">${body}</div>`;
}

/** Minimal form state: values, set(), errors from API (data.fields). */
export function useForm(initial) {
  const [values, setValues] = useState(initial || {});
  const [errors, setErrors] = useState({});
  return {
    values,
    errors,
    set: (k, v) => setValues((s) => ({ ...s, [k]: v })),
    setMany: (patch) => setValues((s) => ({ ...s, ...patch })),
    reset: (v) => {
      setValues(v || {});
      setErrors({});
    },
    fail: (e) => setErrors(e?.data?.fields || {}),
    clearErrors: () => setErrors({}),
  };
}
