import { ArrowRight } from 'lucide-react';
import { Button, Alert } from '../../UI';
import { SYSTEM_FIELDS } from './columnMapping';

const ColumnMapper = ({ headers, mapping, setMap, onContinue, onBack, error, busy }) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Map your columns</h3>
      <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
        Match each system field to a column from your file. Saved globally and reused next time (you can edit it any upload).
      </p>
    </div>

    {error && <Alert type="error" message={error} />}

    <div className="rounded-2xl p-4 space-y-2.5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      {SYSTEM_FIELDS.map(f => (
        <div key={f.key} className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              {f.label}{f.required && <span style={{ color: '#ef4444' }}> *</span>}
            </span>
            <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{f.desc}</p>
          </div>
          <ArrowRight size={15} className="hidden sm:block mx-auto" style={{ color: 'var(--color-text-tertiary)' }} />
          <select value={mapping[f.key] || ''} onChange={e => setMap(f.key, e.target.value)} className="input">
            <option value="">— Not in file —</option>
            {headers.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      ))}
    </div>

    <div className="flex gap-3">
      <Button variant="secondary" onClick={onBack} className="flex-1">Back</Button>
      <Button variant="primary" onClick={onContinue} disabled={busy} className="flex-1">
        {busy ? 'Validating…' : 'Validate rows'}
      </Button>
    </div>
  </div>
);

export default ColumnMapper;
