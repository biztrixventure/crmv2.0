-- ============================================================================
-- 023b_backfill_callback_number_history.sql
-- One-time backfill: derive history events from existing data in
-- callback_numbers, callback_number_claims, and callback_number_attempts.
--
-- Run AFTER 023_callback_number_history.sql.
-- Safe to run multiple times — uses ON CONFLICT DO NOTHING via a unique
-- source_ref column approach, OR just run once on a clean history table.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. "created" event — one per callback_number row
--    actor = first owner (first claim's owner_id), time = callback_numbers.created_at
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO callback_number_history
  (callback_number_id, actor_id, action, field_name, old_value, new_value, metadata, created_at)
SELECT
  cn.id,
  -- Use the earliest claim's owner as the creator (best proxy we have)
  first_claim.owner_id,
  'created',
  NULL,
  NULL,
  NULL,
  jsonb_build_object(
    'phone_number',   cn.phone_number,
    'source',         cn.source,
    'customer_name',  cn.customer_name,
    'backfilled',     true
  ),
  cn.created_at
FROM callback_numbers cn
LEFT JOIN LATERAL (
  SELECT owner_id
  FROM callback_number_claims
  WHERE callback_number_id = cn.id
  ORDER BY owned_from ASC
  LIMIT 1
) first_claim ON true
-- Skip if a "created" event already exists for this number
WHERE NOT EXISTS (
  SELECT 1 FROM callback_number_history
  WHERE callback_number_id = cn.id AND action = 'created'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. "status_changed" events — one per closed claim (ownership release)
--    Maps release_reason → status transition old/new values
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO callback_number_history
  (callback_number_id, actor_id, action, field_name, old_value, new_value, metadata, created_at)
SELECT
  cnc.callback_number_id,
  cnc.owner_id,   -- the owner who held it (closest proxy for actor)
  'status_changed',
  'status',
  CASE
    WHEN cnc.release_reason = 'do_not_call' THEN 'active'
    ELSE 'active'
  END,
  'released',
  jsonb_build_object(
    'reason',      cnc.release_reason,
    'claim_id',    cnc.id,
    'backfilled',  true
  ),
  cnc.owned_until
FROM callback_number_claims cnc
WHERE cnc.owned_until IS NOT NULL   -- only closed claims = something happened
  AND cnc.release_reason IS NOT NULL
  -- Skip if already backfilled for this claim
  AND NOT EXISTS (
    SELECT 1 FROM callback_number_history
    WHERE callback_number_id = cnc.callback_number_id
      AND action = 'status_changed'
      AND (metadata->>'claim_id') = cnc.id::text
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. "reassigned" events — from claims where release_reason = 'manager_reassign'
--    We know a manager did it but not which manager (not stored), so actor = NULL
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO callback_number_history
  (callback_number_id, actor_id, action, field_name, old_value, new_value, metadata, created_at)
SELECT
  prev_claim.callback_number_id,
  NULL,   -- manager identity not recorded in old data
  'reassigned',
  'owner_id',
  prev_claim.owner_id::text,
  next_claim.owner_id::text,
  jsonb_build_object(
    'prev_owner',  prev_claim.owner_id,
    'new_owner',   next_claim.owner_id,
    'backfilled',  true
  ),
  -- Use the moment the new claim started as the event time
  next_claim.owned_from
FROM callback_number_claims prev_claim
JOIN callback_number_claims next_claim
  ON  next_claim.callback_number_id = prev_claim.callback_number_id
  AND next_claim.owned_from = prev_claim.owned_until   -- next claim starts exactly when prev ended
WHERE prev_claim.release_reason = 'manager_reassign'
  AND prev_claim.owned_until IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM callback_number_history
    WHERE callback_number_id = prev_claim.callback_number_id
      AND action = 'reassigned'
      AND (metadata->>'prev_owner') = prev_claim.owner_id::text
      AND created_at = next_claim.owned_from
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Done. Verify counts:
-- ─────────────────────────────────────────────────────────────────────────────
SELECT action, COUNT(*) as events_inserted
FROM callback_number_history
WHERE metadata->>'backfilled' = 'true'
GROUP BY action
ORDER BY action;
