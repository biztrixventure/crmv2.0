// ============================================================================
// HR -> Settings -> Attendance. The rules the dialer sync follows for this
// company (hr_settings.rules.attendance, mig 316), next to what the floor
// actually does, plus the company's holidays and a manual re-sync.
//
// Nothing is guessed on anyone's behalf: lateness is judged only once a shift
// start is set here, and the screen shows the measured first-call time so the
// number typed in is grounded in the company's own data.
// Reads/writes /hr/attendance/rules, /sync and /holidays (routes/hr/attendance.js).
// ============================================================================
import { useEffect, useState } from 'react';
import { Clock, Save, RefreshCw, CalendarPlus, Trash2, CalendarX } from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, Loading, EmptyState, Field, Toggle, CheckRow, TableScroll } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import ThemedDate from '../../components/UI/ThemedDate';
import { Btn } from '../../components/Modules/ModuleUI';
import AskDialog from '../../components/Modules/AskDialog';
import { fmtDate, todayISO } from '../../utils/money';

const WEEKDAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday'], [7, 'Sunday']];
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const QUARTERS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
const ABSENT_WORDS = {
  dialer_agents: 'People who work the phones regularly',
  everyone: 'Everyone with an active HR record',
  none: 'Nobody -- never mark anyone absent automatically',
};
const roundDownQuarter = (hhmm) => {
  if (!/^\d{2}:\d{2}$/.test(hhmm || '')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(Math.floor(m / 15) * 15).padStart(2, '0')}`;
};
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function AttendanceRulesPanel({ scope }) {
  const companyId = scope?.company_id || null;
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [range, setRange] = useState({ date_from: addDaysISO(todayISO(), -7), date_to: todayISO() });

  const load = async () => {
    const r = await client.get('hr/attendance/rules', { params: { company_id: companyId || undefined } });
    setData(r.data);
    setForm(r.data.rules);
  };
  useEffect(() => {
    load().catch(e => setNotice({ type: 'error', text: e.response?.data?.error || 'Could not load the attendance rules' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  if (!data || !form) return notice ? <Alert type={notice.type}>{notice.text}</Alert> : <Loading variant="cards" cards={1} />;
  const canManage = !!data.can_manage;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const t = data.typical || {};
  const suggested = roundDownQuarter(t.median_first_call);

  const save = async () => {
    setBusy(true); setNotice(null);
    try {
      await client.put('hr/attendance/rules', { company_id: companyId, rules: form });
      await load();
      setNotice({ type: 'success', text: 'Saved. The last 31 days are being re-worked with the new rules (days HR corrected are left alone).' });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not save the rules' });
    } finally { setBusy(false); }
  };

  const sync = async () => {
    setBusy(true); setNotice(null);
    try {
      const r = await client.post('hr/attendance/sync', { company_id: companyId, ...range });
      await load();
      setNotice(r.data.skipped
        ? { type: 'info', text: r.data.skipped + '.' }
        : { type: 'success', text: `Synced ${fmtDate(r.data.date_from)} to ${fmtDate(r.data.date_to)}: ${r.data.inserted} added, ${r.data.updated} updated, ${r.data.removed} removed.` });
    } catch (e) {
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not sync' });
    } finally { setBusy(false); }
  };

  return (
    <>
      <Panel>
        <SectionHeader icon={Clock} title="Attendance from the dialer"
          subtitle={data.last_synced_at ? `Filled in every hour. Last change ${fmtDate(data.last_synced_at)}.` : 'Filled in every hour from the dialer.'} />
        {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

        {t.shift_days > 0 && (
          <div className="p-3 rounded-xl mb-4 text-sm" style={{ background: 'color-mix(in srgb, var(--color-primary-600) 8%, transparent)', color: 'var(--color-text)' }}>
            Over the last 14 days ({t.people} people, {t.shift_days} shifts): the typical first call is at <strong>{t.median_first_call}</strong>
            {t.early_first_call ? ` (a quarter start by ${t.early_first_call})` : ''}, the last call around <strong>{t.median_last_call}</strong>,
            about <strong>{t.avg_span_hours} hours</strong> on the phones. {data.dialer_agents} people here have dialed at least once.
          </div>
        )}

        <div className="space-y-4">
          <Toggle checked={!!form.auto} disabled={!canManage} onChange={v => set('auto', v)}
            label="Fill in attendance from the dialer automatically"
            hint="Worked days, approved leave and holidays. Days HR corrects by hand are never overwritten." />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="A shift day starts at" hint="Calls before this time belong to the previous evening's shift.">
              <ThemedSelect value={form.day_starts_at} disabled={!canManage} onChange={e => set('day_starts_at', e.target.value)}>
                {HALF_HOURS.map(h => <option key={h} value={h}>{h}</option>)}
              </ThemedSelect>
            </Field>
            <Field as="div" label="Shift starts at" hint={form.shift_start ? 'Later than this (plus the grace) = late.' : 'Not set -- nobody is marked late.'}>
              <ThemedSelect value={form.shift_start || ''} disabled={!canManage} onChange={e => set('shift_start', e.target.value)}>
                <option value="">Not set</option>
                {QUARTERS.map(h => <option key={h} value={h}>{h}</option>)}
              </ThemedSelect>
              {canManage && suggested && form.shift_start !== suggested && (
                <button type="button" className="text-[11px] font-semibold mt-1" style={{ color: 'var(--color-primary-600)' }}
                  onClick={() => set('shift_start', suggested)}>Use {suggested} (measured)</button>
              )}
            </Field>
            <Field label="Grace (minutes)" hint="A first call within this is still on time.">
              <input className="input w-full" type="number" min="0" max="240" disabled={!canManage}
                value={form.late_after_minutes} onChange={e => set('late_after_minutes', e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
            <Field label="Half day below (hours)" hint="First to last call shorter than this.">
              <input className="input w-full" type="number" min="0" max="24" step="0.5" disabled={!canManage}
                value={form.half_day_below_hours} onChange={e => set('half_day_below_hours', e.target.value === '' ? '' : Number(e.target.value))} />
            </Field>
          </div>

          <Field as="div" label="Working days" hint="A day off is never an absence.">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-x-3">
              {WEEKDAYS.map(([n, label]) => (
                <CheckRow key={n} disabled={!canManage} checked={(form.work_days || []).includes(n)} label={label}
                  onChange={on => set('work_days', on ? [...new Set([...(form.work_days || []), n])].sort() : (form.work_days || []).filter(d => d !== n))} />
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Who is marked absent on a working day with no calls, no leave and no holiday" className="sm:col-span-2">
              <ThemedSelect value={form.absent_for} disabled={!canManage} onChange={e => set('absent_for', e.target.value)}>
                {Object.entries(ABSENT_WORDS).map(([k, w]) => <option key={k} value={k}>{w}</option>)}
              </ThemedSelect>
            </Field>
            {form.absent_for === 'dialer_agents' && (
              <Field label="Works the phones = dialed on at least" hint="...of the previous 30 days. Stops a one-off call by a manager making them 'expected' every day.">
                <div className="flex items-center gap-2">
                  <input className="input w-20" type="number" min="1" max="30" disabled={!canManage}
                    value={form.regular_days ?? 3} onChange={e => set('regular_days', e.target.value === '' ? '' : Number(e.target.value))} />
                  <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>days</span>
                </div>
              </Field>
            )}
          </div>

          <Field label="Time zone" hint="The clock the shifts are worked in.">
            <input className="input w-full sm:w-64" disabled={!canManage} value={form.timezone} onChange={e => set('timezone', e.target.value)} />
          </Field>

          {canManage && (
            <div className="flex justify-end">
              <Btn variant="primary" icon={Save} busy={busy} onClick={save}>Save attendance rules</Btn>
            </div>
          )}
        </div>
      </Panel>

      {canManage && (
        <Panel>
          <SectionHeader icon={RefreshCw} title="Re-read the dialer"
            subtitle="Runs by itself every hour for the last 8 days. Use this after fixing a login or to fill in an older period." />
          <div className="flex items-end gap-3 flex-wrap">
            <Field label="From"><ThemedDate value={range.date_from} onChange={e => setRange(r => ({ ...r, date_from: e.target.value }))} /></Field>
            <Field label="To"><ThemedDate value={range.date_to} onChange={e => setRange(r => ({ ...r, date_to: e.target.value }))} /></Field>
            <Btn icon={RefreshCw} busy={busy} disabled={!range.date_from || !range.date_to} onClick={sync}>Sync this period</Btn>
          </div>
        </Panel>
      )}

      <HolidaysPanel companyId={companyId} onNotice={setNotice} />
    </>
  );
}

function HolidaysPanel({ companyId, onNotice }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ holiday_date: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(null);

  const load = async () => {
    const r = await client.get('hr/attendance/holidays', { params: { company_id: companyId || undefined, year } });
    setData(r.data);
  };
  useEffect(() => {
    load().catch(e => onNotice({ type: 'error', text: e.response?.data?.error || 'Could not load the holidays' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

  if (!data) return <Loading variant="rows" rows={3} />;
  const canManage = !!data.can_manage;

  const add = async () => {
    setBusy(true);
    try {
      await client.post('hr/attendance/holidays', { company_id: companyId, ...form, name: form.name.trim() });
      setForm({ holiday_date: '', name: '' });
      if (Number(form.holiday_date.slice(0, 4)) !== year) setYear(Number(form.holiday_date.slice(0, 4))); else await load();
      onNotice({ type: 'success', text: 'Holiday added. Nobody is marked absent that day.' });
    } catch (e) {
      onNotice({ type: 'error', text: e.response?.data?.error || 'Could not add the holiday' });
    } finally { setBusy(false); }
  };

  return (
    <Panel>
      <SectionHeader icon={CalendarPlus} title="Company holidays"
        subtitle="On a holiday nobody is marked absent; people who worked it still show as worked."
        actions={
          <ThemedSelect value={String(year)} onChange={e => setYear(Number(e.target.value))}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </ThemedSelect>
        } />
      {canManage && (
        <div className="flex items-end gap-3 flex-wrap mb-4">
          <Field label="Date"><ThemedDate value={form.holiday_date} onChange={e => setForm(f => ({ ...f, holiday_date: e.target.value }))} /></Field>
          <Field label="Name" className="flex-1 min-w-[180px]">
            <input className="input w-full" maxLength={120} placeholder="e.g. Independence Day" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </Field>
          <Btn variant="primary" icon={CalendarPlus} busy={busy} disabled={!form.holiday_date || !form.name.trim()} onClick={add}>Add holiday</Btn>
        </div>
      )}
      {(data.holidays || []).length === 0 ? (
        <EmptyState compact icon={CalendarX} title={`No holidays in ${year}`} hint={canManage ? 'Add the days the company is closed.' : undefined} />
      ) : (
        <TableScroll>
          <table className="w-full">
            <tbody>
              {data.holidays.map(h => (
                <tr key={h.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="td-p text-sm whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{fmtDate(h.holiday_date)}</td>
                  <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>{h.name}</td>
                  <td className="td-p text-right">
                    {canManage && (
                      <Btn size="sm" variant="danger" icon={Trash2} onClick={() => setAsking({
                        title: `Remove ${h.name} (${fmtDate(h.holiday_date)})?`,
                        message: 'Anyone expected that day and not on the phones will show as absent again.',
                        confirmLabel: 'Remove holiday', reason: 'required', danger: true,
                        onConfirm: async (why) => {
                          try {
                            await client.delete(`hr/attendance/holidays/${h.id}`, { data: { company_id: companyId, change_reason: why } });
                            await load(); setAsking(null);
                            onNotice({ type: 'success', text: 'Holiday removed.' });
                          } catch (e) { onNotice({ type: 'error', text: e.response?.data?.error || 'Could not remove it' }); }
                        },
                      })}><span className="sr-only">Remove</span></Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {asking && <AskDialog {...asking} onClose={() => setAsking(null)} />}
    </Panel>
  );
}
