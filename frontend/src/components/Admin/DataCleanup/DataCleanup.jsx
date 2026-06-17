import { useState, useEffect, useMemo } from 'react';
import { Eraser, Search, AlertTriangle, ArrowRight, CheckCircle2, Loader2, Database } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Alert } from '../../UI';
import client from '../../../api/client';
import { useFormFields } from '../../../hooks/useFormFields';

// Superadmin batch find/replace: pick a configured form field, give the wrong
// value + the corrected value, preview how many rows match, then replace them
// everywhere (transfers.form_data, sales.form_data, and the denormalized sales
// column) in one operation — behind a double confirmation.
const DataCleanup = () => {
  const { fields, fetchFields } = useFormFields();
  useEffect(() => { fetchFields(); }, [fetchFields]);

  const [fieldName, setFieldName] = useState('');
  const [oldValue, setOldValue]   = useState('');
  const [newValue, setNewValue]   = useState('');
  const [preview, setPreview]     = useState(null);   // { counts, total }
  const [busy, setBusy]           = useState(false);
  const [confirm, setConfirm]     = useState(false);   // modal open
  const [ack, setAck]             = useState(false);
  const [result, setResult]       = useState(null);

  const field = useMemo(() => (fields || []).find(f => f.name === fieldName) || null, [fields, fieldName]);

  // Any input change invalidates a prior preview/result so nothing stale is run.
  const resetPreview = () => { setPreview(null); setResult(null); };

  const canPreview = fieldName && oldValue.trim() !== '';
  const canRun = canPreview && newValue.trim() !== '' && oldValue !== newValue && preview && preview.total > 0;

  const runPreview = async () => {
    if (!canPreview) return;
    setBusy(true); setResult(null);
    try {
      const r = await client.post('data-cleanup/preview', {
        field: fieldName, field_type: field?.field_type, old_value: oldValue,
      });
      setPreview(r.data);
      if (!r.data.total) toast.info('No records contain that value — nothing to replace.');
    } catch (e) {
      toast.error(e.response?.data?.error || 'Preview failed');
      setPreview(null);
    } finally { setBusy(false); }
  };

  const execute = async () => {
    setBusy(true);
    try {
      const r = await client.post('data-cleanup/execute', {
        field: fieldName, field_type: field?.field_type, old_value: oldValue, new_value: newValue,
      });
      setResult(r.data);
      setConfirm(false); setAck(false);
      toast.success(`Updated ${r.data.updated} record${r.data.updated === 1 ? '' : 's'}.`);
      setPreview(null);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Update failed');
    } finally { setBusy(false); }
  };

  const Count = ({ label, n }) => (
    <div className="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg"
      style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span className="font-bold" style={{ color: 'var(--color-text)' }}>{n}</span>
    </div>
  );

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <Eraser size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Data Cleanup</h2>
            <p className="text-sm text-white/80">Fix a misspelled or inconsistent value in a form field across the whole database — e.g. “Hodna” → “Honda”.</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-5 space-y-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {/* Field picker */}
        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Form field</label>
          <select value={fieldName} onChange={e => { setFieldName(e.target.value); resetPreview(); }} className="input">
            <option value="">Select a field…</option>
            {(fields || []).map(f => (
              <option key={f.id || f.name} value={f.name}>{f.label || f.name} ({f.name})</option>
            ))}
          </select>
        </div>

        {/* Old → New */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-end gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Wrong value</label>
            <input value={oldValue} onChange={e => { setOldValue(e.target.value); resetPreview(); }} className="input" placeholder="Hodna" />
          </div>
          <ArrowRight size={18} className="mb-2.5 mx-auto hidden sm:block" style={{ color: 'var(--color-text-tertiary)' }} />
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Correct value</label>
            <input value={newValue} onChange={e => { setNewValue(e.target.value); setResult(null); }} className="input" placeholder="Honda" />
          </div>
        </div>

        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>
          <Database size={13} className="mt-0.5 flex-shrink-0" /> Match is exact + case-sensitive. Preview first to see how many records contain the wrong value.
        </p>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={runPreview} disabled={!canPreview || busy} className="flex items-center gap-1.5">
            {busy && !confirm ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Preview
          </Button>
          <Button variant="primary" onClick={() => { setAck(false); setConfirm(true); }} disabled={!canRun || busy} className="flex items-center gap-1.5">
            <Eraser size={15} /> Replace all
          </Button>
        </div>

        {/* Preview result */}
        {preview && (
          <div className="rounded-xl p-3 space-y-1.5" style={{ border: '1px solid var(--color-border)' }}>
            <p className="text-sm font-bold" style={{ color: preview.total ? 'var(--color-primary-700)' : 'var(--color-text-tertiary)' }}>
              {preview.total} record{preview.total === 1 ? '' : 's'} match “{oldValue}” in {field?.label || fieldName}
            </p>
            <Count label="Transfers (form data)" n={preview.counts.transfers_form_data} />
            <Count label="Sales (form data)" n={preview.counts.sales_form_data} />
            {preview.column && <Count label={`Sales · ${preview.column} column`} n={preview.counts.sales_column} />}
          </div>
        )}

        {/* Success */}
        {result && (
          <div className="rounded-xl p-3 flex items-start gap-2" style={{ backgroundColor: 'var(--color-success-50, #f0fdf4)', border: '1px solid var(--color-success-200, #bbf7d0)' }}>
            <CheckCircle2 size={16} style={{ color: 'var(--color-success-600)' }} className="mt-0.5 flex-shrink-0" />
            <div className="text-sm" style={{ color: 'var(--color-success-700, #15803d)' }}>
              <p className="font-bold">Updated {result.updated} record{result.updated === 1 ? '' : 's'}.</p>
              <p className="text-xs mt-0.5">
                Transfers {result.detail.transfers_form_data} · Sales form data {result.detail.sales_form_data}
                {result.column ? ` · Sales ${result.column} ${result.detail.sales_column}` : ''}
              </p>
            </div>
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
              This replaces <strong>“{oldValue}”</strong> with <strong>“{newValue}”</strong> in
              <strong> {field?.label || fieldName}</strong> across <strong>{preview?.total}</strong> record(s)
              ({preview?.counts.transfers_form_data} transfers, {preview?.counts.sales_form_data} sales
              {preview?.column ? `, +${preview?.counts.sales_column} sales ${preview.column}` : ''}). This cannot be undone.
            </p>
            <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>I understand this permanently changes the data.</span>
            </label>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => { setConfirm(false); setAck(false); }} className="flex-1" disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={execute} disabled={!ack || busy} className="flex-1 flex items-center justify-center gap-1.5">
                {busy ? <><Loader2 size={15} className="animate-spin" /> Replacing…</> : <>Replace {preview?.total}</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataCleanup;
