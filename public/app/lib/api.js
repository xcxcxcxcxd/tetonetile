// JSON API client. Every write carries the custom header the server requires (CSRF guard).
const listeners = new Set();
export const onUnauthorized = (fn) => listeners.add(fn);

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data || {};
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'zelligerar' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('No connection to the server. Check the network and try again.', 0);
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (res.status === 401 && !path.startsWith('/auth/')) listeners.forEach((fn) => fn());
  if (!res.ok) throw new ApiError((data && data.error) || res.statusText || 'Request failed', res.status, data);
  return data;
}

export const get = (p, opts) => api(p, opts);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });

export function qs(params) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : '';
}
