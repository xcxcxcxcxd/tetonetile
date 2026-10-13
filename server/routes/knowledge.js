import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { HttpError, notFound } from '../lib/http.js';

const DIR = path.join(config.root, 'docs', 'knowledge');
let cache = null;
let cacheAt = 0;

function parse(file) {
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const meta = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  const body = m ? raw.slice(m[0].length) : raw;
  const id = file.replace(/^\d+-/, '').replace(/\.md$/, '');
  const title = meta.title || (/^#\s+(.+)$/m.exec(body) || [])[1] || id;
  return {
    id,
    file,
    title,
    summary: meta.summary || '',
    system: meta.system || 'general',
    public: meta.public === 'true',
    tags: (meta.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    order: Number(meta.order || 99),
    body,
  };
}

/** All articles (cached for 10 s so edits to the markdown files show up quickly). */
export function listArticles(withBody = false) {
  if (!cache || Date.now() - cacheAt > 10000) {
    const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.md')).sort() : [];
    cache = files.map(parse).sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
    cacheAt = Date.now();
  }
  return cache.map((a) => (withBody ? a : { ...a, body: undefined }));
}

const r = Router();

r.get('/knowledge', (req, res) => {
  const list = listArticles().filter((a) => req.user || a.public);
  const q = String(req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ rows: list });
  const full = listArticles(true).filter((a) => req.user || a.public);
  const rows = full
    .map((a) => {
      const hay = `${a.title}\n${a.summary}\n${a.tags.join(' ')}\n${a.body}`.toLowerCase();
      const idx = hay.indexOf(q);
      if (idx < 0) return null;
      const bodyIdx = a.body.toLowerCase().indexOf(q);
      const snippet = bodyIdx >= 0 ? a.body.slice(Math.max(0, bodyIdx - 60), bodyIdx + 120).replace(/\s+/g, ' ') : a.summary;
      return { ...a, body: undefined, snippet, score: a.title.toLowerCase().includes(q) ? 2 : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.order - b.order);
  res.json({ rows });
});

r.get('/knowledge/:id', (req, res) => {
  const a = listArticles(true).find((x) => x.id === req.params.id);
  if (!a) throw notFound('Article not found');
  if (!a.public && !req.user) throw new HttpError(401, 'Please sign in.');
  res.json(a);
});

export default r;
