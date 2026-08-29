import { lazy, Suspense, useContext, useEffect } from "react";
import { fetchBranding, applyBranding } from "./utils/branding";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ThemeProvider, ThemeContext } from "./contexts/ThemeContext";
import { FeatureFlagsProvider, useFeatureFlags } from "./contexts/FeatureFlagsContext";
import { PresenceProvider } from "./contexts/PresenceContext";
import { FocusProvider } from "./contexts/FocusContext";
import { BrandingProvider } from "./contexts/BrandingContext";
import { hasRoleAccess, getRoleRoute } from "./utils/roleRouting";
import { Toaster } from "sonner";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import ImpersonateCallback from "./pages/ImpersonateCallback";
import GuestChat from "./pages/GuestChat";
import BrandedLoader from "./components/UI/BrandedLoader";
import InstallPrompt from "./components/UI/InstallPrompt";
import ThemeRuntime from "./components/ThemeRuntime";
import UserThemeRuntime from "./components/UserThemeRuntime";
import "./styles/global.css";

// Lazy-load dashboards for better perf
const AdminPanel      = lazy(() => import("./pages/AdminPanel"));
const StaffShell      = lazy(() => import("./shells/StaffShell"));
const ManagerShell    = lazy(() => import("./shells/ManagerShell"));
const ComplianceShell = lazy(() => import("./shells/ComplianceShell"));
const QAShell         = lazy(() => import("./shells/QAShell"));
const QA2Shell        = lazy(() => import("./shells/QA2Shell"));
const ClientPortal    = lazy(() => import("./pages/ClientPortal"));
const NotFound        = lazy(() => import("./pages/NotFound"));
const KanbanBoard     = lazy(() => import("./pages/KanbanBoard"));
// Accounting + HR modules. Isolated shells like /compliance and /qa2 -- they are
// a place you go, not a role you have, so access is decided inside the shell
// from GET /accounting/my-scope and /hr/my-scope rather than by role here.
const AccountingShell = lazy(() => import("./shells/AccountingShell"));
const HRShell         = lazy(() => import("./shells/HRShell"));
const MascotAssistant = lazy(() => import("./components/Assistant/MascotAssistant"));

// Branded loader replaces the old spinner everywhere a route is in flight or
// the /auth/me refresh is mid-air. Keeps the brand visible on cold load + on
// every shell swap, and reads the per-theme logo so dark/light flips don't
// strand a white-on-white mark.
const PageSpinner = () => <BrandedLoader />;

// Protected Route — checks auth + role access (or a feature-flag grant).
// requireFlag: access is granted purely by a strict feature flag, regardless of
// role — used by the opt-in Custom Access workspace.
const ProtectedRoute = ({ children, requiredRole = null, requireFlag = null }) => {
  const { user, isAuthenticated } = useAuth();
  const { isEnabledStrict, loading: flagsLoading } = useFeatureFlags();
  if (!isAuthenticated) return <Navigate to="/login" />;
  if (requireFlag) {
    if (flagsLoading) return <BrandedLoader />;
    if (!isEnabledStrict(requireFlag)) return <Navigate to={getRoleRoute(user?.role)} />;
    return children;
  }
  if (requiredRole && !hasRoleAccess(user?.role, requiredRole)) {
    return <Navigate to={getRoleRoute(user?.role)} />;
  }
  return children;
};

// Smart redirect — waits for /auth/me AND feature flags before routing, so a
// Custom Access user lands in /workspace instead of their role shell.
const DashboardRedirect = () => {
  const { user, isRefreshing } = useAuth();
  const { isEnabledStrict, loading: flagsLoading } = useFeatureFlags();

  if (isRefreshing || flagsLoading) return <BrandedLoader message="Loading your dashboard" />;

  if (isEnabledStrict('custom_workspace')) return <Navigate to="/workspace" replace />;
  return <Navigate to={getRoleRoute(user?.role)} replace />;
};

const AppContent = () => {
  const { isAuthenticated } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const assistantOn = isEnabled('crm_assistant');   // superadmin system-wide toggle (Features tab)

  // Branding (name / logo / tab title / favicon / meta) comes from
  // BrandingProvider, mounted below, so the configured name reaches the UI and
  // not just the browser tab. Public endpoint — it runs on the login page too.
  // Server-side injection still handles the very first paint + crawlers.
  return (
    <Router>
      {/* Injects the saved Appearance theme (business_config `theme`) app-wide. */}
      <ThemeRuntime />
      {/* The signed-in user's personal colour theme (localStorage), layered last. */}
      <UserThemeRuntime />
      <Suspense fallback={<PageSpinner />}>
        <Routes>
          <Route path="/login"              element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" />} />
          <Route path="/forgot-password"   element={<ForgotPassword />} />
          <Route path="/reset-password"    element={<ResetPassword />} />
          <Route path="/accept-invite"     element={<AcceptInvite />} />
          <Route path="/guest/:token"      element={<GuestChat />} />
          <Route path="/board/:token"      element={<KanbanBoard />} />
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

          {/* QA Department — isolated shell for qa_manager + qa_agent */}
          <Route path="/qa/*" element={
            <ProtectedRoute requiredRole="qa_agent"><QAShell /></ProtectedRoute>
          } />

          {/* QA v2 — new, parallel to v1 above during the build-out. Same
              access rule as /qa (hasRoleAccess already treats qa_agent,
              qa_manager, and compliance_manager identically for this pair). */}
          <Route path="/qa2/*" element={
            <ProtectedRoute requiredRole="qa_agent"><QA2Shell /></ProtectedRoute>
          } />

          {/* Staff Shell — closer / fronter */}
          <Route path="/closer/*"  element={<ProtectedRoute requiredRole="closer"><StaffShell /></ProtectedRoute>} />
          <Route path="/fronter/*" element={<ProtectedRoute requiredRole="fronter"><StaffShell /></ProtectedRoute>} />
          <Route path="/staff/*"   element={<ProtectedRoute requiredRole="closer"><StaffShell /></ProtectedRoute>} />

          {/* Custom Access workspace — opt-in unified shell, granted by flag (any
              base role). Reuses ManagerShell; every tab/tool is permission-gated. */}
          <Route path="/workspace/*" element={<ProtectedRoute requireFlag="custom_workspace"><ManagerShell workspaceMode /></ProtectedRoute>} />

          {/* Manager Shell — all manager roles + company_admin */}
          <Route path="/manager/*"         element={<ProtectedRoute requiredRole="closer_manager"><ManagerShell /></ProtectedRoute>} />
          <Route path="/closer-manager/*"  element={<ProtectedRoute requiredRole="closer_manager"><ManagerShell /></ProtectedRoute>} />
          <Route path="/fronter-manager/*" element={<ProtectedRoute requiredRole="fronter_manager"><ManagerShell /></ProtectedRoute>} />
          <Route path="/operations/*"      element={<ProtectedRoute requiredRole="operations_manager"><ManagerShell /></ProtectedRoute>} />

          {/* Accounting + HR. Deliberately NOT role-guarded: reach is granted by
              a permission OR by a superadmin designation (mig 290,
              module_designations), and a designation is invisible to the role
              hierarchy. The shell asks the server what this person may see and
              renders an explicit "no access" state when the answer is nothing;
              every endpoint behind it re-checks. Guarding on a role here would
              lock out exactly the people the designation exists for. */}
          <Route path="/accounting/*" element={<ProtectedRoute><AccountingShell /></ProtectedRoute>} />
          <Route path="/hr/*"         element={<ProtectedRoute><HRShell /></ProtectedRoute>} />

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
      {/* Install affordance. Renders only once the browser has itself decided
          the app is installable, so it can never be a button that does nothing.
          Gated on being signed in: offering to install a CRM to someone sitting
          on the login page is asking a stranger to put it on their home screen. */}
      {isAuthenticated && <InstallPrompt />}
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
      {/* Branding wraps everything, including the signed-OUT pages: the login
          screen has to show the configured product name too. */}
      <BrandingProvider>
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
      </BrandingProvider>
    </ThemeProvider>
  );
}

export default App;
