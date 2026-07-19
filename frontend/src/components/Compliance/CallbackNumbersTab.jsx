import { useState, useCallback, useEffect } from 'react';
import { Hash, Phone } from 'lucide-react';
import { Badge } from '../UI';
import client from '../../api/client';
import {
  LIMIT, fmtDateTime,
  TabHeader, Spinner, Empty, Pagination, Th, Filters, FInput, FSelect,
} from './shared';
import CallbackNumberDetailDrawer from '../Shared/CallbackNumberDetailDrawer';

const NUM_STATUS_BADGE   = { active: 'success', claimable: 'warning', released: 'secondary' };
const NUM_STATUSES       = ['active', 'claimable', 'released'];

const OUTCOME_COLOR = {
  answered_sold:     { color: '#16a34a', bg: '#dcfce7' },
  answered_no_sale:  { color: '#2563eb', bg: '#dbeafe' },
  answered_callback: { color: '#7c3aed', bg: '#ede9fe' },
  no_answer:         { color: '#d97706', bg: '#fef3c7' },
  voicemail:         { color: '#0891b2', bg: '#cffafe' },
  wrong_number:      { color: '#dc2626', bg: '#fee2e2' },
  do_not_call:       { color: '#7f1d1d', bg: '#fecaca' },
};

const OutcomePill = ({ outcome }) => {
  if (!outcome) return <span className="text-xs text-text-secondary">—</span>;
  const m = OUTCOME_COLOR[outcome];
  const label = outcome.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  if (!m) return <span className="text-xs text-text-secondary">{label}</span>;
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: m.bg, color: m.color }}>
      {label}
    </span>
  );
};

const CallbackNumbersTab = ({ companyList }) => {
  const [rows, setRows]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [status, setStatus]   = useState('');
  const [company, setCompany] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get('compliance/callback-numbers', {
        params: {
          search:     search   || undefined,
          status:     status   || undefined,
          company_id: company  || undefined,
          page, limit: LIMIT,
        },
      });
      setRows(res.data.numbers || []);
      setTotal(res.data.total || 0);
    } catch { /* non-critical */ } finally { setLoading(false); }
  }, [search, status, company, page]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <TabHeader
        title="Call Numbers"
        subtitle="Callback number ownership and call history across all companies — read-only"
        onRefresh={() => { setPage(1); load(); }}
      />

      <Filters onSubmit={() => { setPage(1); load(); }}>
        <FInput search label="Search" placeholder="Phone number…" value={search} onChange={e => setSearch(e.target.value)} />
        <FSelect label="Company" value={company} onChange={e => setCompany(e.target.value)}>
          <option value="">All companies</option>
          {companyList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FSelect>
        <FSelect label="Status" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {NUM_STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </FSelect>
      </Filters>

      <div className="rounded-xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {loading ? <Spinner /> : rows.length === 0 ? (
          <Empty icon={Phone} msg="No callback numbers found." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  <Th>Phone Number</Th>
                  <Th>Company</Th>
                  <Th>Current Owner</Th>
                  <Th>Status</Th>
                  <Th>Attempts</Th>
                  <Th>Last Outcome</Th>
                  <Th>Last Attempt</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="cursor-pointer"
                    style={{ borderBottom: '1px solid var(--color-border)' }}
                    onClick={() => setSelected(r)}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Hash size={12} style={{ color: 'var(--color-primary-500)', flexShrink: 0 }} />
                        <span className="font-mono font-semibold" style={{ color: 'var(--color-text)' }}>
                          {r.phone_number}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {r.company_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {r.owner_name || <span className="italic opacity-60">Unowned</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={NUM_STATUS_BADGE[r.status] || 'secondary'} size="sm">
                        {r.status?.charAt(0).toUpperCase() + r.status?.slice(1)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-center" style={{ color: 'var(--color-text-secondary)' }}>
                      {r.attempt_count ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <OutcomePill outcome={r.last_outcome} />
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                      {r.last_attempt_at ? fmtDateTime(r.last_attempt_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={page} total={total} limit={LIMIT} onPage={setPage} />
      </div>

      {selected && (
        <CallbackNumberDetailDrawer
          numberId={selected.id}
          numberRow={selected}
          onClose={() => setSelected(null)}
          apiBase="compliance/callback-numbers"
        />
      )}
    </div>
  );
};

export default CallbackNumbersTab;
