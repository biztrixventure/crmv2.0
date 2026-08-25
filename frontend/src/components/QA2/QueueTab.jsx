// ============================================================================
// QueueTab.jsx — MY assignments (assigned_to = self). "Unassigned" doesn't
// apply here by definition (that's PoolTab) — the two live states within a
// queue are "not started" (pending) and "in review", plus a history filter
// for what's already scored/skipped. Backend: qa2Assignments.js.
//
// Column header sort/filter reuses the SAME useTableQuery/<ColumnHeader> pair
// every compliance list already drives off, alongside the existing KpiTile
// status switcher (a separate axis — pending/in_review/scored — not part of
// the column-filter catalog).
//
// The status tiles COUNT every status, not just the one being viewed. They used
// to render "—" for the two tabs you were not on, because the only number the
// component had was rows.length of the current fetch — so an agent could not
// tell they had work waiting without clicking each tile in turn. The queue
// endpoint now returns all three counts.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import {
  ListTodo, Clock, PlayCircle, CheckCircle2, Headphones, HeadphoneOff,
  Loader2, PhoneForwarded, PhoneIncoming,
} from 'lucide-react';
import client from '../../api/client';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading, KpiTile } from '../UI/kit';
import ColumnHeader from '../UI/ColumnHeader';
import { useTableQuery, useAbortable, isCanceled } from '../../hooks/useTableQuery';
import ReviewScreen from './ReviewScreen';

const FILTERS = [
  { key: 'pending', label: 'Not started', icon: Clock },
  { key: 'in_review', label: 'In review', icon: PlayCircle },
  { key: 'scored', label: 'Scored', icon: CheckCircle2 },
];
const LEG_OPTIONS = [{ value: 'fronter', label: 'Fronter' }, { value: 'closer', label: 'Closer' }];
const REC_OPTIONS = [
  { value: 'pending', label: 'Pending' }, { value: 'found', label: 'Found' },
  { value: 'missing', label: 'Missing' }, { value: 'error', label: 'Error' },
];
const th = 'text-left font-semibold px-3 py-2';

// Recording state decides whether a row can be scored at all, so it reads as a
// status pill rather than the raw enum the API returns.
const REC_META = {
  found:   { label: 'Ready',    color: '#16a34a', icon: Headphones },
  pending: { label: 'Fetching', color: '#d97706', icon: Loader2 },
  missing: { label: 'No audio', color: '#dc2626', icon: HeadphoneOff },
  error:   { label: 'Error',    color: '#dc2626', icon: HeadphoneOff },
  skipped: { label: 'Skipped',  color: '#64748b', icon: HeadphoneOff },
};
const LEG_META = {
  fronter: { label: 'Fronter', color: '#4f46e5', icon: PhoneForwarded },
  closer:  { label: 'Closer',  color: '#0891b2', icon: PhoneIncoming },
};
const EMPTY_COPY = {
  pending:   { title: 'Nothing waiting',    hint: 'Claim a call from the Pool tab, or wait for your manager to assign one.' },
  in_review: { title: 'Nothing in review',  hint: 'Calls you have opened but not finished scoring appear here.' },
  scored:    { title: 'Nothing scored yet', hint: 'Once you finish a review it moves here.' },
};

// Today / Yesterday read faster than a bare date when the whole queue is recent.
const fmtWhen = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso); const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return 'Today ' + t;
  if (diff === 1) return 'Yesterday ' + t;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + t;
};

export default function QueueTab() {
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [open, setOpen] = useState(null);
  const [columns, setColumns] = useState({});
  const [counts, setCounts] = useState(null);

  const tq = useTableQuery({ scope: 'qa2:queue', columns, defaultSort: { by: 'call_at', dir: 'desc' } });
  const abortable = useAbortable();

  // Filter options come from the ROWS, not from /compliance/companies and
  // /qa2/methods. Those two are manager/compliance-only, so a QA agent — the
  // main user of this screen — got a 403 pair on every mount and ended up with
  // empty filter dropdowns. Every row already carries company_id + name and
  // method_id + label, so the lists are built from what the agent can actually
  // see, which is also the only set worth offering them.
  const optionsFrom = (list, idKey, labelOf) => {
    const seen = new Map();
    (list || []).forEach(a => {
      const c = a.qa2_call || {};
      const id = c[idKey]; const label = labelOf(c);
      if (id && label && !seen.has(id)) seen.set(id, { value: id, label });
    });
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  };
  const companyOptions = optionsFrom(rows, 'company_id', c => c.companies?.name);
  const methodOptions  = optionsFrom(rows, 'method_id',  c => c.qa2_method?.label);

  const load = useCallback(() => {
    setLoadError(null);
    client.get('qa2/queue', { params: { status: filter, ...tq.params }, signal: abortable() })
      .then(r => {
        setRows(r.data.assignments || []);
        if (r.data.columns) setColumns(r.data.columns);
        if (r.data.counts) setCounts(r.data.counts);
      })
      .catch(e => { if (!isCanceled(e)) setLoadError(e.response?.data?.error || 'Could not load your queue'); });
  }, [filter, tq.params, abortable]);
  useEffect(() => { load(); }, [filter, tq.version]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reviewing runs down the list you are looking at. Handing ReviewScreen the
  // NEXT row means an agent can score a whole queue without returning here
  // between every call — the round trip was: back, find your place, click, wait.
  // Rows already scored drop out of the list on the next load, so "next" is
  // taken from the list as it stands when the screen opens.
  if (open) {
    const idx = rows.findIndex(r => r.id === open.id);
    const next = idx >= 0 ? rows[idx + 1] : null;
    const remaining = idx >= 0 ? Math.max(0, rows.length - idx - 1) : 0;
    return (
      <ReviewScreen
        key={open.id}
        assignment={open}
        nextAssignment={next}
        remaining={remaining}
        nextLabel={next ? 'Next record' : null}
        onNext={next ? () => setOpen(next) : null}
        onDone={() => { setOpen(null); load(); }}
      />
    );
  }

  const activeFilters = Object.entries(tq.filters || {});

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <SectionHeader level="page" icon={ListTodo} title="My queue" subtitle="Assignments already yours." />

      <div className="grid grid-cols-3 gap-3">
        {FILTERS.map(f => (
          <KpiTile key={f.key} icon={f.icon} label={f.label}
            value={counts ? (counts[f.key] ?? 0) : '…'}
            active={filter === f.key} onClick={() => setFilter(f.key)} />
        ))}
      </div>

      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Filtered</span>
          <button onClick={tq.clearAll} className="text-xs font-bold px-2.5 py-1 rounded-full"
            style={{ background: 'var(--color-primary-600)', color: '#fff' }}>
            Clear {activeFilters.length} filter{activeFilters.length > 1 ? 's' : ''}
          </button>
        </div>
      )}

      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && rows === null && <Loading variant="table" rows={4} />}
      {!loadError && rows && rows.length === 0 && (
        activeFilters.length > 0 ? (
          <EmptyState icon={ListTodo} title="No calls match your filters"
            hint="You may still have work here — these filters are hiding it."
            action={<button onClick={tq.clearAll} className="text-sm font-bold px-3 py-2 rounded-lg"
              style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>Clear all filters</button>} />
        ) : (
          <EmptyState icon={ListTodo} title={EMPTY_COPY[filter].title} hint={EMPTY_COPY[filter].hint} />
        )
      )}

      {!loadError && rows && rows.length > 0 && (
        <Panel pad="none">
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <ColumnHeader tq={tq} colKey="company" label="Company" options={companyOptions} className={th} />
                <ColumnHeader tq={tq} colKey="method" label="Method" options={methodOptions} className={th} />
                <ColumnHeader tq={tq} colKey="leg" label="Leg" options={LEG_OPTIONS} className={th} />
                <th className={th}>Agent</th>
                <th className={th}>Dispo</th>
                <th className={th}>Closer dispo</th>
                <th className={th}>Ended by</th>
                <ColumnHeader tq={tq} colKey="recording_state" label="Recording" options={REC_OPTIONS} className={th} />
                <ColumnHeader tq={tq} colKey="call_at" label="Date" className={th} />
                <th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {rows.map(a => {
                  const c = a.qa2_call || {};
                  const rec = REC_META[c.recording_state] || REC_META.pending;
                  const legM = LEG_META[c.leg] || {};
                  const LegIcon = legM.icon;
                  // A call with no audio cannot be scored — say so on the row
                  // rather than letting someone open an empty player.
                  const playable = c.recording_state === 'found';
                  return (
                    <tr key={a.id} className="hover:bg-black/[0.02]"
                      style={{ borderTop: '1px solid var(--color-border)', cursor: playable ? 'pointer' : 'default' }}
                      onClick={() => playable && setOpen(a)}>
                      <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{c.companies?.name || '—'}</td>
                      <td className="px-3 py-2">
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)' }}>
                          {c.qa2_method?.label || 'Unclassified'}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {c.leg ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: legM.color }}>
                            {LegIcon ? <LegIcon size={12} /> : null}{legM.label}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{c.agent_name || c.agent_user || '—'}</td>
                      {/* The dialer's own facts about the call — what the reviewer
                          used to have to open the record to learn. On a TRA the
                          row is the FRONTER leg (its dispo is just XFER), so the
                          CLOSER's dispo is the one that says how the lead went. */}
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.dispo_raw || '—'}</td>
                      <td className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{c.closer_dispo || '—'}</td>
                      <td className="px-3 py-2">
                        {c.hangup_label ? (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                            title={c.hangup_reason ? `Dialer: ${c.hangup_reason}` : undefined}
                            style={/^AGENT/i.test(c.hangup_reason || '')
                              ? { background: 'rgba(220,38,38,0.14)', color: '#dc2626' }
                              : { background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                            {c.hangup_label}
                          </span>
                        ) : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ background: rec.color + '1a', color: rec.color }}>
                          <rec.icon size={11} className={c.recording_state === 'pending' ? 'animate-spin' : ''} /> {rec.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{fmtWhen(c.call_at)}</td>
                      <td className="px-3 py-2 text-right">
                        <button className="btn btn-primary text-xs disabled:opacity-40" disabled={!playable}
                          title={playable ? 'Open and score' : 'Waiting for the recording'}
                          onClick={(e) => { e.stopPropagation(); setOpen(a); }}>
                          {filter === 'scored' ? 'View' : 'Score'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
}
