// ============================================================================
// utils/hrSnapshot.js -- the attendance facts the HR home screens show.
// Shared by GET /hr/people/summary (one company) and GET /hr/overview (every
// company the caller can reach), so the two can never disagree.
//
//   lastShift(companyId)   the most recent FINISHED shift day and how many
//                          people worked it, were absent, half-day, on leave
//   notSeen(companyId)     active people who work the phones but have been
//                          absent 10+ working days in a row -- usually someone
//                          who left and whose login was never switched off
// Both read hr_attendance as written by the dialer sync (mig 316).
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { getHrSettings } = require('./hrSettings');
const { shiftDayInProgress, addDays } = require('./attendanceSync');

async function inProgressDay(companyId) {
  const s = await getHrSettings(companyId);
  return shiftDayInProgress(s.attendance?.timezone, s.attendance?.day_starts_at);
}

async function lastShift(companyId, inProgress) {
  const today = inProgress || await inProgressDay(companyId);
  const { data: last } = await supabaseAdmin.from('hr_attendance').select('work_date')
    .eq('company_id', companyId).lt('work_date', today)
    .order('work_date', { ascending: false }).limit(1);
  const day = last?.[0]?.work_date;
  if (!day) return { day: null, counts: {} };
  const { data } = await supabaseAdmin.from('hr_attendance').select('status')
    .eq('company_id', companyId).eq('work_date', day);
  const counts = {};
  for (const r of data || []) counts[r.status] = (counts[r.status] || 0) + 1;
  return { day, counts };
}

async function notSeen(companyId, { minDays = 10, inProgress } = {}) {
  const today = inProgress || await inProgressDay(companyId);
  const from = addDays(today, -42);
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabaseAdmin.from('hr_attendance')
      .select('employee_id, work_date, status')
      .eq('company_id', companyId).gte('work_date', from).lt('work_date', today)
      .order('employee_id').order('work_date', { ascending: false }).range(offset, offset + 999);
    if (error) break;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  const byEmp = {};
  for (const r of rows) (byEmp[r.employee_id] = byEmp[r.employee_id] || []).push(r);
  const streaks = [];
  for (const [employeeId, list] of Object.entries(byEmp)) {
    let n = 0; let since = null;
    for (const r of list) {                 // newest first
      if (r.status === 'absent') { n += 1; since = r.work_date; } else break;
    }
    if (n >= minDays) streaks.push({ employee_id: employeeId, days: n, since });
  }
  if (!streaks.length) return [];
  const { data: emps } = await supabaseAdmin.from('hr_employees').select('id, first_name, last_name, status')
    .in('id', streaks.map(s => s.employee_id));
  const byId = Object.fromEntries((emps || []).map(e => [e.id, e]));
  return streaks
    .filter(s => byId[s.employee_id]?.status === 'active')
    .map(s => ({ ...s, name: [byId[s.employee_id].first_name, byId[s.employee_id].last_name].filter(Boolean).join(' ') || 'Unnamed' }))
    .sort((a, b) => b.days - a.days);
}

module.exports = { lastShift, notSeen, inProgressDay };
