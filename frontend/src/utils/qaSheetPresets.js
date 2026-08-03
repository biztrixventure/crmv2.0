// ============================================================================
// qaSheetPresets — the client's own evaluation sheets, as loadable layouts.
//
// Extracted from QAShell so there is ONE definition of each layout: the editor's
// "Load …" button reads it, and backend/tools/gen_qa_preset_sql.mjs generates
// the migration that writes the same layout onto the live cards from this exact
// file. If these ever drifted apart, the sheet a reviewer sees and the sheet a
// manager edits would quietly disagree.
// ============================================================================

// ── the client's own sheets, as loadable layouts ─────────────────────────────
// One entry per QA method, each transcribed from the WaveTech workbook tab that
// method replicates — the client's column order, the client's spelling
// ("Callbak Date" is theirs; corrected here it would stop matching the source
// sheet). Keys are the ones the live cards ALREADY use, so loading a layout
// re-uses each column's review history instead of orphaning it.
//
// The computed columns of those sheets — Base_Score, Auto_Fail, Total_Penalty,
// Final_Score, Quality Score, Call Outcome Score, QA Overall Status — are NOT
// listed: the engine prints them, nobody fills them in.
// The client's WaveTech sheet Call_Out_Come list (Rough Work / Fronter tabs).
// Declared HERE, above SHEET_PRESETS: the presets spread it at module load, and
// a const referenced before its declaration is a TDZ crash on import, not a
// warning.
export const WAVETECH_OUTCOMES = [
  'Passed', 'Qualifying Questions Missing', 'Consent not taken properly', 'Inaccurate rebuttal',
  'Sarcastic CX', 'NEFW', 'Defective listening', 'DAIR', 'Misguide', 'No Consent', 'Windowshop',
  'Overeducating', 'Already Have Warranty', "Lack of cx's understanding", 'Wrong verbiage',
  'Communication', 'Free Sense', 'Paid Off Dealership Warranty', 'Probe Missing', 'Script Bound',
  'Incomplete Product Context', 'Multiple Parameter Issue', 'Lack of rebuttal',
];

export const P = {
  meta:   (key, label, source) => ({ key, label, role: 'meta', input: { kind: 'text' }, ...(source ? { source } : {}) }),
  date:   (key, label, source) => ({ key, label, role: 'meta', input: { kind: 'date' }, ...(source ? { source } : {}) }),
  score:  (key, label, min, max) => ({ key, label, role: 'score', input: { kind: 'scale', min, max, step: 1 } }),
  // A weighted band: the reviewer picks from a fixed list and the pick IS the
  // points (0/5/10/15/20). `max` is the column's ceiling, so a "(10)" column
  // offers 0,5,10 and a "(20)" column offers 0,5,10,15,20 — exactly the
  // per-column dropdowns the client's sheet defines in Working!I.
  band:   (key, label, max, step = 5) => ({
    key, label, role: 'score', included_in_base: true,
    input: { kind: 'choice', options: Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => String(i * step)) },
  }),
  choice: (key, label, role, options) => ({ key, label, role, input: { kind: 'choice', options } }),
  yn:     (key, label, role) => ({ key, label, role, input: { kind: 'yn' } }),
  pen:    (key, label) => ({ key, label, role: 'penalty', penalty: -5, input: { kind: 'yn' } }),
  outcome: (key, label) => ({ key, label, role: 'outcome', input: { kind: 'choice', options: [] } }),
  verdict: (key, label) => ({ key, label, role: 'verdict', input: { kind: 'choice', options: [] } }),
};

export const SHEET_PRESETS = {
  // Closer / Unclosed Sale — the 23-column layout, 5 ratings × max 5 = divisor 25.
  closer_dispo: {
    label: 'Closer — Unclosed Sale (23 columns)',
    divisor: 25,
    outcome: { key: 'call_outcome', label: 'Call Outcome', options: ['Closed', 'Callback', 'No Conversation'], closed_value: 'Closed' },
    // "Call Status" is the reviewer's verdict, not a detail column — the sample
    // row fills it "Pass". As manual_status it drives QA Overall Status.
    manual_status: { key: 'call_status', label: 'Call Status', options: ['Pass', 'Fail'], pass_value: 'Pass' },
    fields: () => [
      P.date('date', 'Date'),
      P.meta('center_name', 'Center Name', 'center_name'),
      P.meta('closer_agent_name', 'Closer_Agent_Name', 'agent_name'),
      P.meta('cli', 'CLI', 'phone'),
      P.meta('closer_call_duration', 'Closer_Call_Duration', 'duration'),
      P.score('closer_communication_energy_level_tone', 'Closer_Communication_Energy_Level/Tone', 1, 5),
      P.score('closer_warranty_knowledge_clarity_to_customer', 'Closer_Warranty_Knowledge_Clarity_to_Customer', 1, 5),
      P.score('closer_pricing_explanation_effectiveness', 'Closer_Pricing_Explanation_Effectiveness', 1, 5),
      P.score('closer_rebuttal_responsiveness', 'Closer_Rebuttal_Responsiveness', 1, 5),
      P.score('closer_closing_intent_strength', 'Closer_Closing_Intent_Strength', 1, 5),
      P.verdict('call_status', 'Call Status'),
      P.outcome('call_outcome', 'Call Outcome'),
      P.date('callbak_date', 'Callbak Date'),
      P.meta('comments', 'Comments', 'vici:comments'),
      P.meta('additional_comments', 'Additional Comments', 'none'),
      // Y/N like every other flag in the CRM. The sheet prints Yes/No, but a
      // Yes/No *stored* value cannot be shown by a Y/N control and read back as
      // N in the completed table — the engine accepts both, the UI writes Y/N.
      P.yn('wrong_dispo', 'Wrong Dispo', 'tracking'),
      P.meta('evaluated_by', 'Evaluated by', 'reviewer_name'),
      P.meta('customers_name', "Customer's Name", 'customer_name'),
      P.meta('zip', 'ZIP', 'zip'),
      P.meta('year', 'Year', 'vici:province'),
      P.meta('make', 'Make', 'vici:address2'),
      P.meta('model', 'Model', 'vici:address3'),
    ],
  },

  // TRA — "TRA for scorecard.xlsx", Data tab. A WEIGHTED sheet, not the 0–4
  // rating model the older WaveTech Fronter tab used: six columns, each picked
  // from its own band list, and Score is their plain sum (=G+H+I+J+K+L,
  // verified against the file's rows: 5+10+15+20+10+15 = 75).
  //
  // The bands are the file's, unchanged, and they total 95 — so the divisor is
  // 100 and Base_Score prints the same number the sheet's Score column prints
  // (75 → 75.0%), with a perfect call reading 95%, exactly as the sheet does.
  //
  // Pass/fail is NOT derived from the score here: "Final Status" is a manual
  // Pass/Fail dropdown and it is authoritative. "Status" (Standard / Below
  // Standard) rides along for reporting and never moves the number.
  tra: {
    label: 'Fronter — TRA (weighted, from “TRA for scorecard”)',
    divisor: 100,
    manual_status: { key: 'final_status', label: 'Final Status', options: ['Pass', 'Fail'], pass_value: 'Pass' },
    fields: () => [
      P.date('date', 'Date'),
      P.meta('fronter_agent_name', 'Agents', 'agent_name'),
      P.meta('fronter_center', 'Company', 'fronter_center'),
      P.meta('cli', 'CLI', 'phone'),
      P.meta('fronter_call_duration', 'Duration', 'duration'),
      P.band('greeting_cro_energy', 'Greeting/CRO energy (10)', 10),
      P.band('communication', 'Communication (20)', 20),
      P.band('customer_understanding', 'Customer Understanding (20)', 20),
      P.band('qualifying_questions', "Qualifying Q's (20)", 20),
      P.band('misguide', 'Misguide (10)', 10),
      P.band('use_of_rebuttals', 'Use of Rebuttals (15)', 15),
      P.meta('comments', 'Comments', 'vici:comments'),
      P.verdict('final_status', 'Final Status'),
      P.choice('status', 'Status', 'tracking', ['Standard', 'Below Standard']),
      P.meta('reason_of_rejection', 'Reason of rejection'),
      P.meta('evaluated_by', 'Evaluator Name', 'reviewer_name'),
      P.meta('closer_call_duration', 'Closer Call Duration', 'none'),
      P.meta('closer_disposition', 'Closer Disposition', 'disposition'),
    ],
  },

  // RCM — "Data" tab of the RCM sheet. No ratings at all: a monitoring sheet
  // whose verdict the evaluator sets by hand.
  rcm: {
    label: 'Fronter — RCM monitoring (WaveTech “Data” tab)',
    manual_status: { key: 'qa_overall_status', label: 'QA Overall Status', options: ['Pass', 'Fail'], pass_value: 'Pass' },
    fields: () => [
      P.meta('call_id', 'Call_ID', 'call_id'),
      P.meta('date', 'Date', 'date'),
      P.meta('fronter_center', 'Fronter_Center', 'fronter_center'),
      P.meta('cli', 'CLI', 'phone'),
      P.meta('fronter_agent_name', 'Fronter_Agent_Name', 'agent_name'),
      P.meta('fronter_call_duration', 'Fronter_Call_Duration', 'duration'),
      P.yn('fronter_communication_energy_level', 'Fronter_Communication_Energy_Level', 'tracking'),
      P.yn('fronter_rebuttal_usage', 'Fronter_Rebuttal_Usage', 'tracking'),
      P.yn('fronter_call_avoidance', 'Fronter_Call_Avoidance', 'tracking'),
      P.meta('customer_type', 'Customer_Type'),
      P.yn('fronter_hangup', 'Fronter_Hangup', 'tracking'),
      P.yn('fronter_compliance_misrepresentation', 'Fronter_Compliance_Misrepresentation', 'tracking'),
      P.yn('fronter_communication_poor_listening', 'Fronter_Communication_Poor_Listening', 'tracking'),
      P.yn('fronter_pronunciation_clarity', 'Fronter_Pronunciation_Clarity', 'tracking'),
      P.yn('fronter_accent', 'Fronter_Accent', 'tracking'),
      P.yn('fronter_communication_mumbling', 'Fronter_Communication_Mumbling', 'tracking'),
      P.yn('fronter_communication_low_confidence', 'Fronter_Communication_Low_Confidence', 'tracking'),
      P.yn('fronter_communication_one_way_interaction', 'Fronter_Communication_One_Way_Interaction', 'tracking'),
      P.meta('fronter_call_disposition', 'Fronter_Call Disposition', 'disposition'),
      // the REAL disposition, judged by the reviewer — never auto-filled, or the
      // sheet would be grading the dialer against itself
      P.meta('call_disposition_actual', 'Call Disposition Actual', 'none'),
      P.yn('disposition_change', 'Disposition Change', 'tracking'),
      P.verdict('qa_overall_status', 'QA Overall Status'),
      P.meta('evaluated_by', 'Evaluated by', 'reviewer_name'),
      P.meta('comments', 'Comments', 'vici:comments'),
    ],
  },

  // Closed Sale — "Closer" tab. 10 ratings of which only some count toward the
  // base (the merge below keeps whichever flags the live card already carries),
  // then the 7-item sale-compliance checklist.
  closer_sales: {
    label: 'Closer — Closed Sale (WaveTech “Closer” tab)',
    divisor: 30,
    outcome: { key: 'call_outcome', label: 'Call Outcome', options: ['Closed', 'Call Back', 'No Conversation'], closed_value: 'Closed' },
    fields: () => [
      P.meta('date', 'Date', 'date'),
      P.meta('closer_agent_name', 'Closer_Agent_Name', 'agent_name'),
      P.meta('cli', 'CLI', 'phone'),
      P.meta('closer_call_duration', 'Closer_Call_Duration', 'duration'),
      P.score('communication_energy_level', 'Closer_Communication_Energy_Level', 0, 4),
      P.score('communication_confidence', 'Closer_Communication_Confidence', 0, 4),
      P.score('communication_professional_tone', 'Closer_Communication_Professional_Tone', 0, 4),
      P.score('warranty_knowledge_clarity_to_customer', 'Closer_Warranty_Knowledge_Clarity_to_Customer', 0, 4),
      P.score('pricing_explanation_effectiveness', 'Closer_Pricing_Explanation_Effectiveness', 0, 4),
      P.score('rebuttal_responsiveness', 'Closer_Rebuttal_Responsiveness', 0, 4),
      P.score('rebuttal_effectiveness_nonprobe', 'Closer_Rebuttal_Effectivesness (Non Probe)', 0, 4),
      P.score('closing_intent_strength', 'Closer_Closing_Intent_Strength', 0, 4),
      P.score('customer_respect_nonjudgmental', 'Closer_Customer_Respect_Non_Judgmental', 0, 4),
      P.score('empathy_listening', 'Closer_Empathy_Listening', 0, 4),
      P.yn('compliance_dnc_check', 'Closer_Compliance_DNC_Check', 'autofail'),
      P.yn('compliance_existsale_check', 'Closer_Compliance_ExistSale_Check', 'autofail'),
      P.yn('brand_impersonation', 'Brand_Impersonation', 'autofail'),
      P.yn('sale_bla_verification_compliance', 'Sale_BLA_Verification_Compliance', 'autofail'),
      P.yn('process_callback_creation', 'Closer_Process_Callback_Creation', 'tracking'),
      P.yn('process_alternative_offer_sell', 'Closer_Process_Alternative_Offer_Sell', 'tracking'),
      P.yn('behavior_attention_call', 'Closer_Behavior_Attention_Call', 'tracking'),
      P.outcome('call_outcome', 'Call Outcome'),
      P.yn('sale_vehicle_condition_disclosure_compliance', 'Sale_Vehicle_Condition_Disclosure_Compliance', 'quality'),
      P.yn('sale_coverage_inclusion_exclusion_clarity', 'Sale_Coverage_Inclusion_Exclusion_Clarity', 'quality'),
      P.yn('sale_no_misrepresentation_compliance', 'Sale_No_Misrepresentation_Compliance', 'quality'),
      P.yn('sale_waiting_period_disclosure', 'Sale_Waiting_Period_Disclosure', 'quality'),
      P.yn('sale_deductible_explanation_accuracy', 'Sale_Deductible_Explanation_Accuracy', 'quality'),
      P.yn('sale_payment_consent_validation', 'Sale_Payment_Consent_Validation', 'quality'),
      P.yn('sale_company_representation_clarity', 'Sale_Company_Representation_Clarity', 'quality'),
      P.meta('center_name', 'Center Name', 'center_name'),
      P.meta('comments', 'Comments', 'vici:comments'),
      P.meta('additional_comments', 'Additional Comments', 'none'),
      P.meta('evaluated_by', 'Evaluated by', 'reviewer_name'),
      P.meta('customers_name', "Customer's Name", 'customer_name'),
      P.meta('zip', 'ZIP', 'zip'),
      P.meta('year', 'Year', 'vici:province'),
      P.meta('make', 'Make', 'vici:address2'),
      P.meta('model', 'Model', 'vici:address3'),
    ],
  },
};

// Applying a layout MERGES BY KEY. A column the card already has keeps the
// settings a manager tuned on it — which ratings count toward the base (the
// Closed Sale card scores only some of its ten), a penalty's point value, a
// source already mapped — while taking the layout's position, group and input.
// Rebuilding those from scratch would silently re-score every future review.
export function applyPresetFields(existing, preset) {
  const byKey = new Map((existing || []).map(f => [f.key, f]));
  return preset.map(p => {
    const cur = byKey.get(p.key);
    if (!cur) return p.role === 'score' ? { included_in_base: true, ...p } : p;
    const merged = { ...cur, ...p };
    if (cur.source && !p.source) merged.source = cur.source;           // keep a mapping the layout doesn't name
    if (p.role === 'score') merged.included_in_base = cur.included_in_base !== undefined ? cur.included_in_base : true;
    if (p.role === 'penalty' && cur.penalty != null) merged.penalty = cur.penalty;
    delete merged._new;
    return merged;
  });
}
