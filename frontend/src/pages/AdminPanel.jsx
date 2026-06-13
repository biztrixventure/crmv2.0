import { useState, useEffect, lazy, Suspense } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
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
import DataAnalyzer from "../components/Admin/DataAnalyzer/DataAnalyzer";
import VehicleManager from "../components/Admin/Vehicles/VehicleManager";
import ClientPlanManager from "../components/Admin/ClientPlans/ClientPlanManager";
import BusinessRulesHub from "../components/Admin/BusinessRules/BusinessRulesHub";
import ReadonlyAdminManager from "../components/Admin/ReadonlyAdmins/ReadonlyAdminManager";
import EventsCalendar from "../components/Calendar/EventsCalendar";
import EngagementBanners from "../components/Engagement/EngagementBanners";
import ActivityPanel from "../components/Admin/ActivityPanel";
import client from "../api/client";

// ============================================================================
// AdminPanel — main component
// ============================================================================
const AdminPanel = () => {
  const { user, logout, hasPermission } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const updateAvailable = useVersionCheck();
  const [activeTab, setActiveTab]     = usePersistedState("biztrix.adminTab", "dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const notifHook = useNotifications();

  const handleLogout = () => { logout(); navigate("/login"); };

  const isReadOnly = user?.role === 'readonly_admin';

  // Per-user nav allowlist for readonly_admin. SuperAdmin sees everything;
  // a readonly_admin's sidebar is narrowed to the IDs listed in
  // business_config.readonly_admin.nav.<their_uid>. Empty / missing config
  // = full SA parity (matches the no-config default the manager UI
  // documents). We fetch directly so this doesn't compete with the
  // useShellLayout cache used for the per-shell layouts.
  const [roNavAllow, setRoNavAllow] = useState(null);
  useEffect(() => {
    if (!isReadOnly || !user?.id) { setRoNavAllow(null); return; }
    let cancelled = false;
    client.get('business-config').then(r => {
      if (cancelled) return;
      const cfg = r.data?.config || {};
      const list = cfg[`readonly_admin.nav.${user.id}`];
      setRoNavAllow(Array.isArray(list) ? list : null);
    }).catch(() => setRoNavAllow(null));
    return () => { cancelled = true; };
  }, [isReadOnly, user?.id]);

  // Allow AdminAnalyticsDashboard quick-action buttons to navigate
  useEffect(() => {
    const handler = e => setActiveTab(e.detail);
    document.addEventListener('admin-nav', handler);
    return () => document.removeEventListener('admin-nav', handler);
  }, []);

  // Tell the assistant which section is open so its guidance is section-specific.
  useEffect(() => { window.crmAssistant?.setSection?.(activeTab); }, [activeTab]);

  // readonly_admin = SuperAdmin replica without writes. UI shows the same
  // tabs the superadmin sees; the backend readonlyGuard (middleware) 403s
  // every POST/PUT/DELETE so any visible Save/Delete button is a no-op.
  // Companies inside each per-page surface respect isReadOnly individually
  // (forms/business-rules render disabled inputs, etc).
  const isSAorRO = user?.role === 'superadmin' || isReadOnly;
  const navItems = [
    { id: "dashboard",   label: "Dashboard"    },
    { id: "calendar",    label: "Calendar"     },
    // Cross-company shortcuts → ComplianceShell. RO sees them too (no writes).
    ...(isSAorRO ? [
      { id: "cc-sales",     label: "All Sales"     },
      { id: "cc-transfers", label: "All Transfers" },
      { id: "cc-callbacks", label: "All Callbacks" },
    ] : []),
    ...(isSAorRO                                       ? [{ id: "companies",      label: "Companies"            }] : []),
    ...(isSAorRO && hasPermission('manage_forms')      ? [{ id: "forms",          label: "Form Builder"         }] : []),
    ...(hasPermission('search_sales')                  ? [{ id: "sale-search",    label: "Lead Search"          }] : []),
    ...(isSAorRO                                       ? [{ id: "numbers",        label: "Numbers Intelligence" }] : []),
    ...(isSAorRO                                       ? [{ id: "data-analyzer",  label: "Data Analyzer"        }] : []),
    ...((isSAorRO || hasPermission('manage_faqs'))     ? [{ id: "faqs",           label: "FAQs"                 }] : []),
    ...((isSAorRO || hasPermission('manage_faqs'))     ? [{ id: "scripts",        label: "Scripts"              }] : []),
    ...(isSAorRO                                       ? [{ id: "bulk-upload",    label: "Bulk Upload"          }] : []),
    ...(isSAorRO                                       ? [{ id: "announcements",  label: "Announcements"        }] : []),
    ...(isSAorRO                                       ? [{ id: "marquee",        label: "Marquee"              }] : []),
    ...(isSAorRO                                       ? [{ id: "spiff",          label: "SPIFF"                }] : []),
    ...(isSAorRO                                       ? [{ id: "chat",           label: "Chat Control"         }] : []),
    ...(isSAorRO                                       ? [{ id: "features",       label: "Features"             }] : []),
    ...(isSAorRO                                       ? [{ id: "business-rules", label: "Business Rules"       }] : []),
    // SuperAdmin-only management of readonly_admin users (count, nav config, create/revoke).
    ...(user?.role === 'superadmin'                    ? [{ id: "readonly-admins", label: "Readonly Admins"     }] : []),
  ].filter(item => {
    // readonly_admin: when a personal allowlist exists, narrow nav to its IDs.
    // No allowlist (null) = full SA parity (already filtered above). Keep
    // 'dashboard' always so the user lands somewhere even on a misconfig.
    if (!isReadOnly || !Array.isArray(roNavAllow)) return true;
    return item.id === 'dashboard' || roNavAllow.includes(item.id);
  });

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
            // Data-heavy tabs (analyzer / search / numbers / bulk / chat /
            // dashboard) drop the max-w cap so the table grids breathe on big
            // monitors instead of leaving 30% of the screen as empty margins.
            // Form-style tabs (vehicles, clients-plans, faqs, scripts, etc.)
            // keep a comfortable reading width — wide forms feel awkward.
            (() => {
              const WIDE = new Set(['dashboard', 'data-analyzer', 'sale-search', 'numbers', 'bulk-upload', 'chat', 'announcements', 'marquee', 'spiff', 'business-rules']);
              const wrap = WIDE.has(activeTab)
                ? 'p-4 lg:p-6 w-full'
                : 'p-4 lg:p-6 max-w-7xl mx-auto w-full';
              return (
                <div className={wrap}>
                  {activeTab === "dashboard"   && <AdminAnalyticsDashboard isReadOnly={isReadOnly} user={user} />}
                  {activeTab === "calendar"    && <EventsCalendar canEdit={user?.role === 'superadmin'} />}
                  {activeTab === "sale-search" && <LeadIntelligence />}
                  {activeTab === "numbers"     && <NumbersIntelligence />}
                  {activeTab === "data-analyzer" && <DataAnalyzer />}
                  {activeTab === "vehicles"     && <VehicleManager />}
                  {activeTab === "clients-plans" && <ClientPlanManager />}
                  {activeTab === "faqs"        && <FAQManager />}
                  {activeTab === "scripts"     && <ScriptManager />}
                  {activeTab === "bulk-upload" && <BulkUploadHub />}
                  {activeTab === "announcements" && <AnnouncementsManager />}
                  {activeTab === "marquee"       && <MarqueeManager />}
                  {activeTab === "spiff"         && <SpiffManager />}
                  {activeTab === "chat"          && <ChatAdmin />}
                  {activeTab === "features"    && <FeatureFlagsManager />}
                  {activeTab === "business-rules" && <BusinessRulesHub />}
                  {activeTab === "readonly-admins" && <ReadonlyAdminManager />}
                  <DevCredit />
                </div>
              );
            })()
          )}
        </main>
      </div>

      {/* Slide-out user-activity monitor — arrow tab on the right edge,
          opposite the sidebar. Live presence + per-user activity insights. */}
      <ActivityPanel />
    </div>
  );
};

export default AdminPanel;
