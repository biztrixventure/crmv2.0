import { useState, useEffect, useMemo, useCallback } from 'react';
import { Eraser, Search, AlertTriangle, ArrowRight, CheckCircle2, Loader2, Database, History, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../UI';
import client from '../../../api/client';
import { useFormFields } from '../../../hooks/useFormFields';

const fmt = (s) => { try { return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return '—'; } };

// Superadmin batch find/replace. Pick a configured form field, then either
// correct a wrong value or fill blanks, preview the match count, replace behind
// a double confirmation — and revert any past operation from the history.
const DataCleanup = () => {
  const { fields, fetchFields } = useFormFields();
  useEffect(() => { fetchFields(); }, [fetchFields]);

  const [fieldName, setFieldName]   = useState('');
  const [matchBlank, setMatchBlank] = useState(false);
  const [oldValue, setOldValue]     = useState('');
  const [newValue, setNewValue]     = useState('');
  const [preview, setPreview]       = useState(null);
  const [busy, setBusy]             = useState(false);
  const [confirm, setConfirm]       = useState(false);
  const [ack, setAck]               = useState(false);
  const [result, setResult]         = useState(null);
  const [history, setHistory]       = useState([]);
  const [revertId, setRevertId]     = useState(null);

  const field = useMemo(() => (fields || []).find(f => f.name === fieldName) || null, [fields, fieldName]);

  const loadHistory = useCallback(() => {
    client.get('data-cleanup/history').then(r => setHistory(r.data.operations || [])).catch(() => {});
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const resetPreview = () => { setPreview(null); setResult(null); };

  const canPreview = !!fieldName && (matchBlank || oldValue.trim() !== '');
  const canRun = canPreview && newValue.trim() !== ''
    && (matchBlank || oldValue !== newValue)
    && preview && preview.total > 0;

  const runPreview = async () => {
    if (!canPreview) return;
    setBusy(true); setResult(null);
    try {
      const r = await client.post('data-cleanup/preview', {
        field: fieldName, field_type: field?.field_type, old_value: oldValue, match_blank: matchBlank,
      });
      setPreview(r.data);
      if (!r.data.total) toast.info(matchBlank ? 'No blank records for this field.' : 'No records contain that value.');
    } catch (e) { toast.error(e.response?.data?.error || 'Preview failed'); setPreview(null); }
    finally { setBusy(false); }
  };

  const execute = async () => {
    setBusy(true);
    try {
      const r = await client.post('data-cleanup/execute', {
        field: fieldName, field_type: field?.field_type, old_value: oldValue, new_value: newValue, match_blank: matchBlank,
      });
      setResult(r.data);
      setConfirm(false); setAck(false); setPreview(null);
      toast.success(`Updated ${r.data.updated} record${r.data.updated === 1 ? '' : 's'}.`);
      loadHistory();
    } catch (e) { toast.error(e.response?.data?.error || 'Update failed'); }
    finally { setBusy(false); }
  };

  const revert = async (op) => {
    if (!window.confirm(`Revert this change? "${op.new_value}" will be set back to ${op.match_blank ? 'blank' : `"${op.old_value}"`} on the ${op.counts?.total} record(s) it changed.`)) return;
    setRevertId(op.id);
    try {
      const r = await client.post(`data-cleanup/revert/${op.id}`);
      toast.success(`Reverted ${r.data.reverted} record${r.data.reverted === 1 ? '' : 's'}.`);
      loadHistory();
    } catch (e) { toast.error(e.response?.data?.error || 'Revert failed'); }
    finally { setRevertId(null); }
  };

  const Count = ({ label, n }) => (
    <div className="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span className="font-bold" style={{ color: 'var(--color-text)' }}>{n}</span>
    </div>
  );
  const fromLabel = matchBlank ? '(blank)' : `“${oldValue}”`;

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <Eraser size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Data Cleanup</h2>
            <p className="text-sm text-white/80">Fix a wrong value (“Hodna” → “Honda”) or fill blank fields — across the whole database, with one-click revert.</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {/* Field */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Form field</label>
          <select value={fieldName} onChange={e => { setFieldName(e.target.value); resetPreview(); }} className="input">
            <option value="">Select a field…</option>
            {(fields || []).map(f => <option key={f.id || f.name} value={f.name}>{f.label || f.name} ({f.name})</option>)}
          </select>
        </div>

        {/* Blank toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={matchBlank} onChange={e => { setMatchBlank(e.target.checked); resetPreview(); }} />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Find <strong>empty / blank</strong> records and fill them</span>
        </label>

        {/* Old → New */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{matchBlank ? 'Current value' : 'Wrong value'}</label>
            <input value={matchBlank ? '' : oldValue} disabled={matchBlank}
              onChange={e => { setOldValue(e.target.value); resetPreview(); }} className="input disabled:opacity-50"
              placeholder={matchBlank ? '(blank / empty)' : 'Hodna'} />
          </div>
          <ArrowRight size={18} className="mb-2.5 mx-auto hidden sm:block" style={{ color: 'var(--color-text-tertiary)' }} />
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{matchBlank ? 'Fill with' : 'Correct value'}</label>
            <input value={newValue} onChange={e => { setNewValue(e.target.value); setResult(null); }} className="input" placeholder="Honda" />
          </div>
        </div>

        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
          <Database size={13} className="mt-0.5 flex-shrink-0" /> {matchBlank ? 'Blank = missing or empty value.' : 'Match is exact + case-sensitive.'} Preview first; every change is logged and can be reverted below.
        </p>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={runPreview} disabled={!canPreview || busy} className="flex items-center gap-1.5">
            {busy && !confirm ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Preview
          </Button>
          <Button variant="primary" onClick={() => { setAck(false); setConfirm(true); }} disabled={!canRun || busy} className="flex items-center gap-1.5">
            <Eraser size={15} /> {matchBlank ? 'Fill all' : 'Replace all'}
          </Button>
        </div>

        {preview && (
          <div className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--color-border)' }}>
            <p className="text-sm font-bold" style={{ color: preview.total ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)' }}>
              {preview.total} record{preview.total === 1 ? '' : 's'} match {fromLabel} in {field?.label || fieldName}
            </p>
            <Count label="Transfers (form data)" n={preview.counts.transfers_form_data} />
            <Count label="Sales (form data)" n={preview.counts.sales_form_data} />
            {preview.column && <Count label={`Sales · ${preview.column} column`} n={preview.counts.sales_column} />}

            {/* Phone numbers of the matching records — verify before running. */}
            {preview.samples?.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                  Phone numbers {preview.sample_truncated ? `· showing first ${preview.samples.length} of ${preview.total}` : `· ${preview.samples.length}`}
                </p>
                <div className="max-h-60 overflow-y-auto rounded-lg" style={{ border: '1px solid var(--color-border)' }}>
                  <table className="w-full text-xs">
                    <thead className="sticky top-0" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      <tr style={{ color: 'var(--color-text-tertiary)' }}>
                        <th className="text-left font-bold px-3 py-1.5">Phone</th>
                        <th className="text-left font-bold px-3 py-1.5">Name</th>
                        <th className="text-left font-bold px-3 py-1.5">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.samples.map((s, i) => (
                        <tr key={i} style={{ borderTop: '1px solid var(--color-border)' }}>
                          <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--color-text)' }}>{s.phone || '—'}</td>
                          <td className="px-3 py-1.5" style={{ color: 'var(--color-text-secondary)' }}>{s.name || '—'}</td>
                          <td className="px-3 py-1.5">
                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: s.source === 'sale' ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)', color: s.source === 'sale' ? 'var(--color-primary-700)' : 'var(--color-text-secondary)' }}>
                              {s.source}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className="rounded-xl p-3 flex items-start gap-2" style={{ backgroundColor: 'var(--color-success-50, #f0fdf4)', border: '1px solid var(--color-success-200, #bbf7d0)' }}>
            <CheckCircle2 size={16} style={{ color: 'var(--color-success-600)' }} className="mt-0.5 flex-shrink-0" />
            <p className="text-sm font-bold" style={{ color: 'var(--color-success-700, #15803d)' }}>Updated {result.updated} record{result.updated === 1 ? '' : 's'}. Revert it from the history below if needed.</p>
          </div>
        )}
      </div>

      {/* History */}
      <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-base font-bold flex items-center gap-2 mb-3" style={{ color: 'var(--color-text)' }}>
          <History size={17} style={{ color: 'var(--color-primary-600)' }} /> Change history
        </h3>
        {history.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No cleanups yet.</p>
        ) : (
          <div className="space-y-1.5">
            {history.map(op => (
              <div key={op.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                    {op.field}: {op.match_blank ? <em>blank</em> : `“${op.old_value}”`} → “{op.new_value}”
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {op.counts?.total ?? 0} record(s) · {fmt(op.performed_at)} · {op.performed_by_name}
                    {op.reverted_at && <span style={{ color: 'var(--color-text-tertiary)' }}> · reverted {fmt(op.reverted_at)}</span>}
                  </p>
                </div>
                {op.reverted_at ? (
                  <span className="text-xs font-semibold px-2 py-1 rounded-lg flex-shrink-0" style={{ color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>Reverted</span>
                ) : (
                  <button onClick={() => revert(op)} disabled={revertId === op.id}
                    className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-50"
                    style={{ color: 'var(--color-error-600)', border: '1px solid var(--color-error-300)' }}>
                    {revertId === op.id ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />} Revert
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Double-confirm modal */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--color-error-600)' }}>
              <AlertTriangle size={18} /> Are you sure?
            </h3>
            <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
              {matchBlank ? <>Fill <strong>{preview?.total}</strong> blank record(s)</> : <>Replace <strong>{fromLabel}</strong> with <strong>“{newValue}”</strong> on <strong>{preview?.total}</strong> record(s)</>}
              {' '}in <strong>{field?.label || fieldName}</strong> ({preview?.counts.transfers_form_data} transfers, {preview?.counts.sales_form_data} sales
              {preview?.column ? `, +${preview?.counts.sales_column} sales ${preview.column}` : ''}). You can revert this from the history.
            </p>
            <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>I understand this changes the data.</span>
            </label>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => { setConfirm(false); setAck(false); }} className="flex-1" disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={execute} disabled={!ack || busy} className="flex-1 flex items-center justify-center gap-1.5">
                {busy ? <><Loader2 size={15} className="animate-spin" /> Working…</> : <>{matchBlank ? 'Fill' : 'Replace'} {preview?.total}</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataCleanup;
