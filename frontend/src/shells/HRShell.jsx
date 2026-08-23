// ============================================================================
// HRShell -- the /hr surface. Thin, same reasoning as AccountingShell; the
// chrome is shared through ModuleShell.
//
// Tab visibility comes from GET /hr/my-scope, which also reports whether the
// caller has an hr_employees record. That matters: without one, every
// self-service tab is empty by definition, and the banner says so once at the
// top instead of letting four tabs each render a confusing blank.
// ============================================================================
import { Users, CalendarDays, CalendarCheck, Banknote, ClipboardList, IdCard } from 'lucide-react';
import ModuleShell from '../components/Modules/ModuleShell';
import { Alert } from '../components/UI';
import EmployeeDirectory from '../pages/hr/EmployeeDirectory';
import AttendancePage from '../pages/hr/AttendancePage';
import LeavePage from '../pages/hr/LeavePage';
import PayrollPage from '../pages/hr/PayrollPage';
import ReviewsPage from '../pages/hr/ReviewsPage';

const buildTabs = (p) => [
  { key: 'people',     label: 'People',     icon: Users,         show: !!p['hr.employees.view'] },
  { key: 'attendance', label: 'Attendance', icon: CalendarDays,  show: !!p['hr.attendance.view_own'] || !!p['hr.attendance.view_team'] },
  { key: 'leave',      label: 'Leave',      icon: CalendarCheck, show: !!p['hr.leave.request'] || !!p['hr.leave.view_team'] },
  { key: 'payroll',    label: 'Payroll',    icon: Banknote,      show: !!p['hr.payroll.view_own'] || !!p['hr.payroll.view'] || !!p['hr.payroll.manage'] },
  { key: 'reviews',    label: 'Reviews',    icon: ClipboardList, show: !!p['hr.reviews.participate'] || !!p['hr.reviews.view_team'] || !!p['hr.reviews.manage'] },
];

// Said once, here, rather than in four different empty states. A manager
// looking at someone else's company legitimately has no record of their own,
// so this only fires for people whose access IS the self-service kind.
const banner = (scope) => {
  const p = scope.permissions || {};
  const selfServiceOnly = !scope.employee
    && !p['hr.employees.manage'] && !p['hr.payroll.manage'] && !p['hr.reviews.manage'];
  if (!selfServiceOnly) return null;
  return (
    <Alert type="info" dismissible={false} className="mb-4">
      You do not have an employee record in this company yet, so your attendance, leave, payslips and review
      have nothing to attach to. Ask HR to create one and link it to your login.
    </Alert>
  );
};

export default function HRShell() {
  return (
    <ModuleShell
      moduleKey="hr"
      title="People"
      icon={IdCard}
      defaultTab="people"
      buildTabs={buildTabs}
      banner={banner}
      render={(tab, scope) => (
        <>
          {tab === 'people'     && <EmployeeDirectory scope={scope} />}
          {tab === 'attendance' && <AttendancePage scope={scope} />}
          {tab === 'leave'      && <LeavePage scope={scope} />}
          {tab === 'payroll'    && <PayrollPage scope={scope} />}
          {tab === 'reviews'    && <ReviewsPage scope={scope} />}
        </>
      )}
    />
  );
}
