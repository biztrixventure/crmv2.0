// ============================================================================
// HRShell -- the /hr surface. Thin, same reasoning as AccountingShell; the
// chrome is shared through ModuleShell.
//
// Tab visibility comes from GET /hr/my-scope, which also reports whether the
// caller has an hr_employees record. That matters: without one, every
// self-service tab is empty by definition, and the banner says so once at the
// top instead of letting four tabs each render a confusing blank.
//
// Layout (stage 2 -- fewer, plainer tabs):
//   Home        what is waiting for a decision
//   People      directory, leavers to confirm, each person's moves
//   Time        attendance + leave (one question: were they working?)
//   Pay         payroll
//   Reviews     performance reviews
//   Settings    every rule HR follows for this company, editable
//   Change log  who changed what, when, why
// Staff reach their OWN payslips/leave/attendance from "My HR" in their shell.
// ============================================================================
import { Home, Users, CalendarDays, Banknote, ClipboardList, IdCard, History, Settings } from 'lucide-react';
import ModuleShell from '../components/Modules/ModuleShell';
import { Alert } from '../components/UI';
import { needsOwnEmployeeRecord } from '../utils/hrScope';
import HRHome from '../pages/hr/HRHome';
import EmployeeDirectory from '../pages/hr/EmployeeDirectory';
import TimePage from '../pages/hr/TimePage';
import PayrollPage from '../pages/hr/PayrollPage';
import ReviewsPage from '../pages/hr/ReviewsPage';
import HRSettingsPage from '../pages/hr/HRSettingsPage';
import ChangeLogPage from '../pages/modules/ChangeLogPage';

const buildTabs = (p) => [
  { key: 'home',     label: 'Home',       icon: Home,          show: !!p['hr.employees.view'] },
  { key: 'people',   label: 'People',     icon: Users,         show: !!p['hr.employees.view'] },
  { key: 'time',     label: 'Time',       icon: CalendarDays,  show: !!p['hr.attendance.view_own'] || !!p['hr.attendance.view_team'] || !!p['hr.leave.request'] || !!p['hr.leave.view_team'] },
  { key: 'pay',      label: 'Pay',        icon: Banknote,      show: !!p['hr.payroll.view_own'] || !!p['hr.payroll.view'] || !!p['hr.payroll.manage'] },
  { key: 'reviews',  label: 'Reviews',    icon: ClipboardList, show: !!p['hr.reviews.participate'] || !!p['hr.reviews.view_team'] || !!p['hr.reviews.manage'] },
  { key: 'settings', label: 'Settings',   icon: Settings,      show: !!p['hr.employees.view'] },
  { key: 'history',  label: 'Change log', icon: History,       show: !!p['hr.history.view'] },
];

// Said once, here, rather than in four different empty states. A manager
// looking at someone else's company legitimately has no record of their own,
// so this only fires for people whose access IS the self-service kind.
const banner = (scope) => {
  // Only the self-service audience. An HR manager with no employee record is
  // normal -- especially in a company they were DESIGNATED into rather than
  // employed by -- and telling them to "ask HR" when they are HR is nonsense.
  if (!needsOwnEmployeeRecord(scope)) return null;
  return (
    <Alert type="info" dismissible={false} className="mb-4">
      You do not have an employee record in this company yet, so your attendance, leave, payslips and review
      have nothing to attach to. It is created automatically from your CRM login -- if this persists, ask HR.
    </Alert>
  );
};

export default function HRShell() {
  return (
    <ModuleShell
      moduleKey="hr"
      title="HR"
      icon={IdCard}
      defaultTab="home"
      buildTabs={buildTabs}
      banner={banner}
      render={(tab, scope, goTo) => (
        <>
          {tab === 'home'     && <HRHome scope={scope} goTo={goTo} />}
          {tab === 'people'   && <EmployeeDirectory scope={scope} />}
          {tab === 'time'     && <TimePage scope={scope} />}
          {tab === 'pay'      && <PayrollPage scope={scope} />}
          {tab === 'reviews'  && <ReviewsPage scope={scope} />}
          {tab === 'settings' && <HRSettingsPage scope={scope} />}
          {tab === 'history'  && <ChangeLogPage module="hr" scope={scope} />}
        </>
      )}
    />
  );
}
