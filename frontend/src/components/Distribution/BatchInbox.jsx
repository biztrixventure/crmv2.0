import { useState, useEffect, useCallback } from 'react';
import { Boxes, Loader2, RefreshCw, Inbox, Upload, Globe, ChevronRight, Search, Clock } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import BatchWorkspace from './BatchWorkspace';
import BatchUpload from './BatchUpload';
import NumberFinder from './NumberFinder';
import FilterBar from '../UI/FilterBar';
import ThemedSelect from '../UI/Select';
import { TableScroll } from "../UI/kit";
import { timeLeft, fmtDeadline } from '../../utils/expiry';

const SENDER_ROLES = new Set(['superadmin', 'compliance_manager', 'fronter_manager', 'closer_manager', 'operations_manager', 'company_admin']);
// Who gets the cross-batch number report. Manager and up, mirroring the server's
// ROSTER_ROLES — readonly_admin may look, which is what that role is for.
const REPORT_ROLES = new Set([...SENDER_ROLES, 'readonly_admin']);
const fmt = (d) => { try { return d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return d || ''; } };

// Batch distribution inbox — receive, re-batch (sub-batch = copy downstream),
// view lineage, and cascade-delete. Reads /distribution-batches.
export default function BatchInbox() {
  const { user } = useAuth();
  const isSuper = user?.role === 'superadmin';
  const canSend = SENDER_ROLES.has(user?.role);
  const [box, setBox] = useState('received');   // received | sent | all(superadmin)
  const [q, setQ] = useState('');
  const [dr, setDr] = useState({ date_from: '', date_to: '' });
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(null);   // batch being viewed
  const [uploadOpen, setUploadOpen] = useState(false);
  const [finderOpen, setFinderOpen] = useState(false);   // "who has these numbers?"
  const canReport = REPORT_ROLES.has(user?.role);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = box === 'all' ? { scope: 'all' } : { box };
      if (q)           params.q = q;
      if (dr.date_from) params.date_from = dr.date_from;
      if (dr.date_to)   params.date_to = dr.date_to;
      if (companyId)   params.company_id = companyId;
      const r = await client.get('distribution-batches/received', { params });
      setRows(r.data.batches || []);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not load batches'); setRows([]); }
    finally { setLoading(false); }
  }, [box, q, dr.date_from, dr.date_to, companyId]);
  useEffect(() => { load(); }, [load]);

  // Company options for the superadmin "extras" filter (existing /companies endpoint).
  useEffect(() => {
    if (!isSuper) return;
    client.get('companies').then(r => setCompanies(r.data?.companies || r.data || [])).catch(() => {});
  }, [isSuper]);

  const tabs = [['received', 'Received', Inbox], ['sent', 'Sent', Upload], ...(isSuper ? [['all', 'All', Globe]] : [])];
  const statusPills = (
    <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      {tabs.map(([k, label, Icon]) => (
        <button key={k} onClick={() => setBox(k)} className="text-xs font-semibold px-3 py-1.5 flex items-center gap-1"
          style={{ background: box === k ? 'var(--gradient-sidebar)' : 'transparent', color: box === k ? 'var(--color-text-inverse)' : 'var(--color-text-secondary)' }}>
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  );
  const extras = isSuper ? (
    <ThemedSelect variant="pill" value={companyId} onChange={e => setCompanyId(e.target.value)} className="input text-sm py-1.5" style={{ borderColor: 'var(--color-border)' }} aria-label="Company">
      <option value="">All companies</option>
      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </ThemedSelect>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Boxes size={18} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Batch Distribution</h2>
        {canReport && (
          <button onClick={() => setFinderOpen(true)} className="ml-auto text-sm font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            title="Paste or upload numbers and see who is holding them">
            <Search size={15} /> Find numbers
          </button>
        )}
        {canSend && (
          <button onClick={() => setUploadOpen(true)} className={`${canReport ? '' : 'ml-auto '}text-sm font-bold px-3 py-2 rounded-lg flex items-center gap-1.5`}
            style={{ background: 'var(--gradient-sidebar)', color: 'var(--color-text-inverse)' }}>
            <Upload size={15} /> Upload file
          </button>
        )}
        <button onClick={load} className={`${(canSend || canReport) ? '' : 'ml-auto '}p-2 rounded-lg`} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>

      <FilterBar
        search={{ value: q, onChange: setQ, placeholder: 'Search batch, phone, or person…' }}
        dateRange={{ value: dr, onChange: setDr, defaultPreset: 'all' }}
        statusPills={statusPills}
        extras={extras}
        onClearAll={() => { setBox('received'); setCompanyId(''); }}
      />

      <TableScroll stickyFirst label="Batches" className="rounded-xl" style={{ border: '1px solid var(--color-border)' }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}>
              {['Batch', 'From', 'To', 'Numbers', 'Sent', 'Time limit', ''].map((h, i) => <th key={i} className="text-left font-semibold px-3 py-2 text-xs">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="text-center py-10"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={7} className="text-center py-10 text-sm" style={{ color: 'var(--color-text-tertiary)' }}><Boxes size={24} className="inline mb-1" /><div>No batches{box === 'received' ? ' received' : box === 'sent' ? ' sent' : ''}.</div></td></tr>
                : rows.map(b => {
                  const t = timeLeft(b.expires_at);
                  const gone = b.status === 'expired';
                  return (
                  <tr key={b.id} className="border-t hover:bg-black/[0.02] cursor-pointer" style={{ borderColor: 'var(--color-border)', opacity: gone ? 0.65 : 1 }} onClick={() => setActive(b)}>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>
                      {b.source === 'data_analyzer' && <span className="text-[11px] sm:text-[9px] font-bold mr-1 px-1 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)' }}>ORIGINAL</span>}
                      {b.name}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{b.created_by_name || '—'}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{b.sent_to_name || '—'}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text)' }}>{b.item_count}</td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(b.sent_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      {gone ? (
                        <span className="font-semibold" style={{ color: 'var(--color-warning-600)' }}>taken back {fmt(b.expired_at)}</span>
                      ) : b.expires_at ? (
                        <span className="font-semibold flex items-center gap-1" title={fmtDeadline(b.expires_at)}
                          style={{ color: (t.expired || t.urgent) ? 'var(--color-error-600)' : t.soon ? 'var(--color-warning-600)' : 'var(--color-text-secondary)' }}>
                          <Clock size={12} /> {t.text}
                        </span>
                      ) : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                    </td>
                    <td className="px-3 py-2 text-right"><ChevronRight size={15} style={{ color: 'var(--color-text-tertiary)' }} /></td>
                  </tr>
                  );
                })}
          </tbody>
        </table>
      </TableScroll>

      {active && <BatchWorkspace batch={active} me={user} canSend={canSend} isSuper={isSuper} onClose={() => { setActive(null); load(); }} onChanged={() => { setActive(null); load(); }} />}
      {uploadOpen && <BatchUpload onClose={() => setUploadOpen(false)} onDone={(b) => { setUploadOpen(false); load(); if (b) setActive({ ...b, created_by_name: 'you' }); }} />}
      {finderOpen && <NumberFinder onClose={() => { setFinderOpen(false); load(); }} />}
    </div>
  );
}
