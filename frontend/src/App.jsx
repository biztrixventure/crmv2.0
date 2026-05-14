import { lazy, Suspense, useContext } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider, ThemeContext } from "./contexts/ThemeContext";
import { FeatureFlagsProvider } from "./contexts/FeatureFlagsContext";
import { hasRoleAccess, getRoleRoute } from "./utils/roleRouting";
import { Toaster } from "sonner";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import ImpersonateCallback from "./pages/ImpersonateCallback";
import "./styles/global.css";

// Lazy-load dashboards for better perf
const AdminPanel      = lazy(() => import("./pages/AdminPanel"));
const StaffShell      = lazy(() => import("./shells/StaffShell"));
const ManagerShell    = lazy(() => import("./shells/ManagerShell"));
const ComplianceShell = lazy(() => import("./shells/ComplianceShell"));
const NotFound        = lazy(() => import("./pages/NotFound"));

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
          <Route path="/login"              element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" />} />
          <Route path="/forgot-password"   element={<ForgotPassword />} />
          <Route path="/reset-password"    element={<ResetPassword />} />
          <Route path="/accept-invite"     element={<AcceptInvite />} />
          <Route path="/impersonate-callback" element={<ImpersonateCallback />} />

          {/* Smart redirect */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardRedirect /></ProtectedRoute>} />

          {/* SuperAdmin + ReadOnly Admin */}
          <Route path="/admin/*" element={
            <ProtectedRoute requiredRole="admin"><AdminPanel /></ProtectedRoute>
          } />

          {/* Compliance Manager */}
          <Route path="/compliance/*" element={
            <ProtectedRoute requiredRole="compliance_manager"><ComplianceShell /></ProtectedRoute>
          } />

          {/* Staff Shell — closer / fronter */}
          <Route path="/closer/*"  element={<ProtectedRoute requiredRole="closer"><StaffShell /></ProtectedRoute>} />
          <Route path="/fronter/*" element={<ProtectedRoute requiredRole="fronter"><StaffShell /></ProtectedRoute>} />
          <Route path="/staff/*"   element={<ProtectedRoute requiredRole="closer"><StaffShell /></ProtectedRoute>} />

          {/* Manager Shell — all manager roles + company_admin */}
          <Route path="/manager/*"         element={<ProtectedRoute requiredRole="closer_manager"><ManagerShell /></ProtectedRoute>} />
          <Route path="/closer-manager/*"  element={<ProtectedRoute requiredRole="closer_manager"><ManagerShell /></ProtectedRoute>} />
          <Route path="/fronter-manager/*" element={<ProtectedRoute requiredRole="fronter_manager"><ManagerShell /></ProtectedRoute>} />
          <Route path="/operations/*"      element={<ProtectedRoute requiredRole="operations_manager"><ManagerShell /></ProtectedRoute>} />

          <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Router>
  );
};

// Reads current theme so Toaster matches dark/light mode automatically
const AppToaster = () => {
  const { theme } = useContext(ThemeContext);
  return (
    <Toaster
      position="top-right"
      theme={theme}
      richColors
      expand={false}
      gap={8}
      toastOptions={{
        style: {
          fontFamily: 'inherit',
          fontSize: '14px',
          borderRadius: '12px',
          border: '1px solid var(--color-border)',
        },
        classNames: {
          toast:       'shadow-lg',
          title:       'font-semibold',
          description: 'text-xs opacity-80',
        },
      }}
    />
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <FeatureFlagsProvider>
          <AppToaster />
          <AppContent />
        </FeatureFlagsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
