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
// HEALTH CHECK (no auth required)
// ============================================================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'BizTrix CRM Backend API',
    version: '2.0.0',
    status: 'running',
    docs: 'https://github.com/biztrixventure/crmv2.0'
  });
});

// ============================================================================
// PUBLIC ROUTES (no auth required)
// ============================================================================

app.use('/auth', authRoutes);

// ============================================================================
// PROTECTED ROUTES (auth required)
// ============================================================================

app.use('/api/users', authMiddleware, usersRoutes);
app.use('/api/companies', authMiddleware, companiesRoutes);
app.use('/api/roles', authMiddleware, rolesRoutes);
app.use('/api/forms', authMiddleware, formsRoutes);
app.use('/api/transfers', authMiddleware, transfersRoutes);
app.use('/api/sales', authMiddleware, salesRoutes);

// ============================================================================
// SPA FALLBACK REDIRECT (for misrouted browser traffic)
// ============================================================================
// If a browser request for common frontend routes hits backend directly
// (eg, domain mapped to backend), redirect users to the frontend URL.
app.get(['/login', '/dashboard', '/admin'], (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) {
    return res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
  }

  const target = new URL(req.path, frontendUrl).toString();
  return res.redirect(302, target);
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
