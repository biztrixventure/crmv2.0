const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: '.env.local' });

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/authMiddleware');
const { readonlyGuard } = require('./middleware/readonlyGuard');

// Import routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const readonlyAdminsRoutes = require('./routes/readonlyAdmins');
const companiesRoutes = require('./routes/companies');
const rolesRoutes = require('./routes/roles');
const formsRoutes = require('./routes/forms');
const transfersRoutes = require('./routes/transfers');
const salesRoutes = require('./routes/sales');
const statsRoutes = require('./routes/stats');
const notificationsRoutes = require('./routes/notifications');
const saleConfigsRoutes   = require('./routes/sale-configs');
const callbacksRoutes     = require('./routes/callbacks');
const pushRoutes          = require('./routes/push');
const reviewsRoutes       = require('./routes/reviews');
const numberListsRoutes       = require('./routes/numberLists');
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
const faqsRoutes                = require('./routes/faqs');
const scriptsRoutes             = require('./routes/scripts');
const callChecklistRoutes       = require('./routes/callChecklist');
const uploadsRoutes             = require('./routes/uploads');
const saleUploadsRoutes         = require('./routes/saleUploads');
const announcementsRoutes       = require('./routes/announcements');
const marqueeRoutes             = require('./routes/marquee');
const spiffRoutes               = require('./routes/spiff');
const dataAnalyzerRoutes        = require('./routes/dataAnalyzer');
const dataCleanupRoutes         = require('./routes/dataCleanup');
const { ingest: vicidialIngest, api: vicidialApi } = require('./routes/vicidial');
const vehiclesRoutes            = require('./routes/vehicles');
const chatRoutes                = require('./routes/chat');
const chatAdminRoutes           = require('./routes/chatAdmin');
const guestChatRoutes           = require('./routes/guestChat');
const portalRoutes              = require('./routes/portal');
const presenceRoutes            = require('./routes/presence');
const eventsRoutes              = require('./routes/events');
const searchRoutes              = require('./routes/search');
const { requireFeature }        = require('./utils/featureGate');
const { startCallbackScheduler } = require('./utils/callbackScheduler');
const { startAutoFetchDispo } = require('./utils/autoFetchDispo');
const { supabaseAdmin: _saForSync } = require('./config/database');

// On startup: stamp app_metadata.role='superadmin' for SUPERADMIN_EMAIL users.
// Once set, the Supabase JWT carries it — no env-var dependency per-request.
async function syncSuperadminMetadata() {
  const emails = (process.env.SUPERADMIN_EMAIL || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!emails.length) return;
  try {
    const { data } = await _saForSync.auth.admin.listUsers({ perPage: 1000 });
    for (const u of (data?.users || [])) {
      if (emails.includes((u.email || '').toLowerCase()) && u.app_metadata?.role !== 'superadmin') {
        await _saForSync.auth.admin.updateUserById(u.id, {
          app_metadata: { ...u.app_metadata, role: 'superadmin' },
        });
        console.log(`[SUPERADMIN] Stamped app_metadata.role=superadmin for ${u.email}`);
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
// This gives each authenticated user their own 1000-request/15min bucket instead
// of sharing one IP-based bucket across all users behind a corporate NAT/proxy.
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
  max: 1000,
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
const frontendDistPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendDistPath, {
  maxAge: '1y',
  immutable: true,
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// PUBLIC ROUTES (no auth required)
// ============================================================================

app.use('/api/auth', authRoutes);
// VICIdial ingest — fired by the VICIdial SERVER (no CRM session); guarded by a
// shared token in the URL. Mounted before the authed groups so it isn't gated.
app.use('/api/vicidial', vicidialIngest);
// Guest (outsider) chat — PUBLIC, the token in the URL is the credential. Mounted
// before the authed groups so it isn't gated; rate-limited since it's open.
app.use('/api/guest',
  rateLimit({ windowMs: 60 * 1000, max: 120, message: { error: 'Too many requests' } }),
  guestChatRoutes);

// ============================================================================
// PROTECTED ROUTES (auth required)
// ============================================================================

app.use('/api/users', authMiddleware, readonlyGuard, usersRoutes);
// SuperAdmin tool — readonly_admin management. The route file itself gates
// on req.user.role === 'superadmin', and readonlyGuard would 403 any RO
// caller trying to PUT/POST/DELETE here anyway.
app.use('/api/readonly-admins', authMiddleware, readonlyGuard, readonlyAdminsRoutes);
app.use('/api/companies', authMiddleware, readonlyGuard, companiesRoutes);
app.use('/api/roles', authMiddleware, readonlyGuard, rolesRoutes);
app.use('/api/forms', authMiddleware, readonlyGuard, formsRoutes);
app.use('/api/transfers', authMiddleware, readonlyGuard, transfersRoutes);
// VICIdial fronter app routes (pending-from-dialer list + confirm) — authed.
app.use('/api/vicidial', authMiddleware, vicidialApi);
app.use('/api/sales', authMiddleware, readonlyGuard, salesRoutes);
app.use('/api/sale-configs', authMiddleware, readonlyGuard, saleConfigsRoutes);
app.use('/api/callbacks',   authMiddleware, readonlyGuard, callbacksRoutes);
app.use('/api/push',        authMiddleware, readonlyGuard, pushRoutes);
app.use('/api/stats',       authMiddleware, readonlyGuard, statsRoutes);
app.use('/api/notifications', authMiddleware, readonlyGuard, notificationsRoutes);
app.use('/api/reviews',      authMiddleware, readonlyGuard, reviewsRoutes);
app.use('/api/number-lists',      authMiddleware, readonlyGuard, numberListsRoutes);
app.use('/api/callback-numbers',  authMiddleware, readonlyGuard, callbackNumbersRoutes);
app.use('/api/feature-flags',     authMiddleware, readonlyGuard, featureFlagsRoutes);
app.use('/api/business-config',   authMiddleware, readonlyGuard, businessConfigRoutes);
app.use('/api/compliance',        authMiddleware, readonlyGuard, complianceRoutes);
app.use('/api/audit',             authMiddleware, readonlyGuard, auditRoutes);
app.use('/api/user-preferences',  authMiddleware, userPreferencesRoutes);
app.use('/api/activity-logs',       authMiddleware, readonlyGuard, activityLogsRoutes);
app.use('/api/lead-intelligence',    authMiddleware, readonlyGuard, leadIntelligenceRoutes);
app.use('/api/disposition-configs', authMiddleware, readonlyGuard, dispositionConfigsRoutes);
app.use('/api/zipcode',            authMiddleware, readonlyGuard, zipcodeRoutes);
app.use('/api/faqs',               authMiddleware, readonlyGuard, faqsRoutes);
app.use('/api/scripts',            authMiddleware, readonlyGuard, scriptsRoutes);
app.use('/api/call-checklist',     authMiddleware, readonlyGuard, callChecklistRoutes);
app.use('/api/uploads',            authMiddleware, readonlyGuard, uploadsRoutes);
app.use('/api/sale-uploads',       authMiddleware, readonlyGuard, saleUploadsRoutes);
app.use('/api/announcements',      authMiddleware, readonlyGuard, announcementsRoutes);
app.use('/api/marquee',            authMiddleware, readonlyGuard, marqueeRoutes);
app.use('/api/spiff',              authMiddleware, readonlyGuard, spiffRoutes);
app.use('/api/data-analyzer',      authMiddleware, readonlyGuard, dataAnalyzerRoutes);
app.use('/api/data-cleanup',       authMiddleware, readonlyGuard, dataCleanupRoutes);
app.use('/api/vehicles',           authMiddleware, readonlyGuard, vehiclesRoutes);
// Chat — admin routes mounted first (superadmin-gated, no feature gate so
// moderation always works); user routes behind the per-company 'chat' flag.
app.use('/api/chat/admin',         authMiddleware, readonlyGuard, chatAdminRoutes);
app.use('/api/chat',               authMiddleware, readonlyGuard, requireFeature('chat'), chatRoutes);
// Client recording portal — admin (superadmin) + the isolated client login.
// Each route guards itself (authMiddleware inside); no readonlyGuard so the
// client GET stream is reachable, and audit writes aren't blocked.
app.use('/api/portal',             portalRoutes);
// Events calendar — reads open to all authenticated users, writes SuperAdmin-only (enforced in-route)
app.use('/api/events',             authMiddleware, readonlyGuard, eventsRoutes);
// FAQ/Script search tools — synonyms (all) + analytics (log all, report SuperAdmin)
app.use('/api/search',             authMiddleware, readonlyGuard, searchRoutes);
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

  const acceptsHtml = (req.headers.accept || '').includes('text/html');
  if (!acceptsHtml) {
    return next();
  }

  const indexPath = path.join(frontendDistPath, 'index.html');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).json({ error: 'Not found' });
    }
  });
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
  startAutoFetchDispo();       // catch-up dispo fetch for manual-dial transfers
  syncSuperadminMetadata();    // Stamp JWT metadata for superadmins — no-op if already done
  syncReadonlyAdminMetadata(); // Same for readonly_admin
  warmAuditCols();          // Probe last_modified_by on tracked tables (mig 063)
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Supabase URL: ${process.env.VITE_SUPABASE_URL}`);
  console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
  console.log(`💾 Database: Supabase\n`);
});

module.exports = app;
