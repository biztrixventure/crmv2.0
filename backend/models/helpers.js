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
  closer:              5,
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
// the DB. Returns { level, perms: [names] } — arrays so it caches cleanly.
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
};
// Clear ALL cached permissions — use when a ROLE's permissions change (affects
// every user holding that role).
const clearPermissionCache = () => cache.invalidateNamespace('perms');

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
// Same-level assignment is not allowed — prevents lateral escalation.
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
const isSuperAdmin = async (userId) => {
  try {
    const { data } = await supabaseAdmin
      .from('user_company_roles')
      .select('custom_roles(level)')
      .eq('user_id', userId)
      .eq('is_active', true);

    if (data?.some(r => r.custom_roles?.level === 'superadmin')) return true;

    // System superadmin has no company assignment — check by email against env
    const emails = (process.env.SUPERADMIN_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean);
    if (emails.length > 0) {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      return emails.includes(authUser?.user?.email || '');
    }
    return false;
  } catch {
    return false;
  }
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
const getCompanyTypeLevels = (companyType) =>
  companyType === 'fronter'
    ? ['fronter', 'fronter_manager', 'operations_manager', 'company_admin']
    : ['closer', 'closer_manager', 'compliance_manager', 'operations_manager', 'company_admin'];

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
  createRole,
  assignUserToCompany,
  isSuperAdmin,
  getTeamMembers,
  getCompanyTypeLevels,
  ROLE_HIERARCHY,
};
