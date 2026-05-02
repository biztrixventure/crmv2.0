import { useState, useEffect, lazy, Suspense } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useVersionCheck } from "../hooks/useVersionCheck";
import UpdateBanner from "../components/UI/UpdateBanner";
import { useTheme } from "../contexts/ThemeContext";
import { useNavigate } from "react-router-dom";
import DevCredit from "../components/DevCredit";
import AdminHeader from "../components/Admin/Layout/AdminHeader";
import AdminSidebar from "../components/Admin/Layout/AdminSidebar";
import { CompanyManagement } from "../components/Admin/CompanyManagement";
import { useNotifications } from "../hooks/useNotifications";
import SaleSearch from "../components/Sales/SaleSearch";
import AdminAnalyticsDashboard from "../components/Admin/AdminAnalyticsDashboard";
const FormBuilder = lazy(() => import("../components/Admin/FormBuilder/FormBuilder"));
import FeatureFlagsManager from "../components/Admin/FeatureFlagsManager";
import { Search } from "lucide-react";

const SaleSearchPanel = () => {
  const { user } = useAuth();
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-text flex items-center gap-2">
          <Search size={22} style={{ color: 'var(--color-primary-600)' }} />
          Sale Record Search
        </h2>
        <p className="text-text-secondary text-sm mt-0.5">
          Search by customer name, phone, reference no, VIN, or email.
        </p>
      </div>
      <div className="rounded-2xl border p-6"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <SaleSearch companyId={user?.company_id} user={user} />
      </div>
    </div>
  );
};

// ============================================================================
// AdminPanel — main component
// ============================================================================
const AdminPanel = () => {
  const { user, logout, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const updateAvailable = useVersionCheck();
  const [activeTab, setActiveTab] = useState("dashboard");
  const notifHook = useNotifications();

  const handleLogout = () => { logout(); navigate("/login"); };

  const isReadOnly = user?.role === 'readonly_admin';

  // Allow AdminAnalyticsDashboard quick-action buttons to navigate
  useEffect(() => {
    const handler = e => setActiveTab(e.detail);
    document.addEventListener('admin-nav', handler);
    return () => document.removeEventListener('admin-nav', handler);
  }, []);

  const navItems = [
    { id: "dashboard",   label: "Dashboard"    },
    ...(!isReadOnly                                   ? [{ id: "companies",   label: "Companies"    }] : []),
    ...(!isReadOnly && hasPermission('manage_forms')  ? [{ id: "forms",       label: "Form Builder" }] : []),
    ...(hasPermission('search_sales')                 ? [{ id: "sale-search", label: "Sale Search"  }] : []),
    ...(user?.role === 'superadmin'                   ? [{ id: "features",    label: "Features"     }] : []),
  ];

  return (
    <div className="min-h-screen bg-bg">
      {updateAvailable && <UpdateBanner />}
      <AdminHeader
        theme={theme} onToggleTheme={toggleTheme} onLogout={handleLogout}
        notifications={notifHook.notifications}
        unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead}
        onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification}
        onClearNotifications={notifHook.clearAll}
      />

      <div className="flex" style={{ height: 'calc(100vh - 64px)' }}>
        <AdminSidebar navItems={navItems} activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="flex-1 overflow-auto bg-bg">
          {activeTab === 'forms' ? (
            <Suspense fallback={<div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>}>
              <FormBuilder />
            </Suspense>
          ) : (
          <div className="p-6 lg:p-8 max-w-7xl">

            {activeTab === "dashboard"   && <AdminAnalyticsDashboard isReadOnly={isReadOnly} user={user} />}
            {activeTab === "companies"   && <CompanyManagement />}
            {activeTab === "sale-search" && <SaleSearchPanel />}
            {activeTab === "features"    && <FeatureFlagsManager />}
          </div>
          )}
          <DevCredit />
        </main>
      </div>
    </div>
  );
};

export default AdminPanel;
