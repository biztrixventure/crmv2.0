// ============================================================================
// FirstMonthly -- the "First Monthly call" sheet, kept by the CRM (mig 359).
//
// A new policy's first monthly payment is where most customers drop. Support
// calls each one three times before it (1 week, 3 days, 1 day ahead) and then
// records what happened to the payment. The policy date, monthly date, phone,
// policy number and status come straight off the sale; the agent only fills in
// the three calls and the final status.
//
// "Due today" is the working view: every policy that needs a call or a status
// TODAY. The server decides what is due (utils/firstMonthly.js stepStates) so
// this list, the daily reminder and the report cannot disagree.
//
// Once a customer has agreed, the later calls show N/A -- nobody calls a
// customer who already said yes.
//
// One component, two homes: the agent's desk (canWork) and Support Reports
// (read-only, with Export).
// ============================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Search, Download, PhoneCall } from 'lucide-react';
import client from '../../api/client';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import SxDialog from './SxDialog';
import { SortTh, useClientSort } from './sxSort';
import { day, dateTime, saleStatus, errText } from './supportFormat';

const STEP_KEYS = ['fu1', 'fu2', 'fu3', 'final'];
const LIVE_TYPES = ['support_first_monthly_due'];

// What a cell says for a step that has NOT been logged.
const WAITING = {
  na: 'N/A',
  upcoming: (s) => (s.due ? `from ${day(s.due)}` : ''),
  due: 'Due now',
  missed: 'Missed',
};
const cellText = (s) => {
  if (s.state === 'done') return s.result_label || 'Done';
  const w = WAITING[s.state];
  return typeof w === 'function' ? w(s) : (w || '');
};

export default function FirstMonthly({ me, canWork = false, onOpenSale, onExport }) {
  const [view, setView] = useState('due');
  const [range, setRange] = useState({ from: '', to: '' });      // '' = the server's default window
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null);                        // { row, step }
  const [form, setForm] = useState({ result: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [dlgError, setDlgError] = useState('');
  const reqId = useRef(0);

  const fmCfg = me.first_monthly || { follow_ups: [], results: [], statuses: [] };
  const stepLabel = (k) => (k === 'final' ? '1st Monthly Status' : (fmCfg.follow_ups.find((f) => f.step === k)?.label || k));

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true); setError('');
    try {
      const r = await client.get('support/first-monthly', {
        params: { view, date_from: range.from || undefined, date_to: range.to || undefined, search: search || undefined },
      });
      if (id === reqId.current) setData(r.data);
    } catch (e) {
      if (id === reqId.current) { setData(null); setError(errText(e, 'Could not load the first-monthly list.')); }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [view, range.from, range.to, search]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(LIVE_TYPES, load, { enabled: !edit });

  const rows = useClientSort(data?.policies || [], {
    policy_date: (r) => r.sale_date, monthly: (r) => r.monthly_date, phone: (r) => r.customer_phone,
    customer: (r) => r.customer_name, client: (r) => r.client_name, policy: (r) => r.policy_number || r.reference_no,
    status: (r) => saleStatus(r.status).label,
    fu1: (r) => cellText(r.steps.fu1), fu2: (r) => cellText(r.steps.fu2), fu3: (r) => cellText(r.steps.fu3),
    final: (r) => cellText(r.steps.final),
  });
  const th = { sort: rows.sort, onSort: rows.setSort };

  const openStep = (row, step) => {
    const s = row.steps[step];
    setForm({ result: s.result || '', note: s.note || '' });
    setDlgError('');
    setEdit({ row, step });
  };
  const save = async () => {
    setBusy(true); setDlgError('');
    try {
      await client.post(`support/first-monthly/${edit.row.id}/steps`, { step: edit.step, result: form.result, note: form.note });
      setEdit(null);
      await load();
    } catch (e) {
      setDlgError(errText(e, 'Could not save.'));
    } finally { setBusy(false); }
  };

  const exportRows = () => onExport(
    `first-monthly_${data.range.date_from}_${data.range.date_to}.csv`,
    ['Policy date', '1st Monthly date', 'CLI', 'Customer', 'Client', 'Policy #', 'Status',
      'Follow up 1', 'Follow up 1 by', 'Follow up 2', 'Follow up 2 by', 'Follow up 3', 'Follow up 3 by',
      '1st Monthly date Status', 'Status by', 'Notes'],
    rows.sorted.map((r) => [
      day(r.sale_date), day(r.monthly_date), r.customer_phone, r.customer_name, r.client_name,
      r.policy_number || r.reference_no, saleStatus(r.status).label,
      cellText(r.steps.fu1), r.steps.fu1.agent_name || '', cellText(r.steps.fu2), r.steps.fu2.agent_name || '',
      cellText(r.steps.fu3), r.steps.fu3.agent_name || '', cellText(r.steps.final), r.steps.final.agent_name || '',
      STEP_KEYS.map((k) => (r.steps[k].note ? `${stepLabel(k)}: ${r.steps[k].note}` : '')).filter(Boolean).join(' | '),
    ]),
  );

  const options = edit ? (edit.step === 'final' ? fmCfg.statuses : fmCfg.results) : [];
  const needNote = form.result === 'other' && form.note.trim().length < 3;

  return (
    <>
      <form className="sx-searchbar" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); }}>
        <button type="button" className={`sx-btn ${view === 'due' ? 'sx-btn-go' : ''}`} aria-pressed={view === 'due'} onClick={() => setView('due')}>
          <PhoneCall size={14} /> Due today{data ? ` (${data.due_count})` : ''}
        </button>
        <button type="button" className={`sx-btn ${view === 'all' ? 'sx-btn-go' : ''}`} aria-pressed={view === 'all'} onClick={() => setView('all')}>
          All{data ? ` (${data.total})` : ''}
        </button>
        <label htmlFor="fm-from">1st monthly from:</label>
        <input id="fm-from" type="date" className="sx-input" style={{ width: 150 }} value={range.from || data?.range.date_from || ''}
          onChange={(e) => setRange({ from: e.target.value, to: range.to || data?.range.date_to || '' })} />
        <label htmlFor="fm-to">to:</label>
        <input id="fm-to" type="date" className="sx-input" style={{ width: 150 }} value={range.to || data?.range.date_to || ''}
          onChange={(e) => setRange({ from: range.from || data?.range.date_from || '', to: e.target.value })} />
        <label htmlFor="fm-search">Search:</label>
        <input id="fm-search" className="sx-input" style={{ width: 180 }} value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Phone, name or policy #" />
        <button type="submit" className="sx-btn" disabled={loading}><Search size={14} /> Search</button>
        <button type="button" className="sx-btn" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button>
        {onExport && data && (
          <button type="button" className="sx-btn" disabled={!rows.sorted.length} onClick={exportRows}><Download size={14} /> Export</button>
        )}
      </form>

      <div className="sx-body" style={{ paddingTop: 8 }}>
        {error && <div className="sx-note bad">{error}</div>}
        <div className="sx-hint" style={{ marginBottom: 6 }}>
          Call 1 week, 3 days and 1 day before the first monthly payment. If the customer agrees, the later calls show N/A.
          After the payment date, set the 1st Monthly Status.{canWork ? ' Click a yellow box to log it.' : ''}
        </div>
        <div className="sx-gridwrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
          <table className="sx-grid">
            <thead>
              <tr>
                <SortTh label="Policy date" k="policy_date" {...th} />
                <SortTh label="1st Monthly date" k="monthly" {...th} />
                <SortTh label="CLI" k="phone" {...th} />
                <SortTh label="Customer" k="customer" {...th} />
                <SortTh label="Client" k="client" {...th} />
                <SortTh label="Policy #" k="policy" {...th} />
                <SortTh label="Status" k="status" {...th} />
                <SortTh label="Follow up 1" k="fu1" {...th} title="1 week before the first monthly" />
                <SortTh label="Follow up 2" k="fu2" {...th} title="3 days before the first monthly" />
                <SortTh label="Follow up 3" k="fu3" {...th} title="1 day before the first monthly" />
                <SortTh label="1st Monthly Status" k="final" {...th} />
              </tr>
            </thead>
            <tbody>
              {!loading && rows.sorted.length === 0 && (
                <tr><td colSpan={11}><div className="sx-empty">
                  {view === 'due' ? 'Nothing is due today. Open "All" to see every policy in the date range.' : 'No policies have their first monthly in this date range.'}
                </div></td></tr>
              )}
              {rows.sorted.map((r) => {
                const st = saleStatus(r.status);
                return (
                  <tr key={r.id}>
                    <td className="nowrap">{day(r.sale_date)}</td>
                    <td className="nowrap"><b>{day(r.monthly_date)}</b></td>
                    <td className="nowrap">{r.customer_phone}</td>
                    <td className="nowrap">
                      {onOpenSale
                        ? <button type="button" className="sx-link" onClick={() => onOpenSale(r.id)}>{r.customer_name || '(no name)'}</button>
                        : (r.customer_name || '(no name)')}
                    </td>
                    <td className="nowrap">{r.client_name}</td>
                    <td className="nowrap">{r.policy_number || r.reference_no}</td>
                    <td className="nowrap">{st.tone === 'cancelled' ? 'Cancelled' : 'Open'}</td>
                    {STEP_KEYS.map((k) => {
                      const s = r.steps[k];
                      const tip = s.state === 'done'
                        ? [s.agent_name, dateTime(s.done_at), s.note].filter(Boolean).join(' - ')
                        : (s.due ? `${stepLabel(k)}: ${day(s.due)}` : '');
                      // A cancelled policy has nothing to log; everything else can be
                      // logged or corrected by an agent at any time.
                      const editable = canWork && s.state !== 'na';
                      return (
                        <td key={k} className={`fm-cell fm-${s.state}`} title={tip}>
                          {editable
                            ? <button type="button" className="fm-btn" onClick={() => openStep(r, k)}>{cellText(s)}</button>
                            : cellText(s)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="sx-hint" style={{ marginTop: 6 }}>
          {loading ? 'Loading...' : `${rows.sorted.length.toLocaleString()} shown.`} Days are US Eastern. Hover a box to see who logged it and their note.
        </div>
      </div>

      {edit && (
        <SxDialog title={`${stepLabel(edit.step)} - ${edit.row.customer_name || 'Customer'}`} onClose={() => setEdit(null)} busy={busy}
          footer={<>
            <button type="button" className="sx-btn" onClick={() => setEdit(null)} disabled={busy}>Cancel</button>
            <button type="button" className="sx-btn sx-btn-go" disabled={busy || !form.result || needNote} onClick={save}>
              {busy ? 'Saving...' : 'Save'}
            </button>
          </>}>
          {dlgError && <div className="sx-note bad" role="alert">{dlgError}</div>}
          <div className="sx-fld">
            <label>Customer:</label>
            <div>{edit.row.customer_phone} - policy {edit.row.policy_number || edit.row.reference_no} - first monthly {day(edit.row.monthly_date)}</div>
          </div>
          <div className="sx-fld">
            <label htmlFor="fm-result">{edit.step === 'final' ? 'Payment status:' : 'Call result:'}</label>
            <select id="fm-result" className="sx-select" value={form.result} onChange={(e) => setForm((v) => ({ ...v, result: e.target.value }))}>
              <option value="">-- pick one --</option>
              {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
          <div className="sx-fld">
            <label htmlFor="fm-note">Notes{form.result === 'other' ? '' : ' (optional)'}:</label>
            <textarea id="fm-note" className="sx-textarea" value={form.note} maxLength={2000}
              onChange={(e) => setForm((v) => ({ ...v, note: e.target.value }))}
              placeholder="What the customer said." />
          </div>
          {edit.step !== 'final' && (
            <div className="sx-hint">Pick &quot;Agreed - will pay&quot; and the later follow-ups are marked N/A for this customer.</div>
          )}
        </SxDialog>
      )}
    </>
  );
}
