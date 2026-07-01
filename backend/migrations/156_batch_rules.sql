-- ============================================================================
-- 156_batch_rules.sql  (Phase 3 — batch distribution business-rules engine)
--   1. distribution_batch_items: add 'excluded' status + exclusion_reason.
--   2. app_batch_rule_filter RPC — set-based, phone array in the POST body
--      (never a URL .in()); returns excluded phones + a readable reason enum.
--   3. Supplementary index for the CROSS-COMPANY per-person check
--      (transferred_scope='anywhere'). Company-scope (the default) already uses
--      idx_transfers_fronter_phone (048) + idx_transfers_normalized_phone (052).
--   4. Seed the 'batch_rules' global default in business_config (all OFF).
-- Rules live in business_config ('batch_rules' key, company→global resolver).
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================

-- 1) excluded status + reason (visible-but-excluded, not silently dropped) ─────
ALTER TABLE distribution_batch_items DROP CONSTRAINT IF EXISTS distribution_batch_items_status_check;
ALTER TABLE distribution_batch_items
  ADD CONSTRAINT distribution_batch_items_status_check
  CHECK (status IN ('new','called','callback','completed','skip','transferred','excluded'));
ALTER TABLE distribution_batch_items ADD COLUMN IF NOT EXISTS exclusion_reason text;

-- 3) supplementary index — ONLY for transferred_scope='anywhere' (per-person,
--    cross-company). Not the default path; created so 'anywhere' is index-scan.
CREATE INDEX IF NOT EXISTS idx_transfers_phone_creator ON transfers (normalized_phone, created_by);

-- 2) the rule filter. reason is a readable enum-like string so a future
--    'merge'-style rule can be added as a new value without schema changes.
--    Precedence when several rules hit one phone: already_assigned >
--    transferred_by_you > transferred_by_anyone (lowest pri wins).
CREATE OR REPLACE FUNCTION app_batch_rule_filter(
  p_phones    text[],
  p_recipient uuid,
  p_company   uuid,
  p_rules     jsonb
) RETURNS TABLE (phone_number text, reason text)
LANGUAGE sql STABLE AS $$
  WITH r AS (
    SELECT
      COALESCE((p_rules->>'block_reassign_same_person')::boolean, false)     AS block_assigned,
      COALESCE((p_rules->>'skip_if_transferred_by_recipient')::boolean, false) AS skip_recipient,
      COALESCE((p_rules->>'skip_if_transferred_by_anyone')::boolean, false)  AS skip_anyone,
      COALESCE(p_rules->>'transferred_scope', 'company')                     AS scope
  ),
  -- Candidate phones as a relation: lets the planner choose an index nested-loop
  -- for small batches and a single-pass hash join for 50k — NOT a per-phone scan.
  cand AS (SELECT DISTINCT unnest(p_phones) AS phone),
  hits AS (
    -- rule (a): already assigned to THIS recipient (active batch item)
    SELECT c.phone, 'already_assigned'::text AS reason, 1 AS pri
    FROM r
    JOIN distribution_batches b      ON r.block_assigned AND b.sent_to_user_id = p_recipient AND b.status = 'active'
    JOIN distribution_batch_items i  ON i.batch_id = b.id AND i.status <> 'excluded'
    JOIN cand c                      ON c.phone = i.phone_number
    UNION ALL
    -- rule (a): OR already assigned via the legacy number_lists path
    SELECT c.phone, 'already_assigned', 1
    FROM r
    JOIN number_lists nl ON r.block_assigned AND nl.fronter_id = p_recipient
    JOIN cand c          ON c.phone = nl.phone_number
    UNION ALL
    -- rule (b): the recipient transferred this number before
    SELECT c.phone, 'transferred_by_you', 2
    FROM r
    JOIN transfers t ON r.skip_recipient AND t.created_by = p_recipient
                    AND (r.scope <> 'company' OR t.company_id = p_company)
    JOIN cand c      ON c.phone = t.normalized_phone
    UNION ALL
    -- rule (c): ANY fronter transferred this number before
    SELECT c.phone, 'transferred_by_anyone', 3
    FROM r
    JOIN transfers t ON r.skip_anyone AND (r.scope <> 'company' OR t.company_id = p_company)
    JOIN cand c      ON c.phone = t.normalized_phone
  )
  SELECT DISTINCT ON (phone) phone AS phone_number, reason
  FROM hits
  ORDER BY phone, pri;
$$;

GRANT EXECUTE ON FUNCTION app_batch_rule_filter(text[], uuid, uuid, jsonb) TO authenticated, anon, service_role;

-- 4) seed the global default (all rules OFF; company overrides via BusinessRulesHub)
INSERT INTO business_config (scope, key, value)
VALUES ('global', 'batch_rules',
        '{"block_reassign_same_person":false,"skip_if_transferred_by_recipient":false,"skip_if_transferred_by_anyone":false,"transferred_scope":"company"}'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
