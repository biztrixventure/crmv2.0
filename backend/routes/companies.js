const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
// Auth middleware is applied in server.js
const { hasPermission, isSuperAdmin, getUserCompanies, assignUserToCompany } = require('../models/helpers');
const logger = require('../utils/logger');
const { excludePostDate, POST_DATE_ILIKE } = require('../utils/postDate');

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
          .select("id, name, slug, logo_url, logo_light_url, logo_dark_url, is_active, company_type, internal_timezone, currency, created_at")
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
          .select('id, name, slug, is_active, company_type')
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
        .select('id, name, slug, is_active, company_type')
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
    body("slug").trim().optional({ nullable: true }),
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
    body("internal_timezone").trim().optional(),
    body("currency").trim().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { name, slug, logo_url, logo_light_url, logo_dark_url, company_type, internal_timezone, currency } = req.body;
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
          slug:              slug              || null,
          logo_url:          logo_url          || null,
          logo_light_url:    logo_light_url    || null,
          logo_dark_url:     logo_dark_url     || null,
          created_by:        userId,
          is_active:         true,
          company_type:      company_type      || 'fronter',
          internal_timezone: internal_timezone || 'Asia/Karachi',
          currency: currency || 'PKR',
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
        .select("id, name, slug, logo_url, logo_light_url, logo_dark_url, is_active, company_type, internal_timezone, currency, created_at")
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
    body("slug").trim().optional({ nullable: true }),
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
    body("internal_timezone").trim().optional(),
    body("currency").trim().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id } = req.params;
    const { name, slug, logo_url, logo_light_url, logo_dark_url, is_active, company_type, internal_timezone, currency } = req.body;
    const userId = req.user.id;

    try {
      // Check permission
      const hasPerm = await hasPermission(userId, id, "edit_company");
      if (!hasPerm && req.user.role !== "superadmin") {
        return res.status(403).json({ error: "You don't have permission to update this company" });
      }

      const updateData = {};
      if (name)                          updateData.name              = name;
      if (slug !== undefined)            updateData.slug              = slug || null;
      if (logo_url !== undefined)        updateData.logo_url          = logo_url;
      if (logo_light_url !== undefined)  updateData.logo_light_url    = logo_light_url || null;
      if (logo_dark_url !== undefined)   updateData.logo_dark_url     = logo_dark_url  || null;
      if (is_active !== undefined)       updateData.is_active         = is_active;
      if (company_type !== undefined)    updateData.company_type      = company_type;
      if (internal_timezone !== undefined) updateData.internal_timezone = internal_timezone || 'Asia/Karachi';
      if (currency !== undefined) updateData.currency = currency || 'PKR';

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

      // Exclude system superadmins from member lists — they are env-level,
      // not real company members even if a stale user_company_roles row exists.
      const saEmails = new Set(
        (process.env.SUPERADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
      );
      const superadminIds = new Set(
        (authUsers?.users || [])
          .filter(u => u.app_metadata?.role === 'superadmin' || saEmails.has((u.email || '').toLowerCase()))
          .map(u => u.id)
      );

      const visibleMembers = (data || []).filter(m => !superadminIds.has(m.user_id));

      res.json({
        total: visibleMembers.length,
        members: visibleMembers.map((m) => ({
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

// ============================================================================
// GET /companies/:id/overview — everything the Company Detail overview shows,
// in ONE round-trip.
//
// The old panel fired four list requests with limit=1 just to read `total`, so
// it could only ever show four raw counts. This returns the counts plus what
// makes them readable: status breakdowns, this month against last, overdue
// callbacks, the member split, roles, and the link partners.
//
// Counts mirror the list endpoints EXACTLY so the Overview never disagrees
// with the Transfers / Sales / Callbacks tabs beside it:
//   • fronter company → rows carry its company_id
//   • closer company  → transfers via its members' assigned_closer_id, sales
//     via closer_id (transfers.js:128, sales.js:231). Callbacks always carry
//     company_id (callbacks.js:72).
// Post-dated sales are reminders, not sales (utils/postDate.js) — excluded
// from every sales figure and reported separately as `sales.postDates`.
// ============================================================================

// Start of the month in the company's own timezone (offset back by `minus`
// months), as a UTC ISO string. Falls back to UTC if Intl rejects the tz.
const zonedMonthStart = (tz, minus = 0) => {
  const now = new Date();
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = (d) => Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    const p = parts(now);
    let y = +p.year, m = +p.month - 1 - minus;
    while (m < 0) { m += 12; y -= 1; }
    // Guess the instant as if UTC, then correct by the zone's offset there.
    const guess = new Date(Date.UTC(y, m, 1));
    const g = parts(guess);
    const asUtc = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute, +g.second);
    return new Date(guess.getTime() - (asUtc - guess.getTime())).toISOString();
  } catch {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - minus, 1)).toISOString();
  }
};

router.get(
  "/:id/overview",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const { data: company, error: coErr } = await supabaseAdmin
      .from("companies")
      .select("id, name, slug, is_active, company_type, internal_timezone, currency, created_at")
      .eq("id", id)
      .single();
    if (coErr || !company) return res.status(404).json({ error: "Company not found" });

    const superadmin = await isSuperAdmin(userId);
    const isAdminRole = superadmin || ['superadmin', 'readonly_admin'].includes(req.user.role);
    if (!isAdminRole) {
      const mine = await getUserCompanies(userId);
      if (!mine.some((c) => c.id === id)) {
        return res.status(403).json({ error: "You don't have access to this company" });
      }
    }
    const canFin = superadmin || await hasPermission(userId, id, 'view_financial_data');

    const tz = company.internal_timezone || 'UTC';
    const monthStart = zonedMonthStart(tz, 0);
    const prevStart  = zonedMonthStart(tz, 1);
    const nowIso     = new Date().toISOString();

    // Members — all of them; the active/inactive split is part of the picture.
    const { data: roleRows } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id, is_active, custom_roles(level)')
      .eq('company_id', id);
    const members   = roleRows || [];
    const activeIds = [...new Set(members.filter(m => m.is_active).map(m => m.user_id))];
    const byLevel   = {};
    for (const m of members) {
      if (!m.is_active) continue;
      const lvl = m.custom_roles?.level || 'unassigned';
      byLevel[lvl] = (byLevel[lvl] || 0) + 1;
    }

    // Scope builders — the same rows the list routes return.
    const isFronter   = company.company_type === 'fronter';
    const closerEmpty = !isFronter && activeIds.length === 0;   // .in([]) is a 400 — short-circuit
    const scopeT = (q) => isFronter ? q.eq('company_id', id) : q.in('assigned_closer_id', activeIds);
    const scopeS = (q) => isFronter ? q.eq('company_id', id) : q.in('closer_id', activeIds);
    const scopeC = (q) => q.eq('company_id', id);

    const cnt = (table, scope, extra = (q) => q) => {
      if (table !== 'callbacks' && closerEmpty) return Promise.resolve(0);
      return extra(scope(supabaseAdmin.from(table).select('id', { count: 'exact', head: true })))
        .then(r => r.count || 0);
    };
    const lastAt = (table, scope) => {
      if (closerEmpty) return Promise.resolve(null);
      return scope(supabaseAdmin.from(table).select('created_at').order('created_at', { ascending: false }).limit(1))
        .then(r => r.data?.[0]?.created_at || null);
    };

    const T_STATUSES = ['pending', 'assigned', 'completed', 'rejected', 'cancelled'];
    const S_STATUSES = ['open', 'pending_review', 'closed_won', 'cancelled'];

    const [tTotal, tMonth, tPrev, tLast, ...tByStatus] = await Promise.all([
      cnt('transfers', scopeT),
      cnt('transfers', scopeT, q => q.gte('created_at', monthStart)),
      cnt('transfers', scopeT, q => q.gte('created_at', prevStart).lt('created_at', monthStart)),
      lastAt('transfers', scopeT),
      ...T_STATUSES.map(s => cnt('transfers', scopeT, q => q.eq('status', s))),
    ]);

    const [sTotal, sMonth, sPrev, sLast, sPostDates, ...sByStatus] = await Promise.all([
      cnt('sales', scopeS, excludePostDate),
      cnt('sales', scopeS, q => excludePostDate(q).gte('created_at', monthStart)),
      cnt('sales', scopeS, q => excludePostDate(q).gte('created_at', prevStart).lt('created_at', monthStart)),
      lastAt('sales', scopeS),
      cnt('sales', scopeS, q => q.ilike('closer_disposition', POST_DATE_ILIKE)),
      ...S_STATUSES.map(s => cnt('sales', scopeS, q => excludePostDate(q).eq('status', s))),
    ]);

    const [cTotal, cPending, cOverdue, cCompleted, cMonth] = await Promise.all([
      cnt('callbacks', scopeC),
      cnt('callbacks', scopeC, q => q.eq('status', 'pending')),
      cnt('callbacks', scopeC, q => q.eq('status', 'pending').lt('callback_at', nowIso)),
      cnt('callbacks', scopeC, q => q.eq('status', 'completed')),
      cnt('callbacks', scopeC, q => q.gte('created_at', monthStart)),
    ]);

    // Money: this month's closed-won monthly premium. Only for callers who may
    // see financials — the field is ABSENT for everyone else, not zero.
    let monthRevenue;
    if (canFin && !closerEmpty) {
      const { data: rev } = await excludePostDate(
        scopeS(supabaseAdmin.from('sales').select('monthly_payment'))
          .eq('status', 'closed_won').gte('created_at', monthStart)
      );
      monthRevenue = (rev || []).reduce((a, r) => a + (parseFloat(r.monthly_payment) || 0), 0);
    }

    const [{ count: rolesCount }, { data: linkRows }] = await Promise.all([
      supabaseAdmin.from('custom_roles').select('id', { count: 'exact', head: true }).eq('company_id', id),
      supabaseAdmin.from('company_links')
        .select('fronter_company_id, closer_company_id')
        .or(`fronter_company_id.eq.${id},closer_company_id.eq.${id}`),
    ]);
    const partnerIds = [...new Set((linkRows || []).map(l => l.fronter_company_id === id ? l.closer_company_id : l.fronter_company_id))];
    const { data: partners } = partnerIds.length
      ? await supabaseAdmin.from('companies').select('id, name, company_type, is_active').in('id', partnerIds).order('name')
      : { data: [] };

    res.json({
      company,
      scope: isFronter ? 'fronter' : 'closer',
      period: { monthStart, prevStart, timezone: tz },
      members: {
        active: activeIds.length,
        inactive: members.filter(m => !m.is_active).length,
        total: members.length,
        byLevel,
      },
      roles: rolesCount || 0,
      transfers: {
        total: tTotal, month: tMonth, prevMonth: tPrev, lastAt: tLast,
        byStatus: Object.fromEntries(T_STATUSES.map((s, i) => [s, tByStatus[i]])),
      },
      sales: {
        total: sTotal, month: sMonth, prevMonth: sPrev, lastAt: sLast, postDates: sPostDates,
        byStatus: Object.fromEntries(S_STATUSES.map((s, i) => [s, sByStatus[i]])),
        ...(monthRevenue !== undefined ? { monthRevenue } : {}),
      },
      callbacks: { total: cTotal, pending: cPending, overdue: cOverdue, completed: cCompleted, month: cMonth },
      conversion: tTotal > 0 ? Math.round((sTotal / tTotal) * 1000) / 10 : 0,
      partners: partners || [],
    });
  })
);

module.exports = router;
