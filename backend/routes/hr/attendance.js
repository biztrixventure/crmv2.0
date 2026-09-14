// ============================================================================
// /api/hr/attendance -- daily attendance records (mig 287, 316).
//
// Who sees what is decided server-side and only server-side:
//
//   hr.attendance.view_team  -- the whole company.
//   hr.attendance.view_own   -- exactly one employee: the one whose
//                               hr_employees row carries the caller user_id.
//
// hrReadScope() answers that in one call. A caller with neither the team
// permission nor an employee record gets an empty list rather than a 403 --
// they are legitimately in the company, they just have no attendance to show,
// and a 403 there reads as a bug to the person looking at it.
//
// WHO WROTE A DAY (mig 316, hr_attendance.source):
//   dialer / leave / holiday -- written by fn_hr_attendance_sync from the
//                               dialer, approved leave and company holidays.
//   manual                   -- typed or corrected by HR / a manager.
//   self                     -- the person's own check-in.
// The sync never touches manual or self rows. Correcting an automatic day
// therefore turns it into a manual one (with a reason), and "Give back to the
// dialer" (POST /:id/reset) hands it back. An automatic day cannot be deleted
// -- it would simply come back on the next sync -- only corrected.
//
// hours_worked is stored, not derived on read. It IS computed from check_in and
// check_out when both are present and the caller did not supply it, because a
// value that disagrees with its own timestamps is worse than no value.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { can, deny, readCompanyId, writeCompanyId, selfEmployee, hrReadScope } = require('../../utils/moduleAccess');
const { needReason } = require('../../utils/requestContext');
const { getHrSettings, saveHrSettings, cleanAttendanceRules } = require('../../utils/hrSettings');
const { syncCompany, resyncSoon, addDays, isDay } = require('../../utils/attendanceSync');

const router = express.Router();

const full = 'id, company_id, employee_id, work_date, check_in, check_out, hours_worked, status, note, '
  + 'source, calls, talk_seconds, late_minutes, synced_at, '
  + 'recorded_by, created_at, updated_at, hr_employees(id, first_name, last_name, employee_no, department_id)';

const AUTO = new Set(['dialer', 'leave', 'holiday']);
const STATUSES = ['present', 'absent', 'late', 'half_day', 'remote', 'holiday', 'on_leave'];
const today = () => new Date().toISOString().slice(0, 10);

// Hours between two timestamps, 2dp. null when either side is missing.
function derivedHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Number((ms / 3_600_000).toFixed(2));
}

// GET /api/hr/attendance?date_from&date_to&employee_id&department_id
router.get('/', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ attendance: [], scope: 'none' });

  const scope = await hrReadScope(req, companyId, 'hr.attendance.view_team');
  if (!scope.all && !scope.employee) return res.json({ attendance: [], scope: 'none', can_manage: false });

  // Default window: the current month. An unbounded attendance query is a table
  // scan that nobody actually wanted.
  const now = new Date();
  const from = req.query.date_from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to   = req.query.date_to   || today();

  // Paged past the 1000-row PostgREST ceiling: a month of a 90-person floor is
  // ~2,300 rows, and a silently truncated month is a wrong month.
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    let q = supabaseAdmin
      .from('hr_attendance').select(full)
      .eq('company_id', companyId)
      .gte('work_date', from).lte('work_date', to)
      .order('work_date', { ascending: false }).order('id', { ascending: true })
      .range(offset, offset + 999);
    if (!scope.all) q = q.eq('employee_id', scope.employee.id);
    else if (req.query.employee_id) q = q.eq('employee_id', req.query.employee_id);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    rows.push(...(data || []));
    if ((data || []).length < 1000 || rows.length >= 20000) break;
  }

  let out = rows;
  // Department filter is applied here rather than in the query: the column
  // lives on the joined employee, and PostgREST cannot filter an embedded
  // resource without making it an inner join, which would silently drop
  // attendance rows whose employee record was deleted.
  if (scope.all && req.query.department_id) {
    out = out.filter(r => r.hr_employees?.department_id === req.query.department_id);
  }

  const summary = out.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1;
    a.hours += Number(r.hours_worked || 0);
    return a;
  }, { hours: 0 });
  summary.hours = Number(summary.hours.toFixed(2));

  res.json({
    attendance: out,
    period: { date_from: from, date_to: to },
    scope: scope.all ? 'all' : 'own',
    my_employee_id: scope.employee?.id || null,
    can_manage: await can(req, companyId, 'hr.attendance.manage'),
    summary,
  });
}));

// GET /api/hr/attendance/me -- the caller own month, for the self-service card.
router.get('/me', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  const employee = await selfEmployee(companyId, req.user.id);
  if (!employee) return res.json({ attendance: [], employee: null });

  const now = new Date();
  const from = req.query.date_from || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to   = req.query.date_to   || today();

  const { data, error } = await supabaseAdmin
    .from('hr_attendance')
    .select('id, work_date, check_in, check_out, hours_worked, status, note, source, calls, talk_seconds, late_minutes')
    .eq('company_id', companyId).eq('employee_id', employee.id)
    .gte('work_date', from).lte('work_date', to)
    .order('work_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ attendance: data || [], employee, period: { date_from: from, date_to: to } });
}));

// -- Rules (hr_settings.rules.attendance) -------------------------------------------

// GET /api/hr/attendance/rules -- the rules plus what the floor actually does
// (median first call etc.), so "shift starts at" is typed against real data.
router.get('/rules', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ rules: null });
  if (await deny(req, res, companyId, 'hr.attendance.view_team')) return;

  const [settings, typical, since] = await Promise.all([
    getHrSettings(companyId),
    supabaseAdmin.rpc('fn_hr_attendance_typical', { p_company: companyId, p_days: 14 }),
    supabaseAdmin.from('hr_employees').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).not('dialer_since', 'is', null),
  ]);
  const { data: last } = await supabaseAdmin.from('hr_attendance').select('synced_at')
    .eq('company_id', companyId).not('synced_at', 'is', null)
    .order('synced_at', { ascending: false }).limit(1);
  res.json({
    rules: settings.attendance,
    typical: typical.data || null,
    dialer_agents: since.count || 0,
    last_synced_at: last?.[0]?.synced_at || null,
    can_manage: await can(req, companyId, 'hr.attendance.manage'),
  });
}));

// PUT /api/hr/attendance/rules -- saves, then re-judges the last 31 days so the
// screen shows the new rules at once. Days a person corrected are untouched.
router.put('/rules', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.attendance.manage')) return;

  let clean;
  try { clean = cleanAttendanceRules(req.body?.rules || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  const settings = await saveHrSettings(companyId, { rules: { attendance: clean } }, req.user.id);
  resyncSoon(companyId, addDays(today(), -31), today(), 'rules changed');
  res.json({ rules: settings.attendance, resync_from: addDays(today(), -31) });
}));

// POST /api/hr/attendance/sync { date_from, date_to } -- "Sync now", or a
// backfill. Waits for the result so the screen can say what changed.
router.post('/sync', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.attendance.manage')) return;

  const to = isDay(req.body?.date_to) ? req.body.date_to : today();
  const from = isDay(req.body?.date_from) ? req.body.date_from : addDays(to, -7);
  if (from > to) return res.status(400).json({ error: 'The start date is after the end date' });
  if (addDays(from, 400) < to) return res.status(400).json({ error: 'At most 400 days at a time' });

  const r = await syncCompany(companyId, from, to);
  if (r.error) return res.status(422).json({ error: r.error });
  res.json({ ...r, date_from: from, date_to: to });
}));

// -- Holidays --------------------------------------------------------------------

router.get('/holidays', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ holidays: [] });
  const allowed = await can(req, companyId, 'hr.attendance.view_team') || await can(req, companyId, 'hr.attendance.view_own');
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const year = /^\d{4}$/.test(String(req.query.year || '')) ? req.query.year : String(new Date().getFullYear());
  const { data, error } = await supabaseAdmin.from('hr_holidays')
    .select('id, holiday_date, name, created_at')
    .eq('company_id', companyId).gte('holiday_date', year + '-01-01').lte('holiday_date', year + '-12-31')
    .order('holiday_date', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ holidays: data || [], year: Number(year), can_manage: await can(req, companyId, 'hr.attendance.manage') });
}));

router.post('/holidays', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.attendance.manage')) return;

  const day = req.body?.holiday_date;
  const name = String(req.body?.name || '').trim().slice(0, 120);
  if (!isDay(day)) return res.status(400).json({ error: 'Pick the date of the holiday' });
  if (!name) return res.status(400).json({ error: 'Give the holiday a name' });

  const { data, error } = await supabaseAdmin.from('hr_holidays')
    .insert({ company_id: companyId, holiday_date: day, name, created_by: req.user.id }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'There is already a holiday on ' + day });
    return res.status(500).json({ error: error.message });
  }
  resyncSoon(companyId, day, day, 'holiday added');
  res.status(201).json({ holiday: data });
}));

router.delete('/holidays/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.attendance.manage')) return;
  if (needReason(req, res, 'removing this holiday')) return;

  const { data: h } = await supabaseAdmin.from('hr_holidays').select('id, holiday_date')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!h) return res.status(404).json({ error: 'Holiday not found' });
  const { error } = await supabaseAdmin.from('hr_holidays').delete().eq('id', h.id);
  if (error) return res.status(500).json({ error: error.message });
  resyncSoon(companyId, h.holiday_date, h.holiday_date, 'holiday removed');
  res.json({ ok: true });
}));

// -- Recording and correcting days -----------------------------------------------

// POST /api/hr/attendance
// Recording for SOMEONE ELSE needs hr.attendance.manage. Recording your own day
// needs only hr.attendance.view_own -- that is the self check-in. Neither may
// overwrite a day the dialer already wrote: a correction goes through PUT.
router.post('/', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });

  const self = await selfEmployee(companyId, req.user.id);
  const targetId = req.body?.employee_id || self?.id || null;
  if (!targetId) return res.status(400).json({ error: 'No employee record to record attendance against' });

  const isSelf = self && targetId === self.id;
  const gate = isSelf ? 'hr.attendance.view_own' : 'hr.attendance.manage';
  if (await deny(req, res, companyId, gate)) return;

  // The target must live in this company. Without this an employee_id from
  // another tenant would happily insert.
  const { data: target } = await supabaseAdmin
    .from('hr_employees').select('id').eq('id', targetId).eq('company_id', companyId).maybeSingle();
  if (!target) return res.status(404).json({ error: 'Employee not found in this company' });

  const b = req.body || {};
  const workDate = b.work_date || today();
  if (b.status && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status' });

  const { data: existing } = await supabaseAdmin.from('hr_attendance').select('id, source')
    .eq('company_id', companyId).eq('employee_id', targetId).eq('work_date', workDate).maybeSingle();
  if (existing && AUTO.has(existing.source)) {
    return res.status(409).json({ error: 'That day is already recorded from the ' + existing.source + '. Open it and correct it instead.', attendance_id: existing.id });
  }

  const hours = b.hours_worked !== undefined ? Number(b.hours_worked) : derivedHours(b.check_in, b.check_out);
  const { data, error } = await supabaseAdmin.from('hr_attendance').upsert({
    company_id: companyId,
    employee_id: targetId,
    work_date: workDate,
    check_in: b.check_in || null,
    check_out: b.check_out || null,
    hours_worked: hours,
    status: b.status || 'present',
    note: b.note || null,
    source: isSelf && !(await can(req, companyId, 'hr.attendance.manage')) ? 'self' : 'manual',
    recorded_by: req.user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'company_id,employee_id,work_date' }).select(full).single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ attendance: data });
}));

// PUT /api/hr/attendance/:id
//   Someone else's day (hr.attendance.manage): any change, with a reason. An
//   automatic day becomes a manual one so the sync leaves the correction alone.
//   Your own day: a day YOU recorded (self) is yours to edit; on an automatic
//   day you may only add a note -- the times come from the dialer.
router.put('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);

  const { data: existing } = await supabaseAdmin
    .from('hr_attendance').select('id, employee_id, check_in, check_out, source')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Attendance record not found' });

  const self = await selfEmployee(companyId, req.user.id);
  const isSelf = self && existing.employee_id === self.id;
  const manager = await can(req, companyId, 'hr.attendance.manage');
  if (!manager && !(isSelf && await can(req, companyId, 'hr.attendance.view_own'))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const b = req.body || {};
  const fields = ['check_in', 'check_out', 'status', 'note', 'work_date'].filter(f => b[f] !== undefined);
  const noteOnly = fields.length > 0 && fields.every(f => f === 'note') && b.hours_worked === undefined;
  if (b.status !== undefined && !STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status' });

  if (!manager && AUTO.has(existing.source) && !noteOnly) {
    return res.status(403).json({ error: 'This day comes from the ' + existing.source + '. You can add a note; ask HR to correct the times.' });
  }
  // Changing SOMEONE ELSE's day is a correction, and a correction says why.
  if (!isSelf && !noteOnly && needReason(req, res, "correcting this person's attendance")) return;

  const patch = { updated_at: new Date().toISOString(), recorded_by: req.user.id };
  for (const f of fields) patch[f] = b[f];
  if (b.hours_worked !== undefined) {
    patch.hours_worked = b.hours_worked === null ? null : Number(b.hours_worked);
  } else if (b.check_in !== undefined || b.check_out !== undefined) {
    patch.hours_worked = derivedHours(
      b.check_in !== undefined ? b.check_in : existing.check_in,
      b.check_out !== undefined ? b.check_out : existing.check_out,
    );
  }
  // A real correction takes the day away from the sync; a note does not.
  if (!noteOnly) patch.source = manager ? 'manual' : 'self';

  const { data, error } = await supabaseAdmin
    .from('hr_attendance').update(patch).eq('id', existing.id).select(full).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ attendance: data });
}));

// POST /api/hr/attendance/:id/reset -- give a corrected day back to the dialer.
// The sync then writes what the dialer says (or removes the day if the dialer
// says nothing about it).
router.post('/:id/reset', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.attendance.manage')) return;
  if (needReason(req, res, 'handing this day back to the dialer')) return;

  const { data: row } = await supabaseAdmin.from('hr_attendance').select('id, employee_id, work_date, source')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Attendance record not found' });
  if (AUTO.has(row.source)) return res.status(409).json({ error: 'This day already follows the ' + row.source });

  const { error } = await supabaseAdmin.from('hr_attendance')
    .update({ source: 'dialer', updated_at: new Date().toISOString(), recorded_by: req.user.id }).eq('id', row.id);
  if (error) return res.status(500).json({ error: error.message });
  const r = await syncCompany(companyId, row.work_date, row.work_date);
  if (r.error) return res.status(422).json({ error: r.error });

  const { data: after } = await supabaseAdmin.from('hr_attendance').select(full)
    .eq('company_id', companyId).eq('employee_id', row.employee_id).eq('work_date', row.work_date).maybeSingle();
  res.json({ attendance: after || null, removed: !after });
}));

// POST /api/hr/attendance/bulk -- one day, many employees. This is how a manager
// marks a whole team present in one action; doing it one request per person is
// what makes people stop using an attendance module. Days the dialer already
// wrote are skipped and reported, not overwritten.
router.post('/bulk', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.attendance.manage')) return;

  const rows = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!rows.length) return res.status(400).json({ error: 'records[] is required' });
  if (rows.length > 500) return res.status(400).json({ error: 'At most 500 records per call' });

  const ids = [...new Set(rows.map(r => r.employee_id).filter(Boolean))];
  const { data: valid } = await supabaseAdmin
    .from('hr_employees').select('id').eq('company_id', companyId).in('id', ids);
  const allowed = new Set((valid || []).map(e => e.id));
  const rejected = ids.filter(id => !allowed.has(id));
  if (rejected.length) return res.status(400).json({ error: 'Some employees do not belong to this company', employee_ids: rejected });

  const days = [...new Set(rows.map(r => r.work_date || today()))];
  const { data: autoRows } = await supabaseAdmin.from('hr_attendance').select('employee_id, work_date')
    .eq('company_id', companyId).in('employee_id', ids).in('work_date', days).in('source', [...AUTO]);
  const taken = new Set((autoRows || []).map(r => r.employee_id + '|' + r.work_date));

  const now = new Date().toISOString();
  const payload = rows
    .filter(r => !taken.has(r.employee_id + '|' + (r.work_date || today())))
    .map(r => ({
      company_id: companyId,
      employee_id: r.employee_id,
      work_date: r.work_date || today(),
      check_in: r.check_in || null,
      check_out: r.check_out || null,
      hours_worked: r.hours_worked !== undefined ? Number(r.hours_worked) : derivedHours(r.check_in, r.check_out),
      status: STATUSES.includes(r.status) ? r.status : 'present',
      note: r.note || null,
      source: 'manual',
      recorded_by: req.user.id,
      updated_at: now,
    }));

  if (!payload.length) return res.json({ saved: 0, skipped: taken.size, attendance: [] });
  const { data, error } = await supabaseAdmin
    .from('hr_attendance').upsert(payload, { onConflict: 'company_id,employee_id,work_date' }).select();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ saved: data?.length || 0, skipped: rows.length - payload.length, attendance: data || [] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.attendance.manage')) return;

  const { data: row } = await supabaseAdmin.from('hr_attendance').select('id, source')
    .eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Attendance record not found' });
  if (AUTO.has(row.source)) {
    return res.status(409).json({ error: 'This day comes from the ' + row.source + ' and would come straight back. Correct it instead.' });
  }
  if (needReason(req, res, 'deleting this attendance day')) return;

  const { error } = await supabaseAdmin
    .from('hr_attendance').delete().eq('id', row.id).eq('company_id', companyId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
}));

module.exports = router;
