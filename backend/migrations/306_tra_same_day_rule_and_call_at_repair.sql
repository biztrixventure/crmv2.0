-- ============================================================================
-- 306_tra_same_day_rule_and_call_at_repair.sql  (APPLIED 2026-08-26)
--
-- TRA means "the transfer event", not "any fronter call on a lead that was
-- once transferred". Two repairs and one rule refinement, so that per company
-- per shift-day:  TRA − Closed = Unclosed  (measured after: gaps of 1–5 where
-- they had been 26–38).
--
-- (a) call_at repair. Before the hook fix (7c383f8) a later dispo on the same
--     lead refreshed the original XFER row's call_at to the redial's day; migs
--     302/303 restored the dispo and the transfer link but not the time. Such a
--     row said "XFER on 24 Aug" while its transfer — the real event — was from
--     22 Aug, and no transfer existed on the 24th for it. Put it back on its
--     own day.
-- (b) park. A fronter row with a NON-XFER dispo linked to another day's
--     transfer is the fronter's redial on an old lead — not a transfer.
-- (c) rule. The hourly tidy classifies a transfer-linked fronter row as TRA
--     only if its dispo is XFER or the transfer was created the same Eastern
--     day as the call.
-- ============================================================================

-- (a)
UPDATE qa2_call k
SET call_at = t.created_at
FROM transfers t, qa2_method m
WHERE t.id = k.transfer_id AND m.id = k.method_id AND m.label ILIKE 'tra'
  AND k.qa_relevant AND k.leg = 'fronter' AND k.dispo_raw ILIKE 'xfer'
  AND k.call_at >= now() - interval '14 days'
  AND (t.created_at AT TIME ZONE 'America/New_York')::date <> (k.call_at AT TIME ZONE 'America/New_York')::date
  AND NOT EXISTS (SELECT 1 FROM transfers t2 WHERE t2.company_id = k.company_id
                    AND (t2.vicidial_vendor_code = k.vendor_code OR t2.normalized_phone = k.customer_phone)
                    AND (t2.created_at AT TIME ZONE 'America/New_York')::date = (k.call_at AT TIME ZONE 'America/New_York')::date);

-- (b)
UPDATE qa2_call k
SET qa_relevant = false
FROM transfers t, qa2_method m
WHERE t.id = k.transfer_id AND m.id = k.method_id AND m.label ILIKE 'tra'
  AND k.qa_relevant AND k.leg = 'fronter' AND NOT (k.dispo_raw ILIKE 'xfer')
  AND k.call_at >= now() - interval '14 days'
  AND (t.created_at AT TIME ZONE 'America/New_York')::date <> (k.call_at AT TIME ZONE 'America/New_York')::date
  AND NOT EXISTS (SELECT 1 FROM qa2_assignment a WHERE a.call_id = k.id AND a.status IN ('in_review','scored'))
  AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = k.id);

-- (c)
CREATE OR REPLACE FUNCTION app_qa2_tidy_unclassified()
RETURNS TABLE (classified bigint, parked bigint)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE c bigint; p bigint; tra uuid;
BEGIN
  SELECT id INTO tra FROM qa2_method WHERE label ILIKE 'tra' AND is_active AND leg IN ('fronter','both') LIMIT 1;

  IF tra IS NOT NULL THEN
    UPDATE qa2_call k SET method_id = tra, classified_at = now()
      FROM transfers t
     WHERE t.id = k.transfer_id
       AND k.method_id IS NULL AND k.qa_relevant AND k.leg = 'fronter'
       AND k.call_at >= now() - interval '30 days'
       AND (k.dispo_raw ILIKE 'xfer'
            OR (t.created_at AT TIME ZONE 'America/New_York')::date = (k.call_at AT TIME ZONE 'America/New_York')::date);
    GET DIAGNOSTICS c = ROW_COUNT;
  ELSE c := 0; END IF;

  UPDATE qa2_call k SET qa_relevant = false
   WHERE k.qa_relevant AND k.method_id IS NULL
     AND k.leg = 'fronter' AND k.source = 'ingest'
     AND k.transfer_id IS NULL AND k.sale_id IS NULL
     AND k.linked_call_id IS NOT NULL
     AND NOT (k.dispo_raw ILIKE 'xfer')
     AND k.call_at >= now() - interval '30 days'
     AND NOT EXISTS (SELECT 1 FROM qa2_assignment a WHERE a.call_id = k.id AND a.status IN ('in_review','scored'))
     AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = k.id);
  GET DIAGNOSTICS p = ROW_COUNT;

  RETURN QUERY SELECT c, p;
END $fn$;

INSERT INTO schema_migrations (filename, note)
VALUES ('306_tra_same_day_rule_and_call_at_repair.sql',
        'TRA = transfer event: call_at restored to the transfer day for time-shifted XFER rows; cross-day redials parked; tidy requires XFER or same-day transfer')
ON CONFLICT (filename) DO NOTHING;
