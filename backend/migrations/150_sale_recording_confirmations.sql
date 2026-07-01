-- ============================================================================
-- 150_sale_recording_confirmations.sql
-- Compliance-confirmed recording REFERENCES per sale. A compliance manager
-- reviews all candidate recordings for a sale and confirms one (or more, for a
-- sale split across calls). We store only a lightweight reference — never audio
-- — so the client portal re-fetches it live from the dialer, same as before.
--
-- Once a sale has a row here, the portal streams the confirmed reference and
-- NEVER runs the live auto-resolve heuristic; a sale with no row shows
-- "pending review" instead. Mirrors mig 009 (compliance workflow) + 149 style.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sale_recording_confirmations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       uuid        NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  clip_order    int         NOT NULL DEFAULT 1,          -- playback order (split calls)
  box_id        text        NOT NULL,                    -- dialer box (re-resolve key)
  lead_id       text,                                    -- dialer lead_id (re-resolve key)
  recording_id  text        NOT NULL,                    -- dialer recording_id (deterministic)
  location      text,                                    -- direct URL (fast path; re-derive if stale)
  agent_user    text,                                    -- agent on the clip (audit/display)
  start_time    timestamptz,
  duration      integer,                                 -- seconds
  confirmed_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at  timestamptz NOT NULL DEFAULT now(),
  note          text,
  UNIQUE (sale_id, clip_order)
);
CREATE INDEX IF NOT EXISTS idx_src_sale         ON sale_recording_confirmations (sale_id);
CREATE INDEX IF NOT EXISTS idx_src_confirmed_by ON sale_recording_confirmations (confirmed_by);

ALTER TABLE sale_recording_confirmations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS src_all ON sale_recording_confirmations;
CREATE POLICY src_all ON sale_recording_confirmations FOR ALL USING (true);

-- ── review queue ────────────────────────────────────────────────────────────
-- Eligible = "coded + mapped": the transfer has a vendor_lead_code AND the
-- closer has at least one vicidial_agent_id (the same criteria that let the
-- portal resolve a recording). Returns those that DON'T yet have a confirmation.
-- Newest sale_date first (rollout backlog → review what clients check now).
CREATE OR REPLACE FUNCTION app_recording_review_queue(
  p_company_ids uuid[] DEFAULT NULL,
  p_date_from   date    DEFAULT NULL,
  p_date_to     date    DEFAULT NULL,
  p_closer_id   uuid    DEFAULT NULL,
  p_limit       int     DEFAULT 100,
  p_offset      int     DEFAULT 0
) RETURNS TABLE (
  sale_id        uuid,
  customer_name  text,
  customer_phone text,
  sale_date      date,
  closer_id      uuid,
  closer_name    text,
  company_id     uuid,
  vendor_code    text,
  created_at     timestamptz,
  total_count    bigint
) LANGUAGE sql STABLE AS $$
  SELECT s.id, s.customer_name, s.customer_phone, s.sale_date,
         s.closer_id,
         NULLIF(TRIM(COALESCE(up.first_name,'') || ' ' || COALESCE(up.last_name,'')), ''),
         s.company_id, t.vicidial_vendor_code, s.created_at,
         COUNT(*) OVER()
  FROM sales s
  JOIN transfers t
    ON t.id = s.transfer_id
   AND t.vicidial_vendor_code ~ '^[A-Za-z]+[0-9]+$'
  JOIN user_profiles up
    ON up.user_id = s.closer_id
   AND up.vicidial_agent_ids IS NOT NULL
   AND COALESCE(array_length(up.vicidial_agent_ids, 1), 0) >= 1
  WHERE NOT EXISTS (SELECT 1 FROM sale_recording_confirmations c WHERE c.sale_id = s.id)
    AND (p_company_ids IS NULL OR s.company_id = ANY(p_company_ids))
    AND (p_date_from   IS NULL OR s.sale_date >= p_date_from)
    AND (p_date_to     IS NULL OR s.sale_date <= p_date_to)
    AND (p_closer_id   IS NULL OR s.closer_id = p_closer_id)
  ORDER BY s.sale_date DESC NULLS LAST, s.created_at DESC
  LIMIT  GREATEST(COALESCE(p_limit, 100), 0)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

GRANT EXECUTE ON FUNCTION app_recording_review_queue(uuid[], date, date, uuid, int, int)
  TO authenticated, anon, service_role;
