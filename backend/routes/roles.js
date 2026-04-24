const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
// Auth middleware is applied in server.js
const { hasPermission, canAssignRole, createRole, isSuperAdmin, getCompanyTypeLevels } = require('../models/helpers');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================================================
// GET /roles - List available roles in company
// ============================================================================
router.get(
  "/",
  asyncHandler(async (req, res) => {
    logger.debug('GET_ROLES', 'GET /roles request', req.query);
    const { company_id } = req.query;
    const userId = req.user.id;
    let companyId = company_id;

    // If company_id not provided, fetch from user's company assignment
    if (!companyId) {
      try {
        logger.debug('GET_ROLES', 'Fetching user company assignment', { userId });
        const { data: userCompany } = await supabaseAdmin
          .from("user_company_roles")
          .select("company_id")
          .eq("user_id", userId)
          .eq("is_active", true)
          .limit(1)
          .single();

        if (userCompany) {
          companyId = userCompany.company_id;
          logger.success('GET_ROLES', 'Resolved company_id from user assignment', { companyId });
        } else {
          logger.warn('GET_ROLES', 'No company assignment found for user', { userId });
        }
      } catch (err) {
        // User might be super admin with no company assignment, which is ok
        // We'll return all roles in that case
        logger.debug('GET_ROLES', 'Could not fetch user company (expected for superadmin)', { error: err.message });
      }
    }

    try {
      logger.debug('GET_ROLES', 'Querying custom_roles', { companyId });
      let query = supabaseAdmin
        .from("custom_roles")
        .select(
          `
          id,
          name,
          description,
          level,
          company_id,
          role_permissions (permissions(name))
        `
        );

      // Scope: company_id provided → only that company's roles
      //        no company_id (superadmin) → only system-level roles (company_id IS NULL)
      if (companyId) {
        query = query.eq('company_id', companyId);
        logger.debug('GET_ROLES', 'Added company filter', { companyId });
      } else {
        query = query.is('company_id', null);
        logger.debug('GET_ROLES', 'Superadmin: returning system-level roles only');
      }

      const { data, error } = await query;

      if (error) {
        logger.error('GET_ROLES', 'Query failed', error);
        return res.status(400).json({ error: error.message });
      }

      logger.success('GET_ROLES', `Fetched ${data?.length || 0} roles`, { count: data?.length || 0 });

      res.json({
        total: data.length,
        roles: (data || []).map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          level: r.level,
          permissions: (r.role_permissions || []).map((rp) => rp.permissions?.name).filter(Boolean),
        })),
      });
    } catch (err) {
      logger.error('GET_ROLES', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /permissions - Get all available permissions (MUST be before /:id route)
// ============================================================================
router.get(
  "/permissions",
  asyncHandler(async (req, res) => {
    logger.debug('GET_PERMISSIONS', 'GET /permissions request');
    try {
      logger.debug('GET_PERMISSIONS', 'Querying permissions table');
      const { data, error } = await supabaseAdmin
        .from("permissions")
        .select("id, name, description, category")
        .order("category")
        .order("name");

      if (error) {
        logger.error('GET_PERMISSIONS', 'Query failed', error);
        return res.status(400).json({ error: error.message });
      }

      logger.success('GET_PERMISSIONS', `Fetched ${data?.length || 0} permissions`, { count: data?.length || 0 });

      // Group by category
      const grouped = (data || []).reduce((acc, perm) => {
        if (!acc[perm.category]) {
          acc[perm.category] = [];
        }
        acc[perm.category].push({
          id: perm.id,
          name: perm.name,
          description: perm.description,
        });
        return acc;
      }, {});

      logger.success('GET_PERMISSIONS', `Grouped ${Object.keys(grouped).length} categories`);
      res.json(grouped);
    } catch (err) {
      logger.error('GET_PERMISSIONS', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /roles/:id - Get role details
// ============================================================================
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    logger.debug('GET_ROLE_BY_ID', 'GET /roles/:id request', { id: req.params.id });
    const { id } = req.params;

    try {
      logger.debug('GET_ROLE_BY_ID', 'Querying custom_roles', { id });
      const { data, error } = await supabaseAdmin
        .from("custom_roles")
        .select(
          `
          id,
          name,
          description,
          level,
          company_id,
          role_permissions (permissions(id, name, description, category))
        `
        )
        .eq("id", id)
        .single();

      if (error || !data) {
        logger.error('GET_ROLE_BY_ID', 'Role not found', error || new Error('No data returned'));
        return res.status(404).json({ error: "Role not found" });
      }

      logger.success('GET_ROLE_BY_ID', `Found role`, { id, name: data.name, level: data.level });

      res.json({
        id: data.id,
        name: data.name,
        description: data.description,
        level: data.level,
        company_id: data.company_id,
        permissions: (data.role_permissions || []).map((rp) => rp.permissions),
      });
    } catch (err) {
      logger.error('GET_ROLE_BY_ID', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// POST /roles - Create new role
// ============================================================================
router.post(
  "/",
  [
    body("name").trim().isLength({ min: 1 }),
    body("description").trim().optional(),
    body("level").isIn(["superadmin", "readonly_admin", "company_admin", "closer", "fronter", "fronter_manager", "operations_manager", "closer_manager", "compliance_manager"]),
    body("company_id").isUUID().optional(),
    body("permissions").isArray().optional(),
  ],
  asyncHandler(async (req, res) => {
    logger.debug('CREATE_ROLE', 'POST /roles request', req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('CREATE_ROLE', 'Validation failed', new Error(JSON.stringify(errors.array())));
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { name, description, level, company_id, permissions } = req.body;
    const userId = req.user.id;
    let targetCompanyId = company_id;

    logger.info('CREATE_ROLE', `Creating role`, { name, level, userId });

    // If company_id not provided, fetch from user's company assignment
    if (!targetCompanyId) {
      try {
        logger.debug('CREATE_ROLE', 'Fetching user company assignment', { userId });
        const { data: userCompany } = await supabaseAdmin
          .from("user_company_roles")
          .select("company_id")
          .eq("user_id", userId)
          .eq("is_active", true)
          .limit(1)
          .single();

        if (userCompany) {
          targetCompanyId = userCompany.company_id;
          logger.success('CREATE_ROLE', 'Resolved company_id from user assignment', { targetCompanyId });
        }
      } catch (err) {
        logger.error('CREATE_ROLE', 'Error fetching user company', err);
      }
    }

    // SuperAdmin can create system-level (company_id = null) roles without a company assignment
    if (!targetCompanyId && req.user.role !== 'superadmin') {
      logger.error('CREATE_ROLE', 'No company_id could be determined', new Error('Missing company context'));
      return res.status(400).json({ error: "Company ID is required or user must have a company assignment" });
    }

    try {
      // Check permission to manage roles
      logger.debug('CREATE_ROLE', 'Checking manage_roles permission', { userId, targetCompanyId });
      const hasPerm = await hasPermission(userId, targetCompanyId, "manage_roles");
      logger.success('CREATE_ROLE', `Permission check: ${hasPerm}`, { userRole: req.user.role });

      if (!hasPerm && req.user.role !== 'superadmin') {
        logger.error('CREATE_ROLE', 'Permission denied', new Error('User lacks manage_roles permission'));
        return res.status(403).json({ error: "You don't have permission to create roles" });
      }

      // Check role hierarchy
      logger.debug('CREATE_ROLE', 'Checking role hierarchy', { userId, targetCompanyId, level });
      const canCreate = await canAssignRole(userId, targetCompanyId, level);
      logger.success('CREATE_ROLE', `Hierarchy check: ${canCreate}`);

      if (!canCreate && req.user.role !== 'superadmin') {
        logger.error('CREATE_ROLE', 'Cannot create role - hierarchy violation', new Error('Role level too high'));
        return res.status(403).json({
          error: "Cannot create role with same or higher authority",
        });
      }

      // Enforce company-type / role-level alignment
      if (targetCompanyId) {
        const { data: co } = await supabaseAdmin
          .from('companies').select('company_type').eq('id', targetCompanyId).single();
        if (co?.company_type) {
          const allowed = getCompanyTypeLevels(co.company_type);
          if (!allowed.includes(level)) {
            return res.status(400).json({
              error: `Role level "${level}" is not valid for a ${co.company_type} company. Allowed levels: ${allowed.join(', ')}`,
            });
          }
        }
      }

      // Create role
      logger.debug('CREATE_ROLE', 'Creating role in database', { name, level, targetCompanyId });
      const role = await createRole(name, description || null, level, targetCompanyId, permissions || []);

      logger.success('CREATE_ROLE', `Role created successfully`, { role_id: role.id, name, level });

      res.status(201).json({
        message: "Role created successfully",
        role: {
          id: role.id,
          name: role.name,
          description: role.description,
          level: role.level,
          permissions: permissions || [],
        },
      });
    } catch (err) {
      if (err.message.includes("duplicate")) {
        logger.error('CREATE_ROLE', 'Duplicate role name', err);
        return res.status(400).json({ error: "Role name already exists" });
      }
      logger.error('CREATE_ROLE', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// PUT /roles/:id - Update role and permissions
// ============================================================================
router.put(
  "/:id",
  [
    body("description").trim().optional(),
    body("permissions").isArray().optional(),
  ],
  asyncHandler(async (req, res) => {
    logger.debug('UPDATE_ROLE', 'PUT /roles/:id request', { id: req.params.id, body: req.body });
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('UPDATE_ROLE', 'Validation failed', new Error(JSON.stringify(errors.array())));
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id } = req.params;
    const { description, permissions } = req.body;
    const userId = req.user.id;

    logger.info('UPDATE_ROLE', `Updating role`, { id, userId });

    try {
      // Get role
      logger.debug('UPDATE_ROLE', 'Fetching role', { id });
      const { data: role } = await supabaseAdmin
        .from("custom_roles")
        .select("company_id, level")
        .eq("id", id)
        .single();

      if (!role) {
        logger.error('UPDATE_ROLE', 'Role not found', new Error('No role data'));
        return res.status(404).json({ error: "Role not found" });
      }

      logger.success('UPDATE_ROLE', `Found role`, { id, level: role.level });

      // For SuperAdmin roles (company_id = null), get user's company context
      let targetCompanyId = role.company_id;
      if (!targetCompanyId) {
        try {
          logger.debug('UPDATE_ROLE', 'Fetching user company for superadmin role context', { userId });
          const { data: userCompany } = await supabaseAdmin
            .from("user_company_roles")
            .select("company_id")
            .eq("user_id", userId)
            .eq("is_active", true)
            .limit(1)
            .single();

          if (userCompany) {
            targetCompanyId = userCompany.company_id;
            logger.success('UPDATE_ROLE', 'Resolved company context from user', { targetCompanyId });
          }
        } catch (err) {
          logger.error('UPDATE_ROLE', 'Error fetching user company for SuperAdmin role update', err);
        }
      }

      // Check permission
      logger.debug('UPDATE_ROLE', 'Checking manage_roles permission', { userId, targetCompanyId });
      const hasPerm = await hasPermission(userId, targetCompanyId, "manage_roles");
      logger.success('UPDATE_ROLE', `Permission check: ${hasPerm}`);

      if (!hasPerm && req.user.role !== 'superadmin') {
        logger.error('UPDATE_ROLE', 'Permission denied', new Error('User lacks manage_roles permission'));
        return res.status(403).json({ error: "You don't have permission to update roles" });
      }

      // Update description if provided
      if (description !== undefined) {
        logger.debug('UPDATE_ROLE', 'Updating role description', { id });
        await supabaseAdmin
          .from("custom_roles")
          .update({ description })
          .eq("id", id);
        logger.success('UPDATE_ROLE', 'Role description updated');
      }

      // Update permissions if provided
      if (permissions && Array.isArray(permissions)) {
        logger.debug('UPDATE_ROLE', 'Updating permissions', { id, permissionCount: permissions.length });

        // Get all permission IDs
        const { data: allPerms } = await supabaseAdmin
          .from("permissions")
          .select("id")
          .in("name", permissions);

        logger.success('UPDATE_ROLE', `Found ${allPerms?.length || 0} matching permissions`);

        // Delete old permissions
        logger.debug('UPDATE_ROLE', 'Deleting old permissions', { id });
        await supabaseAdmin.from("role_permissions").delete().eq("role_id", id);

        // Insert new permissions
        if (allPerms && allPerms.length > 0) {
          logger.debug('UPDATE_ROLE', 'Inserting new permissions', { id, count: allPerms.length });
          await supabaseAdmin.from("role_permissions").insert(
            allPerms.map((p) => ({
              role_id: id,
              permission_id: p.id,
            }))
          );
          logger.success('UPDATE_ROLE', `Inserted ${allPerms.length} permissions`);
        }
      }

      logger.success('UPDATE_ROLE', 'Role updated successfully', { id });
      res.json({ message: "Role updated successfully" });
    } catch (err) {
      logger.error('UPDATE_ROLE', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// DELETE /roles/:id - Delete role
// ============================================================================
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    logger.debug('DELETE_ROLE', 'DELETE /roles/:id request', { id: req.params.id });
    const { id } = req.params;
    const userId = req.user.id;

    logger.info('DELETE_ROLE', `Deleting role`, { id, requestedBy: userId });

    try {
      // Get role
      logger.debug('DELETE_ROLE', 'Fetching role', { id });
      const { data: role } = await supabaseAdmin
        .from("custom_roles")
        .select("company_id")
        .eq("id", id)
        .single();

      if (!role) {
        logger.error('DELETE_ROLE', 'Role not found', new Error('No role data'));
        return res.status(404).json({ error: "Role not found" });
      }

      logger.success('DELETE_ROLE', `Found role`, { id });

      // For SuperAdmin roles (company_id = null), get user's company context
      let targetCompanyId = role.company_id;
      if (!targetCompanyId) {
        try {
          logger.debug('DELETE_ROLE', 'Fetching user company for superadmin role context', { userId });
          const { data: userCompany } = await supabaseAdmin
            .from("user_company_roles")
            .select("company_id")
            .eq("user_id", userId)
            .eq("is_active", true)
            .limit(1)
            .single();

          if (userCompany) {
            targetCompanyId = userCompany.company_id;
            logger.success('DELETE_ROLE', 'Resolved company context from user', { targetCompanyId });
          }
        } catch (err) {
          logger.error('DELETE_ROLE', 'Error fetching user company for SuperAdmin role deletion', err);
        }
      }

      // Check permission
      logger.debug('DELETE_ROLE', 'Checking manage_roles permission', { userId, targetCompanyId });
      const hasPerm = await hasPermission(userId, targetCompanyId, "manage_roles");
      logger.success('DELETE_ROLE', `Permission check: ${hasPerm}`);

      if (!hasPerm && req.user.role !== 'superadmin') {
        logger.error('DELETE_ROLE', 'Permission denied', new Error('User lacks manage_roles permission'));
        return res.status(403).json({ error: "You don't have permission to delete roles" });
      }

      // Check if role is in use
      logger.debug('DELETE_ROLE', 'Checking if role is assigned to users', { id });
      const { data: users } = await supabaseAdmin
        .from("user_company_roles")
        .select("id")
        .eq("role_id", id);

      logger.success('DELETE_ROLE', `Found ${users?.length || 0} users with this role`);

      if (users && users.length > 0) {
        logger.error('DELETE_ROLE', 'Cannot delete - role is assigned to users', new Error(`Role assigned to ${users.length} users`));
        return res.status(400).json({
          error: "Cannot delete role - it's assigned to users",
        });
      }

      // Delete role
      logger.debug('DELETE_ROLE', 'Deleting role from database', { id });
      await supabaseAdmin.from("custom_roles").delete().eq("id", id);

      logger.success('DELETE_ROLE', 'Role deleted successfully', { id });
      res.json({ message: "Role deleted successfully" });
    } catch (err) {
      logger.error('DELETE_ROLE', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// POST /roles/seed-defaults?company_id=... — Create BLP default roles
// Seeds roles based on company_type: 'fronter' or 'closer'.
// Fronter companies get: Fronter, Fronter Manager, Operations Manager, Company Admin
// Closer companies get:  Closer, Closer Manager, Compliance Manager, Operations Manager, Company Admin
// Skips any role whose name already exists for the company.
// SuperAdmin only.
// ============================================================================
const COMPANY_ADMIN_ROLE = {
  name: 'Company Admin',
  description: 'Full company access — manages users, roles, forms and all data',
  level: 'company_admin',
  permissions: [
    'create_user', 'edit_user', 'delete_user', 'manage_roles', 'manage_forms',
    'view_company_members',
    'create_transfer', 'view_own_transfers', 'view_team_transfers', 'view_all_company_transfers',
    'assign_transfer', 'reassign_transfer', 'edit_transfer_reason', 'delete_transfer',
    'reject_transfer',
    'create_sale', 'view_own_sales', 'view_team_sales', 'view_all_company_sales',
    'update_sale', 'delete_sale', 'submit_for_review',
    'view_financial_data', 'search_sales', 'manage_compliance',
    'manage_callbacks', 'view_callbacks', 'view_team_callbacks',
    'manage_callback_numbers', 'view_team_callback_numbers',
    'submit_call_review', 'submit_call_dispo',
    'view_call_reviews', 'view_all_call_reviews',
    'view_fronter_stats', 'view_closer_stats', 'view_company_reports', 'view_reports',
    'view_notifications',
  ],
};

const OPS_MANAGER_ROLE = {
  name: 'Operations Manager',
  description: 'Full oversight — analytics, reports, leaderboards, user management',
  level: 'operations_manager',
  permissions: [
    'view_own_transfers', 'view_team_transfers', 'view_all_company_transfers',
    'assign_transfer', 'reassign_transfer', 'edit_transfer_reason',
    'view_team_sales', 'view_all_company_sales', 'view_financial_data', 'search_sales',
    'view_callbacks', 'view_team_callbacks', 'manage_callback_numbers', 'view_team_callback_numbers',
    'submit_call_review', 'submit_call_dispo',
    'view_call_reviews', 'view_all_call_reviews',
    'view_fronter_stats', 'view_closer_stats', 'view_company_reports', 'view_reports',
    'view_company_members', 'create_user', 'edit_user', 'delete_user',
    'manage_roles', 'manage_forms',
    'view_notifications',
  ],
};

// ─── Canonical permission sets ───────────────────────────────────────────────
// These are the single source of truth for default role permissions.
// Used by both seed-defaults and seed-defaults?reset=true.
// Hierarchy: company_admin ⊇ operations_manager ⊇ fronter_manager ⊇ fronter
//            company_admin ⊇ operations_manager ⊇ closer_manager  ⊇ closer
//                                                ⊇ compliance_manager

// Fronter company: lead generation side — no sales creation, no compliance
const FRONTER_DEFAULTS = [
  {
    name: 'Fronter',
    description: 'Creates transfers/leads, manages own pipeline and callbacks',
    level: 'fronter',
    permissions: [
      // Transfers
      'create_transfer', 'view_own_transfers',
      // Callbacks
      'manage_callbacks', 'view_callbacks', 'manage_callback_numbers',
      // Notifications
      'view_notifications',
    ],
  },
  {
    name: 'Fronter Manager',
    description: 'Manages fronter team — routes transfers, tracks pipeline and call reviews',
    level: 'fronter_manager',
    permissions: [
      // Transfers — full team visibility + routing
      'create_transfer', 'view_own_transfers', 'view_team_transfers', 'view_all_company_transfers',
      'assign_transfer', 'reassign_transfer', 'edit_transfer_reason',
      // Callbacks
      'manage_callbacks', 'view_callbacks', 'view_team_callbacks', 'manage_callback_numbers',
      // Sales visibility (read-only — see where leads went)
      'view_team_sales', 'search_sales',
      // Reviews
      'view_call_reviews', 'view_all_call_reviews',
      // Reports
      'view_fronter_stats', 'view_company_reports',
      // Team management
      'view_company_members', 'create_user', 'edit_user',
      // Notifications
      'view_notifications',
    ],
  },
  OPS_MANAGER_ROLE,
  COMPANY_ADMIN_ROLE,
];

// Closer company: sales conversion side — receives transfers, closes deals, compliance review
const CLOSER_DEFAULTS = [
  {
    name: 'Closer',
    description: 'Receives transfers, converts to sales, schedules callbacks',
    level: 'closer',
    permissions: [
      // Transfers
      'view_own_transfers', 'reject_transfer',
      // Sales — own pipeline
      'create_sale', 'view_own_sales', 'update_sale', 'submit_for_review',
      'view_financial_data',
      // Callbacks
      'manage_callbacks', 'view_callbacks',
      // Reviews
      'submit_call_review', 'submit_call_dispo',
      // Notifications
      'view_notifications',
    ],
  },
  {
    name: 'Closer Manager',
    description: 'Manages closer team — tracks all sales, callbacks and assigned transfers',
    level: 'closer_manager',
    permissions: [
      // Transfers — full team visibility + routing
      'view_own_transfers', 'reject_transfer',
      'view_team_transfers', 'view_all_company_transfers',
      'assign_transfer', 'reassign_transfer', 'edit_transfer_reason',
      // Sales — full team visibility
      'create_sale', 'view_own_sales', 'update_sale', 'submit_for_review',
      'view_team_sales', 'view_financial_data', 'search_sales',
      // Callbacks
      'manage_callbacks', 'view_callbacks', 'view_team_callbacks',
      // Reviews
      'submit_call_review', 'submit_call_dispo',
      'view_call_reviews', 'view_all_call_reviews',
      // Reports
      'view_closer_stats', 'view_company_reports',
      // Team management
      'view_company_members', 'create_user', 'edit_user',
      // Notifications
      'view_notifications',
    ],
  },
  {
    name: 'Compliance Manager',
    description: 'Reviews submitted sales — can approve, return, or modify back to closers',
    level: 'compliance_manager',
    permissions: [
      // Compliance actions
      'manage_compliance',
      // Sales visibility (read + review)
      'view_team_sales', 'view_all_company_sales', 'view_financial_data', 'search_sales',
      // Team visibility
      'view_company_members',
      // Reviews
      'view_all_call_reviews',
      // Notifications
      'view_notifications',
    ],
  },
  OPS_MANAGER_ROLE,
  COMPANY_ADMIN_ROLE,
];

router.post('/seed-defaults', asyncHandler(async (req, res) => {
  const userId    = req.user.id;
  const companyId = req.query.company_id || req.body.company_id || req.user.company_id;
  // reset=true → wipe & re-apply permissions on EXISTING roles (keeps user assignments)
  const reset     = req.query.reset === 'true' || req.body.reset === true;

  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const superadmin = await isSuperAdmin(userId);
  if (!superadmin) return res.status(403).json({ error: 'SuperAdmin only' });

  const { data: company, error: companyErr } = await supabaseAdmin
    .from('companies').select('company_type').eq('id', companyId).single();
  if (companyErr || !company) return res.status(404).json({ error: 'Company not found' });

  const defaults = company.company_type === 'closer' ? CLOSER_DEFAULTS : FRONTER_DEFAULTS;
  logger.info('SEED_ROLES', `Seeding ${company.company_type} defaults (reset=${reset})`, { companyId });

  const { data: allPerms } = await supabaseAdmin.from('permissions').select('id, name');
  const permMap = Object.fromEntries((allPerms || []).map(p => [p.name, p.id]));

  const { data: existing } = await supabaseAdmin
    .from('custom_roles').select('id, name').eq('company_id', companyId);
  const existingMap = Object.fromEntries((existing || []).map(r => [r.name, r.id]));

  const created = [];
  const updated = [];
  const skipped = [];

  for (const tpl of defaults) {
    const permIds = tpl.permissions.map(p => permMap[p]).filter(Boolean);

    if (existingMap[tpl.name]) {
      // Role already exists
      if (reset) {
        // Re-apply the canonical permission set
        const roleId = existingMap[tpl.name];
        await supabaseAdmin.from('role_permissions').delete().eq('role_id', roleId);
        if (permIds.length > 0) {
          await supabaseAdmin.from('role_permissions').insert(
            permIds.map(pid => ({ role_id: roleId, permission_id: pid }))
          );
        }
        updated.push(tpl.name);
      } else {
        skipped.push(tpl.name);
      }
      continue;
    }

    // Create new role
    const { data: role, error: roleErr } = await supabaseAdmin
      .from('custom_roles')
      .insert({ name: tpl.name, description: tpl.description, level: tpl.level, company_id: companyId })
      .select().single();

    if (roleErr) { logger.warn('SEED_ROLES', `Failed to create ${tpl.name}: ${roleErr.message}`); continue; }

    if (permIds.length > 0) {
      await supabaseAdmin.from('role_permissions').insert(
        permIds.map(pid => ({ role_id: role.id, permission_id: pid }))
      );
    }
    created.push(tpl.name);
  }

  logger.success('SEED_ROLES', `Done: created=[${created}] updated=[${updated}] skipped=[${skipped}]`);
  res.json({ message: 'Default roles seeded', created, updated, skipped, company_type: company.company_type, reset });
}));

module.exports = router;
