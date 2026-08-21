-- ============================================================================
-- 265_qa2_tra_every_transfer.sql
-- TRA must hold EVERY transfer, not just the ones whose dialer webhook happened
-- to fire with an XFER dispo. It did not:
--     transfers in 30 days   7,495
--     had a fronter leg      3,170
--     in TRA                 1,190
--     no qa2_call row at all 4,307   ← never entered QA in any form
--
-- A qa2_call row was only ever born from the dialer webhook. A transfer typed
-- into the CRM by hand, or one whose webhook fired without the dispo, produced
-- no QA row — so the fronter's call could never be reviewed even though the
-- transfer sits right there in the CRM.
--
-- The transfer itself carries everything QA needs: the fronter (created_by),
-- the company, the customer's number, when it happened, and usually the dialer
-- vendor code. So a transfer now MATERIALISES its own fronter leg.
--
-- Safe when the webhook arrives later: the ingest's dedupe looks up
-- (company_id, leg, vendor_code), so the dialer's report UPDATES this row
-- instead of inserting a second one. Rows carry source='sweep' to say plainly
-- that the CRM, not the dialer, produced them.
--
-- dialer_lead_id is the code's digits (ETC21249582 → 21249582); box_id stays
-- NULL on purpose — a prefix can be shared across boxes, and the recording
-- poller resolves the real box when it finds the clip (the rule from mig 239).
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_qa2_materialize_transfer(p_transfer_id uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE t transfers%ROWTYPE; new_id uuid; tra uuid;
BEGIN
  SELECT * INTO t FROM transfers WHERE id = p_transfer_id;
  IF t.id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM qa2_call c WHERE c.transfer_id = t.id AND c.leg = 'fronter') THEN RETURN NULL; END IF;

  -- Do not create a second row for a call the dialer already reported under the
  -- same vendor code — that is the ingest's own dedupe key. Attach instead.
  IF t.vicidial_vendor_code IS NOT NULL AND EXISTS (
        SELECT 1 FROM qa2_call c
         WHERE c.company_id = t.company_id AND c.leg = 'fronter'
           AND c.vendor_code = t.vicidial_vendor_code) THEN
    UPDATE qa2_call SET transfer_id = t.id
     WHERE company_id = t.company_id AND leg = 'fronter'
       AND vendor_code = t.vicidial_vendor_code AND transfer_id IS NULL;
    RETURN NULL;
  END IF;

  SELECT id INTO tra FROM qa2_method WHERE code = 'tra_fronter';

  INSERT INTO qa2_call (
    box_id, dialer_lead_id, vendor_code, method_id, classified_at, leg,
    agent_user_id, company_id, transfer_id, customer_phone, normalized_phone,
    dispo_raw, call_at, recording_state, source
  ) VALUES (
    NULL,
    NULLIF(regexp_replace(COALESCE(t.vicidial_vendor_code, ''), '\D', '', 'g'), ''),
    t.vicidial_vendor_code,
    tra, now(), 'fronter',
    t.created_by, t.company_id, t.id, t.normalized_phone, t.normalized_phone,
    'XFER', t.created_at, 'pending', 'sweep'
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

-- ── every new transfer gets its TRA row immediately ─────────────────────────
CREATE OR REPLACE FUNCTION fn_qa2_transfer_to_tra() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_qa2_materialize_transfer(NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;   -- QA must never block a transfer being created
END $$;

DROP TRIGGER IF EXISTS trg_qa2_transfer_to_tra ON transfers;
CREATE TRIGGER trg_qa2_transfer_to_tra
  AFTER INSERT ON transfers
  FOR EACH ROW EXECUTE FUNCTION fn_qa2_transfer_to_tra();

-- ── backfill, windowed so it can be run in slices ───────────────────────────
CREATE OR REPLACE FUNCTION app_qa2_backfill_tra(p_days int DEFAULT 30)
RETURNS TABLE(considered bigint, created bigint) LANGUAGE plpgsql AS $$
DECLARE r record; n bigint := 0; total bigint := 0;
BEGIN
  FOR r IN
    SELECT t.id FROM transfers t
     WHERE t.created_at >= now() - make_interval(days => p_days)
       AND NOT EXISTS (SELECT 1 FROM qa2_call c WHERE c.transfer_id = t.id AND c.leg = 'fronter')
     ORDER BY t.created_at DESC
  LOOP
    total := total + 1;
    IF fn_qa2_materialize_transfer(r.id) IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  considered := total; created := n; RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION app_qa2_backfill_tra(int) TO service_role;

-- ── final sweep: a transfer's fronter leg IS a TRA call ─────────────────────
-- The rule in 264 keys on the dispo the dialer webhook reported, and plenty of
-- fronter legs that belong to a real transfer arrived carrying something else
-- ("A", "N", blank). The transfer's existence is the stronger fact: if the CRM
-- has a transfer, the fronter transferred, so its leg is TRA regardless of what
-- the dialer said. ~2,000 rows. Manual classifications are left alone.
UPDATE qa2_call c
   SET method_id = (SELECT id FROM qa2_method WHERE code = 'tra_fronter'),
       classified_at = COALESCE(c.classified_at, now())
 WHERE c.leg = 'fronter'
   AND c.transfer_id IS NOT NULL
   AND c.classified_by IS NULL
   AND c.method_id IS DISTINCT FROM (SELECT id FROM qa2_method WHERE code = 'tra_fronter');
