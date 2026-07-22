import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { usePersistedState } from "../hooks/usePersistedState";
import { useAuth } from "../contexts/AuthContext";
import { useCopyGuard } from "../hooks/useCopyGuard";
import { roBeacon } from "../utils/roActivityBeacon";
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
import CustomerProfile from "../components/Admin/CustomerProfile/CustomerProfile";
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
import DataCleanup from "../components/Admin/DataCleanup/DataCleanup";
import VicidialAdmin from "../components/Admin/Vicidial/VicidialAdmin";
import TaskBoardsAdmin from "../components/Admin/TaskBoards/TaskBoardsAdmin";
import VehicleManager from "../components/Admin/Vehicles/VehicleManager";
import ClientPlanManager from "../components/Admin/ClientPlans/ClientPlanManager";
import BusinessRulesHub from "../components/Admin/BusinessRules/BusinessRulesHub";
import BlacklistSettings from "../components/Admin/Blacklist/BlacklistSettings";
import ReadonlyAdminManager from "../components/Admin/ReadonlyAdmins/ReadonlyAdminManager";
import EgressGovernance from "../components/Admin/EgressGovernance/EgressGovernance";
import BrandingManager from "../components/Admin/Branding/BrandingManager";
import AppearanceManager from "../components/Admin/Appearance/AppearanceManager";
import NumberAssignmentPanel from "../components/Numbers/NumberAssignmentPanel";
import { useFeatureFlags } from "../contexts/FeatureFlagsContext";
import EventsCalendar from "../components/Calendar/EventsCalendar";
import EngagementBanners from "../components/Engagement/EngagementBanners";
import PaymentRemindersPanel from "../components/Payments/PaymentRemindersPanel";
import ActivityPanel from "../components/Admin/ActivityPanel";
import BatchInbox from "../components/Distribution/BatchInbox";
import BatchRoster from "../components/Distribution/BatchRoster";
import NoteShortcodesManager from "../components/Numbers/NoteShortcodesManager";
import client from "../api/client";
import DotGridBg from "../components/UI/DotGridBg";

// ============================================================================
// AdminPanel — main component
// ============================================================================
const AdminPanel = () => {
  const { user, logout, hasPermission, roTabAllowed, roNoCopy, roFlag } = useAuth();
  const rootRef = useRef(null);
  const { isEnabled } = useFeatureFlags();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const updateAvailable = useVersionCheck();
  const [activeTab, setActiveTab]     = usePersistedState("biztrix.adminTab", "dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const notifHook = useNotifications();

  const handleLogout = () => { logout(); navigate("/login"); };

  const isReadOnly = user?.role === 'readonly_admin';

  // Copy-protection: when the SuperAdmin turns on `no_copy` for this RO, the
  // shell root carries the `copy-locked` class (CSS user-select:none) from the
  // FIRST paint — governance rides on the user object synchronously, so there
  // is no flash. useCopyGuard adds the JS block layer + reports blocked copies.
  useCopyGuard(roNoCopy, rootRef, (kind) => roBeacon.copyBlocked(kind));

  // Navigation telemetry for readonly_admin (soft, best-effort) — the SuperAdmin
  // sees which tabs the RO opened on the Readonly Admins → Activity timeline.
  useEffect(() => { if (isReadOnly) roBeacon.install(); }, [isReadOnly]);
  useEffect(() => { if (isReadOnly && activeTab) roBeacon.tabOpen(activeTab); }, [isReadOnly, activeTab]);
  // A persisted/deep-linked activeTab must never render a tab the SuperAdmin
  // removed — the render switch below isn't nav-gated, so bounce a disallowed
  // tab back to the dashboard (the backend still enforces the data separately).
  useEffect(() => {
    if (isReadOnly && activeTab && !roTabAllowed(activeTab)) setActiveTab('dashboard');
  }, [isReadOnly, activeTab, roTabAllowed, setActiveTab]);

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
    ...(isSAorRO                                       ? [{ id: "customer-profiles", label: "Customer Profiles"  }] : []),
    ...(isSAorRO                                       ? [{ id: "numbers",        label: "Numbers Intelligence" }] : []),
    ...(isSAorRO                                       ? [{ id: "data-analyzer",  label: "Data Analyzer"        }] : []),
    // Batch distribution inbox — superadmin manages their own sent batches
    // (created_by=me) + an "All" view (BatchInbox's built-in superadmin scoping).
    ...(user?.role === 'superadmin'                    ? [{ id: "batches",        label: "Batches"              }] : []),
    ...(user?.role === 'superadmin'                    ? [{ id: "roster",         label: "Assigned Numbers"     }] : []),
    ...(user?.role === 'superadmin'                    ? [{ id: "note-shortcodes",label: "Note Shortcuts"       }] : []),
    // Data Cleanup is a destructive batch tool — superadmin only (never RO).
    ...(user?.role === 'superadmin'                    ? [{ id: "data-cleanup",   label: "Data Cleanup"         }] : []),
    ...(user?.role === 'superadmin'                    ? [{ id: "vicidial",       label: "VICIdial"             }] : []),
    ...(user?.role === 'superadmin'                    ? [{ id: "task-boards",    label: "Task Boards"          }] : []),
    ...((isSAorRO || hasPermission('manage_faqs'))     ? [{ id: "faqs",           label: "FAQs"                 }] : []),
    ...((isSAorRO || hasPermission('manage_faqs'))     ? [{ id: "scripts",        label: "Scripts"              }] : []),
    ...(isSAorRO                                       ? [{ id: "bulk-upload",    label: "Bulk Upload"          }] : []),
    ...(isSAorRO                                       ? [{ id: "announcements",  label: "Announcements"        }] : []),
    ...(isSAorRO                                       ? [{ id: "marquee",        label: "Marquee"              }] : []),
    ...(isSAorRO                                       ? [{ id: "spiff",          label: "SPIFF"                }] : []),
    ...(isSAorRO                                       ? [{ id: "payments",       label: "Payment Reminders"    }] : []),
    ...(isSAorRO                                       ? [{ id: "chat",           label: "Chat Control"         }] : []),
    ...(isSAorRO                                       ? [{ id: "features",       label: "Features"             }] : []),
    ...(isSAorRO                                       ? [{ id: "business-rules", label: "Business Rules"       }] : []),
    ...(user?.role === 'superadmin'                    ? [{ id: "blacklist",      label: "Blacklist / DNC"      }] : []),
    ...(user?.role === 'superadmin'                    ? [{ id: "egress",         label: "Data Egress"          }] : []),
    ...(user?.role === 'superadmin'                    ? [{ id: "branding",       label: "Branding & SEO"       }] : []),
    ...(user?.role === 'superadmin'                    ? [{ id: "appearance",     label: "Appearance"           }] : []),
    ...(isSAorRO && isEnabled('number_assignment')     ? [{ id: "number-lists",   label: "Number Assignment"    }] : []),
    // SuperAdmin-only management of readonly_admin users (count, nav config, create/revoke).
    ...(user?.role === 'superadmin'                    ? [{ id: "readonly-admins", label: "Readonly Admins"     }] : []),
  ].filter(item => roTabAllowed(item.id));   // RO: governance.nav allowlist (null = parity); non-RO = always true

  return (
    <div ref={rootRef} className={`min-h-screen bg-bg relative${roNoCopy ? ' copy-locked' : ''}`}>
      <DotGridBg />
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

        <main className="flex-1 overflow-auto relative z-10">
          {activeTab === 'forms' ? (
            <Suspense fallback={<div className="flex justify-center py-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>}>
              <FormBuilder />
            </Suspense>
          ) : activeTab === 'companies' ? (
            <div className="p-3 h-full">
              <CompanyManagement />
            </div>
          ) : (
            // Every admin tab fills the full content width (Compliance-shell
            // style) with responsive padding — no centered max-w cap that
            // strands empty margins on wide monitors. Individual panels lay
            // their own content out in grids so the space is used, not stretched.
            (() => {
              const wrap = 'px-4 sm:px-6 lg:px-8 py-5 w-full';
              return (
                <div className={wrap}>
                  {/* One read-only alert on EVERY admin tab, toggleable by the
                      SuperAdmin (show_readonly_badge). When off, no banner shows. */}
                  {isReadOnly && roFlag('show_readonly_badge') && (
                    <div className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg text-xs font-medium"
                      style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-200, #fde68a)', color: 'var(--color-warning-700, #b45309)' }}>
                      <span aria-hidden>🔒</span>
                      Read-only admin — view only, no modifications.
                    </div>
                  )}
                  {activeTab === "dashboard"   && <AdminAnalyticsDashboard isReadOnly={isReadOnly} user={user} />}
                  {activeTab === "calendar"    && <EventsCalendar canEdit={user?.role === 'superadmin'} />}
                  {activeTab === "sale-search" && <LeadIntelligence />}
                  {activeTab === "customer-profiles" && <CustomerProfile />}
                  {activeTab === "numbers"     && <NumbersIntelligence />}
                  {activeTab === "data-analyzer" && <DataAnalyzer />}
                  {activeTab === "batches" && <BatchInbox />}
                  {activeTab === "roster" && <BatchRoster />}
                  {activeTab === "note-shortcodes" && <NoteShortcodesManager />}
                  {activeTab === "data-cleanup" && <DataCleanup />}
                  {activeTab === "vicidial" && <VicidialAdmin />}
                  {activeTab === "task-boards" && <TaskBoardsAdmin />}
                  {activeTab === "vehicles"     && <VehicleManager />}
                  {activeTab === "clients-plans" && <ClientPlanManager />}
                  {activeTab === "faqs"        && <FAQManager />}
                  {activeTab === "scripts"     && <ScriptManager />}
                  {activeTab === "bulk-upload" && <BulkUploadHub />}
                  {activeTab === "announcements" && <AnnouncementsManager />}
                  {activeTab === "marquee"       && <MarqueeManager />}
                  {activeTab === "spiff"         && <SpiffManager />}
                  {activeTab === "payments"      && <PaymentRemindersPanel />}
                  {activeTab === "chat"          && <ChatAdmin />}
                  {activeTab === "features"    && <FeatureFlagsManager />}
                  {activeTab === "business-rules" && <BusinessRulesHub />}
                  {activeTab === "blacklist" && <BlacklistSettings />}
                  {activeTab === "egress"       && <EgressGovernance />}
                  {activeTab === "branding"     && <BrandingManager />}
                  {activeTab === "appearance"   && <AppearanceManager />}
                  {activeTab === "number-lists" && <NumberAssignmentPanel user={user} />}
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
