import { useEffect } from 'react';
import { DollarSign, CheckCircle2, RotateCcw } from 'lucide-react';
import { Alert, Button } from '../../UI';
import { useBulkSaleUpload } from './useBulkSaleUpload';
import FileDropzone from '../BulkUploader/FileDropzone';
import UploadProgress from '../BulkUploader/UploadProgress';
import BatchManager from '../BulkUploader/BatchManager';
import SaleFileRequirementsGuide from './SaleFileRequirementsGuide';
import SaleColumnMapper from './SaleColumnMapper';
import SaleValidationSummary from './SaleValidationSummary';

const BulkSaleUploader = () => {
  const u = useBulkSaleUpload();
  useEffect(() => { u.loadReference(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      <div className="rounded-2xl p-6 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center gap-2.5">
          <DollarSign size={22} className="text-white" />
          <div>
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Bulk Sale Uploader</h2>
            <p className="text-sm text-white/80">Import completed sales — matched to transfers and inserted/updated exactly like a closer would.</p>
          </div>
        </div>
        <div className="absolute -right-10 -top-10 w-44 h-44 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, white, transparent 70%)' }} />
      </div>

      {u.error && <Alert type="error" message={u.error} />}
      {u.progress && <UploadProgress progress={u.progress} />}

      {u.step === 'guide' && (
        <>
          <SaleFileRequirementsGuide reference={u.reference} fields={u.fields} formFields={u.formFields} phoneKey={u.phoneKey} />
          <FileDropzone onFile={u.onFile} busy={u.busy} />
        </>
      )}

      {u.step === 'mapping' && (
        <SaleColumnMapper fields={u.fields} headers={u.headers} mapping={u.mapping} setMap={u.setMap}
          onContinue={u.confirmMapping} onBack={u.reset} error={u.error} busy={u.busy} />
      )}

      {u.step === 'review' && (
        <SaleValidationSummary results={u.results} decisions={u.decisions}
          toggleUpdate={u.toggleUpdate} setAllUpdates={u.setAllUpdates}
          onConfirm={u.confirmInsert} onBack={() => u.setStep('mapping')} busy={u.busy} />
      )}

      {u.step === 'done' && u.summary && (
        <div className="rounded-2xl p-8 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-success-200, #bbf7d0)' }}>
          <CheckCircle2 size={44} className="mx-auto mb-3" style={{ color: 'var(--color-success-600)' }} />
          <p className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Upload complete</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {u.summary.inserted} sale{u.summary.inserted !== 1 ? 's' : ''} inserted
            {u.summary.updated > 0 && <> · {u.summary.updated} updated</>}.
            They now appear in the closer, fronter, and compliance dashboards.
          </p>
          <Button variant="primary" onClick={u.reset} className="mt-4 inline-flex items-center gap-1.5"><RotateCcw size={15} /> Upload another file</Button>
        </div>
      )}

      <BatchManager batches={u.batches} loadBatches={u.loadBatches} deleteBatch={u.deleteBatch} />
    </div>
  );
};

export default BulkSaleUploader;
