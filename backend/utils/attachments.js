// ============================================================================
// attachments.js — the size limit and the lifetime of chat + email files.
//
// ONE MODULE FOR BOTH SURFACES. chat.js and emails.js each carried their own
// `MAX_FILE_BYTES = 10 * 1024 * 1024`, so the cap was a constant in two files
// and a superadmin could not move it at all. That hard 10 MB is what users hit
// when "the file will not upload": measured 2026-10-16, the largest attachment
// ever stored is 9.875 MB and 31 are over 5 MB, so the pipeline works fine
// right up to the wall and then refuses. The wall is now a setting.
//
//   attachments.max_mb            how big one file may be      (default 25)
//   attachments.retention_hours   how long it lives, 0 = keep  (default 24)
//
// WHY THE CEILING EXISTS ANYWAY. A file travels to the API as base64 inside a
// JSON body, which inflates it by 4/3 — a 25 MB file is a ~33.4 MB request. So
// the express.json limit on those two routes has to be raised in step, and
// MAX_SETTABLE_MB is what the body parser was actually configured for. Letting
// an admin type 500 here would not give them 500 MB uploads, it would give
// them a confusing 413 from a parser that was never told. If files need to get
// much bigger than this, the answer is a signed direct-to-storage upload, not
// a bigger JSON body.
//
// EXPIRY BLANKS THE FILE, IT DOES NOT DELETE THE MESSAGE. A message that said
// "here is the recording" becomes nonsense if its attachment row vanishes, so
// the purge deletes the OBJECT and leaves the metadata behind marked
// `expired`. The conversation still reads correctly and the UI can say the
// file is gone instead of silently showing a dead link.
// ============================================================================

const { supabaseAdmin } = require('../config/database');
const { getConfig, setConfig } = require('./businessConfig');
const logger = require('./logger');

const DEFAULT_MAX_MB = 25;
const DEFAULT_RETENTION_HOURS = 24;

// Must stay in step with the express.json limits on /api/chat/upload and
// /api/emails/upload in server.js. 25 MB of file is ~33.4 MB of base64.
const MAX_SETTABLE_MB = 25;

const BUCKETS = {
  messages: 'chat-attachments',
  emails: 'email-attachments',
};

const clampMb = (v, fallback) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.round(n), 1), MAX_SETTABLE_MB);
};

const clampHours = (v, fallback) => {
  // UNSET IS NOT ZERO. 0 is the one meaningful falsy value here — "keep
  // forever" — but Number(null) is also 0, so an estate that had never saved
  // the setting read as retention OFF and nothing would ever have expired.
  // Only a real number counts; absence falls back to the default.
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  // 0 means "keep forever". Above that, a year is already far past the point
  // of this being a transient share.
  return Math.min(Math.round(n), 24 * 365);
};

async function settings() {
  const [mb, hours] = await Promise.all([
    getConfig(null, 'attachments.max_mb', null),
    getConfig(null, 'attachments.retention_hours', null),
  ]);
  return {
    max_mb: clampMb(mb, DEFAULT_MAX_MB),
    retention_hours: clampHours(hours, DEFAULT_RETENTION_HOURS),
    max_settable_mb: MAX_SETTABLE_MB,
  };
}

async function setSettings(patch, updatedBy) {
  const cur = await settings();
  if (patch && patch.max_mb !== undefined) {
    await setConfig('global', 'attachments.max_mb', clampMb(patch.max_mb, cur.max_mb), updatedBy);
  }
  if (patch && patch.retention_hours !== undefined) {
    await setConfig('global', 'attachments.retention_hours', clampHours(patch.retention_hours, cur.retention_hours), updatedBy);
  }
  return settings();
}

// The byte cap the upload routes enforce, read fresh so a change takes effect
// on the next upload rather than on the next deploy.
async function maxBytes() {
  const { max_mb } = await settings();
  return max_mb * 1024 * 1024;
}

// A public Storage URL carries its own object path after `/public/<bucket>/`.
// Anything that does not look like one is left alone rather than guessed at —
// a malformed url must never turn into a delete of the wrong key.
function objectPath(url, bucket) {
  const marker = `/public/${bucket}/`;
  const s = String(url || '');
  const i = s.indexOf(marker);
  if (i === -1) return null;
  try { return decodeURIComponent(s.slice(i + marker.length)); } catch { return null; }
}

// ── the purge ───────────────────────────────────────────────────────────────
// Deletes the stored object and marks the metadata `expired`. Bounded per run
// so one call can never turn into an unbounded delete across two buckets.
async function purgeExpired({ limit = 300 } = {}) {
  const { retention_hours } = await settings();
  if (!retention_hours) return { skipped: 'retention off', removed: 0 };

  const cutoff = new Date(Date.now() - retention_hours * 3600000).toISOString();
  let removed = 0;

  for (const [table, bucket] of Object.entries(BUCKETS)) {
    const { data: rows, error } = await supabaseAdmin
      .from(table)
      .select('id, attachments')
      .lt('created_at', cutoff)
      .not('attachments', 'is', null)
      .neq('attachments', '[]')
      // ALREADY-EXPIRED ROWS MUST BE EXCLUDED IN SQL, NOT SKIPPED IN JS. The
      // scan is oldest-first and bounded, so without this the run keeps
      // re-reading the same oldest `limit` rows it already emptied and never
      // reaches row limit+1 — the backlog would never drain.
      .not('attachments', 'cs', '[{"expired":true}]')
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) { logger.warn('ATTACH_PURGE', `${table}: ${error.message}`); continue; }

    for (const row of (rows || [])) {
      const list = Array.isArray(row.attachments) ? row.attachments : [];
      // Already done on a previous run — skip without touching storage again.
      if (!list.length || list.every(a => a?.expired)) continue;

      const paths = list.map(a => objectPath(a?.url, bucket)).filter(Boolean);
      if (paths.length) {
        const { error: rmErr } = await supabaseAdmin.storage.from(bucket).remove(paths);
        // A missing object is a success for our purposes: the point is that it
        // is gone. Only a real failure is worth stopping for.
        if (rmErr) { logger.warn('ATTACH_PURGE', `${bucket} remove: ${rmErr.message}`); continue; }
      }

      const next = list.map(a => ({
        name: a?.name || 'file', type: a?.type || null, size: a?.size || null,
        kind: a?.kind || 'file', expired: true,
      }));
      const { error: upErr } = await supabaseAdmin.from(table).update({ attachments: next }).eq('id', row.id);
      if (upErr) { logger.warn('ATTACH_PURGE', `${table} mark: ${upErr.message}`); continue; }
      removed += paths.length;
    }
  }

  if (removed) logger.info('ATTACH_PURGE', `expired ${removed} attachment(s) older than ${retention_hours}h`);
  return { removed };
}

// What the next sweeps will delete. Its own function, NOT part of settings():
// settings() is read on every single upload via maxBytes(), and two COUNT
// queries there would make the hot path pay for a number only the admin
// screen wants.
async function pendingPurge() {
  const { retention_hours } = await settings();
  if (!retention_hours) return { retention_hours: 0, total: 0, by_table: {} };

  const cutoff = new Date(Date.now() - retention_hours * 3600000).toISOString();
  const by_table = {};
  let total = 0;

  for (const table of Object.keys(BUCKETS)) {
    const { count, error } = await supabaseAdmin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .lt('created_at', cutoff)
      .not('attachments', 'is', null)
      .neq('attachments', '[]')
      .not('attachments', 'cs', '[{"expired":true}]');
    if (error) { logger.warn('ATTACH_PURGE', `count ${table}: ${error.message}`); continue; }
    by_table[table] = count || 0;
    total += count || 0;
  }
  return { retention_hours, cutoff, total, by_table };
}

module.exports = {
  DEFAULT_MAX_MB, DEFAULT_RETENTION_HOURS, MAX_SETTABLE_MB, BUCKETS,
  settings, setSettings, maxBytes, objectPath, purgeExpired, pendingPurge,
};
