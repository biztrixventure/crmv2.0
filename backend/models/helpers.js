const { supabaseAdmin } = require('../config/database');
const cache = require('../utils/cache');

// Per-user effective-permission cache TTL. Short, so a missed invalidation
// self-heals fast; write paths also invalidate explicitly for instant effect.
const PERM_TTL_MS = 30_000;

// Lower number = higher authority
const ROLE_HIERARCHY = {
  superadmin:          0,
  readonly_admin:      1,
  company_admin:       2,
  operations_manager:  3,
  fronter_manager:     4,
  closer_manager:      4,
  compliance_manager:  4,
  qa_manager:          4,   // QA dept lead -- same tier as compliance_manager
  accountant:          4,   // Accounting module lead -- see mig 290
  hr_manager:          4,   // HR module lead -- see mig 290
  closer:              5,
  qa_agent:            5,   // QA reviewer â€” same tier as closer
  employee:            6,   // HR-only self-service rung
  fronter:             6,
};

// ============================================================================
// Get User Role in Company
// ============================================================================
const getUserRole = async (userId, companyId) => {
  try {
    const { data } = await supabaseAdmin
      .from('user_company_roles')
      .select('role_id, custom_roles(id, name, level)')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .single();

    if (!data?.custom_roles) return null;
    return {
      role_id:    data.role_id,
      role_name:  data.custom_roles.name,
      role_level: data.custom_roles.level,
    };
  } catch {
    return null;
  }
};

// ============================================================================
// Check if User has Permission
// Single embedded query + parallel override check (was 2 sequential queries).
// Override table takes precedence over role permissions.
// ============================================================================
// Resolve a user's EFFECTIVE permission set for a company (role perms, with
// per-user grants added + revokes removed) and the role level. Cached for
// PERM_TTL_MS so hot paths (every mutation gate, polled list reads) don't re-hit
// the DB. Returns { level, perms: [names] } â€” arrays so it caches cleanly.
const getEffectivePerms = async (userId, companyId) => {
  if (!userId || !companyId) return { level: null, perms: [] };
  return cache.remember('perms', `${userId}|${companyId}`, PERM_TTL_MS, async () => {
    const [roleRes, overrideRes] = await Promise.all([
      supabaseAdmin
        .from('user_company_roles')
        .select('custom_roles(level, role_permissions(permissions(name)))')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('is_active', true)
        .single(),
      supabaseAdmin
        .from('user_permission_overrides')
        .select('override_type, permissions(name)')
        .eq('user_id', userId)
        .eq('company_id', companyId),
    ]);
    if (!roleRes.data?.custom_roles) return { level: null, perms: [] };
    const level = roleRes.data.custom_roles.level;
    const perms = new Set(
      (roleRes.data.custom_roles.role_permissions || []).map(rp => rp.permissions?.name).filter(Boolean)
    );
    (overrideRes.data || []).forEach(o => {
      const n = o.permissions?.name;
      if (!n) return;
      if (o.override_type === 'grant')  perms.add(n);
      else if (o.override_type === 'revoke') perms.delete(n);
    });
    return { level, perms: [...perms] };
  });
};

const hasPermission = async (userId, companyId, permissionName) => {
  try {
    const { level, perms } = await getEffectivePerms(userId, companyId);
    if (level === 'superadmin') return true;
    return perms.includes(permissionName);
  } catch {
    return false;
  }
};

// Invalidate the cached permissions for a user (call on any write that changes
// their role/overrides). Without a company, clears the whole namespace (safe).
const invalidateUserPerms = (userId, companyId) => {
  if (userId && companyId) cache.invalidate('perms', `${userId}|${companyId}`);
  else cache.invalidateNamespace('perms');
  // the superadmin answer comes from the same role rows, so it goes stale at
  // exactly the same moments â€” drop it here too rather than leaving a promotion
  // or demotion to wait out its own TTL
  if (userId) cache.invalidate('superadmin', String(userId));
  else cache.invalidateNamespace('superadmin');
};
// Clear ALL cached permissions â€” use when a ROLE's permissions change (affects
// every user holding that role).
const clearPermissionCache = () => { cache.invalidateNamespace('perms'); cache.invalidateNamespace('superadmin'); };

// ============================================================================
// Get All Permissions for User
// Returns array of permission name strings with override support applied.
// ============================================================================
const getUserPermissions = async (userId, companyId) => {
  try {
    const [roleRes, overrideRes] = await Promise.all([
      supabaseAdmin
        .from('user_company_roles')
        .select('custom_roles(level, role_permissions(permissions(name)))')
        .eq('user_id', userId)
        .eq('company_id', companyId)
        .eq('is_active', true)
        .single(),
      supabaseAdmin
        .from('user_permission_overrides')
        .select('override_type, permissions(name)')
        .eq('user_id', userId)
        .eq('company_id', companyId),
    ]);

    if (!roleRes.data?.custom_roles) return [];

    const level = roleRes.data.custom_roles.level;
    if (level === 'superadmin') {
      const { data } = await supabaseAdmin.from('permissions').select('name');
      return (data || []).map(p => p.name);
    }

    const perms = new Set(
      (roleRes.data.custom_roles.role_permissions || [])
        .map(rp => rp.permissions?.name)
        .filter(Boolean)
    );

    // Apply per-user overrides
    for (const o of (overrideRes.data || [])) {
      const name = o.permissions?.name;
      if (!name) continue;
      if (o.override_type === 'revoke') perms.delete(name);
      if (o.override_type === 'grant')  perms.add(name);
    }

    return [...perms];
  } catch {
    return [];
  }
};

// ============================================================================
// Check Role Hierarchy
// Strict: a user can only assign roles with LOWER authority (higher number).
// Same-level assignment is not allowed â€” prevents lateral escalation.
// ============================================================================
const canAssignRole = async (sourceUserId, sourceCompanyId, targetRoleLevel) => {
  try {
    const sourceRole = await getUserRole(sourceUserId, sourceCompanyId);
    if (!sourceRole) return false;

    const sourceLevel = ROLE_HIERARCHY[sourceRole.role_level] ?? 999;
    const targetLevel = typeof targetRoleLevel === 'number'
      ? targetRoleLevel
      : (ROLE_HIERARCHY[targetRoleLevel] ?? 999);

    // Strict less-than: can only assign roles with strictly lower authority
    return sourceLevel < targetLevel;
  } catch {
    return false;
  }
};

// ============================================================================
// Get All Companies for User
// ============================================================================
const getUserCompanies = async (userId) => {
  try {
    const { data } = await supabaseAdmin
      .from('user_company_roles')
      .select('company_id, companies(id, name, is_active)')
      .eq('user_id', userId)
      .eq('is_active', true);

    return (data || [])
      .filter(row => row.companies)
      .map(row => ({
        id:        row.company_id,
        name:      row.companies.name,
        is_active: row.companies.is_active,
      }));
  } catch {
    return [];
  }
};

// ============================================================================
// Create Custom Role
// ============================================================================
const createRole = async (name, description, level, companyId, permissions = []) => {
  const { data: role, error: roleError } = await supabaseAdmin
    .from('custom_roles')
    .insert({ name, description, level, company_id: companyId })
    .select()
    .single();

  if (roleError || !role) throw new Error(roleError?.message || 'Failed to create role');

  if (permissions.length > 0) {
    const { data: perms } = await supabaseAdmin
      .from('permissions')
      .select('id')
      .in('name', permissions);

    if (perms?.length > 0) {
      await supabaseAdmin.from('role_permissions').insert(
        perms.map(p => ({ role_id: role.id, permission_id: p.id }))
      );
    }
  }

  return role;
};

// ============================================================================
// Assign User to Company
// ============================================================================
const assignUserToCompany = async (userId, companyId, roleId, assignedBy) => {
  const { data, error } = await supabaseAdmin
    .from('user_company_roles')
    .insert({ user_id: userId, company_id: companyId, role_id: roleId, assigned_by: assignedBy, is_active: true })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
};

// ============================================================================
// Check if user is SuperAdmin
// Fast path: check role level in user_company_roles. If none found (system
// superadmin with no company assignment), fall back to email match.
// ============================================================================
// CACHED, because this is the single most-called query in the app.
//
// It depends only on the user, yet almost every guarded route asks it three or
// four times over: `can()` asks, then `isManager()` asks again, then
// `allowedCompanyIds()` asks a third time and calls `isManager()` which asks a
// fourth. Uncached, each of those was a real round-trip â€” measured at ~445ms
// against this database, so ~1.3-2.2s of every QA request was spent
// re-answering one question. hasPermission was already cached this way; this
// was the hole beside it.
//
// Same 30s TTL and the same invalidation hook as the permission cache, so a
// role change takes effect just as quickly as it already did.
const SUPERADMIN_TTL_MS = 30_000;
const isSuperAdmin = async (userId) => {
  if (!userId) return false;
  return cache.remember('superadmin', String(userId), SUPERADMIN_TTL_MS, async () => {
    try {
      const { data } = await supabaseAdmin
        .from('user_company_roles')
        .select('custom_roles(level)')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (data?.some(r => r.custom_roles?.level === 'superadmin')) return true;

      // System superadmin has no company assignment â€” check by email against env
      const emails = (process.env.SUPERADMIN_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean);
      if (emails.length > 0) {
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
        return emails.includes(authUser?.user?.email || '');
      }
      return false;
    } catch {
      return false;
    }
  });
};

// ============================================================================
// Get Team Members (for managers)
// ============================================================================
const getTeamMembers = async (managerId, companyId) => {
  try {
    const { data } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id, custom_roles(name, level), user_profiles(first_name, last_name, user_id)')
      .eq('company_id', companyId)
      .eq('is_active', true);

    return (data || [])
      .filter(row => row.custom_roles)
      .map(row => ({
        user_id:    row.user_id,
        role:       row.custom_roles.name,
        role_level: row.custom_roles.level,
        first_name: row.user_profiles?.first_name,
        last_name:  row.user_profiles?.last_name,
      }));
  } catch {
    return [];
  }
};

// Single source of truth for which role levels are valid per company type.
// QA roles (qa_manager / qa_agent) are assignable under BOTH company types:
// TRA reviews FRONTER transfers, RCM optionally reviews CLOSER calls, and one QA
// org may cover a fronter company AND a closer company. Since role is granted
// per-company (one user_company_roles row each), the qa levels must be valid on
// whichever company the QA user is being attached to â€” so both lists include them.
const getCompanyTypeLevels = (companyType) =>
  companyType === 'fronter'
    ? ['fronter', 'fronter_manager', 'operations_manager', 'company_admin', 'qa_manager', 'qa_agent']
    : ['closer', 'closer_manager', 'compliance_manager', 'operations_manager', 'company_admin', 'qa_manager', 'qa_agent'];

// ============================================================================
// Company type, cached. Every list route used to re-query companies.company_type
// inline; the value never changes in practice, so one cached resolver serves
// them all.
// ============================================================================
const COMPANY_TYPE_TTL_MS = 60_000;
const getCompanyType = async (companyId) => {
  if (!companyId) return null;
  return cache.remember('companyType', companyId, COMPANY_TYPE_TTL_MS, async () => {
    const { data } = await supabaseAdmin
      .from('companies').select('company_type').eq('id', companyId).maybeSingle();
    return data?.company_type || null;
  });
};

// Display names for a set of users, but ONLY for those who still hold an ACTIVE
// company role.
//
// A profile with no active role cannot be the person who worked a lead â€” it is
// a departed account, a duplicate, or a placeholder like "Abandoned (â€¦)". Their
// name still reaches the UI through stale attribution: a disposition recorded
// against a mis-mapped dialer id keeps pointing at them forever. Rendering that
// name reads as a LIVE attribution, and it has now been reported as a bug three
// times (an absent closer appearing to have just worked a call).
//
// Returning nothing for such a user is the honest answer â€” the disposition is
// still shown, just without claiming who set it.
const activeUserNames = async (userIds) => {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const [{ data: profs }, { data: roles }] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', ids),
    supabaseAdmin.from('user_company_roles').select('user_id').in('user_id', ids).eq('is_active', true),
  ]);
  const active = new Set((roles || []).map(r => r.user_id));
  const out = {};
  for (const p of (profs || [])) {
    if (!active.has(p.user_id)) continue;            // ghost / departed â†’ no name
    const n = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    if (n) out[p.user_id] = n;
  }
  return out;
};

// â”€â”€ Implicit company linking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The `company_links` table modelled an explicit fronterâ†”closer pairing, but in
// practice every fronter company feeds every closer company â€” the link rows were
// never kept up to date, and the gaps caused real data loss rather than real
// isolation: with 5 active fronter companies but only 3 link rows, leads from
// the two unlinked fronters silently vanished from the closer's "attach a dialer
// disposition" picker and from QA's reviewable-people list, so dispositions
// stranded and closer-leg reviews could not be targeted at all.
//
// Linking is therefore IMPLICIT now: every active company is linked to every
// active company of the opposite type. These helpers are the one place that rule
// lives. The `company_links` table is intentionally left in place (no data is
// destroyed) â€” it is simply no longer consulted for scoping. Note this widens
// nothing security-wise: the closer-side surfaces that use it already read the
// shared cross-fronter lead pool (see GET /transfers/search-by-phone).
const getActiveCompanyIdsByType = async (type) => {
  const { data } = await supabaseAdmin
    .from('companies').select('id').eq('company_type', type).eq('is_active', true);
  return (data || []).map(c => c.id);
};

// Every active company on the OPPOSITE side of the pipeline from the given
// company (or companies). Replaces the old company_links lookups.
const getCounterpartCompanyIds = async (companyIds) => {
  const ids = (Array.isArray(companyIds) ? companyIds : [companyIds]).filter(Boolean);
  if (!ids.length) return [];
  const { data } = await supabaseAdmin
    .from('companies').select('id, company_type').in('id', ids);
  const types = new Set((data || []).map(c => c.company_type).filter(Boolean));
  const wanted = new Set();
  if (types.has('fronter')) (await getActiveCompanyIdsByType('closer')).forEach(id => wanted.add(id));
  if (types.has('closer'))  (await getActiveCompanyIdsByType('fronter')).forEach(id => wanted.add(id));
  // Never return the caller's own companies as their own counterpart.
  ids.forEach(id => wanted.delete(id));
  return [...wanted];
};

// Which side of the fronterâ†’closer pipeline does this caller read from?
//
// Transfers and sales are STORED under the fronter company's company_id, so
// closer-side users can't be scoped by company_id at all â€” they are scoped by
// assigned_closer_id / closer_id across their company's members.
//
// closer / closer_manager / compliance_manager are closer-side by ROLE. But
// company_admin exists at BOTH company types, and treating it as fronter-side
// everywhere is what made a closer company's admin read 0 sales while the
// closer_manager beneath them read 6,478. For that one role the side depends on
// the COMPANY TYPE.
//
// Deliberately `=== 'closer'`, not `!== 'fronter'`: if the company row is
// missing or the lookup fails we fall back to fronter-side company_id scoping,
// which is the narrower, already-correct behaviour. No other role's answer
// changes â€” manager / closer_manager / fronter_manager / operations_manager all
// resolve exactly as before.
const isCloserSideScope = async (role, companyId) => {
  if (role === 'closer' || role === 'closer_manager' || role === 'compliance_manager') return true;
  if (role === 'company_admin' && companyId) return (await getCompanyType(companyId)) === 'closer';
  return false;
};

// Is this user an ACTIVE member of this company? Used to stop a non-superadmin
// from scoping a list to a company they don't belong to (cross-tenant leak).
const isCompanyMember = async (userId, companyId) => {
  if (!userId || !companyId) return false;
  const { data } = await supabaseAdmin
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return !!data;
};

// Resolve the company a LIST request should be scoped to.
//
// GET /sales and GET /transfers already had this rule inline: a non-admin who
// passes a ?company_id= they are not an active member of silently falls back to
// their own company rather than 403-ing (a stale company_id in a bookmarked URL
// should degrade, not break). Lifted here so the endpoints that took the param
// with NO check at all can adopt it in one line. Superadmin / readonly_admin
// keep their existing cross-company bypass.
const resolveScopedCompanyId = async (req) => {
  const asked = req.query?.company_id;
  const own   = req.user?.company_id || null;
  if (!asked) return own;
  if (['superadmin', 'readonly_admin'].includes(req.user?.role)) return asked;
  if (asked === own) return asked;
  return (await isCompanyMember(req.user?.id, asked)) ? asked : own;
};

module.exports = {
  getUserRole,
  hasPermission,
  getEffectivePerms,
  invalidateUserPerms,
  clearPermissionCache,
  getUserPermissions,
  canAssignRole,
  getUserCompanies,
  isCompanyMember,
  getCompanyType,
  getActiveCompanyIdsByType,
  getCounterpartCompanyIds,
  activeUserNames,
  isCloserSideScope,
  resolveScopedCompanyId,
  createRole,
  assignUserToCompany,
  isSuperAdmin,
  getTeamMembers,
  getCompanyTypeLevels,
  ROLE_HIERARCHY,
};
