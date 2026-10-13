import { Router } from 'express';
import { getDb, get, insert, update, run } from '../db.js';
import { clean } from './validate.js';
import { idParam, notFound, conflict } from './http.js';
import { requireRole } from '../auth.js';
import { audit } from './audit.js';

/**
 * Generic list / get / create / update / delete router for simple tables.
 * opts: { table, spec, entity, write: [roles], search: [cols], filters: [cols], sortable: [cols],
 *         defaultSort, select, from, label: (row) => string, beforeSave(values, req, existing), afterSave(id, req) }
 */
export function crud(opts) {
  const {
    table,
    spec,
    entity = table,
    write = [],
    remove = write,
    search = [],
    filters = [],
    sortable = [],
    defaultSort = `${table}.id DESC`,
    select = `${table}.*`,
    from = table,
    label = (r) => r.name || r.code || `#${r.id}`,
    beforeSave,
    afterSave,
    canDelete,
  } = opts;
  const r = Router();
  const prepareDyn = (sql) => getDb().prepare(sql);

  r.get('/', (req, res) => {
    const where = [];
    const params = [];
    const q = String(req.query.q || '').trim();
    if (q && search.length) {
      where.push(`(${search.map((c) => `${c} LIKE ?`).join(' OR ')})`);
      for (let i = 0; i < search.length; i++) params.push(`%${q}%`);
    }
    for (const f of filters) {
      const v = req.query[f];
      if (v === undefined || v === '') continue;
      where.push(`${table}.${f} = ?`);
      params.push(v);
    }
    let order = defaultSort;
    if (req.query.sort && sortable.includes(req.query.sort)) order = `${req.query.sort} ${req.query.dir === 'desc' ? 'DESC' : 'ASC'}`;
    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = prepareDyn(`SELECT ${select} FROM ${from} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = prepareDyn(`SELECT COUNT(*) AS n FROM ${from} ${w}`).get(...params).n;
    res.json({ rows, total });
  });

  r.get('/:id', (req, res) => {
    const row = prepareDyn(`SELECT ${select} FROM ${from} WHERE ${table}.id = ?`).get(idParam(req));
    if (!row) throw notFound();
    res.json(row);
  });

  r.post('/', requireRole(...write), (req, res) => {
    const values = clean(spec, req.body);
    if (beforeSave) beforeSave(values, req, null);
    const id = insert(table, values);
    audit(req, entity, id, 'create', label({ id, ...values }));
    if (afterSave) afterSave(id, req);
    res.status(201).json(get(`SELECT * FROM ${table} WHERE id = ?`, id));
  });

  r.put('/:id', requireRole(...write), (req, res) => {
    const id = idParam(req);
    const existing = get(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!existing) throw notFound();
    const values = clean(spec, req.body, { partial: true });
    if (beforeSave) beforeSave(values, req, existing);
    if ('updated_at' in existing) values.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    update(table, id, values);
    audit(req, entity, id, 'update', label({ ...existing, ...values }));
    if (afterSave) afterSave(id, req);
    res.json(get(`SELECT * FROM ${table} WHERE id = ?`, id));
  });

  r.delete('/:id', requireRole(...remove), (req, res) => {
    const id = idParam(req);
    const existing = get(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!existing) throw notFound();
    if (canDelete) {
      const why = canDelete(existing);
      if (why) throw conflict(why);
    }
    try {
      run(`DELETE FROM ${table} WHERE id = ?`, id);
    } catch (e) {
      if (String(e.message).includes('FOREIGN KEY')) throw conflict(`${label(existing)} is used elsewhere and cannot be deleted. Deactivate it instead.`);
      throw e;
    }
    audit(req, entity, id, 'delete', label(existing));
    res.json({ ok: true });
  });

  return r;
}
