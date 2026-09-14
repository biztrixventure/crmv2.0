// ============================================================================
// utils/hrSettings.js -- one company's HR settings, with the defaults filled in.
//
// hr_settings (mig 314) holds a row only for companies that changed something.
// Everything reads settings through here so "no row" and "row with the default
// values" behave identically, and a rule added by a later stage gets its
// default in ONE place instead of at every caller.
//
// Editable in HR -> Settings; every change lands in the change record (mig 313).
// ============================================================================
const { supabaseAdmin } = require('../config/database');

const DEFAULTS = {
  auto_enroll: true,
  enroll_role_levels: [],        // empty = every role level
  employee_no_prefix: 'EMP-',
  exit_prompt: true,
  rules: {},
};

async function getHrSettings(companyId) {
  if (!companyId) return { company_id: null, ...DEFAULTS, is_default: true };
  const { data } = await supabaseAdmin
    .from('hr_settings').select('*').eq('company_id', companyId).maybeSingle();
  if (!data) return { company_id: companyId, ...DEFAULTS, is_default: true };
  return {
    ...DEFAULTS,
    ...data,
    enroll_role_levels: data.enroll_role_levels || [],
    rules: { ...(data.rules || {}) },
    is_default: false,
  };
}

// Upsert a partial change. `rules` is merged key by key so one screen saving
// its section never wipes another screen's section.
async function saveHrSettings(companyId, patch, userId) {
  const current = await getHrSettings(companyId);
  const row = {
    company_id: companyId,
    auto_enroll: patch.auto_enroll !== undefined ? !!patch.auto_enroll : current.auto_enroll,
    enroll_role_levels: Array.isArray(patch.enroll_role_levels)
      ? [...new Set(patch.enroll_role_levels.map(String).filter(Boolean))]
      : current.enroll_role_levels,
    employee_no_prefix: patch.employee_no_prefix !== undefined
      ? String(patch.employee_no_prefix).trim().slice(0, 12) || DEFAULTS.employee_no_prefix
      : current.employee_no_prefix,
    exit_prompt: patch.exit_prompt !== undefined ? !!patch.exit_prompt : current.exit_prompt,
    rules: patch.rules && typeof patch.rules === 'object'
      ? { ...current.rules, ...patch.rules }
      : current.rules,
    updated_by: userId || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin
    .from('hr_settings').upsert(row, { onConflict: 'company_id' }).select().single();
  if (error) throw new Error(error.message);
  return { ...DEFAULTS, ...data, is_default: false };
}

module.exports = { getHrSettings, saveHrSettings, HR_DEFAULTS: DEFAULTS };
