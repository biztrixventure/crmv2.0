// ============================================================================
// HR -> Attendance. A month calendar for yourself, a day grid for the team.
//
// Which one you get is the SERVER's answer, not a local permission check:
// GET /hr/attendance returns scope 'all' or 'own', and the page renders that.
// Someone with only hr.attendance.view_own never sees the team switch at all.
//
// The team view is a DAY at a time on purpose. A month grid of forty people is
// unreadable, and the actual job -- mark today -- is a single column. The
// calendar is for the personal view, where a month is exactly the right span.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { CalendarDays, Save, ChevronLeft, ChevronRight, Users, User } from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, KpiTile, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import { Btn, StatusPill } from '../../components/Modules/ModuleUI';
import { useAttendance } from '../../hooks/useAttendance';
import { useEmployees } from '../../hooks/useEmployees';
import { fmtNumber, fmtDate, todayISO } from '../../utils/money';

const STATUSES = ['present', 'remote', 'late', 'half_day', 'absent', 'on_leave', 'holiday'];
const fullName = (e) => [e?.first_name, e?.last_name].filter(Boolean).join(' ') || 'Unnamed';

// Local-time month arithmetic. Using UTC here shifts the whole grid by a day
// for anyone west of Greenwich -- the same trap the callback timezone rule
// exists for.
const monthBounds = (year, month) => {
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(year, month + 1, 0).getDate();
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(last)}`, days: last };
};

export default function AttendancePage({ scope }) {
  const companyId = scope?.company_id || null;
  const { attendance, scope: serverScope, summary, canManage, myEmployeeId, loading, error,
    fetchAttendance, recordAttendance, recordBulk } = useAttendance(companyId);
  const { employees, fetchEmployees } = useEmployees(companyId);

  const [view, setView] = useState('me');
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [day, setDay] = useState(todayISO());
  const [draft, setDraft] = useState({});     // employeeId -> { status, note }
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  const bounds = useMemo(() => monthBounds(cursor.y, cursor.m), [cursor]);
  const teamAllowed = serverScope === 'all';

  useEffect(() => {
    if (view === 'me') fetchAttendance({ date_from: bounds.from, date_to: bounds.to });
    else fetchAttendance({ date_from: day, date_to: day });
  }, [fetchAttendance, view, bounds.from, bounds.to, day]);

  useEffect(() => { if (teamAllowed) fetchEmployees({ status: 'active' }); }, [teamAllowed, fetchEmployees]);

  // Fall back to the personal view if the server says this person has no team
  // reach -- otherwise the tab would render an empty grid and look broken.
  useEffect(() => { if (!teamAllowed && view === 'team') setView('me'); }, [teamAllowed, view]);

  const byDate = useMemo(() => {
    const map = {};
    for (const r of attendance) {
      if (view === 'me' && r.employee_id !== myEmployeeId) continue;
      map[r.work_date] = r;
    }
    return map;
  }, [attendance, view, myEmployeeId]);

  const byEmployee = useMemo(
    () => Object.fromEntries(attendance.map(r => [r.employee_id, r])),
    [attendance],
  );

  const markSelf = async (workDate, status) => {
    setNotice(null);
    try {
      await recordAttendance({ work_date: workDate, status });
      setNotice({ type: 'success', text: `Marked ${fmtDate(workDate)} as ${status.replace(/_/g, ' ')}.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save that.' });
    }
  };

  const saveTeam = async () => {
    const records = Object.entries(draft).map(([employee_id, v]) => ({
      employee_id, work_date: day, status: v.status, note: v.note || null,
    }));
    if (!records.length) return;
    setSaving(true);
    setNotice(null);
    try {
      const r = await recordBulk(records);
      setDraft({});
      setNotice({ type: 'success', text: `Saved ${r.saved} record${r.saved === 1 ? '' : 's'} for ${fmtDate(day)}.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the attendance records.' });
    } finally { setSaving(false); }
  };

  const tabs = [{ key: 'me', label: 'My attendance', icon: User }];
  if (teamAllowed) tabs.push({ key: 'team', label: 'Team', icon: Users });

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={CalendarDays} title="Attendance"
        subtitle={scope?.company_name || undefined} />

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      {!myEmployeeId && !teamAllowed && (
        <Alert type="info">
          You do not have an employee record in this company yet, so there is no attendance to show.
          Ask HR to create one and link it to your login.
        </Alert>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {tabs.length > 1 && <PillTabs items={tabs} value={view} onChange={setView} />}
        {view === 'me' ? (
          <div className="flex items-center gap-2 ml-auto">
            <Btn size="sm" icon={ChevronLeft}
              onClick={() => setCursor(c => c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 })}>
              <span className="sr-only">Previous month</span>
            </Btn>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)', minWidth: 130, textAlign: 'center' }}>
              {new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
            <Btn size="sm" icon={ChevronRight}
              onClick={() => setCursor(c => c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 })}>
              <span className="sr-only">Next month</span>
            </Btn>
          </div>
        ) : (
          <div className="flex items-center gap-2 ml-auto">
            <Field label="Day"><input className="input" type="date" value={day} onChange={e => setDay(e.target.value)} /></Field>
            {canManage && Object.keys(draft).length > 0 && (
              <Btn variant="primary" icon={Save} busy={saving} onClick={saveTeam}>
                Save {Object.keys(draft).length}
              </Btn>
            )}
          </div>
        )}
      </div>

      {view === 'me' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label="Days recorded" value={Object.keys(byDate).length} tone="info" />
            <KpiTile label="Hours logged" value={fmtNumber(summary?.hours, 1)} tone="primary" />
            <KpiTile label="Absences" value={summary?.absent || 0} tone={summary?.absent ? 'error' : 'muted'} />
            <KpiTile label="Late" value={summary?.late || 0} tone={summary?.late ? 'warning' : 'muted'} />
          </div>

          {loading && attendance.length === 0 ? <Loading variant="block" height={260} /> : (
            <Panel>
              <SectionHeader title="Month" subtitle="Click a day to mark it. Weekends are not assumed -- nothing is filled in for you." />
              <MonthGrid year={cursor.y} month={cursor.m} days={bounds.days} byDate={byDate}
                disabled={!myEmployeeId} onMark={markSelf} />
            </Panel>
          )}
        </>
      ) : (
        loading && employees.length === 0 ? <Loading variant="table" rows={8} /> : (
          employees.length === 0 ? (
            <EmptyState icon={Users} title="No active employees"
              hint="Add people in the directory before recording attendance." />
          ) : (
            <Panel pad="none">
              <TableScroll stickyFirst>
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                      {['Employee', 'Department', 'Recorded', 'Set status', 'Note'].map(h => (
                        <th key={h} className="td-p text-[11px] font-bold uppercase tracking-wider text-left"
                          style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map(emp => {
                      const existing = byEmployee[emp.id];
                      const d = draft[emp.id];
                      return (
                        <tr key={emp.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                          <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{fullName(emp)}</td>
                          <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{emp.hr_departments?.name || '--'}</td>
                          <td className="td-p">
                            {existing ? <StatusPill status={existing.status} />
                              : <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Not recorded</span>}
                          </td>
                          <td className="td-p">
                            {canManage ? (
                              <ThemedSelect value={d?.status || existing?.status || ''}
                                onChange={e => setDraft(prev => ({ ...prev, [emp.id]: { ...prev[emp.id], status: e.target.value } }))}>
                                <option value="">--</option>
                                {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                              </ThemedSelect>
                            ) : <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Read only</span>}
                          </td>
                          <td className="td-p">
                            {canManage && (
                              <input className="input w-full" placeholder="Optional" value={d?.note ?? existing?.note ?? ''}
                                onChange={e => setDraft(prev => ({ ...prev, [emp.id]: { ...prev[emp.id], status: prev[emp.id]?.status || existing?.status || 'present', note: e.target.value } }))} />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          )
        )
      )}
    </div>
  );
}

// A real month grid, aligned to the weekday the month starts on. Days with no
// record are blank, not "absent" -- an unrecorded day is unknown, and colouring
// it as an absence would invent a fact.
function MonthGrid({ year, month, days, byDate, disabled, onMark }) {
  const pad = (n) => String(n).padStart(2, '0');
  const firstWeekday = new Date(year, month, 1).getDay();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const today = todayISO();

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} className="text-[10px] font-bold uppercase tracking-wider text-center py-1"
            style={{ color: 'var(--color-text-secondary)' }}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((n, i) => {
          if (n === null) return <div key={`pad-${i}`} />;
          const iso = `${year}-${pad(month + 1)}-${pad(n)}`;
          const rec = byDate[iso];
          const isToday = iso === today;
          const isFuture = iso > today;
          return (
            <div key={iso} className="rounded-lg p-1.5 min-h-[62px] flex flex-col"
              style={{
                background: 'var(--color-surface)',
                border: isToday ? '2px solid var(--color-primary-600)' : '1px solid var(--color-border)',
                opacity: isFuture ? 0.5 : 1,
              }}>
              <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{n}</span>
              {rec ? (
                <div className="mt-auto">
                  <StatusPill status={rec.status} />
                  {rec.hours_worked != null && (
                    <span className="block text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                      {fmtNumber(rec.hours_worked, 1)}h
                    </span>
                  )}
                </div>
              ) : (!disabled && !isFuture) ? (
                <select
                  className="mt-auto text-[10px] rounded"
                  style={{ background: 'transparent', color: 'var(--color-text-tertiary)', border: 'none', cursor: 'pointer' }}
                  value="" onChange={e => e.target.value && onMark(iso, e.target.value)}
                  aria-label={`Mark ${iso}`}>
                  <option value="">Mark...</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
