import { ShieldCheck, AlertTriangle, Info } from 'lucide-react';

const cfg = (config, key, fallback) => (config?.[key] !== undefined ? config[key] : fallback);

const Section = ({ title, desc, accent = 'primary', children }) => (
  <section className="rounded-2xl mb-4 overflow-hidden"
    style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
             borderTop: `3px solid var(--color-${accent}-500, #6366f1)` }}>
    <div className="p-5">
      <h2 className="text-base font-bold text-text mb-1">{title}</h2>
      {desc && <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">{desc}</p>}
      {children}
    </div>
  </section>
);

const RadioGroup = ({ value, onChange, options, name }) => (
  <div role="radiogroup" aria-label={name} className="space-y-1.5">
    {options.map(opt => (
      <label key={opt.key}
        className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]"
        style={{
          border: '1px solid',
          borderColor: value === opt.key ? 'var(--color-primary-400, #818cf8)' : 'var(--color-border)',
          backgroundColor: value === opt.key ? 'var(--color-primary-50, #eef2ff)' : 'transparent',
        }}>
        <input type="radio" name={name} checked={value === opt.key} onChange={() => onChange(opt.key)}
          className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer" style={{ accentColor: 'var(--color-primary-600)' }} />
        <div className="flex-1">
          <p className="text-sm font-semibold text-text">{opt.label}</p>
          {opt.detail && <p className="text-xs text-text-tertiary mt-0.5">{opt.detail}</p>}
        </div>
      </label>
    ))}
  </div>
);

const CheckboxRow = ({ checked, onChange, label, sub, danger }) => (
  <label className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
      className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
      style={{ accentColor: danger ? 'var(--color-error-600)' : 'var(--color-primary-600)' }}
      aria-label={label} />
    <div className="flex-1">
      <span className="text-sm font-semibold text-text">{label}</span>
      {sub && <p className="text-xs text-text-tertiary mt-0.5">{sub}</p>}
    </div>
  </label>
);

const NumberInput = ({ value, onChange, unit, min = 0, max = 365, helper }) => (
  <div>
    <div className="flex items-center gap-2">
      <input type="number" value={value} onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        min={min} max={max}
        className="input text-sm py-2 w-24 text-right tabular-nums"
        style={{ fontVariantNumeric: 'tabular-nums' }} />
      <span className="text-sm text-text-secondary">{unit}</span>
    </div>
    {helper && <p className="text-xs text-text-tertiary mt-1.5 max-w-md leading-relaxed">{helper}</p>}
  </div>
);

const DEFAULT_STATUS_OPTS = [
  { key: 'open',           label: 'Open',           detail: 'Closer can keep editing before pushing to compliance' },
  { key: 'pending_review', label: 'Pending Review', detail: 'Auto-submit — saves a click but loses the draft state' },
];

const RESELL_STATUS_OPTS = [
  { key: 'pending_review', label: 'Pending Review',  detail: 'Fresh compliance pass — safer (recommended)' },
  { key: 'open',           label: 'Open',            detail: 'Closer keeps control until they submit' },
];

const ALL_STATUSES = [
  'open', 'sold', 'cancelled', 'follow_up', 'closed_won', 'closed_lost',
  'pending_review', 'needs_revision', 'compliance_cancelled', 'chargeback',
  'dispute', 'resold', 'expired', 'refunded',
];

const ComplianceRules = ({ config, scope, onSave }) => {
  const defaultStatus  = cfg(config, 'compliance.default_new_sale_status', 'open');
  const resellStatus   = cfg(config, 'compliance.resell_initial_status', 'pending_review');
  const lockDays       = cfg(config, 'compliance.lock_window_days', 90);
  const allowed        = cfg(config, 'compliance.allowed_statuses', [
    'open','sold','cancelled','follow_up','closed_won','closed_lost',
    'pending_review','needs_revision','compliance_cancelled','chargeback','dispute',
  ]);
  const setAllowed = (k, v) => {
    const next = new Set(allowed);
    if (v) next.add(k); else next.delete(k);
    onSave('compliance.allowed_statuses', [...next]);
  };

  return (
    <div className="max-w-3xl pb-8">
      {scope !== 'global' && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>Per-company override active</p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>Changes here apply only to the selected company.</p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-bold text-text mb-1 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
          <ShieldCheck size={20} className="text-primary-600" /> Compliance Workflow
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Controls the lifecycle of a sale from creation through compliance approval. Affects both the closer's experience (default status) and the auditor's audit window.
        </p>
      </div>

      <Section accent="primary" title="Default status for a new sale"
        desc="What status a closer-created sale starts in when no status is explicitly set.">
        <RadioGroup name="default-status" value={defaultStatus}
          onChange={(v) => onSave('compliance.default_new_sale_status', v)} options={DEFAULT_STATUS_OPTS} />
      </Section>

      <Section accent="info" title="Resell — initial status"
        desc="When a resell is created via the new-sale-on-lead flow, this is the status the new row takes.">
        <RadioGroup name="resell-status" value={resellStatus}
          onChange={(v) => onSave('compliance.resell_initial_status', v)} options={RESELL_STATUS_OPTS} />
      </Section>

      <Section accent="warning" title="Compliance lock window"
        desc="Sales older than this cannot be edited by closers or managers (compliance can still review). Provides an audit-safe immutability boundary.">
        <NumberInput value={lockDays} onChange={(v) => onSave('compliance.lock_window_days', v)}
          unit="days" max={730}
          helper="0 = no lock window. Recommended: 90 days. Sales beyond this become read-only outside the compliance role." />
      </Section>

      <Section accent="success" title="Allowed sale statuses"
        desc="Which statuses are valid for sales in this scope. Disabled statuses become unselectable in the UI and rejected by the API.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {ALL_STATUSES.map(s => (
            <CheckboxRow key={s} checked={allowed.includes(s)} onChange={(v) => setAllowed(s, v)}
              label={s.replace(/_/g, ' ')}
              sub={['resold','expired','refunded'].includes(s) ? 'New status — enable when ready' : null} />
          ))}
        </div>
      </Section>
    </div>
  );
};

export default ComplianceRules;
