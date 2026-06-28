-- ============================================================================
-- 121_uppercase_agent_ids.sql
-- VICIdial sends agent ids in inconsistent case (Tmc100789 vs TMC100789). The
-- CRM matched them case-SENSITIVELY, so a case-mismatched agent's dispositions
-- went unattributed. Normalize every stored agent id to UPPERCASE so matching
-- (resolveAgent now also uppercases the incoming id) is consistent. MySQL's
-- default collation on the dialer is case-insensitive, so outbound lookups
-- (recording_lookup by agent_user) still match the dialer's stored case.
-- Apply in Supabase SQL editor. Idempotent.
-- ============================================================================
UPDATE user_profiles
   SET vicidial_agent_ids = (SELECT array_agg(upper(x)) FROM unnest(vicidial_agent_ids) AS x)
 WHERE vicidial_agent_ids IS NOT NULL
   AND array_length(vicidial_agent_ids, 1) > 0;

UPDATE user_profiles
   SET vicidial_agent_id = upper(vicidial_agent_id)
 WHERE vicidial_agent_id IS NOT NULL AND vicidial_agent_id <> upper(vicidial_agent_id);
