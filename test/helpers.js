import { openDb, closeDb } from '../server/db.js';
import { seedReference } from '../server/seed.js';
import { createApp } from '../server/index.js';

/** Boots the app on an in-memory database and returns a tiny API client with a session. */
export async function boot() {
  openDb(':memory:');
  seedReference();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-requested-with': 'zelligerar', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }
  const api = {
    base,
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    put: (p, b = {}) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
    raw: call,
    clearCookie: () => {
      cookie = '';
    },
    async close() {
      await new Promise((r) => server.close(r));
      closeDb();
    },
  };
  return api;
}

export async function bootWithAdmin() {
  const api = await boot();
  const r = await api.post('/api/auth/setup', { name: 'Admin', email: 'admin@example.com', password: 'secret123' });
  if (r.status !== 200) throw new Error(`setup failed ${JSON.stringify(r.data)}`);
  return api;
}

export function ok(r, status = 200) {
  if (r.status !== status) throw new Error(`Expected ${status}, got ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
