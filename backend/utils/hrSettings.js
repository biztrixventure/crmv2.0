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

// rules.attendance -- read by fn_hr_attendance_sync (mig 316), whose SQL
// defaults are these same values. Change one, change both.
const ATTENDANCE_DEFAULTS = {
  auto: true,                        // sync attendance from the dialer at all
  timezone: 'Asia/Karachi',
  day_starts_at: '12:00',            // shift-day boundary: a 20:00->05:00 shift is ONE day
  shift_start: '',                   // '' = lateness is not judged
  late_after_minutes: 15,
  half_day_below_hours: 4,
  work_days: [1, 2, 3, 4, 5, 6],     // ISO weekdays, Mon=1 .. Sun=7
  absent_for: 'dialer_agents',       // dialer_agents | everyone | none
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Validate + normalise an attendance section. Throws with a sentence a person
// can act on; returns only known keys.
function cleanAttendanceRules(input = {}) {
  const r = { ...ATTENDANCE_DEFAULTS, ...(input || {}) };
  try { new Intl.DateTimeFormat('en-US', { timeZone: r.timezone }); } catch {
    throw new Error('Unknown time zone "' + r.timezone + '" -- use a name like Asia/Karachi');
  }
  if (!HHMM.test(r.day_starts_at)) throw new Error('"Day starts at" must be a time like 12:00');
  if (r.shift_start && !HHMM.test(r.shift_start)) throw new Error('"Shift starts" must be a time like 20:00, or blank');
  const late = Number(r.late_after_minutes);
  if (!Number.isInteger(late) || late < 0 || late > 240) throw new Error('Grace minutes must be a whole number from 0 to 240');
  const half = Number(r.half_day_below_hours);
  if (!Number.isFinite(half) || half < 0 || half > 24) throw new Error('Half-day hours must be between 0 and 24');
  const days = [...new Set((Array.isArray(r.work_days) ? r.work_days : []).map(Number))]
    .filter(d => Number.isInteger(d) && d >= 1 && d <= 7).sort();
  if (!['dialer_agents', 'everyone', 'none'].includes(r.absent_for)) throw new Error('Unknown absence rule');
  return {
    auto: !!r.auto,
    timezone: r.timezone,
    day_starts_at: r.day_starts_at,
    shift_start: r.shift_start || '',
    late_after_minutes: late,
    half_day_below_hours: half,
    work_days: days,
    absent_for: r.absent_for,
  };
}

async function getHrSettings(companyId) {
  if (!companyId) return { company_id: null, ...DEFAULTS, attendance: { ...ATTENDANCE_DEFAULTS }, is_default: true };
  const { data } = await supabaseAdmin
    .from('hr_settings').select('*').eq('company_id', companyId).maybeSingle();
  if (!data) return { company_id: companyId, ...DEFAULTS, attendance: { ...ATTENDANCE_DEFAULTS }, is_default: true };
  return {
    ...DEFAULTS,
    ...data,
    enroll_role_levels: data.enroll_role_levels || [],
    rules: { ...(data.rules || {}) },
    attendance: { ...ATTENDANCE_DEFAULTS, ...(data.rules?.attendance || {}) },
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
  return {
    ...DEFAULTS, ...data,
    attendance: { ...ATTENDANCE_DEFAULTS, ...(data.rules?.attendance || {}) },
    is_default: false,
  };
}

module.exports = { getHrSettings, saveHrSettings, cleanAttendanceRules, HR_DEFAULTS: DEFAULTS, ATTENDANCE_DEFAULTS };
