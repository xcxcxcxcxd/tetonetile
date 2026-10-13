import { useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { compact } from '../lib/format.js';

// Charts follow the dataviz rules: thin marks, hairline grid, one axis, legend for 2+ series,
// selective direct labels, hover tooltip on every chart, text in ink colours (never series colours).

function Tip({ tip }) {
  if (!tip) return null;
  const x = Math.min(tip.x + 14, window.innerWidth - 220);
  const y = Math.max(8, tip.y - 10);
  return html`<div class="chart-tip" style=${{ left: `${x}px`, top: `${y}px` }} role="tooltip">
    <div class="tip-title">${tip.title}</div>
    ${tip.rows.map((r) => html`<div class="tip-row">${r.color && html`<i class="key" style=${{ background: r.color }}></i>`}<b>${r.value}</b><span class="muted">${r.name}</span></div>`)}
  </div>`;
}

/** Horizontal bars for one measure across named items (stages, colours...). */
export function BarList({ items, format = (v) => compact(v), empty = 'No data yet', onClick }) {
  const [tip, setTip] = useState(null);
  const max = Math.max(1, ...items.map((i) => i.value || 0));
  if (!items.length || items.every((i) => !i.value)) return html`<div class="muted small" style="padding:8px 0">${empty}</div>`;
  return html`<div class="barlist" onMouseLeave=${() => setTip(null)}>
    ${items.map(
      (it) => html`<div
        class="barlist-row"
        style=${onClick ? 'cursor:pointer' : ''}
        tabIndex="0"
        onClick=${() => onClick && onClick(it)}
        onMouseMove=${(e) => setTip({ x: e.clientX, y: e.clientY, title: it.label, rows: [{ name: it.unit || '', value: format(it.value) }, ...(it.extra || [])] })}
        onFocus=${(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setTip({ x: r.right - 200, y: r.top, title: it.label, rows: [{ name: it.unit || '', value: format(it.value) }] });
        }}
        onBlur=${() => setTip(null)}
      >
        <span class="barlist-label">${it.swatch && html`<span class="swatch" style=${{ background: it.swatch }}></span>`}<span class="truncate">${it.label}</span></span>
        <span class="barlist-track"><span class="barlist-bar" style=${{ width: `${Math.max(0.5, ((it.value || 0) / max) * 100)}%` }}></span></span>
        <span class="barlist-value">${format(it.value)}</span>
      </div>`,
    )}
    <${Tip} tip=${tip} />
  </div>`;
}

/** Multi-series line chart on ONE axis with crosshair tooltip and end labels. */
export function LineChart({ labels, series, height = 220, format = (v) => compact(v), xFormat = (l) => l }) {
  const ref = useRef();
  const [hover, setHover] = useState(null);
  const W = 640;
  const H = height;
  const pad = { l: 44, r: 64, t: 12, b: 26 };
  const all = series.flatMap((s) => s.values);
  const maxRaw = Math.max(1, ...all);
  const step = niceStep(maxRaw / 4);
  const max = Math.ceil(maxRaw / step) * step;
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  const x = (i) => pad.l + (labels.length <= 1 ? 0 : (i * (W - pad.l - pad.r)) / (labels.length - 1));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('');
  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 0; i < labels.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover({ i: best, cx: e.clientX, cy: e.clientY });
  };
  const last = labels.length - 1;
  // end labels: nudge apart only if they would overlap by less than a line
  const ends = series.map((s) => ({ name: s.name, value: s.values[last], y: y(s.values[last] || 0) }));
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 13) {
    const mid = (ends[0].y + ends[1].y) / 2;
    const up = ends[0].y <= ends[1].y ? 0 : 1;
    ends[up].y = mid - 7;
    ends[1 - up].y = mid + 7;
  }
  return html`<div style="position:relative">
    ${series.length > 1 &&
    html`<div class="legend" style="margin-bottom:6px">${series.map((s) => html`<span><i style=${{ background: s.color }}></i>${s.name}</span>`)}</div>`}
    <svg class="chart" ref=${ref} viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${series.map((s) => s.name).join(', ')} onMouseMove=${onMove} onMouseLeave=${() => setHover(null)}>
      ${ticks.map((t) => html`<line class="grid-line" x1=${pad.l} x2=${W - pad.r} y1=${y(t)} y2=${y(t)} /><text x=${pad.l - 8} y=${y(t) + 3.5} text-anchor="end">${format(t)}</text>`)}
      <line class="axis-line" x1=${pad.l} x2=${W - pad.r} y1=${y(0)} y2=${y(0)} />
      ${labels.map((l, i) => (i % Math.ceil(labels.length / 6) === 0 || i === last ? html`<text x=${x(i)} y=${H - 8} text-anchor="middle">${xFormat(l)}</text>` : null))}
      ${series.length === 1 && html`<path d=${`${path(series[0].values)}L${x(last)} ${y(0)}L${x(0)} ${y(0)}Z`} fill=${series[0].color} opacity="0.1" />`}
      ${series.map((s) => html`<path d=${path(s.values)} fill="none" stroke=${s.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`)}
      ${series.map((s) => html`<circle cx=${x(last)} cy=${y(s.values[last] || 0)} r="4.5" fill=${s.color} stroke="var(--surface)" stroke-width="2" />`)}
      ${ends.map((e) => html`<text class="value-label" x=${x(last) + 9} y=${e.y + 4}>${format(e.value)}</text>`)}
      ${hover &&
      html`<line x1=${x(hover.i)} x2=${x(hover.i)} y1=${pad.t} y2=${y(0)} stroke="var(--border-strong)" stroke-width="1" />
        ${series.map((s) => html`<circle cx=${x(hover.i)} cy=${y(s.values[hover.i] || 0)} r="4.5" fill=${s.color} stroke="var(--surface)" stroke-width="2" />`)}`}
    </svg>
    ${hover &&
    html`<${Tip} tip=${{ x: hover.cx, y: hover.cy, title: xFormat(labels[hover.i], true), rows: series.map((s) => ({ name: s.name, color: s.color, value: format(s.values[hover.i]) })) }} />`}
  </div>`;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
