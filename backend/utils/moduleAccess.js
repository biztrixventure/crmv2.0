// ============================================================================
// utils/moduleAccess.js -- the one gate for the Accounting and HR modules.
//
// Two ways in, and only two:
//
//   1. A PERMISSION on your role (mig 290 seeds them; user_permission_overrides
//      still grants or revokes per user, exactly as everywhere else).
//   2. A DESIGNATION -- module_designations says a superadmin also made you an
//      accountant or an HR manager, without touching your role.
//
// (2) exists because nobody will hold the accountant / hr_manager ROLE. The
// people who do these jobs already hold compliance_manager, company_admin or
// operations_manager, and moving their role would move their shell and their
// permission set. The QA department hit this exact wall and solved it the same
// way (mig 227, qa_managers) -- this is that pattern, generalised to two modules.
//
// A designation grants its module IN FULL. That is the whole meaning of "this
// person also works as the accountant"; a half-designated accountant who cannot
// post a journal entry is not one.
//
// Company scoping lives here too, so no route has to reinvent it:
//   readCompanyId  -- honours ?company_id= only for members / cross-company admins
//   writeCompanyId -- NEVER takes a company from a normal user's payload
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { hasPermission, isSuperAdmin, resolveScopedCompanyId } = require('../models/helpers');
const cache = require('./cache');

const MODULES = ['accounting', 'hr'];
const DESIG_TTL_MS = 30_000;          // same TTL as the permission cache

// 'accounting.invoices.manage' -> 'accounting'
const moduleOf = (permission) => {
  const head = String(permission || '').split('.')[0];
  return MODULES.includes(head) ? head : null;
};

// Every module a user has been designated for. Cached per user, invalidated by
// setDesignation below. A missing table (290 not applied yet) reads as "none",
// never as an error -- the app must keep working mid-rollout.
const designatedModules = async (userId) => {
  if (!userId) return [];
  return cache.remember('moduleDesig', String(userId), DESIG_TTL_MS, async () => {
    const { data, error } = await supabaseAdmin
      .from('module_designations').select('module').eq('user_id', userId);
    if (error) return [];
    return (data || []).map(r => r.module);
  });
};

const isDesignated = async (userId, module) =>
  (await designatedModules(userId)).includes(module);

const invalidateDesignation = (userId) => {
  if (userId) cache.invalidate('moduleDesig', String(userId));
  else cache.invalidateNamespace('moduleDesig');
};

// The check every handler calls. Superadmin first (they bypass everywhere else
// in this app too), then the role permission, then the designation.
const can = async (req, companyId, permission) => {
  if (!req?.user?.id) return false;
  if (await isSuperAdmin(req.user.id)) return true;
  if (companyId && await hasPermission(req.user.id, companyId, permission)) return true;
  const mod = moduleOf(permission);
  return mod ? isDesignated(req.user.id, mod) : false;
};

// Guard sugar: returns true when it already sent a 403, so callers read
//   if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;
const deny = async (req, res, companyId, permission) => {
  if (await can(req, companyId, permission)) return false;
  res.status(403).json({ error: 'Forbidden' });
  return true;
};

// Which company a LIST request may read. Delegates to the shared resolver, so a
// stale ?company_id= in a bookmark degrades to the caller's own company instead
// of 403-ing -- the behaviour /sales and /transfers already have.
const readCompanyId = (req) => resolveScopedCompanyId(req);

// Which company a WRITE lands in. A normal user's company comes from their
// active user_company_roles row (authMiddleware resolved it); a company_id in
// the body is ignored outright.
//
// Superadmin is the one exception and has to be: they have no company of their
// own (authMiddleware sets company_id = null), so without honouring an explicit
// company they could not write anywhere at all. Same bypass they already have
// on every other resource.
const writeCompanyId = async (req) => {
  if (await isSuperAdmin(req.user.id)) {
    return req.body?.company_id || req.query?.company_id || req.user.company_id || null;
  }
  return req.user.company_id || null;
};

// The caller's OWN employee record in a company, or null. This is how
// hr.payroll.view_own / hr.reviews.participate resolve "me": routes look the
// employee up from (company_id, user_id) and never accept an employee_id from
// the client for a self-service read.
const selfEmployee = async (companyId, userId) => {
  if (!companyId || !userId) return null;
  const { data } = await supabaseAdmin
    .from('hr_employees')
    .select('id, company_id, user_id, first_name, last_name, department_id, position_id, manager_employee_id, status')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle();
  return data || null;
};

// Read scope for one HR resource, in one call:
//   { companyId, employee, all }  -- all=true means they may see everyone.
// A caller with neither the team permission nor an employee record gets
// { all:false, employee:null }, and the route returns an empty list rather than
// leaking the company.
const hrReadScope = async (req, companyId, teamPermission) => {
  const all = await can(req, companyId, teamPermission);
  const employee = all ? null : await selfEmployee(companyId, req.user.id);
  return { companyId, all, employee };
};

// Set or clear a designation. Superadmin-only -- callers enforce that.
const setDesignation = async (userId, module, enabled, byUserId) => {
  if (!MODULES.includes(module)) throw new Error('Unknown module');
  if (enabled) {
    const { error } = await supabaseAdmin.from('module_designations')
      .upsert({ user_id: userId, module, designated_by: byUserId }, { onConflict: 'user_id,module' });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin.from('module_designations')
      .delete().eq('user_id', userId).eq('module', module);
    if (error) throw new Error(error.message);
  }
  invalidateDesignation(userId);
};

module.exports = {
  MODULES,
  moduleOf,
  can,
  deny,
  isDesignated,
  designatedModules,
  invalidateDesignation,
  setDesignation,
  readCompanyId,
  writeCompanyId,
  selfEmployee,
  hrReadScope,
};
