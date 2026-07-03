-- ============================================================================
-- 173_qa_sheet_scorecards.sql
-- QA Department — WaveTech sheet replication. Extends the generic QA build
-- (170) with the precise sheet scoring model and seeds BOTH real scorecards.
-- Apply AFTER 170. Idempotent.
--
--  * qa_reviews: computed-output columns (nullable — a column stays NULL when
--    not applicable to that scorecard type), meta (non-scoring sheet fields),
--    edit_history (manager override audit), 'finalized' lifecycle status.
--  * qa_review_scores.raw_value: the exact entered value ('Y'/'N', 0-4, text)
--    alongside the derived points contribution.
--  * override_qa_review permission: qa_manager may edit ANY submitted review.
--  * Seeds: 'WaveTech Fronter — TRA' + 'WaveTech Closer — RCM' as global
--    scorecards (criteria is an OBJECT, model='sheet_v2' — the legacy weighted
--    model keeps its ARRAY shape). resolveScorecard picks the newest active
--    global per method, so these become the effective defaults over the
--    'Overall (starter)' cards.
--  * The JSON blobs are dollar-quoted with $JF$ / $JC$ markers so
--    backend/verify_qa_sheet.js can parse and formula-test the EXACT seeded
--    config from this file (no config drift between test and DB).
-- ============================================================================

-- ── qa_reviews: computed outputs + audit + lifecycle ─────────────────────────
ALTER TABLE qa_reviews
  ADD COLUMN IF NOT EXISTS base_score         numeric,      -- SUM(ratings)/divisor, e.g. 0.4667
  ADD COLUMN IF NOT EXISTS autofail_result    text,         -- 'Pass' | 'Fail'
  ADD COLUMN IF NOT EXISTS total_penalty      numeric,      -- Σ(-5 per Y flag); NULL if scorecard has no flags
  ADD COLUMN IF NOT EXISTS final_score        numeric,      -- Fronter only; NULL for Closer (sheet never computes it)
  ADD COLUMN IF NOT EXISTS quality_score      numeric,      -- Closer only; NULL = no Call_Outcome set (N/A)
  ADD COLUMN IF NOT EXISTS call_outcome       text,
  ADD COLUMN IF NOT EXISTS call_outcome_score integer,      -- 1 iff Call_Outcome = 'Closed' (case-sensitive)
  ADD COLUMN IF NOT EXISTS meta               jsonb NOT NULL DEFAULT '{}'::jsonb,   -- Center_Name, ZIP, Year/Make/Model, …
  ADD COLUMN IF NOT EXISTS edit_history       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- who/when/what, before/after
  ADD COLUMN IF NOT EXISTS finalized_at       timestamptz,
  ADD COLUMN IF NOT EXISTS finalized_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Closer reviews have no pass/fail (Quality Score is informational-driving,
-- no threshold exists in the sheet) → passed must be nullable.
ALTER TABLE qa_reviews ALTER COLUMN passed DROP NOT NULL;

-- review lifecycle: + 'finalized' (manager lock). Agent edits own review only
-- while 'submitted'; a manager (override_qa_review) can edit/finalize any.
ALTER TABLE qa_reviews DROP CONSTRAINT IF EXISTS qa_reviews_status_check;
ALTER TABLE qa_reviews ADD CONSTRAINT qa_reviews_status_check
  CHECK (status IN ('submitted','finalized','disputed','void'));

-- ── qa_review_scores: raw entered value per field ────────────────────────────
ALTER TABLE qa_review_scores ADD COLUMN IF NOT EXISTS raw_value text;

-- Closer has NO pass threshold (Quality Score has no pass/fail line in the
-- sheet) — 170 declared pass_threshold NOT NULL DEFAULT 80, relax it.
ALTER TABLE qa_scorecards ALTER COLUMN pass_threshold DROP NOT NULL;

-- ── override permission ──────────────────────────────────────────────────────
INSERT INTO permissions (name, description, category) VALUES
  ('override_qa_review', 'Can edit/override any submitted QA review (audited)', 'qa')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM custom_roles r CROSS JOIN permissions p
WHERE r.level::text = 'qa_manager' AND p.name = 'override_qa_review'
ON CONFLICT DO NOTHING;

-- ── SEED: WaveTech Fronter — TRA ─────────────────────────────────────────────
-- Base = SUM(5 ratings)/30 (the /30 divisor is replicated as-found even though
-- max sum is 20). Auto_Fail = all three compliance fields 'Y' (clean AND).
-- Final = 0 on Auto_Fail, else TRUNC(Base%,1) + Σ(-5 per Y flag). Pass > 35.
INSERT INTO qa_scorecards (company_id, method, name, criteria, pass_threshold, is_active)
SELECT NULL, 'tra', 'WaveTech Fronter — TRA', $JF${
  "model": "sheet_v2",
  "sheet": "WaveTech Fronter QA (TRA)",
  "rating_criteria": [
    {"key":"communication_energy_level","label":"Communication_Energy_Level","scale":4,"included_in_base":true},
    {"key":"customer_product_understanding_call_purpose","label":"Customer_Product_Understanding_Call_Purpose","scale":4,"included_in_base":true},
    {"key":"rebuttal_usage","label":"Rebuttal_Usage","scale":4,"included_in_base":true},
    {"key":"communication_pronunciation_clarity","label":"Communication_Pronunciation_Clarity","scale":4,"included_in_base":true},
    {"key":"sales_intent","label":"Sales_Intent","scale":4,"included_in_base":true}
  ],
  "base_score_divisor": 30,
  "autofail": {
    "formula_type": "all_yes",
    "fields": [
      {"key":"qualifying_questions_asked","label":"Qualifying_Questions_Asked"},
      {"key":"compliance_consent_to_transfer","label":"Compliance_Consent_to_Transfer"},
      {"key":"compliance_misrepresentation","label":"Compliance_Misrepresentation"}
    ]
  },
  "penalty_flags": [
    {"key":"communication_poor_listening","label":"Communication_Poor_Listening","penalty":-5},
    {"key":"communication_mumbling","label":"Communication_Mumbling","penalty":-5},
    {"key":"communication_low_confidence","label":"Communication_Low_Confidence","penalty":-5},
    {"key":"comm_over_explanation","label":"Comm_Over_Explanation","penalty":-5},
    {"key":"communication_one_way_interaction","label":"Communication_One_Way_Interaction","penalty":-5},
    {"key":"rebuttal_inaccuracy","label":"Rebuttal_Inaccuracy","penalty":-5},
    {"key":"transfer_aggressive_pushy","label":"Transfer_Aggressive_Pushy","penalty":-5}
  ],
  "tracking_flags": [],
  "final_score_formula": "base_plus_penalty_truncated",
  "pass_threshold": 35,
  "quality_score": null,
  "call_outcome": null,
  "meta_fields": [
    {"key":"call_duration","label":"Call_Duration"},
    {"key":"call_out_come","label":"Call_Out_Come"},
    {"key":"comments","label":"Comments"}
  ]
}$JF$::jsonb, 35, true
WHERE NOT EXISTS (SELECT 1 FROM qa_scorecards WHERE company_id IS NULL AND method='tra' AND name='WaveTech Fronter — TRA');

-- ── SEED: WaveTech Closer — RCM (post-sale compliance) ───────────────────────
-- 10 ratings captured, ONLY 6 feed Base (informational/coaching — no pass/fail).
-- Auto_Fail = EXPLICIT 4-combination lookup table (irregular, replicated
-- exactly as data — never simplify to a boolean rule). Final_Score/Penalty:
-- never computed (sheet columns exist but are unpopulated). Quality Score
-- (the driving metric): blank outcome → N/A; Auto_Fail → 0; else %Y of 7.
INSERT INTO qa_scorecards (company_id, method, name, criteria, pass_threshold, is_active)
SELECT NULL, 'rcm', 'WaveTech Closer — RCM', $JC${
  "model": "sheet_v2",
  "sheet": "WaveTech Closer QA (RCM, post-sale compliance)",
  "rating_criteria": [
    {"key":"communication_energy_level","label":"Communication_Energy_Level","scale":4,"included_in_base":false},
    {"key":"communication_confidence","label":"Communication_Confidence","scale":4,"included_in_base":false},
    {"key":"communication_professional_tone","label":"Communication_Professional_Tone","scale":4,"included_in_base":false},
    {"key":"warranty_knowledge_clarity_to_customer","label":"Warranty_Knowledge_Clarity_to_Customer","scale":4,"included_in_base":false},
    {"key":"pricing_explanation_effectiveness","label":"Pricing_Explanation_Effectiveness","scale":4,"included_in_base":true},
    {"key":"rebuttal_responsiveness","label":"Rebuttal_Responsiveness","scale":4,"included_in_base":true},
    {"key":"rebuttal_effectiveness_nonprobe","label":"Rebuttal_Effectiveness_NonProbe","scale":4,"included_in_base":true},
    {"key":"closing_intent_strength","label":"Closing_Intent_Strength","scale":4,"included_in_base":true},
    {"key":"customer_respect_nonjudgmental","label":"Customer_Respect_NonJudgmental","scale":4,"included_in_base":true},
    {"key":"empathy_listening","label":"Empathy_Listening","scale":4,"included_in_base":true}
  ],
  "base_score_divisor": 30,
  "base_score_informational": true,
  "autofail": {
    "formula_type": "explicit_table",
    "fields": [
      {"key":"compliance_dnc_check","label":"Compliance_DNC_Check"},
      {"key":"compliance_existsale_check","label":"Compliance_ExistSale_Check"},
      {"key":"brand_impersonation","label":"Brand_Impersonation"},
      {"key":"sale_bla_verification_compliance","label":"Sale_BLA_Verification_Compliance"}
    ],
    "pass_combinations": [
      ["Y","Y","Y","Y"],
      ["N","N","Y","N"],
      ["N","Y","N","Y"],
      ["Y","N","Y","N"]
    ]
  },
  "penalty_flags": [],
  "tracking_flags": [
    {"key":"process_callback_creation","label":"Process_Callback_Creation"},
    {"key":"process_alternative_offer_sell","label":"Process_Alternative_Offer_Sell"},
    {"key":"behavior_attention_call","label":"Behavior_Attention_Call"}
  ],
  "final_score_formula": "none",
  "pass_threshold": null,
  "quality_score": {
    "fields": [
      {"key":"sale_vehicle_condition_disclosure_compliance","label":"Sale_Vehicle_Condition_Disclosure_Compliance"},
      {"key":"sale_coverage_inclusion_exclusion_clarity","label":"Sale_Coverage_Inclusion_Exclusion_Clarity"},
      {"key":"sale_no_misrepresentation_compliance","label":"Sale_No_Misrepresentation_Compliance"},
      {"key":"sale_waiting_period_disclosure","label":"Sale_Waiting_Period_Disclosure"},
      {"key":"sale_deductible_explanation_accuracy","label":"Sale_Deductible_Explanation_Accuracy"},
      {"key":"sale_payment_consent_validation","label":"Sale_Payment_Consent_Validation"},
      {"key":"sale_company_representation_clarity","label":"Sale_Company_Representation_Clarity"}
    ]
  },
  "call_outcome": {
    "key": "call_outcome",
    "label": "Call_Outcome",
    "options": ["Closed", "Call Back", "No Conversation"],
    "closed_value": "Closed"
  },
  "meta_fields": [
    {"key":"center_name","label":"Center_Name"},
    {"key":"customers_name","label":"Customer's_Name"},
    {"key":"zip","label":"ZIP"},
    {"key":"year","label":"Year"},
    {"key":"make","label":"Make"},
    {"key":"model","label":"Model"},
    {"key":"comments","label":"Comments"},
    {"key":"additional_comments","label":"Additional_Comments"}
  ]
}$JC$::jsonb, NULL, true
WHERE NOT EXISTS (SELECT 1 FROM qa_scorecards WHERE company_id IS NULL AND method='rcm' AND name='WaveTech Closer — RCM');
