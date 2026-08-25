-- ============================================================================
-- 305_qa2_tidy_unclassified_fn.sql  (APPLIED 2026-08-26)
--
-- Keep the Unclassified tab honest on its own, every hour
-- (scheduler -> qa2AutoAssign.tidyUnclassified -> this function):
--   (1) a fronter call that carries a transfer IS a TRA, whatever dispo the
--       fronter punched later — classify it. The insert-time fallback only saw
--       the row at creation; the transfer link can arrive after.
--   (2) a fronter call with no transfer, no sale and no XFER dispo that is
--       merely PAIRED to a closer leg is the fronter's redial, not QA work —
--       park it (mig 304's rule, now recurring).
-- Never touches a row someone has started on.
-- ============================================================================

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
     WHERE k.method_id IS NULL AND k.qa_relevant AND k.leg = 'fronter'
       AND k.transfer_id IS NOT NULL
       AND k.call_at >= now() - interval '30 days';
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

GRANT EXECUTE ON FUNCTION app_qa2_tidy_unclassified() TO service_role;

INSERT INTO schema_migrations (filename, note)
VALUES ('305_qa2_tidy_unclassified_fn.sql',
        'app_qa2_tidy_unclassified(): transfer-linked fronters -> TRA; paired non-XFER unanchored fronter dials parked; hourly')
ON CONFLICT (filename) DO NOTHING;
