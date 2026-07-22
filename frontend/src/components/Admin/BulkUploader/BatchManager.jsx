import { useEffect, useState } from 'react';
import { Trash2, Database, AlertTriangle, Download, MoreVertical, DownloadCloud, ShieldAlert } from 'lucide-react';
import { Button } from '../../UI';
import { useAuth } from '../../../contexts/AuthContext';

const fmt = (d) => { try { return new Date(d).toLocaleString(); } catch { return '—'; } };

// Single batch → one acknowledgement. Delete-all → THREE explicit steps, each
// spelling out exactly what is about to happen.
const ConfirmModal = ({ target, batchCount, onClose, onConfirm }) => {
  const isAll = target.type === 'all';
  const [step, setStep] = useState(1);
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);

  const go = async () => { setWorking(true); try { await onConfirm(); onClose(); } finally { setWorking(false); } };

  const Shell = ({ children }) => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="w-full max-w-md p-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        {children}
      </div>
    </div>
  );

  // ── single batch ──────────────────────────────────────────────────────────
  if (!isAll) {
    const count = target.batch.inserted_count;
    return (
      <Shell>
        <h3 className="text-lg font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--color-error-600)' }}>
          <AlertTriangle size={18} /> Delete batch
        </h3>
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          This permanently deletes batch “{target.batch.file_name || 'upload'}”{count != null && <> ({count} record{count !== 1 ? 's' : ''})</>}. Linked records created by this upload are also removed. Manually-created records are never touched. This cannot be undone.
        </p>
        <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
          <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>I understand this is permanent.</span>
        </label>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="danger" onClick={go} disabled={!ack || working} className="flex-1">{working ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </Shell>
    );
  }

  // ── delete ALL — three steps ───────────────────────────────────────────────
  return (
    <Shell>
      <h3 className="text-lg font-bold mb-1 flex items-center gap-2" style={{ color: 'var(--color-error-600)' }}>
        <ShieldAlert size={18} /> Delete ALL bulk data — step {step} of 3
      </h3>

      {step === 1 && (
        <>
          <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            You are about to <strong style={{ color: 'var(--color-error-600)' }}>permanently delete every one of the {batchCount} uploaded batch{batchCount !== 1 ? 'es' : ''}</strong> and all the records they created. Linked sales/transfers are removed with them. Manually-created records are <strong>never</strong> touched. There is <strong>no undo</strong>.
          </p>
          <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
            <span className="text-sm" style={{ color: 'var(--color-text)' }}>I understand this deletes everything and cannot be undone.</span>
          </label>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
            <Button variant="danger" onClick={() => setStep(2)} disabled={!ack} className="flex-1">Continue</Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            Second check. This removes <strong>{batchCount} batch{batchCount !== 1 ? 'es' : ''}</strong> and all of their data immediately, with no recovery. To prove you mean it, type <strong style={{ color: 'var(--color-error-600)' }}>DELETE</strong> below.
          </p>
          <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} placeholder="Type DELETE" className="input text-sm mb-5" />
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => { setStep(1); setTyped(''); }} className="flex-1">Back</Button>
            <Button variant="danger" onClick={() => setStep(3)} disabled={typed.trim().toUpperCase() !== 'DELETE'} className="flex-1">Continue</Button>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
            Final confirmation. Clicking the button below will <strong style={{ color: 'var(--color-error-600)' }}>permanently delete all {batchCount} bulk uploads and their records</strong> right now. This is your last chance to stop.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(2)} className="flex-1">Back</Button>
            <Button variant="danger" onClick={go} disabled={working} className="flex-1">{working ? 'Deleting…' : 'Permanently delete all'}</Button>
          </div>
        </>
      )}
    </Shell>
  );
};

const BatchManager = ({ batches, loadBatches, deleteBatch, deleteAllBatches, downloadBatch, downloadAllBatches }) => {
  const { roCan } = useAuth();
  // A readonly_admin with exports disabled must not see batch-download controls
  // (these emit re-uploadable CSVs of uploaded sale/transfer data).
  const canDownload = roCan('can_export');
  const [target, setTarget] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const handleDownload = async (b) => {
    if (!downloadBatch) return;
    setDownloadingId(b.id);
    try { await downloadBatch(b); } finally { setDownloadingId(null); }
  };

  const runDownloadAll = async () => {
    setMenuOpen(false);
    if (!downloadAllBatches) return;
    setBulkBusy(true);
    try { await downloadAllBatches(); } finally { setBulkBusy(false); }
  };

  const hasMenu = (deleteAllBatches || downloadAllBatches) && batches.length > 0;

  return (
    <div className="rounded-2xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h3 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          <Database size={17} style={{ color: 'var(--color-primary-600)' }} /> Uploaded batches
        </h3>

        {hasMenu && (
          <div className="relative">
            <button onClick={() => setMenuOpen(o => !o)} title="More actions"
              className="p-1.5 rounded-lg transition-colors hover:bg-bg-secondary"
              style={{ border: '1px solid var(--color-border)' }}>
              {bulkBusy ? <DownloadCloud size={16} className="animate-pulse" style={{ color: 'var(--color-primary-600)' }} /> : <MoreVertical size={16} style={{ color: 'var(--color-text-secondary)' }} />}
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-40 w-56 rounded-xl overflow-hidden py-1"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
                  {downloadAllBatches && canDownload && (
                    <button onClick={runDownloadAll} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-bg-secondary" style={{ color: 'var(--color-text)' }}>
                      <DownloadCloud size={15} style={{ color: 'var(--color-primary-600)' }} />
                      <span>Download all batches<span className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>One re-uploadable CSV per batch</span></span>
                    </button>
                  )}
                  {deleteAllBatches && (
                    <button onClick={() => { setMenuOpen(false); setTarget({ type: 'all' }); }} className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-error-50" style={{ color: 'var(--color-error-600)' }}>
                      <Trash2 size={15} />
                      <span>Delete all bulk data<span className="block text-[11px]" style={{ color: 'var(--color-error-500)' }}>Removes every batch — asks 3 times</span></span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
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
              <div className="flex items-center gap-1 flex-shrink-0">
                {downloadBatch && canDownload && (
                  <button onClick={() => handleDownload(b)} disabled={downloadingId === b.id}
                    title="Download this batch as a re-uploadable CSV"
                    className="p-1.5 rounded-lg hover:bg-bg-secondary transition-colors disabled:opacity-50">
                    <Download size={15} style={{ color: 'var(--color-primary-600)' }} />
                  </button>
                )}
                <button onClick={() => setTarget({ type: 'batch', batch: b })} title="Delete this batch"
                  className="p-1.5 rounded-lg hover:bg-error-50 transition-colors">
                  <Trash2 size={15} style={{ color: 'var(--color-error-500)' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {target && (
        <ConfirmModal target={target} batchCount={batches.length} onClose={() => setTarget(null)}
          onConfirm={() => target.type === 'all' ? deleteAllBatches() : deleteBatch(target.batch.id)} />
      )}
    </div>
  );
};

export default BatchManager;
