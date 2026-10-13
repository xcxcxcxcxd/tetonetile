import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';

let db = null;
const cache = new Map();

export function openDb(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  cache.clear();
  migrate();
  return db;
}

export function closeDb() {
  if (db) db.close();
  db = null;
  cache.clear();
}

export const getDb = () => db;

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const dir = path.join(config.root, 'server', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(f);
    })();
  }
}

function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

export const all = (sql, ...params) => stmt(sql).all(...params);
export const get = (sql, ...params) => stmt(sql).get(...params);
export const run = (sql, ...params) => stmt(sql).run(...params);
export const tx = (fn) => db.transaction(fn)();

/** INSERT from an object; returns the new id. */
export function insert(table, values) {
  const keys = Object.keys(values);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(stmt(sql).run(...keys.map((k) => values[k])).lastInsertRowid);
}

/** UPDATE by id from an object (only the given keys). */
export function update(table, id, values) {
  const keys = Object.keys(values);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  return stmt(sql).run(...keys.map((k) => values[k]), id).changes;
}

// ---- settings (JSON values) ----
export function getSetting(key, fallback = null) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  if (!r) return fallback;
  try {
    return JSON.parse(r.value);
  } catch {
    return fallback;
  }
}

export function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export const today = () => new Date().toISOString().slice(0, 10);
export const nowTs = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
