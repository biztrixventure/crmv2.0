import { useMemo, useState } from 'react';
import {
  Upload, Search, ListChecks, X, AlertTriangle, CheckCircle2, FileText,
  Hash, Loader2, Trash2,
} from 'lucide-react';
import client from '../../api/client';
import { useComplianceStatuses } from '../../hooks/useComplianceStatuses';

/*
 * BulkStatusUpdate
 *
 * Compliance-shell page for updating many sales at once by reference /
 * policy number. Workflow:
 *   1. Paste a list (commas, spaces, newlines all OK) OR upload a CSV
 *      whose first column is the reference / policy number.
 *   2. Search → backend matches each ref against sales.reference_no,
 *      form_data.SaleReferenceNo, and form_data.PolicyNumber. Unmatched
 *      and duplicate inputs are surfaced separately.
 *   3. Select rows (all or one-by-one).
 *   4. Pick a target status from the live compliance.status_catalog.
 *   5. When the status is a cancellation/loss type, a reason field is
 *      required and the reason is appended to compliance_note +
 *      edit_history on every updated row.
 *   6. Apply → backend bulk-updates + writes audit history.
 */

const BADGE_DOT = {
  success: '#16a34a', error: '#dc2626', warning: '#d97706',
  info: '#2563eb', primary: '#6366f1', secondary: '#6b7280',
};
const CANCEL_LIKE = new Set(['cancelled','compliance_cancelled','closed_lost','chargeback','dispute']);

// Parse the paste box: split on commas / semicolons / newlines / tabs /
// pipes / multiple spaces. Trim, drop blanks, dedupe-preserving-order.
function parseRefs(text) {
  if (!text) return [];
  const parts = String(text).split(/[\n\r,;\t|]|  +/g).map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

// Read the first column of a CSV/TSV file. Skips the header row when it's
// obviously a label (contains the words "ref" / "policy"). Reads up to 5000
// lines so a wildly oversized file doesn't lock the tab.
async function readCsvFirstColumn(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).slice(0, 5000);
  const refs = [];
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw) continue;
    const sep = raw.includes('\t') ? '\t' : ',';
    const first = raw.split(sep)[0]?.replace(/^"|"$/g, '').trim();
    if (!first) continue;
    if (!started && i === 0 && /^(ref|policy|sale\s*ref|reference)/i.test(first)) continue;
    started = true;
    refs.push(first);
  }
  return refs;
}

export default function BulkStatusUpdate() {
  const { catalog } = useComplianceStatuses();
  const enabledStatuses = useMemo(
    () => (catalog || []).filter(s => s && s.key && s.enabled !== false),
    [catalog],
  );

  const [pasteText, setPasteText]   = useState('');
  const [searching, setSearching]   = useState(false);
  const [searchErr, setSearchErr]   = useState('');
  const [results, setResults]       = useState(null);   // { matched, unmatched, duplicates }
  const [selected, setSelected]     = useState(new Set());
  const [newStatus, setNewStatus]   = useState('');
  const [reason, setReason]         = useState('');
  const [applying, setApplying]     = useState(false);
  const [applyMsg, setApplyMsg]     = useState('');

  const parsedFromBox = useMemo(() => parseRefs(pasteText), [pasteText]);
  const isCancelStatus = newStatus && CANCEL_LIKE.has(newStatus);

  const doSearch = async (refs) => {
    setSearching(true); setSearchErr(''); setResults(null); setSelected(new Set());
    try {
      const { data } = await client.post('compliance/sales/bulk-search', { refs });
      setResults(data);
      // Auto-select all matched on first load so the common case is one click.
      setSelected(new Set((data?.matched || []).map(r => r.id)));
    } catch (e) {
      setSearchErr(e.response?.data?.error || 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const onSearchClick = () => {
    const refs = parsedFromBox;
    if (!refs.length) { setSearchErr('Paste at least one reference or policy number.'); return; }
    doSearch(refs);
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
    if (!file) return;
    try {
      const refs = await readCsvFirstColumn(file);
      if (!refs.length) { setSearchErr('No reference numbers found in the file.'); return; }
      setPasteText(refs.join('\n'));
      doSearch(refs);
    } catch {
      setSearchErr('Could not read the file. Use a .csv or plain-text file.');
    }
  };

  const toggle = (id) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => {
    if (!results?.matched) return;
    if (selected.size === results.matched.length) setSelected(new Set());
    else setSelected(new Set(results.matched.map(r => r.id)));
  };

  const applyDisabled = applying || !newStatus || selected.size === 0 || (isCancelStatus && !reason.trim());

  const doApply = async () => {
    if (applyDisabled) return;
    setApplying(true); setApplyMsg('');
    try {
      const ids = [...selected];
      const { data } = await client.post('compliance/sales/bulk-status', {
        ids, new_status: newStatus, reason: reason.trim() || undefined,
      });
      setApplyMsg(`Updated ${data.updated}/${ids.length}.${data.skipped?.length ? ` Skipped ${data.skipped.length}.` : ''}`);
      // Refresh the visible rows so the new status renders inline.
      await doSearch(parsedFromBox);
      setReason('');
    } catch (e) {
      setApplyMsg(e.response?.data?.error || 'Update failed.');
    } finally {
      setApplying(false);
    }
  };

  const reset = () => {
    setPasteText(''); setResults(null); setSelected(new Set());
    setNewStatus(''); setReason(''); setApplyMsg(''); setSearchErr('');
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
              Paste or upload reference / policy numbers, pick the rows, set the target status — applied in one go with audit trail.
            </p>
          </div>
        </div>
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, white, transparent 70%)' }} />
      </div>

      {/* ── Step 1: Input ─────────────────────────────────────────────── */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          1. Paste references or upload CSV
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Accepts commas, spaces, newlines, tabs, pipes — any common separator. CSV uses the first column. Matches against
          <code className="mx-1 px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>reference_no</code> and any
          <code className="mx-1 px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>SaleReferenceNo</code> /
          <code className="mx-1 px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>PolicyNumber</code> form-data keys.
        </p>
        <textarea
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          rows={5}
          placeholder="P-1001, P-1002, P-1003&#10;P-1004&#10;P-1005"
          className="input w-full font-mono text-sm"
          style={{ minHeight: 110 }}
        />
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={onSearchClick} disabled={searching || parsedFromBox.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white transition-all disabled:opacity-40"
            style={{ background: 'var(--gradient-sidebar)', minHeight: 36 }}>
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Search {parsedFromBox.length > 0 && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(255,255,255,0.22)' }}>{parsedFromBox.length}</span>}
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
          {searchErr && <span className="text-xs font-semibold" style={{ color: 'var(--color-error-600, #dc2626)' }}>{searchErr}</span>}
        </div>
      </div>

      {/* ── Step 2: Results ──────────────────────────────────────────── */}
      {results && (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>
              2. Pick rows to update
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
                        checked={selected.size === results.matched.length}
                        onChange={toggleAll} />
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Ref / Policy</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Customer</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Current Status</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Company</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Closer / Fronter</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Sale Date</th>
                  </tr>
                </thead>
                <tbody>
                  {results.matched.map(s => {
                    const hit = enabledStatuses.find(x => x.key === s.status);
                    const dot = hit ? (BADGE_DOT[hit.badge] || '#6b7280') : '#6b7280';
                    const lbl = hit?.label || (s.status || '—').replace(/_/g, ' ');
                    return (
                      <tr key={s.id} className="border-b hover:bg-bg-secondary"
                        style={{ borderColor: 'var(--color-border)', backgroundColor: selected.has(s.id) ? 'var(--color-primary-50, #eef2ff)' : 'transparent' }}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          <div>{s.matched_via || s.reference_no || '—'}</div>
                          {s.policy_number && s.policy_number !== s.matched_via && (
                            <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{s.policy_number}</div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-sm">{s.customer_name || '—'}</div>
                          <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{s.customer_phone || ''}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                            <span className="inline-block rounded-full" style={{ width: 7, height: 7, backgroundColor: dot }} />
                            {lbl}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">{s.company_name || '—'}</td>
                        <td className="px-3 py-2 text-xs">
                          <div>{s.closer_name || '—'}</div>
                          <div style={{ color: 'var(--color-text-tertiary)' }}>{s.fronter_name || '—'}</div>
                        </td>
                        <td className="px-3 py-2 text-xs">{s.sale_date || '—'}</td>
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

      {/* ── Step 3: Apply status ─────────────────────────────────────── */}
      {results && results.matched.length > 0 && (
        <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            3. Apply a new status to {selected.size} selected row{selected.size === 1 ? '' : 's'}
          </p>

          <div className="flex flex-wrap gap-2 mb-3">
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

          {/* Reason — required + visible when status is cancel-like. We
              still show the box for non-cancel statuses but as optional,
              since compliance often wants a note even on approvals. */}
          {(newStatus && (isCancelStatus || newStatus === 'needs_revision' || newStatus === 'closed_won')) && (
            <div className="mb-3">
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: isCancelStatus ? 'var(--color-error-700, #b91c1c)' : 'var(--color-text-secondary)' }}>
                {isCancelStatus ? 'Reason (required)' : 'Note (optional)'}
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder={isCancelStatus
                  ? 'Why are these being cancelled? Applied to every selected row.'
                  : 'Optional context appended to each sale\'s compliance note.'}
                className="input w-full text-sm"
                style={{
                  borderColor: isCancelStatus && !reason.trim() ? 'var(--color-error-300, #fca5a5)' : 'var(--color-border)',
                }}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={doApply} disabled={applyDisabled}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--gradient-sidebar)', minHeight: 38 }}>
              {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Apply to {selected.size} sale{selected.size === 1 ? '' : 's'}
            </button>
            {applyMsg && (
              <span className="text-xs font-semibold px-2 py-1 rounded"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
                {applyMsg}
              </span>
            )}
            {isCancelStatus && !reason.trim() && (
              <span className="text-[11px]" style={{ color: 'var(--color-error-600, #dc2626)' }}>
                Reason required for {newStatus.replace(/_/g, ' ')}.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
