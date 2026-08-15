import { useState, useEffect, useCallback } from 'react';
import { Shield, ShieldAlert, ShieldCheck, HelpCircle, Play, Loader2, Download, RefreshCw, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import DncLookupPanel from './DncLookupPanel';
import { useAuth } from '../../contexts/AuthContext';
import { buildFilename } from '../../utils/downloadFilename';

// Compliance bulk DNC: single lookup + "scan all sales" (cost-previewed, paced,
// cached) + two reports — every SALE's DNC verdict, and every NUMBER anyone has
// ever searched (the shared cache: closer lookups, bulk checks and scans all
// land there, so a bad number a closer checked shows up here even with no sale).
const fmtDate = (s) => { try { return s ? new Date(s).toLocaleDateString() : ''; } catch { return ''; } };
const fmtDateTime = (s) => { try { return s ? new Date(s).toLocaleString() : ''; } catch { return ''; } };
const SOURCE_LABEL = { lookup: 'Lookup', bulk: 'Bulk check', scan: 'Sales scan' };
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
  // searched-numbers (cache) report
  const [mode, setMode] = useState('sales');            // 'sales' | 'cache'
  const [cacheSummary, setCacheSummary] = useState(null);
  const [cacheFilter, setCacheFilter] = useState('blacklisted');   // 'blacklisted' | 'good' | 'all'
  const [cacheSource, setCacheSource] = useState('');    // '' | lookup | bulk | scan
  const [cacheFresh, setCacheFresh] = useState('');      // '' | fresh | stale (vs the cache window)
  const [cacheSearch, setCacheSearch] = useState('');
  const [cacheRows, setCacheRows] = useState([]);
  const [cacheTotal, setCacheTotal] = useState(0);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cachePage, setCachePage] = useState(1);
  const [cacheLimit, setCacheLimit] = useState(100);

  const loadSummary = useCallback(() => client.get('blacklist/report/summary').then(r => setSummary(r.data)).catch(() => setSummary(null)), []);
  const loadPrepare = useCallback(() => client.get('blacklist/scan/prepare').then(r => setPrep(r.data)).catch(e => toast.error(e.response?.data?.error || 'Could not prepare scan')), []);
  useEffect(() => { loadSummary(); loadPrepare(); }, [loadSummary, loadPrepare]);

  const loadRows = useCallback(async () => {
    setRowsLoading(true);
    try { const r = await client.get('blacklist/report/sales', { params: { status: filter, limit: 200 } }); setRows(r.data.sales || []); }
    catch { setRows([]); } finally { setRowsLoading(false); }
  }, [filter]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const loadCacheSummary = useCallback(
    () => client.get('blacklist/cache/summary').then(r => setCacheSummary(r.data)).catch(() => setCacheSummary(null)), []);
  useEffect(() => { loadCacheSummary(); }, [loadCacheSummary]);

  // Searching a number searches the WHOLE cache — the verdict/source/age pills
  // are dropped for that query. Otherwise looking up a number you believe is bad
  // while the "good" pill is active returns nothing, which reads as "not found".
  const searching = !!cacheSearch.trim();
  const cacheParams = useCallback((extra = {}) => (searching ? {
    search: cacheSearch.trim(), ...extra,
  } : {
    ...(cacheFilter === 'all' ? {} : { status: cacheFilter }),
    ...(cacheSource ? { source: cacheSource } : {}),
    ...(cacheFresh ? { freshness: cacheFresh } : {}),
    ...extra,
  }), [searching, cacheFilter, cacheSource, cacheFresh, cacheSearch]);

  const loadCache = useCallback(async () => {
    setCacheLoading(true);
    try {
      const r = await client.get('blacklist/cache', { params: cacheParams({ page: cachePage, limit: cacheLimit }) });
      setCacheRows(r.data.numbers || []); setCacheTotal(r.data.total || 0);
    } catch { setCacheRows([]); setCacheTotal(0); }
    finally { setCacheLoading(false); }
  }, [cacheParams, cachePage, cacheLimit]);
  // debounce so typing a number doesn't fire a request per keystroke
  useEffect(() => { const t = setTimeout(loadCache, cacheSearch ? 350 : 0); return () => clearTimeout(t); }, [loadCache, cacheSearch]);
  // any filter change restarts at page 1 — otherwise page 7 of a 3-page result is blank
  useEffect(() => { setCachePage(1); }, [cacheFilter, cacheSource, cacheFresh, cacheSearch, cacheLimit]);

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
    finally { setScanning(false); loadSummary(); loadPrepare(); loadRows(); loadCache(); loadCacheSummary(); }
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
      a.download = buildFilename({ dataset: `dnc-${filter}-sales` }); a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast.error('Export failed'); }
    finally { setExporting(false); }
  };

  const exportCacheCsv = async () => {
    setExporting(true);
    try {
      const out = [];
      for (let page = 1; page <= 60; page++) {
        const r = await client.get('blacklist/cache', { params: cacheParams({ page, limit: 1000 }) });
        const list = r.data.numbers || [];
        out.push(...list);
        if (list.length < 1000) break;
      }
      const headers = ['Phone', 'Verdict', 'Message', 'Lists', 'Wireless', 'Searched by', 'Source', 'Times', 'Last searched', 'Verdict checked', 'Expired', 'Sales'];
      const lines = [headers.join(',')];
      out.forEach(n => lines.push([
        n.phone, n.dnc_status, n.message, (n.codes || []).join(' | '), n.wireless ? 'yes' : 'no',
        n.searched_by_name || n.searched_by_email || '', SOURCE_LABEL[n.last_source] || n.last_source || '',
        n.lookup_count, fmtDateTime(n.last_searched_at), fmtDateTime(n.checked_at), isStale(n) ? 'yes' : 'no', n.sales_count,
      ].map(csvCell).join(',')));
      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = buildFilename({ dataset: `dnc-searched-${cacheFilter}-numbers` }); a.click(); URL.revokeObjectURL(a.href);
    } catch { toast.error('Export failed'); }
    finally { setExporting(false); }
  };

  const Stat = ({ icon: Icon, label, value, sub, color }) => (
    <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color }}><Icon size={13} /> {label}</div>
      <div className="text-2xl font-extrabold mt-0.5" style={{ color: 'var(--color-text)' }}>{value}</div>
      <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</div>
    </div>
  );

  // A verdict older than the superadmin cache window is no longer trusted — the
  // next lookup on that number re-calls the API.
  const isStale = (n) => {
    const days = cacheSummary?.cache_days;
    if (!days || !n.checked_at) return false;
    return Date.now() - new Date(n.checked_at).getTime() > days * 86400000;
  };

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
        <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--color-border)' }}><DncLookupPanel compact onResult={() => { loadCache(); loadCacheSummary(); }} /></div>

        {/* summary counts — stacked on the side */}
        {summary && (
          <div className="grid grid-cols-3 gap-2">
            <Stat icon={ShieldCheck} label="Good" value={summary.good.sales} sub={`${summary.good.phones} #`} color="#16a34a" />
            <Stat icon={ShieldAlert} label="Blacklisted" value={summary.blacklisted.sales} sub={`${summary.blacklisted.phones} #`} color="#dc2626" />
            <Stat icon={HelpCircle} label="Not checked" value={summary.unchecked.sales} sub={`${summary.unchecked.phones} #`} color="#6b7280" />
          </div>
        )}

        {/* the shared cache — every number ANY user has ever searched */}
        {cacheSummary && (
          <button onClick={() => setMode('cache')} className="w-full text-left rounded-xl border p-3 transition-colors"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
              <Search size={13} /> Searched numbers (cache)
            </div>
            <div className="text-sm mt-1 font-semibold" style={{ color: 'var(--color-text)' }}>
              <span style={{ color: '#dc2626' }}>{cacheSummary.blacklisted.phones} bad</span>
              <span style={{ color: 'var(--color-text-tertiary)' }}> · </span>
              <span style={{ color: '#16a34a' }}>{cacheSummary.good.phones} good</span>
            </div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {cacheSummary.blacklisted.lookups + cacheSummary.good.lookups} searches by all users — click to open
            </div>
            {cacheSummary.cache_days ? (
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                Cache window <strong style={{ color: 'var(--color-text-secondary)' }}>{cacheSummary.cache_days} days</strong>
                {cacheSummary.stale ? <> · <span style={{ color: '#d97706' }}>{cacheSummary.stale} expired</span></> : null}
              </div>
            ) : null}
          </button>
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
        {/* which report: sales verdicts, or every number anyone searched */}
        <div className="flex items-center gap-1 px-3 pt-3">
          {[
            { k: 'sales', label: 'Sales' },
            { k: 'cache', label: 'Searched numbers', badge: cacheSummary ? cacheSummary.blacklisted.phones : null },
          ].map(t => (
            <button key={t.k} onClick={() => setMode(t.k)}
              className="text-xs font-bold px-3 py-2 rounded-t-lg inline-flex items-center gap-1.5 transition-colors"
              style={{
                backgroundColor: mode === t.k ? 'var(--color-bg-secondary)' : 'transparent',
                color: mode === t.k ? 'var(--color-text)' : 'var(--color-text-secondary)',
                borderBottom: mode === t.k ? '2px solid var(--color-primary-600)' : '2px solid transparent',
              }}>
              {t.label}
              {t.badge ? <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: '#dc2626', color: '#fff' }}>{t.badge}</span> : null}
            </button>
          ))}
        </div>

        {mode === 'cache' ? (
          <>
            <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="flex items-center gap-1.5 flex-wrap">
                {['blacklisted', 'good', 'all'].map(s => (
                  <button key={s} onClick={() => setCacheFilter(s)} className="text-xs font-bold px-2.5 py-1.5 rounded-full capitalize transition-colors"
                    style={{ backgroundColor: cacheFilter === s ? (STATUS_COLOR[s] || 'var(--color-primary-600)') : 'var(--color-bg-secondary)', color: cacheFilter === s ? '#fff' : 'var(--color-text-secondary)' }}>{s}</button>
                ))}
                <span className="mx-1" style={{ color: 'var(--color-border)' }}>|</span>
                {[['', 'Any source'], ['lookup', 'Lookup'], ['bulk', 'Bulk check'], ['scan', 'Sales scan']].map(([v, label]) => (
                  <button key={v || 'any'} onClick={() => setCacheSource(v)} className="text-xs font-semibold px-2.5 py-1.5 rounded-full transition-colors"
                    style={{ backgroundColor: cacheSource === v ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)', color: cacheSource === v ? '#fff' : 'var(--color-text-secondary)' }}>{label}</button>
                ))}
                <span className="mx-1" style={{ color: 'var(--color-border)' }}>|</span>
                {[['', 'Any age'], ['fresh', 'Within cache'], ['stale', 'Expired']].map(([v, label]) => (
                  <button key={v || 'anyage'} onClick={() => setCacheFresh(v)} className="text-xs font-semibold px-2.5 py-1.5 rounded-full transition-colors"
                    style={{ backgroundColor: cacheFresh === v ? (v === 'stale' ? '#d97706' : 'var(--color-primary-600)') : 'var(--color-bg-secondary)', color: cacheFresh === v ? '#fff' : 'var(--color-text-secondary)' }}>{label}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
                  <input value={cacheSearch} onChange={e => setCacheSearch(e.target.value)} placeholder="Find a number…"
                    className="text-xs rounded-lg border pl-7 pr-7 py-1.5 w-44 outline-none"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }} />
                  {cacheSearch && <button onClick={() => setCacheSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={12} style={{ color: 'var(--color-text-tertiary)' }} /></button>}
                </div>
                <button onClick={() => { loadCache(); loadCacheSummary(); }} disabled={cacheLoading} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <RefreshCw size={13} /> Refresh
                </button>
                {canExport('sales') && (
                  <button onClick={exportCacheCsv} disabled={exporting} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export CSV
                  </button>
                )}
              </div>
            </div>
            <div className="px-4 py-1.5 text-[11px] flex items-center gap-2 flex-wrap" style={{ color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border)' }}>
              <span>
                Every number checked by anyone — closer, compliance or admin.{' '}
                {cacheTotal ? <>Showing <strong style={{ color: 'var(--color-text-secondary)' }}>{(cachePage - 1) * cacheLimit + 1}–{Math.min(cachePage * cacheLimit, cacheTotal)}</strong> of {cacheTotal}.</> : 'Nothing to show.'}
              </span>
              {searching ? (
                <span className="font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-primary-600)' }}>
                  Searching all {cacheSummary ? cacheSummary.blacklisted.phones + cacheSummary.good.phones : ''} numbers — filters ignored
                </span>
              ) : null}
              {cacheSummary?.cache_days ? (
                <span className="font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                  Cache window {cacheSummary.cache_days}d
                  {' · '}<span style={{ color: '#16a34a' }}>{cacheSummary.fresh} within</span>
                  {' · '}<span style={{ color: cacheSummary.stale ? '#d97706' : 'var(--color-text-tertiary)' }}>{cacheSummary.stale} expired</span>
                  {cacheSummary.enabled === false ? <span style={{ color: '#dc2626' }}> · lookup OFF</span> : null}
                </span>
              ) : null}
            </div>
            {cacheLoading ? (
              <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>
            ) : cacheRows.length === 0 ? (
              <p className="text-sm text-center py-10" style={{ color: 'var(--color-text-tertiary)' }}>
                {searching ? <>No cached number matches “{cacheSearch.trim()}”. Check it in the lookup panel and it lands here.</>
                           : <>No {cacheFilter === 'all' ? '' : `${cacheFilter} `}numbers searched yet.</>}
              </p>
            ) : (
              <div className="overflow-x-auto max-h-[calc(100vh-20rem)] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead><tr style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                    {['Number', 'Verdict', 'Lists', 'Searched by', 'Source', 'Times', 'Last searched', 'Verdict age', 'Sales'].map(h => <th key={h} className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {cacheRows.map(n => (
                      <tr key={n.phone} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td className="px-3 py-2 tabular-nums font-semibold" style={{ color: 'var(--color-text)' }}>
                          {n.phone}{n.wireless ? <span className="text-[10px] ml-1.5" style={{ color: 'var(--color-text-tertiary)' }}>wireless</span> : null}
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${STATUS_COLOR[n.dnc_status]}1a`, color: STATUS_COLOR[n.dnc_status] }}>
                            {n.message || n.dnc_status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[11px]" style={{ color: STATUS_COLOR[n.dnc_status] }}>{(n.codes || []).join(', ') || (n.dnc_status === 'good' ? 'clean' : '—')}</td>
                        <td className="px-3 py-2" style={{ color: 'var(--color-text-secondary)' }}>{n.searched_by_name || n.searched_by_email || '—'}</td>
                        <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{SOURCE_LABEL[n.last_source] || n.last_source || '—'}</td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{n.lookup_count}</td>
                        <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{fmtDateTime(n.last_searched_at)}</td>
                        <td className="px-3 py-2 text-[11px]" style={{ color: isStale(n) ? '#d97706' : 'var(--color-text-tertiary)' }}>
                          {fmtDate(n.checked_at)}{isStale(n) ? ' · expired' : ''}
                        </td>
                        <td className="px-3 py-2 tabular-nums" style={{ color: n.sales_count ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>{n.sales_count || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* pager — the cache is thousands of numbers, never a single page */}
            {cacheTotal > 0 && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  <span>Rows per page</span>
                  {[100, 250, 500, 1000].map(n => (
                    <button key={n} onClick={() => setCacheLimit(n)} className="text-[11px] font-bold px-2 py-1 rounded-lg transition-colors"
                      style={{ backgroundColor: cacheLimit === n ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)', color: cacheLimit === n ? '#fff' : 'var(--color-text-secondary)' }}>{n}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  {(() => {
                    const pages = Math.max(1, Math.ceil(cacheTotal / cacheLimit));
                    const go = (p) => setCachePage(Math.min(Math.max(1, p), pages));
                    // a short window around the current page — 88 page buttons helps nobody
                    const from = Math.max(1, Math.min(cachePage - 2, pages - 4));
                    const win = Array.from({ length: Math.min(5, pages) }, (_, i) => from + i);
                    const navBtn = { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' };
                    return (
                      <>
                        <button onClick={() => go(1)} disabled={cachePage === 1} className="text-[11px] font-semibold px-2 py-1 rounded-lg border disabled:opacity-40" style={navBtn}>« First</button>
                        <button onClick={() => go(cachePage - 1)} disabled={cachePage === 1} className="text-[11px] font-semibold px-2 py-1 rounded-lg border disabled:opacity-40" style={navBtn}>‹ Prev</button>
                        {win.map(p => (
                          <button key={p} onClick={() => go(p)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors"
                            style={{ backgroundColor: p === cachePage ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)', color: p === cachePage ? '#fff' : 'var(--color-text-secondary)' }}>{p}</button>
                        ))}
                        <button onClick={() => go(cachePage + 1)} disabled={cachePage >= pages} className="text-[11px] font-semibold px-2 py-1 rounded-lg border disabled:opacity-40" style={navBtn}>Next ›</button>
                        <button onClick={() => go(pages)} disabled={cachePage >= pages} className="text-[11px] font-semibold px-2 py-1 rounded-lg border disabled:opacity-40" style={navBtn}>Last »</button>
                        <span className="text-[11px] ml-1" style={{ color: 'var(--color-text-tertiary)' }}>of {pages}</span>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </>
        ) : (
        <>
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
        </>
        )}
      </div>
      </div>
    </div>
  );
}
