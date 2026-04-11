const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { authMiddleware } = require('../middleware/authMiddleware');
const { hasPermission, canAssignRole, createRole, isSuperAdmin } = require('../models/helpers');

const router = express.Router();

router.use(authMiddleware);

// ============================================================================
// GET /roles - List available roles in company
// ============================================================================
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { company_id } = req.query;
    const userId = req.user.id;
    let companyId = company_id;

    // If company_id not provided, fetch from user's company assignment
    if (!companyId) {
      try {
        const { data: userCompany } = await supabaseAdmin
          .from("user_company_roles")
          .select("company_id")
          .eq("user_id", userId)
          .eq("is_active", true)
          .limit(1)
          .single();

        if (userCompany) {
          companyId = userCompany.company_id;
        }
      } catch (err) {
        // User might be super admin with no company assignment, which is ok
        // We'll return all roles in that case
      }
    }

    try {
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

      // If we have a companyId, filter by it (include system roles with null company_id too)
      if (companyId) {
        query = query.or(`company_id.eq.${companyId},company_id.is.null`);
      }

      const { data, error } = await query;

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json({
        total: data.length,
        roles: (data || []).map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          level: r.level,
          permissions: (r.role_permissions || []).map((rp) => rp.permissions.name),
        })),
      });
    } catch (err) {
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
    try {
      const { data, error } = await supabaseAdmin
        .from("permissions")
        .select("id, name, description, category")
        .order("category")
        .order("name");

      if (error) {
        return res.status(400).json({ error: error.message });
      }

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

      res.json(grouped);
    } catch (err) {
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
    const { id } = req.params;

    try {
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
        return res.status(404).json({ error: "Role not found" });
      }

      res.json({
        id: data.id,
        name: data.name,
        description: data.description,
        level: data.level,
        company_id: data.company_id,
        permissions: (data.role_permissions || []).map((rp) => rp.permissions),
      });
    } catch (err) {
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
    body("level").isIn(["superadmin", "company_admin", "manager", "operations"]),
    body("company_id").isUUID().optional(),
    body("permissions").isArray().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { name, description, level, company_id, permissions } = req.body;
    const userId = req.user.id;
    let targetCompanyId = company_id;

    // If company_id not provided, fetch from user's company assignment
    if (!targetCompanyId) {
      try {
        const { data: userCompany } = await supabaseAdmin
          .from("user_company_roles")
          .select("company_id")
          .eq("user_id", userId)
          .eq("is_active", true)
          .limit(1)
          .single();

        if (userCompany) {
          targetCompanyId = userCompany.company_id;
        }
      } catch (err) {
        // User might not have a company assignment
      }
    }

    // If still no company_id, return error
    if (!targetCompanyId) {
      return res.status(400).json({ error: "Company ID is required or user must have a company assignment" });
    }

    try {
      // Check permission to manage roles
      const hasPerm = await hasPermission(userId, targetCompanyId, "manage_roles");
      if (!hasPerm) {
        return res.status(403).json({ error: "You don't have permission to create roles" });
      }

      // Check role hierarchy
      const canCreate = await canAssignRole(userId, targetCompanyId, level);
      if (!canCreate) {
        return res.status(403).json({
          error: "Cannot create role with same or higher authority",
        });
      }

      // Create role
      const role = await createRole(name, description || null, level, targetCompanyId, permissions || []);

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
        return res.status(400).json({ error: "Role name already exists" });
      }
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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id } = req.params;
    const { description, permissions } = req.body;
    const userId = req.user.id;

    try {
      // Get role
      const { data: role } = await supabaseAdmin
        .from("custom_roles")
        .select("company_id, level")
        .eq("id", id)
        .single();

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      // Check permission
      const hasPerm = await hasPermission(userId, role.company_id, "manage_roles");
      if (!hasPerm) {
        return res.status(403).json({ error: "You don't have permission to update roles" });
      }

      // Update description if provided
      if (description !== undefined) {
        await supabaseAdmin
          .from("custom_roles")
          .update({ description })
          .eq("id", id);
      }

      // Update permissions if provided
      if (permissions && Array.isArray(permissions)) {
        // Get all permission IDs
        const { data: allPerms } = await supabaseAdmin
          .from("permissions")
          .select("id")
          .in("name", permissions);

        // Delete old permissions
        await supabaseAdmin.from("role_permissions").delete().eq("role_id", id);

        // Insert new permissions
        if (allPerms && allPerms.length > 0) {
          await supabaseAdmin.from("role_permissions").insert(
            allPerms.map((p) => ({
              role_id: id,
              permission_id: p.id,
            }))
          );
        }
      }

      res.json({ message: "Role updated successfully" });
    } catch (err) {
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
    const { id } = req.params;
    const userId = req.user.id;

    try {
      // Get role
      const { data: role } = await supabaseAdmin
        .from("custom_roles")
        .select("company_id")
        .eq("id", id)
        .single();

      if (!role) {
        return res.status(404).json({ error: "Role not found" });
      }

      // Check permission
      const hasPerm = await hasPermission(userId, role.company_id, "manage_roles");
      if (!hasPerm) {
        return res.status(403).json({ error: "You don't have permission to delete roles" });
      }

      // Check if role is in use
      const { data: users } = await supabaseAdmin
        .from("user_company_roles")
        .select("id")
        .eq("role_id", id);

      if (users && users.length > 0) {
        return res.status(400).json({
          error: "Cannot delete role - it's assigned to users",
        });
      }

      // Delete role
      await supabaseAdmin.from("custom_roles").delete().eq("id", id);

      res.json({ message: "Role deleted successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

module.exports = router;
