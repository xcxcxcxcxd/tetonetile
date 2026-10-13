import { useEffect, useReducer } from 'preact/hooks';
import { get } from './api.js';

// Tiny global store: bootstrap data, toasts, knowledge panel, palette.
const state = {
  boot: null,
  toasts: [],
  kb: { open: false, id: null },
  palette: false,
  navOpen: false,
  theme: (() => {
    try {
      return localStorage.getItem('theme') || 'auto';
    } catch {
      return 'auto';
    }
  })(),
};
const subs = new Set();

export const getState = () => state;

export function setState(patch) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  subs.forEach((fn) => fn());
}

export function useStore(select = (s) => s) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    subs.add(force);
    return () => subs.delete(force);
  }, []);
  return select(state);
}

let toastId = 0;
export function toast(message, tone = 'success', ms = 3800) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
}
export const toastError = (e) => toast(e?.message || String(e), 'danger', 6000);

export function openKb(id = null) {
  setState({ kb: { open: true, id } });
}
export const closeKb = () => setState({ kb: { open: false, id: null } });

export function applyTheme(theme) {
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* private mode */
  }
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  setState({ theme });
}

/** Lookups from the bootstrap payload. */
export const boot = () => state.boot || {};
export const can = (...roles) => {
  const r = state.boot?.user?.role;
  return r === 'admin' || roles.includes(r);
};

/** Reload the cached lookups (after settings changes). */
export async function refreshBoot() {
  setState({ boot: await get('/bootstrap') });
}
