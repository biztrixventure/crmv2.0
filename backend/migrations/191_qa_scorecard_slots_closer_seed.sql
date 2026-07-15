-- ============================================================================
-- 191 — QA scorecard slots for all 4 work types + seed the Closer scorecard.
--
-- Scorecards are now per WORK TYPE (commit ddc1c8b): the qa_scorecards.method
-- column is used as a slot (tra | rcm | closer_sales | closer_dispo). The old
-- CHECK only allowed tra/rcm, so creating a Closed-Sale / Unclosed-Sale
-- scorecard failed. Expand it, then seed the Closer scorecard (from the
-- "Untitled spreadsheet" closer sheet) into BOTH closer slots so the Closed Sale
-- and Unclosed Sale sections are scoreable out of the box.
--
-- The criteria below is the exact sheet_v2 encoding of the closer QA sheet:
--   • 10 rating criteria (scale 4; base = 6 included items / 30, informational)
--   • explicit-table Auto_Fail over DNC / ExistSale / Brand / BLA compliance
--     (pass_combinations are the inverse of the sheet's Auto_Fail truth table)
--   • 7-item Quality Score (post-sale disclosure compliance), gated by outcome
--   • Call Outcome (Closed / Call Back / No Conversation) → Call_Outcome_Score
--   • 3 tracking flags, meta fields. No pass/fail (final_score_formula = none).
-- Same sheet drives both Closed and Unclosed (the outcome gates the sale items).
-- ============================================================================

ALTER TABLE qa_scorecards DROP CONSTRAINT IF EXISTS qa_scorecards_method_check;
ALTER TABLE qa_scorecards ADD CONSTRAINT qa_scorecards_method_check
  CHECK (method = ANY (ARRAY['tra','rcm','closer_sales','closer_dispo']));

WITH closer_criteria AS (
  SELECT '{
    "model": "sheet_v2",
    "sheet": "Closer QA (post-sale compliance)",
    "autofail": {
      "formula_type": "explicit_table",
      "fields": [
        {"key": "compliance_dnc_check", "label": "Compliance_DNC_Check"},
        {"key": "compliance_existsale_check", "label": "Compliance_ExistSale_Check"},
        {"key": "brand_impersonation", "label": "Brand_Impersonation"},
        {"key": "sale_bla_verification_compliance", "label": "Sale_BLA_Verification_Compliance"}
      ],
      "pass_combinations": [["Y","Y","Y","Y"],["N","N","Y","N"],["N","Y","N","Y"],["Y","N","Y","N"]]
    },
    "rating_criteria": [
      {"key": "communication_energy_level", "label": "Communication_Energy_Level", "scale": 4, "included_in_base": false},
      {"key": "communication_confidence", "label": "Communication_Confidence", "scale": 4, "included_in_base": false},
      {"key": "communication_professional_tone", "label": "Communication_Professional_Tone", "scale": 4, "included_in_base": false},
      {"key": "warranty_knowledge_clarity_to_customer", "label": "Warranty_Knowledge_Clarity_to_Customer", "scale": 4, "included_in_base": false},
      {"key": "pricing_explanation_effectiveness", "label": "Pricing_Explanation_Effectiveness", "scale": 4, "included_in_base": true},
      {"key": "rebuttal_responsiveness", "label": "Rebuttal_Responsiveness", "scale": 4, "included_in_base": true},
      {"key": "rebuttal_effectiveness_nonprobe", "label": "Rebuttal_Effectiveness_NonProbe", "scale": 4, "included_in_base": true},
      {"key": "closing_intent_strength", "label": "Closing_Intent_Strength", "scale": 4, "included_in_base": true},
      {"key": "customer_respect_nonjudgmental", "label": "Customer_Respect_NonJudgmental", "scale": 4, "included_in_base": true},
      {"key": "empathy_listening", "label": "Empathy_Listening", "scale": 4, "included_in_base": true}
    ],
    "base_score_divisor": 30,
    "final_score_formula": "none",
    "base_score_informational": true,
    "penalty_flags": [],
    "tracking_flags": [
      {"key": "process_callback_creation", "label": "Process_Callback_Creation"},
      {"key": "process_alternative_offer_sell", "label": "Process_Alternative_Offer_Sell"},
      {"key": "behavior_attention_call", "label": "Behavior_Attention_Call"}
    ],
    "call_outcome": {"key": "call_outcome", "label": "Call_Outcome", "options": ["Closed","Call Back","No Conversation"], "closed_value": "Closed"},
    "quality_score": {"fields": [
      {"key": "sale_vehicle_condition_disclosure_compliance", "label": "Sale_Vehicle_Condition_Disclosure_Compliance"},
      {"key": "sale_coverage_inclusion_exclusion_clarity", "label": "Sale_Coverage_Inclusion_Exclusion_Clarity"},
      {"key": "sale_no_misrepresentation_compliance", "label": "Sale_No_Misrepresentation_Compliance"},
      {"key": "sale_waiting_period_disclosure", "label": "Sale_Waiting_Period_Disclosure"},
      {"key": "sale_deductible_explanation_accuracy", "label": "Sale_Deductible_Explanation_Accuracy"},
      {"key": "sale_payment_consent_validation", "label": "Sale_Payment_Consent_Validation"},
      {"key": "sale_company_representation_clarity", "label": "Sale_Company_Representation_Clarity"}
    ]},
    "meta_fields": [
      {"key": "center_name", "label": "Center_Name"},
      {"key": "customers_name", "label": "Customer''s_Name"},
      {"key": "zip", "label": "ZIP"},
      {"key": "year", "label": "Year"},
      {"key": "make", "label": "Make"},
      {"key": "model", "label": "Model"},
      {"key": "comments", "label": "Comments"},
      {"key": "additional_comments", "label": "Additional_Comments"}
    ],
    "pass_threshold": null
  }'::jsonb AS criteria
)
INSERT INTO qa_scorecards (company_id, method, name, criteria, pass_threshold, is_active)
SELECT NULL, slot.method, slot.name, cc.criteria, NULL, true
FROM closer_criteria cc
CROSS JOIN (VALUES
  ('closer_sales', 'Closer QA — Closed Sale'),
  ('closer_dispo', 'Closer QA — Unclosed Sale')
) AS slot(method, name)
WHERE NOT EXISTS (
  SELECT 1 FROM qa_scorecards x
  WHERE x.company_id IS NULL AND x.method = slot.method AND x.is_active
);
