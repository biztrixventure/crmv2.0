const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireRole } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');
const {
  getUserPermissions,
  hasPermission,
  canAssignRole,
  assignUserToCompany,
  getUserRole,
  isSuperAdmin,
  getCompanyTypeLevels,
  ROLE_HIERARCHY,
} = require('../models/helpers');
const { validatePassword, generateSecurePassword } = require('../utils/passwordValidator');

// A user can have several dialer agent ids (one per box). Accept a single id or
// a comma/space-separated list → { primary, ids[] } (trimmed, de-duped).
function parseAgentIds(raw) {
  // Uppercase so matching is case-consistent with the dialer (see migration 121).
  const ids = [...new Set(String(raw || '').split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
  return { primary: ids[0] || null, ids };
}
// Reject if any of these ids already belongs to ANOTHER user (checks the single
// column + the array). Returns the clashing id or null. excludeUserId skips self.
async function agentIdClash(ids, excludeUserId) {
  if (!ids.length) return null;
  const list = ids.join(',');
  let { data, error } = await supabaseAdmin.from('user_profiles')
    .select('user_id, vicidial_agent_id, vicidial_agent_ids')
    .or(`vicidial_agent_id.in.(${list}),vicidial_agent_ids.ov.{${list}}`).limit(5);
  if (error && /vicidial_agent_ids|column/i.test(error.message || '')) {  // pre-111: single column only
    ({ data } = await supabaseAdmin.from('user_profiles')
      .select('user_id, vicidial_agent_id').in('vicidial_agent_id', ids).limit(5));
  }
  const row = (data || []).find(r => r.user_id !== excludeUserId);
  if (!row) return null;
  return ids.find(i => i === row.vicidial_agent_id || (row.vicidial_agent_ids || []).includes(i)) || ids[0];
}

const router = express.Router();

// Split a single "Full Name" into first/last: first token is the first name,
// everything after is the last name (single-word names get an empty last name).
// Keeps name handling consistent with the bulk uploader's full-name field.
function splitFullName(full) {
  const parts = String(full || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  return { first_name: parts.shift() || '', last_name: parts.join(' ') };
}

// Auth is applied in server.js — no duplicate middleware here

// ============================================================================
// GET /users - List company users (with filtering)
// ============================================================================
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { company_id, role_id, search, include_inactive } = req.query;
    const userId = req.user.id;
    const targetCompanyId = company_id || req.user.company_id;
    // Management views pass include_inactive=true so deactivated users stay
    // visible (with a status badge). Dropdowns/pickers omit it and get active only.
    const includeInactive = include_inactive === 'true' || include_inactive === true;

    logger.info('GET_USERS', `Fetching users for company=${targetCompanyId}, roleId=${role_id}, search=${search}, includeInactive=${includeInactive}`, { userId, targetCompanyId, role_id, search });

    try {
      logger.debug('GET_USERS', 'Querying user_company_roles', { company_id: targetCompanyId, includeInactive, role_id });

      let query = supabaseAdmin
        .from("user_company_roles")
        .select(`id,user_id,role_id,is_active,created_at,company_id,custom_roles(id,name,level)`);

      if (!includeInactive) query = query.eq("is_active", true);

      if (targetCompanyId) {
        query = query.eq("company_id", targetCompanyId);
      } else {
        // No company filter — only allow superadmin
        const superadmin = await isSuperAdmin(userId);
        if (!superadmin) return res.status(400).json({ error: 'company_id required' });
      }

      if (role_id) {
        query = query.eq("role_id", role_id);
        logger.debug('GET_USERS', 'Added role filter', { role_id });
      }

      const { data: ucr, error } = await query;

      if (error) {
        logger.error('GET_USERS', 'user_company_roles query failed', error);
        return res.status(400).json({ error: error.message });
      }

      logger.success('GET_USERS', `Query returned ${ucr?.length || 0} user assignments`, { count: ucr?.length || 0 });

      let users = ucr || [];

      // Fetch user_profiles for these users
      if (users.length > 0) {
        const userIds = users.map(u => u.user_id);
        logger.debug('GET_USERS', `Fetching profiles for ${userIds.length} users`, { userIds });

        // Try the multi-id column (111); fall back if the migration isn't applied.
        let { data: profiles, error: profileError } = await supabaseAdmin
          .from("user_profiles")
          .select("user_id,first_name,last_name,vicidial_agent_id,vicidial_agent_ids")
          .in("user_id", userIds);
        if (profileError && /vicidial_agent_ids|column/i.test(profileError.message || '')) {
          ({ data: profiles, error: profileError } = await supabaseAdmin
            .from("user_profiles")
            .select("user_id,first_name,last_name,vicidial_agent_id")
            .in("user_id", userIds));
        }

        if (profileError) {
          logger.error('GET_USERS', 'Failed to fetch user profiles', profileError);
        } else {
          logger.success('GET_USERS', `Fetched ${profiles?.length || 0} profiles`, { count: profiles?.length || 0 });
        }

        const profileMap = {};
        profiles?.forEach(p => {
          // Surface ALL dialer ids as a comma list so the edit form round-trips them.
          const ids = (p.vicidial_agent_ids && p.vicidial_agent_ids.length) ? p.vicidial_agent_ids : (p.vicidial_agent_id ? [p.vicidial_agent_id] : []);
          profileMap[p.user_id] = { ...p, vicidial_agent_id: ids.join(', ') || null };
        });

        // Fetch emails via getUserById in parallel — listUsers paginates at 1000
        // and silently drops users beyond the first page, causing N/A fallback.
        logger.debug('GET_USERS', `Fetching emails for ${userIds.length} users via getUserById`);

        const authResults = await Promise.allSettled(
          userIds.map(uid => supabaseAdmin.auth.admin.getUserById(uid))
        );

        const emailMap = {};
        authResults.forEach((result, i) => {
          if (result.status === 'fulfilled' && result.value.data?.user?.email) {
            emailMap[userIds[i]] = result.value.data.user.email;
          }
        });

        logger.success('GET_USERS', `Resolved emails for ${Object.keys(emailMap).length}/${userIds.length} users`);

        // Combine all data
        users = users.map(u => ({
          ...u,
          email: emailMap[u.user_id] || 'N/A',
          first_name: profileMap[u.user_id]?.first_name,
          last_name: profileMap[u.user_id]?.last_name,
          vicidial_agent_id: profileMap[u.user_id]?.vicidial_agent_id || null,
        }));

        logger.success('GET_USERS', `Combined data for ${users.length} users`, { total: users.length });
      }

      // Role-hierarchy visibility: only show users with strictly lower authority.
      // Superadmin (0) and readonly_admin (1) see all. Self always excluded.
      const callerLevel = ROLE_HIERARCHY[req.user.role] ?? 999;
      const isPrivilegedViewer = req.user.role === 'superadmin' || req.user.role === 'readonly_admin';
      users = users.filter(u => {
        if (u.user_id === userId) return false; // never show self
        if (isPrivilegedViewer) return true;
        const theirLevel = ROLE_HIERARCHY[u.custom_roles?.level] ?? -1;
        return theirLevel > callerLevel; // strictly lower authority
      });

      // Filter by search term if provided
      if (search) {
        const searchLower = search.toLowerCase();
        const beforeSearch = users.length;
        users = users.filter(
          (u) =>
            u.email?.toLowerCase().includes(searchLower) ||
            u.first_name?.toLowerCase().includes(searchLower) ||
            u.last_name?.toLowerCase().includes(searchLower)
        );
        logger.info('GET_USERS', `Search filter: ${beforeSearch} → ${users.length} users`, { search, beforeCount: beforeSearch, afterCount: users.length });
      }

      logger.success('GET_USERS', `Returning ${users.length} users`, { total: users.length });

      // Drop rows whose role was deleted (custom_roles join returns null) to avoid crashing the map
      const visibleUsers = users.filter(u => u.custom_roles);

      res.json({
        total: visibleUsers.length,
        users: visibleUsers.map((u) => ({
          id: u.id,
          user_id: u.user_id,
          email: u.email,
          first_name: u.first_name,
          last_name: u.last_name,
          role: u.custom_roles.name,
          role_id: u.role_id,
          role_level: u.custom_roles.level,
          company_id: u.company_id,
          is_active: u.is_active,
          created_at: u.created_at,
        })),
      });
    } catch (err) {
      logger.error('GET_USERS', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /users/lookup - lightweight active-user list for the superadmin reassign
// picker. Returns one row per (user, company): { user_id, name, role,
// company_id, company_name }. Superadmin / readonly_admin only.
// ============================================================================
router.get('/lookup', asyncHandler(async (req, res) => {
  if (!['superadmin', 'readonly_admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  const companyId = req.query.company_id || null;
  let q = supabaseAdmin.from('user_company_roles')
    .select('user_id, company_id, custom_roles(level), companies(name)')
    .eq('is_active', true);
  if (companyId) q = q.eq('company_id', companyId);
  const { data: ucr } = await q;
  const ids = [...new Set((ucr || []).map(r => r.user_id))];
  const names = {};
  if (ids.length) {
    const { data: profs } = await supabaseAdmin.from('user_profiles')
      .select('user_id, first_name, last_name').in('user_id', ids);
    (profs || []).forEach(p => { names[p.user_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'User'; });
  }
  const seen = new Set();
  const users = [];
  for (const r of (ucr || [])) {
    const k = `${r.user_id}|${r.company_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    users.push({ user_id: r.user_id, name: names[r.user_id] || 'User', role: r.custom_roles?.level || null, company_id: r.company_id, company_name: r.companies?.name || null });
  }
  users.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  res.json({ users });
}));

// ============================================================================
// GET /users/:id - Get user details
// ============================================================================
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    logger.debug('GET_USER_BY_ID', `Fetching user details`, { id });

    try {
      const { data, error } = await supabaseAdmin
        .from("user_company_roles")
        .select(`id,user_id,role_id,company_id,is_active,created_at,custom_roles(id,name,level)`)
        .eq("id", id)
        .single();

      if (error || !data) {
        logger.error('GET_USER_BY_ID', `User not found`, error || new Error('No data returned'));
        return res.status(404).json({ error: "User not found" });
      }

      logger.success('GET_USER_BY_ID', `Found user assignment`, { id, user_id: data.user_id });

      // Fetch user profile
      logger.debug('GET_USER_BY_ID', `Fetching user profile`, { user_id: data.user_id });
      let { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("first_name,last_name,avatar_url,vicidial_agent_id,vicidial_agent_ids")
        .eq("user_id", data.user_id)
        .single();
      if (!profile) {
        // Fallback if 111 (vicidial_agent_ids) isn't applied yet.
        ({ data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("first_name,last_name,avatar_url,vicidial_agent_id")
          .eq("user_id", data.user_id)
          .single());
      }

      if (profile) {
        logger.success('GET_USER_BY_ID', `Found user profile`, { first_name: profile.first_name, last_name: profile.last_name });
      } else {
        logger.warn('GET_USER_BY_ID', `No profile found for user`, { user_id: data.user_id });
      }

      // Fetch email via getUserById — targeted, no pagination issues
      let email = 'N/A';
      try {
        logger.debug('GET_USER_BY_ID', `Fetching email from auth`, { user_id: data.user_id });
        const { data: authUserData, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
        if (authUserData?.user?.email) {
          email = authUserData.user.email;
          logger.success('GET_USER_BY_ID', `Found auth user email`, { email });
        } else {
          logger.warn('GET_USER_BY_ID', `Auth user not found`, { user_id: data.user_id, error: authUserError?.message });
        }
      } catch (emailErr) {
        logger.error('GET_USER_BY_ID', 'Error fetching user email', emailErr);
      }

      logger.success('GET_USER_BY_ID', `Returning user details`, { id, email, role: data.custom_roles.name });

      res.json({
        id: data.id,
        user_id: data.user_id,
        email: email,
        first_name: profile?.first_name,
        last_name: profile?.last_name,
        vicidial_agent_id: ((profile?.vicidial_agent_ids && profile.vicidial_agent_ids.length) ? profile.vicidial_agent_ids.join(', ') : profile?.vicidial_agent_id) || null,
        role: data.custom_roles.name,
        role_level: data.custom_roles.level,
        company_id: data.company_id,
        is_active: data.is_active,
        created_at: data.created_at,
      });
    } catch (err) {
      logger.error('GET_USER_BY_ID', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// POST /users/bulk - Bulk create users (superadmin only)
// Body: { users: [{first_name,last_name,email,password}], role_id, company_id }
// ============================================================================
router.post('/bulk', asyncHandler(async (req, res) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Bulk upload requires superadmin role' });
  }

  const { users, role_id, company_id } = req.body;
  const requestingUserId = req.user.id;

  if (!Array.isArray(users) || users.length === 0)
    return res.status(400).json({ error: 'users array is required and must not be empty' });
  if (!role_id)    return res.status(400).json({ error: 'role_id is required' });
  if (!company_id) return res.status(400).json({ error: 'company_id is required' });
  if (users.length > 200)
    return res.status(400).json({ error: 'Maximum 200 users per batch' });

  // Verify role belongs to company
  const { data: role, error: roleErr } = await supabaseAdmin
    .from('custom_roles').select('id,level,name').eq('id', role_id).single();
  if (roleErr || !role) return res.status(400).json({ error: 'Role not found' });

  const results = [];

  for (const u of users) {
    const email = (u.email || '').trim().toLowerCase();
    try {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: u.password,
        email_confirm: true,
      });

      if (authError || !authData?.user) {
        results.push({ email, success: false, error: authError?.message || 'Auth creation failed' });
        continue;
      }

      const authUserId = authData.user.id;

      await supabaseAdmin.from('user_profiles').insert({
        user_id: authUserId,
        first_name: (u.first_name || '').trim(),
        last_name:  (u.last_name  || '').trim(),
        theme_preference: 'light',
      });

      const { error: assignError } = await supabaseAdmin.from('user_company_roles').insert({
        user_id:     authUserId,
        company_id,
        role_id,
        assigned_by: requestingUserId,
        is_active:   true,
      });

      if (assignError) {
        results.push({ email, success: false, error: assignError.message });
      } else {
        results.push({ email, success: true });
      }
    } catch (err) {
      results.push({ email, success: false, error: err.message });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed    = results.filter(r => !r.success).length;

  logger.info('BULK_CREATE_USERS', `${succeeded} created, ${failed} failed`, { company_id, role_id });
  res.json({ message: `${succeeded} users created, ${failed} failed`, succeeded, failed, results });
}));

// ============================================================================
// POST /users - Create new user (Admin only)
// ============================================================================
// require_verification: true  → sends invite email, user must click to activate
//                      false → creates immediately with email+password (no email needed)
// ============================================================================
router.post(
  "/",
  [
    body("email").isEmail().normalizeEmail(),
    // Accept a single full_name OR explicit first_name/last_name (for the bulk
    // user CSV and any API caller). Required-ness is enforced in the handler.
    body("full_name").optional().trim(),
    body("first_name").optional().trim(),
    body("last_name").optional().trim(),
    body("role_id").optional({ nullable: true }).isUUID().withMessage('role_id must be a valid UUID'),
    body("company_id").isUUID().optional(),
    body("password").optional().isLength({ min: 8 }),
    body("require_verification").optional().isBoolean(),
    body("vicidial_agent_id").optional({ nullable: true }).trim(),
  ],
  asyncHandler(async (req, res) => {
    logger.debug('CREATE_USER', 'POST /users request received', { email: req.body.email, full_name: req.body.full_name, role_id: req.body.role_id, require_verification: req.body.require_verification });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('CREATE_USER', 'Validation failed', new Error(JSON.stringify(errors.array())));
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { email, role_id, company_id, password, require_verification } = req.body;
    // Optional VICIdial dialer agent id (maps dialer dispositions → this user).
    const { primary: vicidialAgentId, ids: vicidialAgentIds } = parseAgentIds(req.body.vicidial_agent_id);
    // Derive first/last from full_name when provided; fall back to explicit fields.
    let { first_name, last_name } = req.body.full_name
      ? splitFullName(req.body.full_name)
      : { first_name: (req.body.first_name || '').trim(), last_name: (req.body.last_name || '').trim() };
    if (!first_name) {
      return res.status(400).json({ error: "Full name is required" });
    }
    const needsVerification = require_verification === true || require_verification === 'true';
    const userId = req.user.id;
    const userCompanyId = company_id || req.user.company_id;

    logger.info('CREATE_USER', `Creating user in company`, { email, first_name, last_name, role_id, userCompanyId, password_provided: !!password, company_source: company_id ? 'admin-specified' : 'user-primary' });

    try {
      // Validate password if provided, otherwise will generate secure one
      let finalPassword = password;
      let passwordSource = 'auto-generated';

      if (password) {
        logger.debug('CREATE_USER', 'Validating admin-provided password');
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
          logger.error('CREATE_USER', 'Password validation failed', new Error(passwordValidation.error));
          return res.status(400).json({ error: passwordValidation.error });
        }
        passwordSource = 'admin-provided';
        logger.success('CREATE_USER', 'Password validation successful');
      } else {
        logger.debug('CREATE_USER', 'Generating secure password for user');
        finalPassword = generateSecurePassword();
        logger.success('CREATE_USER', 'Secure password generated');
      }

      // Check if user has permission to create users
      logger.debug('CREATE_USER', 'Checking permissions', { userId, userCompanyId });
      const hasPermissionT = await hasPermission(userId, userCompanyId, "create_user");
      logger.success('CREATE_USER', `Permission check result: ${hasPermissionT}, role: ${req.user.role}`);

      if (!hasPermissionT && req.user.role !== "superadmin") {
        logger.error('CREATE_USER', 'Permission denied', new Error('User does not have create_user permission'));
        return res.status(403).json({ error: "You don't have permission to create users" });
      }

      // Validate company assignment based on user role
      if (company_id) {
        logger.info('CREATE_USER', 'Validating company assignment', { user_role: req.user.role, requested_company_id: company_id, user_company_id: req.user.company_id });

        if (req.user.role !== 'superadmin' && company_id !== req.user.company_id) {
          logger.error('CREATE_USER', 'Permission denied - cannot assign to different company', new Error('Non-superadmin cannot assign to different company'));
          return res.status(403).json({ error: "Can only assign users to your own company" });
        }

        logger.success('CREATE_USER', 'Company assignment validated');
      }

      // Verify role exists and user can assign it (only if role_id provided)
      if (role_id) {
        logger.debug('CREATE_USER', 'Verifying role exists', { role_id });
        const { data: role, error: roleError } = await supabaseAdmin
          .from("custom_roles")
          .select("level")
          .eq("id", role_id)
          .single();

        if (roleError || !role) {
          logger.error('CREATE_USER', 'Role not found', roleError || new Error('No role data'));
          return res.status(400).json({ error: "Role not found" });
        }

        logger.success('CREATE_USER', `Role verified`, { role_id, level: role.level });

        logger.debug('CREATE_USER', 'Checking role hierarchy', { userId, userCompanyId, targetRoleLevel: role.level, isSuperAdmin: req.user.role === 'superadmin' });

        let canAssign = req.user.role === 'superadmin';
        if (!canAssign) {
          canAssign = await canAssignRole(userId, userCompanyId, role.level);
        }
        logger.success('CREATE_USER', `Hierarchy check: ${canAssign}`);

        if (!canAssign) {
          logger.error('CREATE_USER', 'Cannot assign role due to hierarchy', new Error('Role level too high'));
          return res.status(403).json({
            error: "Cannot assign role with same or higher authority than yours",
          });
        }

        // Validate role level is compatible with company type
        if (userCompanyId) {
          const { data: co } = await supabaseAdmin
            .from('companies').select('company_type').eq('id', userCompanyId).single();
          if (co?.company_type) {
            const allowed = getCompanyTypeLevels(co.company_type);
            if (!allowed.includes(role.level)) {
              return res.status(400).json({
                error: `Role level "${role.level}" is not valid for a ${co.company_type} company. Allowed levels: ${allowed.join(', ')}`,
              });
            }
          }
        }
      }

      // VICIdial agent id is UNIQUE per user — reject a duplicate up front so we
      // don't create an orphan auth user whose profile insert then fails.
      if (vicidialAgentIds.length) {
        const clash = await agentIdClash(vicidialAgentIds, null);
        if (clash) {
          return res.status(400).json({ error: `VICIdial Agent ID "${clash}" is already assigned to another user.` });
        }
      }

      // Create user in Supabase Auth
      // - require_verification=true  → invite email sent, user clicks link to activate
      // - require_verification=false → created immediately, password works right away
      logger.debug('CREATE_USER', 'Creating auth user in Supabase', { email, password_source: passwordSource, needsVerification });

      let authUser, authError;

      if (needsVerification) {
        // Invite flow: Supabase sends magic link — no password yet
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: { first_name, last_name },
        });
        authUser = data;
        authError = error;
        passwordSource = 'invite-sent';
      } else {
        // Direct create: immediately active, no email click required
        const { data, error } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: finalPassword,
          email_confirm: true,  // mark confirmed — no verification step
        });
        authUser = data;
        authError = error;
      }

      if (authError || !authUser?.user) {
        logger.error('CREATE_USER', 'Failed to create auth user', authError || new Error('No user data returned'));
        return res.status(400).json({ error: authError?.message || "Failed to create user" });
      }

      logger.success('CREATE_USER', `Auth user created`, { user_id: authUser.user.id, email, password_source: passwordSource, needsVerification });

      // Create user profile
      logger.debug('CREATE_USER', 'Creating user profile', { user_id: authUser.user.id });
      const baseProfile = { user_id: authUser.user.id, first_name, last_name, theme_preference: "light" };
      let profileResult = await supabaseAdmin.from("user_profiles").insert({
        ...baseProfile,
        ...(vicidialAgentId ? { vicidial_agent_id: vicidialAgentId, vicidial_agent_ids: vicidialAgentIds } : {}),
      });
      if (profileResult.error && /vicidial_agent_ids|column/i.test(profileResult.error.message || '')) {  // pre-111 fallback
        profileResult = await supabaseAdmin.from("user_profiles").insert({
          ...baseProfile,
          ...(vicidialAgentId ? { vicidial_agent_id: vicidialAgentId } : {}),
        });
      }

      logger.success('CREATE_USER', `User profile created`, { user_id: authUser.user.id });

      // Assign user to company with role (only if role_id provided)
      if (role_id && userCompanyId) {
        logger.debug('CREATE_USER', 'Assigning user to company', { user_id: authUser.user.id, company_id: userCompanyId, role_id });
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
          logger.error('CREATE_USER', 'Failed to assign user to company', assignError);
          return res.status(400).json({ error: assignError.message });
        }

        logger.success('CREATE_USER', `User created and assigned successfully`, { user_id: authUser.user.id, assignment_id: assignment.id, password_source: passwordSource });
      } else {
        logger.success('CREATE_USER', `User created without company assignment`, { user_id: authUser.user.id, password_source: passwordSource });
      }

      res.status(201).json({
        message: needsVerification
          ? `Invitation sent to ${email}. User must verify email before logging in.`
          : `User created successfully. They can log in immediately with the provided password.`,
        require_verification: needsVerification,
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
      logger.error('CREATE_USER', 'Unhandled exception', err);
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
    body("full_name").trim().optional(),
    body("first_name").trim().optional(),
    body("last_name").trim().optional(),
    body("role_id").isUUID().optional(),
    body("is_active").isBoolean().optional(),
    body("company_id").isUUID().optional(), // NOTE: For future reassignment - not implemented yet
    body("vicidial_agent_id").optional({ nullable: true }).trim(),
  ],
  asyncHandler(async (req, res) => {
    logger.debug('UPDATE_USER', 'PUT /users/:id request received', { id: req.params.id, body: req.body });
    // A single full_name overrides first/last for the profile update.
    if (req.body.full_name !== undefined && String(req.body.full_name).trim()) {
      const split = splitFullName(req.body.full_name);
      req.body.first_name = split.first_name;
      req.body.last_name  = split.last_name;
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('UPDATE_USER', 'Validation failed', new Error(JSON.stringify(errors.array())));
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id } = req.params;
    const { first_name, last_name, role_id, is_active, company_id } = req.body;
    // VICIdial dialer agent id — present key means "set it" (empty = clear).
    const hasAgentField = Object.prototype.hasOwnProperty.call(req.body, 'vicidial_agent_id');
    const agentParsed = hasAgentField ? parseAgentIds(req.body.vicidial_agent_id) : null;
    const vicidialAgentId  = hasAgentField ? agentParsed.primary : undefined;
    const vicidialAgentIds = hasAgentField ? agentParsed.ids : undefined;
    const userId = req.user.id;

    logger.info('UPDATE_USER', `Updating user`, { id, userId, updates: { first_name, last_name, role_id, is_active, company_id } });

    try {
      // Get the target user assignment
      logger.debug('UPDATE_USER', 'Fetching target user assignment', { id });
      const { data: targetAssignment, error: fetchError } = await supabaseAdmin
        .from("user_company_roles")
        .select("*, custom_roles(level)")
        .eq("id", id)
        .single();

      if (fetchError || !targetAssignment) {
        logger.error('UPDATE_USER', 'User assignment not found', fetchError || new Error('No data returned'));
        return res.status(404).json({ error: "User assignment not found" });
      }

      logger.success('UPDATE_USER', `Found user assignment`, { id, user_id: targetAssignment.user_id });

      // Hierarchy guard: cannot edit users with equal or higher authority (self-edit exempt)
      if (req.user.role !== 'superadmin' && userId !== targetAssignment.user_id) {
        const myLevel    = ROLE_HIERARCHY[req.user.role] ?? 999;
        const theirLevel = ROLE_HIERARCHY[targetAssignment.custom_roles?.level] ?? -1;
        if (theirLevel <= myLevel) {
          logger.error('UPDATE_USER', 'Hierarchy violation — target has equal or higher authority', new Error('Hierarchy check failed'));
          return res.status(403).json({ error: 'Cannot edit users with equal or higher authority than yours' });
        }
      }

      // Check permissions
      logger.debug('UPDATE_USER', 'Checking edit permissions', { userId, company_id: targetAssignment.company_id, isSuperAdmin: req.user.role === 'superadmin' });
      const hasEditPerm = await hasPermission(userId, targetAssignment.company_id, "edit_user");
      logger.success('UPDATE_USER', `Permission check: ${hasEditPerm}, isSuperAdmin: ${req.user.role === 'superadmin'}, isSelf: ${userId === targetAssignment.user_id}`);

      // Allow if: SuperAdmin OR has edit_user permission OR editing self
      if (req.user.role !== 'superadmin' && !hasEditPerm && userId !== targetAssignment.user_id) {
        logger.error('UPDATE_USER', 'Permission denied', new Error('User lacks edit_user permission and is not self'));
        return res.status(403).json({ error: "You don't have permission to edit this user" });
      }

      // If changing role, verify hierarchy
      if (role_id && role_id !== targetAssignment.role_id) {
        logger.debug('UPDATE_USER', 'Checking role change', { old_role_id: targetAssignment.role_id, new_role_id: role_id });
        const { data: newRole } = await supabaseAdmin
          .from("custom_roles")
          .select("level")
          .eq("id", role_id)
          .single();

        logger.debug('UPDATE_USER', 'Checking hierarchy for new role', { new_role_level: newRole?.level });
        let canAssign = req.user.role === 'superadmin'; // SuperAdmin can assign any role
        if (!canAssign) {
          canAssign = await canAssignRole(userId, targetAssignment.company_id, newRole.level);
        }
        logger.success('UPDATE_USER', `Hierarchy check for new role: ${canAssign}`);

        if (!canAssign) {
          logger.error('UPDATE_USER', 'Cannot assign new role due to hierarchy', new Error('Role level too high'));
          return res.status(403).json({ error: "Cannot assign this role" });
        }

        // Validate role level is compatible with company type
        const { data: co } = await supabaseAdmin
          .from('companies').select('company_type').eq('id', targetAssignment.company_id).single();
        if (co?.company_type && newRole?.level) {
          const allowed = getCompanyTypeLevels(co.company_type);
          if (!allowed.includes(newRole.level)) {
            return res.status(400).json({
              error: `Role level "${newRole.level}" is not valid for a ${co.company_type} company. Allowed levels: ${allowed.join(', ')}`,
            });
          }
        }
      }

      // VICIdial agent ids are UNIQUE — block reassigning one already held by someone else.
      if (hasAgentField && vicidialAgentIds.length) {
        const clash = await agentIdClash(vicidialAgentIds, targetAssignment.user_id);
        if (clash) {
          return res.status(400).json({ error: `VICIdial Agent ID "${clash}" is already assigned to another user.` });
        }
      }

      // Update user profile if provided (name and/or VICIdial agent id)
      const profileUpdate = {};
      if (first_name) profileUpdate.first_name = first_name;
      if (last_name)  profileUpdate.last_name  = last_name;
      if (hasAgentField) { profileUpdate.vicidial_agent_id = vicidialAgentId; profileUpdate.vicidial_agent_ids = vicidialAgentIds || []; }
      if (Object.keys(profileUpdate).length > 0) {
        logger.debug('UPDATE_USER', 'Updating user profile', { user_id: targetAssignment.user_id });
        profileUpdate.updated_at = new Date().toISOString();
        let { error: upErr } = await supabaseAdmin
          .from("user_profiles")
          .update(profileUpdate)
          .eq("user_id", targetAssignment.user_id);
        if (upErr && /vicidial_agent_ids|column/i.test(upErr.message || '')) {  // pre-111 fallback
          const { vicidial_agent_ids, ...rest } = profileUpdate;
          await supabaseAdmin.from("user_profiles").update(rest).eq("user_id", targetAssignment.user_id);
        }

        logger.success('UPDATE_USER', `User profile updated`);
      }

      // Update assignment
      const updateData = {};
      if (role_id) updateData.role_id = role_id;
      if (is_active !== undefined) updateData.is_active = is_active;
      if (company_id) updateData.company_id = company_id;

      if (Object.keys(updateData).length > 0) {
        logger.debug('UPDATE_USER', 'Updating user assignment', { id, updateData });
        await supabaseAdmin.from("user_company_roles").update(updateData).eq("id", id);
        logger.success('UPDATE_USER', `User assignment updated`, { updateData });
      } else {
        logger.info('UPDATE_USER', 'No assignment data to update');
      }

      logger.success('UPDATE_USER', `User updated successfully`, { id });
      res.json({ message: "User updated successfully" });
    } catch (err) {
      logger.error('UPDATE_USER', 'Unhandled exception', err);
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
    logger.debug('DELETE_USER', 'DELETE /users/:id request received', { id: req.params.id });

    const { id } = req.params;
    const userId = req.user.id;

    logger.info('DELETE_USER', `Deleting user`, { id, requestedBy: userId });

    try {
      // Get target user
      logger.debug('DELETE_USER', 'Fetching target user assignment', { id });
      const { data: target } = await supabaseAdmin
        .from("user_company_roles")
        .select("user_id, company_id, custom_roles(level)")
        .eq("id", id)
        .single();

      if (!target) {
        logger.error('DELETE_USER', 'User not found', new Error('No target data'));
        return res.status(404).json({ error: "User not found" });
      }

      logger.success('DELETE_USER', `Found target user`, { id, user_id: target.user_id, company_id: target.company_id });

      // Hierarchy guard: cannot delete users with equal or higher authority
      if (req.user.role !== 'superadmin') {
        const myLevel    = ROLE_HIERARCHY[req.user.role] ?? 999;
        const theirLevel = ROLE_HIERARCHY[target.custom_roles?.level] ?? -1;
        if (theirLevel <= myLevel) {
          logger.error('DELETE_USER', 'Hierarchy violation — cannot delete equal or higher authority user', new Error('Hierarchy check failed'));
          return res.status(403).json({ error: 'Cannot delete users with equal or higher authority than yours' });
        }
      }

      // Check permission
      logger.debug('DELETE_USER', 'Checking delete permissions', { userId, company_id: target.company_id, isSuperAdmin: req.user.role === 'superadmin' });
      const hasPerm = await hasPermission(userId, target.company_id, "delete_user");
      logger.success('DELETE_USER', `Permission check: ${hasPerm}, isSuperAdmin: ${req.user.role === 'superadmin'}`);

      if (req.user.role !== 'superadmin' && !hasPerm) {
        logger.error('DELETE_USER', 'Permission denied', new Error('User lacks delete_user permission'));
        return res.status(403).json({ error: "You don't have permission to delete users" });
      }

      // Delete from Supabase Auth (hard delete - allows email reuse)
      logger.debug('DELETE_USER', 'Deleting user from Supabase Auth', { user_id: target.user_id });
      try {
        await supabaseAdmin.auth.admin.deleteUser(target.user_id);
        logger.success('DELETE_USER', 'User deleted from Supabase Auth', { user_id: target.user_id });
      } catch (authDeleteError) {
        logger.warn('DELETE_USER', 'Failed to delete from Supabase Auth (may already be deleted)', { error: authDeleteError.message });
        // Don't fail the entire operation if auth deletion fails - continue with soft delete
      }

      // Soft delete in database - deactivate and keep for audit trail
      logger.debug('DELETE_USER', 'Soft deleting user in database by setting is_active=false', { id });
      await supabaseAdmin
        .from("user_company_roles")
        .update({ is_active: false })
        .eq("id", id);

      logger.success('DELETE_USER', `User deleted successfully`, { id, user_id: target.user_id, deleted_from_auth: true });
      res.json({ message: "User deleted successfully. Supabase Auth user removed - email is now available for reuse." });
    } catch (err) {
      logger.error('DELETE_USER', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// PUT /users/:id/password - Update user password
// ============================================================================
router.put(
  "/:id/password",
  [
    body("password").isLength({ min: 8 }),
  ],
  asyncHandler(async (req, res) => {
    logger.debug('UPDATE_PASSWORD', 'PUT /users/:id/password request received', { id: req.params.id });

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('UPDATE_PASSWORD', 'Validation failed', new Error(JSON.stringify(errors.array())));
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { id } = req.params;
    const { password } = req.body;
    const userId = req.user.id;

    logger.info('UPDATE_PASSWORD', `Updating user password`, { id, requestedBy: userId });

    try {
      // Validate password
      logger.debug('UPDATE_PASSWORD', 'Validating password');
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.valid) {
        logger.error('UPDATE_PASSWORD', 'Password validation failed', new Error(passwordValidation.error));
        return res.status(400).json({ error: passwordValidation.error });
      }
      logger.success('UPDATE_PASSWORD', 'Password validation successful');

      // Resolve target user. The :id can be EITHER a user_company_roles.id
      // (legacy callers, the normal case for company-scoped users) OR a
      // direct auth user_id (superadmin / readonly_admin / anyone without an
      // active company assignment). We try the assignment lookup first and
      // fall back to a direct auth.users lookup when no row is found so
      // superadmin can reset any user's password regardless of assignment.
      logger.debug('UPDATE_PASSWORD', 'Fetching target user', { id });
      let targetUserId = null;
      let targetCompanyId = null;
      const { data: target } = await supabaseAdmin
        .from("user_company_roles")
        .select("user_id, company_id")
        .eq("id", id)
        .maybeSingle();

      if (target?.user_id) {
        targetUserId = target.user_id;
        targetCompanyId = target.company_id;
        logger.success('UPDATE_PASSWORD', `Resolved via user_company_roles`, { id, user_id: targetUserId, company_id: targetCompanyId });
      } else if (req.user.role === 'superadmin') {
        // Superadmin may target a user directly by auth user_id (covers users
        // without an active assignment — superadmins, readonly_admins, or
        // anyone in soft-disabled state).
        try {
          const { data: auth } = await supabaseAdmin.auth.admin.getUserById(id);
          if (auth?.user?.id) {
            targetUserId = auth.user.id;
            logger.success('UPDATE_PASSWORD', `Resolved via auth.users (superadmin direct)`, { user_id: targetUserId });
          }
        } catch (e) { logger.warn('UPDATE_PASSWORD', `auth.users lookup failed: ${e.message}`); }
      }

      if (!targetUserId) {
        logger.error('UPDATE_PASSWORD', 'User not found', new Error('No assignment or auth user'));
        return res.status(404).json({ error: "User not found" });
      }

      // Prevent users from changing their own password via this endpoint
      if (userId === targetUserId) {
        logger.error('UPDATE_PASSWORD', 'User attempted to change their own password via admin endpoint', new Error('Cannot change own password'));
        return res.status(403).json({ error: "Use the profile password change form for your own password" });
      }

      // Permission: superadmin always allowed; otherwise needs edit_user on
      // the resolved company. If we resolved via direct auth lookup,
      // targetCompanyId is null — only superadmin can land here.
      logger.debug('UPDATE_PASSWORD', 'Checking edit permissions', { userId, company_id: targetCompanyId, isSuperAdmin: req.user.role === 'superadmin' });
      if (req.user.role !== 'superadmin') {
        const hasPerm = targetCompanyId
          ? await hasPermission(userId, targetCompanyId, "edit_user")
          : false;
        if (!hasPerm) {
          logger.error('UPDATE_PASSWORD', 'Permission denied', new Error('User lacks edit_user permission'));
          return res.status(403).json({ error: "You don't have permission to update user passwords" });
        }
      }

      // Update password in Supabase Auth
      logger.debug('UPDATE_PASSWORD', 'Updating password in Supabase Auth', { user_id: targetUserId });
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        targetUserId,
        { password }
      );

      if (updateError) {
        logger.error('UPDATE_PASSWORD', 'Failed to update password in Supabase Auth', updateError);
        return res.status(400).json({ error: updateError.message || "Failed to update password" });
      }

      logger.success('UPDATE_PASSWORD', `Password updated successfully`, { id, user_id: targetUserId });
      res.json({ message: "Password updated successfully" });
    } catch (err) {
      logger.error('UPDATE_PASSWORD', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// POST /users/:id/send-invite - Resend password reset email to a user
// ============================================================================
router.post(
  "/:id/send-invite",
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const requesterId = req.user.id;

    logger.info('SEND_INVITE', `Sending invite for assignment id=${id}`, { requestedBy: requesterId });

    try {
      // Fetch the user assignment to get user_id and company_id
      const { data: target, error: fetchError } = await supabaseAdmin
        .from("user_company_roles")
        .select("user_id, company_id")
        .eq("id", id)
        .single();

      if (fetchError || !target) {
        return res.status(404).json({ error: "User not found" });
      }

      // Permission check
      const hasPerm = await hasPermission(requesterId, target.company_id, "edit_user");
      if (req.user.role !== "superadmin" && !hasPerm) {
        return res.status(403).json({ error: "Permission denied" });
      }

      // Get user email from Supabase Auth
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.getUserById(target.user_id);
      if (authError || !authUser?.user?.email) {
        return res.status(400).json({ error: "Could not retrieve user email" });
      }

      // Send password reset email (acts as invite/welcome email)
      const { error: resetError } = await supabaseAdmin.auth.admin.generateLink({
        type: "recovery",
        email: authUser.user.email,
        options: {
          redirectTo: `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password`,
        },
      });

      if (resetError) {
        logger.error('SEND_INVITE', 'Failed to generate invite link', resetError);
        return res.status(500).json({ error: "Failed to send invite email" });
      }

      logger.success('SEND_INVITE', `Invite sent to ${authUser.user.email}`);
      res.json({ message: "Invite email sent successfully" });
    } catch (err) {
      logger.error('SEND_INVITE', 'Unhandled exception', err);
      res.status(500).json({ error: err.message });
    }
  })
);

// ============================================================================
// GET /users/:id/overrides — Get a user's permission overrides + role base perms
// ============================================================================
router.get('/:id/overrides', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: assignment } = await supabaseAdmin
    .from('user_company_roles')
    .select('user_id, company_id, role_id')
    .eq('id', id)
    .single();

  if (!assignment) return res.status(404).json({ error: 'User assignment not found' });

  const hasPerm = await hasPermission(req.user.id, assignment.company_id, 'edit_user');
  if (req.user.role !== 'superadmin' && !hasPerm) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  const [{ data: rolePerms }, { data: overrides }] = await Promise.all([
    supabaseAdmin
      .from('role_permissions')
      .select('permissions(name)')
      .eq('role_id', assignment.role_id),
    supabaseAdmin
      .from('user_permission_overrides')
      .select('override_type, permissions(id, name)')
      .eq('user_id', assignment.user_id)
      .eq('company_id', assignment.company_id),
  ]);

  res.json({
    role_permissions: (rolePerms || []).map(rp => rp.permissions?.name).filter(Boolean),
    overrides: (overrides || []).map(o => ({
      permission_id: o.permissions?.id,
      permission_name: o.permissions?.name,
      type: o.override_type,
    })),
  });
}));

// ============================================================================
// PUT /users/:id/overrides — Replace all permission overrides for a user
// Body: { overrides: [{ permission_name: string, type: 'grant'|'revoke' }] }
// ============================================================================
router.put('/:id/overrides',
  [body('overrides').isArray()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { id } = req.params;
    const { overrides } = req.body;

    const { data: assignment } = await supabaseAdmin
      .from('user_company_roles')
      .select('user_id, company_id')
      .eq('id', id)
      .single();

    if (!assignment) return res.status(404).json({ error: 'User assignment not found' });

    const hasPerm = await hasPermission(req.user.id, assignment.company_id, 'edit_user');
    if (req.user.role !== 'superadmin' && !hasPerm) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Clear existing overrides for this user+company
    await supabaseAdmin
      .from('user_permission_overrides')
      .delete()
      .eq('user_id', assignment.user_id)
      .eq('company_id', assignment.company_id);

    if (!overrides?.length) return res.json({ message: 'Overrides cleared', count: 0 });

    // Resolve permission names to IDs
    const permNames = [...new Set(overrides.map(o => o.permission_name))];
    const { data: perms } = await supabaseAdmin.from('permissions').select('id, name').in('name', permNames);
    const permMap = Object.fromEntries((perms || []).map(p => [p.name, p.id]));

    const insertRows = overrides
      .filter(o => permMap[o.permission_name] && ['grant', 'revoke'].includes(o.type))
      .map(o => ({
        user_id: assignment.user_id,
        company_id: assignment.company_id,
        permission_id: permMap[o.permission_name],
        override_type: o.type,
        set_by: req.user.id,
      }));

    if (insertRows.length) {
      await supabaseAdmin.from('user_permission_overrides').insert(insertRows);
    }

    logger.info('USER_OVERRIDES', `Saved ${insertRows.length} overrides for user ${assignment.user_id}`);
    res.json({ message: 'Overrides saved', count: insertRows.length });
  })
);

// ============================================================================
// GET /users/:id/feature-overrides — per-user feature toggles for one user
// (:id = user_company_roles.id). Returns the catalog, the company-effective
// state, and this user's overrides so the editor can show 3-state per feature.
// ============================================================================
router.get('/:id/feature-overrides', asyncHandler(async (req, res) => {
  const { data: a } = await supabaseAdmin
    .from('user_company_roles').select('user_id, company_id').eq('id', req.params.id).single();
  if (!a) return res.status(404).json({ error: 'User assignment not found' });

  const hasPerm = await hasPermission(req.user.id, a.company_id, 'edit_user');
  if (req.user.role !== 'superadmin' && !hasPerm) return res.status(403).json({ error: 'Permission denied' });

  const [{ data: catalog }, { data: companyOv }, { data: userOv }] = await Promise.all([
    supabaseAdmin.from('feature_flags').select('key, label, description, category, default_enabled, sort_order').order('sort_order'),
    supabaseAdmin.from('company_feature_flags').select('feature_key, is_enabled').eq('company_id', a.company_id),
    supabaseAdmin.from('user_feature_flags').select('feature_key, is_enabled').eq('user_id', a.user_id).eq('company_id', a.company_id),
  ]);

  const coMap = {}; (companyOv || []).forEach(o => { coMap[o.feature_key] = o.is_enabled; });
  const company_effective = {};
  (catalog || []).forEach(f => { company_effective[f.key] = coMap[f.key] !== undefined ? coMap[f.key] : f.default_enabled; });
  const user_overrides = {}; (userOv || []).forEach(o => { user_overrides[o.feature_key] = o.is_enabled; });

  res.json({ catalog: catalog || [], company_effective, user_overrides });
}));

// ============================================================================
// PUT /users/:id/feature-overrides — replace this user's feature overrides
// Body: { overrides: [{ feature_key, is_enabled: bool }] }  (omit = inherit)
// ============================================================================
router.put('/:id/feature-overrides',
  [body('overrides').isArray()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errors.array() });

    const { data: a } = await supabaseAdmin
      .from('user_company_roles').select('user_id, company_id').eq('id', req.params.id).single();
    if (!a) return res.status(404).json({ error: 'User assignment not found' });

    const hasPerm = await hasPermission(req.user.id, a.company_id, 'edit_user');
    if (req.user.role !== 'superadmin' && !hasPerm) return res.status(403).json({ error: 'Permission denied' });

    await supabaseAdmin.from('user_feature_flags')
      .delete().eq('user_id', a.user_id).eq('company_id', a.company_id);

    const rows = (req.body.overrides || [])
      .filter(o => o.feature_key && typeof o.is_enabled === 'boolean')
      .map(o => ({ user_id: a.user_id, company_id: a.company_id, feature_key: o.feature_key, is_enabled: o.is_enabled, set_by: req.user.id }));
    if (rows.length) await supabaseAdmin.from('user_feature_flags').insert(rows);

    logger.info('USER_FEATURE_OVERRIDES', `Saved ${rows.length} feature overrides for user ${a.user_id}`);
    res.json({ message: 'Feature overrides saved', count: rows.length });
  })
);

// ============================================================================
// POST /users/:userId/impersonate — superadmin only
// Generates a one-time magic link for any user; link is returned to the caller
// (never sent by email) so the superadmin can open it directly in a browser.
// ============================================================================
router.post('/:userId/impersonate', asyncHandler(async (req, res) => {
  const callerId = req.user.id;
  const { userId } = req.params;

  const sa = await isSuperAdmin(callerId);
  if (!sa) return res.status(403).json({ error: 'Superadmin access required' });

  const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (authErr || !authUser?.user) return res.status(404).json({ error: 'User not found' });

  const email = authUser.user.email;
  if (!email) return res.status(400).json({ error: 'User has no email address' });

  const frontendUrl = (process.env.FRONTEND_URL || 'https://crm.vertexpakistan.com').replace(/\/$/, '');
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${frontendUrl}/impersonate-callback` },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    return res.status(500).json({ error: linkErr?.message || 'Failed to generate login link' });
  }

  logger.info('IMPERSONATE', `Superadmin ${callerId} generated login link for user ${userId} (${email})`);
  res.json({ link: linkData.properties.action_link, email });
}));

module.exports = router;
