import { useState, useEffect, useMemo, useCallback } from 'react';
import { Eraser, Search, AlertTriangle, CheckCircle2, Loader2, Database, History, Undo2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../UI';
import client from '../../../api/client';
import { useFormFields } from '../../../hooks/useFormFields';

const fmt = (s) => { try { return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return '—'; } };

// Superadmin batch find/replace. Search ONE or MANY form fields at once (great
// for the same dirty value scattered across fields), see the distinct values per
// field, then click one to replace it precisely. Replace is always single
// field + exact value so every change is logged and one-click revertible.
const DataCleanup = () => {
  const { fields, fetchFields } = useFormFields();
  useEffect(() => { fetchFields(); }, [fetchFields]);

  // ── search (multi-field) ──
  const [searchFields, setSearchFields] = useState([]);   // [{ name, field_type, label }]
  const [matchBlank, setMatchBlank]     = useState(false);
  const [mode, setMode]                 = useState('exact'); // 'exact' | 'contains'
  const [searchValue, setSearchValue]   = useState('');
  const [preview, setPreview]           = useState(null);

  // ── replace (single target) ──
  const [target, setTarget]   = useState(null);   // { field, field_type, label, value, matchBlank }
  const [newValue, setNewValue] = useState('');

  const [busy, setBusy]       = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck]         = useState(false);
  const [result, setResult]   = useState(null);
  const [history, setHistory] = useState([]);
  const [revertId, setRevertId] = useState(null);
  const [addPick, setAddPick] = useState('');

  const labelOf = useCallback((name) => (fields || []).find(f => f.name === name)?.label || name, [fields]);
  const available = useMemo(
    () => (fields || []).filter(f => !searchFields.some(s => s.name === f.name)),
    [fields, searchFields],
  );

  const loadHistory = useCallback(() => {
    client.get('data-cleanup/history').then(r => setHistory(r.data.operations || [])).catch(() => {});
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const resetSearch = () => { setPreview(null); setTarget(null); setResult(null); };

  const addField = (name) => {
    const f = (fields || []).find(x => x.name === name);
    if (!f) return;
    setSearchFields(s => s.some(x => x.name === name) ? s : [...s, { name: f.name, field_type: f.field_type, label: f.label || f.name }]);
    setAddPick(''); resetSearch();
  };
  const removeField = (name) => { setSearchFields(s => s.filter(x => x.name !== name)); resetSearch(); };

  const canSearch = searchFields.length > 0 && (matchBlank || searchValue.trim() !== '');

  const runSearch = async () => {
    if (!canSearch) return;
    setBusy(true); setResult(null); setTarget(null);
    try {
      const r = await client.post('data-cleanup/preview', {
        fields: searchFields.map(f => ({ name: f.name, field_type: f.field_type })),
        old_value: searchValue, match_blank: matchBlank, mode,
      });
      setPreview(r.data);
      if (!r.data.grand_total) toast.info(matchBlank ? 'No blank records in those fields.' : (mode === 'contains' ? 'No values contain that text.' : 'No records have exactly that value.'));
    } catch (e) { toast.error(e.response?.data?.error || 'Search failed'); setPreview(null); }
    finally { setBusy(false); }
  };

  // Click a distinct value → load it as the single replace target.
  const pickTarget = (res, value) => {
    setTarget({ field: res.field, field_type: res.field_type, label: labelOf(res.field), value, matchBlank });
    setNewValue(''); setResult(null);
  };

  const canRun = target && newValue.trim() !== '' && (target.matchBlank || target.value !== newValue);

  const execute = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await client.post('data-cleanup/execute', {
        field: target.field, field_type: target.field_type,
        old_value: target.value, new_value: newValue, match_blank: target.matchBlank,
      });
      setResult(r.data);
      setConfirm(false); setAck(false); setTarget(null); setNewValue('');
      toast.success(`Updated ${r.data.updated} record${r.data.updated === 1 ? '' : 's'}.`);
      loadHistory();
      runSearch();   // refresh the search so the fixed value drops out
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

  const FieldResult = ({ res }) => {
    const vals = res.values || [];
    return (
      <div className="rounded-xl p-3 space-y-2" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold truncate" style={{ color: res.total ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)' }}>
            {labelOf(res.field)} <span className="font-medium opacity-60">({res.field})</span>
          </p>
          <span className="text-xs font-bold px-2 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: res.total ? 'var(--color-primary-100)' : 'var(--color-bg-secondary)', color: res.total ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)' }}>
            {res.total} match{res.total === 1 ? '' : 'es'}
          </span>
        </div>
        {res.total === 0 ? (
          <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Nothing here.</p>
        ) : (
          <>
            <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {res.counts.transfers_form_data} transfers · {res.counts.sales_form_data} sales{res.column ? ` · +${res.counts.sales_column} ${res.column}` : ''}
            </p>
            <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
              {vals.map((v, i) => {
                const isSel = target && target.field === res.field && target.value === v.value;
                return (
                  <button key={i} type="button" onClick={() => pickTarget(res, v.value)} title="Load as the value to replace"
                    className="text-xs font-semibold px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                    style={{ backgroundColor: isSel ? 'var(--color-primary-600)' : 'var(--color-surface)', color: isSel ? 'white' : 'var(--color-text)', border: `1px solid ${isSel ? 'var(--color-primary-600)' : 'var(--color-border)'}` }}>
                    <span className="font-mono">{v.value === '' ? '(blank)' : v.value}</span>
                    <span className="text-[10px] font-bold px-1 rounded" style={{ backgroundColor: isSel ? 'rgba(255,255,255,0.25)' : 'var(--color-primary-100)', color: isSel ? 'white' : 'var(--color-primary-700)' }}>{v.count}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  const fromLabel = target ? (target.matchBlank ? '(blank)' : `“${target.value === '' ? '(blank)' : target.value}”`) : '';

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <Eraser size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Data Cleanup</h2>
            <p className="text-sm text-white/80">Search one or many fields for dirty values, then fix each precisely — every change is logged and revertible.</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {/* Field picker (multi) */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Fields to search</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {searchFields.length === 0
              ? <span className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Add one or more fields below.</span>
              : searchFields.map(f => (
                <span key={f.name} className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                  {f.label} <span className="opacity-60">({f.name})</span>
                  <button type="button" onClick={() => removeField(f.name)} className="hover:opacity-70"><X size={12} /></button>
                </span>
              ))}
          </div>
          <div className="flex items-center gap-2">
            <select value={addPick} onChange={e => { if (e.target.value) addField(e.target.value); }} className="input text-sm flex-1">
              <option value="">+ Add a field…</option>
              {available.map(f => <option key={f.id || f.name} value={f.name}>{f.label || f.name} ({f.name})</option>)}
            </select>
            {available.length > 0 && (
              <button type="button" onClick={() => { setSearchFields((fields || []).map(f => ({ name: f.name, field_type: f.field_type, label: f.label || f.name }))); resetSearch(); }}
                className="text-xs font-bold px-2.5 py-2 rounded-lg flex items-center gap-1 flex-shrink-0" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }} title="Add all fields">
                <Plus size={13} /> All
              </button>
            )}
          </div>
        </div>

        {/* Blank toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={matchBlank} onChange={e => { setMatchBlank(e.target.checked); resetSearch(); }} />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Find <strong>empty / blank</strong> records and fill them</span>
        </label>

        {/* Match mode + search value */}
        {!matchBlank && (
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Match</label>
              <div className="flex rounded-lg overflow-hidden w-fit" style={{ border: '1px solid var(--color-border)' }}>
                {[['exact', 'Exact'], ['contains', 'Contains (search)']].map(([m, l]) => (
                  <button key={m} type="button" onClick={() => { setMode(m); resetSearch(); }} className="px-3 py-1.5 text-xs font-bold transition-colors"
                    style={{ backgroundColor: mode === m ? 'var(--color-primary-600)' : 'var(--color-surface)', color: mode === m ? 'white' : 'var(--color-text-secondary)' }}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{mode === 'contains' ? 'Search text (contains)' : 'Exact value'}</label>
              <input value={searchValue} onChange={e => { setSearchValue(e.target.value); resetSearch(); }} className="input"
                placeholder={mode === 'contains' ? 'e.g. k  (finds 60k, 150K, “60k mi”…)' : 'Hodna'} />
            </div>
          </div>
        )}

        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
          <Database size={13} className="mt-0.5 flex-shrink-0" />
          {matchBlank ? 'Blank = missing or empty value across the selected fields.'
            : mode === 'contains' ? 'Contains = case-insensitive search across every selected field.'
            : 'Exact match (case-sensitive) across every selected field.'}
          {' '}Click a value in the results to replace it precisely. Every change is revertible below.
        </p>

        <Button variant="secondary" onClick={runSearch} disabled={!canSearch || busy} className="flex items-center gap-1.5">
          {busy && !confirm ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} {matchBlank ? 'Find blanks' : (mode === 'contains' ? 'Search' : 'Preview')}
        </Button>

        {/* Per-field results */}
        {preview && (
          <div className="space-y-2">
            <p className="text-sm font-bold" style={{ color: preview.grand_total ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)' }}>
              {preview.grand_total} total match{preview.grand_total === 1 ? '' : 'es'} across {preview.results.length} field{preview.results.length === 1 ? '' : 's'}
            </p>
            {preview.results.map(res => <FieldResult key={res.field} res={res} />)}
          </div>
        )}

        {/* Replace target */}
        {target && (
          <div className="rounded-xl p-3 space-y-3" style={{ border: '2px solid var(--color-primary-300)', backgroundColor: 'var(--color-primary-50)' }}>
            <p className="text-sm font-bold" style={{ color: 'var(--color-primary-700)' }}>
              {target.matchBlank ? <>Fill blanks in <strong>{target.label}</strong></> : <>Replace {fromLabel} in <strong>{target.label}</strong></>}
            </p>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{target.matchBlank ? 'Fill with' : 'Correct value'}</label>
              <input value={newValue} onChange={e => { setNewValue(e.target.value); setResult(null); }} className="input" placeholder="Honda" autoFocus />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => { setAck(false); setConfirm(true); }} disabled={!canRun || busy} className="flex items-center gap-1.5">
                <Eraser size={15} /> {target.matchBlank ? 'Fill all' : 'Replace all'}
              </Button>
              <Button variant="secondary" onClick={() => { setTarget(null); setNewValue(''); }} disabled={busy}>Cancel</Button>
            </div>
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
      {confirm && target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
            <h3 className="text-lg font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--color-error-600)' }}>
              <AlertTriangle size={18} /> Are you sure?
            </h3>
            <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
              {target.matchBlank ? <>Fill blank record(s)</> : <>Replace <strong>{fromLabel}</strong> with <strong>“{newValue}”</strong></>}
              {' '}in <strong>{target.label}</strong>. You can revert this from the history.
            </p>
            <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>I understand this changes the data.</span>
            </label>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => { setConfirm(false); setAck(false); }} className="flex-1" disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={execute} disabled={!ack || busy} className="flex-1 flex items-center justify-center gap-1.5">
                {busy ? <><Loader2 size={15} className="animate-spin" /> Working…</> : <>{target.matchBlank ? 'Fill' : 'Replace'}</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataCleanup;
