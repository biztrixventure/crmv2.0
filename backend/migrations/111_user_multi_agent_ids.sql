-- ============================================================================
-- 111_user_multi_agent_ids.sql
-- A user can work MULTIPLE dialer boxes with a different agent id on each (e.g.
-- an EasyTech fronter is ETC0895 on the ETC box but a different id on the
-- Wavetech box). One vicidial_agent_id couldn't cover both, so their other box's
-- transfers/dispositions dropped ("agent not mapped"). Add an array of all the
-- user's dialer agent ids; resolveAgent matches any of them. Idempotent.
-- ============================================================================
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vicidial_agent_ids text[] DEFAULT '{}';

-- Seed the array from the existing single id so nothing regresses.
UPDATE user_profiles
   SET vicidial_agent_ids = ARRAY[vicidial_agent_id]
 WHERE vicidial_agent_id IS NOT NULL
   AND vicidial_agent_id <> ''
   AND (vicidial_agent_ids IS NULL OR vicidial_agent_ids = '{}');

-- GIN index so resolveAgent's "array contains this id" lookup is an index hit
-- (fires on every dialer disposition + transfer).
CREATE INDEX IF NOT EXISTS idx_user_profiles_agent_ids ON user_profiles USING GIN (vicidial_agent_ids);
