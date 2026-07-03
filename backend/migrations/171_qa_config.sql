-- ============================================================================
-- 171_qa_config.sql
-- QA Department — STEP 4. Seed the GLOBAL defaults for the qa.* config keys in
-- business_config. Per-company overrides (scope='company:<uuid>') are written at
-- runtime by a qa_manager via the config route — NOT seeded here.
--
-- CRITICAL ROLLOUT SAFETY: qa.methods defaults to [] (empty) → NO company does
-- any QA until it is explicitly configured. The materialization jobs (Section 4)
-- read the resolved qa.methods and skip any company whose list is empty, so
-- applying this migration turns NOTHING on. (Discovery §3 / Section 7 check.)
--
-- Resolver (utils/businessConfig.js): company:<id> → global → code fallback.
-- Apply AFTER 170. Idempotent (ON CONFLICT DO NOTHING preserves any edits).
-- ============================================================================

INSERT INTO business_config (scope, key, value) VALUES
  -- Which methods a company runs. [] = QA OFF (default). Override per company:
  --   ["tra"]  or  ["tra","rcm"]
  ('global', 'qa.methods', '[]'::jsonb),

  -- When RCM is on, which roles it samples. Default fronter-only; a company can
  -- opt into closer coverage: ["fronter","closer"].
  ('global', 'qa.rcm.covers', '["fronter"]'::jsonb),

  -- RCM sample size + cadence.
  --   mode: "percentage" (value = % of the period's eligible calls)
  --       | "fixed"      (value = exactly N calls per period)
  --   period: "day" | "week"
  ('global', 'qa.rcm.sample', '{"mode":"percentage","value":10,"period":"week"}'::jsonb),

  -- TRA population: which transfer statuses count as "a transferred call to
  -- review". ["all"] = every transfer (true 100% coverage). Otherwise an explicit
  -- list from the transfer status catalog, e.g. ["assigned","completed"].
  ('global', 'qa.tra.population', '{"statuses":["all"]}'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- qa.scorecard.tra / qa.scorecard.rcm are intentionally NOT seeded globally:
-- they hold a company-scoped scorecard UUID when a qa_manager picks one. The
-- review route falls back to the GLOBAL starter scorecard for the method (seeded
-- in 170) when no company scorecard is configured — so scoring works out of the
-- box without a per-company pick.
