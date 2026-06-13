-- ============================================================================
-- 088_vin_active_policy.sql
-- Guarantees AT MOST ONE active policy per vehicle (VIN) — the auto-warranty
-- business rule "a car can only have one live warranty at a time".
--
-- "Active policy" is defined as:  status = 'closed_won' AND superseded_by IS NULL.
--   • pending_review is DELIBERATELY excluded — multiple closers may submit the
--     same VIN for compliance review (a legitimate race the business allows);
--     blocking that would break the compliance workflow.
--   • cancelled / returned / open / expired etc. are not active.
--
-- How it is enforced WITHOUT breaking renewals/resells:
--   Instead of hard-rejecting a second policy (which would break the renewal
--   workflow and fail this migration outright — 461 VINs already have dupes),
--   a BEFORE trigger AUTO-RETIRES the previous active policy: it stamps the
--   older row's superseded_by = the new sale's id. Nothing is deleted, full
--   history is preserved, and a 'superseded' policy_event is logged. The
--   partial unique index then has exactly one active row to guard, so it never
--   trips on normal inserts.
--
-- Data state at write time: 2992 closed_won, 461 VINs with multiple active
-- policies (484 rows to retire). The backfill resolves those before the index
-- is created, so index creation cannot fail.
--
-- Apply order: 086 → 087 → 088  (087 must exist: this migration logs
-- 'superseded' into policy_events and CREATE OR REPLACEs its trigger fn).
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── Schema ───────────────────────────────────────────────────────────────────
ALTER TABLE sales ADD COLUMN IF NOT EXISTS superseded_by     uuid REFERENCES sales(id) ON DELETE SET NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS superseded_at     timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS superseded_reason text;

COMMENT ON COLUMN sales.superseded_by IS
  'If set, this policy was replaced by sale <superseded_by> (renewal/resell/correction on the same VIN). superseded_by IS NULL = still the active policy. Never deleted — history preserved.';

CREATE INDEX IF NOT EXISTS idx_sales_superseded_by ON sales(superseded_by) WHERE superseded_by IS NOT NULL;

-- ── Supersede trigger ────────────────────────────────────────────────────────
-- BEFORE the new/updated active policy is validated by the unique index,
-- retire any other active policy on the same VIN. BEFORE (not AFTER) so the
-- index only ever sees one active row.
CREATE OR REPLACE FUNCTION fn_supersede_vin_active()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Ensure NEW.id exists in BEFORE INSERT even if the table has no default.
  IF TG_OP = 'INSERT' AND NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  IF NEW.status = 'closed_won'
     AND NEW.car_vin IS NOT NULL AND btrim(NEW.car_vin) <> ''
     AND NEW.superseded_by IS NULL THEN
    UPDATE sales
       SET superseded_by     = NEW.id,
           superseded_at      = now(),
           superseded_reason  = 'vin_active_replaced'
     WHERE car_vin = NEW.car_vin
       AND id <> NEW.id
       AND status = 'closed_won'
       AND superseded_by IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_supersede_vin_active ON sales;
CREATE TRIGGER trg_supersede_vin_active
  BEFORE INSERT OR UPDATE OF status, car_vin, superseded_by ON sales
  FOR EACH ROW EXECUTE FUNCTION fn_supersede_vin_active();

-- ── Extend policy-event logging to record supersession ───────────────────────
-- Full replacement of the 087 function: all prior logic PLUS a 'superseded'
-- event when superseded_by transitions NULL → a value (column now exists).
CREATE OR REPLACE FUNCTION fn_log_policy_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ev   text;
  who  uuid;
BEGIN
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

  -- status transition
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

  -- supersession (one active policy per VIN)
  IF NEW.superseded_by IS DISTINCT FROM OLD.superseded_by AND NEW.superseded_by IS NOT NULL THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, note, meta)
    VALUES (NEW.id, 'superseded', COALESCE(NEW.superseded_at, now()),
            NEW.last_modified_by, NEW.superseded_reason,
            jsonb_build_object('superseded_by', NEW.superseded_by));
  END IF;

  -- cancellation date set independently of status
  IF NEW.cancellation_date IS DISTINCT FROM OLD.cancellation_date
     AND NEW.cancellation_date IS NOT NULL
     AND NEW.status NOT IN ('cancelled','compliance_cancelled') THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'cancelled', NEW.cancellation_date::timestamptz,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('cancellation_reason_key', NEW.cancellation_reason_key));
  END IF;

  -- chargeback recorded
  IF NEW.chargeback_date IS DISTINCT FROM OLD.chargeback_date AND NEW.chargeback_date IS NOT NULL THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'chargeback', NEW.chargeback_date::timestamptz,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('chargeback_amount', NEW.chargeback_amount));
  END IF;

  -- post-date charge fired
  IF NEW.charge_notified_at IS DISTINCT FROM OLD.charge_notified_at AND NEW.charge_notified_at IS NOT NULL THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'charged', NEW.charge_notified_at,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('charge_at', NEW.charge_at));
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

-- ── Backfill: resolve existing duplicates BEFORE adding the unique index ──────
-- For each VIN with >1 active policy, keep the NEWEST (by sale_date, then
-- created_at) and retire the rest. This fires trg_log_policy_event above,
-- writing a 'superseded' event for each retired policy.
WITH ranked AS (
  SELECT id,
         car_vin,
         row_number() OVER (
           PARTITION BY car_vin
           ORDER BY COALESCE(sale_date::timestamptz, created_at) DESC, created_at DESC, id DESC
         ) AS rn,
         first_value(id) OVER (
           PARTITION BY car_vin
           ORDER BY COALESCE(sale_date::timestamptz, created_at) DESC, created_at DESC, id DESC
         ) AS keeper_id
  FROM sales
  WHERE status = 'closed_won'
    AND car_vin IS NOT NULL AND btrim(car_vin) <> ''
    AND superseded_by IS NULL
)
UPDATE sales s
   SET superseded_by    = r.keeper_id,
       superseded_at     = now(),
       superseded_reason = 'backfill_088_one_active_per_vin'
  FROM ranked r
 WHERE s.id = r.id
   AND r.rn > 1;

-- ── Enforce: at most one active policy per VIN ───────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_active_vin
  ON sales (car_vin)
  WHERE status = 'closed_won' AND superseded_by IS NULL AND car_vin IS NOT NULL AND car_vin <> '';

COMMENT ON INDEX uq_sales_active_vin IS
  'At most one active policy (closed_won, not superseded) per VIN. Renewals/resells auto-retire the prior policy via trg_supersede_vin_active, so this never blocks a legitimate write.';
