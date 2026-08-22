// ============================================================================
// QA2Shell.jsx — QA v2's isolated shell (build brief section 9). Kept thin
// on purpose — v1's QAShell.jsx grew to 5,039 lines by putting every tab's
// content directly in the shell; every tab here is its own file under
// components/QA2/ instead.
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
import { LogOut, Building2, Users, ListChecks, Inbox, FileSpreadsheet, ShieldCheck, ListTodo, Scale, BarChart3, CalendarClock, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useHistoryTab } from '../hooks/useHistoryTab';
import client from '../api/client';
import DotGridBg from '../components/UI/DotGridBg';
import { PillTabs, Loading } from '../components/UI/kit';
import OrgTab from '../components/QA2/OrgTab';
import TeamTab from '../components/QA2/TeamTab';
import AssignTab from '../components/QA2/AssignTab';
import MethodsTab from '../components/QA2/MethodsTab';
import UnclassifiedTab from '../components/QA2/UnclassifiedTab';
import FormsTab from '../components/QA2/FormsTab';
import QueueTab from '../components/QA2/QueueTab';
import PoolTab from '../components/QA2/PoolTab';
import CalibrationTab from '../components/QA2/CalibrationTab';
import ReportsTab from '../components/QA2/ReportsTab';
import LoadDayTab from '../components/QA2/LoadDayTab';

export default function QA2Shell() {
  const { user, hasPermission, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
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
    { key: 'assign',       label: 'Assign Work',    icon: Send,            show: managerAccess },
    { key: 'team',         label: 'Team',           icon: Users,           show: managerAccess },
    { key: 'calibration',  label: 'Calibration',    icon: Scale,           show: managerAccess || isCompliance },
    { key: 'reports',      label: 'Reports',        icon: BarChart3,       show: canViewReports },
    { key: 'org',          label: 'Org',            icon: ShieldCheck,     show: isCompliance },
  ].filter(t => t.show);

  const [tab, setTab] = useHistoryTab(null, 'forms', { persist: false });
  const activeTab = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key || null);

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: 'var(--color-bg)' }}>
      <DotGridBg />
      <header className="flex items-center gap-4 px-5 py-3 border-b relative z-10 flex-wrap"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 font-extrabold" style={{ color: 'var(--color-text)' }}>
          <Building2 size={20} style={{ color: 'var(--color-primary-600)' }} /> QA v2
        </div>
        {!scope && !loadError && <Loading variant="inline" size={16} />}
        {loadError && <span className="text-xs" style={{ color: 'var(--color-error-600)' }}>{loadError}</span>}
        {scope && tabs.length > 0 && (
          <PillTabs items={tabs} value={activeTab} onChange={setTab} />
        )}
        <div className="ml-auto flex items-center gap-3">
          <button onClick={toggleTheme} className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {user?.email}
          </span>
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            <LogOut size={14} />Logout
          </button>
        </div>
      </header>

      <main className="flex-1 p-2 sm:p-5 overflow-auto relative z-10">
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
        {activeTab === 'assign' && <AssignTab />}
        {activeTab === 'team' && <TeamTab scope={scope} />}
        {activeTab === 'calibration' && <CalibrationTab scope={scope} />}
        {activeTab === 'reports' && <ReportsTab scope={scope} />}
        {activeTab === 'org' && <OrgTab scope={scope} />}
      </main>
    </div>
  );
}
