-- ============================================================================
-- 198 — RCM scorecard = WaveTech "RCM - Master Evaluation Sheet" (fronter call
-- monitoring). The RCM slot previously held a *closer* post-sale-compliance
-- card ("WaveTech Closer — RCM") + an "Overall (starter)" stub — neither
-- matches the RCM sheet, which is a FRONTER call-quality monitoring sheet:
-- auto-filled call context + a set of Yes/No observations + one manual
-- "QA Overall Status" Pass/Fail verdict (the evaluator's call).
--
-- Encoding (sheet_v2, see backend/utils/qaSheetFormula.js):
--   • meta_fields      — auto-filled from the assignment (call id, date, center,
--                        CLI/phone, agent, duration, customer type, fronter
--                        disposition + actual disposition). Cells stay editable.
--   • tracking_flags   — the sheet's Yes/No observation columns, verbatim
--                        labels, captured but consumed by NO formula (exactly
--                        like the sheet: they inform, they don't auto-score).
--   • manual_status    — the sheet's "QA Overall Status" Pass/Fail. This IS the
--                        authoritative pass/fail (new sheet_v2 feature). No
--                        auto-fail table / no rating math — the 96%-fail
--                        historical data shows the verdict is a holistic human
--                        call, not a derivable rule.
--
-- Deactivate the two old rcm cards (kept for history), insert the fronter card
-- as the single active rcm scorecard.
-- ============================================================================

UPDATE qa_scorecards
   SET is_active = false, updated_at = now()
 WHERE company_id IS NULL AND method = 'rcm' AND is_active = true;

INSERT INTO qa_scorecards (company_id, method, name, criteria, pass_threshold, is_active)
SELECT NULL, 'rcm', 'WaveTech RCM — Fronter Call Evaluation', '{
  "model": "sheet_v2",
  "sheet": "WaveTech RCM — Fronter Call Evaluation",
  "meta_fields": [
    {"key": "call_id",                  "label": "Call_ID"},
    {"key": "date",                     "label": "Date"},
    {"key": "fronter_center",           "label": "Fronter_Center"},
    {"key": "cli",                      "label": "CLI"},
    {"key": "fronter_agent_name",       "label": "Fronter_Agent_Name"},
    {"key": "fronter_call_duration",    "label": "Fronter_Call_Duration"},
    {"key": "customer_type",            "label": "Customer_Type"},
    {"key": "fronter_call_disposition", "label": "Fronter_Call Disposition"},
    {"key": "call_disposition_actual",  "label": "Call Disposition Actual"}
  ],
  "rating_criteria": [],
  "autofail": {"fields": [], "formula_type": "all_yes"},
  "penalty_flags": [],
  "tracking_flags": [
    {"key": "fronter_communication_energy_level",        "label": "Fronter_Communication_Energy_Level"},
    {"key": "fronter_rebuttal_usage",                    "label": "Fronter_Rebuttal_Usage"},
    {"key": "fronter_call_avoidance",                    "label": "Fronter_Call_Avoidance"},
    {"key": "fronter_hangup",                            "label": "Fronter_Hangup"},
    {"key": "fronter_compliance_misrepresentation",      "label": "Fronter_Compliance_Misrepresentation"},
    {"key": "fronter_communication_poor_listening",      "label": "Fronter_Communication_Poor_Listening"},
    {"key": "fronter_pronunciation_clarity",             "label": "Fronter_Pronunciation_Clarity"},
    {"key": "fronter_accent",                            "label": "Fronter_Accent"},
    {"key": "fronter_communication_mumbling",            "label": "Fronter_Communication_Mumbling"},
    {"key": "fronter_communication_low_confidence",      "label": "Fronter_Communication_Low_Confidence"},
    {"key": "fronter_communication_one_way_interaction", "label": "Fronter_Communication_One_Way_Interaction"},
    {"key": "disposition_change",                        "label": "Disposition Change"}
  ],
  "manual_status": {"key": "qa_overall_status", "label": "QA Overall Status", "options": ["Pass", "Fail"], "pass_value": "Pass"},
  "base_score_divisor": 30,
  "final_score_formula": "none",
  "pass_threshold": null
}'::jsonb, NULL, true
WHERE NOT EXISTS (
  SELECT 1 FROM qa_scorecards x
  WHERE x.company_id IS NULL AND x.method = 'rcm'
    AND x.name = 'WaveTech RCM — Fronter Call Evaluation'
);
