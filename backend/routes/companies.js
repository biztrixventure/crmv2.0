const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
// Auth middleware is applied in server.js
const { hasPermission, isSuperAdmin, getUserCompanies, assignUserToCompany } = require('../models/helpers');
const logger = require('../utils/logger');

const router = express.Router();

// ============================================================================
// GET /companies - List accessible companies
// ============================================================================
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    try {
      // SuperAdmin sees all, others see only their companies
      if (req.user.role === "superadmin") {
        const { data, error } = await supabaseAdmin
          .from("companies")
          .select("id, name, logo_url, is_active, created_at")
          .order("name");

        if (error) {
          return res.status(400).json({ error: error.message });
        }

        return res.json({ total: data.length, companies: data });
      }

      // Regular users see only their assigned companies
      const userCompanies = await getUserCompanies(userId);
      res.json({ total: userCompanies.length, companies: userCompanies });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /companies/available - List available companies for user assignment
// MUST BE BEFORE /:id routes
// ============================================================================
router.get(
  "/available",
  asyncHandler(async (req, res) => {
    const userRole = req.user.role;

    logger.info('GET_AVAILABLE_COMPANIES', 'Fetching available companies for assignment');

    try {
      if (userRole === 'superadmin') {
        // SuperAdmin sees all active companies
        const { data, error } = await supabaseAdmin
          .from('companies')
          .select('id, name, is_active')
          .eq('is_active', true)
          .order('name');

        if (error) {
          logger.error('GET_AVAILABLE_COMPANIES', 'Query failed', error);
          return res.status(400).json({ error: error.message });
        }

        logger.success('GET_AVAILABLE_COMPANIES', `Returned ${data?.length || 0} companies for SuperAdmin`);
        return res.json({
          total: data.length,
          companies: data || []
        });
      }

      // Company users only see their own company
      const userCompanyId = req.user.company_id;
      if (!userCompanyId) {
        logger.warn('GET_AVAILABLE_COMPANIES', 'User has no company assignment');
        return res.json({ total: 0, companies: [] });
      }

      const { data, error } = await supabaseAdmin
        .from('companies')
        .select('id, name, is_active')
        .eq('id', userCompanyId)
        .eq('is_active', true)
        .single();

      if (error) {
        logger.error('GET_AVAILABLE_COMPANIES', 'Query failed', error);
        return res.json({ total: 0, companies: [] });
      }

      logger.success('GET_AVAILABLE_COMPANIES', 'Returned user company');
      res.json({
        total: data ? 1 : 0,
        companies: data ? [data] : []
      });
    } catch (err) {
      logger.error('GET_AVAILABLE_COMPANIES', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// POST /companies - Create new company (SuperAdmin only)
// ============================================================================
router.post(
  "/",
  [
    body("name").trim().isLength({ min: 1 }),
    body("logo_url").trim().custom(value => {
      // Allow empty string or null
      if (!value) return true;
      // If provided, must be valid URL
      try {
        new URL(value);
        return true;
      } catch {
        throw new Error('Invalid URL format');
      }
    }).optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { name, logo_url } = req.body;
    const userId = req.user.id;

    try {
      // Only superadmin can create companies
      if (req.user.role !== "superadmin") {
        return res.status(403).json({ error: "Only SuperAdmin can create companies" });
      }

      const { data, error } = await supabaseAdmin
        .from("companies")
        .insert({
          name,
          logo_url: logo_url || null,
          created_by: userId,
          is_active: true,
        })
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.status(201).json({
        message: "Company created successfully",
        company: data,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /companies/:id - Get company details
// ============================================================================
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    try {
      const { data, error } = await supabaseAdmin
        .from("companies")
        .select("id, name, logo_url, is_active, created_at")
        .eq("id", id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Company not found" });
      }

      // Check if user has access (must be member or superadmin)
      const userCompanies = await getUserCompanies(userId);
      if (
        req.user.role !== "superadmin" &&
        !userCompanies.some((c) => c.id === id)
      ) {
        return res.status(403).json({ error: "You don't have access to this company" });
      }

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// PUT /companies/:id - Update company
// ============================================================================
router.put(
  "/:id",
  [
    body("name").trim().isLength({ min: 1 }).optional(),
    body("logo_url").trim().custom(value => {
      // Allow empty string, null, or undefined
      if (!value) return true;
      // If provided, must be valid URL
      try {
        new URL(value);
        return true;
      } catch {
        throw new Error('Invalid URL format');
      }
    }).optional(),
    body("is_active").isBoolean().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id } = req.params;
    const { name, logo_url, is_active } = req.body;
    const userId = req.user.id;

    try {
      // Check permission
      const hasPerm = await hasPermission(userId, id, "edit_company");
      if (!hasPerm && req.user.role !== "superadmin") {
        return res.status(403).json({ error: "You don't have permission to update this company" });
      }

      const updateData = {};
      if (name) updateData.name = name;
      if (logo_url !== undefined) updateData.logo_url = logo_url;
      if (is_active !== undefined) updateData.is_active = is_active;

      const { data, error } = await supabaseAdmin
        .from("companies")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json({ message: "Company updated successfully", company: data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// POST /companies/:id/assign-user - Assign user to company
// ============================================================================
router.post(
  "/:id/assign-user",
  [
    body("user_id").isUUID(),
    body("role_id").isUUID(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id: companyId } = req.params;
    const { user_id, role_id } = req.body;
    const userId = req.user.id;

    try {
      // Check permission
      const hasPerm = await hasPermission(userId, companyId, "view_company_members");
      if (!hasPerm && req.user.role !== "superadmin") {
        return res.status(403).json({ error: "You don't have permission to manage company members" });
      }

      // Assign user to company
      const result = await assignUserToCompany(user_id, companyId, role_id, userId);

      res.status(201).json({
        message: "User assigned to company successfully",
        assignment: result,
      });
    } catch (err) {
      if (err.message.includes("duplicate")) {
        return res.status(400).json({ error: "User already assigned to this company" });
      }
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// DELETE /companies/:id/remove-user - Remove user from company
// ============================================================================
router.delete(
  "/:id/remove-user",
  [body("user_id").isUUID()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id: companyId } = req.params;
    const { user_id } = req.body;
    const userId = req.user.id;

    try {
      // Check permission
      const hasPerm = await hasPermission(userId, companyId, "view_company_members");
      if (!hasPerm && req.user.role !== "superadmin") {
        return res.status(403).json({ error: "You don't have permission to manage company members" });
      }

      await supabaseAdmin
        .from("user_company_roles")
        .update({ is_active: false })
        .eq("user_id", user_id)
        .eq("company_id", companyId);

      res.json({ message: "User removed from company" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /companies/:id/members - Get company members
// ============================================================================
router.get(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const { id: companyId } = req.params;
    const userId = req.user.id;

    try {
      // Check access
      const userCompanies = await getUserCompanies(userId);
      if (
        req.user.role !== "superadmin" &&
        !userCompanies.some((c) => c.id === companyId)
      ) {
        return res.status(403).json({ error: "You don't have access to this company" });
      }

      const { data, error } = await supabaseAdmin
        .from("user_company_roles")
        .select(
          `
          id,
          user_id,
          role_id,
          is_active,
          created_at,
          custom_roles (name, level),
          user_profiles (first_name, last_name, avatar_url),
          auth.users!inner (email)
        `
        )
        .eq("company_id", companyId)
        .eq("is_active", true);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      res.json({
        total: data.length,
        members: (data || []).map((m) => ({
          id: m.id,
          user_id: m.user_id,
          email: m.auth?.email,
          first_name: m.user_profiles?.first_name,
          last_name: m.user_profiles?.last_name,
          role: m.custom_roles.name,
          role_level: m.custom_roles.level,
          avatarUrl: m.user_profiles?.avatar_url,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

module.exports = router;
