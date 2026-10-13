import { useMemo, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { Icon } from './icons.js';

/**
 * columns: [{ key, label, render(row), align: 'num'|'right'|'center', sort: true | (row) => value, class, hideSm }]
 */
export function DataTable({ columns, rows, onRowClick, empty, rowKey = 'id', initialSort, footer, compact, rowClass, toolbar }) {
  const [sort, setSort] = useState(initialSort || null);
  const sorted = useMemo(() => {
    if (!sort) return rows || [];
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows || [];
    const val = typeof col.sort === 'function' ? col.sort : (r) => r[col.key];
    const out = [...(rows || [])].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    });
    return sort.dir === 'desc' ? out.reverse() : out;
  }, [rows, sort, columns]);

  const toggle = (c) => {
    if (!c.sort) return;
    setSort((s) => (s && s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.align === 'num' ? 'desc' : 'asc' }));
  };

  return html`${toolbar && html`<div class="table-toolbar">${toolbar}</div>`}
    <div class="table-wrap">
      <table class=${`table ${compact ? 'compact' : ''}`}>
        <thead>
          <tr>
            ${columns.map(
              (c) => html`<th class=${`${c.align === 'num' ? 'num' : ''} ${c.sort ? 'sortable' : ''} ${c.hideSm ? 'hide-sm' : ''} ${c.class || ''}`} style=${c.width ? { width: c.width } : null} onClick=${() => toggle(c)} aria-sort=${sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                ${c.label}${sort?.key === c.key && html`<${Icon} name=${sort.dir === 'asc' ? 'chevronUp' : 'chevronDown'} size="11" />`}
              </th>`,
            )}
          </tr>
        </thead>
        <tbody>
          ${sorted.map(
            (r, i) => html`<tr
              key=${r[rowKey] ?? i}
              class=${`${onRowClick ? 'clickable' : ''} ${rowClass ? rowClass(r) || '' : ''}`}
              tabIndex=${onRowClick ? 0 : undefined}
              onClick=${onRowClick ? (e) => !e.target.closest('a,button,input,select,label') && onRowClick(r, e) : undefined}
              onKeyDown=${onRowClick ? (e) => e.key === 'Enter' && onRowClick(r, e) : undefined}
            >
              ${columns.map((c) => html`<td class=${`${c.align === 'num' ? 'num' : c.align || ''} ${c.hideSm ? 'hide-sm' : ''} ${c.class || ''}`}>${c.render ? c.render(r, i) : r[c.key] ?? html`<span class="muted">—</span>`}</td>`)}
            </tr>`,
          )}
        </tbody>
        ${footer && html`<tfoot>${footer}</tfoot>`}
      </table>
    </div>
    ${(!rows || rows.length === 0) && empty}`;
}
