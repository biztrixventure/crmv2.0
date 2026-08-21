-- ============================================================================
-- 264_qa2_xfer_routing.sql
-- Route the three transfer methods the way the business actually works:
--
--   fronter dispositions XFER ............ TRA        (the fronter's leg)
--   that call reaches a closer, no sale .. Unclosed   (the closer's leg)
--   that call reaches a closer, SALE ..... Closed     (the closer's leg)
--
-- Two things were stopping that.
--
-- 1. TRA HAD NO RULE AT ALL. Classification is rule-driven per source, so with
--    zero rules on tra_fronter every XFER fell through to the Unclassified pool
--    — 1,215 of them in 30 days, while TRA held 62 rows a human had classified
--    by hand. Added: source ingest_fronter, EXACT match on XFER at priority 50.
--    Exact rather than a catch-all on purpose: the fronter webhook fires on
--    EVERY disposition, so `any` would drag no-answers and dead air into TRA.
--
-- 2. THE SALES WERE ALREADY IN UNCLOSED. Closed only came into existence in
--    263, so the 99 closer calls dispositioned SALE had been swept up by
--    Unclosed's catch-all beforehand. Rules only apply at ingest, so history
--    has to be moved explicitly.
--
-- The backfill only touches rows a HUMAN never classified (classified_by IS
-- NULL). A manager who deliberately put a call in a method keeps it.
-- Idempotent.
-- ============================================================================

-- ── 1. TRA claims the XFER dispo on the fronter leg ─────────────────────────
INSERT INTO qa2_method_rule (method_id, source, match_type, dispo_match, priority, is_active)
SELECT m.id, 'ingest_fronter', 'exact', 'XFER', 50, true
  FROM qa2_method m
 WHERE m.code = 'tra_fronter'
   AND NOT EXISTS (
     SELECT 1 FROM qa2_method_rule r
      WHERE r.method_id = m.id AND r.source = 'ingest_fronter'
        AND r.match_type = 'exact' AND upper(r.dispo_match) = 'XFER');

-- ── 2. mark the two closer methods as transfer-only ─────────────────────────
-- Unclosed and Closed exist to review a TRANSFERRED customer; 288 of the last
-- 30 days' closer legs never came from a transfer at all. The flag is read by
-- the methods API and the QA UI — recorded here so the intent lives with the
-- data, not only in someone's head.
UPDATE qa2_method SET requires_transfer = true  WHERE code IN ('unclosed_closer', 'closed_closed');
UPDATE qa2_method SET requires_transfer = false WHERE code = 'tra_fronter';

-- ── 3. backfill: XFER fronter legs belong to TRA ────────────────────────────
UPDATE qa2_call c
   SET method_id = (SELECT id FROM qa2_method WHERE code = 'tra_fronter'),
       classified_at = COALESCE(c.classified_at, now())
 WHERE c.leg = 'fronter'
   AND upper(COALESCE(c.dispo_raw, '')) = 'XFER'
   AND c.classified_by IS NULL
   AND c.method_id IS DISTINCT FROM (SELECT id FROM qa2_method WHERE code = 'tra_fronter');

-- ── 4. backfill: SALE closer legs belong to Closed, not Unclosed ────────────
UPDATE qa2_call c
   SET method_id = (SELECT id FROM qa2_method WHERE code = 'closed_closed'),
       classified_at = COALESCE(c.classified_at, now())
 WHERE c.leg = 'closer'
   AND upper(COALESCE(c.dispo_raw, '')) = 'SALE'
   AND c.classified_by IS NULL
   AND c.method_id IS DISTINCT FROM (SELECT id FROM qa2_method WHERE code = 'closed_closed');
