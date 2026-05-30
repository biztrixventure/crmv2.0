// ============================================================================
// auditColumnGuard — runtime probe for the `last_modified_by` column added by
// migration 063. Routes call stampActor(table, payload, userId) which appends
// the column iff the probe says it exists; if migration 063 hasn't been
// applied on this environment yet, the column is silently omitted so writes
// still succeed instead of failing with Postgres 42703 (undefined_column).
//
// First call per table does a 0-row select probe; result is cached for the
// process lifetime since columns don't disappear at runtime.
// ============================================================================

const { supabaseAdmin } = require('../config/database');

const TABLES = ['transfers', 'sales', 'callbacks', 'callback_numbers'];
const cache = new Map();   // table -> boolean (column exists)

async function probe(table) {
  if (cache.has(table)) return cache.get(table);
  try {
    const { error } = await supabaseAdmin.from(table).select('last_modified_by').limit(0);
    // 42703 = undefined_column. Anything else is unrelated noise → assume the
    // column exists and let the real write surface the actual error.
    const exists = !(error && error.code === '42703');
    cache.set(table, exists);
    if (!exists) {
      // eslint-disable-next-line no-console
      console.warn(`[auditColumnGuard] ${table}.last_modified_by missing — apply migration 063_field_audit_log.sql to enable per-field audit attribution.`);
    }
    return exists;
  } catch {
    cache.set(table, true);   // probe failed for unrelated reason — don't strip
    return true;
  }
}

// Append last_modified_by to a write payload when safe. Caller passes a single
// payload object OR an array of payloads (bulk insert); we keep the same shape.
async function stampActor(table, payload, userId) {
  if (!userId) return payload;
  if (!TABLES.includes(table)) return payload;
  const ok = await probe(table);
  if (!ok) return payload;
  if (Array.isArray(payload)) return payload.map(p => ({ ...p, last_modified_by: userId }));
  return { ...payload, last_modified_by: userId };
}

// Pre-warm the cache at boot so the first user request doesn't pay the probe
// latency. Failures are swallowed — the per-table probe will retry on demand.
function warm() {
  TABLES.forEach(t => probe(t).catch(() => {}));
}

module.exports = { stampActor, warm };
