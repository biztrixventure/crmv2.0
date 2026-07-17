-- ============================================================================
-- 199 — portal_recording_meta: unique index on sale_id (fixes the 42P10 flood).
--
-- portal_recording_meta is the per-sale recording-resolve CACHE. portal.js
-- upserts it with `onConflict: 'sale_id'` (in a loop of up to 24 per
-- portal/compliance sale-list load), but the table had NO indexes at all — no
-- unique on sale_id — so every one of those upserts raised
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT
-- The error was swallowed (`.then(()=>{}, ()=>{})`), so it never surfaced to a
-- user, but: (a) it spammed the Postgres error log, and (b) the cache never
-- populated → every load re-resolved recordings live against the dialer (slow).
--
-- Add the unique index the upsert needs (one row per sale). Dedupe first,
-- keeping the most recently resolved row per sale_id.
-- ============================================================================

DELETE FROM portal_recording_meta a
 USING portal_recording_meta b
 WHERE a.sale_id = b.sale_id
   AND ( a.resolved_at < b.resolved_at
      OR (a.resolved_at = b.resolved_at AND a.ctid < b.ctid)
      OR (a.resolved_at IS NULL AND b.resolved_at IS NOT NULL) );

CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_recording_meta_sale
  ON portal_recording_meta (sale_id);
