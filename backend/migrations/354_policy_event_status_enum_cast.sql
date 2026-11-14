-- 354: the sale timeline has not recorded a status change since 2026-06-13.
--
-- fn_log_policy_event mapped NEW.status with
--     CASE NEW.status WHEN 'pending_review' ... WHEN 'expired' ... WHEN 'resold'
--                     ... WHEN 'refunded' ...
-- NEW.status is the sale_status ENUM, and 'expired', 'resold' and 'refunded'
-- are not values of it. Postgres casts every WHEN literal to the enum, so the
-- CASE raises 22P02 "invalid input value for enum sale_status" on EVERY update
-- that changes a status -- and the function's EXCEPTION WHEN OTHERS swallowed
-- it, which also rolls back everything else that call had written (a
-- superseded / cancellation / chargeback / post-date->sold event in the same
-- UPDATE). Result, measured 2026-11-15: the last 'approved', 'submitted' and
-- 'cancelled' rows are all stamped 2026-06-13 23:01:06 -- the mig 087 backfill
-- -- and not one since. Only events from updates that left status alone
-- (superseded, charged) and inserts (sold) kept arriving.
--
-- Found while making a charged post-date write its 'sold' event (mig 353): the
-- charge flips status to closed_won in the same UPDATE, so that event was being
-- thrown away too.
--
-- Fix: compare as text (CASE NEW.status::text ...). Same function as 353
-- otherwise. Events lost between 2026-06-13 and this migration are NOT
-- recreated here; field_audit_log holds every status change (old/new, when)
-- if they are ever backfilled.

CREATE OR REPLACE FUNCTION public.fn_log_policy_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  ev   text;
  who  uuid;
  pd_new boolean;
  pd_old boolean;
BEGIN
  pd_new := fn_is_post_date(NEW.closer_disposition);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (
      NEW.id,
      -- A post-date is a reminder, not a sale: 'sold' is written when it is
      -- charged (the UPDATE branch below), never when it is keyed.
      CASE WHEN pd_new THEN 'post_dated'
           WHEN COALESCE(NEW.is_resell, false)
           THEN (CASE WHEN COALESCE(NEW.resell_intent,'') ILIKE '%renew%' THEN 'renewed' ELSE 'replaced' END)
           ELSE 'sold' END,
      -- A post-date's sale_date is the FUTURE charge day; the event is now.
      CASE WHEN pd_new THEN COALESCE(NEW.created_at, now())
           ELSE COALESCE(NEW.sale_date::timestamptz, NEW.created_at, now()) END,
      NEW.created_by,
      jsonb_build_object('to_status', NEW.status,
                         'original_sale_id', NEW.original_sale_id,
                         'resell_intent', NEW.resell_intent,
                         'charge_at', CASE WHEN pd_new THEN NEW.charge_at END)
    );
    RETURN NEW;
  END IF;

  pd_old := fn_is_post_date(OLD.closer_disposition);

  -- post-date -> sale: THIS is the sale. The charge flipped the disposition.
  IF pd_old AND NOT pd_new THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'sold', now(), COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('from', 'post_date', 'charge_at', OLD.charge_at, 'to_status', NEW.status));
  -- an existing sale switched to post-date
  ELSIF pd_new AND NOT pd_old THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'post_dated', now(), COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('charge_at', NEW.charge_at));
  END IF;

  -- status transition
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    ev := CASE NEW.status::text   -- ::text: the enum lacks expired/resold/refunded (mig 354)
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

  -- post-date charge REMINDER fired (the scheduler's stamp, not the charge)
  IF NEW.charge_notified_at IS DISTINCT FROM OLD.charge_notified_at AND NEW.charge_notified_at IS NOT NULL THEN
    INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta)
    VALUES (NEW.id, 'charged', NEW.charge_notified_at,
            COALESCE(NEW.last_modified_by, NEW.created_by),
            jsonb_build_object('charge_at', NEW.charge_at));
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $function$;
