import { useState, useEffect, useCallback } from 'react';
import { Shield, ShieldAlert, ShieldCheck, HelpCircle, Play, Loader2, Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import DncLookupPanel from './DncLookupPanel';
import { useAuth } from '../../contexts/AuthContext';

// Compliance bulk DNC: single lookup + "scan all sales" (cost-previewed, paced,
// cached) + a filterable, exportable report of every sale's DNC verdict.
const fmtDate = (s) => { try { return s ? new Date(s).toLocaleDateString() : ''; } catch { return ''; } };
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default function ComplianceDncReport() {
  const { canExport } = useAuth();
  const [prep, setPrep] = useState(null);          // { distinct_phones, to_check }
  const [scanning, setScanning] = useState(false);
  const [scanProg, setScanProg] = useState(null);  // { done, total, blacklisted, good, failed }
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('blacklisted');
  const [rows, setRows] = useState([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadSummary = useCallback(() => client.get('blacklist/report/summary').then(r => setSummary(r.data)).catch(() => setSummary(null)), []);
  const loadPrepare = useCallback(() => client.get('blacklist/scan/prepare').then(r => setPrep(r.data)).catch(e => toast.error(e.response?.data?.error || 'Could not prepare scan')), []);
  useEffect(() => { loadSummary(); loadPrepare(); }, [loadSummary, loadPrepare]);

  const loadRows = useCallback(async () => {
    setRowsLoading(true);
    try { const r = await client.get('blacklist/report/sales', { params: { status: filter, limit: 200 } }); setRows(r.data.sales || []); }
    catch { setRows([]); } finally { setRowsLoading(false); }
  }, [filter]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const runScan = async () => {
    if (!prep || prep.to_check === 0) { toast.info('Nothing new to check — all cached.'); return; }
    setScanning(true);
    const total = prep.to_check;
    let done = 0, blacklisted = 0, good = 0, failed = 0;
    setScanProg({ done: 0, total, blacklisted: 0, good: 0, failed: 0 });
    try {
      // Loop batches until the server reports nothing remaining. Small gap keeps
      // it gentle on the API.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const r = await client.post('blacklist/scan/run', { batch: 25 });
        const d = r.data;
        done += (d.batch_checked + d.failed); blacklisted += d.blacklisted; good += d.good; failed += d.failed;
        setScanProg({ done: Math.min(done, total), total, blacklisted, good, failed });
        if (!d.remaining || (d.batch_checked + d.failed) === 0) break;
        await new Promise(res => setTimeout(res, 600));
      }
      toast.success(`Scan complete — ${blacklisted} blacklisted, ${good} good${failed ? `, ${failed} failed` : ''}.`);
    } catch (e) { toast.error(e.response?.data?.error || 'Scan failed'); }
    finally { setScanning(false); loadSummary(); loadPrepare(); loadRows(); }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const out = []; let page = 1;
      // pull all matching rows (capped) page by page
      for (; page <= 60; page++) {
        const r = await client.get('blacklist/report/sales', { params: { status: filter, page, limit: 1000 } });
        const list = r.data.sales || [];
        out.push(...list);
        if (list.length < 1000) break;
      }
      const headers = ['DNC', 'Codes', 'Name', 'Phone', 'Reference', 'Plan', 'Client', 'Status', 'Sale Date', 'Checked'];
      const lines = [headers.join(',')];
      out.forEach(s => lines.push([
        s.dnc_status, (s.dnc_codes || []).join(' | '), s.customer_name, s.customer_phone, s.reference_no,
        s.plan, s.client_name, s.status, fmtDate(s.sale_date), s.dnc_checked_at ? fmtDate(s.dnc_checked_at) : '',
      ].map(csvCell).join(',')));
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `dnc_${filter}_sales.csv`; a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast.error('Export failed'); }
    finally { setExporting(false); }
  };

  const Stat = ({ icon: Icon, label, value, sub, color }) => (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color }}><Icon size={13} /> {label}</div>
      <div className="text-2xl font-extrabold mt-0.5" style={{ color: 'var(--color-text)' }}>{value}</div>
      <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</div>
    </div>
  );

  const pct = scanProg && scanProg.total ? Math.round((scanProg.done / scanProg.total) * 100) : 0;
  const STATUS_COLOR = { blacklisted: '#dc2626', good: '#16a34a', unchecked: '#6b7280' };

  return (
    <div className="w-full py-2">
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Shield size={22} style={{ color: 'var(--color-primary-600)' }} /> DNC / Blacklist</h2>
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Check one number, or scan every sale's number against the DNC / litigation database and report on it.</p>
      </div>

      {/* full-width: left rail = lookup + KPIs + scan, right = report table */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,380px)_1fr] gap-5 items-start">
       <div className="space-y-4">
        {/* single lookup */}
        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)' }}><DncLookupPanel compact /></div>

        {/* summary counts — stacked on the side */}
        {summary && (
          <div className="grid grid-cols-3 gap-2">
            <Stat icon={ShieldCheck} label="Good" value={summary.good.sales} sub={`${summary.good.phones} #`} color="#16a34a" />
            <Stat icon={ShieldAlert} label="Blacklisted" value={summary.blacklisted.sales} sub={`${summary.blacklisted.phones} #`} color="#dc2626" />
            <Stat icon={HelpCircle} label="Not checked" value={summary.unchecked.sales} sub={`${summary.unchecked.phones} #`} color="#6b7280" />
          </div>
        )}

        {/* scan */}
        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Scan all sales numbers</h3>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {prep ? <>{prep.distinct_phones} distinct numbers · <strong style={{ color: prep.to_check ? '#d97706' : '#16a34a' }}>{prep.to_check} need a live check</strong> (the rest are cached — free).</> : 'Loading…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadPrepare} disabled={scanning} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}><RefreshCw size={13} /> Refresh</button>
            <button onClick={runScan} disabled={scanning || !prep || prep.to_check === 0}
              className="text-sm font-bold px-3 py-2 rounded-lg text-white inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
              {scanning ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} {scanning ? 'Scanning…' : 'Run scan'}
            </button>
          </div>
        </div>
        {scanProg && (
          <div className="mt-3">
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <div className="h-full transition-all" style={{ width: `${pct}%`, background: 'var(--gradient-sidebar)' }} />
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {scanProg.done}/{scanProg.total} · <span style={{ color: '#dc2626' }}>{scanProg.blacklisted} blacklisted</span> · <span style={{ color: '#16a34a' }}>{scanProg.good} good</span>{scanProg.failed ? ` · ${scanProg.failed} failed` : ''}
            </div>
          </div>
        )}
        </div>
       </div>

      {/* report list + filter + export — main column */}
      <div className="rounded-2xl border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-1.5">
            {['blacklisted', 'good', 'unchecked'].map(s => (
              <button key={s} onClick={() => setFilter(s)} className="text-xs font-bold px-2.5 py-1.5 rounded-full capitalize transition-colors"
                style={{ backgroundColor: filter === s ? STATUS_COLOR[s] : 'var(--color-bg-secondary)', color: filter === s ? '#fff' : 'var(--color-text-secondary)' }}>{s}</button>
            ))}
          </div>
          {canExport('sales') && (
          <button onClick={exportCsv} disabled={exporting} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export CSV
          </button>
          )}
        </div>
        {rowsLoading ? (
          <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-center py-10" style={{ color: 'var(--color-text-tertiary)' }}>No {filter} sales{filter === 'unchecked' ? '' : ' — run a scan first if this is empty'}.</p>
        ) : (
          <div className="overflow-x-auto max-h-[calc(100vh-16rem)] overflow-y-auto">
            <table className="w-full text-sm">
              <thead><tr style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                {['Customer', 'Phone', 'Lists', 'Plan', 'Status', 'Sale date'].map(h => <th key={h} className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map(s => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{s.customer_name || '—'}{s.reference_no ? <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}> · {s.reference_no}</span> : ''}</td>
                    <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{s.customer_phone}</td>
                    <td className="px-3 py-2 text-[11px]" style={{ color: STATUS_COLOR[s.dnc_status] }}>{(s.dnc_codes || []).join(', ') || (s.dnc_status === 'good' ? 'clean' : '—')}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.plan || '—'}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{s.status}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDate(s.sale_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
