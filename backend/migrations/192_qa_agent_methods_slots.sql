-- ============================================================================
-- 192 — qa_agent_methods: allow all 4 work-type slots.
--
-- Agent ↔ method binding (mig 180) only allowed tra/rcm. Now that QA has four
-- sections (tra | rcm | closer_sales | closer_dispo), a manager must be able to
-- bind an agent to Closed Sale / Unclosed Sale too. Expand the CHECK to match
-- qa_scorecards (mig 191). Additive — existing tra/rcm bindings are untouched.
-- ============================================================================
ALTER TABLE qa_agent_methods DROP CONSTRAINT IF EXISTS qa_agent_methods_method_check;
ALTER TABLE qa_agent_methods ADD CONSTRAINT qa_agent_methods_method_check
  CHECK (method = ANY (ARRAY['tra','rcm','closer_sales','closer_dispo']));
