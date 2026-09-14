// ============================================================================
// /api/hr/people -- the CRM <-> HR link (mig 314).
//
//   GET  /settings             this company's HR settings (defaults filled in)
//   PUT  /settings             change them -- every change is in the history
//   GET  /sync                 preview: CRM members with no HR record yet
//   POST /sync                 create those records now
//   GET  /exits                departures waiting for HR (open by default)
//   POST /exits/:id/confirm    resigned | terminated, last day, reason
//   POST /exits/:id/dismiss    not a departure after all
//   GET  /positions/:employeeId  one person's joins, role changes, moves, exits
//   GET  /summary              the counts the HR home page leads with
//
// The day-to-day sync is NOT here: a database trigger on user_company_roles
// (mig 314) enrols new members, records role changes and opens exit cases the
// moment the CRM changes, whichever of its many routes made the change. These
// endpoints are the settings, the catch-up for people who were already here,
// and HR's side of each departure.
// ============================================================================
const express = require('express');
const { supabaseAdmin } = require('../../config/database');
const { asyncHandler } = require('../../middleware/errorHandler');
const { can, deny, readCompanyId, writeCompanyId, selfEmployee } = require('../../utils/moduleAccess');
const { setChangeReason } = require('../../utils/requestContext');
const { getHrSettings, saveHrSettings } = require('../../utils/hrSettings');

const router = express.Router();

const nameOf = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ') || null;

async function profileNames(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const out = {};
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabaseAdmin.from('user_profiles')
      .select('user_id, first_name, last_name').in('user_id', ids.slice(i, i + 100));
    for (const p of data || []) out[p.user_id] = nameOf(p);
  }
  return out;
}

// -- Settings ------------------------------------------------------------------
router.get('/settings', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ settings: null });
  if (await deny(req, res, companyId, 'hr.employees.view')) return;

  const settings = await getHrSettings(companyId);
  // The role levels this company actually uses, for the "who is added" picker.
  const { data: roles } = await supabaseAdmin
    .from('custom_roles').select('name, level, company_id')
    .or(`company_id.eq.${companyId},company_id.is.null`);
  const levels = {};
  for (const r of roles || []) {
    const lvl = String(r.level);
    if (['superadmin', 'readonly_admin'].includes(lvl)) continue;
    (levels[lvl] = levels[lvl] || new Set()).add(r.name);
  }
  res.json({
    settings,
    role_levels: Object.entries(levels).map(([level, names]) => ({ level, names: [...names] }))
      .sort((a, b) => a.level.localeCompare(b.level)),
    can_manage: await can(req, companyId, 'hr.employees.manage'),
  });
}));

router.put('/settings', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const b = req.body || {};
  if (b.employee_no_prefix !== undefined && !/^[A-Za-z0-9._/-]{1,12}$/.test(String(b.employee_no_prefix).trim())) {
    return res.status(400).json({ error: 'The employee number prefix can use letters, numbers and . _ / - (up to 12 characters).' });
  }
  const settings = await saveHrSettings(companyId, b, req.user.id);
  res.json({ settings });
}));

// -- Catch-up sync ---------------------------------------------------------------
router.get('/sync', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ rows: [], counts: {} });
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const { data, error } = await supabaseAdmin.rpc('fn_hr_enroll_missing', { p_company: companyId, p_apply: false });
  if (error) return res.status(500).json({ error: error.message });
  const counts = (data || []).reduce((a, r) => { a[r.action] = (a[r.action] || 0) + 1; return a; }, {});
  res.json({ rows: data || [], counts });
}));

router.post('/sync', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (!companyId) return res.status(400).json({ error: 'No company scope for this user' });
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  setChangeReason(req.body?.change_reason || 'Added from the CRM login list (people sync)');
  const { data, error } = await supabaseAdmin.rpc('fn_hr_enroll_missing', { p_company: companyId, p_apply: true });
  if (error) return res.status(500).json({ error: error.message });
  const counts = (data || []).reduce((a, r) => { a[r.action] = (a[r.action] || 0) + 1; return a; }, {});
  res.json({ rows: data || [], counts, created: counts.created || 0 });
}));

// -- Exit cases -----------------------------------------------------------------------
router.get('/exits', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ exits: [] });
  if (await deny(req, res, companyId, 'hr.employees.view')) return;

  const status = ['open', 'confirmed', 'dismissed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  let q = supabaseAdmin.from('hr_exit_cases')
    .select('*, hr_employees!inner(id, first_name, last_name, employee_no, status, hire_date, user_id)')
    .eq('company_id', companyId).order('opened_at', { ascending: false }).limit(200);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const names = await profileNames((data || []).map(r => r.handled_by));
  res.json({
    exits: (data || []).map(r => ({ ...r, handled_by_name: names[r.handled_by] || null })),
    can_manage: await can(req, companyId, 'hr.employees.manage'),
  });
}));

router.post('/exits/:id/confirm', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const b = req.body || {};
  if (!['resigned', 'terminated'].includes(b.exit_type)) {
    return res.status(400).json({ error: 'Say whether they resigned or were let go.' });
  }
  if (!b.last_day || !/^\d{4}-\d{2}-\d{2}$/.test(b.last_day)) {
    return res.status(400).json({ error: 'The last working day is required.' });
  }

  const { data: ex } = await supabaseAdmin.from('hr_exit_cases')
    .select('id, employee_id, status').eq('id', req.params.id).eq('company_id', companyId).maybeSingle();
  if (!ex) return res.status(404).json({ error: 'Exit case not found' });
  if (ex.status !== 'open') return res.status(409).json({ error: 'This case is already ' + ex.status });

  const why = (b.reason || '').trim();
  setChangeReason(why || ('Exit confirmed: ' + b.exit_type));

  // The employee record is the source of truth for status; its trigger closes
  // the case (mig 314). The case then gets the details only this screen has.
  const { error: empErr } = await supabaseAdmin.from('hr_employees')
    .update({ status: b.exit_type, termination_date: b.last_day, updated_at: new Date().toISOString() })
    .eq('id', ex.employee_id).eq('company_id', companyId);
  if (empErr) return res.status(500).json({ error: empErr.message });

  const { data, error } = await supabaseAdmin.from('hr_exit_cases').update({
    status: 'confirmed', exit_type: b.exit_type, last_day: b.last_day,
    reason: why || null,
    eligible_for_rehire: b.eligible_for_rehire === undefined ? null : !!b.eligible_for_rehire,
    handled_by: req.user.id, handled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', ex.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ exit: data });
}));

router.post('/exits/:id/dismiss', asyncHandler(async (req, res) => {
  const companyId = await writeCompanyId(req);
  if (await deny(req, res, companyId, 'hr.employees.manage')) return;

  const note = (req.body?.note || '').trim();
  if (!note) return res.status(400).json({ error: 'Say why this is not a departure (for example "on leave, login paused").' });
  setChangeReason(note);

  const { data, error } = await supabaseAdmin.from('hr_exit_cases').update({
    status: 'dismissed', note, handled_by: req.user.id,
    handled_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', req.params.id).eq('company_id', companyId).eq('status', 'open').select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'No open exit case with that id' });
  res.json({ exit: data });
}));

// -- Position history ------------------------------------------------------------------------
router.get('/positions/:employeeId', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ history: [] });

  const allowed = await can(req, companyId, 'hr.employees.view')
    || (await selfEmployee(companyId, req.user.id))?.id === req.params.employeeId;
  if (!allowed) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await supabaseAdmin.from('hr_position_history')
    .select('*').eq('company_id', companyId).eq('employee_id', req.params.employeeId)
    .order('effective_at', { ascending: false }).order('created_at', { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });

  const names = await profileNames((data || []).map(r => r.changed_by));
  res.json({ history: (data || []).map(r => ({ ...r, changed_by_name: names[r.changed_by] || null })) });
}));

// -- Summary for the HR home -------------------------------------------------------------------
router.get('/summary', asyncHandler(async (req, res) => {
  const companyId = await readCompanyId(req);
  if (!companyId) return res.json({ ready: false });
  if (await deny(req, res, companyId, 'hr.employees.view')) return;

  const [emp, openExits, members, pendingLeave] = await Promise.all([
    supabaseAdmin.from('hr_employees').select('status, source, user_id').eq('company_id', companyId),
    supabaseAdmin.from('hr_exit_cases').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'open'),
    supabaseAdmin.from('user_company_roles').select('user_id').eq('company_id', companyId).eq('is_active', true),
    supabaseAdmin.from('hr_leave_requests').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'pending'),
  ]);
  const rows = emp.data || [];
  const linked = new Set(rows.map(r => r.user_id).filter(Boolean));
  const notYetInHr = (members.data || []).filter(m => !linked.has(m.user_id)).length;
  res.json({
    ready: true,
    employees: {
      active: rows.filter(r => r.status === 'active').length,
      on_leave: rows.filter(r => r.status === 'on_leave').length,
      left: rows.filter(r => ['resigned', 'terminated'].includes(r.status)).length,
      from_crm: rows.filter(r => r.source === 'crm').length,
    },
    crm_members_not_in_hr: notYetInHr,
    open_exits: openExits.count || 0,
    pending_leave: pendingLeave.count || 0,
  });
}));

module.exports = router;
