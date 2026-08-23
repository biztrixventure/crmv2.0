// ============================================================================
// QA2Shell.jsx -- QA v2's isolated shell (build brief section 9). Kept thin
// on purpose: v1's QAShell.jsx grew to 5,039 lines by putting every tab's
// content directly in the shell; every tab here is its own file under
// components/QA2/ instead.
//
// The header is the REAL AppHeader, the same one every other shell uses -- it
// is what carries mail, chat, the notification bell (with push enrolment), the
// theme toggle, the profile card and logout. This shell originally hand-rolled
// a thin strip with just a theme link and an email address, which quietly cost
// a QA agent their inbox and their notifications for as long as they were in
// here. QA-specific controls (the tab strip) sit in a sub-bar under it, so
// AppHeader itself is untouched and no other shell is affected.
//
// Tab visibility mixes two sources deliberately:
//   - hasPermission('qa2.*') for anything the STATIC role_permissions grant
//     already covers (qa_manager, qa_agent, base compliance_manager grants).
//   - GET /qa2/my-scope for the one thing that can't be a static permission:
//     a compliance_manager's live qa2_manager_access TOGGLE (mig 232) is a
//     runtime fact, not a role grant, so the frontend has to ask for it
//     directly rather than trust the permissions array alone.
// ============================================================================

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Users, ListChecks, Inbox, FileSpreadsheet, ShieldCheck, ListTodo, Scale, BarChart3, CalendarClock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useHistoryTab } from '../hooks/useHistoryTab';
import { useNotifications } from '../hooks/useNotifications';
import { useVersionCheck } from '../hooks/useVersionCheck';
import { getRoleRoute } from '../utils/roleRouting';
import client from '../api/client';
import { AppHeader } from '../components/Layout';
import DotGridBg from '../components/UI/DotGridBg';
import UpdateBanner from '../components/UI/UpdateBanner';
import { PillTabs, Loading } from '../components/UI/kit';
import OrgTab from '../components/QA2/OrgTab';
import TeamTab from '../components/QA2/TeamTab';
import MethodsTab from '../components/QA2/MethodsTab';
import UnclassifiedTab from '../components/QA2/UnclassifiedTab';
import FormsTab from '../components/QA2/FormsTab';
import QueueTab from '../components/QA2/QueueTab';
import PoolTab from '../components/QA2/PoolTab';
import CalibrationTab from '../components/QA2/CalibrationTab';
import ReportsTab from '../components/QA2/ReportsTab';
import LoadDayTab from '../components/QA2/LoadDayTab';

export default function QA2Shell() {
  const { user, hasPermission, logout, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const notifHook = useNotifications();
  const updateAvailable = useVersionCheck();
  const [scope, setScope] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let dead = false;
    client.get('qa2/my-scope')
      .then(r => { if (!dead) setScope(r.data); })
      .catch(e => { if (!dead) setLoadError(e.response?.data?.error || 'Could not load your QA v2 access'); });
    return () => { dead = true; };
  }, []);

  const isCompliance = !!scope?.isCompliance;
  const managerAccess = !!scope?.managerAccess || hasPermission('qa2.manage_methods');

  const canQueue = hasPermission('qa2.view_queue');
  const canViewReports = hasPermission('qa2.view_reports') || isCompliance;

  const tabs = [
    { key: 'queue',        label: 'My Queue',       icon: ListTodo,        show: canQueue },
    { key: 'pool',         label: 'Pool',            icon: Inbox,           show: canQueue },
    { key: 'forms',        label: 'Form Builder',  icon: FileSpreadsheet, show: managerAccess || isCompliance },
    { key: 'methods',      label: 'Methods',        icon: ListChecks,      show: managerAccess || isCompliance },
    { key: 'unclassified', label: 'Unclassified',   icon: Inbox,           show: managerAccess },
    { key: 'loadday',      label: 'Load Day',       icon: CalendarClock,   show: managerAccess },
    { key: 'team',         label: 'Team',           icon: Users,           show: managerAccess },
    { key: 'calibration',  label: 'Calibration',    icon: Scale,           show: managerAccess || isCompliance },
    { key: 'reports',      label: 'Reports',        icon: BarChart3,       show: canViewReports },
    { key: 'org',          label: 'Org',            icon: ShieldCheck,     show: isCompliance },
  ].filter(t => t.show);

  const [tab, setTab] = useHistoryTab(null, 'forms', { persist: false });
  const activeTab = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key || null);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen relative" style={{ backgroundColor: 'var(--color-bg)' }}>
      <DotGridBg />
      {updateAvailable && <UpdateBanner />}

      <AppHeader
        title="QA v2"
        logo={
          <div className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--gradient-sidebar)' }}>
            <Building2 className="text-white" size={22} />
          </div>
        }
        companyLogoUrl={user?.company_logo_url}
        theme={theme} onThemeToggle={toggleTheme}
        userEmail={user?.email}
        userRole={user?.role_name || user?.role}
        onLogout={handleLogout}
        user={user} onUpdateUser={updateUser}
        notifications={notifHook.notifications}
        unreadCount={notifHook.unreadCount}
        onMarkRead={notifHook.markRead}
        onMarkAllRead={notifHook.markAllRead}
        onDeleteNotification={notifHook.deleteNotification}
        onClearNotifications={notifHook.clearAll}
        onBrandClick={() => navigate(getRoleRoute(user?.role))}
      />

      {/* QA v2 sub-bar. Kept out of AppHeader so the shared header stays
          identical across every shell. */}
      <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-8 py-2.5 border-b relative z-10 flex-wrap"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        {!scope && !loadError && <Loading variant="inline" size={16} />}
        {loadError && <span className="text-xs" style={{ color: 'var(--color-error-600)' }}>{loadError}</span>}
        {scope && tabs.length > 0 && <PillTabs items={tabs} value={activeTab} onChange={setTab} />}
      </div>

      <main className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6 sm:py-8 relative z-10">
        {!scope && !loadError && <Loading variant="cards" />}
        {scope && tabs.length === 0 && (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Your role has no QA v2 access yet.
          </div>
        )}
        {activeTab === 'queue' && <QueueTab scope={scope} />}
        {activeTab === 'pool' && <PoolTab scope={scope} />}
        {activeTab === 'forms' && <FormsTab scope={scope} />}
        {activeTab === 'methods' && <MethodsTab scope={scope} />}
        {activeTab === 'unclassified' && <UnclassifiedTab scope={scope} />}
        {activeTab === 'loadday' && <LoadDayTab scope={scope} />}
        {activeTab === 'team' && <TeamTab scope={scope} />}
        {activeTab === 'calibration' && <CalibrationTab scope={scope} />}
        {activeTab === 'reports' && <ReportsTab scope={scope} />}
        {activeTab === 'org' && <OrgTab scope={scope} />}
      </main>
    </div>
  );
}
