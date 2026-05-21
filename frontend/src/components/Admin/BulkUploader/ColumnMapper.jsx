import { ArrowRight } from 'lucide-react';
import { Button, Alert } from '../../UI';

// Renders one mapping row per target field. `fields` is built dynamically from
// the control fields + the live form config, so new form-builder fields appear
// here automatically.
const Row = ({ f, mapping, setMap, headers }) => (
  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-2">
    <div>
      <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        {f.label}{f.required && <span style={{ color: '#ef4444' }}> *</span>}
        {f.isPhone && <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded font-bold" style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>CLI</span>}
      </span>
      {f.desc && <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{f.desc}</p>}
    </div>
    <ArrowRight size={15} className="hidden sm:block mx-auto" style={{ color: 'var(--color-text-tertiary)' }} />
    <select value={mapping[f.key] || ''} onChange={e => setMap(f.key, e.target.value)} className="input">
      <option value="">— Not in file —</option>
      {headers.map(h => <option key={h} value={h}>{h}</option>)}
    </select>
  </div>
);

const ColumnMapper = ({ fields, headers, mapping, setMap, onContinue, onBack, error, busy }) => {
  const control = fields.filter(f => f.control);
  const dynamic = fields.filter(f => !f.control);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Map your columns</h3>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
          Match each system field to a column from your file. Form fields below come from your form configuration —
          new fields appear here automatically. Saved globally and reused next time.
        </p>
      </div>

      {error && <Alert type="error" message={error} />}

      <div className="rounded-2xl p-4 space-y-2.5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>Transfer details</p>
        {control.map(f => <Row key={f.key} f={f} mapping={mapping} setMap={setMap} headers={headers} />)}
      </div>

      <div className="rounded-2xl p-4 space-y-2.5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>
          Form fields ({dynamic.length}) — from your form configuration
        </p>
        {dynamic.length === 0
          ? <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No fronter form fields configured.</p>
          : dynamic.map(f => <Row key={f.key} f={f} mapping={mapping} setMap={setMap} headers={headers} />)}
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onBack} className="flex-1">Back</Button>
        <Button variant="primary" onClick={onContinue} disabled={busy} className="flex-1">{busy ? 'Validating…' : 'Validate rows'}</Button>
      </div>
    </div>
  );
};

export default ColumnMapper;
