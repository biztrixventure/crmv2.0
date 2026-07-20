import { useEffect, useState, useMemo } from 'react';
import { X, Save, AlertTriangle, FileText, Layers, Pencil, Eye, EyeOff } from 'lucide-react';
import { Button } from '../UI';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';

/* LeadEditModal — superadmin-only universal editor for transfer / sale /
   callback records. Surfaces every column on the row + lets the user edit
   each field inline. Submits via PUT to the appropriate endpoint.

   Props:
     kind: 'transfers' | 'sales' | 'callbacks'
     record: the row to edit
     onSaved(updated): called with the updated row after PUT succeeds
     onClose
*/
const LABEL = {
  transfers: 'Transfer',
  sales:     'Sale',
  callbacks: 'Callback',
};

// Columns we never let the user touch (FKs, audit columns, etc.). Editing
// these would either break referential integrity or be undone by triggers.
const FROZEN = new Set([
  'id', 'created_at', 'created_by', 'updated_at',
  'company_id', 'transfer_id', 'closer_id', 'fronter_id', 'submitted_by',
  'normalized_phone', 'upload_batch_id', 'edit_history', 'rejection_count',
  'is_resell', 'original_sale_id',
  'last_modified_by', 'rejected_by', 'compliance_reviewed_by',
]);

// JSONB columns get a textarea editor with JSON validation on save.
const JSON_COLS = new Set(['form_data', 'data', 'changes', 'edit_history']);

// Fields rendered as <ThemedSelect> with a fixed list of options. Other fields
// default to <input type=text>.
const ENUMS = {
  transfers: {
    status: ['pending', 'assigned', 'completed', 'cancelled', 'rejected'],
  },
  sales: {
    status: ['open', 'sold', 'cancelled', 'follow_up', 'closed_won', 'closed_lost',
             'pending_review', 'needs_revision', 'compliance_cancelled', 'chargeback',
             'dispute', 'resold', 'expired', 'refunded'],
  },
  callbacks: {
    status:   ['pending', 'completed', 'no_answer', 'answering_machine', 'cancelled'],
    priority: ['Low', 'Medium', 'High'],
  },
};

const dateInputType = (key, value) => {
  if (key.endsWith('_at')) return 'datetime-local';
  if (key.endsWith('_date')) return 'date';
  return null;
};

const toLocalDT = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function LeadEditModal({ kind, record, onSaved, onClose }) {
  const [draft,  setDraft]  = useState({});
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState('');
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    setDraft(record ? { ...record } : {});
    setErr('');
  }, [record?.id]);

  const editableEntries = useMemo(() => {
    if (!record) return [];
    return Object.entries(record)
      .filter(([k]) => !FROZEN.has(k))
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
  }, [record]);

  if (!record) return null;

  const setField = (key, value) => setDraft(d => ({ ...d, [key]: value }));

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      // Build the patch — only changed keys, with type conversions for dates
      // and JSON. Backend PUT handlers accept partial bodies.
      const patch = {};
      for (const [k, v] of editableEntries) {
        let next = draft[k];
        if (next === record[k]) continue;
        // Datetime-local → ISO
        if (dateInputType(k) === 'datetime-local' && next) {
          const d = new Date(next);
          if (!isNaN(d.getTime())) next = d.toISOString();
        }
        // JSON columns
        if (JSON_COLS.has(k) && typeof next === 'string') {
          try { next = JSON.parse(next); }
          catch { throw new Error(`Field "${k}" must be valid JSON`); }
        }
        patch[k] = next;
      }
      if (Object.keys(patch).length === 0) {
        setErr('No changes to save.');
        setBusy(false);
        return;
      }
      const { data } = await client.put(`${kind}/${record.id}`, patch);
      const updated = data?.sale || data?.transfer || data?.callback || data?.data || { ...record, ...patch };
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || e.message || 'Failed to save.');
    } finally { setBusy(false); }
  };

  // Render the right editor for a field type.
  const Field = ({ k, v }) => {
    const enumOpts = ENUMS[kind]?.[k];
    const dtType   = dateInputType(k);

    if (enumOpts) {
      return (
        <ThemedSelect value={draft[k] ?? ''} onChange={(e) => setField(k, e.target.value)}
          className="input text-sm py-1.5 w-full">
          <option value="">—</option>
          {enumOpts.map(o => <option key={o} value={o}>{o}</option>)}
        </ThemedSelect>
      );
    }
    if (dtType === 'datetime-local') {
      return (
        <input type="datetime-local"
          value={toLocalDT(draft[k])}
          onChange={(e) => setField(k, e.target.value)}
          className="input text-sm py-1.5 w-full" />
      );
    }
    if (dtType === 'date') {
      return (
        <input type="date"
          value={draft[k] ? String(draft[k]).slice(0, 10) : ''}
          onChange={(e) => setField(k, e.target.value)}
          className="input text-sm py-1.5 w-full" />
      );
    }
    if (JSON_COLS.has(k)) {
      const str = typeof draft[k] === 'string' ? draft[k] : JSON.stringify(draft[k] || {}, null, 2);
      return (
        <textarea value={str}
          onChange={(e) => setField(k, e.target.value)}
          rows={6}
          className="input text-xs py-1.5 w-full font-mono leading-relaxed" />
      );
    }
    if (typeof v === 'boolean') {
      return (
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!draft[k]} onChange={(e) => setField(k, e.target.checked)} />
          <span>{draft[k] ? 'true' : 'false'}</span>
        </label>
      );
    }
    if (typeof v === 'number') {
      return (
        <input type="number" value={draft[k] ?? ''}
          onChange={(e) => setField(k, e.target.value === '' ? null : Number(e.target.value))}
          className="input text-sm py-1.5 w-full" />
      );
    }
    return (
      <input type="text" value={draft[k] ?? ''}
        onChange={(e) => setField(k, e.target.value)}
        className="input text-sm py-1.5 w-full" />
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-edit-title"
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 'calc(100vh - 32px)' }}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
            style={{ background: 'var(--gradient-sidebar)', borderTopLeftRadius: '1rem', borderTopRightRadius: '1rem' }}>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-white/20">
                <Pencil size={16} className="text-white" />
              </div>
              <div>
                <h2 id="lead-edit-title" className="text-base font-bold text-white">Edit {LABEL[kind] || 'record'}</h2>
                <p className="text-xs text-white/75 font-mono truncate max-w-[320px]">{record.id}</p>
              </div>
            </div>
            <button onClick={onClose} aria-label="Close"
              className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors"
              style={{ minWidth: 36, minHeight: 36 }}>
              <X size={16} className="text-white" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="rounded-xl p-3 mb-4 flex items-start gap-2"
              style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-200, #fde68a)' }}>
              <AlertTriangle size={14} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-warning-700, #b45309)' }}>
                You are editing this {LABEL[kind].toLowerCase()} directly. Audit columns (created_at, created_by, FK relationships) are frozen to preserve integrity. Every change is logged to <code>edit_history</code>.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {editableEntries.map(([k, v]) => {
                if (JSON_COLS.has(k) && !showJson) return null;
                return (
                  <div key={k} className="flex flex-col gap-1">
                    <label className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
                      {k.replace(/_/g, ' ')}
                    </label>
                    <Field k={k} v={v} />
                  </div>
                );
              })}
            </div>

            <button type="button"
              onClick={() => setShowJson(s => !s)}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-1.5 rounded border hover:bg-bg-secondary"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', minHeight: 32 }}>
              {showJson ? <><EyeOff size={11} /> Hide JSON columns</> : <><Eye size={11} /> Show JSON columns (form_data, edit_history…)</>}
            </button>

            {err && (
              <div role="alert" className="mt-3 p-2.5 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)', border: '1px solid var(--color-error-200)' }}>
                {err}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 px-5 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid var(--color-border)' }}>
            <p className="text-xs text-text-tertiary flex-1 inline-flex items-center gap-1.5">
              <Layers size={11} /> {editableEntries.length} editable fields
            </p>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : <><Save size={12} className="mr-1.5" /> Save changes</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
