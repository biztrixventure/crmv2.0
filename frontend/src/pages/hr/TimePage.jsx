// ============================================================================
// HR -> Time. Attendance and leave are the same question -- "was this person
// working that day, and if not, why?" -- so they share one tab instead of two.
// The pages themselves are unchanged; this only groups them.
// ============================================================================
import { useState } from 'react';
import { CalendarDays, CalendarCheck } from 'lucide-react';
import { PillTabs } from '../../components/UI/kit';
import AttendancePage from './AttendancePage';
import LeavePage from './LeavePage';

export default function TimePage({ scope }) {
  const p = scope?.permissions || {};
  const items = [
    { key: 'attendance', label: 'Attendance', icon: CalendarDays,  show: !!p['hr.attendance.view_own'] || !!p['hr.attendance.view_team'] },
    { key: 'leave',      label: 'Leave',      icon: CalendarCheck, show: !!p['hr.leave.request'] || !!p['hr.leave.view_team'] },
  ].filter(i => i.show);
  const [view, setView] = useState(items[0]?.key || 'attendance');
  const active = items.some(i => i.key === view) ? view : items[0]?.key;

  return (
    <div className="space-y-4">
      {items.length > 1 && <PillTabs items={items} value={active} onChange={setView} />}
      {active === 'attendance' && <AttendancePage scope={scope} />}
      {active === 'leave' && <LeavePage scope={scope} />}
    </div>
  );
}
