import { useEffect } from 'react';
import { UploadCloud, CheckCircle2, RotateCcw } from 'lucide-react';
import { Alert, Button } from '../../UI';
import { useBulkUpload } from './useBulkUpload';
import FileRequirementsGuide from './FileRequirementsGuide';
import UploadBestPractices from './UploadBestPractices';
import FileDropzone from './FileDropzone';
import ColumnMapper from './ColumnMapper';
import ValidationSummary from './ValidationSummary';
import UploadProgress from './UploadProgress';
import BatchManager from './BatchManager';
import DuplicateTransferManager from './DuplicateTransferManager';

const BulkUploader = () => {
  const u = useBulkUpload();
  useEffect(() => { u.loadReference(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      {/* Header */}
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <UploadCloud size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Bulk Transfer Uploader</h2>
            <p className="text-sm text-white/80">Import transfers from CSV/Excel — inserted exactly as if the fronter added them.</p>
          </div>
        </div>
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, white, transparent 70%)' }} />
      </div>

      {u.error && <Alert type="error" message={u.error} />}
      {u.progress && <UploadProgress progress={u.progress} />}

      {/* Step 1 — guide + dropzone (the guide is always the first thing visible) */}
      {u.step === 'guide' && (
        <>
          <FileRequirementsGuide reference={u.reference} fields={u.fields} formFields={u.formFields} phoneKey={u.phoneKey} />
          <UploadBestPractices kind="transfer" fields={u.fields} startOpen />
          <FileDropzone onFile={u.onFile} busy={u.busy} />
        </>
      )}

      {/* Step 2 — column mapping */}
      {u.step === 'mapping' && (
        <>
          <UploadBestPractices kind="transfer" fields={u.fields} />
          <ColumnMapper fields={u.fields} headers={u.headers} mapping={u.mapping} setMap={u.setMap}
            onContinue={u.confirmMapping} onBack={u.reset} error={u.error} busy={u.busy} />
        </>
      )}

      {/* Step 3 — validation summary + conflicts */}
      {u.step === 'review' && (
        <ValidationSummary results={u.results} decisions={u.decisions}
          toggleConflict={u.toggleConflict} setAllConflicts={u.setAllConflicts}
          updateDecisions={u.updateDecisions} allowUpdates={u.allowUpdates}
          setAllowUpdates={u.setAllowUpdates}
          toggleUpdate={u.toggleUpdate} setAllUpdates={u.setAllUpdates}
          onConfirm={u.confirmInsert} onBack={() => u.setStep('mapping')} busy={u.busy} />
      )}

      {/* Step 4 — done */}
      {u.step === 'done' && u.summary && (
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-success-200, #bbf7d0)' }}>
          <CheckCircle2 size={44} className="mx-auto mb-3" style={{ color: 'var(--color-success-600)' }} />
          <p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Upload complete</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {u.summary.inserted} transfer{u.summary.inserted !== 1 ? 's' : ''} inserted
            {u.summary.updated > 0 && <> · {u.summary.updated} updated</>}
            {u.summary.unchanged > 0 && <> · {u.summary.unchanged} unchanged</>}
            {u.summary.skipped > 0 && <> · {u.summary.skipped} skipped</>}.
            They now appear in each fronter’s dashboard.
          </p>
          <Button variant="primary" onClick={u.reset} className="mt-4 inline-flex items-center gap-1.5">
            <RotateCcw size={15} /> Upload another file
          </Button>
        </div>
      )}

      {/* Duplicate-transfer cleanup (intelligent merge with full control) */}
      <DuplicateTransferManager duplicates={u.duplicates} loadDuplicates={u.loadDuplicates} mergeDuplicates={u.mergeDuplicates} />

      {/* Batch management / test cleanup (always available) */}
      <BatchManager batches={u.batches} loadBatches={u.loadBatches}
        deleteBatch={u.deleteBatch} deleteAllBatches={u.deleteAllBatches} />
    </div>
  );
};

export default BulkUploader;
