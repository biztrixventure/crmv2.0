// ============================================================================
// SupportWorkspace -- the support agent's desk.
//
// One row of square tabs across the top, the way the old program had them:
//   Cancelled    every cancelled policy of the agent's clients (the main list)
//   Active       policies still in force -- call them before they cancel
//   In Progress  customers I am working
//   Follow-ups   cases with a call-back time, soonest first
//   Saved / Not Saved
//   My Stats     my own numbers for a date range
//
// Every column header sorts on click. These lists are paged, so the sort is
// done by the SERVER (sorting only the 50 rows on screen would lie about the
// order); the one exception is the Retention column of the policy lists, which
// is not a column of the sale and so sorts the page that is showing.
//
// Rows are tinted by how the customer's LAST call ended (the outcome picked in
// Log Call), so a list reads at a glance -- the legend above each grid says
// which colour is which.
//
// Clicking a row opens the PolicyScreen; its toolbar steps "Policy 3 of 50"
// through the list that was on screen. The server decides what each list
// holds (routes/support.js) -- this component only asks.
// ============================================================================
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import client from '../../api/client';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import PolicyScreen from './PolicyScreen';
import SupportColorStyle from './supportColors';
import { SortTh, useClientSort } from './sxSort';
import {
  money, day, dateTime, saleStatus, caseStatus, vehicle, errText, outcomeOf, toneClass, caseRowTone, monthlyDate,
} from './supportFormat';
import './support.css';

const VIEWS = [
  { key: 'cancelled', label: 'Cancelled',   kind: 'policies' },
  { key: 'active',    label: 'Active',      kind: 'policies' },
  { key: 'mine',      label: 'In Progress', kind: 'cases' },
  { key: 'followups', label: 'Follow-ups',  kind: 'cases' },
  { key: 'saved',     label: 'Saved',       kind: 'cases' },
  { key: 'lost',      label: 'Not Saved',   kind: 'cases' },
  { key: 'stats',     label: 'My Stats',    kind: 'stats' },
];
const PAGE = 50;
const LIVE_TYPES = ['support_followup_due', 'support_tag_done'];

// Columns that are NOT a column of the table being paged (they come from the
// joined case or sale), so the server cannot order by them: these sort the page
// that is showing. Everything else is sorted by the server across all pages.
const PAGE_SORT = {
  policies: { retention: (r) => (r.case ? caseStatus(r.case.status).label : '') },
  cases: {
    phone: (r) => r.sale?.customer_phone || '',
    monthly_date: (r) => (r.sale?.monthly_date && r.sale.monthly_date !== '-' ? r.sale.monthly_date : ''),
    policy_status: (r) => (r.sale ? saleStatus(r.sale.status).label : ''),
  },
};

const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const monthStartIso = () => `${todayIso().slice(0, 8)}01`;

function Legend({ outcomes, colors }) {
  return (
    <div className="sx-legend" aria-label="Row colours">
      <span className="sx-swatch"><i className="cs-saved" />Saved</span>
      <span className="sx-swatch"><i className="cs-open" />In Progress</span>
      <span>Last call:</span>
      {outcomes.filter((o) => colors?.outcomes?.[o.key]).map((o) => (
        <span key={o.key} className="sx-swatch"><i className={`sx-oc-${o.key}`} />{o.label}</span>
      ))}
    </div>
  );
}

export default function SupportWorkspace() {
  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState('');
  const [view, setView] = useState('cancelled');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState(null);             // { key, dir } or null = the list's own order
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  // The open policy is remembered by SALE ID, not by row number: logging a call
  // reloads the list, and a row that leaves it (a case just marked Saved) must
  // not swap the screen to whichever row took its place.
  const [openId, setOpenId] = useState(null);         // opened from the list
  const [openSale, setOpenSale] = useState(null);     // opened from the Policies tab (may not be in the list)
  const [stats, setStats] = useState(null);
  const [range, setRange] = useState({ from: monthStartIso(), to: todayIso() });
  const reqId = useRef(0);

  const kind = VIEWS.find((v) => v.key === view)?.kind;
  const pageSorter = sort ? PAGE_SORT[kind]?.[sort.key] : null;
  const serverSort = sort && !pageSorter ? sort : null;

  useEffect(() => {
    client.get('support/me')
      .then((r) => setMe(r.data))
      .catch((e) => setMeError(errText(e, 'Could not open the support desk.')));
  }, []);

  const load = useCallback(async () => {
    if (!me) return;
    const id = ++reqId.current;
    setLoading(true); setError('');
    const sortParams = serverSort ? { sort: serverSort.key, dir: serverSort.dir } : {};
    try {
      if (kind === 'stats') {
        const r = await client.get('support/reports', { params: { date_from: range.from, date_to: range.to } });
        if (id === reqId.current) setStats(r.data);
      } else if (kind === 'policies') {
        const r = await client.get('support/policies', {
          params: { view, page, limit: PAGE, search: search || undefined, client: clientFilter || undefined, ...sortParams },
        });
        if (id === reqId.current) { setRows(r.data.policies || []); setTotal(r.data.total || 0); }
      } else {
        const r = await client.get('support/cases', { params: { view, page, limit: PAGE, ...sortParams } });
        if (id === reqId.current) { setRows(r.data.cases || []); setTotal(r.data.total || 0); }
      }
    } catch (e) {
      if (id === reqId.current) { setRows([]); setTotal(0); setError(errText(e, 'Could not load the list.')); }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // serverSort is derived from sort; its key + dir are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, kind, view, page, search, clientFilter, range.from, range.to, serverSort?.key, serverSort?.dir]);

  useEffect(() => { load(); }, [load]);
  // A follow-up coming due, or a closer finishing a tag, arrives as a
  // notification: refresh the list that is showing (never a hidden tab, and
  // not while a policy is open on top of it -- that screen reloads itself).
  useLiveRefresh(LIVE_TYPES, load, { enabled: !openId && !openSale });

  const pickView = (k) => { setView(k); setPage(1); setSort(null); setRows([]); setTotal(0); setOpenId(null); setOpenSale(null); };
  const runSearch = (e) => { e.preventDefault(); setPage(1); setSearch(searchInput.trim()); };
  const changeSort = (next) => { setSort(next); setPage(1); };

  // Page-sorted columns (see PAGE_SORT). Blanks always sink to the bottom.
  const shown = useMemo(() => {
    if (!pageSorter) return rows;
    const sign = sort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = pageSorter(a), y = pageSorter(b);
      if (!x && !y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return sign * String(x).localeCompare(String(y), undefined, { numeric: true });
    });
  }, [rows, sort, pageSorter]);

  const saleIdOf = (r) => (kind === 'cases' ? r.sale_id : r.id);
  const openIdx = openId ? shown.findIndex((r) => saleIdOf(r) === openId) : -1;
  const shownSale = openSale || openId;
  const openAt = (i) => setOpenId(saleIdOf(shown[i]) || null);

  if (meError) return <div className="sx"><div className="sx-body"><div className="sx-note bad">{meError}</div></div></div>;
  if (!me) return <div className="sx"><div className="sx-empty">Opening the support desk...</div></div>;

  const noClients = Array.isArray(me.clients) && me.clients.length === 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="sx">
      <SupportColorStyle colors={me.colors} />
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
          <div className="sx-note">No clients have been assigned to you yet. Ask your superadmin to choose which clients you support. Until then your lists are empty.</div>
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
          onNext={!openSale && openIdx >= 0 && openIdx < shown.length - 1 ? () => openAt(openIdx + 1) : null}
          onBack={() => { if (openSale) setOpenSale(null); else setOpenId(null); }}
          onOpenSale={(id) => setOpenSale(id)}
          onChanged={load}
        />
      ) : kind === 'stats' ? (
        <StatsView stats={stats} range={range} setRange={setRange} loading={loading} error={error} onRefresh={load} outcomes={me.outcomes} />
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
            <Legend outcomes={me.outcomes} colors={me.colors} />
            <div className="sx-gridwrap" style={{ maxHeight: 'calc(100vh - 285px)' }}>
              {kind === 'policies'
                ? <PolicyGrid rows={shown} loading={loading} view={view} onOpen={openAt} sort={sort} onSort={changeSort} outcomes={me.outcomes} />
                : <CaseGrid rows={shown} loading={loading} view={view} onOpen={openAt} sort={sort} onSort={changeSort} outcomes={me.outcomes} />}
            </div>
          </div>

          <div className="sx-statusbar">
            <span>{loading ? 'Loading...' : `${total.toLocaleString()} record${total === 1 ? '' : 's'}`}</span>
            {sort && (
              <span>
                {pageSorter ? 'Sorted within this page.' : 'Sorted across all pages.'}{' '}
                <button type="button" className="sx-link" onClick={() => changeSort(null)}>Reset order</button>
              </span>
            )}
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
const rowProps = (onOpen, i, extra = '') => ({
  className: `pick ${extra}`.trim(),
  tabIndex: 0,
  onClick: () => onOpen(i),
  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(i); } },
});

function PolicyGrid({ rows, loading, view, onOpen, sort, onSort, outcomes }) {
  const th = { sort, onSort };
  return (
    <table className="sx-grid">
      <thead>
        <tr>
          <SortTh label="Customer" k="customer" {...th} />
          <SortTh label="Phone" k="phone" {...th} />
          <SortTh label="Client" k="client" {...th} />
          <SortTh label="Vehicle" k="vehicle" {...th} />
          <SortTh label="Coverage" k="coverage" {...th} />
          <SortTh label="Effective" k="effective" {...th} />
          {view !== 'active' && <SortTh label="Cancelled" k="cancelled" {...th} />}
          <SortTh label="Monthly" k="monthly" num {...th} />
          <SortTh label="Monthly Date" k="monthly_date" {...th} title="Sort by the monthly payment date" />
          <SortTh label="Policy Number" k="policy" {...th} />
          <SortTh label="Status" k="status" {...th} />
          <SortTh label="Retention" k="retention" {...th} title="Sort the rows on this page by retention status" />
        </tr>
      </thead>
      <tbody>
        {!loading && rows.length === 0 && (
          <tr><td colSpan={12}><div className="sx-empty">
            {view === 'active' ? 'No active policies match.' : 'No cancelled policies match.'}
          </div></td></tr>
        )}
        {rows.map((r, i) => {
          const st = saleStatus(r.status);
          const cs = r.case ? caseStatus(r.case.status) : null;
          return (
            <tr key={r.id} {...rowProps(onOpen, i, r.case ? caseRowTone(outcomes, r.case.status, r.case.last_outcome) : '')}>
              <td className="nowrap"><span className="sx-link">{r.customer_name || '(no name)'}</span></td>
              <td className="nowrap">{r.customer_phone}</td>
              <td className="nowrap">{r.client_name}</td>
              <td className="nowrap">{vehicle(r)}</td>
              <td className="nowrap">{r.plan}</td>
              <td className="nowrap">{day(r.sale_date)}</td>
              {view !== 'active' && <td className="nowrap">{day(r.cancellation_date)}</td>}
              <td className="num">{money(r.monthly_payment)}</td>
              <td className="nowrap">{monthlyDate(r.monthly_date)}</td>
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

function CaseGrid({ rows, loading, view, onOpen, sort, onSort, outcomes }) {
  const th = { sort, onSort };
  const now = Date.now();
  return (
    <table className="sx-grid">
      <thead>
        <tr>
          <SortTh label="Customer" k="customer" {...th} />
          <SortTh label="Phone" k="phone" {...th} title="Sort the rows on this page by phone" />
          <SortTh label="Client" k="client" {...th} />
          <SortTh label="Policy Number" k="policy" {...th} />
          <SortTh label="Status" k="status" {...th} />
          <SortTh label="Last Outcome" k="outcome" {...th} />
          <SortTh label="Calls" k="calls" num {...th} />
          <SortTh label="Last Call" k="last_call" {...th} />
          <SortTh label="Follow up on" k="follow_up" {...th} />
          <SortTh label="Updated" k="updated" {...th} />
          <SortTh label="Monthly Date" k="monthly_date" {...th} title="Sort the rows on this page by monthly payment date" />
          <SortTh label="Policy" k="policy_status" {...th} title="Sort the rows on this page by policy status" />
        </tr>
      </thead>
      <tbody>
        {!loading && rows.length === 0 && (
          <tr><td colSpan={12}><div className="sx-empty">
            {view === 'followups' ? 'No follow-ups scheduled. Pick a follow-up time when you log a call and it appears here.' : 'Nothing in this list.'}
          </div></td></tr>
        )}
        {rows.map((r, i) => {
          const cs = caseStatus(r.status);
          const st = saleStatus(r.sale?.status);
          const due = !!r.next_follow_up_at && Date.parse(r.next_follow_up_at) <= now;
          const tone = `${caseRowTone(outcomes, r.status, r.last_outcome)} ${due ? 'sx-overdue' : ''}`.trim();
          // A case whose sale was deleted has nothing to open.
          const props = r.sale_id ? rowProps(onOpen, i, tone) : { className: tone };
          return (
            <tr key={r.id} {...props}>
              <td className="nowrap"><span className={r.sale_id ? 'sx-link' : ''}>{r.customer_name || r.sale?.customer_name || '(no name)'}</span></td>
              <td className="nowrap">{r.sale?.customer_phone}</td>
              <td className="nowrap">{r.client_name}</td>
              <td className="nowrap">{r.reference_no}</td>
              <td className="nowrap"><span className={`sx-pill ${cs.pill}`}>{cs.label}</span></td>
              <td className="nowrap">{outcomeOf(outcomes, r.last_outcome)?.label}</td>
              <td className="num">{r.call_count}</td>
              <td className="nowrap">{dateTime(r.last_call_at)}</td>
              <td className="nowrap">{r.next_follow_up_at ? <>{dateTime(r.next_follow_up_at)}{due && <b> (due)</b>}</> : ''}</td>
              <td className="nowrap">{dateTime(r.updated_at)}</td>
              <td className="nowrap">{monthlyDate(r.sale?.monthly_date)}</td>
              <td className="nowrap">{r.sale ? st.label : 'Removed'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function StatsView({ stats, range, setRange, loading, error, onRefresh, outcomes }) {
  const t = stats?.totals || {};
  const mine = stats?.agents?.[0];
  const log = useClientSort(stats?.calls || [], {
    when: (r) => r.called_at, customer: (r) => r.customer_name, client: (r) => r.client_name,
    outcome: (r) => r.outcome_label, notes: (r) => r.notes,
  });
  const th = { sort: log.sort, onSort: log.setSort };
  return (
    <div className="sx-body">
      <form className="sx-searchbar" style={{ padding: '0 0 8px', border: 'none' }} onSubmit={(e) => { e.preventDefault(); onRefresh(); }}>
        <label htmlFor="sx-from">From:</label>
        <input id="sx-from" type="date" className="sx-input" style={{ width: 150 }} value={range.from} max={range.to}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <label htmlFor="sx-to">To:</label>
        <input id="sx-to" type="date" className="sx-input" style={{ width: 150 }} value={range.to} min={range.from}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        <button type="submit" className="sx-btn" disabled={loading}><RefreshCw size={14} /> Refresh</button>
      </form>
      {error && <div className="sx-note bad">{error}</div>}
      {stats && (
        <>
          <div className="sx-stats">
            <div className="sx-stat"><b>{t.calls || 0}</b>Calls made</div>
            <div className="sx-stat"><b>{mine?.customers || 0}</b>Customers called</div>
            <div className="sx-stat"><b>{t.in_progress || 0}</b>In progress now</div>
            <div className="sx-stat"><b>{t.saved || 0}</b>Saved</div>
            <div className="sx-stat"><b>{t.lost || 0}</b>Not saved</div>
            <div className="sx-stat"><b>{t.tags || 0}</b>Closers tagged</div>
            <div className="sx-stat"><b>{t.save_rate == null ? '-' : `${t.save_rate}%`}</b>Save rate</div>
          </div>
          <div className="sx-gridwrap" style={{ maxHeight: '55vh' }}>
            <table className="sx-grid">
              <thead><tr>
                <SortTh label="Date / Time (ET)" k="when" {...th} /><SortTh label="Customer" k="customer" {...th} />
                <SortTh label="Client" k="client" {...th} /><SortTh label="Outcome" k="outcome" {...th} /><SortTh label="What happened" k="notes" {...th} />
              </tr></thead>
              <tbody>
                {(stats.calls || []).length === 0 && <tr><td colSpan={5}><div className="sx-empty">No calls in this date range.</div></td></tr>}
                {log.sorted.map((c) => (
                  <tr key={c.id} className={toneClass(outcomes, c.outcome)}>
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
      )}
    </div>
  );
}
