const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: '.env.local' });

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/authMiddleware');
const { readonlyGuard } = require('./middleware/readonlyGuard');
const { readonlyDataGuard } = require('./middleware/readonlyDataGuard');
const { geoGate } = require('./middleware/geoGate');

// Import routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const readonlyAdminsRoutes = require('./routes/readonlyAdmins');
const activityBeaconRoutes = require('./routes/activityBeacon');
const teamsRoutes = require('./routes/teams');
const quotasRoutes = require('./routes/quotas');
const companiesRoutes = require('./routes/companies');
const rolesRoutes = require('./routes/roles');
const formsRoutes = require('./routes/forms');
const transfersRoutes = require('./routes/transfers');
const salesRoutes = require('./routes/sales');
const payoutsRoutes = require('./routes/payouts');
const statsRoutes = require('./routes/stats');
const notificationsRoutes = require('./routes/notifications');
const saleConfigsRoutes   = require('./routes/sale-configs');
const callbacksRoutes     = require('./routes/callbacks');
const paymentRemindersRoutes = require('./routes/paymentReminders');
const pushRoutes          = require('./routes/push');
const reviewsRoutes       = require('./routes/reviews');
const callbackNumbersRoutes   = require('./routes/callbackNumbers');
const featureFlagsRoutes      = require('./routes/featureFlags');
const businessConfigRoutes    = require('./routes/businessConfig');
const complianceRoutes        = require('./routes/compliance');
const auditRoutes             = require('./routes/audit');
const userPreferencesRoutes   = require('./routes/userPreferences');
const activityLogsRoutes      = require('./routes/activityLogs');
const leadIntelligenceRoutes    = require('./routes/leadIntelligence');
const dispositionConfigsRoutes  = require('./routes/dispositionConfigs');
const zipcodeRoutes             = require('./routes/zipcode');
const blacklistRoutes           = require('./routes/blacklist');
const cardValidatorRoutes       = require('./routes/cardValidator');
const faqsRoutes                = require('./routes/faqs');
const scriptsRoutes             = require('./routes/scripts');
const callChecklistRoutes       = require('./routes/callChecklist');
const uploadsRoutes             = require('./routes/uploads');
const saleUploadsRoutes         = require('./routes/saleUploads');
const announcementsRoutes       = require('./routes/announcements');
const marqueeRoutes             = require('./routes/marquee');
const spiffRoutes               = require('./routes/spiff');
const dataAnalyzerRoutes        = require('./routes/dataAnalyzer');
const distributionBatchesRoutes = require('./routes/distributionBatches');
const noteShortcodesRoutes      = require('./routes/noteShortcodes');
const dataCleanupRoutes         = require('./routes/dataCleanup');
const { ingest: vicidialIngest, api: vicidialApi } = require('./routes/vicidial');
const vehiclesRoutes            = require('./routes/vehicles');
const chatRoutes                = require('./routes/chat');
const chatAdminRoutes           = require('./routes/chatAdmin');
const emailRoutes               = require('./routes/emails');
const guestChatRoutes           = require('./routes/guestChat');
const portalRoutes              = require('./routes/portal');
const presenceRoutes            = require('./routes/presence');
const eventsRoutes              = require('./routes/events');
const searchRoutes              = require('./routes/search');
const customerProfileRoutes     = require('./routes/customerProfile');
const egressRoutes              = require('./routes/egress');
const qaRoutes                  = require('./routes/qa');
const qaMediaRoutes             = require('./routes/qaMedia');
const qa2Routes                 = require('./routes/qa2');
const { qa2IngestHook }         = require('./middleware/qa2VicidialIngestHook');
const qa1ReadonlyGate           = require('./middleware/qa1ReadonlyGate');
const kanbanRoutes              = require('./routes/kanban');
const quizRoutes                = require('./routes/quiz');
const { egressAudit }           = require('./middleware/egressAudit');
const { requireFeature }        = require('./utils/featureGate');
const { startCallbackScheduler } = require('./utils/callbackScheduler');
const { startBackgroundJobs } = require('./utils/scheduler');
const { startAutoFetchDispo } = require('./utils/autoFetchDispo');
const { supabaseAdmin: _saForSync } = require('./config/database');

// On startup: RECONCILE app_metadata.role='superadmin' against SUPERADMIN_EMAIL.
// Once set, the Supabase JWT carries it — no env-var dependency per-request.
//
// This is a two-way sync (add AND remove). Stamping alone (the old behavior)
// left a demoted account stuck as superadmin forever: removing its email from
// the env never cleared the baked-in stamp, and syncReadonlyAdminMetadata
// refuses to downgrade a superadmin-stamped user — so the account could never
// become readonly_admin. Now: emails in the list get stamped; any account that
// STILL carries a superadmin stamp but is no longer in the list is demoted —
// straight to readonly_admin if it's in READONLY_ADMIN_EMAIL, else cleared so
// its role re-derives from user_company_roles.
//
// Safety: if SUPERADMIN_EMAIL is empty (missing/misconfigured deploy) we do
// nothing — never mass-clear superadmins on an accidental env drop.
async function syncSuperadminMetadata() {
  const emails = (process.env.SUPERADMIN_EMAIL || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return;
  const roEmails = new Set(
    (process.env.READONLY_ADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  );
  try {
    const { data } = await _saForSync.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data?.users || [])) {
      const e = (u.email || '').toLowerCase();
      const stamped = u.app_metadata?.role;
      if (emails.includes(e)) {
        if (stamped !== 'superadmin') {
          await _saForSync.auth.admin.updateUserById(u.id, {
            app_metadata: { ...u.app_metadata, role: 'superadmin' },
          });
          console.log(`[SUPERADMIN] Stamped app_metadata.role=superadmin for ${u.email}`);
        }
      } else if (stamped === 'superadmin') {
        // Stale superadmin — no longer in the env roster. Demote.
        const newRole = roEmails.has(e) ? 'readonly_admin' : null;
        await _saForSync.auth.admin.updateUserById(u.id, {
          app_metadata: { ...u.app_metadata, role: newRole },
        });
        console.log(`[SUPERADMIN] Cleared stale superadmin stamp for ${u.email} → ${newRole || 'none'}`);
      }
    }
  } catch (err) {
    console.error('[SUPERADMIN] Metadata sync failed:', err.message);
  }
}

// Mirror sync for READONLY_ADMIN_EMAIL. Same JWT-stamp pattern — listed
// users get app_metadata.role='readonly_admin' so the auth middleware can
// recognize them without DB lookup. Existing superadmins are NEVER
// downgraded by this sync; if an email is in BOTH lists, superadmin wins.
async function syncReadonlyAdminMetadata() {
  const emails = (process.env.READONLY_ADMIN_EMAIL || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return;
  const saEmails = new Set(
    (process.env.SUPERADMIN_EMAIL || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  );
  try {
    const { data } = await _saForSync.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data?.users || [])) {
      const e = (u.email || '').toLowerCase();
      if (!emails.includes(e)) continue;
      if (saEmails.has(e) || u.app_metadata?.role === 'superadmin') continue; // never downgrade
      if (u.app_metadata?.role !== 'readonly_admin') {
        await _saForSync.auth.admin.updateUserById(u.id, {
          app_metadata: { ...u.app_metadata, role: 'readonly_admin' },
        });
        console.log(`[READONLY_ADMIN] Stamped app_metadata.role=readonly_admin for ${u.email}`);
      }
    }
  } catch (err) {
    console.error('[READONLY_ADMIN] Metadata sync failed:', err.message);
  }
}

// Placeholder display name from an email local part: letters only, title-cased.
// Mirrors the SQL in migration 220 exactly (initcap over a digit-stripped local
// part) so the backfill and this bootstrap can never disagree on a name.
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0].replace(/[^a-zA-Z]+/g, '');
  if (!local) return 'Admin';
  return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
}

// Env-bootstrapped superadmins are created by stamping app_metadata and NOTHING
// else — they never got a user_profiles row. That row, not a blank name field,
// is why they render as 'Unknown' / '(unnamed)' / a raw email everywhere: some
// ~200 read sites across the backend resolve a display name by joining
// user_profiles and falling back. Two of them fail outright rather than
// cosmetically — POST /emails/send rejects a recipient with no profile row
// ("Unknown recipient(s)"), and chatService.searchDirectory scans that table,
// so a superadmin was neither mailable nor findable in chat.
//
// Runs AFTER both metadata syncs (chained below, not fire-and-forget) so an
// account stamped on this very boot is already visible to the role filter here.
// Migration 220 does the same backfill in SQL for the existing rows; this hook
// is the durable half — it covers a fresh project and any email ADDED to
// SUPERADMIN_EMAIL later, which a one-time migration cannot.
//
// portal_client accounts are excluded deliberately. Those are external
// client-recording-portal logins (migration 116); the chat directory and the
// mail recipient picker are both driven by user_profiles, so giving one a row
// would make an outside client searchable and mailable by staff.
async function ensureAdminProfiles() {
  const envAdmins = new Set(
    [...(process.env.SUPERADMIN_EMAIL || '').split(','), ...(process.env.READONLY_ADMIN_EMAIL || '').split(',')]
      .map(e => e.trim().toLowerCase()).filter(Boolean)
  );
  try {
    const { data } = await _saForSync.auth.admin.listUsers({ perPage: 1000 });
    const admins = (data?.users || []).filter(u => {
      if (u.app_metadata?.portal_client) return false;         // external client — never
      const role = u.app_metadata?.role;
      return role === 'superadmin' || role === 'readonly_admin' || envAdmins.has((u.email || '').toLowerCase());
    });
    if (!admins.length) return;

    const { data: existing } = await _saForSync
      .from('user_profiles').select('user_id').in('user_id', admins.map(u => u.id));
    const have = new Set((existing || []).map(r => r.user_id));
    const missing = admins.filter(u => !have.has(u.id));
    if (!missing.length) return;

    // Prefer a name the account was actually invited with; fall back to the email.
    const rows = missing.map(u => ({
      user_id:    u.id,
      first_name: String(u.user_metadata?.first_name || '').trim() || nameFromEmail(u.email),
      last_name:  String(u.user_metadata?.last_name || '').trim() || null,
    }));
    const { error } = await _saForSync.from('user_profiles').upsert(rows, { onConflict: 'user_id' });
    if (error) throw error;
    console.log(`[ADMIN_PROFILE] Created ${rows.length} missing admin profile row(s): ${missing.map(u => u.email).join(', ')}`);
  } catch (err) {
    console.error('[ADMIN_PROFILE] Profile bootstrap failed:', err.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc:      ["'self'", "data:", "blob:", "https:"],
      mediaSrc:    ["'self'", "blob:"],   // client portal plays proxied recordings as blob: audio
      fontSrc:     ["'self'", "data:", "https://fonts.gstatic.com"],
      connectSrc:  [
        "'self'",
        "https://*.supabase.co",
        "wss://*.supabase.co",
        process.env.CORS_ORIGIN || "http://localhost:5173",
      ],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
}));

// Chat attachment uploads carry a base64-encoded file (≤10MB binary ≈ 13.3MB
// encoded) — give this one route a larger JSON limit before the global parser
// below claims the body. Registered first so it wins for this path.
app.use('/api/chat/upload', express.json({ limit: '16mb' }));
// Email attachments use the same base64 upload flow — same raised limit.
app.use('/api/emails/upload', express.json({ limit: '16mb' }));
// Kanban image attachments (+ annotations) are base64 data URLs — raised limit.
app.use('/api/kanban', express.json({ limit: '14mb' }));
// Batch uploads post parsed spreadsheet rows (the browser does the parsing).
// The client chunks them so no single request is large, but a wide file — 40
// columns kept verbatim per row — still outgrows the global limit.
app.use('/api/distribution-batches', express.json({ limit: '16mb' }));

// Body parser — raised from the 100kb default so announcements (and other
// payloads) can carry embedded base64 images.
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

// CORS
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
};
app.use(cors(corsOptions));

// Rate limiting
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  // Key on email so hundreds of users sharing one NAT/IP each get their own bucket.
  // Falls back to IP if body isn't parsed yet or email is missing.
  keyGenerator: (req) => (req.body?.email || '').toLowerCase().trim() || req.ip,
  message: { error: 'Too many login attempts, try again later' },
  skipSuccessfulRequests: true,
}));
app.use('/api/auth/forgot-password', rateLimit({ windowMs: 60 * 60 * 1000, max: 5,   message: { error: 'Too many requests, try again later' } }));
// Raised to 200/hr: admins may batch-invite many users during onboarding.
app.use('/api/auth/invite',          rateLimit({ windowMs: 60 * 60 * 1000, max: 200, message: { error: 'Too many invite requests' } }));

// General API limiter — keyed by user ID extracted from the Bearer JWT payload
// (no signature verification needed here; actual auth still runs on all routes).
// This gives each authenticated user their own per-user bucket instead of
// sharing one IP-based bucket across all users behind a corporate NAT/proxy.
// 1000/15min was too tight for an active session: app polling (notifications,
// stats) + chat (list/message polls, presence, read receipts, conversation
// switches) added up and 429'd real users mid-chat. 4000/15min (~4.4 req/s
// sustained, per authenticated user) gives comfortable headroom while still
// bounding abuse — auth is still required on every route.
const userIdFromToken = (req) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const payload = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString());
      if (payload.sub) return `uid:${payload.sub}`;
    } catch { /* fall through to IP */ }
  }
  return req.ip;
};
// Machine-to-machine VICIdial ingest (fronter-xfer / closer-dispo / dispo-debug)
// has no JWT, so it would all collapse into one IP bucket and 429 real
// dispositions at dialer volume. They're already guarded by the ingest token —
// give them their own generous limiter and exempt them from the per-user one.
const isVicidialIngest = (req) =>
  /\/api\/vicidial\/(fronter-xfer|closer-dispo|dispo-debug)\b/.test(req.originalUrl || req.url || '');

app.use(['/api/vicidial/fronter-xfer', '/api/vicidial/closer-dispo', '/api/vicidial/dispo-debug'],
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20000, message: { error: 'Too many requests' } }));

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 4000,
  keyGenerator: userIdFromToken,
  skip: isVicidialIngest,
  message: { error: 'Too many requests' },
}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// STATIC FILES - Serve frontend from dist (single-service Nixpacks)
// ============================================================================
const path = require('path');
const { renderIndex } = require('./utils/htmlBranding');
const { loadBranding } = require('./routes/branding');
const frontendDistPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath, {
  maxAge: '1y',
  immutable: true,
  // Don't auto-serve index.html for '/', so the request falls through to the
  // SPA fallback below where branding/OG meta is injected (link previews).
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('index.html') || filePath.endsWith('version.json')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

// ============================================================================
// HEALTH CHECK (no auth required)
// ============================================================================

// started_at is the question this endpoint kept failing to answer. The backend
// has no hot reload, so a push that is not followed by a restart leaves the old
// code serving — and from the outside that is indistinguishable from a fix that
// did not work. Comparing started_at against the time of a commit settles it in
// one request instead of a round of re-diagnosis.
const STARTED_AT = new Date().toISOString();

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    started_at: STARTED_AT,
    uptime_seconds: Math.round(process.uptime()),
    // Set by the deploy if it can; absent is fine, started_at is the useful bit.
    commit: process.env.GIT_COMMIT || process.env.SOURCE_COMMIT || null,
  });
});

// ============================================================================
// PUBLIC ROUTES (no auth required)
// ============================================================================

// Location gate (opt-in via env; portal + auth exempt; fails open). Runs before
// every API route so an out-of-country request to the internal CRM is 403'd,
// while the overseas client portal stays reachable. Cloudflare's edge rule is
// the primary gate; this is the in-app second layer + audit log.
app.use(geoGate);

app.use('/api/auth', authRoutes);
// QA v2's ingest hook (build brief 7.1) — observes fronter-xfer/closer-dispo
// traffic without touching vicidial.js. Mounted BEFORE the real ingest
// router so it sees every request, but it only wraps res.json and always
// calls next() synchronously — the real handler still runs immediately
// after, completely unaffected. See middleware/qa2VicidialIngestHook.js.
app.use('/api/vicidial/fronter-xfer', qa2IngestHook('ingest_fronter'));
app.use('/api/vicidial/closer-dispo', qa2IngestHook('ingest_closer'));
// VICIdial ingest — fired by the VICIdial SERVER (no CRM session); guarded by a
// shared token in the URL. Mounted before the authed groups so it isn't gated.
app.use('/api/vicidial', vicidialIngest);
// Guest (outsider) chat — PUBLIC, the token in the URL is the credential. Mounted
// before the authed groups so it isn't gated; rate-limited since it's open.
app.use('/api/guest',
  rateLimit({ windowMs: 60 * 1000, max: 120, message: { error: 'Too many requests' } }),
  guestChatRoutes);
// Kanban task boards — PUBLIC board access via share_token in the URL (admin
// board-CRUD routes carry authMiddleware per-route inside). Mounted before the
// authed groups so the public routes aren't gated; rate-limited since it's open.
app.use('/api/kanban',
  rateLimit({ windowMs: 60 * 1000, max: 240, message: { error: 'Too many requests' } }),
  kanbanRoutes);

// ============================================================================
// PROTECTED ROUTES (auth required)
// ============================================================================

// egressAudit here so the Manager export modal's "Users" tab is governed like
// every other export. It no-ops on any request without the __egress marker, so
// ordinary user-list browsing is untouched.
app.use('/api/users', authMiddleware, readonlyGuard, egressAudit, usersRoutes);
// SuperAdmin tool — readonly_admin management. The route file itself gates
// on req.user.role === 'superadmin', and readonlyGuard would 403 any RO
// caller trying to PUT/POST/DELETE here anyway.
app.use('/api/readonly-admins', authMiddleware, readonlyGuard, readonlyAdminsRoutes);
app.use('/api/teams', authMiddleware, readonlyGuard, teamsRoutes);
app.use('/api/quiz',  authMiddleware, readonlyGuard, quizRoutes);
// Two-tier team quotas (mig 216) — admin sets the team target, the lead splits it.
app.use('/api/quotas', authMiddleware, readonlyGuard, quotasRoutes);
// RO self-reported navigation telemetry. readonlyGuard allowlists /activity/beacon
// so the read-only account's POST passes; the handler ignores non-RO callers.
app.use('/api/activity', authMiddleware, readonlyGuard, activityBeaconRoutes);
app.use('/api/companies', authMiddleware, readonlyGuard, companiesRoutes);
app.use('/api/roles', authMiddleware, readonlyGuard, rolesRoutes);
app.use('/api/forms', authMiddleware, readonlyGuard, formsRoutes);
app.use('/api/transfers', authMiddleware, readonlyGuard, egressAudit, readonlyDataGuard, transfersRoutes);
// VICIdial fronter app routes (pending-from-dialer list + confirm) — authed.
app.use('/api/vicidial', authMiddleware, vicidialApi);
app.use('/api/sales', authMiddleware, readonlyGuard, egressAudit, readonlyDataGuard, salesRoutes);
// Payouts — superadmin only (enforced inside the router); readonlyGuard still
// blocks the PATCH for a readonly_admin, matching every other admin surface.
app.use('/api/payouts', authMiddleware, readonlyGuard, payoutsRoutes);
app.use('/api/sale-configs', authMiddleware, readonlyGuard, saleConfigsRoutes);
app.use('/api/callbacks',   authMiddleware, readonlyGuard, egressAudit, readonlyDataGuard, callbacksRoutes);
app.use('/api/payment-reminders', authMiddleware, readonlyGuard, paymentRemindersRoutes);
app.use('/api/push',        authMiddleware, readonlyGuard, pushRoutes);
app.use('/api/stats',       authMiddleware, readonlyGuard, statsRoutes);
app.use('/api/notifications', authMiddleware, readonlyGuard, notificationsRoutes);
app.use('/api/reviews',      authMiddleware, readonlyGuard, egressAudit, reviewsRoutes);
app.use('/api/callback-numbers',  authMiddleware, readonlyGuard, callbackNumbersRoutes);
app.use('/api/feature-flags',     authMiddleware, readonlyGuard, featureFlagsRoutes);
app.use('/api/business-config',   authMiddleware, readonlyGuard, businessConfigRoutes);
// Branding/SEO/social-preview: GET is PUBLIC (the frontend meta-injection server
// + crawlers read it tokenless); PUT/upload are superadmin behind auth.
const branding = require('./routes/branding');
app.get('/api/branding', branding.publicGet);
app.use('/api/branding', authMiddleware, readonlyGuard, branding.adminRouter);

// PWA. The manifest and the boot flags MUST be tokenless: the browser fetches
// the manifest before anyone is signed in, and the SPA has to know whether to
// register a service worker on its very first paint.
const pwa = require('./routes/pwa');
app.get('/api/pwa/manifest', pwa.publicManifest);
app.get('/manifest.webmanifest', pwa.publicManifest);   // the canonical path browsers expect
app.get('/api/pwa/public', pwa.publicFlags);
app.use('/api/pwa', authMiddleware, readonlyGuard, pwa.adminRouter);
app.use('/api/compliance',        authMiddleware, readonlyGuard, egressAudit, complianceRoutes);
app.use('/api/egress',            authMiddleware, readonlyGuard, egressRoutes);
// QA Department — recording review + scoring. egressAudit so QA recording plays
// are governed like the rest; each route guards itself by qa_* permission.
// Ticket-authenticated audio. Mounted BEFORE authMiddleware on purpose: an
// <audio> element cannot send an Authorization header, so the player would
// otherwise have to download the whole file over XHR before playing a note.
// The ticket is signed by the authenticated /api/qa/recordings/ticket, which
// is where the permission checks and the egress audit happen.
app.use('/api/qa-media',          qaMediaRoutes);
// qa1ReadonlyGate: off until a superadmin sets a cutover date (qa2/org/v1-freeze) —
// see the middleware's own header for why the clock can't start on deploy.
app.use('/api/qa',                authMiddleware, readonlyGuard, egressAudit, qa1ReadonlyGate, qaRoutes);
// QA v2 — new, parallel to v1 above.
app.use('/api/qa2',               authMiddleware, readonlyGuard, egressAudit, qa2Routes);
app.use('/api/audit',             authMiddleware, readonlyGuard, auditRoutes);
app.use('/api/user-preferences',  authMiddleware, userPreferencesRoutes);
app.use('/api/activity-logs',       authMiddleware, readonlyGuard, activityLogsRoutes);
app.use('/api/lead-intelligence',    authMiddleware, readonlyGuard, leadIntelligenceRoutes);
app.use('/api/disposition-configs', authMiddleware, readonlyGuard, dispositionConfigsRoutes);
app.use('/api/zipcode',            authMiddleware, readonlyGuard, zipcodeRoutes);
app.use('/api/blacklist',          authMiddleware, readonlyGuard, blacklistRoutes);
app.use('/api/card-validator',     authMiddleware, readonlyGuard, cardValidatorRoutes);
app.use('/api/faqs',               authMiddleware, readonlyGuard, faqsRoutes);
app.use('/api/scripts',            authMiddleware, readonlyGuard, scriptsRoutes);
app.use('/api/call-checklist',     authMiddleware, readonlyGuard, callChecklistRoutes);
app.use('/api/uploads',            authMiddleware, readonlyGuard, uploadsRoutes);
app.use('/api/sale-uploads',       authMiddleware, readonlyGuard, saleUploadsRoutes);
app.use('/api/announcements',      authMiddleware, readonlyGuard, announcementsRoutes);
app.use('/api/marquee',            authMiddleware, readonlyGuard, marqueeRoutes);
app.use('/api/spiff',              authMiddleware, readonlyGuard, spiffRoutes);
app.use('/api/data-analyzer',      authMiddleware, readonlyGuard, dataAnalyzerRoutes);
app.use('/api/distribution-batches', authMiddleware, distributionBatchesRoutes);
app.use('/api/note-shortcodes',    authMiddleware, noteShortcodesRoutes);
app.use('/api/data-cleanup',       authMiddleware, readonlyGuard, dataCleanupRoutes);
app.use('/api/vehicles',           authMiddleware, readonlyGuard, vehiclesRoutes);
// Chat — admin routes mounted first (superadmin-gated, no feature gate so
// moderation always works); user routes behind the per-company 'chat' flag.
app.use('/api/chat/admin',         authMiddleware, readonlyGuard, chatAdminRoutes);
app.use('/api/chat',               authMiddleware, readonlyGuard, requireFeature('chat'), chatRoutes);
// Internal email — same gating pattern as chat (per-company 'internal_email' flag).
app.use('/api/emails',             authMiddleware, readonlyGuard, requireFeature('internal_email'), emailRoutes);
// Client recording portal — admin (superadmin) + the isolated client login.
// Each route guards itself (authMiddleware inside); no readonlyGuard so the
// client GET stream is reachable, and audit writes aren't blocked.
app.use('/api/portal',             portalRoutes);
// Events calendar — reads open to all authenticated users, writes SuperAdmin-only (enforced in-route)
app.use('/api/events',             authMiddleware, readonlyGuard, eventsRoutes);
// FAQ/Script search tools — synonyms (all) + analytics (log all, report SuperAdmin)
app.use('/api/search',             authMiddleware, readonlyGuard, searchRoutes);
// Customer profile (OOP domain layer) — Superadmin panel unified view. The
// route guards itself (superadmin / readonly_admin); no readonlyGuard so the
// readonly admin can still GET the profile.
app.use('/api/customer-profile', authMiddleware, customerProfileRoutes);
// Presence / last-seen / activity. Intentionally NO readonlyGuard — the
// heartbeat is telemetry, not a business write, and readonly admins must be
// able to register presence; the admin endpoint guards itself in-route.
app.use('/api/presence',           authMiddleware, presenceRoutes);

// ============================================================================
// SPA FALLBACK - Serve index.html for all non-API routes (React Router)
// ============================================================================
app.get('*', (req, res, next) => {
  const isApiPath =
    req.path === '/health' ||
    req.path.startsWith('/api/') ||
    req.path.startsWith('/auth/');

  if (isApiPath) {
    return next();
  }

  // Crawlers (WhatsApp/FB/Twitter/iMessage) send Accept: */* not text/html, and
  // they're exactly who needs the OG tags — so serve HTML for a bare '/' too.
  const acceptsHtml = (req.headers.accept || '').includes('text/html');
  if (!acceptsHtml && req.path !== '/' && path.extname(req.path)) {
    return next();
  }

  const indexPath = path.join(frontendDistPath, 'index.html');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  // Inject branding/SEO/OG meta from the DB into index.html. On any failure fall
  // back to the raw file — serving must never break because of branding.
  (async () => {
    try {
      const branding = await loadBranding();
      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const html = renderIndex(frontendDistPath, branding, `${proto}://${req.get('host')}${req.originalUrl}`);
      if (html) {
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
      }
    } catch { /* fall through */ }
    res.sendFile(indexPath, (err) => { if (err) res.status(404).json({ error: 'Not found' }); });
  })();
});

// ============================================================================
// 404 HANDLER
// ============================================================================

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
});

// ============================================================================
// ERROR HANDLING MIDDLEWARE (must be last)
// ============================================================================

app.use(errorHandler);

// ============================================================================
// START SERVER
// ============================================================================

const { warm: warmAuditCols } = require('./utils/auditColumnGuard');

app.listen(PORT, () => {
  startCallbackScheduler();
  startBackgroundJobs();       // matview refresh + cache sweep (utils/scheduler)
  startAutoFetchDispo();       // catch-up dispo fetch for manual-dial transfers
  // Chained, not fire-and-forget: ensureAdminProfiles filters on the stamp both
  // syncs write, so it must not race them or it misses an account stamped on
  // this very boot and the profile row waits a whole restart.
  syncSuperadminMetadata()     // Stamp JWT metadata for superadmins — no-op if already done
    .then(syncReadonlyAdminMetadata)  // Same for readonly_admin
    .then(ensureAdminProfiles);       // Then give every admin a user_profiles row (see above)
  warmAuditCols();          // Probe last_modified_by on tracked tables (mig 063)
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Supabase URL: ${process.env.VITE_SUPABASE_URL}`);
  console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
  console.log(`💾 Database: Supabase\n`);
});

module.exports = app;
