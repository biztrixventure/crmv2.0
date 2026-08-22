-- ============================================================================
-- 269_qa2_method_coverage_config.sql
-- QA v2 had recordings and forms but no way for work to reach an agent:
--
--   method     sampling rules            agents granted
--   TRA        NONE                      0     ← 1,871 recorded calls, 0 assignments
--   Closed     Wavetech only             0     ← 49 assignments nobody could claim
--   Unclosed   Wavetech only             1     ← the only method actually flowing
--
-- Auto-assign creates work from a sampling rule, and the Pool only shows a call
-- whose method the agent is granted. With no TRA rule, every transfer QA v2 went
-- to such lengths to capture sat unreachable; with no grant on Closed, its
-- assignments existed and were invisible.
--
-- Scoped to the org that actually exists rather than inventing one: Hamza Qamar
-- manages EasyTech and Wavetech, and Hannan Asif is his one agent, already
-- covering both companies. Rules are created for those two companies only.
--
-- NOT configured, deliberately: The Mejor, Onyx and Adil Team. No QA manager is
-- assigned to them, so work generated there would belong to nobody — and two of
-- them have no closer-dispo webhook at all, so Unclosed/Closed could never
-- populate regardless. Assign a manager to those companies first.
--
-- TRA is full_coverage because TRA is defined as every XFER (migs 264/265), not
-- a sample. Unclosed and Closed follow the mode Wavetech already used.
-- Idempotent.
-- ============================================================================

-- ── 1. the one QA agent gets the two methods he was missing ─────────────────
INSERT INTO qa2_agent_method (agent_id, method_id)
SELECT a.agent_id, m.id
  FROM (SELECT DISTINCT agent_id FROM qa2_agent_method) a
  CROSS JOIN qa2_method m
 WHERE m.code IN ('tra_fronter', 'closed_closed')
   AND NOT EXISTS (
     SELECT 1 FROM qa2_agent_method x WHERE x.agent_id = a.agent_id AND x.method_id = m.id);

-- ── 2. sampling rules for every method × each managed company ───────────────
-- One row per (company, method), for the companies a QA manager actually owns.
INSERT INTO qa2_sampling_rule (company_id, method_id, mode, quantity, min_talk_sec, is_active)
SELECT mc.company_id, m.id, 'full_coverage', NULL, 0, true
  FROM (SELECT DISTINCT company_id FROM qa2_manager_company) mc
  CROSS JOIN qa2_method m
 WHERE m.is_active
   AND m.code IN ('tra_fronter', 'unclosed_closer', 'closed_closed')
   AND NOT EXISTS (
     SELECT 1 FROM qa2_sampling_rule s
      WHERE s.company_id = mc.company_id AND s.method_id = m.id);
