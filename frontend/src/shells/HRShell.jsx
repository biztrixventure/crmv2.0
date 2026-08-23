// ============================================================================
// HRShell -- the /hr surface. Thin, same reasoning as AccountingShell.
//
// Tab visibility comes from GET /hr/my-scope, which also reports whether the
// caller has an hr_employees record. That matters: without one, every
// self-service tab is empty by definition, and the shell says so once at the
// top instead of letting four tabs each render a confusing blank.
// ============================================================================
import { useState, useEffect } from 'react';
import { LogOut, Users, CalendarDays, CalendarCheck, Banknote, ClipboardList, ArrowLeft, IdCard } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useHistoryTab } from '../hooks/useHistoryTab';
import { getRoleRoute } from '../utils/roleRouting';
import client from '../api/client';
import DotGridBg from '../components/UI/DotGridBg';
import { PillTabs, Loading, EmptyState } from '../components/UI/kit';
import { Alert } from '../components/UI';
import EmployeeDirectory from '../pages/hr/EmployeeDirectory';
import AttendancePage from '../pages/hr/AttendancePage';
import LeavePage from '../pages/hr/LeavePage';
import PayrollPage from '../pages/hr/PayrollPage';
import ReviewsPage from '../pages/hr/ReviewsPage';

export default function HRShell() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [scope, setScope] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let dead = false;
    client.get('hr/my-scope')
      .then(r => { if (!dead) setScope({ ...r.data, user_id: user?.id }); })
      .catch(e => { if (!dead) setLoadError(e.response?.data?.error || 'Could not load your HR access'); });
    return () => { dead = true; };
  }, [user?.id]);

  const p = scope?.permissions || {};
  const tabs = [
    { key: 'people',     label: 'People',     icon: Users,          show: !!p['hr.employees.view'] },
    { key: 'attendance', label: 'Attendance', icon: CalendarDays,   show: !!p['hr.attendance.view_own'] || !!p['hr.attendance.view_team'] },
    { key: 'leave',      label: 'Leave',      icon: CalendarCheck,  show: !!p['hr.leave.request'] || !!p['hr.leave.view_team'] },
    { key: 'payroll',    label: 'Payroll',    icon: Banknote,       show: !!p['hr.payroll.view_own'] || !!p['hr.payroll.view'] || !!p['hr.payroll.manage'] },
    { key: 'reviews',    label: 'Reviews',    icon: ClipboardList,  show: !!p['hr.reviews.participate'] || !!p['hr.reviews.view_team'] || !!p['hr.reviews.manage'] },
  ].filter(t => t.show);

  const [tab, setTab] = useHistoryTab(null, 'people', { persist: false });
  const activeTab = tabs.some(t => t.key === tab) ? tab : (tabs[0]?.key || null);

  // Self-service tabs need an employee record to point at. Say it once, here,
  // rather than in four different empty states.
  const selfServiceOnly = scope && !scope.employee &&
    !p['hr.employees.manage'] && !p['hr.payroll.manage'] && !p['hr.reviews.manage'];

  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: 'var(--color-bg)' }}>
      <DotGridBg />
      <header className="flex items-center gap-4 px-5 py-3 border-b relative z-10 flex-wrap"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 font-extrabold" style={{ color: 'var(--color-text)' }}>
          <IdCard size={20} style={{ color: 'var(--color-primary-600)' }} /> People
        </div>
        {!scope && !loadError && <Loading variant="inline" size={16} />}
        {loadError && <span className="text-xs" style={{ color: 'var(--color-error-600)' }}>{loadError}</span>}
        {scope && tabs.length > 0 && <PillTabs items={tabs} value={activeTab} onChange={setTab} />}
        <div className="ml-auto flex items-center gap-3">
          <button onClick={() => navigate(getRoleRoute(user?.role))}
            className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            <ArrowLeft size={14} />My dashboard
          </button>
          <button onClick={toggleTheme} className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{user?.email}</span>
          <button onClick={logout} className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            <LogOut size={14} />Logout
          </button>
        </div>
      </header>

      <main className="flex-1 p-2 sm:p-5 overflow-auto relative z-10">
        {!scope && !loadError && <Loading variant="cards" />}
        {scope && tabs.length === 0 && (
          <EmptyState icon={Users} title="No HR access"
            hint="Your role does not include the HR module. A superadmin can grant it from the User Control Center." />
        )}
        {selfServiceOnly && (
          <Alert type="info" dismissible={false} className="mb-4">
            You do not have an employee record in this company yet, so your attendance, leave, payslips and review
            have nothing to attach to. Ask HR to create one and link it to your login.
          </Alert>
        )}
        {activeTab === 'people'     && <EmployeeDirectory scope={scope} />}
        {activeTab === 'attendance' && <AttendancePage scope={scope} />}
        {activeTab === 'leave'      && <LeavePage scope={scope} />}
        {activeTab === 'payroll'    && <PayrollPage scope={scope} />}
        {activeTab === 'reviews'    && <ReviewsPage scope={scope} />}
      </main>
    </div>
  );
}
