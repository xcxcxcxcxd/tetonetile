import { useEffect, useState } from 'preact/hooks';
import { html } from './html.js';

const listeners = new Set();
let current = location.pathname + location.search;

function emit() {
  current = location.pathname + location.search;
  listeners.forEach((fn) => fn(current));
}
window.addEventListener('popstate', emit);

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  emit();
  if (!replace) window.scrollTo(0, 0);
}

export function useLocation() {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    listeners.add(setLoc);
    return () => listeners.delete(setLoc);
  }, []);
  return loc;
}

export function useQuery() {
  const loc = useLocation();
  return new URLSearchParams(loc.split('?')[1] || '');
}

export function setQuery(patch, { replace = true } = {}) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === '') p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  navigate(location.pathname + (s ? `?${s}` : ''), { replace });
}

/** routes: [[pattern, Component], ...] with patterns like '/clients/:id'. */
export function match(routes, path) {
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  for (const [pattern, component] of routes) {
    const names = [];
    const re = new RegExp(`^${pattern.replace(/\/+$/, '').replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)')) || '/'}$`);
    const m = re.exec(clean);
    if (m) return { component, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])), pattern };
  }
  return null;
}

/** <Link href> - client-side navigation, normal behaviour for new tab / modified clicks. */
export function Link({ href, children, class: cls, className, onClick, ...rest }) {
  return html`<a
    href=${href}
    class=${cls || className}
    onClick=${(e) => {
      if (onClick) onClick(e);
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!href || href.startsWith('http') || rest.target) return;
      e.preventDefault();
      navigate(href);
    }}
    ...${rest}
    >${children}</a
  >`;
}
