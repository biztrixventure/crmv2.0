import { lazy, Suspense, useContext } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider, ThemeContext } from "./contexts/ThemeContext";
import { FeatureFlagsProvider, useFeatureFlags } from "./contexts/FeatureFlagsContext";
import { PresenceProvider } from "./contexts/PresenceContext";
import { FocusProvider } from "./contexts/FocusContext";
import { hasRoleAccess, getRoleRoute } from "./utils/roleRouting";
import { Toaster } from "sonner";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import ImpersonateCallback from "./pages/ImpersonateCallback";
import GuestChat from "./pages/GuestChat";
import BrandedLoader from "./components/UI/BrandedLoader";
import "./styles/global.css";

// Lazy-load dashboards for better perf
const AdminPanel      = lazy(() => import("./pages/AdminPanel"));
const StaffShell      = lazy(() => import("./shells/StaffShell"));
const ManagerShell    = lazy(() => import("./shells/ManagerShell"));
const ComplianceShell = lazy(() => import("./shells/ComplianceShell"));
const ClientPortal    = lazy(() => import("./pages/ClientPortal"));
const NotFound        = lazy(() => import("./pages/NotFound"));
const MascotAssistant = lazy(() => import("./components/Assistant/MascotAssistant"));

// Branded loader replaces the old spinner everywhere a route is in flight or
// the /auth/me refresh is mid-air. Keeps the brand visible on cold load + on
// every shell swap, and reads the per-theme logo so dark/light flips don't
// strand a white-on-white mark.
const PageSpinner = () => <BrandedLoader />;

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

  if (isRefreshing) return <BrandedLoader message="Loading your dashboard" />;

  return <Navigate to={getRoleRoute(user?.role)} replace />;
};

const AppContent = () => {
  const { isAuthenticated } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const assistantOn = isEnabled('crm_assistant');   // superadmin system-wide toggle (Features tab)

  return (
    <Router>
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/login"              element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" />} />
          <Route path="/forgot-password"   element={<ForgotPassword />} />
          <Route path="/reset-password"    element={<ResetPassword />} />
          <Route path="/accept-invite"     element={<AcceptInvite />} />
          <Route path="/guest/:token"      element={<GuestChat />} />
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

          {/* Client recording portal — isolated external login (no CRM chrome) */}
          <Route path="/portal/*" element={<ProtectedRoute requiredRole="portal_client"><ClientPortal /></ProtectedRoute>} />

          <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      {/* Floating CRM assistant mascot — signed in + enabled by superadmin (Features → crm_assistant) */}
      {isAuthenticated && assistantOn && (
        <Suspense fallback={null}><MascotAssistant /></Suspense>
      )}
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
          {/* App-wide realtime presence — online from login to logout, every
              shell. Chat dots, last-seen, and the admin activity panel all
              read from this one channel. */}
          <PresenceProvider>
            <FocusProvider>
              <AppToaster />
              <AppContent />
            </FocusProvider>
          </PresenceProvider>
        </FeatureFlagsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
