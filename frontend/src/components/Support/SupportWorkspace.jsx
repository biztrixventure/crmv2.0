// ============================================================================
// SupportWorkspace -- the support agent's desk.
//
// One row of square tabs across the top, the way the old program had them:
//   Cancelled   every cancelled policy of the agent's clients (the main list)
//   Active      policies still in force -- call them before they cancel
//   My Cases    customers I have started working
//   Follow-ups  cases with a call-back time, soonest first
//   Saved       saved by me, not yet sent to compliance
//   With Compliance / Sent Back / Approved / Not Saved
//   My Stats    my own numbers for a date range
//
// Clicking a row opens the PolicyScreen; its toolbar steps "Policy 3 of 50"
// through the list that was on screen. The server decides what each list
// holds (routes/support.js) -- this component only asks.
// ============================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import client from '../../api/client';
import PolicyScreen from './PolicyScreen';
import { money, day, dateTime, saleStatus, caseStatus, vehicle, errText } from './supportFormat';
import './support.css';

const VIEWS = [
  { key: 'cancelled', label: 'Cancelled', kind: 'policies' },
  { key: 'active',    label: 'Active',    kind: 'policies' },
  { key: 'mine',      label: 'My Cases',  kind: 'cases' },
  { key: 'followups', label: 'Follow-ups', kind: 'cases' },
  { key: 'saved',     label: 'Saved',     kind: 'cases' },
  { key: 'pending',   label: 'With Compliance', kind: 'cases' },
  { key: 'returned',  label: 'Sent Back', kind: 'cases' },
  { key: 'approved',  label: 'Approved',  kind: 'cases' },
  { key: 'lost',      label: 'Not Saved', kind: 'cases' },
  { key: 'stats',     label: 'My Stats',  kind: 'stats' },
];
const PAGE = 50;

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const monthStartIso = () => `${todayIso().slice(0, 8)}01`;

export default function SupportWorkspace() {
  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState('');
  const [view, setView] = useState('cancelled');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  // The open policy is remembered by SALE ID, not by row number: logging a call
  // or sending a case reloads the list, and a row that leaves it (a Saved case
  // that was just sent) must not swap the screen to whichever row took its place.
  const [openId, setOpenId] = useState(null);         // opened from the list
  const [openSale, setOpenSale] = useState(null);     // opened from the Policies tab (may not be in the list)
  const [stats, setStats] = useState(null);
  const [range, setRange] = useState({ from: monthStartIso(), to: todayIso() });
  const reqId = useRef(0);

  const kind = VIEWS.find((v) => v.key === view)?.kind;

  useEffect(() => {
    client.get('support/me')
      .then((r) => setMe(r.data))
      .catch((e) => setMeError(errText(e, 'Could not open the support desk.')));
  }, []);

  const load = useCallback(async () => {
    if (!me) return;
    const id = ++reqId.current;
    setLoading(true); setError('');
    try {
      if (kind === 'stats') {
        const r = await client.get('support/reports', { params: { date_from: range.from, date_to: range.to } });
        if (id === reqId.current) setStats(r.data);
      } else if (kind === 'policies') {
        const r = await client.get('support/policies', {
          params: { view, page, limit: PAGE, search: search || undefined, client: clientFilter || undefined },
        });
        if (id === reqId.current) { setRows(r.data.policies || []); setTotal(r.data.total || 0); }
      } else {
        const r = await client.get('support/cases', { params: { view, page, limit: PAGE } });
        if (id === reqId.current) { setRows(r.data.cases || []); setTotal(r.data.total || 0); }
      }
    } catch (e) {
      if (id === reqId.current) { setRows([]); setTotal(0); setError(errText(e, 'Could not load the list.')); }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [me, kind, view, page, search, clientFilter, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const pickView = (k) => { setView(k); setPage(1); setRows([]); setTotal(0); setOpenId(null); setOpenSale(null); };
  const runSearch = (e) => { e.preventDefault(); setPage(1); setSearch(searchInput.trim()); };

  const saleIdOf = (r) => (kind === 'cases' ? r.sale_id : r.id);
  const openIdx = openId ? rows.findIndex((r) => saleIdOf(r) === openId) : -1;
  const shownSale = openSale || openId;
  const openAt = (i) => setOpenId(saleIdOf(rows[i]) || null);

  if (meError) return <div className="sx"><div className="sx-body"><div className="sx-note bad">{meError}</div></div></div>;
  if (!me) return <div className="sx"><div className="sx-empty">Opening the support desk...</div></div>;

  const noClients = Array.isArray(me.clients) && me.clients.length === 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="sx">
      <div className="sx-tabstrip" role="tablist" aria-label="Support lists">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className="sx-tab" onClick={() => pickView(v.key)}>
            {v.key === 'cancelled' && <Search size={14} />}{v.label}
            {view === v.key && v.kind !== 'stats' && <span className="sx-count">({total.toLocaleString()})</span>}
          </button>
        ))}
      </div>

      {noClients && (
        <div className="sx-body">
          <div className="sx-note">No clients have been assigned to you yet. Ask your superadmin or compliance manager to choose which clients you support. Until then your lists are empty.</div>
        </div>
      )}

      {shownSale ? (
        <PolicyScreen
          key={shownSale}
          saleId={shownSale}
          outcomes={me.outcomes}
          mode="work"
          position={!openSale && openIdx >= 0 ? { index: (page - 1) * PAGE + openIdx, total } : null}
          onPrev={!openSale && openIdx > 0 ? () => openAt(openIdx - 1) : null}
          onNext={!openSale && openIdx >= 0 && openIdx < rows.length - 1 ? () => openAt(openIdx + 1) : null}
          onBack={() => { if (openSale) setOpenSale(null); else setOpenId(null); }}
          onOpenSale={(id) => setOpenSale(id)}
          onChanged={load}
        />
      ) : kind === 'stats' ? (
        <div className="sx-body">
          <form className="sx-searchbar" style={{ padding: '0 0 8px', border: 'none' }} onSubmit={(e) => { e.preventDefault(); load(); }}>
            <label htmlFor="sx-from">From:</label>
            <input id="sx-from" type="date" className="sx-input" style={{ width: 150 }} value={range.from} max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            <label htmlFor="sx-to">To:</label>
            <input id="sx-to" type="date" className="sx-input" style={{ width: 150 }} value={range.to} min={range.from}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
            <button type="submit" className="sx-btn" disabled={loading}><RefreshCw size={14} /> Refresh</button>
          </form>
          {error && <div className="sx-note bad">{error}</div>}
          {stats && (() => {
            const t = stats.totals || {};
            const mine = stats.agents?.[0];
            return (
              <>
                <div className="sx-stats">
                  <div className="sx-stat"><b>{t.calls || 0}</b>Calls made</div>
                  <div className="sx-stat"><b>{mine?.customers || 0}</b>Customers called</div>
                  <div className="sx-stat"><b>{t.saved || 0}</b>Marked saved</div>
                  <div className="sx-stat"><b>{t.submitted || 0}</b>Sent to compliance</div>
                  <div className="sx-stat"><b>{t.approved || 0}</b>Approved</div>
                  <div className="sx-stat"><b>{t.returned || 0}</b>Sent back</div>
                  <div className="sx-stat"><b>{t.lost || 0}</b>Not saved</div>
                  <div className="sx-stat"><b>{mine?.save_rate == null ? '-' : `${mine.save_rate}%`}</b>Save rate</div>
                </div>
                <div className="sx-gridwrap" style={{ maxHeight: '55vh' }}>
                  <table className="sx-grid">
                    <thead><tr><th>Date / Time (ET)</th><th>Customer</th><th>Client</th><th>Outcome</th><th>What happened</th></tr></thead>
                    <tbody>
                      {(stats.calls || []).length === 0 && <tr><td colSpan={5}><div className="sx-empty">No calls in this date range.</div></td></tr>}
                      {(stats.calls || []).map((c) => (
                        <tr key={c.id}>
                          <td className="nowrap">{dateTime(c.called_at)}</td>
                          <td className="nowrap">{c.customer_name}</td>
                          <td className="nowrap">{c.client_name}</td>
                          <td className="nowrap">{c.outcome_label}</td>
                          <td className="story">{c.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
        </div>
      ) : (
        <>
          {kind === 'policies' && (
            <form className="sx-searchbar" onSubmit={runSearch}>
              <label htmlFor="sx-search">Search:</label>
              <input id="sx-search" className="sx-input" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Phone, name, policy number or VIN" />
              {(me.clients === null || me.clients.length > 1) && (
                <>
                  <label htmlFor="sx-client">Client:</label>
                  <ClientSelect id="sx-client" me={me} value={clientFilter} onChange={(v) => { setClientFilter(v); setPage(1); }} />
                </>
              )}
              <button type="submit" className="sx-btn"><Search size={14} /> Search</button>
              {(search || clientFilter) && (
                <button type="button" className="sx-btn" onClick={() => { setSearchInput(''); setSearch(''); setClientFilter(''); setPage(1); }}>Clear</button>
              )}
            </form>
          )}

          <div className="sx-body" style={{ paddingTop: 8 }}>
            {error && <div className="sx-note bad">{error}</div>}
            <div className="sx-gridwrap" style={{ maxHeight: 'calc(100vh - 250px)' }}>
              {kind === 'policies'
                ? <PolicyGrid rows={rows} loading={loading} view={view} onOpen={openAt} />
                : <CaseGrid rows={rows} loading={loading} view={view} onOpen={openAt} />}
            </div>
          </div>

          <div className="sx-statusbar">
            <span>{loading ? 'Loading...' : `${total.toLocaleString()} record${total === 1 ? '' : 's'}`}</span>
            <span className="sx-spacer" />
            <button type="button" className="sx-tool" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="sx-tool" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
            <button type="button" className="sx-tool" onClick={load} disabled={loading}><RefreshCw size={14} /> Refresh</button>
          </div>
        </>
      )}
    </div>
  );
}

function ClientSelect({ id, me, value, onChange }) {
  const [all, setAll] = useState(me.clients || []);
  useEffect(() => {
    if (me.clients !== null) { setAll(me.clients); return; }
    client.get('support/clients').then((r) => setAll(r.data.clients || [])).catch(() => setAll([]));
  }, [me.clients]);
  return (
    <select id={id} className="sx-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All my clients</option>
      {all.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

// A row opens on click, and on Enter / Space for keyboard users.
const rowProps = (onOpen, i) => ({
  className: 'pick',
  tabIndex: 0,
  onClick: () => onOpen(i),
  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(i); } },
});

function PolicyGrid({ rows, loading, view, onOpen }) {
  return (
    <table className="sx-grid">
      <thead>
        <tr>
          <th>Customer</th><th>Phone</th><th>Client</th><th>Vehicle</th><th>Coverage</th>
          <th>Effective</th><th>{view === 'active' ? 'Monthly' : 'Cancelled'}</th><th>Policy Number</th><th>Status</th><th>Retention</th>
        </tr>
      </thead>
      <tbody>
        {!loading && rows.length === 0 && (
          <tr><td colSpan={10}><div className="sx-empty">
            {view === 'active' ? 'No active policies match.' : 'No cancelled policies match.'}
          </div></td></tr>
        )}
        {rows.map((r, i) => {
          const st = saleStatus(r.status);
          const cs = r.case ? caseStatus(r.case.status) : null;
          return (
            <tr key={r.id} {...rowProps(onOpen, i)}>
              <td className="nowrap"><span className="sx-link">{r.customer_name || '(no name)'}</span></td>
              <td className="nowrap">{r.customer_phone}</td>
              <td className="nowrap">{r.client_name}</td>
              <td className="nowrap">{vehicle(r)}</td>
              <td className="nowrap">{r.plan}</td>
              <td className="nowrap">{day(r.sale_date)}</td>
              <td className={view === 'active' ? 'num' : 'nowrap'}>{view === 'active' ? money(r.monthly_payment) : day(r.cancellation_date)}</td>
              <td className="nowrap">{r.policy_number || r.reference_no}</td>
              <td className="nowrap"><span className={`sx-pill ${st.tone === 'active' ? 'green' : st.tone === 'cancelled' ? 'red' : 'amber'}`}>{st.label}</span></td>
              <td className="nowrap">
                {cs
                  ? <><span className={`sx-pill ${cs.pill}`}>{cs.label}</span>{!r.case.mine && r.case.agent_name ? ` ${r.case.agent_name}` : ''}</>
                  : ''}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CaseGrid({ rows, loading, view, onOpen }) {
  return (
    <table className="sx-grid">
      <thead>
        <tr>
          <th>Customer</th><th>Phone</th><th>Client</th><th>Policy Number</th><th>Case</th>
          <th className="num">Calls</th><th>Last Call</th><th>{view === 'followups' ? 'Follow up on' : 'Updated'}</th><th>Policy</th>
        </tr>
      </thead>
      <tbody>
        {!loading && rows.length === 0 && (
          <tr><td colSpan={9}><div className="sx-empty">
            {view === 'followups' ? 'No follow-ups scheduled.' : 'Nothing in this list.'}
          </div></td></tr>
        )}
        {rows.map((r, i) => {
          const cs = caseStatus(r.status);
          const st = saleStatus(r.sale?.status);
          const overdue = view === 'followups' && r.next_follow_up_at && new Date(r.next_follow_up_at) < new Date();
          // A case whose sale was deleted has nothing to open.
          const props = r.sale_id ? rowProps(onOpen, i) : {};
          return (
            <tr key={r.id} {...props}>
              <td className="nowrap"><span className={r.sale_id ? 'sx-link' : ''}>{r.customer_name || r.sale?.customer_name || '(no name)'}</span></td>
              <td className="nowrap">{r.sale?.customer_phone}</td>
              <td className="nowrap">{r.client_name}</td>
              <td className="nowrap">{r.reference_no}</td>
              <td className="nowrap"><span className={`sx-pill ${cs.pill}`}>{cs.label}</span></td>
              <td className="num">{r.call_count}</td>
              <td className="nowrap">{dateTime(r.last_call_at)}</td>
              <td className="nowrap">
                {view === 'followups'
                  ? <span className={overdue ? 'sx-pill red' : ''}>{dateTime(r.next_follow_up_at)}{overdue ? ' (due)' : ''}</span>
                  : dateTime(r.updated_at)}
              </td>
              <td className="nowrap">{r.sale ? st.label : 'Removed'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
