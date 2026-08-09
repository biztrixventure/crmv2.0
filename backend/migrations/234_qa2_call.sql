-- ============================================================================
-- 234_qa2_call.sql
-- QA v2 — Phase 1, part 3: qa2_call, the atom of the system. Every incoming
-- (or swept) call is recorded here, whether or not it gets sampled/assigned —
-- sampling decides what gets ASSIGNED (mig 237), never what gets RECORDED.
-- At ~80 calls/day this is trivial storage and lets a manager pull any
-- specific call from any past date.
--
-- transfer_id and sale_id are BOTH nullable and that is deliberate — a
-- fronter call that was never transferred has no transfer row, and v1's
-- CHECK (transfer_id IS NOT NULL OR sale_id IS NOT NULL) on qa_assignments
-- makes that call structurally impossible to represent there. v2 doesn't
-- repeat that mistake.
--
-- method_id is nullable — NULL means Unclassified (mig 233's rules matched
-- nothing), visible only to QA managers until they classify it or mark it
-- qa_relevant = false.
--
-- linked_call_id pairs the two legs of the same customer (fronter transfer +
-- closer outcome) so a reviewer can hear both back to back.
--
-- recording_state is a small state machine driven by the Phase 5 poller:
-- pending -> found (recording_id/location set) or missing (exhausted
-- recording_attempts) or error. Two production dialer boxes share the WTI
-- prefix — recording lookup always fans out across every box for a prefix,
-- never assumes one box per prefix (see backend/utils/dialerBoxes.js).
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa2_call (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  box_id             text NOT NULL,
  dialer_lead_id     text,
  vendor_code        text,
  method_id          uuid REFERENCES qa2_method(id) ON DELETE SET NULL,   -- NULL = Unclassified pool
  classified_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  classified_at      timestamptz,
  leg                text CHECK (leg IN ('fronter','closer')),
  agent_user         text,
  agent_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id         uuid REFERENCES companies(id) ON DELETE SET NULL,
  transfer_id        uuid REFERENCES transfers(id) ON DELETE SET NULL,
  sale_id            uuid REFERENCES sales(id) ON DELETE SET NULL,
  linked_call_id     uuid REFERENCES qa2_call(id) ON DELETE SET NULL,     -- other leg
  customer_phone     text,
  normalized_phone   text,
  dispo_raw          text,
  call_at            timestamptz,
  talk_sec           integer,
  recording_id       text,
  recording_location text,
  recording_state    text NOT NULL DEFAULT 'pending'
                     CHECK (recording_state IN ('pending','found','missing','error')),
  recording_attempts integer NOT NULL DEFAULT 0,
  qa_relevant        boolean NOT NULL DEFAULT true,   -- manager can reject from Unclassified
  source             text NOT NULL CHECK (source IN ('ingest','sweep','manual')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_qa2_call_recording ON qa2_call (box_id, recording_id)
  WHERE recording_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qa2_call_agent_date   ON qa2_call (agent_user_id, call_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa2_call_method_date  ON qa2_call (method_id, call_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa2_call_unclassified ON qa2_call (created_at DESC) WHERE method_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_qa2_call_pending_rec  ON qa2_call (recording_state, recording_attempts)
  WHERE recording_state = 'pending';
CREATE INDEX IF NOT EXISTS idx_qa2_call_company_date ON qa2_call (company_id, call_at DESC);

REVOKE ALL ON public.qa2_call FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.qa2_call TO service_role;

INSERT INTO schema_migrations (filename, note)
VALUES ('234_qa2_call.sql', 'QA v2 phase 1 — qa2_call, the atom of the system')
ON CONFLICT (filename) DO NOTHING;

NOTIFY pgrst, 'reload schema';
