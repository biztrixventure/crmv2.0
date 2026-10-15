-- ============================================================================
-- 347_user_scratchpad.sql — a private spreadsheet and notepad for every user.
--
-- ONE ROW PER (PERSON, KIND), and that is the whole schema. x-spreadsheet
-- already holds MANY sheets inside ONE document (its getData() returns an
-- array of named sheets), so "a spreadsheet per user" needs one row, not a
-- documents table with a list UI, a rename flow and an orphan problem. The
-- notepad is the same shape with a different kind, which is why they share a
-- table instead of being two near-identical ones.
--
-- The composite primary key IS the ownership rule: a person cannot have two
-- sheets, and a row cannot exist without naming its owner. Nothing here is
-- shared, assigned, or visible to anyone else — there is deliberately no
-- company_id, because this is a scratchpad, not a CRM record.
--
-- SIZE IS CAPPED IN THE DATABASE, not only in the route. A spreadsheet is a
-- blob the browser decides the size of, and "lightweight" has to survive
-- somebody pasting fifty thousand rows into it. 1 MB of JSON is a very large
-- sheet (tens of thousands of populated cells) and a trivial row to fetch; the
-- constraint means a runaway client gets a clean 400 from the check rather
-- than quietly turning this table into the next qa2_call.
--
-- RLS on, no policies, revoked from anon + authenticated: every read and write
-- goes through the service role in routes/scratchpad.js, which scopes to
-- req.user.id on every single query. The anon key must never be able to read
-- one user's notes by changing a uuid.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_scratchpad (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text        NOT NULL CHECK (kind IN ('sheet', 'note')),
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind),
  -- ~1 MB of JSON. pg_column_size reads the COMPRESSED toasted size, which is
  -- what the row actually costs, so a sheet of repetitive text compresses well
  -- and a genuinely huge one is still stopped.
  CONSTRAINT user_scratchpad_size CHECK (pg_column_size(data) <= 1048576)
);

COMMENT ON TABLE public.user_scratchpad IS
  'Private per-user scratchpad: one x-spreadsheet document and one notepad per '
  'person. Never shared, never company-scoped. Service-role only.';

ALTER TABLE public.user_scratchpad ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_scratchpad FROM PUBLIC;
REVOKE ALL ON public.user_scratchpad FROM anon;
REVOKE ALL ON public.user_scratchpad FROM authenticated;
GRANT ALL ON public.user_scratchpad TO service_role;

-- The PK already covers (user_id) and (user_id, kind), which is every lookup
-- the route makes. No second index: this table is written far more often than
-- it is queried, and an index nobody reads is pure write cost — the lesson
-- qa2_call's 742 MB of indexes taught (migs 344-346).
