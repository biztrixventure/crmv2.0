const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');
const {
  getUserPermissions,
  hasPermission,
  canAssignRole,
  assignUserToCompany,
  getUserRole,
  isSuperAdmin,
} = require('../models/helpers');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// ============================================================================
// GET /users - List company users (with filtering)
// ============================================================================
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { company_id, role_id, search } = req.query;
    const userId = req.user.id;

    try {
      // Get user_company_roles
      let query = supabaseAdmin
        .from("user_company_roles")
        .select(`id,user_id,role_id,is_active,created_at,custom_roles(id,name,level)`)
        .eq("company_id", company_id || req.user.company_id)
        .eq("is_active", true);

      if (role_id) {
        query = query.eq("role_id", role_id);
      }

      const { data: ucr, error } = await query;

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      let users = ucr || [];

      // Fetch user_profiles for these users
      if (users.length > 0) {
        const userIds = users.map(u => u.user_id);
        const { data: profiles } = await supabaseAdmin
          .from("user_profiles")
          .select("user_id,first_name,last_name")
          .in("user_id", userIds);

        const profileMap = {};
        profiles?.forEach(p => {
          profileMap[p.user_id] = p;
        });

        // Fetch emails from auth
        const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ limit: 10000 });
        const emailMap = {};
        authUsers?.users?.forEach(u => {
          emailMap[u.id] = u.email;
        });

        // Combine all data
        users = users.map(u => ({
          ...u,
          email: emailMap[u.user_id] || 'N/A',
          first_name: profileMap[u.user_id]?.first_name,
          last_name: profileMap[u.user_id]?.last_name,
        }));
      }

      // Filter by search term if provided
      if (search) {
        const searchLower = search.toLowerCase();
        users = users.filter(
          (u) =>
            u.email?.toLowerCase().includes(searchLower) ||
            u.first_name?.toLowerCase().includes(searchLower) ||
            u.last_name?.toLowerCase().includes(searchLower)
        );
      }

      res.json({
        total: users.length,
        users: users.map((u) => ({
          id: u.id,
          user_id: u.user_id,
          email: u.email,
          first_name: u.first_name,
          last_name: u.last_name,
          role: u.custom_roles.name,
          role_level: u.custom_roles.level,
          is_active: u.is_active,
          created_at: u.created_at,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /users/:id - Get user details
// ============================================================================
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      const { data, error } = await supabaseAdmin
        .from("user_company_roles")
        .select(`id,user_id,role_id,company_id,is_active,created_at,custom_roles(id,name,level)`)
        .eq("id", id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "User not found" });
      }

      // Fetch user profile
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("first_name,last_name,avatar_url")
        .eq("user_id", data.user_id)
        .single();

      // Fetch email from auth
      let email = 'N/A';
      try {
        const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ limit: 10000 });
        const authUser = authUsers?.users?.find(u => u.id === data.user_id);
        if (authUser) {
          email = authUser.email;
        }
      } catch (emailErr) {
        console.error('Error fetching user email:', emailErr.message);
      }

      res.json({
        id: data.id,
        user_id: data.user_id,
        email: email,
        first_name: profile?.first_name,
        last_name: profile?.last_name,
        role: data.custom_roles.name,
        role_level: data.custom_roles.level,
        company_id: data.company_id,
        is_active: data.is_active,
        created_at: data.created_at,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// POST /users - Create new user (Admin only)
// ============================================================================
router.post(
  "/",
  [
    body("email").isEmail().normalizeEmail(),
    body("first_name").trim().isLength({ min: 1 }),
    body("last_name").trim().isLength({ min: 1 }),
    body("role_id").isUUID(),
    body("company_id").isUUID().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { email, first_name, last_name, role_id, company_id } = req.body;
    const userId = req.user.id;
    const userCompanyId = company_id || req.user.company_id;

    try {
      // Check if user has permission to create users
      const hasPermissionT = await hasPermission(userId, userCompanyId, "create_user");
      if (!hasPermissionT && req.user.role !== "superadmin") {
        return res.status(403).json({ error: "You don't have permission to create users" });
      }

      // Verify role exists and user can assign it
      const { data: role, error: roleError } = await supabaseAdmin
        .from("custom_roles")
        .select("level")
        .eq("id", role_id)
        .single();

      if (roleError || !role) {
        return res.status(400).json({ error: "Role not found" });
      }

      // Check role hierarchy
      const canAssign = await canAssignRole(userId, userCompanyId, role.level);
      if (!canAssign) {
        return res.status(403).json({
          error: "Cannot assign role with same or higher authority than yours",
        });
      }

      // Create user in Supabase Auth
      const password = Math.random().toString(36).slice(-12); // Temporary password
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
      });

      if (authError || !authUser.user) {
        return res.status(400).json({ error: authError?.message || "Failed to create user" });
      }

      // Create user profile
      await supabaseAdmin.from("user_profiles").insert({
        user_id: authUser.user.id,
        first_name,
        last_name,
        theme_preference: "light",
      });

      // Assign user to company with role
      const { data: assignment, error: assignError } = await supabaseAdmin
        .from("user_company_roles")
        .insert({
          user_id: authUser.user.id,
          company_id: userCompanyId,
          role_id,
          assigned_by: userId,
          is_active: true,
        })
        .select()
        .single();

      if (assignError) {
        return res.status(400).json({ error: assignError.message });
      }

      res.status(201).json({
        message: "User created successfully. Email invitation sent.",
        user: {
          id: authUser.user.id,
          email: authUser.user.email,
          first_name,
          last_name,
          company_id: userCompanyId,
          role_id,
        },
      });
    } catch (err) {
      console.error("Create user error:", err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// PUT /users/:id - Update user (Admin or self)
// ============================================================================
router.put(
  "/:id",
  [
    body("first_name").trim().optional(),
    body("last_name").trim().optional(),
    body("role_id").isUUID().optional(),
    body("is_active").isBoolean().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id } = req.params;
    const { first_name, last_name, role_id, is_active } = req.body;
    const userId = req.user.id;

    try {
      // Get the target user assignment
      const { data: targetAssignment, error: fetchError } = await supabaseAdmin
        .from("user_company_roles")
        .select("*, custom_roles(level)")
        .eq("id", id)
        .single();

      if (fetchError || !targetAssignment) {
        return res.status(404).json({ error: "User assignment not found" });
      }

      // Check permissions
      const hasEditPerm = await hasPermission(userId, targetAssignment.company_id, "edit_user");
      if (!hasEditPerm && userId !== targetAssignment.user_id) {
        return res.status(403).json({ error: "You don't have permission to edit this user" });
      }

      // If changing role, verify hierarchy
      if (role_id && role_id !== targetAssignment.role_id) {
        const { data: newRole } = await supabaseAdmin
          .from("custom_roles")
          .select("level")
          .eq("id", role_id)
          .single();

        const canAssign = await canAssignRole(userId, targetAssignment.company_id, newRole.level);
        if (!canAssign) {
          return res.status(403).json({ error: "Cannot assign this role" });
        }
      }

      // Update user profile if provided
      if (first_name || last_name) {
        await supabaseAdmin
          .from("user_profiles")
          .update({
            first_name: first_name || undefined,
            last_name: last_name || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", targetAssignment.user_id);
      }

      // Update assignment
      const updateData = {};
      if (role_id) updateData.role_id = role_id;
      if (is_active !== undefined) updateData.is_active = is_active;

      if (Object.keys(updateData).length > 0) {
        await supabaseAdmin.from("user_company_roles").update(updateData).eq("id", id);
      }

      res.json({ message: "User updated successfully" });
    } catch (err) {
      console.error("Update user error:", err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// DELETE /users/:id - Delete/deactivate user
// ============================================================================
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
      // Get target user
      const { data: target } = await supabaseAdmin
        .from("user_company_roles")
        .select("user_id, company_id")
        .eq("id", id)
        .single();

      if (!target) {
        return res.status(404).json({ error: "User not found" });
      }

      // Check permission
      const hasPerm = await hasPermission(userId, target.company_id, "delete_user");
      if (!hasPerm) {
        return res.status(403).json({ error: "You don't have permission to delete users" });
      }

      // Soft delete - deactivate instead of removing
      await supabaseAdmin
        .from("user_company_roles")
        .update({ is_active: false })
        .eq("id", id);

      res.json({ message: "User deactivated successfully" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

module.exports = router;
