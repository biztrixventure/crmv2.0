-- ============================================================================
-- 087_policy_events.sql
-- First-class, typed, immutable lifecycle history for every policy (sale).
--
-- Why: today a policy's history is scattered across sales columns
-- (submitted_for_review_at, compliance_reviewed_at, cancellation_date,
-- chargeback_date, is_resell, …) and the mutable status column. There is no
-- single timeline of "what happened to this policy and when". This table is
-- that timeline: one immutable row per event.
--
-- How it stays in sync WITHOUT touching route code:
--   A trigger on sales appends an event on INSERT and on every meaningful
--   status / lifecycle transition. No backend change, so no existing
--   workflow can break. The trigger body is wrapped in an exception handler —
--   if logging ever fails it is swallowed and the sale write proceeds.
--
-- The superseded event (one active policy per VIN) is added in 088, which
-- CREATE OR REPLACEs this function once the superseded_by column exists.
--
-- Apply order: 086 → 087 → 088.
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id    uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  actor_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note       text,
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb,
  source     text NOT NULL DEFAULT 'trigger',   -- 'trigger' | 'backfill'
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_events_type_chk CHECK (event_type IN (
    'sold','submitted','approved','returned','cancelled','reinstated',
    'renewed','replaced','resold','superseded','expired','lost',
    'chargeback','charged','post_dated','dispute','refunded','note'
  ))
);

COMMENT ON TABLE policy_events IS
  'Immutable, typed lifecycle timeline per policy/sale. Populated by trg_log_policy_event on sales — never written by route code. source=backfill rows reconstruct history from pre-existing sales columns.';
COMMENT ON COLUMN policy_events.meta IS
  'Free-form context: { "from_status": "...", "to_status": "...", "superseded_by": "<sale_id>", ... }.';

CREATE INDEX IF NOT EXISTS idx_policy_events_sale  ON policy_events(sale_id, at);
CREATE INDEX IF NOT EXISTS idx_policy_events_type  ON policy_events(event_type);
CREATE INDEX IF NOT EXISTS idx_policy_events_at    ON policy_events(at DESC);

-- ── Trigger function ─────────────────────────────────────────────────────────
-- Maps sales status transitions + lifecycle column changes to typed events.
CREATE OR REPLACE FUNCTION fn_log_policy_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ev   text;
  who  uuid;
BEGIN
  -- ── INSERT: birth of the policy ──
  IF TG_OP = 'INSERT' THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (
      NEW.id,
      CASE WHEN COALESCE(NEW.is_resell, false)
           THEN (CASE WHEN COALESCE(NEW.resell_intent,'') ILIKE '%renew%' THEN 'renewed' ELSE 'replaced' END)
           ELSE 'sold' END,
      COALESCE(NEW.sale_date::timestamptz, NEW.created_at, now()),
      NEW.created_by,
      jsonb_build_object('to_status', NEW.status,
                         'original_sale_id', NEW.original_sale_id,
                         'resell_intent', NEW.resell_intent)
    );
    RETURN NEW;
  END IF;

  -- ── UPDATE: status transition ──
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    ev := CASE NEW.status
            WHEN 'pending_review'       THEN 'submitted'
            WHEN 'closed_won'           THEN 'approved'
            WHEN 'sold'                 THEN 'approved'
            WHEN 'needs_revision'       THEN 'returned'
            WHEN 'cancelled'            THEN 'cancelled'
            WHEN 'compliance_cancelled' THEN 'cancelled'
            WHEN 'chargeback'           THEN 'chargeback'
            WHEN 'expired'              THEN 'expired'
            WHEN 'resold'               THEN 'resold'
            WHEN 'closed_lost'          THEN 'lost'
            WHEN 'refunded'             THEN 'refunded'
            WHEN 'dispute'              THEN 'dispute'
            ELSE NULL
          END;
    IF ev IS NOT NULL THEN
      who := COALESCE(NEW.compliance_reviewed_by, NEW.last_modified_by, NEW.submitted_by, NEW.created_by);
      INSERT INTO policy_events (sale_id, event_type, at, actor_id, note, meta)
      VALUES (NEW.id, ev, now(), who, NEW.compliance_note,
              jsonb_build_object('from_status', OLD.status, 'to_status', NEW.status));
    END IF;
  END IF;

  -- ── UPDATE: cancellation date set independently of status ──
  IF NEW.cancellation_date IS DISTINCT FROM OLD.cancellation_date
     AND NEW.cancellation_date IS NOT NULL
     AND NEW.status NOT IN ('cancelled','compliance_cancelled') THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'cancelled', NEW.cancellation_date::timestamptz,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('cancellation_reason_key', NEW.cancellation_reason_key));
  END IF;

  -- ── UPDATE: chargeback recorded ──
  IF NEW.chargeback_date IS DISTINCT FROM OLD.chargeback_date AND NEW.chargeback_date IS NOT NULL THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'chargeback', NEW.chargeback_date::timestamptz,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('chargeback_amount', NEW.chargeback_amount));
  END IF;

  -- ── UPDATE: post-date charge fired ──
  IF NEW.charge_notified_at IS DISTINCT FROM OLD.charge_notified_at AND NEW.charge_notified_at IS NOT NULL THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'charged', NEW.charge_notified_at,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('charge_at', NEW.charge_at));
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Logging must never break the sale write.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_policy_event ON sales;
CREATE TRIGGER trg_log_policy_event
  AFTER INSERT OR UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION fn_log_policy_event();

-- ── Backfill (idempotent) ────────────────────────────────────────────────────
-- Reconstruct history from the columns that already exist. Re-running rebuilds
-- the backfill set cleanly without touching trigger-generated rows.
DELETE FROM policy_events WHERE source = 'backfill';

-- sold / renewed / replaced — every existing sale gets a birth event.
INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta, source)
SELECT id,
       CASE WHEN COALESCE(is_resell,false)
            THEN (CASE WHEN COALESCE(resell_intent,'') ILIKE '%renew%' THEN 'renewed' ELSE 'replaced' END)
            ELSE 'sold' END,
       COALESCE(sale_date::timestamptz, created_at, now()),
       created_by,
       jsonb_build_object('to_status', status, 'original_sale_id', original_sale_id),
       'backfill'
FROM sales;

-- submitted
INSERT INTO policy_events (sale_id, event_type, at, actor_id, source)
SELECT id, 'submitted', submitted_for_review_at, submitted_by, 'backfill'
FROM sales WHERE submitted_for_review_at IS NOT NULL;

-- approved (current closed_won that were compliance-reviewed)
INSERT INTO policy_events (sale_id, event_type, at, actor_id, note, source)
SELECT id, 'approved', compliance_reviewed_at, compliance_reviewed_by, compliance_note, 'backfill'
FROM sales WHERE status = 'closed_won' AND compliance_reviewed_at IS NOT NULL;

-- cancelled
INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta, source)
SELECT id, 'cancelled', cancellation_date::timestamptz, last_modified_by,
       jsonb_build_object('cancellation_reason_key', cancellation_reason_key), 'backfill'
FROM sales WHERE cancellation_date IS NOT NULL;

-- chargeback
INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta, source)
SELECT id, 'chargeback', chargeback_date::timestamptz, last_modified_by,
       jsonb_build_object('chargeback_amount', chargeback_amount), 'backfill'
FROM sales WHERE chargeback_date IS NOT NULL;
