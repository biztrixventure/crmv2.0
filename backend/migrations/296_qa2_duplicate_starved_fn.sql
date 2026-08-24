-- ============================================================================
-- 296_qa2_duplicate_starved_fn.sql
--
-- app_qa2_duplicate_starved(): the review rows that can never get audio because
-- they are DUPLICATES of a call another row already covers with a recording.
--
-- A re-transferred customer (mig 291) or an ingest+sweep double-materialization
-- makes two review rows for one dialed call. The dialer holds one clip per leg,
-- so one row gets the audio and its twin sits on 'missing' forever — reading as
-- a recording problem when it is a duplicate. Measured 2026-08-25: 43 such rows
-- by lead + 8 more by phone on one Wavetech day alone; every "missing recording"
-- complaint that day traced to this.
--
-- Sibling match is company + leg + (dialer_lead_id OR customer_phone): sweep
-- duplicates often never learn a lead id, so the phone is the only key they
-- carry. Rows someone has actually started on (in_review/scored assignment, or
-- any evaluation) are never returned.
--
-- Consumed by qa2AutoAssign.parkDuplicateStarvedCalls() on the hourly retention
-- tick, which parks them (qa_relevant = false) and clears their pending pool
-- assignments. The service role is the only caller.
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
      WHERE s.company_id = k.company_id
        AND s.leg = k.leg
        AND s.id <> k.id
        AND s.recording_state = 'found'
        AND s.method_id IS NOT NULL
        AND s.call_at >= now() - interval '14 days'
        AND (
          (k.dialer_lead_id IS NOT NULL AND s.dialer_lead_id = k.dialer_lead_id)
          OR (k.customer_phone IS NOT NULL AND s.customer_phone = k.customer_phone)
        )
    )
    AND NOT EXISTS (SELECT 1 FROM qa2_assignment a
                    WHERE a.call_id = k.id AND a.status IN ('in_review', 'scored'))
    AND NOT EXISTS (SELECT 1 FROM qa2_evaluation e WHERE e.call_id = k.id);
$$;

REVOKE ALL ON FUNCTION app_qa2_duplicate_starved() FROM anon;

INSERT INTO schema_migrations (filename, note)
VALUES ('296_qa2_duplicate_starved_fn.sql',
        'app_qa2_duplicate_starved(): duplicate review rows starving on missing while a sibling holds the clip — fed to the hourly parker')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
