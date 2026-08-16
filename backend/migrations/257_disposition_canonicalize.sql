-- ============================================================================
-- 257_disposition_canonicalize.sql
-- The Data Analyzer's Disposition filter listed 117 values for a few dozen real
-- outcomes: dialer codes (CA, CXWCU), VICIdial's 6-char truncations (DeadA,
-- Callba), misspellings (Warrenty), spacing variants (HangUp on Consent) and
-- duplicate config rows. This collapses every UNAMBIGUOUS case onto the long CRM
-- name. Anything needing a human answer is deliberately left alone — see the
-- "NOT touched" list at the bottom.
--
-- Fixed at the SOURCE: transfers.latest_disposition is a denormalized mirror of
-- disposition_actions (mig 100, trigger-fed), so patching the mirror would be
-- undone by the next dialer write. This rewrites disposition_actions and then
-- re-runs mig 100's backfill. The mirror trigger is disabled for the bulk update
-- (it would fire a per-row UPDATE on transfers for thousands of rows, all of it
-- thrown away by that backfill anyway).
--
-- Order matters: the map is corrected first, then data is rewritten THROUGH it.
-- Idempotent — safe to re-run.
-- ============================================================================

-- ── 1. correct the map itself ───────────────────────────────────────────────
-- BL: global said "Busy" while BOTH companies using it say "Litigator DNC".
-- That is global being wrong, in the dangerous direction — a litigator showing
-- as "busy" gets dialled again.
UPDATE vicidial_dispo_map SET disposition_name = 'Litigator DNC'
 WHERE company_id IS NULL AND upper(vici_code) = 'BL';

-- Codes that only ever existed as company rows get a GLOBAL row, so a company
-- that never mapped them still resolves. Only where every company that mapped
-- the code agrees on the meaning — a disputed code stays per-company.
INSERT INTO vicidial_dispo_map (company_id, vici_code, disposition_name)
SELECT NULL, upper(m.vici_code), min(m.disposition_name)
  FROM vicidial_dispo_map m
 WHERE m.company_id IS NOT NULL
   AND m.disposition_name IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM vicidial_dispo_map g
                    WHERE g.company_id IS NULL AND upper(g.vici_code) = upper(m.vici_code))
 GROUP BY upper(m.vici_code)
HAVING count(DISTINCT m.disposition_name) = 1;

-- ── 2. one canonical spelling, everywhere a name is stored ──────────────────
-- Verified first that no code compares against these strings, so this is a pure
-- data merge. postDate.js matches /post[\s_-]?date/i, so "PostDate" → "Post Date"
-- keeps working either way.
CREATE TEMP TABLE _canon(bad text, good text) ON COMMIT DROP;
INSERT INTO _canon VALUES
  ('Cannot Afford Warrenty',    'Cannot Afford Warranty'),
  ('Not Eligible For Warrenty', 'Not Eligible For Warranty'),
  ('Already Have Warrenty',     'Already Have Warranty'),
  ('HangUp on Consent',         'Hang Up on Consent'),
  ('PostDate',                  'Post Date'),
  ('Manaul Answering',          'Manual Answering');

UPDATE vicidial_dispo_map m SET disposition_name = c.good FROM _canon c WHERE m.disposition_name = c.bad;
UPDATE disposition_actions a SET disposition_name = c.good FROM _canon c WHERE a.disposition_name = c.bad;
UPDATE sales s               SET closer_disposition = c.good FROM _canon c WHERE s.closer_disposition = c.bad;
-- config rows: rename unless the good name already exists (then this row is a
-- duplicate and step 4 removes it)
UPDATE disposition_configs d SET name = c.good
  FROM _canon c
 WHERE d.name = c.bad
   AND NOT EXISTS (SELECT 1 FROM disposition_configs x WHERE x.name = c.good);

-- ── 3. rewrite dialer codes / truncations onto the long name ────────────────
ALTER TABLE disposition_actions DISABLE TRIGGER trg_sync_transfer_latest_disposition;

WITH resolved AS (
  SELECT a.id,
         COALESCE(
           (SELECT m.disposition_name FROM vicidial_dispo_map m
             WHERE m.company_id = a.company_id
               AND upper(m.vici_code) = upper(a.disposition_name)
               AND m.disposition_name IS NOT NULL LIMIT 1),
           (SELECT g.disposition_name FROM vicidial_dispo_map g
             WHERE g.company_id IS NULL
               AND upper(g.vici_code) = upper(a.disposition_name)
               AND g.disposition_name IS NOT NULL LIMIT 1)
         ) AS good
    FROM disposition_actions a
   WHERE a.disposition_name IS NOT NULL
     -- only rows that are NOT already a real CRM disposition
     AND NOT EXISTS (SELECT 1 FROM disposition_configs dc
                      WHERE dc.is_active AND lower(dc.name) = lower(a.disposition_name))
)
UPDATE disposition_actions a
   SET disposition_name = r.good
  FROM resolved r
 WHERE a.id = r.id AND r.good IS NOT NULL AND r.good <> a.disposition_name;

ALTER TABLE disposition_actions ENABLE TRIGGER trg_sync_transfer_latest_disposition;

-- same pass for sales (no trigger feeds this column)
WITH resolved AS (
  SELECT s.id,
         COALESCE(
           (SELECT m.disposition_name FROM vicidial_dispo_map m
             WHERE m.company_id = s.company_id AND upper(m.vici_code) = upper(s.closer_disposition)
               AND m.disposition_name IS NOT NULL LIMIT 1),
           (SELECT g.disposition_name FROM vicidial_dispo_map g
             WHERE g.company_id IS NULL AND upper(g.vici_code) = upper(s.closer_disposition)
               AND g.disposition_name IS NOT NULL LIMIT 1)
         ) AS good
    FROM sales s
   WHERE s.closer_disposition IS NOT NULL AND s.closer_disposition <> ''
     AND NOT EXISTS (SELECT 1 FROM disposition_configs dc
                      WHERE dc.is_active AND lower(dc.name) = lower(s.closer_disposition))
)
UPDATE sales s SET closer_disposition = r.good
  FROM resolved r
 WHERE s.id = r.id AND r.good IS NOT NULL AND r.good <> s.closer_disposition;

-- ── 4. one config row per disposition ───────────────────────────────────────
-- Two rows with the same name = two identical filter chips. Keep the oldest,
-- repoint the actions that referenced the twin (the FK is ON DELETE SET NULL —
-- repointing first keeps the link instead of dropping it), then delete it.
WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY lower(name), coalesce(company_id::text,'global')
                            ORDER BY created_at, id) rn,
         first_value(id) OVER (PARTITION BY lower(name), coalesce(company_id::text,'global')
                               ORDER BY created_at, id) keeper
    FROM disposition_configs
),
dupes AS (SELECT id, keeper FROM ranked WHERE rn > 1)
UPDATE disposition_actions a SET disposition_config_id = d.keeper
  FROM dupes d WHERE a.disposition_config_id = d.id;

DELETE FROM disposition_configs dc
 WHERE EXISTS (
   SELECT 1 FROM (
     SELECT id, row_number() OVER (PARTITION BY lower(name), coalesce(company_id::text,'global')
                                   ORDER BY created_at, id) rn
       FROM disposition_configs
   ) r WHERE r.id = dc.id AND r.rn > 1);

-- ── 5. repair the mirror (mig 100's own backfill) ───────────────────────────
UPDATE transfers t SET latest_disposition = sub.name
  FROM (SELECT DISTINCT ON (transfer_id) transfer_id, disposition_name AS name
          FROM disposition_actions ORDER BY transfer_id, created_at DESC NULLS LAST) sub
 WHERE t.id = sub.transfer_id
   AND t.latest_disposition IS DISTINCT FROM sub.name;

-- ============================================================================
-- NOT touched on purpose — these need a human answer:
--   • 17 codes nothing maps: BSC, IV, CAD, NPW, SRC, DeadT, TPA, ERI, CX,
--     DNCLi, HRMSX, DNCC, DX, LRERR, NNO, Bi, Sold (~420 rows). Guessing a
--     meaning silently mislabels every future call — pull the real names from
--     each dialer box's status list instead.
--   • CA  (global "Cannot Afford Warranty" vs 1-Vertex "Can't Afford") and
--     NAST (global "Invalid State" vs 1-Vertex "NA State") — one idea, two
--     wordings. The company row wins today, which is a legitimate choice.
--   • Workflow statuses that landed in the disposition field and are not
--     dispositions at all: "Sent to Compliance" (5.3k), "Needs Revision",
--     "Callback Scheduled", "Sold"/"closed_won" on sales.
-- ============================================================================
