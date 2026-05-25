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
import AdminAnalyticsDashboard from "../components/Admin/AdminAnalyticsDashboard";
import LeadIntelligence from "../components/Admin/LeadIntelligence";
import NumbersIntelligence from "../components/Admin/NumbersIntelligence";
const FormBuilder = lazy(() => import("../components/Admin/FormBuilder/FormBuilder"));
import FeatureFlagsManager from "../components/Admin/FeatureFlagsManager";
import FAQManager from "../components/Admin/FAQManager/FAQManager";
import ScriptManager from "../components/Admin/ScriptManager/ScriptManager";
import BulkUploadHub from "../components/Admin/BulkUploader/BulkUploadHub";
import AnnouncementsManager from "../components/Admin/Engagement/AnnouncementsManager";
import MarqueeManager from "../components/Admin/Engagement/MarqueeManager";
import SpiffManager from "../components/Admin/Engagement/SpiffManager";
import ChatAdmin from "../components/Admin/Chat/ChatAdmin";
import EventsCalendar from "../components/Calendar/EventsCalendar";
import EngagementBanners from "../components/Engagement/EngagementBanners";

// ============================================================================
// AdminPanel — main component
// ============================================================================
const AdminPanel = () => {
  const { user, logout, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const updateAvailable = useVersionCheck();
  const [activeTab, setActiveTab]     = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
    { id: "calendar",    label: "Calendar"     },
    ...(!isReadOnly                                   ? [{ id: "companies",   label: "Companies"          }] : []),
    ...(!isReadOnly && hasPermission('manage_forms')  ? [{ id: "forms",       label: "Form Builder"       }] : []),
    ...(hasPermission('search_sales')                 ? [{ id: "sale-search", label: "Lead Search"        }] : []),
    ...(user?.role === 'superadmin'                   ? [{ id: "numbers",     label: "Numbers Intelligence" }] : []),
    ...((user?.role === 'superadmin' || hasPermission('manage_faqs')) ? [{ id: "faqs", label: "FAQs" }] : []),
    ...((user?.role === 'superadmin' || hasPermission('manage_faqs')) ? [{ id: "scripts", label: "Scripts" }] : []),
    ...(user?.role === 'superadmin'                   ? [{ id: "bulk-upload", label: "Bulk Upload" }] : []),
    ...(user?.role === 'superadmin'                   ? [{ id: "announcements", label: "Announcements" }] : []),
    ...(user?.role === 'superadmin'                   ? [{ id: "marquee",       label: "Marquee"       }] : []),
    ...(user?.role === 'superadmin'                   ? [{ id: "spiff",         label: "SPIFF"         }] : []),
    ...(user?.role === 'superadmin'                   ? [{ id: "chat",          label: "Chat Control"  }] : []),
    ...(user?.role === 'superadmin'                   ? [{ id: "features",    label: "Features"           }] : []),
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
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(o => !o)}
      />

      <EngagementBanners />
      <div className="flex" style={{ height: 'calc(100vh - 64px)' }}>
        {sidebarOpen && <AdminSidebar navItems={navItems} activeTab={activeTab} onTabChange={setActiveTab} />}

        <main className="flex-1 overflow-auto bg-bg">
          {activeTab === 'forms' ? (
            <Suspense fallback={<div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>}>
              <FormBuilder />
            </Suspense>
          ) : activeTab === 'companies' ? (
            <div className="p-3 h-full">
              <CompanyManagement />
            </div>
          ) : (
            <div className="p-4 lg:p-6 max-w-7xl mx-auto w-full">
              {activeTab === "dashboard"   && <AdminAnalyticsDashboard isReadOnly={isReadOnly} user={user} />}
              {activeTab === "calendar"    && <EventsCalendar canEdit={user?.role === 'superadmin'} />}
              {activeTab === "sale-search" && <LeadIntelligence />}
              {activeTab === "numbers"     && <NumbersIntelligence />}
              {activeTab === "faqs"        && <FAQManager />}
              {activeTab === "scripts"     && <ScriptManager />}
              {activeTab === "bulk-upload" && <BulkUploadHub />}
              {activeTab === "announcements" && <AnnouncementsManager />}
              {activeTab === "marquee"       && <MarqueeManager />}
              {activeTab === "spiff"         && <SpiffManager />}
              {activeTab === "chat"          && <ChatAdmin />}
              {activeTab === "features"    && <FeatureFlagsManager />}
              <DevCredit />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default AdminPanel;
