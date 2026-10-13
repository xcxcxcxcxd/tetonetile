import { run } from '../db.js';

export function audit(req, entity, entityId, action, summary = null) {
  run(
    'INSERT INTO audit_log (user_id, entity, entity_id, action, summary) VALUES (?, ?, ?, ?, ?)',
    req?.user?.id ?? null,
    entity,
    entityId ?? null,
    action,
    summary ? String(summary).slice(0, 500) : null,
  );
}
