-- ============================================================================
-- 203 — TRA scorecard = the "Fronter" sheet from the WaveTech QA Transfer file,
-- wired with its REAL weighted formula so percentages + auto pass/fail compute.
--
-- The scoring engine (qaSheetFormula.js) is correct — verified against the
-- file's own row: ratings 4,4,4,4,3 → Base 19/30 = 63.3%, two penalties −10,
-- compliance all-Y → Auto_Fail Pass, Final = trunc(63.3)+(−10) = 53.3 → Pass.
-- The TRA card just wasn't wired with that formula, so nothing computed. This
-- seeds it exactly per the Fronter sheet:
--   • 5 ratings (0–4), all in base; Base = Σ/30
--   • Auto_Fail = compliance all-Y (qualifying questions, consent, no misrep)
--   • 7 penalty flags, −5 each
--   • Final = TRUNC(Base%,1) + penalties (0 if Auto_Fail) ; Pass if Final > 40
--
-- Closer (Closed + Unclosed) already matches its sheet (mig 191); RCM stays the
-- manual fronter-monitoring card (mig 198). Pass threshold 40 is the file's
-- break (dummy data: Pass≥41.6, Fail≤31.6) — tunable in Scorecards & Config.
-- ============================================================================

UPDATE qa_scorecards SET is_active = false, updated_at = now()
 WHERE company_id IS NULL AND method = 'tra' AND is_active = true;

INSERT INTO qa_scorecards (company_id, method, name, criteria, pass_threshold, is_active)
SELECT NULL, 'tra', 'WaveTech Fronter — TRA', '{
  "model": "sheet_v2",
  "sheet": "WaveTech Fronter QA (TRA — transfer calls)",
  "meta_fields": [
    {"key": "call_id",               "label": "Call_ID"},
    {"key": "date",                  "label": "Date"},
    {"key": "fronter_center",        "label": "Fronter_Center"},
    {"key": "cli",                   "label": "CLI"},
    {"key": "fronter_agent_name",    "label": "Fronter_Agent_Name"},
    {"key": "fronter_call_duration", "label": "Fronter_Call_Duration"},
    {"key": "call_out_come",         "label": "Call_Out_Come"}
  ],
  "rating_criteria": [
    {"key": "communication_energy_level",     "label": "Fronter_Communication_Energy_Level",                  "scale": 4, "included_in_base": true},
    {"key": "customer_product_understanding", "label": "Fronter_Customer_Product_Understanding_Call_Purpose", "scale": 4, "included_in_base": true},
    {"key": "rebuttal_usage",                 "label": "Fronter_Rebuttal_Usage",                              "scale": 4, "included_in_base": true},
    {"key": "pronunciation_clarity",          "label": "Fronter_Communication_Pronunciation_Clarity",         "scale": 4, "included_in_base": true},
    {"key": "sales_intent",                   "label": "Fronter_Sales_Intent",                                "scale": 4, "included_in_base": true}
  ],
  "base_score_divisor": 30,
  "autofail": {
    "formula_type": "all_yes",
    "fields": [
      {"key": "qualifying_questions_asked",     "label": "Fronter_Qualifiying_Questions_Asked"},
      {"key": "compliance_consent_to_transfer", "label": "Fronter_Compliance_Consent_to_Transfer"},
      {"key": "compliance_misrepresentation",   "label": "Fronter_Compliance_Misrepresentation"}
    ]
  },
  "penalty_flags": [
    {"key": "poor_listening",            "label": "Fronter_Communication_Poor_Listening",      "penalty": -5},
    {"key": "mumbling",                  "label": "Fronter_Communication_Mumbling",            "penalty": -5},
    {"key": "low_confidence",            "label": "Fronter_Communication_Low_Confidence",      "penalty": -5},
    {"key": "over_explanation",          "label": "Fronter_Comm_Over_Explanation",             "penalty": -5},
    {"key": "one_way_interaction",       "label": "Fronter_Communication_One_Way_Interaction", "penalty": -5},
    {"key": "rebuttal_inaccuracy",       "label": "Fronter_Rebuttal_Inaccuracy",               "penalty": -5},
    {"key": "transfer_aggressive_pushy", "label": "Fronter_Transfer_Aggressive_Pushy",         "penalty": -5}
  ],
  "final_score_formula": "base_plus_penalty_truncated",
  "pass_threshold": 40
}'::jsonb, 40, true
WHERE NOT EXISTS (SELECT 1 FROM qa_scorecards x WHERE x.company_id IS NULL AND x.method = 'tra' AND x.name = 'WaveTech Fronter — TRA');
