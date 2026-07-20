import { useState, useEffect, useCallback, Fragment } from 'react';
import { ListChecks, Loader2, ChevronRight, ChevronDown, ChevronLeft, GitBranch, Ban } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import FilterBar from '../UI/FilterBar';
import ThemedSelect from '../UI/Select';
import { Lineage } from './BatchInbox';

const PAGE = 100;
const CROSS_COMPANY = new Set(['superadmin', 'readonly_admin', 'compliance_manager']);
const EX_REASON = { already_assigned: 'already assigned', transferred_by_you: 'they transferred it', transferred_by_anyone: 'transferred by someone' };
const STATUSES = ['', 'new', 'called', 'callback', 'completed', 'skip', 'transferred', 'excluded'];
const fmt = (d) => { try { return d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return d || ''; } };

// "All assigned numbers" — flat, cross-chain roster (one row per assignment).
// Backend (/distribution-batches/roster) scopes by role; lineage is on-demand.
export default function BatchRoster() {
  const { user } = useAuth();
  const crossCompany = CROSS_COMPANY.has(user?.role);

  const [q, setQ] = useState('');
  const [dr, setDr] = useState({ date_from: '', date_to: '' });
  const [status, setStatus] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);        // item_id currently expanded
  const [lineage, setLineage] = useState({});            // batch_id -> {ancestors,descendants}

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: PAGE, offset };
      if (q)            params.q = q;
      if (status)       params.status = status;
      if (companyId)    params.company_id = companyId;
      if (dr.date_from) params.date_from = dr.date_from;
      if (dr.date_to)   params.date_to = dr.date_to;
      const r = await client.get('distribution-batches/roster', { params });
      setRows(r.data.roster || []);
      // total only on page 1 (null afterwards) — keep the page-1 total across pages.
      setTotal(t => (r.data.total == null ? t : (r.data.total || 0)));
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load the roster'); setRows([]); }
    finally { setLoading(false); }
  }, [q, status, companyId, dr.date_from, dr.date_to, offset]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!crossCompany) return;
    client.get('companies').then(r => setCompanies(r.data?.companies || r.data || [])).catch(() => {});
  }, [crossCompany]);

  // Filter changes reset to page 1 so the total recomputes for the new result set.
  const resetting = (fn) => (v) => { setOffset(0); fn(v); };

  const toggleExpand = async (row) => {
    if (expanded === row.item_id) { setExpanded(null); return; }
    setExpanded(row.item_id);
    if (!lineage[row.batch_id]) {
      try { const r = await client.get(`distribution-batches/${row.batch_id}/lineage`); setLineage(m => ({ ...m, [row.batch_id]: r.data })); }
      catch (e) { toast.error(e.response?.data?.error || 'Could not load lineage'); }
    }
  };

  const from = total ? offset + 1 : 0, to = Math.min(offset + PAGE, total);
  const extras = (
    <>
      <ThemedSelect variant="pill" value={status} onChange={e => resetting(setStatus)(e.target.value)} className="input text-sm py-1.5" style={{ borderColor: 'var(--color-border)' }} aria-label="Status">
        {STATUSES.map(s => <option key={s || 'all'} value={s}>{s ? s[0].toUpperCase() + s.slice(1) : 'All statuses'}</option>)}
      </ThemedSelect>
      {crossCompany && (
        <ThemedSelect variant="pill" value={companyId} onChange={e => resetting(setCompanyId)(e.target.value)} className="input text-sm py-1.5" style={{ borderColor: 'var(--color-border)' }} aria-label="Company">
          <option value="">All companies</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </ThemedSelect>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ListChecks size={18} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Assigned Numbers</h2>
        <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{crossCompany ? 'everyone' : 'your chain + your fronters'}</span>
      </div>

      <FilterBar
        search={{ value: q, onChange: resetting(setQ), placeholder: 'Search phone, customer, or batch…' }}
        dateRange={{ value: dr, onChange: resetting(setDr), defaultPreset: 'all' }}
        extras={extras}
        onClearAll={() => { setOffset(0); setStatus(''); setCompanyId(''); }}
      />

      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
              {['Phone', 'Customer', 'Status', 'Held by', 'Batch', 'Hop', 'Sent', ''].map((h, i) => <th key={i} className="text-left font-semibold px-3 py-2 text-xs">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="text-center py-10"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-10 text-sm" style={{ color: 'var(--color-text-tertiary)' }}><ListChecks size={24} className="inline mb-1" /><div>No assigned numbers.</div></td></tr>
                : rows.map(r => {
                  const isEx = r.status === 'excluded';
                  const open = expanded === r.item_id;
                  return (
                    <Fragment key={r.item_id}>
                      <tr className="border-t hover:bg-black/[0.02] cursor-pointer" style={{ borderColor: 'var(--color-border)', opacity: isEx ? 0.6 : 1 }} onClick={() => toggleExpand(r)}>
                        <td className="px-3 py-2 tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>{r.phone_number}</td>
                        <td className="px-3 py-2 truncate max-w-[160px]" style={{ color: 'var(--color-text-secondary)' }}>{r.customer_name || '—'}</td>
                        <td className="px-3 py-2">
                          {isEx
                            ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap inline-flex items-center gap-1" style={{ color: 'var(--color-warning-600)' }}><Ban size={11} /> {EX_REASON[r.exclusion_reason] || 'excluded'}</span>
                            : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{r.status}</span>}
                        </td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{r.holder_name || '—'}</td>
                        <td className="px-3 py-2 truncate max-w-[160px]" style={{ color: 'var(--color-text-secondary)' }}>{r.batch_name}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-xs" style={{ color: 'var(--color-text-tertiary)' }}>hop {r.hop}{r.chain_len ? ` / ${r.chain_len}` : ''}</td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(r.sent_at)}</td>
                        <td className="px-3 py-2 text-right">{open ? <ChevronDown size={15} style={{ color: 'var(--color-primary-600)' }} /> : <ChevronRight size={15} style={{ color: 'var(--color-text-tertiary)' }} />}</td>
                      </tr>
                      {open && (
                        <tr style={{ background: 'var(--color-surface)' }}>
                          <td colSpan={8} className="px-3 py-2">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}><GitBranch size={11} /> Chain for {r.phone_number}</div>
                            {lineage[r.batch_id]
                              ? <Lineage data={lineage[r.batch_id]} onBack={() => setExpanded(null)} />
                              : <div className="py-3 text-center"><Loader2 size={14} className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
          </tbody>
        </table>
      </div>

      {total > PAGE && (
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>{from}–{to} of {total.toLocaleString()}</span>
          <div className="flex gap-1">
            <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))} className="p-1.5 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}><ChevronLeft size={15} /></button>
            <button disabled={to >= total} onClick={() => setOffset(o => o + PAGE)} className="p-1.5 rounded-lg disabled:opacity-40" style={{ border: '1px solid var(--color-border)' }}><ChevronRight size={15} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
