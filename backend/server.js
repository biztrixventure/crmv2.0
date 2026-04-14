const express = require('express');
const cors = require('cors');
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
const saleConfigsRoutes = require('./routes/sale-configs');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
};
app.use(cors(corsOptions));

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
app.use('/api/stats', authMiddleware, statsRoutes);
app.use('/api/notifications', authMiddleware, notificationsRoutes);

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
  console.log(`\n🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Supabase URL: ${process.env.VITE_SUPABASE_URL}`);
  console.log(`🌐 CORS Origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
  console.log(`💾 Database: Supabase\n`);
});

module.exports = app;
