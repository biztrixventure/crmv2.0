// ============================================================================
// HR -> Leave. Request form, balances, and the approval queue.
//
// The overdraw path is the interesting one and it is deliberately two steps.
// Approving a request that exceeds the remaining balance comes back 422 with
// the numbers in it; the page then asks a plain question naming both figures
// and only re-sends with allow_overdraw on a real yes. Nobody grants an
// exception by accident, and the exception is recorded in the decision note.
//
// The balance itself is never adjusted here. A database trigger (mig 287) owns
// used_days -- every action re-reads what the trigger did rather than guessing.
// ============================================================================
import { useState, useEffect } from 'react';
import { CalendarCheck, Plus, Check, X, Ban, Settings2, Users, User } from 'lucide-react';
import { Panel, SectionHeader, Loading, EmptyState, Field, KpiTile, TableScroll, PillTabs } from '../../components/UI/kit';
import { Alert } from '../../components/UI';
import ThemedSelect from '../../components/UI/Select';
import { Btn, StatusPill, ModuleModal } from '../../components/Modules/ModuleUI';
import { useLeaveRequests } from '../../hooks/useLeaveRequests';
import { useEmployees } from '../../hooks/useEmployees';
import { fmtNumber, fmtDate, todayISO } from '../../utils/money';

const fullName = (e) => [e?.first_name, e?.last_name].filter(Boolean).join(' ') || 'Unnamed';
const dayCount = (from, to) => {
  if (!from || !to) return 0;
  const a = new Date(from), b = new Date(to);
  const n = Math.round((b - a) / 86_400_000) + 1;
  return n > 0 ? n : 0;
};

export default function LeavePage({ scope }) {
  const companyId = scope?.company_id || null;
  const canManageTypes = !!scope?.permissions?.['hr.leave.manage'];
  const {
    requests, balances, types, scope: serverScope, canApprove, myEmployeeId, loading, error,
    fetchRequests, fetchBalances, fetchTypes, saveType, setEntitlement,
    createRequest, approveRequest, rejectRequest, cancelRequest,
  } = useLeaveRequests(companyId);
  const { employees, fetchEmployees } = useEmployees(companyId);

  const [tab, setTab] = useState('mine');
  const [requesting, setRequesting] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [notice, setNotice] = useState(null);

  const year = new Date().getFullYear();
  const teamAllowed = serverScope === 'all';

  useEffect(() => { fetchTypes(); }, [fetchTypes]);
  useEffect(() => { fetchRequests(); fetchBalances({ year }); }, [fetchRequests, fetchBalances, year]);
  useEffect(() => { if (canManageTypes) fetchEmployees({ status: 'active' }); }, [canManageTypes, fetchEmployees]);
  useEffect(() => { if (!teamAllowed && tab === 'queue') setTab('mine'); }, [teamAllowed, tab]);

  const myBalances = balances.filter(b => !myEmployeeId || b.employee_id === myEmployeeId);
  const visible = tab === 'queue'
    ? requests.filter(r => r.status === 'pending')
    : requests.filter(r => !myEmployeeId || r.employee_id === myEmployeeId);

  const onApprove = async (r, allowOverdraw = false) => {
    setNotice(null);
    try {
      await approveRequest(r.id, { allowOverdraw });
      setNotice({ type: 'success', text: 'Leave approved.' });
    } catch (e) {
      const od = e.overdraw;
      if (od && !allowOverdraw) {
        // Two-step by design -- see the header.
        const ok = window.confirm(
          `${fullName(r.hr_employees)} has ${od.remaining_days} day(s) left this year but is asking for ${od.requested_days}.\n\n` +
          'Approve anyway? The overdraw will be recorded on the request.',
        );
        if (ok) return onApprove(r, true);
        setNotice({ type: 'warning', text: od.error });
        return;
      }
      setNotice({ type: 'error', text: e.response?.data?.error || 'Could not approve the request.' });
    }
  };

  const act = async (fn, ok) => {
    setNotice(null);
    try { await fn(); setNotice({ type: 'success', text: ok }); }
    catch (e) { setNotice({ type: 'error', text: e.response?.data?.error || 'That did not work.' }); }
  };

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const tabs = [{ key: 'mine', label: 'My leave', icon: User }];
  if (teamAllowed) tabs.push({ key: 'queue', label: 'Approvals', icon: Users, count: pendingCount || undefined });

  return (
    <div className="space-y-4">
      <SectionHeader level="page" icon={CalendarCheck} title="Leave"
        subtitle={scope?.company_name || undefined}
        actions={
          <div className="flex items-center gap-2">
            {canManageTypes && <Btn icon={Settings2} onClick={() => setConfiguring(true)}>Leave types</Btn>}
            <Btn variant="primary" icon={Plus} onClick={() => setRequesting(true)}>Request leave</Btn>
          </div>
        } />

      {error && <Alert type="error">{error}</Alert>}
      {notice && <Alert type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Alert>}

      {!myEmployeeId && (
        <Alert type="info">
          You have no employee record in this company yet, so you cannot request leave.
          Ask HR to create one and link it to your login.
        </Alert>
      )}

      {/* Balances first: the number you are about to spend belongs above the
          form that spends it. */}
      {myBalances.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {myBalances.map(b => (
            <KpiTile key={b.id}
              label={b.hr_leave_types?.name || 'Leave'}
              value={fmtNumber(b.remaining_days, 1)}
              sub={`${fmtNumber(b.used_days, 1)} used of ${fmtNumber(b.entitled_days, 1)}`}
              tone={Number(b.remaining_days) <= 0 ? 'error' : Number(b.remaining_days) < 3 ? 'warning' : 'success'} />
          ))}
        </div>
      )}

      {tabs.length > 1 && <PillTabs items={tabs} value={tab} onChange={setTab} />}

      {loading && requests.length === 0 ? <Loading variant="table" rows={5} label="Loading leave requests" /> : (
        visible.length === 0 ? (
          <EmptyState icon={CalendarCheck}
            title={tab === 'queue' ? 'Nothing awaiting approval' : 'No leave requests'}
            hint={tab === 'queue' ? 'Pending requests land here.' : 'Request time off and it will appear here with its status.'}
            action={tab === 'mine' && myEmployeeId ? <Btn variant="primary" icon={Plus} onClick={() => setRequesting(true)}>Request leave</Btn> : null} />
        ) : (
          <Panel pad="none">
            <TableScroll stickyFirst>
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {['Employee', 'Type', 'From', 'To', 'Days', 'Reason', 'Status', ''].map((h, i) => (
                      <th key={h + i} className={`td-p text-[11px] font-bold uppercase tracking-wider ${i === 4 ? 'text-right' : 'text-left'}`}
                        style={{ color: 'var(--color-text-secondary)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map(r => {
                    const mine = r.employee_id === myEmployeeId;
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td className="td-p text-sm" style={{ color: 'var(--color-text)' }}>
                          {mine ? 'You' : fullName(r.hr_employees)}
                        </td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {r.hr_leave_types?.name || '--'}
                          {r.hr_leave_types && !r.hr_leave_types.is_paid && (
                            <span className="ml-1 text-[10px]" style={{ color: 'var(--color-warning-600)' }}>unpaid</span>
                          )}
                        </td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(r.start_date)}</td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>{fmtDate(r.end_date)}</td>
                        <td className="td-p text-sm text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtNumber(r.days, 1)}</td>
                        <td className="td-p text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {r.reason || '--'}
                          {r.decision_note && (
                            <span className="block text-[11px] mt-0.5"
                              style={{ color: r.status === 'rejected' ? 'var(--color-error-600)' : 'var(--color-text-tertiary)' }}>
                              {r.decision_note}
                            </span>
                          )}
                        </td>
                        <td className="td-p"><StatusPill status={r.status} /></td>
                        <td className="td-p">
                          <div className="flex items-center gap-1.5 justify-end">
                            {/* Approving your own leave is refused server-side; the
                                buttons are hidden so it is never a surprise 403. */}
                            {canApprove && !mine && r.status === 'pending' && (
                              <>
                                <Btn size="sm" variant="primary" icon={Check} onClick={() => onApprove(r)}>Approve</Btn>
                                <Btn size="sm" variant="danger" icon={X}
                                  onClick={() => {
                                    const reason = window.prompt('Why is this being rejected? The requester will see this.');
                                    if (reason) act(() => rejectRequest(r.id, reason), 'Request rejected.');
                                  }}>Reject</Btn>
                              </>
                            )}
                            {mine && ['pending', 'approved'].includes(r.status) && (
                              <Btn size="sm" icon={Ban}
                                onClick={() => { if (window.confirm('Cancel this leave request?')) act(() => cancelRequest(r.id, 'Cancelled by requester'), 'Request cancelled.'); }}>
                                Cancel
                              </Btn>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        )
      )}

      {requesting && (
        <RequestDialog types={types} balances={myBalances} onClose={() => setRequesting(false)}
          onSubmit={async (payload) => {
            setNotice(null);
            try {
              await createRequest(payload);
              setRequesting(false);
              setNotice({ type: 'success', text: 'Leave requested. It is now awaiting approval.' });
            } catch (e) {
              setNotice({ type: 'error', text: e.response?.data?.error || 'Could not submit the request.' });
            }
          }} />
      )}

      {configuring && (
        <LeaveConfig types={types} employees={employees} year={year}
          onClose={() => setConfiguring(false)}
          onSaveType={saveType} onSetEntitlement={setEntitlement} onNotice={setNotice} />
      )}
    </div>
  );
}

function RequestDialog({ types, balances, onClose, onSubmit }) {
  const [form, setForm] = useState({ leave_type_id: '', start_date: todayISO(), end_date: todayISO(), reason: '' });
  const [days, setDays] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const span = dayCount(form.start_date, form.end_date);
  const effective = days === '' ? span : Number(days);
  const balance = balances.find(b => b.leave_type_id === form.leave_type_id);
  const short = balance && effective > Number(balance.remaining_days);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSubmit({ ...form, days: effective });
    setSaving(false);
  };

  return (
    <ModuleModal title="Request leave" onClose={onClose}
      footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={saving} disabled={!form.leave_type_id} onClick={submit}>Submit request</Btn></>}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Leave type" required>
          <ThemedSelect value={form.leave_type_id} onChange={e => set('leave_type_id', e.target.value)}>
            <option value="">Pick a type</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_paid ? '' : ' (unpaid)'}</option>)}
          </ThemedSelect>
        </Field>
        {balance && (
          <p className="text-[11px] m-0" style={{ color: short ? 'var(--color-warning-600)' : 'var(--color-text-secondary)' }}>
            {fmtNumber(balance.remaining_days, 1)} day(s) remaining of {fmtNumber(balance.entitled_days, 1)}.
            {short && ' This request is more than you have left -- an approver will have to allow the overdraw.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required>
            <input className="input w-full" type="date" required value={form.start_date} onChange={e => set('start_date', e.target.value)} />
          </Field>
          <Field label="To" required>
            <input className="input w-full" type="date" required value={form.end_date} min={form.start_date}
              onChange={e => set('end_date', e.target.value)} />
          </Field>
        </div>
        <Field label="Days"
          hint={`Defaults to the calendar span (${span}). Override it for half days or a company holiday inside the range.`}>
          <input className="input w-full" type="number" step="0.5" min="0.5" placeholder={String(span)}
            value={days} onChange={e => setDays(e.target.value)} />
        </Field>
        <Field label="Reason"><textarea className="input w-full" rows={2} value={form.reason} onChange={e => set('reason', e.target.value)} /></Field>
      </form>
    </ModuleModal>
  );
}

function LeaveConfig({ types, employees, year, onClose, onSaveType, onSetEntitlement, onNotice }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [defaultDays, setDefaultDays] = useState(0);
  const [isPaid, setIsPaid] = useState(true);
  const [ent, setEnt] = useState({ employee_id: '', leave_type_id: '', entitled_days: '' });
  const [busy, setBusy] = useState(false);

  const guard = async (fn, ok) => {
    setBusy(true);
    try { await fn(); onNotice({ type: 'success', text: ok }); }
    catch (e) { onNotice({ type: 'error', text: e.response?.data?.error || 'That did not work.' }); }
    finally { setBusy(false); }
  };

  return (
    <ModuleModal wide title="Leave configuration" subtitle={`Entitlements for ${year}`} onClose={onClose}
      footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <SectionHeader level="sub" title="Leave types" />
          <div className="space-y-2 mb-4">
            {types.length === 0
              ? <p className="text-xs m-0" style={{ color: 'var(--color-text-tertiary)' }}>None defined yet.</p>
              : types.map(t => (
                <div key={t.id} className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                    <span className="font-mono text-xs mr-2" style={{ color: 'var(--color-text-tertiary)' }}>{t.code}</span>
                    {t.name}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                    {fmtNumber(t.default_days, 1)} days{t.is_paid ? '' : ' -- unpaid'}
                  </span>
                </div>
              ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Code"><input className="input w-full" value={code} onChange={e => setCode(e.target.value)} placeholder="ANNUAL" /></Field>
            <Field label="Name"><input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="Annual leave" /></Field>
            <Field label="Default days" hint="Seeded onto a new year balance.">
              <input className="input w-full" type="number" step="0.5" min="0" value={defaultDays} onChange={e => setDefaultDays(e.target.value)} />
            </Field>
            <Field label="Paid" as="div">
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                <input type="checkbox" checked={isPaid} onChange={e => setIsPaid(e.target.checked)}
                  style={{ accentColor: 'var(--color-primary-600)', width: 15, height: 15 }} />
                Paid leave
              </label>
            </Field>
          </div>
          <Btn variant="primary" icon={Plus} className="mt-2" busy={busy} disabled={!code.trim() || !name.trim()}
            onClick={() => guard(async () => {
              await onSaveType({ code: code.trim(), name: name.trim(), default_days: Number(defaultDays), is_paid: isPaid });
              setCode(''); setName(''); setDefaultDays(0);
            }, 'Leave type added.')}>
            Add leave type
          </Btn>
        </div>

        <div>
          <SectionHeader level="sub" title="Set an entitlement"
            subtitle="Days used is never set here -- approvals move it." />
          <div className="space-y-2">
            <Field label="Employee">
              <ThemedSelect value={ent.employee_id} onChange={e => setEnt(s => ({ ...s, employee_id: e.target.value }))}>
                <option value="">Pick someone</option>
                {employees.map(emp => <option key={emp.id} value={emp.id}>{fullName(emp)}</option>)}
              </ThemedSelect>
            </Field>
            <Field label="Leave type">
              <ThemedSelect value={ent.leave_type_id} onChange={e => setEnt(s => ({ ...s, leave_type_id: e.target.value }))}>
                <option value="">Pick a type</option>
                {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </ThemedSelect>
            </Field>
            <Field label={`Entitled days for ${year}`}>
              <input className="input w-full" type="number" step="0.5" min="0" value={ent.entitled_days}
                onChange={e => setEnt(s => ({ ...s, entitled_days: e.target.value }))} />
            </Field>
            <Btn variant="primary" busy={busy}
              disabled={!ent.employee_id || !ent.leave_type_id || ent.entitled_days === ''}
              onClick={() => guard(async () => {
                await onSetEntitlement({ ...ent, entitled_days: Number(ent.entitled_days), year });
                setEnt({ employee_id: '', leave_type_id: '', entitled_days: '' });
              }, 'Entitlement saved.')}>
              Save entitlement
            </Btn>
          </div>
        </div>
      </div>
    </ModuleModal>
  );
}
