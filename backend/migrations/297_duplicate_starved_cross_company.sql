-- ============================================================================
-- 297_duplicate_starved_cross_company.sql  (APPLIED 2026-08-25)
--
-- The duplicate-starved predicate (mig 296) learns the CROSS-COMPANY case.
--
-- All closers dial on the Wavetech box; the CRM files their live-ingest rows
-- under the closer-grouping company (1-Vertex) while the reviewable row lives
-- with the fronter company. Mig 296 matched siblings same-company only, so the
-- grouping-company copies piled up as visible 'missing' — 145 in 3 days, 96%
-- of the estate's whole missing count.
--
-- Refinement: a starving row with NO transfer AND NO sale (not CRM-anchored)
-- may match its clip-holding sibling in ANY company — by dialer_lead_id ONLY.
-- A phone number repeats across companies legitimately; a lead id is one box
-- lead, so the cross-company match cannot mistake two different customers.
-- CRM-anchored rows keep the strict same-company rule from 296.
--
-- Applied with a one-shot run: 151 -> 15 missing estate-wide (3-day window).
-- The hourly parker (scheduler -> parkDuplicateStarvedCalls) keeps it drained.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_qa2_duplicate_starved()
RETURNS TABLE (id uuid)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT k.id
  FROM qa2_call k
  WHERE k.recording_state = 'missing'
    AND k.qa_relevant IS TRUE
    AND k.method_id IS NOT NULL
    AND k.call_at >= now() - interval '14 days'
    AND EXISTS (
      SELECT 1 FROM qa2_call s
      WHERE s.leg = k.leg
        AND s.id <> k.id
        AND s.recording_state = 'found'
        AND s.method_id IS NOT NULL
        AND s.call_at >= now() - interval '14 days'
        AND (
          (s.company_id = k.company_id AND (
            (k.dialer_lead_id IS NOT NULL AND s.dialer_lead_id = k.dialer_lead_id)
            OR (k.customer_phone IS NOT NULL AND s.customer_phone = k.customer_phone)))
          OR (k.transfer_id IS NULL AND k.sale_id IS NULL
              AND k.dialer_lead_id IS NOT NULL AND s.dialer_lead_id = k.dialer_lead_id)
        )
    )
    AND NOT EXISTS (SELECT 1 FROM qa2_assignment a
                    WHERE a.call_id = k.id AND a.status IN ('in_review', 'scored'))
    AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = k.id);
$$;

INSERT INTO schema_migrations (filename, note)
VALUES ('297_duplicate_starved_cross_company.sql',
        'duplicate-starved parker matches cross-company siblings by lead id for un-anchored rows (closer-grouping company copies)')
ON CONFLICT (filename) DO NOTHING;
