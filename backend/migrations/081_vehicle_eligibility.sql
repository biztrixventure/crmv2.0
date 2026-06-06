-- ============================================================================
-- 081_vehicle_eligibility.sql
-- Closes G22 — auto-warranty has plan-level vehicle eligibility caps
-- (year, miles, optionally make). Without a rules engine the system happily
-- accepts a closed_won sale on a vehicle the underwriter is going to reject
-- a week later, producing the chargeback the audit team has to clean up.
--
-- Shape (per plan, stored in business_config):
--   vehicle_eligibility = {
--     "<plan_name_lower>": {
--       "min_year":          number,         -- earliest model year accepted
--       "max_age_years":     number,         -- alternative to min_year; whichever is set wins
--       "max_miles":         number,
--       "max_age_miles_combined": [ year, miles ],  -- e.g. [10, 100000]
--       "allowed_makes":     ["honda","toyota",...] | null,
--       "disallowed_makes":  ["lamborghini",...]   | null
--     },
--     "_default": { ... fallback when no plan-specific entry exists ... }
--   }
--
-- Seed shipped here covers the plan names already in production
-- (sale_configs). New plans added later need only an admin to push the
-- eligibility row into business_config — no code change.
-- ============================================================================

INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'vehicle_eligibility',
    '{
      "_default": {
        "min_year": 2008,
        "max_miles": 150000,
        "max_age_miles_combined": null,
        "allowed_makes": null,
        "disallowed_makes": ["ferrari","lamborghini","rolls-royce","bentley","maserati"]
      },
      "omega-powertrain": {
        "min_year": 2010, "max_miles": 125000,
        "disallowed_makes": ["ferrari","lamborghini","rolls-royce","bentley","maserati","tesla"]
      },
      "omega-powertrain plus plan": {
        "min_year": 2012, "max_miles": 100000,
        "disallowed_makes": ["ferrari","lamborghini","rolls-royce","bentley","maserati"]
      },
      "omega-powertrain enhanced plan": {
        "min_year": 2014, "max_miles": 100000
      },
      "omega-stated plan": {
        "min_year": 2008, "max_miles": 200000
      },
      "omega-exclusionary plan": {
        "min_year": 2014, "max_miles": 75000,
        "allowed_makes": ["honda","toyota","ford","chevrolet","nissan","hyundai","kia","mazda","subaru","gmc","buick","chrysler","dodge","jeep"]
      },
      "nasc-essential plan":  { "min_year": 2008, "max_miles": 150000 },
      "nasc-premium plan":    { "min_year": 2012, "max_miles": 100000 },
      "nasc-signature plan":  { "min_year": 2014, "max_miles": 80000  },
      "nasc-executive plan":  { "min_year": 2016, "max_miles": 60000,
                                "disallowed_makes": ["ferrari","lamborghini","rolls-royce","bentley","maserati","tesla"] },
      "integrity-drive plan":         { "min_year": 2010, "max_miles": 125000 },
      "integrity-choice plan":        { "min_year": 2012, "max_miles": 100000 },
      "integrity-integra guard plan": { "min_year": 2014, "max_miles": 80000 }
    }'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;

-- Whether eligibility violations BLOCK the sale or just WARN the closer.
-- 'block' (recommended for production) → 400 from POST/PUT.
-- 'warn'  → response still 200 but eligibility_warning surfaces in payload.
-- Per-company override supported via the standard business_config scope.
INSERT INTO business_config (scope, key, value) VALUES
  ('global', 'vehicle_eligibility.enforcement', '"block"'::jsonb)
ON CONFLICT (scope, key) DO NOTHING;
