import { useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Upload, ClipboardList, Play, Zap, Download, X, Loader2, ShieldAlert, ShieldCheck, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';

// Bulk DNC / blacklist checker: paste a list OR upload a CSV/XLSX, then check
// every number. Two modes — "cached + fresh" (reuse the shared cache, only
// hit the API for stale/unseen numbers) and "realtime" (force a fresh check on
// all). Live progress + tallies, results table, and CSV export. Each result is
// cached server-side so it stays warm for everyone.
const CHUNK = 100;

// Pull US phone numbers out of arbitrary text (handles (415) 555-1234, 4155551234,
// +1 415.555.1234, one-per-line, comma/space separated, mixed in with other text).
const PHONE_RE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g;
function extractPhones(str) {
  const out = [];
  for (const m of String(str || '').match(PHONE_RE) || []) {
    const d = m.replace(/\D/g, '');
    const p = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
    if (p.length === 10) out.push(p);
  }
  return out;
}

const fmtPhone = (p) => (p && p.length === 10) ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p;
// The DNC API returns `carrier` as an OBJECT ({name,type,state,ocn,…}), not a
// string — never render it directly (React error #31). Pull out the name.
const carrierText = (c) => !c ? '' : (typeof c === 'string' ? c : (c.name || ''));

export default function BulkDncCheck() {
  const [pasted, setPasted] = useState('');
  const [fileName, setFileName] = useState('');
  const [filePhones, setFilePhones] = useState([]);   // extracted from the uploaded file
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState('');               // 'cache' | 'fresh' while running
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [tally, setTally] = useState({ blacklisted: 0, good: 0, failed: 0, cached: 0 });
  const [results, setResults] = useState([]);
  const [filter, setFilter] = useState('all');        // all | blacklisted | good
  const cancelRef = useRef(false);
  const fileRef = useRef(null);

  // Unique numbers across paste + file.
  const phones = useMemo(() => {
    const set = new Set([...extractPhones(pasted), ...filePhones]);
    return [...set];
  }, [pasted, filePhones]);

  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const found = new Set();
      wb.SheetNames.forEach(name => {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
        rows.forEach(row => row.forEach(cell => extractPhones(String(cell)).forEach(p => found.add(p))));
      });
      setFilePhones([...found]);
      toast.success(`${found.size} number${found.size === 1 ? '' : 's'} found in ${file.name}`);
    } catch { toast.error('Could not read that file'); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const clearFile = () => { setFilePhones([]); setFileName(''); };

  const run = async (force) => {
    if (!phones.length) { toast.info('Add some numbers first (paste or upload).'); return; }
    setRunning(true); setMode(force ? 'fresh' : 'cache');
    cancelRef.current = false;
    setResults([]); setProgress({ done: 0, total: phones.length });
    const t = { blacklisted: 0, good: 0, failed: 0, cached: 0 };
    setTally({ ...t });
    const acc = [];
    for (let i = 0; i < phones.length; i += CHUNK) {
      if (cancelRef.current) break;
      const chunk = phones.slice(i, i + CHUNK);
      try {
        const r = await client.post('blacklist/bulk-check', { phones: chunk, force });
        acc.push(...(r.data.results || []));
        t.blacklisted += r.data.blacklisted || 0; t.good += r.data.good || 0;
        t.failed += r.data.failed || 0; t.cached += r.data.cached || 0;
        setResults([...acc]); setTally({ ...t });
        setProgress({ done: Math.min(i + CHUNK, phones.length), total: phones.length });
      } catch (e) {
        toast.error(e.response?.data?.error || 'Check failed');
        break;
      }
    }
    setRunning(false); setMode('');
  };

  const cancel = () => { cancelRef.current = true; };

  const exportCsv = () => {
    if (!results.length) return;
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const header = ['Phone', 'Verdict', 'Message', 'Codes', 'Wireless', 'Carrier', 'Source', 'Checked At'];
    const lines = [header.join(',')];
    results.forEach(r => lines.push([
      fmtPhone(r.phone),
      r.ok ? (r.blacklisted ? 'BLACKLISTED' : 'Good') : 'Error',
      r.ok ? r.message : r.error,
      (r.codes || []).join(' | '),
      r.wireless ? 'Yes' : 'No',
      carrierText(r.carrier),
      r.cached ? 'cache' : 'live',
      r.checked_at ? new Date(r.checked_at).toLocaleString() : '',
    ].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dnc-check-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const shown = results.filter(r => filter === 'all' ? true : filter === 'blacklisted' ? (r.ok && r.blacklisted) : (r.ok && !r.blacklisted));
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const card = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' };

  return (
    <div className="rounded-2xl p-5 space-y-4" style={card}>
      <div>
        <h4 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><ClipboardList size={16} /> Bulk check</h4>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Paste a list or upload a CSV/XLSX — we pull out every phone number automatically. Results are cached and shared, so you only pay the API for what's new.
        </p>
      </div>

      {/* Inputs */}
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Paste numbers</label>
          <textarea value={pasted} onChange={e => setPasted(e.target.value)} rows={5} disabled={running}
            placeholder={'4155551234\n(212) 555-0000, +1 305-555-9999 …'}
            className="input text-sm w-full font-mono" style={{ resize: 'vertical' }} />
        </div>
        <div>
          <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Or upload a file (CSV / XLSX)</label>
          <div className="rounded-lg p-4 flex flex-col items-center justify-center gap-2 h-[112px] text-center"
            style={{ border: '1px dashed var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
            {fileName ? (
              <>
                <FileSpreadsheet size={20} style={{ color: 'var(--color-primary-600)' }} />
                <span className="text-xs font-semibold truncate max-w-full" style={{ color: 'var(--color-text)' }}>{fileName}</span>
                <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{filePhones.length} numbers · <button onClick={clearFile} className="underline">remove</button></span>
              </>
            ) : (
              <>
                <Upload size={20} style={{ color: 'var(--color-text-tertiary)' }} />
                <button onClick={() => fileRef.current?.click()} disabled={running}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg text-white" style={{ background: 'var(--gradient-sidebar)' }}>Choose file</button>
                <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>any column — we find the numbers</span>
              </>
            )}
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={onFile} className="hidden" />
          </div>
        </div>
      </div>

      {/* Count + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold px-2.5 py-1 rounded-lg" style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', color: 'var(--color-primary-700)' }}>
          {phones.length} unique number{phones.length === 1 ? '' : 's'}
        </span>
        <div className="flex-1" />
        {running ? (
          <button onClick={cancel} className="text-xs font-bold px-3 py-2 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: '#fca5a5', color: '#dc2626' }}>
            <X size={14} /> Stop
          </button>
        ) : (
          <>
            <button onClick={() => run(false)} disabled={!phones.length}
              className="text-xs font-bold px-3 py-2 rounded-lg text-white inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}
              title="Reuse cached results; only fresh-check numbers not seen recently">
              <Play size={14} /> Check (cached + fresh)
            </button>
            <button onClick={() => run(true)} disabled={!phones.length}
              className="text-xs font-bold px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ border: '1px solid #f59e0b', color: '#b45309', backgroundColor: '#fffbeb' }}
              title="Bypass the cache — re-check every number live against the DNC API">
              <Zap size={14} /> Realtime (fresh all)
            </button>
          </>
        )}
      </div>

      {/* Progress */}
      {(running || progress.total > 0) && (
        <div className="space-y-2">
          <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: 'var(--gradient-sidebar)' }} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <span>{running && <Loader2 size={12} className="inline animate-spin mr-1" />}{progress.done} / {progress.total} checked · {progress.total - progress.done} remaining{mode === 'fresh' ? ' · realtime' : ''}</span>
            <span className="inline-flex items-center gap-1" style={{ color: '#dc2626' }}><ShieldAlert size={12} /> {tally.blacklisted} blacklisted</span>
            <span className="inline-flex items-center gap-1" style={{ color: '#16a34a' }}><ShieldCheck size={12} /> {tally.good} good</span>
            {tally.cached > 0 && <span style={{ color: 'var(--color-text-tertiary)' }}>{tally.cached} from cache</span>}
            {tally.failed > 0 && <span className="inline-flex items-center gap-1" style={{ color: '#d97706' }}><AlertTriangle size={12} /> {tally.failed} failed</span>}
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {[['all', `All (${results.length})`], ['blacklisted', `Blacklisted (${tally.blacklisted})`], ['good', `Good (${tally.good})`]].map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: filter === k ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)', color: filter === k ? '#fff' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{l}</button>
            ))}
            <div className="flex-1" />
            <button onClick={exportCsv} className="text-xs font-bold px-3 py-1.5 rounded-lg border inline-flex items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <Download size={13} /> Export CSV
            </button>
          </div>
          <div className="rounded-lg overflow-x-auto" style={card}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                  <th className="text-left px-3 py-2 font-bold">Phone</th>
                  <th className="text-left px-3 py-2 font-bold">Verdict</th>
                  <th className="text-left px-3 py-2 font-bold">Codes</th>
                  <th className="text-left px-3 py-2 font-bold">Carrier</th>
                  <th className="text-left px-3 py-2 font-bold">Source</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((r, i) => (
                  <tr key={r.phone + i} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-1.5 font-mono tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtPhone(r.phone)}</td>
                    <td className="px-3 py-1.5">
                      {!r.ok ? <span style={{ color: '#d97706' }}>{r.error}</span>
                        : r.blacklisted
                          ? <span className="inline-flex items-center gap-1 font-bold" style={{ color: '#dc2626' }}><ShieldAlert size={12} /> {r.message}</span>
                          : <span className="inline-flex items-center gap-1" style={{ color: '#16a34a' }}><ShieldCheck size={12} /> Good</span>}
                    </td>
                    <td className="px-3 py-1.5" style={{ color: 'var(--color-text-secondary)' }}>{(r.codes || []).join(', ') || '—'}</td>
                    <td className="px-3 py-1.5" style={{ color: 'var(--color-text-secondary)' }}>{carrierText(r.carrier) || '—'}{r.wireless ? ' 📱' : ''}</td>
                    <td className="px-3 py-1.5" style={{ color: 'var(--color-text-tertiary)' }}>{r.ok ? (r.cached ? 'cache' : 'live') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && <p className="text-[11px] px-3 py-2" style={{ color: 'var(--color-text-tertiary)' }}>Showing first 500 — export CSV for all {shown.length}.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
