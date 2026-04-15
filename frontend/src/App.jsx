import { lazy, Suspense } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { hasRoleAccess, getRoleRoute } from "./utils/roleRouting";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import "./styles/global.css";

// Lazy-load dashboards for better perf
const AdminPanel             = lazy(() => import("./pages/AdminPanel"));
const CompanyDashboard       = lazy(() => import("./pages/CompanyDashboard"));
const CloserDashboard        = lazy(() => import("./pages/CloserDashboard"));
const FronterDashboard       = lazy(() => import("./pages/FronterDashboard"));
const OperationsDashboard    = lazy(() => import("./pages/OperationsDashboard"));
const CloserManagerDashboard = lazy(() => import("./pages/CloserManagerDashboard"));
const FronterManagerDashboard = lazy(() => import("./pages/FronterManagerDashboard"));
const ComplianceDashboard    = lazy(() => import("./pages/ComplianceDashboard"));
const NotFound               = lazy(() => import("./pages/NotFound"));

const PageSpinner = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
    <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--color-primary-600)' }} />
  </div>
);

// Protected Route — checks auth + role access
const ProtectedRoute = ({ children, requiredRole = null }) => {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (requiredRole && !hasRoleAccess(user?.role, requiredRole)) {
    return <Navigate to={getRoleRoute(user?.role)} />;
  }
  return children;
};

// Smart redirect — waits for /auth/me before routing
const DashboardRedirect = () => {
  const { user, isRefreshing } = useAuth();

  if (isRefreshing) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg)' }}>
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: 'var(--color-primary-600)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  return <Navigate to={getRoleRoute(user?.role)} replace />;
};

const AppContent = () => {
  const { isAuthenticated } = useAuth();

  return (
    <Router>
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password"  element={<ResetPassword />} />

          {/* Smart redirect */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardRedirect /></ProtectedRoute>} />

          {/* SuperAdmin */}
          <Route path="/admin/*" element={
            <ProtectedRoute requiredRole="admin"><AdminPanel /></ProtectedRoute>
          } />

          {/* Compliance Manager */}
          <Route path="/compliance/*" element={
            <ProtectedRoute requiredRole="compliance_manager"><ComplianceDashboard /></ProtectedRoute>
          } />

          {/* Company Admin */}
          <Route path="/company/*" element={
            <ProtectedRoute requiredRole="company_admin"><CompanyDashboard /></ProtectedRoute>
          } />

          {/* Operations Manager (merged with Company Manager) */}
          <Route path="/operations/*" element={
            <ProtectedRoute requiredRole="operations_manager"><OperationsDashboard /></ProtectedRoute>
          } />

          {/* Fronter Manager */}
          <Route path="/fronter-manager/*" element={
            <ProtectedRoute requiredRole="fronter_manager"><FronterManagerDashboard /></ProtectedRoute>
          } />

          {/* Closer Manager */}
          <Route path="/closer-manager/*" element={
            <ProtectedRoute requiredRole="closer_manager"><CloserManagerDashboard /></ProtectedRoute>
          } />

          {/* Closer */}
          <Route path="/closer/*" element={
            <ProtectedRoute requiredRole="closer"><CloserDashboard /></ProtectedRoute>
          } />

          {/* Fronter */}
          <Route path="/fronter/*" element={
            <ProtectedRoute requiredRole="fronter"><FronterDashboard /></ProtectedRoute>
          } />

          <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Router>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
