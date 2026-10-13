import { useEffect, useRef, useState, useCallback } from 'preact/hooks';

/** Load data; keeps the previous data visible while reloading. */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => fn(ctrl.signal))
      .then(
        (data) => alive && setState({ data, error: null, loading: false }),
        (error) => alive && error?.name !== 'AbortError' && setState((s) => ({ ...s, error, loading: false })),
      );
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((d) => setState((s) => ({ ...s, data: typeof d === 'function' ? d(s.data) : d })), []);
  return { ...state, reload, setData };
}

export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Zelligerar` : 'Zelligerar · Factory CRM';
  }, [title]);
}

/** Global keyboard shortcut, ignored while typing in a field (unless allowInInput). */
export function useHotkey(test, handler, { allowInInput = false } = {}) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing && !allowInInput) return;
      if (test(e)) ref.current(e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}

/** Simple persisted preference (localStorage, safe in private mode). */
export function usePref(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(`pref:${key}`);
      return raw === null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (x) => {
      setV(x);
      try {
        localStorage.setItem(`pref:${key}`, JSON.stringify(x));
      } catch {
        /* ignore */
      }
    },
    [key],
  );
  return [v, set];
}
