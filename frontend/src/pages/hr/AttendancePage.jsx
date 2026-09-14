// ============================================================================
// HR -> Attendance. A month calendar for yourself, a day grid for the team.
//
// Which one you get is the SERVER's answer, not a local permission check:
// GET /hr/attendance returns scope 'all' or 'own', and the page renders that.
// Someone with only hr.attendance.view_own never sees the team switch at all.
//
// Days fill themselves in from the dialer every hour (mig 316): first call,
// last call, calls, talk time; approved leave and company holidays too. Each
// day says who wrote it. A correction by HR turns the day "manual" (with a
// reason) so the dialer never overwrites it, and "Give back to the dialer"
// undoes that. The team view is a DAY at a time on purpose -- the job is one
// column, and a month grid of forty people is unreadable.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { CalendarDays, Save, ChevronLeft, ChevronRight, Users, User, RefreshCw, RotateCcw, PhoneCall } from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, KpiTile, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import ThemedDate from '../../components/UI/ThemedDate';
import { Btn, StatusPill } from '../../components/Modules/ModuleUI';
import AskDialog from '../../components/Modules/AskDialog';
import { useAttendance } from '../../hooks/useAttendance';
import { useEmployees } from '../../hooks/useEmployees';
import { fmtNumber, fmtDate, todayISO } from '../../utils/money';

const STATUSES = ['present', 'remote', 'late', 'half_day', 'absent', 'on_leave', 'holiday'];
const AUTO = new Set(['dialer', 'leave', 'holiday']);
const SOURCE_WORDS = { dialer: 'From the dialer', leave: 'Approved leave', holiday: 'Holiday', manual: 'Set by HR', self: 'Marked by the person' };
const fullName = (e) => [e?.first_name, e?.last_name].filter(Boolean).join(' ') || 'Unnamed';
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const talk = (s) => {
  const m = Math.round(Number(s || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

// Local-time month arithmetic. Using UTC here shifts the whole grid by a day
// for anyone west of Greenwich -- the same trap the callback timezone rule
// exists for.
const monthBounds = (year, month) => {
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(year, month + 1, 0).getDate();
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(last)}`, days: last };
};

// selfOnly: mounted by "My HR" -- the person's own month only, never the team grid.
export default function AttendancePage({ scope, selfOnly = false }) {
  const companyId = scope?.company_id || null;
  const { attendance, scope: serverScope, summary, canManage, myEmployeeId, loading, error,
    fetchAttendance, recordAttendance, recordBulk, correctDays, resetDay, syncNow } = useAttendance(companyId);
  const { employees, fetchEmployees } = useEmployees(companyId);

  const [view, setView] = useState('me');
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [day, setDay] = useState(todayISO());
  const [draft, setDraft] = useState({});     // employeeId -> { status, note }
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(null);

  const bounds = useMemo(() => monthBounds(cursor.y, cursor.m), [cursor]);
  const teamAllowed = !selfOnly && serverScope === 'all';

  useEffect(() => {
    if (view === 'me') fetchAttendance({ date_from: bounds.from, date_to: bounds.to });
    else fetchAttendance({ date_from: day, date_to: day });
  }, [fetchAttendance, view, bounds.from, bounds.to, day]);

  useEffect(() => { if (teamAllowed) fetchEmployees({ status: 'active' }); }, [teamAllowed, fetchEmployees]);

  // Fall back to the personal view if the server says this person has no team
  // reach -- otherwise the tab would render an empty grid and look broken.
  useEffect(() => { if (!teamAllowed && view === 'team') setView('me'); }, [teamAllowed, view]);
  useEffect(() => { setDraft({}); }, [day]);

  const byDate = useMemo(() => {
    const map = {};
    for (const r of attendance) {
      if (view === 'me' && r.employee_id !== myEmployeeId) continue;
      map[r.work_date] = r;
    }
    return map;
  }, [attendance, view, myEmployeeId]);

  const byEmployee = useMemo(
    () => Object.fromEntries(attendance.filter(r => r.work_date === day).map(r => [r.employee_id, r])),
    [attendance, day],
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

  // New days go in one bulk call; days that already exist are CORRECTIONS --
  // one reason for the batch, and each becomes a manual day.
  const saveTeam = async () => {
    const entries = Object.entries(draft).filter(([, v]) => v.status);
    if (!entries.length) return;
    const fresh = entries.filter(([id]) => !byEmployee[id])
      .map(([employee_id, v]) => ({ employee_id, work_date: day, status: v.status, note: v.note || null }));
    const fixes = entries.filter(([id]) => byEmployee[id])
      .map(([id, v]) => ({ id: byEmployee[id].id, patch: { status: v.status, ...(v.note !== undefined ? { note: v.note || null } : {}) } }));

    const run = async (reason) => {
      setSaving(true); setNotice(null);
      try {
        let saved = 0;
        if (fresh.length) saved += (await recordBulk(fresh)).saved || 0;
        if (fixes.length) saved += await correctDays(fixes, reason);
        setDraft({});
        setNotice({ type: 'success', text: `Saved ${saved} day${saved === 1 ? '' : 's'} for ${fmtDate(day)}.` });
        return true;
      } catch (e) {
        setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the attendance.' });
        return false;
      } finally { setSaving(false); }
    };

    if (!fixes.length) { await run(null); return; }
    setAsking({
      title: `Correct ${fixes.length} day${fixes.length === 1 ? '' : 's'}?`,
      message: 'These days were already recorded. Your change is kept as a correction: the dialer will not overwrite it, and the reason is kept in each person\'s history.',
      confirmLabel: 'Save corrections', reason: 'required', reasonLabel: 'Why are they being corrected?',
      onConfirm: async (why) => { if (await run(why)) setAsking(null); },
    });
  };

  const askReset = (row, emp) => setAsking({
    title: `Give ${fullName(emp)}'s ${fmtDate(row.work_date)} back to the dialer?`,
    message: 'The correction is undone and the day is worked out from the dialer again. If the dialer has nothing for that day, the day is removed.',
    confirmLabel: 'Give back', reason: 'required',
    onConfirm: async (why) => {
      try {
        const r = await resetDay(row.id, why);
        setNotice({ type: 'success', text: r.removed ? 'Handed back. The dialer has nothing for that day, so it was removed.' : 'Handed back to the dialer.' });
        setAsking(null);
      } catch (e) { setNotice({ type: 'error', text: e.response?.data?.error || 'Could not hand it back.' }); }
    },
  });

  const onSync = async () => {
    setSaving(true); setNotice(null);
    try {
      const r = await syncNow({ date_from: day, date_to: day });
      setNotice(r.skipped
        ? { type: 'info', text: r.skipped + '. Turn it on in HR -> Settings.' }
        : { type: 'success', text: `Synced from the dialer: ${r.inserted} added, ${r.updated} updated, ${r.removed} removed.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not sync.' });
    } finally { setSaving(false); }
  };

  const tabs = [{ key: 'me', label: 'My attendance', icon: User }];
  if (teamAllowed) tabs.push({ key: 'team', label: 'Team', icon: Users });
  const dayCounts = Object.values(byEmployee).reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={CalendarDays} title="Attendance"
        subtitle={scope?.company_name ? `${scope.company_name} -- filled in from the dialer every hour` : 'Filled in from the dialer every hour'} />

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
          <div className="flex items-end gap-2 ml-auto flex-wrap">
            <Field label="Shift day" hint="An evening shift is dated the day it started.">
              <ThemedDate value={day} onChange={e => setDay(e.target.value)} />
            </Field>
            {canManage && <Btn icon={RefreshCw} busy={saving && !Object.keys(draft).length} onClick={onSync}>Sync from dialer</Btn>}
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
            <KpiTile label="Hours on the phones" value={fmtNumber(summary?.hours, 1)} tone="primary" />
            <KpiTile label="Absences" value={summary?.absent || 0} tone={summary?.absent ? 'error' : 'muted'} />
            <KpiTile label="Half days" value={summary?.half_day || 0} tone={summary?.half_day ? 'warning' : 'muted'} />
          </div>

          {loading && attendance.length === 0 ? <Loading variant="block" height={260} /> : (
            <Panel>
              <SectionHeader title="Month" subtitle="Worked days come from the dialer. Days with nothing recorded can be marked by you; ask HR to correct a dialer day." />
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
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiTile label="Worked" value={(dayCounts.present || 0) + (dayCounts.late || 0) + (dayCounts.half_day || 0) + (dayCounts.remote || 0)} tone="success" />
                <KpiTile label="Half day" value={dayCounts.half_day || 0} tone={dayCounts.half_day ? 'warning' : 'muted'} />
                <KpiTile label="Absent" value={dayCounts.absent || 0} tone={dayCounts.absent ? 'error' : 'muted'} />
                <KpiTile label="Leave / holiday" value={(dayCounts.on_leave || 0) + (dayCounts.holiday || 0)} tone="info" />
              </div>
              <Panel pad="none">
                <TableScroll stickyFirst>
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                        {['Employee', 'On the dialer', 'Recorded', canManage ? 'Change to' : '', 'Note', ''].map((h, i) => (
                          <th key={h + i} className="td-p text-[11px] font-bold uppercase tracking-wider text-left"
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
                            <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>
                              {fullName(emp)}
                              {emp.hr_departments?.name && <span className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{emp.hr_departments.name}</span>}
                            </td>
                            <td className="td-p text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                              {existing?.calls ? (
                                <>
                                  <span style={{ color: 'var(--color-text)' }}>{clock(existing.check_in)} - {clock(existing.check_out)}</span>
                                  <span className="block text-[11px]">
                                    {existing.calls} calls, {talk(existing.talk_seconds)} talk
                                    {existing.late_minutes ? `, ${existing.late_minutes}m late` : ''}
                                  </span>
                                </>
                              ) : <span style={{ color: 'var(--color-text-tertiary)' }}>No calls</span>}
                            </td>
                            <td className="td-p">
                              {existing ? (
                                <>
                                  <StatusPill status={existing.status} />
                                  <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{SOURCE_WORDS[existing.source] || existing.source}</span>
                                </>
                              ) : <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Nothing recorded</span>}
                            </td>
                            <td className="td-p">
                              {canManage ? (
                                <ThemedSelect value={d?.status || ''}
                                  onChange={e => setDraft(prev => ({ ...prev, [emp.id]: { ...prev[emp.id], status: e.target.value } }))}>
                                  <option value="">{existing ? 'Keep' : '--'}</option>
                                  {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                                </ThemedSelect>
                              ) : null}
                            </td>
                            <td className="td-p">
                              {canManage ? (
                                <input className="input w-full" placeholder="Optional" value={d?.note ?? existing?.note ?? ''}
                                  onChange={e => setDraft(prev => ({ ...prev, [emp.id]: { ...prev[emp.id], status: prev[emp.id]?.status || existing?.status || 'present', note: e.target.value } }))} />
                              ) : <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{existing?.note || ''}</span>}
                            </td>
                            <td className="td-p text-right">
                              {canManage && existing && !AUTO.has(existing.source) && (
                                <Btn size="sm" icon={RotateCcw} onClick={() => askReset(existing, emp)} title="Give this day back to the dialer">
                                  <span className="sr-only sm:not-sr-only">Dialer</span>
                                </Btn>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScroll>
              </Panel>
              <p className="text-[11px] m-0 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
                <PhoneCall size={12} /> Times are the first and last call of the shift on the dialer, not a clock-in.
              </p>
            </>
          )
        )
      )}

      {asking && <AskDialog {...asking} onClose={() => setAsking(null)} />}
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
              title={rec ? `${SOURCE_WORDS[rec.source] || ''}${rec.calls ? ` -- ${rec.calls} calls, ${clock(rec.check_in)}-${clock(rec.check_out)}` : ''}${rec.note ? ` -- ${rec.note}` : ''}` : undefined}
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
                      {fmtNumber(rec.hours_worked, 1)}h{rec.calls ? ` - ${rec.calls} calls` : ''}
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
