import { useEffect, useState } from 'react';
import { Trash2, Database, AlertTriangle } from 'lucide-react';
import { Button } from '../../UI';

const fmt = (d) => { try { return new Date(d).toLocaleString(); } catch { return '—'; } };

// Double-confirm modal: requires ticking the acknowledgement before Delete enables.
const ConfirmModal = ({ target, onClose, onConfirm }) => {
  const [ack, setAck] = useState(false);
  const [working, setWorking] = useState(false);
  const isAll = target.type === 'all';
  const label = isAll ? 'ALL bulk-uploaded data' : `batch “${target.batch.file_name || 'upload'}”`;
  const count = isAll ? null : target.batch.inserted_count;

  const go = async () => { setWorking(true); try { await onConfirm(); onClose(); } finally { setWorking(false); } };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-md p-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <h3 className="text-lg font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--color-error-600)' }}>
          <AlertTriangle size={18} /> Delete {isAll ? 'everything' : 'batch'}
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          This permanently deletes {label}{count != null && <> ({count} transfer{count !== 1 ? 's' : ''})</>}. Linked sales are also removed. Manually-created records are never touched. This cannot be undone.
        </p>
        <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>I understand this is permanent.</span>
        </label>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="danger" onClick={go} disabled={!ack || working} className="flex-1">{working ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </div>
    </div>
  );
};

const BatchManager = ({ batches, loadBatches, deleteBatch, deleteAllBatches }) => {
  const [target, setTarget] = useState(null);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  return (
    <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h3 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Database size={17} style={{ color: 'var(--color-primary-600)' }} /> Uploaded batches
        </h3>
        {deleteAllBatches && batches.length > 0 && (
          <button onClick={() => setTarget({ type: 'all' })}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--color-error-600)', border: '1px solid var(--color-error-300)' }}>
            <Trash2 size={13} /> Delete all bulk data
          </button>
        )}
      </div>

      {batches.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No bulk uploads yet.</p>
      ) : (
        <div className="space-y-1.5">
          {batches.map(b => (
            <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{b.file_name || 'Upload'}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {b.inserted_count} inserted · {fmt(b.created_at)} · by {b.uploaded_by_name}
                </p>
              </div>
              <button onClick={() => setTarget({ type: 'batch', batch: b })} title="Delete this batch"
                className="p-1.5 rounded-lg hover:bg-error-50 transition-colors flex-shrink-0">
                <Trash2 size={15} style={{ color: 'var(--color-error-500)' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {target && (
        <ConfirmModal target={target} onClose={() => setTarget(null)}
          onConfirm={() => target.type === 'all' ? deleteAllBatches() : deleteBatch(target.batch.id)} />
      )}
    </div>
  );
};

export default BatchManager;
