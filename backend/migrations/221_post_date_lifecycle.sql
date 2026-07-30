-- ============================================================================
-- 221_post_date_lifecycle.sql
-- Give a post-dated sale a lifecycle: when it became one, every failed charge
-- attempt and why, and when it finally converted into a real sale.
--
-- ── WHAT A POST-DATE IS ─────────────────────────────────────────────────────
-- A reminder, not a sale. The card has NOT been charged. It sits in the closer's
-- Post Date tab until the day they picked, when they call the customer and
-- either take the payment (→ real sale) or record why it failed and pick a new
-- date. Migration 083 added sales.charge_at / charge_notified_at; the scheduler
-- (utils/callbackScheduler.js processDueCharges) already fires the reminder.
-- Everything AFTER the reminder was missing, and this migration is that half.
--
-- ── THE TWO DEFECTS THIS CLOSES ─────────────────────────────────────────────
-- 1. Charging a post-date DESTROYED the evidence it ever was one.
--    StaffShell.chargeSale did:
--        PUT sales/:id { closer_disposition: 'sale', charge_at: null }
--    Both post-date markers overwritten in one call. Nothing on the sales row
--    survived, so compliance could not tell a converted post-date from a sale
--    that was always a sale — the P→S pill had nothing to read.
--
--    policy_events (087) looked like the answer: its type CHECK already allows
--    'post_dated' and 'charged'. Measured on this database 2026-07-30 before
--    writing this file: post_dated = 0 rows, charged = 26. The trigger NEVER
--    inserts 'post_dated', and its 'charged' branch fires on charge_notified_at
--    — the REMINDER stamp written by the scheduler, not the charge. A closer who
--    charges before the reminder fires produces no event at all. So the timeline
--    could not answer the question either, and a persisted marker is required.
--
-- 2. A failed charge had nowhere to go. No reason, no retry, no record. The
--    closer's only options were to leave it sitting or quietly delete it.
--
-- ── WHY A TRIGGER STAMPS THE MARKERS, NOT ROUTE CODE ────────────────────────
-- Same reasoning as 087: sales rows are written by the sale form, the edit
-- drawer, compliance, bulk upload, Data Cleanup and the dialer import. A marker
-- set in one route is a marker missing from the other six. fn_stamp_post_date is
-- a BEFORE trigger that only ever assigns to NEW — its own row.
--
-- ⚠ It does NOT touch sibling rows and does NOT use a partial UNIQUE index. That
-- is the 088 lesson (see CLAUDE.md): a per-row BEFORE trigger that mutated
-- siblings broke every multi-row bulk insert and had to be reverted by 090.
-- NEW-only assignment is bulk-safe, so a 500-row upload behaves exactly as it
-- does today.
--
-- ── ATTEMPTS ARE APPEND-ONLY ────────────────────────────────────────────────
-- post_date_attempts keeps every failed charge, so "declined twice then paid" is
-- still readable a month later. sales.last_charge_fail_* is a denormalized copy
-- of the newest attempt so the Post Date tab and the compliance list can show
-- the reason without a join per row.
--
-- ── REASON VOCABULARY ───────────────────────────────────────────────────────
-- Seeded into business_config as post_date_fail_reasons, the same catalog shape
-- as cancellation_reasons (mig 076): { key, label, category, enabled }. Editable
-- in AdminPanel → Business Rules → Post Dates. Seeded values are a starting
-- point, not a contract — reason_key is free text on purpose so a key retired
-- from the catalog still resolves on historical rows.
--
-- Apply: paste into the Supabase SQL editor. Plain DDL/DML — no CONCURRENTLY, so
-- the editor's implicit transaction is fine. sales is ~10k rows; the backfill is
-- a single UPDATE plus one INSERT..SELECT over policy_events.
-- Idempotent + additive. Safe to run twice.
-- ============================================================================

-- ── Markers on the sale ─────────────────────────────────────────────────────
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS post_dated_at               timestamptz,
  ADD COLUMN IF NOT EXISTS post_date_converted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS last_charge_fail_reason_key text,
  ADD COLUMN IF NOT EXISTS last_charge_fail_at         timestamptz;

COMMENT ON COLUMN sales.post_dated_at IS
  'When this sale was FIRST saved with a post-date disposition. Never cleared — this is what survives the charge and lets compliance see a sale came from a post-date (the P→S pill). Stamped by trg_stamp_post_date.';
COMMENT ON COLUMN sales.post_date_converted_at IS
  'When the post-date was charged and became a real sale (disposition flipped off post-date). NULL while still pending. post_dated_at IS NOT NULL AND post_date_converted_at IS NOT NULL = converted.';
COMMENT ON COLUMN sales.last_charge_fail_reason_key IS
  'Newest post_date_attempts.reason_key, denormalized so lists render the reason without a per-row join. Free text: keys retired from the business_config catalog still resolve on old rows.';
COMMENT ON COLUMN sales.last_charge_fail_at IS
  'Timestamp of the newest failed charge attempt.';

-- Partial: only post-dates carry these, and the pill query asks for exactly
-- "post_dated_at IS NOT NULL".
CREATE INDEX IF NOT EXISTS idx_sales_post_dated_at
  ON sales(post_dated_at) WHERE post_dated_at IS NOT NULL;

-- ── Attempt log (append-only) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_date_attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id            uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  reason_key         text NOT NULL,
  note               text,
  previous_charge_at timestamptz,      -- the date that just failed
  next_charge_at     timestamptz,      -- the retry the closer picked
  actor_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE post_date_attempts IS
  'Every failed charge on a post-dated sale: why it failed and which date the closer rescheduled to. Append-only — never updated, never deleted except by the sale''s own cascade. Compliance reads this to see why a post-date has been sitting for three weeks.';

CREATE INDEX IF NOT EXISTS idx_post_date_attempts_sale ON post_date_attempts(sale_id, created_at DESC);

-- ── Marker trigger ──────────────────────────────────────────────────────────
-- BEFORE INSERT/UPDATE, NEW-only. Mirrors isPostDateDispo() in
-- frontend/src/utils/dispositions.js and excludePostDate() in
-- backend/utils/postDate.js — if you change one regex, change all three.
CREATE OR REPLACE FUNCTION fn_stamp_post_date()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  is_pd_new boolean;
  is_pd_old boolean;
BEGIN
  is_pd_new := COALESCE(NEW.closer_disposition, '') ~* 'post[[:space:]_-]?date|postdate';

  IF TG_OP = 'INSERT' THEN
    IF is_pd_new AND NEW.post_dated_at IS NULL THEN
      NEW.post_dated_at := COALESCE(NEW.created_at, now());
    END IF;
    RETURN NEW;
  END IF;

  is_pd_old := COALESCE(OLD.closer_disposition, '') ~* 'post[[:space:]_-]?date|postdate';

  -- Became a post-date (new sale saved as one, or an existing sale switched to
  -- it). First stamp wins: post_dated_at is the ORIGIN, so a sale that goes
  -- post-date → sale → post-date again keeps its first date.
  IF is_pd_new AND NEW.post_dated_at IS NULL THEN
    NEW.post_dated_at := now();
  END IF;

  -- Left post-date → this is the charge. Stamped once; a later re-post-dating
  -- does not clear it, because the sale genuinely did convert once.
  IF is_pd_old AND NOT is_pd_new AND NEW.post_date_converted_at IS NULL THEN
    NEW.post_date_converted_at := now();
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Marker bookkeeping must never block a sale write. Same posture as 087.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_post_date ON sales;
CREATE TRIGGER trg_stamp_post_date
  BEFORE INSERT OR UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION fn_stamp_post_date();

-- ── Backfill ────────────────────────────────────────────────────────────────
-- (a) Still post-dated right now — the disposition itself is the evidence.
--     created_at is the honest approximation; there is no better timestamp.
UPDATE sales
   SET post_dated_at = COALESCE(created_at, now())
 WHERE closer_disposition ILIKE '%post%date%'
   AND post_dated_at IS NULL;

-- (b) Already converted. The ONLY surviving trace is a policy_events 'charged'
--     row (087 writes it when charge_notified_at is first set). That covers a
--     post-date whose reminder fired before it was charged — 26 rows on this
--     database — and misses any charged before the reminder. Nothing recoverable
--     exists for those; they simply get no pill, which is honest.
UPDATE sales s
   SET post_dated_at          = COALESCE(s.post_dated_at, e.first_charged),
       post_date_converted_at = COALESCE(s.post_date_converted_at, e.first_charged)
  FROM (
        SELECT sale_id, MIN(at) AS first_charged
          FROM policy_events
         WHERE event_type = 'charged'
         GROUP BY sale_id
       ) e
 WHERE e.sale_id = s.id
   AND s.closer_disposition NOT ILIKE '%post%date%'
   AND s.post_dated_at IS NULL;

-- ── Reason catalog ──────────────────────────────────────────────────────────
-- Same shape as cancellation_reasons (076). DO NOTHING on conflict so a list an
-- admin has already curated is never overwritten by a re-run.
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'post_date_fail_reasons',
    '[
      {"key":"insufficient_funds",  "label":"Insufficient funds",             "category":"payment",  "enabled":true},
      {"key":"declined_card",       "label":"Card declined",                  "category":"payment",  "enabled":true},
      {"key":"expired_card",        "label":"Card expired / details changed", "category":"payment",  "enabled":true},
      {"key":"wrong_card_details",  "label":"Wrong card details on file",     "category":"payment",  "enabled":true},
      {"key":"no_answer",           "label":"Customer did not answer",        "category":"customer", "enabled":true},
      {"key":"asked_to_reschedule", "label":"Customer asked to reschedule",   "category":"customer", "enabled":true},
      {"key":"customer_refused",    "label":"Customer refused to pay",        "category":"customer", "enabled":true},
      {"key":"other",               "label":"Other (see note)",               "category":"other",    "enabled":true}
    ]'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- ── post-apply verification ─────────────────────────────────────────────────
-- 1. Every currently post-dated sale has an origin stamp. Expect 0.
--    SELECT count(*) FROM sales
--     WHERE closer_disposition ILIKE '%post%date%' AND post_dated_at IS NULL;
--
-- 2. Converted post-dates recovered from the event trail. Expect ~26 here.
--    SELECT count(*) FROM sales
--     WHERE post_dated_at IS NOT NULL AND post_date_converted_at IS NOT NULL;
--
-- 3. The trigger fires on conversion — run inside a transaction and ROLL BACK:
--    BEGIN;
--      UPDATE sales SET closer_disposition = 'sale'
--       WHERE id = (SELECT id FROM sales
--                    WHERE closer_disposition ILIKE '%post%date%'
--                    ORDER BY created_at DESC LIMIT 1)
--      RETURNING id, post_dated_at, post_date_converted_at;   -- both non-NULL
--    ROLLBACK;
--
-- 4. Bulk-insert safety (the 088 regression this must not repeat) — two
--    post-dated rows in ONE statement must both succeed:
--    BEGIN;
--      INSERT INTO sales (customer_name, closer_disposition, status)
--      VALUES ('t1','post date','open'), ('t2','post date','open')
--      RETURNING id, post_dated_at;
--    ROLLBACK;
--
-- 5. The catalog is readable:
--    SELECT jsonb_array_length(value) FROM business_config
--     WHERE scope='global' AND key='post_date_fail_reasons';   -- 8
