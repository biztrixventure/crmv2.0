-- 053_raise_max_rows.sql
-- Raise PostgREST's per-response row cap from the default 1000 → 5000.
--
-- Why: the API (PostgREST) caps EVERY response at db-max-rows regardless of the
-- requested `limit`, which is the root of the recurring "only 1000 rows" class of
-- bugs (status counts, exports, bulk-sale transfer reads). The app still paginates
-- explicitly with .range()/.limit(), so this only lifts the ceiling for the few
-- intentionally-large reads.
--
-- Reversible: set it back to '1000' to undo. Apply in the Supabase SQL editor.
-- (Equivalent to Dashboard → Settings → API → "Max rows".)

ALTER ROLE authenticator SET pgrst.db_max_rows = '5000';

-- Tell PostgREST to reload its config immediately (otherwise applies on next boot).
NOTIFY pgrst, 'reload config';
