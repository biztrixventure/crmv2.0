-- 353: a post-date (PDS) is not a sale -- in the payout tiles and on the timeline.
--
-- A PDS is a sale row whose closer_disposition is "Post Date": a reminder to
-- charge the customer's card on a later day. It sits at status 'open' until the
-- closer charges it, when the disposition flips to "Sale", sale_date moves to
-- the charge day (69 of 78 charged PDS on 2026-11-15) and fn_stamp_post_date
-- stamps post_date_converted_at. Only from that moment is it a sale.
--
-- The counters mostly knew this already (utils/postDate.js excludePostDate,
-- fn_is_post_date in the Company Report). Two database pieces did not:
--
-- 1. payout_kpis / payout_confirmed_kpis / payout_kpis_by_client counted any
--    reviewed-or-approved row -- so a post-date compliance had looked at showed
--    as money to be paid out before any card was charged. Now they skip it,
--    matching the payout write gate in routes/payouts.js and the paid-flag
--    counts in routes/compliance.js.
--
-- 2. fn_log_policy_event wrote 'sold' for EVERY inserted sale, PDS included, so
--    the sale timeline -- and the outgoing sale.sold webhook that mirrors it --
--    announced a sale the moment a reminder was keyed. Every one of the 172
--    sales that began life as a PDS carried that 'sold' row; none of the 78
--    that were later charged had an event for the real sale. Now:
--      insert as a post-date              -> 'post_dated'
--      disposition leaves post-date       -> 'sold'  (the charge; at = now())
--      disposition switches to post-date  -> 'post_dated'
--    Everything else in the trigger is unchanged.
--
-- 3. Backfill (reversible): the 172 born-as-PDS 'sold' rows are relabelled
--    'post_dated', and each of the 78 charged ones gains a 'sold' row at its
--    post_date_converted_at. The relabelled ids + old type are kept in
--    policy_events_backfill_353; the added rows carry meta.backfill = 353.
--    created_at of an added row = its conversion time, so a webhook cursor
--    that is already past it does not re-announce an old sale.
--    The 6 sales that were keyed as a real sale and only LATER switched to
--    post-date keep their original 'sold' row -- that sale did happen first.

-- ── 1. payout KPI functions ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.payout_kpis(p_company_ids uuid[], p_client_names text[], p_date_from date, p_date_to date, p_search text)
 RETURNS TABLE(payout_status text, cnt bigint, gross numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    payout_status,
    count(*)                        AS cnt,
    COALESCE(sum(down_payment), 0)  AS gross
  FROM sales
  WHERE (compliance_reviewed_at IS NOT NULL OR status = 'closed_won')
    AND NOT fn_is_post_date(closer_disposition)
    AND (p_company_ids  IS NULL OR company_id  = ANY(p_company_ids))
    AND (p_client_names IS NULL OR client_name = ANY(p_client_names))
    AND (p_date_from    IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to      IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY payout_status;
$function$;

CREATE OR REPLACE FUNCTION public.payout_confirmed_kpis(p_company_ids uuid[], p_client_names text[], p_date_from date, p_date_to date, p_search text)
 RETURNS TABLE(payout_confirmed text, cnt bigint, gross numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    payout_confirmed,
    count(*)                        AS cnt,
    COALESCE(sum(down_payment), 0)  AS gross
  FROM sales
  WHERE (compliance_reviewed_at IS NOT NULL OR status = 'closed_won')
    AND NOT fn_is_post_date(closer_disposition)
    AND (p_company_ids  IS NULL OR company_id  = ANY(p_company_ids))
    AND (p_client_names IS NULL OR client_name = ANY(p_client_names))
    AND (p_date_from    IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to      IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY payout_confirmed;
$function$;

CREATE OR REPLACE FUNCTION public.payout_kpis_by_client(p_company_ids uuid[], p_client_names text[], p_date_from date, p_date_to date, p_search text)
 RETURNS TABLE(client_name text, payout_status text, cnt bigint, gross numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    client_name,
    payout_status,
    count(*)                        AS cnt,
    COALESCE(sum(down_payment), 0)  AS gross
  FROM sales
  WHERE (compliance_reviewed_at IS NOT NULL OR status = 'closed_won')
    AND NOT fn_is_post_date(closer_disposition)
    AND client_name = ANY(p_client_names)
    AND (p_company_ids IS NULL OR company_id = ANY(p_company_ids))
    AND (p_date_from   IS NULL OR sale_date  >= p_date_from)
    AND (p_date_to     IS NULL OR sale_date  <= p_date_to)
    AND (p_search IS NULL OR p_search = '' OR
         customer_name  ILIKE '%'||p_search||'%' OR
         customer_phone ILIKE '%'||p_search||'%' OR
         reference_no   ILIKE '%'||p_search||'%')
  GROUP BY client_name, payout_status;
$function$;

-- ── 2. the timeline trigger ────────────────────────────────────────────────
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

-- ── 3. backfill (reversible) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.policy_events_backfill_353 (
  event_id   uuid PRIMARY KEY,
  sale_id    uuid NOT NULL,
  old_type   text NOT NULL,
  new_type   text NOT NULL,
  done_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.policy_events_backfill_353 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.policy_events_backfill_353 FROM anon, authenticated;

-- a) the insert-time 'sold' row of every sale that was BORN a post-date
WITH born AS (
  SELECT s.id AS sale_id,
         (SELECT e.id FROM policy_events e
           WHERE e.sale_id = s.id AND e.event_type = 'sold'
           ORDER BY e.created_at, e.id LIMIT 1) AS event_id
    FROM sales s
   WHERE s.post_dated_at IS NOT NULL
     AND abs(extract(epoch FROM s.post_dated_at - s.created_at)) <= 300
), kept AS (
  INSERT INTO policy_events_backfill_353 (event_id, sale_id, old_type, new_type)
  SELECT event_id, sale_id, 'sold', 'post_dated' FROM born WHERE event_id IS NOT NULL
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id
)
UPDATE policy_events e SET event_type = 'post_dated'
  FROM kept WHERE e.id = kept.event_id;

-- b) the real sale, for every post-date that was charged
INSERT INTO policy_events (sale_id, event_type, at, actor_id, meta, created_at)
SELECT s.id, 'sold', s.post_date_converted_at, s.last_modified_by,
       jsonb_build_object('from', 'post_date', 'backfill', 353),
       s.post_date_converted_at
  FROM sales s
 WHERE s.post_date_converted_at IS NOT NULL
   AND abs(extract(epoch FROM s.post_dated_at - s.created_at)) <= 300   -- born a post-date
   AND NOT EXISTS (SELECT 1 FROM policy_events e
                    WHERE e.sale_id = s.id AND e.event_type = 'sold'
                      AND e.at >= s.post_date_converted_at - interval '1 minute');

-- Undo (if ever needed):
--   UPDATE policy_events e SET event_type = b.old_type
--     FROM policy_events_backfill_353 b WHERE e.id = b.event_id;
--   DELETE FROM policy_events WHERE (meta->>'backfill') = '353';
