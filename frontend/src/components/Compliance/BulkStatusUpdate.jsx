import { useMemo, useState } from 'react';
import {
  Upload, Search, ListChecks, X, AlertTriangle, CheckCircle2, Loader2, Trash2, Calendar,
} from 'lucide-react';
import client from '../../api/client';
import { useComplianceStatuses } from '../../hooks/useComplianceStatuses';
import { useCancellationReasons } from '../../hooks/useCancellationReasons';

/*
 * BulkStatusUpdate
 *
 * Updates many sales at once by reference / policy number. Workflow:
 *   1. Paste a list — each line can be just a ref OR
 *      "ref, date" OR "ref, date, note". Commas / semicolons / pipes / tabs
 *      all work as the column separator. Header rows are auto-skipped.
 *      Alternatively upload a CSV with the same columns.
 *   2. Search → backend matches each ref against sales.reference_no,
 *      form_data.SaleReferenceNo, and form_data.PolicyNumber (+ snake_case
 *      and lowercase variants admins commonly use).
 *   3. Each matched row is shown with the parsed date / note pre-filled
 *      and editable. Per-row date / note overrides the bulk-level values.
 *   4. Pick a target status from the live compliance.status_catalog.
 *      Cancellation-like statuses gate the Apply button on a reason being
 *      set (per-row OR bulk-level) and a date.
 *   5. Apply → backend bulk-updates + writes audit history + stamps
 *      sales.cancellation_date when relevant.
 */

const BADGE_DOT = {
  success: '#16a34a', error: '#dc2626', warning: '#d97706',
  info: '#2563eb', primary: '#6366f1', secondary: '#6b7280',
};
const CANCEL_LIKE = new Set(['cancelled','compliance_cancelled','closed_lost','chargeback','dispute']);

// Robust date parser — accepts YYYY-MM-DD, MM/DD/YYYY, M/D/YYYY, ISO
// timestamps. Returns YYYY-MM-DD or null when unparseable. Mirrors the
// server-side normalizeDate so the user sees what the backend will store.
function normalizeDate(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso.slice(1).join('-');
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2,'0')}-${us[2].padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Parse the paste box. Each non-empty line is split on the first separator
// found (\t, comma, semicolon, pipe). The first token is the ref; the
// second (if present and date-like) is the cancellation date; the third
// is the per-row note. Returns { refs: [{ref, date, note}], dupes, header }.
function parseLines(text) {
  if (!text) return { entries: [], dupes: [] };
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries = [];
  const dupes = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Skip a row whose first column is obviously a header label.
    if (i === 0 && /^(ref|policy|reference|sale\s*ref)/i.test(raw)) continue;
    const sep = raw.includes('\t') ? '\t' : raw.includes('|') ? '|' : raw.includes(';') ? ';' : ',';
    const parts = raw.split(sep).map(p => p.replace(/^"|"$/g, '').trim());
    const ref = parts[0];
    if (!ref) continue;
    const k = ref.toLowerCase();
    if (seen.has(k)) { dupes.push(ref); continue; }
    seen.add(k);
    const dateRaw = parts[1] || '';
    const note    = parts.slice(2).join(', ').trim();
    const date = dateRaw ? normalizeDate(dateRaw) : null;
    entries.push({ ref, date, note, dateRaw });
  }
  return { entries, dupes };
}

export default function BulkStatusUpdate() {
  const { catalog } = useComplianceStatuses();
  const { activeReasons: cancelReasonChoices } = useCancellationReasons();
  const enabledStatuses = useMemo(
    () => (catalog || []).filter(s => s && s.key && s.enabled !== false),
    [catalog],
  );

  const [pasteText, setPasteText]   = useState('');
  const [searching, setSearching]   = useState(false);
  const [searchErr, setSearchErr]   = useState('');
  const [results, setResults]       = useState(null);   // { matched, unmatched, duplicates }
  const [rowState, setRowState]     = useState({});     // id → { selected, date, note }
  const [newStatus, setNewStatus]   = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [bulkReasonKey, setBulkReasonKey] = useState('');
  const [bulkChargebackAmt, setBulkChargebackAmt] = useState('');
  const [bulkDate,   setBulkDate]   = useState('');
  const [applying, setApplying]     = useState(false);
  const [applyMsg, setApplyMsg]     = useState('');

  const parsed = useMemo(() => parseLines(pasteText), [pasteText]);
  const isCancelStatus = newStatus && CANCEL_LIKE.has(newStatus);
  // Map ref → parsed line so we can prefill the matched-row editor.
  const parsedByRef = useMemo(() => {
    const m = new Map();
    parsed.entries.forEach(e => m.set(e.ref.toLowerCase(), e));
    return m;
  }, [parsed]);

  const selectedRows = useMemo(
    () => Object.entries(rowState).filter(([, v]) => v?.selected).map(([id]) => id),
    [rowState],
  );

  const doSearch = async (entries) => {
    setSearching(true); setSearchErr(''); setResults(null); setRowState({});
    try {
      const refs = entries.map(e => e.ref);
      const { data } = await client.post('compliance/sales/bulk-search', { refs });
      setResults(data);
      // Auto-select all matched and prefill per-row date / note from the
      // user's pasted columns.
      const next = {};
      (data?.matched || []).forEach(r => {
        const matchedKey = (r.matched_via || r.reference_no || '').toLowerCase();
        const parsedHit = parsedByRef.get(matchedKey);
        next[r.id] = {
          selected: true,
          date: parsedHit?.date || (r.cancellation_date || ''),
          note: parsedHit?.note || '',
        };
      });
      setRowState(next);
    } catch (e) {
      setSearchErr(e.response?.data?.error || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const onSearchClick = () => {
    if (!parsed.entries.length) { setSearchErr('Paste at least one reference or policy number.'); return; }
    doSearch(parsed.entries);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      setPasteText(text);
      const p = parseLines(text);
      if (!p.entries.length) { setSearchErr('No reference numbers found in the file.'); return; }
      // Need to wait for parsedByRef to update; call doSearch with the
      // freshly-parsed entries directly.
      setSearchErr('');
      setTimeout(() => doSearch(p.entries), 0);
    } catch {
      setSearchErr('Could not read the file. Use a .csv or plain-text file.');
    }
  };

  const setRow = (id, patch) => setRowState(s => ({ ...s, [id]: { ...(s[id] || {}), ...patch } }));
  const toggle = (id) => setRow(id, { selected: !rowState[id]?.selected });
  const toggleAll = () => {
    if (!results?.matched) return;
    const allOn = results.matched.every(r => rowState[r.id]?.selected);
    const next = { ...rowState };
    results.matched.forEach(r => { next[r.id] = { ...(next[r.id] || {}), selected: !allOn }; });
    setRowState(next);
  };

  // Apply gating — every selected row must have a reason (per-row OR
  // bulk-level) when status is cancel-like.
  const missingReason = isCancelStatus && selectedRows.some(id => {
    const rr = rowState[id]?.note?.trim() || bulkReason.trim();
    return !rr;
  });
  const applyDisabled = applying || !newStatus || selectedRows.length === 0 || missingReason;

  const doApply = async () => {
    if (applyDisabled) return;
    setApplying(true); setApplyMsg('');
    try {
      const updates = selectedRows.map(id => {
        const v = rowState[id] || {};
        return {
          id,
          cancellation_date: v.date || undefined,
          reason: (v.note || '').trim() || undefined,
        };
      });
      const { data } = await client.post('compliance/sales/bulk-status', {
        updates,
        new_status: newStatus,
        reason: bulkReason.trim() || undefined,
        cancellation_reason_key: bulkReasonKey || undefined,
        cancellation_date: bulkDate || undefined,
        chargeback_date: newStatus === 'chargeback' ? (bulkDate || undefined) : undefined,
        chargeback_amount: newStatus === 'chargeback' ? (bulkChargebackAmt || undefined) : undefined,
      });
      const skippedLine = data.skipped?.length
        ? ` Skipped ${data.skipped.length}: ${data.skipped.slice(0, 3).map(s => s.reason).join('; ')}${data.skipped.length > 3 ? '…' : ''}`
        : '';
      setApplyMsg(`Updated ${data.updated}/${updates.length}.${skippedLine}`);
      await doSearch(parsed.entries);
      setBulkReason(''); setBulkDate(''); setBulkReasonKey(''); setBulkChargebackAmt('');
    } catch (e) {
      setApplyMsg(e.response?.data?.error || 'Update failed.');
    } finally {
      setApplying(false);
    }
  };

  const reset = () => {
    setPasteText(''); setResults(null); setRowState({});
    setNewStatus(''); setBulkReason(''); setBulkDate(''); setApplyMsg(''); setSearchErr('');
  };

  return (
    <div className="space-y-5 animate-fade-in max-w-6xl">
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-3">
          <ListChecks size={22} className="text-white" />
          <div>
            <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Bulk Status Update</h2>
            <p className="text-sm text-white/80">
              Paste or upload references — optionally with cancellation date + note per line — then apply a status to every row.
            </p>
          </div>
        </div>
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, white, transparent 70%)' }} />
      </div>

      {/* ── Step 1: Input ─────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          1. Paste references (and optionally date + note)
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          One row per line. Columns can be separated by comma, semicolon, pipe, or tab. Example:
          <code className="ml-1 px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>P-1001, 2026-05-15, customer requested refund</code>.
          Date is optional; if you skip it, the bulk-level date below is used. Header rows auto-skip.
        </p>
        <textarea
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          rows={6}
          placeholder={'P-1001\nP-1002, 2026-05-12\nP-1003, 2026-05-14, customer cancellation\nP-1004 | 2026-05-15 | chargeback'}
          className="input w-full font-mono text-sm"
          style={{ minHeight: 130 }}
        />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={onSearchClick} disabled={searching || parsed.entries.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{ background: 'var(--gradient-sidebar)', minHeight: 36 }}>
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Search {parsed.entries.length > 0 && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.22)' }}>{parsed.entries.length}</span>}
          </button>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border cursor-pointer transition-colors hover:bg-bg-secondary"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', minHeight: 36 }}>
            <Upload size={14} /> Upload CSV
            <input type="file" accept=".csv,.tsv,.txt" hidden onChange={onFile} />
          </label>
          {(pasteText || results) && (
            <button onClick={reset}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border hover:bg-bg-secondary"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', minHeight: 36 }}>
              <Trash2 size={14} /> Clear
            </button>
          )}
          {parsed.entries.some(e => e.dateRaw && !e.date) && (
            <span className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--color-warning-700)' }}>
              <AlertTriangle size={11} /> Some lines had a date column that couldn't be parsed — they'll fall back to the bulk-level date.
            </span>
          )}
          {searchErr && <span className="text-xs font-semibold" style={{ color: 'var(--color-error-600, #dc2626)' }}>{searchErr}</span>}
        </div>
      </div>

      {/* ── Step 2: Results ──────────────────────────────────────────── */}
      {results && (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>
              2. Review matched rows · edit per-row date + note if needed
            </p>
            <div className="flex items-center gap-3 text-xs font-semibold flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} style={{ color: 'var(--color-success-600)' }} /> {results.matched.length} matched</span>
              {results.unmatched.length > 0 && (
                <span className="inline-flex items-center gap-1"><X size={12} style={{ color: 'var(--color-error-600)' }} /> {results.unmatched.length} not in DB</span>
              )}
              {results.duplicates.length > 0 && (
                <span className="inline-flex items-center gap-1"><AlertTriangle size={12} style={{ color: 'var(--color-warning-600)' }} /> {results.duplicates.length} duplicate input</span>
              )}
            </div>
          </div>

          {results.matched.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <th className="px-3 py-2 text-left">
                      <input type="checkbox"
                        checked={results.matched.every(r => rowState[r.id]?.selected)}
                        onChange={toggleAll} />
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Ref / Policy</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Customer</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Current</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Cancel Date</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Note / Reason</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Company · Closer</th>
                  </tr>
                </thead>
                <tbody>
                  {results.matched.map(s => {
                    const hit = enabledStatuses.find(x => x.key === s.status);
                    const dot = hit ? (BADGE_DOT[hit.badge] || '#6b7280') : '#6b7280';
                    const lbl = hit?.label || (s.status || '—').replace(/_/g, ' ');
                    const rs  = rowState[s.id] || {};
                    return (
                      <tr key={s.id} className="border-b"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: rs.selected ? 'var(--color-primary-50, #eef2ff)' : 'transparent' }}>
                        <td className="px-3 py-2 align-top">
                          <input type="checkbox" checked={!!rs.selected} onChange={() => toggle(s.id)} />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs align-top">
                          <div>{s.matched_via || s.reference_no || '—'}</div>
                          {s.policy_number && s.policy_number !== s.matched_via && (
                            <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{s.policy_number}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-semibold text-sm">{s.customer_name || '—'}</div>
                          <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{s.customer_phone || ''}</div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                            <span className="inline-block rounded-full" style={{ width: 7, height: 7, backgroundColor: dot }} />
                            {lbl}
                          </span>
                          {s.cancellation_date && (
                            <div className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                              cancelled {s.cancellation_date}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <input type="date"
                            value={rs.date || ''}
                            onChange={e => setRow(s.id, { date: e.target.value })}
                            className="input text-xs py-1"
                            style={{ minWidth: 130 }} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <textarea
                            value={rs.note || ''}
                            onChange={e => setRow(s.id, { note: e.target.value })}
                            placeholder={bulkReason ? `(bulk: ${bulkReason.slice(0,40)})` : 'optional per-row note'}
                            rows={1}
                            className="input text-xs py-1 w-full"
                            style={{ minWidth: 180, resize: 'vertical' }} />
                        </td>
                        <td className="px-3 py-2 text-xs align-top">
                          <div>{s.company_name || '—'}</div>
                          <div style={{ color: 'var(--color-text-tertiary)' }}>{s.closer_name || '—'}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-center py-8 italic" style={{ color: 'var(--color-text-secondary)' }}>
              None of the references matched any sale.
            </p>
          )}

          {(results.unmatched.length > 0 || results.duplicates.length > 0) && (
            <div className="px-4 py-3 border-t space-y-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {results.unmatched.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-error-700, #b91c1c)' }}>
                    Not found in DB ({results.unmatched.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {results.unmatched.map(r => (
                      <span key={r} className="text-[11px] px-2 py-0.5 rounded font-mono"
                        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-error-200, #fecaca)', color: 'var(--color-error-700, #b91c1c)' }}>{r}</span>
                    ))}
                  </div>
                </div>
              )}
              {results.duplicates.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-warning-700, #b45309)' }}>
                    Duplicate inputs ignored ({results.duplicates.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {results.duplicates.map((r, i) => (
                      <span key={`${r}-${i}`} className="text-[11px] px-2 py-0.5 rounded font-mono"
                        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-warning-200, #fcd34d)', color: 'var(--color-warning-700, #b45309)' }}>{r}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Apply ────────────────────────────────────────────── */}
      {results && results.matched.length > 0 && (
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            3. Apply a new status to {selectedRows.length} selected row{selectedRows.length === 1 ? '' : 's'}
          </p>

          <div className="flex flex-wrap gap-2 mb-4">
            {enabledStatuses.map(s => {
              const active = newStatus === s.key;
              const dot = BADGE_DOT[s.badge] || '#6b7280';
              return (
                <button key={s.key} type="button" onClick={() => setNewStatus(s.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all"
                  style={{
                    background: active ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                    color:      active ? 'white' : 'var(--color-text-secondary)',
                    border:     '1px solid var(--color-border)',
                    boxShadow:  active ? 'var(--shadow-sm)' : 'none',
                  }}>
                  <span className="inline-block rounded-full" style={{ width: 7, height: 7, backgroundColor: dot }} />
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Bulk-level fallback fields — only shown once a status is picked
              so the form isn't noisy on first load. */}
          {newStatus && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              {(isCancelStatus || ['closed_won', 'needs_revision'].includes(newStatus)) && (
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                    <Calendar size={11} className="inline mr-1" />
                    Cancellation date for all rows {!isCancelStatus && '(optional)'}
                  </label>
                  <input type="date" value={bulkDate}
                    onChange={e => setBulkDate(e.target.value)}
                    className="input text-sm" />
                  <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    Pick one date here to apply to every row. Rows that already have their own date in the table above keep their own.
                  </p>
                </div>
              )}
              {isCancelStatus && (
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                    Reason (canonical) for all rows
                  </label>
                  <select value={bulkReasonKey} onChange={e => setBulkReasonKey(e.target.value)}
                    className="input text-sm">
                    <option value="">— pick a canonical reason —</option>
                    {cancelReasonChoices.map(r => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                    Canonical reason key drives top-reason reports. Free-text note below stays per-row.
                  </p>
                </div>
              )}
              {newStatus === 'chargeback' && (
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>
                    Chargeback amount (USD) for all rows
                  </label>
                  <input type="number" step="0.01" min="0" value={bulkChargebackAmt}
                    onChange={e => setBulkChargebackAmt(e.target.value)}
                    className="input text-sm" placeholder="e.g. 1250.00" />
                </div>
              )}
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: isCancelStatus ? 'var(--color-error-700, #b91c1c)' : 'var(--color-text-secondary)' }}>
                  {isCancelStatus ? 'Reason for all rows' : 'Note for all rows (optional)'}
                </label>
                <textarea
                  value={bulkReason}
                  onChange={e => setBulkReason(e.target.value)}
                  rows={2}
                  placeholder={isCancelStatus
                    ? 'Why are these being cancelled? Used for every row that doesn\'t have its own note.'
                    : 'Optional context appended to each sale\'s compliance note.'}
                  className="input w-full text-sm"
                  style={{
                    borderColor: isCancelStatus && !bulkReason.trim() && selectedRows.some(id => !rowState[id]?.note?.trim()) ? 'var(--color-error-300, #fca5a5)' : 'var(--color-border)',
                  }}
                />
                <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  Type one reason here to apply to every row. Rows with their own note in the table above keep their own.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={doApply} disabled={applyDisabled}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--gradient-sidebar)', minHeight: 38 }}>
              {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Apply to {selectedRows.length} sale{selectedRows.length === 1 ? '' : 's'}
            </button>
            {applyMsg && (
              <span className="text-xs font-semibold px-2 py-1 rounded"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
                {applyMsg}
              </span>
            )}
            {missingReason && (
              <span className="text-[11px]" style={{ color: 'var(--color-error-600, #dc2626)' }}>
                Reason required (per-row or bulk) for {newStatus.replace(/_/g, ' ')}.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
