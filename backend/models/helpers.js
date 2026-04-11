import { supabaseAdmin } from "../config/database.js";

// ============================================================================
// Get User Role in Company
// ============================================================================
export const getUserRole = async (userId, companyId) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("user_company_roles")
      .select(
        `
        id,
        role_id,
        custom_roles (id, name, level),
        is_active
      `
      )
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      role_id: data.role_id,
      role_name: data.custom_roles.name,
      role_level: data.custom_roles.level,
    };
  } catch (err) {
    console.error("Error getting user role:", err);
    return null;
  }
};

// ============================================================================
// Check if User has Permission
// ============================================================================
export const hasPermission = async (userId, companyId, permissionName) => {
  try {
    const userRole = await getUserRole(userId, companyId);

    if (!userRole) {
      return false;
    }

    // SuperAdmin has all permissions
    if (userRole.role_level === "superadmin") {
      return true;
    }

    // Check if role has this permission
    const { data: permissions, error } = await supabaseAdmin
      .from("role_permissions")
      .select(
        `
        permissions (name)
      `
      )
      .eq("role_id", userRole.role_id);

    if (error) {
      return false;
    }

    return (permissions || []).some((p) => p.permissions.name === permissionName);
  } catch (err) {
    console.error("Error checking permission:", err);
    return false;
  }
};

// ============================================================================
// Get User Permissions
// ============================================================================
export const getUserPermissions = async (userId, companyId) => {
  try {
    const userRole = await getUserRole(userId, companyId);

    if (!userRole) {
      return [];
    }

    // SuperAdmin has all permissions - fetch all
    if (userRole.role_level === "superadmin") {
      const { data } = await supabaseAdmin.from("permissions").select("name");
      return (data || []).map((p) => p.name);
    }

    // Get permissions for this role
    const { data: permissions } = await supabaseAdmin
      .from("role_permissions")
      .select("permissions(name)")
      .eq("role_id", userRole.role_id);

    return (permissions || []).map((p) => p.permissions.name);
  } catch (err) {
    console.error("Error getting user permissions:", err);
    return [];
  }
};

// ============================================================================
// Check Role Hierarchy (Can assign lower or equal role)
// ============================================================================
export const canAssignRole = async (sourceUserId, sourceCompanyId, targetRoleLevel) => {
  try {
    const sourceRole = await getUserRole(sourceUserId, sourceCompanyId);

    if (!sourceRole) {
      return false;
    }

    // Role levels: superadmin (1) > company_admin (2) > manager (3) > operations (4)
    const roleHierarchy = {
      superadmin: 1,
      company_admin: 2,
      manager: 3,
      operations: 4,
    };

    const sourceLevel = roleHierarchy[sourceRole.role_level] || 999;
    const targetLevel = roleHierarchy[targetRoleLevel] || 999;

    // Can only assign roles at equal or lower level
    return sourceLevel <= targetLevel;
  } catch (err) {
    console.error("Error checking role hierarchy:", err);
    return false;
  }
};

// ============================================================================
// Get All Companies for User
// ============================================================================
export const getUserCompanies = async (userId) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("user_company_roles")
      .select(
        `
        company_id,
        companies (id, name, is_active)
      `
      )
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      return [];
    }

    return (data || []).map((row) => ({
      id: row.company_id,
      name: row.companies.name,
      is_active: row.companies.is_active,
    }));
  } catch (err) {
    console.error("Error getting user companies:", err);
    return [];
  }
};

// ============================================================================
// Create Custom Role
// ============================================================================
export const createRole = async (name, description, level, companyId, permissions = []) => {
  try {
    // Insert role
    const { data: role, error: roleError } = await supabaseAdmin
      .from("custom_roles")
      .insert({
        name,
        description,
        level,
        company_id: companyId,
      })
      .select()
      .single();

    if (roleError || !role) {
      throw new Error(roleError?.message || "Failed to create role");
    }

    // Add permissions to role
    if (permissions.length > 0) {
      const { data: perms } = await supabaseAdmin
        .from("permissions")
        .select("id")
        .in("name", permissions);

      if (perms && perms.length > 0) {
        await supabaseAdmin.from("role_permissions").insert(
          perms.map((p) => ({
            role_id: role.id,
            permission_id: p.id,
          }))
        );
      }
    }

    return role;
  } catch (err) {
    console.error("Error creating role:", err);
    throw err;
  }
};

// ============================================================================
// Assign User to Company
// ============================================================================
export const assignUserToCompany = async (userId, companyId, roleId, assignedBy) => {
  try {
    const { data, error } = await supabaseAdmin
      .from("user_company_roles")
      .insert({
        user_id: userId,
        company_id: companyId,
        role_id: roleId,
        assigned_by: assignedBy,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  } catch (err) {
    console.error("Error assigning user to company:", err);
    throw err;
  }
};

// ============================================================================
// Check if is SuperAdmin
// ============================================================================
export const isSuperAdmin = async (userId, companyId) => {
  const role = await getUserRole(userId, companyId);
  return role?.role_level === "superadmin";
};

// ============================================================================
// Get Team Members (for managers)
// ============================================================================
export const getTeamMembers = async (managerId, companyId) => {
  try {
    // Get manager's role level
    const managerRole = await getUserRole(managerId, companyId);

    if (!managerRole) {
      return [];
    }

    // For simplicity, managers see all users in their company
    // In production, you'd implement proper team hierarchies

    const { data, error } = await supabaseAdmin
      .from("user_company_roles")
      .select(
        `
        user_id,
        custom_roles (name, level),
        user_profiles (first_name, last_name, user_id)
      `
      )
      .eq("company_id", companyId)
      .eq("is_active", true);

    if (error) {
      return [];
    }

    return (data || []).map((row) => ({
      user_id: row.user_id,
      role: row.custom_roles.name,
      role_level: row.custom_roles.level,
      first_name: row.user_profiles?.first_name,
      last_name: row.user_profiles?.last_name,
    }));
  } catch (err) {
    console.error("Error getting team members:", err);
    return [];
  }
};
