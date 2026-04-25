const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: '.env.local' });

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/authMiddleware');

// Import routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
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
const complianceRoutes        = require('./routes/compliance');
const { startCallbackScheduler } = require('./utils/callbackScheduler');
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
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", "data:", "blob:"],
      fontSrc:     ["'self'", "data:"],
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

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  // Key on email so 300 users sharing one NAT/IP each get their own bucket.
  // Falls back to IP if body isn't parsed yet or email is missing.
  keyGenerator: (req) => (req.body?.email || '').toLowerCase().trim() || req.ip,
  message: { error: 'Too many login attempts, try again later' },
  skipSuccessfulRequests: true, // successful logins don't count against the limit
}));
app.use('/api/auth/forgot-password', rateLimit({ windowMs: 60 * 60 * 1000, max: 5,   message: { error: 'Too many requests, try again later' } }));
app.use('/api/auth/invite',          rateLimit({ windowMs: 60 * 60 * 1000, max: 20,  message: { error: 'Too many invite requests' } }));
app.use('/api/',                     rateLimit({ windowMs: 15 * 60 * 1000, max: 500, message: { error: 'Too many requests' } }));

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
app.use(express.static(frontendDistPath));

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

// ============================================================================
// PROTECTED ROUTES (auth required)
// ============================================================================

app.use('/api/users', authMiddleware, usersRoutes);
app.use('/api/companies', authMiddleware, companiesRoutes);
app.use('/api/roles', authMiddleware, rolesRoutes);
app.use('/api/forms', authMiddleware, formsRoutes);
app.use('/api/transfers', authMiddleware, transfersRoutes);
app.use('/api/sales', authMiddleware, salesRoutes);
app.use('/api/sale-configs', authMiddleware, saleConfigsRoutes);
app.use('/api/callbacks',   authMiddleware, callbacksRoutes);
app.use('/api/push',        authMiddleware, pushRoutes);
app.use('/api/stats',       authMiddleware, statsRoutes);
app.use('/api/notifications', authMiddleware, notificationsRoutes);
app.use('/api/reviews',      authMiddleware, reviewsRoutes);
app.use('/api/number-lists',      authMiddleware, numberListsRoutes);
app.use('/api/callback-numbers',  authMiddleware, callbackNumbersRoutes);
app.use('/api/feature-flags',     authMiddleware, featureFlagsRoutes);
app.use('/api/compliance',        authMiddleware, complianceRoutes);

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

app.listen(PORT, () => {
  startCallbackScheduler();
  syncSuperadminMetadata(); // Stamp JWT metadata for superadmins — no-op if already done
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Supabase URL: ${process.env.VITE_SUPABASE_URL}`);
  console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
  console.log(`💾 Database: Supabase\n`);
});

module.exports = app;
