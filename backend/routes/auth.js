const express = require('express');
const { body, validationResult } = require('express-validator');
const { supabaseAdmin, supabaseClient } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { authMiddleware, requireRole } = require('../middleware/authMiddleware');

const router = express.Router();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

// ============================================================================
// GET /auth/me — Returns fresh role + permissions for the logged-in user.
// Called by frontend on app load to keep role/permissions in sync with DB.
// ============================================================================
router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  const userId = req.user.id;

  // SUPERADMIN check FIRST — authMiddleware already resolved role for token-based requests.
  // Trust it: if middleware set role=superadmin, honor it here too.
  if (req.user.role === 'superadmin') {
    const [{ data: allPerms }, { data: profile }] = await Promise.all([
      supabaseAdmin.from('permissions').select('name'),
      supabaseAdmin.from('user_profiles').select('first_name, last_name').eq('user_id', userId).single(),
    ]);
    return res.json({
      id: userId,
      email: req.user.email,
      role: 'superadmin',
      role_name: 'Super Admin',
      company_id: null,
      company_name: null,
      first_name: profile?.first_name,
      last_name: profile?.last_name,
      permissions: (allPerms || []).map(p => p.name),
    });
  }

  const [{ data: userRoles }, { data: profile }] = await Promise.all([
    supabaseAdmin
      .from('user_company_roles')
      .select('role_id, company_id, custom_roles(id, name, level), companies(name)')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1),
    supabaseAdmin
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('user_id', userId)
      .single(),
  ]);

  if (!userRoles?.length) {
    return res.status(401).json({ error: 'No active company assignment' });
  }

  const ur = userRoles[0];
  const roleLevel = ur.custom_roles.level;

  let userPermissions;
  if (roleLevel === 'superadmin') {
    const { data: allPerms } = await supabaseAdmin.from('permissions').select('name');
    userPermissions = (allPerms || []).map(p => p.name);
  } else {
    const { data: perms } = await supabaseAdmin
      .from('role_permissions')
      .select('permissions(name)')
      .eq('role_id', ur.role_id);
    userPermissions = (perms || []).map(p => p.permissions.name);

    // Apply per-user permission overrides (grant extra / revoke existing)
    const { data: overrides } = await supabaseAdmin
      .from('user_permission_overrides')
      .select('override_type, permissions(name)')
      .eq('user_id', userId)
      .eq('company_id', ur.company_id);
    for (const ov of (overrides || [])) {
      const name = ov.permissions?.name;
      if (!name) continue;
      if (ov.override_type === 'grant' && !userPermissions.includes(name)) userPermissions.push(name);
      if (ov.override_type === 'revoke') userPermissions = userPermissions.filter(p => p !== name);
    }
  }

  res.json({
    id: userId,
    email: req.user.email,
    role: roleLevel,
    role_name: ur.custom_roles.name,
    company_id: ur.company_id,
    company_name: ur.companies?.name,
    first_name: profile?.first_name,
    last_name: profile?.last_name,
    permissions: userPermissions,
  });
}));

// ============================================================================
// POST /auth/login - Login with email and password
// ============================================================================
router.post(
  "/login",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 6 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { email, password } = req.body;

    try {
      // Authenticate with Supabase
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.user) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // SUPERADMIN check FIRST — env-level superadmins bypass company role lookup.
      // Case-insensitive + check app_metadata.role (set by startup sync).
      const superadminEmails = (process.env.SUPERADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
      const loginEmail = (data.user.email || '').toLowerCase();
      if (data.user.app_metadata?.role === 'superadmin' || superadminEmails.includes(loginEmail)) {
        const [{ data: allPerms }, { data: saProfile }] = await Promise.all([
          supabaseAdmin.from('permissions').select('name'),
          supabaseAdmin.from('user_profiles').select('first_name, last_name').eq('user_id', data.user.id).single(),
        ]);
        return res.json({
          token: data.session.access_token,
          user: {
            id: data.user.id,
            email: data.user.email,
            role: 'superadmin',
            role_name: 'Super Admin',
            company_id: null,
            company_name: null,
            first_name: saProfile?.first_name,
            last_name: saProfile?.last_name,
            permissions: (allPerms || []).map(p => p.name),
          },
        });
      }

      // Get user's role and company info
      const { data: userRoles, error: roleError } = await supabaseAdmin
        .from("user_company_roles")
        .select(
          `
          id,
          role_id,
          company_id,
          custom_roles (id, name, level),
          companies (name)
        `
        )
        .eq("user_id", data.user.id)
        .eq("is_active", true)
        .limit(1);

      // Get user profile (needed in both branches)
      const { data: profile } = await supabaseAdmin
        .from("user_profiles")
        .select("*")
        .eq("user_id", data.user.id)
        .single();

      if (roleError || !userRoles || userRoles.length === 0) {
        return res.status(401).json({ error: "User not assigned to any company" });
      }

      const userRole = userRoles[0];
      const roleData = userRole.custom_roles;
      const companyData = userRole.companies;

      // Get user permissions
      const { data: permissions } = await supabaseAdmin
        .from("role_permissions")
        .select("permissions(name)")
        .eq("role_id", userRole.role_id);

      const permSet = new Set((permissions || []).map((p) => p.permissions.name));

      // Apply per-user permission overrides (same logic as /auth/me)
      const { data: overrides } = await supabaseAdmin
        .from('user_permission_overrides')
        .select('override_type, permissions(name)')
        .eq('user_id', data.user.id)
        .eq('company_id', userRole.company_id);
      for (const ov of (overrides || [])) {
        const name = ov.permissions?.name;
        if (!name) continue;
        if (ov.override_type === 'grant')  permSet.add(name);
        if (ov.override_type === 'revoke') permSet.delete(name);
      }
      const userPermissions = [...permSet];

      // Return user data and token
      res.json({
        token: data.session.access_token,
        user: {
          id: data.user.id,
          email: data.user.email,
          role: roleData.level,
          role_name: roleData.name,
          company_id: userRole.company_id,
          company_name: companyData.name,
          first_name: profile?.first_name,
          last_name: profile?.last_name,
          permissions: userPermissions,
        },
      });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Login failed", details: err.message });
    }
  })
);

// ============================================================================
// POST /auth/signup - Sign up new user (with invitation code)
// ============================================================================
router.post(
  "/signup",
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 6 }),
    body("first_name").trim().isLength({ min: 1 }),
    body("last_name").trim().isLength({ min: 1 }),
    body("invitation_code").trim(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { email, password, first_name, last_name, invitation_code } = req.body;

    try {
      // For now, we'll skip invitation code validation (backend should issue codes)
      // This is a simplified signup - in production, validate the code

      // Create user in Supabase Auth
      const { data, error: signupError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
      });

      if (signupError || !data.user) {
        return res.status(400).json({
          error: signupError?.message || "Failed to create user",
        });
      }

      // Create user profile
      const { error: profileError } = await supabaseAdmin
        .from("user_profiles")
        .insert({
          user_id: data.user.id,
          first_name,
          last_name,
          theme_preference: "light",
        });

      if (profileError) {
        console.error("Failed to create profile:", profileError);
      }

      res.status(201).json({
        message: "Signup successful. Please check your email to confirm.",
        user_id: data.user.id,
      });
    } catch (err) {
      console.error("Signup error:", err);
      res.status(500).json({ error: "Signup failed", details: err.message });
    }
  })
);

// ============================================================================
// PUT /auth/me/profile — Update own first_name / last_name
// ============================================================================
router.put('/me/profile', authMiddleware, [
  body('first_name').trim().isLength({ min: 1 }).optional(),
  body('last_name').trim().isLength({ min: 1 }).optional(),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { first_name, last_name } = req.body;
  const userId = req.user.id;

  const updates = {};
  if (first_name !== undefined) updates.first_name = first_name;
  if (last_name  !== undefined) updates.last_name  = last_name;

  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

  // Upsert profile row (in case it doesn't exist yet)
  const { error } = await supabaseAdmin
    .from('user_profiles')
    .upsert({ user_id: userId, ...updates }, { onConflict: 'user_id' });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Profile updated', first_name, last_name });
}));

// ============================================================================
// PUT /auth/me/password — Change own password (requires current_password)
// ============================================================================
router.put('/me/password', authMiddleware, [
  body('current_password').isLength({ min: 6 }),
  body('new_password').isLength({ min: 8 }),
], asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ error: 'Validation failed', details: errs.array() });

  const { current_password, new_password } = req.body;
  const email = req.user.email;

  // Verify current password by attempting sign-in
  const { error: signInErr } = await supabaseClient.auth.signInWithPassword({ email, password: current_password });
  if (signInErr) return res.status(400).json({ error: 'Current password is incorrect' });

  // Update password
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, { password: new_password });
  if (updateErr) return res.status(400).json({ error: updateErr.message });

  res.json({ message: 'Password updated successfully' });
}));

// ============================================================================
// POST /auth/logout - Logout (frontend handles token removal)
// ============================================================================
router.post("/logout", (req, res) => {
  // Token is removed on frontend localStorage
  res.json({ message: "Logged out successfully" });
});

// ============================================================================
// POST /auth/refresh - Refresh access token
// ============================================================================
router.post(
  "/refresh",
  [body("refresh_token").trim()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed" });
    }

    const { refresh_token } = req.body;

    try {
      const { data, error } = await supabaseClient.auth.refreshSession({
        refresh_token,
      });

      if (error || !data.session) {
        return res.status(401).json({ error: "Failed to refresh session" });
      }

      res.json({
        token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
    } catch (err) {
      res.status(500).json({ error: "Token refresh failed" });
    }
  })
);

// ============================================================================
// POST /auth/invite - Send invitation email (SuperAdmin/CompanyAdmin only)
// ============================================================================
router.post(
  "/invite",
  authMiddleware,
  requireRole(['superadmin', 'company_admin']),
  [
    body("email").isEmail().normalizeEmail(),
    body("company_id").isUUID(),
    body("role_id").isUUID(),
    body("first_name").trim().optional(),
    body("last_name").trim().optional(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { email, company_id, role_id, first_name, last_name } = req.body;

    try {
      // Create user via Supabase invite (sends email automatically)
      const { data, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invite`,
        data: { first_name, last_name },
      });

      if (inviteError) {
        return res.status(400).json({ error: inviteError.message });
      }

      const userId = data.user.id;

      // Create user profile
      await supabaseAdmin.from("user_profiles").upsert({
        user_id: userId,
        first_name: first_name || "",
        last_name: last_name || "",
        theme_preference: "light",
      });

      // Assign user to company with role
      await supabaseAdmin.from("user_company_roles").insert({
        user_id: userId,
        company_id,
        role_id,
        is_active: true,
      });

      res.status(201).json({
        message: "Invitation sent successfully",
        user_id: userId,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to send invitation", details: err.message });
    }
  })
);

// ============================================================================
// POST /auth/verify-email - Verify email token
// ============================================================================
router.post(
  "/verify-email",
  [body("token").trim()],
  asyncHandler(async (req, res) => {
    const { token } = req.body;

    try {
      const { data, error } = await supabaseClient.auth.verifyOtp({
        token_hash: token,
        type: "email",
      });

      if (error) {
        return res.status(400).json({ error: "Invalid or expired token" });
      }

      res.json({
        message: "Email verified successfully",
        user_id: data.user?.id,
      });
    } catch (err) {
      res.status(500).json({ error: "Email verification failed" });
    }
  })
);

// ============================================================================
// POST /auth/forgot-password - Request password reset
// ============================================================================
router.post(
  "/forgot-password",
  [body("email").isEmail().normalizeEmail()],
  asyncHandler(async (req, res) => {
    const { email } = req.body;

    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password`,
      });

      if (error) {
        console.error("Password reset error:", error);
      }

      // Always return success for security
      res.json({ message: "If email exists, password reset link has been sent" });
    } catch (err) {
      res.json({ message: "If email exists, password reset link has been sent" });
    }
  })
);

// ============================================================================
// POST /auth/reset-password - Confirm password reset
// ============================================================================
router.post(
  "/reset-password",
  [body("token_hash").trim().notEmpty(), body("new_password").isLength({ min: 6 })],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: "Validation failed", details: errors.array() });
    }

    const { token_hash, new_password } = req.body;

    try {
      // Step 1: Verify the OTP token to get the user identity
      const { data: otpData, error: otpError } = await supabaseClient.auth.verifyOtp({
        token_hash,
        type: "recovery",
      });

      if (otpError || !otpData?.user) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
      }

      // Step 2: Update password using admin API (bypasses session requirement)
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
        otpData.user.id,
        { password: new_password }
      );

      if (updateError) {
        return res.status(400).json({ error: "Failed to update password" });
      }

      res.json({ message: "Password reset successfully" });
    } catch (err) {
      res.status(500).json({ error: "Password reset failed" });
    }
  })
);

module.exports = router;
