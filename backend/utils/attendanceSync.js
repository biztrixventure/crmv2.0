// ============================================================================
// utils/attendanceSync.js -- attendance from the dialer (mig 316).
//
// The work happens in ONE set-based SQL function, fn_hr_attendance_sync
// (company, from, to). This file only decides WHEN it runs and over WHICH days:
//
//   * every hour, the last 8 shift days for every company with HR records --
//     calls can land in qa2_call hours after they happen, and a missed hour
//     heals itself on the next run (the SQL writes a row only when something
//     changed, so a re-run is a no-op);
//   * on demand from HR -> Time ("Sync now"), for any range -- split into the
//     62-day chunks the SQL accepts;
//   * after anything that changes what a day should say: a leave approved or
//     cancelled, a holiday added or removed, the attendance rules changed, a
//     day handed back to the dialer.
//
// Rows a person typed or corrected (source manual/self) are never touched.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const logger = require('./logger');
const { runWithContext, getContext } = require('./requestContext');

const MAX_SPAN_DAYS = 62;

const isoDay = (d) => d.toISOString().slice(0, 10);
const addDays = (day, n) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};
// A real calendar day, not just the shape of one ("2026-13-40" is refused
// here instead of 500ing in Postgres).
const isDay = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// One company, any range (inclusive shift days).
async function syncCompany(companyId, from, to) {
  const totals = { inserted: 0, updated: 0, removed: 0, dialer_since_set: 0, runs: 0 };
  if (!companyId || !isDay(from) || !isDay(to) || from > to) return { ...totals, error: 'A valid date range is required' };
  for (let a = from; a <= to; a = addDays(a, MAX_SPAN_DAYS + 1)) {
    const end = addDays(a, MAX_SPAN_DAYS);
    const b = end < to ? end : to;
    const { data, error } = await supabaseAdmin.rpc('fn_hr_attendance_sync', { p_company: companyId, p_from: a, p_to: b });
    if (error) return { ...totals, error: error.message };
    if (data?.skipped) return { ...totals, skipped: data.skipped };
    for (const k of ['inserted', 'updated', 'removed', 'dialer_since_set']) totals[k] += Number(data?.[k] || 0);
    totals.runs += 1;
  }
  return totals;
}

// Fire-and-forget re-sync after an edit. Never fails the request that caused
// it; a failure is logged and the hourly run catches up.
function resyncSoon(companyId, from, to, why) {
  const ctx = getContext();
  setImmediate(() => runWithContext({ actorId: ctx?.actorId || null, source: 'attendance-sync' }, async () => {
    try {
      const r = await syncCompany(companyId, from, to);
      if (r.error) logger.warn('HR', 'attendance re-sync (' + why + ') failed: ' + r.error);
    } catch (e) {
      logger.warn('HR', 'attendance re-sync (' + why + ') error: ' + e.message);
    }
  }));
}

// Every company with HR records, the last `days` shift days.
async function syncAllCompanies({ days = 8 } = {}) {
  const { data, error } = await supabaseAdmin
    .from('hr_employees').select('company_id').not('user_id', 'is', null);
  if (error) { logger.warn('JOBS', 'attendance sync: ' + error.message); return; }
  const companies = [...new Set((data || []).map(r => r.company_id))];
  const to = isoDay(new Date());
  const from = addDays(to, -days);

  return runWithContext({ actorId: null, source: 'attendance-sync' }, async () => {
    let changed = 0;
    for (const companyId of companies) {
      const r = await syncCompany(companyId, from, to);
      if (r.error) logger.warn('JOBS', 'attendance sync ' + companyId + ': ' + r.error);
      changed += (r.inserted || 0) + (r.updated || 0) + (r.removed || 0);
    }
    if (changed) logger.info('JOBS', 'attendance sync: ' + changed + ' day(s) written across ' + companies.length + ' companies (' + from + '..' + to + ')');
  });
}

// The shift day still in progress in a time zone -- the JS twin of v_today in
// fn_hr_attendance_sync. Anything before it is a finished shift.
function shiftDayInProgress(tz = 'Asia/Karachi', startsAt = '12:00') {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
  } catch { return isoDay(new Date()); }
  const get = (t) => Number(parts.find(p => p.type === t)?.value || 0);
  const local = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')));
  const [h, m] = String(startsAt || '12:00').split(':').map(Number);
  local.setUTCMinutes(local.getUTCMinutes() - ((h || 0) * 60 + (m || 0)));
  return isoDay(local);
}

module.exports = { syncCompany, syncAllCompanies, resyncSoon, addDays, isDay, shiftDayInProgress };
