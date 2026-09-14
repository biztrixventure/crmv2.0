// ============================================================================
// MyHR -- the signed-in person's own HR, inside the shell they already use.
//
// One component, every shell (Staff, Manager, Compliance) -- the same pattern
// as TrainingPortal. Before this, a fronter reached their payslip through a
// small "People" text link into a separate module, and filed an expense claim
// inside "Accounting". Now it is a tab next to their work:
//
//   My details   their record, role/position history
//   Payslips     finalized runs only (server resolves "me", never an id)
//   Leave        balances + requests
//   Attendance   their month
//   Expenses     their claims
//
// The four inner tabs ARE the existing HR / Accounting pages, mounted with
// selfOnly so a manager sees only their own record here -- team tools stay in
// the HR module where they belong. The server enforces "only my own rows" on
// every one of those endpoints (selfEmployee / submitted_by), so selfOnly is a
// layout choice, not the security boundary.
// ============================================================================
import { useEffect, useState } from 'react';
import { IdCard, Banknote, CalendarCheck, CalendarDays, Receipt, UserRound, History } from 'lucide-react';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { Panel, SectionHeader, Loading, EmptyState, PillTabs } from '../UI/kit';
import { StatusPill } from './ModuleUI';
import ReasonPromptHost from './ReasonPromptHost';
import { HistoryButton } from './RecordHistory';
import PayrollPage from '../../pages/hr/PayrollPage';
import LeavePage from '../../pages/hr/LeavePage';
import AttendancePage from '../../pages/hr/AttendancePage';
import ExpensesPage from '../../pages/accounting/ExpensesPage';
import { fmtDate } from '../../utils/money';

const EVENT_WORDS = {
  joined: 'Joined', role_changed: 'Role changed', position_changed: 'Position changed',
  department_changed: 'Department changed', left: 'Left', rejoined: 'Rejoined',
  crm_access_removed: 'CRM login switched off', crm_access_restored: 'CRM login switched back on',
};

export function PositionHistory({ employeeId, companyId, compact = false }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    client.get(`hr/people/positions/${employeeId}`, { params: { company_id: companyId || undefined } })
      .then(r => { if (alive) setRows(r.data.history || []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [employeeId, companyId]);

  if (rows === null) return <Loading variant="rows" rows={2} />;
  if (!rows.length) return <EmptyState compact icon={History} title="No moves on record yet" hint="Role changes, promotions and departures appear here." />;
  return (
    <ul className="m-0 p-0 list-none">
      {rows.slice(0, compact ? 6 : 200).map(r => (
        <li key={r.id} className="flex items-baseline gap-2 py-1.5 text-sm flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{EVENT_WORDS[r.event] || r.event}</span>
          {(r.from_value || r.to_value) && (
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {r.from_value ? <><span className="line-through opacity-70">{r.from_value.replace(/_/g, ' ')}</span> → </> : null}
              {r.to_value ? r.to_value.replace(/_/g, ' ') : ''}
            </span>
          )}
          {r.note && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{r.note}</span>}
          <span className="text-xs ml-auto whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>
            {fmtDate(r.effective_at)}{r.changed_by_name ? ' · ' + r.changed_by_name : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MyDetails({ scope }) {
  const [me, setMe] = useState(undefined);
  useEffect(() => {
    let alive = true;
    client.get('hr/employees/me', { params: { company_id: scope.company_id || undefined } })
      .then(r => { if (alive) setMe(r.data.employee || null); })
      .catch(() => { if (alive) setMe(null); });
    return () => { alive = false; };
  }, [scope.company_id]);

  if (me === undefined) return <Loading variant="cards" cards={2} />;
  if (!me) return (
    <EmptyState icon={IdCard} title="No HR record yet"
      hint="Your HR record is created automatically from your CRM login. If this persists, ask your HR manager." />
  );

  const Row = ({ label, value }) => (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider m-0 mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <p className="text-sm m-0" style={{ color: 'var(--color-text)' }}>{value || <span style={{ color: 'var(--color-text-tertiary)' }}>--</span>}</p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Panel className="lg:col-span-2">
        <SectionHeader title={[me.first_name, me.last_name].filter(Boolean).join(' ')}
          subtitle={[me.hr_positions?.title, me.hr_departments?.name].filter(Boolean).join(' · ') || me.employee_no}
          actions={<HistoryButton module="hr" table="hr_employees" id={me.id} companyId={scope.company_id} title="History -- my record" />} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <Row label="Employee number" value={me.employee_no} />
          <Row label="Status" value={<StatusPill status={me.status} />} />
          <Row label="Started" value={fmtDate(me.hire_date)} />
          <Row label="Work email" value={me.work_email} />
          <Row label="Phone" value={me.phone} />
          <Row label="Employment type" value={me.employment_type?.replace(/_/g, ' ')} />
        </div>
        <p className="text-xs m-0 mt-4" style={{ color: 'var(--color-text-tertiary)' }}>
          Something wrong here? Ask your HR manager to correct it -- every change is kept in the record's history.
        </p>
      </Panel>
      <Panel>
        <SectionHeader title="My moves" subtitle="Joined, role changes, promotions" />
        <PositionHistory employeeId={me.id} companyId={scope.company_id} compact />
      </Panel>
    </div>
  );
}

export default function MyHR() {
  const { user } = useAuth();
  const [hr, setHr] = useState(null);
  const [acc, setAcc] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('details');

  useEffect(() => {
    let alive = true;
    Promise.all([
      client.get('hr/my-scope').then(r => r.data).catch(() => null),
      client.get('accounting/my-scope').then(r => r.data).catch(() => null),
    ]).then(([h, a]) => {
      if (!alive) return;
      if (!h && !a) setError('Could not load your HR details.');
      setHr(h ? { ...h, user_id: user?.id } : null);
      setAcc(a ? { ...a, user_id: user?.id } : null);
    });
    return () => { alive = false; };
  }, [user?.id]);

  if (error) return <EmptyState icon={IdCard} title="My HR is unavailable" hint={error} />;
  if (!hr && !acc) return <Loading variant="cards" cards={3} />;

  const p = hr?.permissions || {};
  const ap = acc?.permissions || {};
  const tabs = [
    { key: 'details',    label: 'My details', icon: UserRound,     show: !!hr },
    { key: 'payslips',   label: 'Payslips',   icon: Banknote,      show: !!p['hr.payroll.view_own'] },
    { key: 'leave',      label: 'Leave',      icon: CalendarCheck, show: !!p['hr.leave.request'] },
    { key: 'attendance', label: 'Attendance', icon: CalendarDays,  show: !!p['hr.attendance.view_own'] },
    { key: 'expenses',   label: 'Expenses',   icon: Receipt,       show: !!ap['accounting.expenses.submit'] },
  ].filter(t => t.show);
  const active = tabs.some(t => t.key === tab) ? tab : tabs[0]?.key;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      <ReasonPromptHost />
      <SectionHeader level="page" icon={IdCard} title="My HR"
        subtitle={hr?.company_name ? `Your record, pay, leave, attendance and expense claims at ${hr.company_name}` : 'Your record, pay, leave, attendance and expense claims'} />
      {tabs.length > 1 && <PillTabs items={tabs} value={active} onChange={setTab} />}

      {active === 'details'    && <MyDetails scope={hr} />}
      {active === 'payslips'   && <PayrollPage scope={hr} selfOnly />}
      {active === 'leave'      && <LeavePage scope={hr} selfOnly />}
      {active === 'attendance' && <AttendancePage scope={hr} selfOnly />}
      {active === 'expenses'   && <ExpensesPage scope={acc} selfOnly />}
      {tabs.length === 0 && (
        <EmptyState icon={IdCard} title="Nothing here for your role yet"
          hint="Your role does not include HR self-service. A superadmin can grant it from the User Control Center." />
      )}
    </div>
  );
}
