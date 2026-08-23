// ============================================================================
// utils/moduleAccess.js -- the one gate for the Accounting and HR modules.
//
// Two ways in, and only two:
//
//   1. A PERMISSION on your role, in a company you belong to (mig 290 seeds
//      them; user_permission_overrides still grants or revokes per user).
//   2. A DESIGNATION -- a superadmin also made you the accountant or the HR
//      manager, IN NAMED COMPANIES (mig 290 + 293), without touching your role.
//
// (2) exists because nobody will hold the accountant / hr_manager ROLE. The
// people who do these jobs already hold compliance_manager, company_admin or
// operations_manager, and moving their role would move their shell and their
// permission set. The QA department hit this exact wall and solved it the same
// way (mig 227, qa_managers).
//
// COMPANY SCOPE is the part that makes a designation useful rather than
// decorative. The job is frequently cross-tenant: a compliance manager who
// belongs to 1-Vertex may be the person who runs HR and the books for Wavetech
// Infomatics, a company they are not a member of. So the designation carries a
// company list, and that list is honoured by all three of the checks below --
// the permission check, the read scope and the write scope. Scoping only the
// permission would produce a user who is allowed to see Wavetech and can never
// be pointed at it.
//
//   list present -> the designation covers EXACTLY those companies.
//   list empty   -> it covers the companies they are already a member of,
//                   which is what mig 290 meant before 293 existed. Existing
//                   designations therefore keep working untouched.
//
// Membership always still counts on top: being designated for Wavetech adds
// Wavetech, it never removes your own company.
//
// Routes never pass the module name around -- the module router stamps
// req.moduleKey once (see routes/accounting/index.js), so every helper here can
// resolve scope without 119 call sites having to agree on an extra argument.
// ============================================================================
const { supabaseAdmin } = require('../config/database');
const { hasPermission, isSuperAdmin, isCompanyMember, getUserCompanies } = require('../models/helpers');
const cache = require('./cache');

const MODULES = ['accounting', 'hr'];
const DESIG_TTL_MS = 30_000;          // same TTL as the permission cache

// 'accounting.invoices.manage' -> 'accounting'
const moduleOf = (permission) => {
  const head = String(permission || '').split('.')[0];
  return MODULES.includes(head) ? head : null;
};

const isCrossCompany = (req) => ['superadmin', 'readonly_admin'].includes(req?.user?.role);

// Every module a user has been designated for. Cached per user, invalidated by
// setDesignation. A missing table (290 not applied yet) reads as "none", never
// as an error -- the app must keep working mid-rollout.
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

// The explicit company list for one (user, module). Empty array means "not
// scoped" -- see the header for what that falls back to. A missing table (293
// not applied) also reads as empty, which is exactly the pre-293 behaviour.
const designatedCompanies = async (userId, module) => {
  if (!userId || !MODULES.includes(module)) return [];
  return cache.remember('moduleDesigCo', `${userId}|${module}`, DESIG_TTL_MS, async () => {
    const { data, error } = await supabaseAdmin
      .from('module_designation_companies')
      .select('company_id').eq('user_id', userId).eq('module', module);
    if (error) return [];
    return (data || []).map(r => r.company_id);
  });
};

const invalidateDesignation = (userId) => {
  if (userId) {
    cache.invalidate('moduleDesig', String(userId));
    for (const m of MODULES) cache.invalidate('moduleDesigCo', `${userId}|${m}`);
  } else {
    cache.invalidateNamespace('moduleDesig');
    cache.invalidateNamespace('moduleDesigCo');
  }
};

// Does the designation reach this company?
//   not designated      -> no
//   designated, scoped  -> only the named companies
//   designated, unscoped-> anywhere they are a member (the mig 290 meaning)
const designationCovers = async (userId, module, companyId) => {
  if (!module || !companyId) return false;
  if (!(await isDesignated(userId, module))) return false;
  const scope = await designatedCompanies(userId, module);
  if (scope.length === 0) return isCompanyMember(userId, companyId);
  return scope.includes(companyId);
};

// The check every handler calls. Superadmin first (they bypass everywhere else
// in this app too), then the role permission, then the designation.
const can = async (req, companyId, permission) => {
  if (!req?.user?.id) return false;
  if (await isSuperAdmin(req.user.id)) return true;
  if (companyId && await hasPermission(req.user.id, companyId, permission)) return true;
  return designationCovers(req.user.id, moduleOf(permission), companyId);
};

// Guard sugar: returns true when it already sent a 403, so callers read
//   if (await deny(req, res, companyId, 'accounting.invoices.manage')) return;
const deny = async (req, res, companyId, permission) => {
  if (await can(req, companyId, permission)) return false;
  res.status(403).json({ error: 'Forbidden' });
  return true;
};

// May this caller point the module at this company at all?
// Membership OR a designation that names it. This is the single rule both the
// read and the write scope are built on, so they can never disagree.
const mayUseCompany = async (req, companyId) => {
  if (!companyId) return false;
  if (isCrossCompany(req) || await isSuperAdmin(req.user.id)) return true;
  if (companyId === req.user.company_id) return true;
  if (await isCompanyMember(req.user.id, companyId)) return true;
  const mod = req.moduleKey;
  if (!mod) return false;
  const scope = await designatedCompanies(req.user.id, mod);
  return scope.includes(companyId) && await isDesignated(req.user.id, mod);
};

// Every company this caller may work in for the CURRENT module: the ones they
// belong to, plus the ones a designation named. Drives the module's company
// picker, so the picker can never offer something the API would refuse.
const moduleCompanies = async (req) => {
  const mod = req.moduleKey;
  const mine = (await getUserCompanies(req.user.id))
    .filter(c => c.is_active !== false)
    .map(c => ({ id: c.id, name: c.name }));

  if (!mod || !(await isDesignated(req.user.id, mod))) return mine;
  const scope = await designatedCompanies(req.user.id, mod);
  if (scope.length === 0) return mine;

  const missing = scope.filter(id => !mine.some(c => c.id === id));
  if (!missing.length) return mine;
  const { data } = await supabaseAdmin
    .from('companies').select('id, name').in('id', missing).eq('is_active', true);
  return [...mine, ...(data || [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
};

// Which company a LIST request reads. An unreachable ?company_id degrades to
// the caller's own company rather than 403-ing -- a stale company_id in a
// bookmark should degrade, not break, which is what /sales and /transfers do.
const readCompanyId = async (req) => {
  const asked = req.query?.company_id || null;
  const own   = req.user?.company_id || null;

  if (isCrossCompany(req) || await isSuperAdmin(req.user.id)) return asked || own || null;
  if (!asked) {
    if (own) return own;
    // No company of their own, but a designation may still name one.
    const scope = req.moduleKey ? await designatedCompanies(req.user.id, req.moduleKey) : [];
    return scope[0] || null;
  }
  return (await mayUseCompany(req, asked)) ? asked : own;
};

// Which company a WRITE lands in. Same rule as the read, deliberately: a picker
// that lets you READ a company you cannot WRITE to is a trap. Falling back to
// req.user.company_id unconditionally would be worse than refusing -- someone
// who picked company B would watch their invoice land silently in company A.
const writeCompanyId = async (req) => {
  const asked = req.body?.company_id || req.query?.company_id || null;
  const own   = req.user?.company_id || null;

  if (isCrossCompany(req) || await isSuperAdmin(req.user.id)) return asked || own || null;
  if (!asked || asked === own) {
    if (own) return own;
    const scope = req.moduleKey ? await designatedCompanies(req.user.id, req.moduleKey) : [];
    return scope[0] || null;
  }
  return (await mayUseCompany(req, asked)) ? asked : own;
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

// Set or clear a designation, with its company scope. Superadmin-only --
// callers enforce that.
//
// companyIds === null leaves the existing scope alone (a plain on/off toggle);
// an array REPLACES it, including [] which means "unscoped -- their own
// companies". Turning the designation off keeps the company rows, so flicking
// it back on does not silently lose the operator's choices.
const setDesignation = async (userId, module, enabled, byUserId, companyIds = null) => {
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

  if (Array.isArray(companyIds)) {
    const wanted = [...new Set(companyIds.filter(Boolean))];
    const { error: delErr } = await supabaseAdmin.from('module_designation_companies')
      .delete().eq('user_id', userId).eq('module', module);
    if (delErr) throw new Error(delErr.message);
    if (wanted.length) {
      const { error: insErr } = await supabaseAdmin.from('module_designation_companies')
        .insert(wanted.map(company_id => ({ user_id: userId, module, company_id, designated_by: byUserId })));
      if (insErr) throw new Error(insErr.message);
    }
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
  designatedCompanies,
  designationCovers,
  mayUseCompany,
  moduleCompanies,
  invalidateDesignation,
  setDesignation,
  readCompanyId,
  writeCompanyId,
  selfEmployee,
  hrReadScope,
};
