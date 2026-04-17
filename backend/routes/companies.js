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
          .select("id, name, logo_url, is_active, company_type, created_at")
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
          .select('id, name, is_active, company_type')
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
        .select('id, name, is_active, company_type')
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
    body("company_type").isIn(['fronter', 'closer']).optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { name, logo_url, company_type } = req.body;
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
          company_type: company_type || 'fronter',
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
        .select("id, name, logo_url, is_active, company_type, created_at")
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
    body("company_type").isIn(['fronter', 'closer']).optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id } = req.params;
    const { name, logo_url, is_active, company_type } = req.body;
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
      if (company_type !== undefined) updateData.company_type = company_type;

      const { data, error } = await supabaseAdmin
        .from("companies")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      // Cascade: deactivate all users when company is deactivated
      if (is_active === false) {
        await supabaseAdmin
          .from("user_company_roles")
          .update({ is_active: false })
          .eq("company_id", id);
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
          user_profiles (first_name, last_name, avatar_url)
        `
        )
        .eq("company_id", companyId)
        .eq("is_active", true);

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      // Fetch emails from Supabase Auth admin API
      const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ limit: 10000 });
      const emailMap = {};
      authUsers?.users?.forEach((u) => { emailMap[u.id] = u.email; });

      res.json({
        total: (data || []).length,
        members: (data || []).map((m) => ({
          id: m.id,
          user_id: m.user_id,
          email: emailMap[m.user_id] || "N/A",
          first_name: m.user_profiles?.first_name,
          last_name: m.user_profiles?.last_name,
          role: m.custom_roles?.name,
          role_level: m.custom_roles?.level,
          avatarUrl: m.user_profiles?.avatar_url,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /companies/:id/links — Get companies linked to this one
// Returns linked closer companies (if this is fronter) or linked fronter companies (if closer)
// ============================================================================
router.get('/:id/links', asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Access: superadmin or member of this company
  if (req.user.role !== 'superadmin') {
    const userCompanies = await getUserCompanies(req.user.id);
    if (!userCompanies.some(c => c.id === id)) {
      return res.status(403).json({ error: 'Access denied' });
    }
  }

  const { data: company } = await supabaseAdmin
    .from('companies').select('company_type').eq('id', id).single();

  let links = [];
  if (company?.company_type === 'fronter') {
    const { data } = await supabaseAdmin
      .from('company_links')
      .select('id, closer_company_id, created_at, companies!company_links_closer_company_id_fkey(id, name, company_type)')
      .eq('fronter_company_id', id);
    links = (data || []).map(l => ({ link_id: l.id, ...l.companies, created_at: l.created_at }));
  } else {
    const { data } = await supabaseAdmin
      .from('company_links')
      .select('id, fronter_company_id, created_at, companies!company_links_fronter_company_id_fkey(id, name, company_type)')
      .eq('closer_company_id', id);
    links = (data || []).map(l => ({ link_id: l.id, ...l.companies, created_at: l.created_at }));
  }

  res.json({ links });
}));

// ============================================================================
// POST /companies/:id/links — Link a closer company to this fronter company (SuperAdmin only)
// Body: { closer_company_id: UUID }
// ============================================================================
router.post('/:id/links', [body('closer_company_id').isUUID()], asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'SuperAdmin only' });

  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'closer_company_id required' });

  const { id: fronterCompanyId } = req.params;
  const { closer_company_id } = req.body;

  // Validate types
  const { data: companies } = await supabaseAdmin
    .from('companies').select('id, company_type').in('id', [fronterCompanyId, closer_company_id]);
  const fronter = companies?.find(c => c.id === fronterCompanyId);
  const closer  = companies?.find(c => c.id === closer_company_id);

  if (!fronter || !closer) return res.status(404).json({ error: 'Company not found' });
  if (fronter.company_type !== 'fronter') return res.status(400).json({ error: 'Source company must be type fronter' });
  if (closer.company_type  !== 'closer')  return res.status(400).json({ error: 'Target company must be type closer' });

  const { data, error } = await supabaseAdmin
    .from('company_links')
    .insert({ fronter_company_id: fronterCompanyId, closer_company_id, created_by: req.user.id })
    .select().single();

  if (error) {
    if (error.message.includes('unique') || error.message.includes('duplicate')) {
      return res.status(400).json({ error: 'These companies are already linked' });
    }
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json({ link: data });
}));

// ============================================================================
// DELETE /companies/:id/links/:linkId — Remove a company link (SuperAdmin only)
// ============================================================================
router.delete('/:id/links/:linkId', asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') return res.status(403).json({ error: 'SuperAdmin only' });

  const { linkId } = req.params;
  const { error } = await supabaseAdmin.from('company_links').delete().eq('id', linkId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Link removed' });
}));

// ============================================================================
// DELETE /companies/:id — Hard delete company (SuperAdmin only)
// - Nullifies company_id on sales + transfers (records preserved, orphaned)
// - Deletes all user_company_roles for this company
// - Deletes the company record
// ============================================================================
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    if (req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Only SuperAdmin can delete companies" });
    }

    const { data: company, error: fetchErr } = await supabaseAdmin
      .from("companies")
      .select("id, name")
      .eq("id", id)
      .single();

    if (fetchErr || !company) return res.status(404).json({ error: "Company not found" });

    // 1. Preserve sales/transfers — unlink company, keep the records
    await supabaseAdmin.from("sales").update({ company_id: null }).eq("company_id", id);
    await supabaseAdmin.from("transfers").update({ company_id: null }).eq("company_id", id);

    // 2. Preserve review/dispo records — unlink company
    await supabaseAdmin.from("call_reviews").update({ company_id: null }).eq("company_id", id);
    await supabaseAdmin.from("call_dispositions").update({ company_id: null }).eq("company_id", id);

    // 3. Get all custom role IDs belonging to this company
    const { data: companyRoles } = await supabaseAdmin
      .from("custom_roles").select("id").eq("company_id", id);
    const roleIds = (companyRoles || []).map(r => r.id);

    // 4. Delete user_company_roles — by company AND by any of this company's roles
    await supabaseAdmin.from("user_company_roles").delete().eq("company_id", id);
    if (roleIds.length > 0) {
      await supabaseAdmin.from("user_company_roles").delete().in("role_id", roleIds);
    }

    // 5. Delete company-specific roles and sale configs
    await supabaseAdmin.from("custom_roles").delete().eq("company_id", id);
    await supabaseAdmin.from("sale_configs").delete().eq("company_id", id);

    // 6. Hard delete company
    const { error: delErr } = await supabaseAdmin.from("companies").delete().eq("id", id);
    if (delErr) return res.status(500).json({ error: delErr.message });

    res.json({
      message: `Company "${company.name}" permanently deleted. Sales and transfers preserved.`,
    });
  })
);

module.exports = router;
