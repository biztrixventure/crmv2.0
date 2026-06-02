import { useState } from 'react';
import { ShieldCheck, AlertTriangle, Info, Plus, Trash2, Eye, EyeOff, Pencil, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { clearComplianceStatusCache } from '../../../hooks/useComplianceStatuses';

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

// Same fallback the runtime hook uses so the page is fully functional even
// before the SuperAdmin has saved a custom catalog.
const FALLBACK_CATALOG = [
  { key: 'open',                 label: 'Open',              badge: 'info',      category: 'pending', enabled: true,  editable_by_compliance: true  },
  { key: 'sold',                 label: 'Sold',              badge: 'success',   category: 'won',     enabled: true,  editable_by_compliance: true  },
  { key: 'cancelled',            label: 'Cancelled',         badge: 'error',     category: 'lost',    enabled: true,  editable_by_compliance: true  },
  { key: 'follow_up',            label: 'Follow Up',         badge: 'warning',   category: 'pending', enabled: true,  editable_by_compliance: true  },
  { key: 'closed_won',           label: 'Approved',          badge: 'success',   category: 'won',     enabled: true,  editable_by_compliance: true  },
  { key: 'closed_lost',          label: 'Lost',              badge: 'error',     category: 'lost',    enabled: true,  editable_by_compliance: true  },
  { key: 'pending_review',       label: 'Pending Review',    badge: 'warning',   category: 'pending', enabled: true,  editable_by_compliance: false },
  { key: 'needs_revision',       label: 'Needs Revision',    badge: 'error',     category: 'pending', enabled: true,  editable_by_compliance: false },
  { key: 'compliance_cancelled', label: 'Comp. Cancelled',   badge: 'error',     category: 'lost',    enabled: true,  editable_by_compliance: true  },
  { key: 'chargeback',           label: 'Chargeback',        badge: 'error',     category: 'lost',    enabled: true,  editable_by_compliance: true  },
  { key: 'dispute',              label: 'Dispute',           badge: 'warning',   category: 'pending', enabled: true,  editable_by_compliance: true  },
];

const BADGE_OPTIONS = [
  { v: 'success',   label: 'Success (green)' },
  { v: 'error',     label: 'Error (red)' },
  { v: 'warning',   label: 'Warning (amber)' },
  { v: 'info',      label: 'Info (blue)' },
  { v: 'secondary', label: 'Secondary (grey)' },
];
const CATEGORY_OPTIONS = [
  { v: 'won',     label: 'Won (revenue)' },
  { v: 'lost',    label: 'Lost (no revenue)' },
  { v: 'pending', label: 'Pending (in-flight)' },
  { v: 'neutral', label: 'Neutral' },
];

const BADGE_DOT = {
  success:   '#16a34a', error:     '#dc2626', warning:   '#d97706',
  info:      '#2563eb', secondary: '#6b7280',
};

const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

const ComplianceRules = ({ config, scope, onSave }) => {
  const defaultStatus  = cfg(config, 'compliance.default_new_sale_status', 'open');
  const resellStatus   = cfg(config, 'compliance.resell_initial_status', 'pending_review');
  const lockDays       = cfg(config, 'compliance.lock_window_days', 90);

  // Resolve the status catalog from config. Back-compat: when the new
  // status_catalog key is missing, build one from the legacy allowed_statuses
  // string list so the page still shows the right toggles. Saving in this
  // page always writes the new shape going forward.
  const storedCatalog = config?.['compliance.status_catalog'];
  const legacyAllowed = config?.['compliance.allowed_statuses'];
  let catalog;
  if (Array.isArray(storedCatalog) && storedCatalog.length) {
    catalog = storedCatalog;
  } else if (Array.isArray(legacyAllowed)) {
    const en = new Set(legacyAllowed);
    catalog = FALLBACK_CATALOG.map(s => ({ ...s, enabled: en.has(s.key) }));
  } else {
    catalog = FALLBACK_CATALOG;
  }

  // Mirror enabled keys into compliance.allowed_statuses so existing backend
  // code paths that still read the legacy key keep working without changes.
  const persistCatalog = (next) => {
    onSave('compliance.status_catalog', next);
    onSave('compliance.allowed_statuses', next.filter(s => s.enabled !== false).map(s => s.key));
    clearComplianceStatusCache();
  };

  const updateRow = (idx, patch) => {
    const next = catalog.map((s, i) => i === idx ? { ...s, ...patch } : s);
    persistCatalog(next);
  };
  const removeRow = (idx) => {
    const row = catalog[idx];
    if (!window.confirm(`Remove status "${row.label || row.key}"?\n\nExisting records with this status will still render — the label comes from the runtime fallback. They just won't be selectable in new dropdowns until you add the key back.`)) return;
    persistCatalog(catalog.filter((_, i) => i !== idx));
  };
  const moveRow = (idx, delta) => {
    const ni = idx + delta;
    if (ni < 0 || ni >= catalog.length) return;
    const next = [...catalog];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    persistCatalog(next);
  };

  const [newLabel, setNewLabel] = useState('');
  const addRow = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = slugify(label);
    if (!key || catalog.some(s => s.key === key)) return;
    persistCatalog([...catalog, { key, label, badge: 'info', category: 'pending', enabled: true, editable_by_compliance: true }]);
    setNewLabel('');
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

      <Section accent="success" title="Sale status catalog"
        desc="Add, edit, reorder, or remove the statuses available to compliance. Each entry has a label (what users see), a badge color, and a category that drives reports. Enabled statuses flow into the compliance dropdowns; disabled ones stay valid for legacy records but disappear from new selectors.">
        <div className="space-y-1.5">
          {catalog.map((s, i) => (
            <div key={s.key + ':' + i}
              className="rounded-xl overflow-hidden"
              style={{
                backgroundColor: s.enabled === false ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderLeft: `3px solid ${BADGE_DOT[s.badge] || '#6b7280'}`,
                opacity: s.enabled === false ? 0.6 : 1,
              }}>
              <div className="flex items-center gap-2 p-2.5 flex-wrap">
                <GripVertical size={13} style={{ color: 'var(--color-text-tertiary)' }} className="flex-shrink-0" />

                {/* Key — slug, read-only after creation to keep referential
                    integrity with existing rows. */}
                <div className="flex flex-col" style={{ minWidth: 110 }}>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary">Key</span>
                  <code className="text-xs font-mono px-1 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{s.key}</code>
                </div>

                {/* Label */}
                <div className="flex flex-col flex-1 min-w-[120px]">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary">Label</label>
                  <input type="text" value={s.label || ''}
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                    placeholder="Display label"
                    className="input text-xs py-1" />
                </div>

                {/* Badge color */}
                <div className="flex flex-col" style={{ minWidth: 130 }}>
                  <label className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary">Badge color</label>
                  <select value={s.badge || 'secondary'}
                    onChange={(e) => updateRow(i, { badge: e.target.value })}
                    className="input text-xs py-1">
                    {BADGE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                </div>

                {/* Category */}
                <div className="flex flex-col" style={{ minWidth: 130 }}>
                  <label className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary">Category</label>
                  <select value={s.category || 'neutral'}
                    onChange={(e) => updateRow(i, { category: e.target.value })}
                    className="input text-xs py-1">
                    {CATEGORY_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </select>
                </div>

                {/* Toggles */}
                <div className="flex flex-col gap-1">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={s.enabled !== false}
                      onChange={(e) => updateRow(i, { enabled: e.target.checked })} />
                    <span className="text-[10px] font-semibold text-text-secondary">Enabled</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={s.editable_by_compliance !== false}
                      onChange={(e) => updateRow(i, { editable_by_compliance: e.target.checked })} />
                    <span className="text-[10px] font-semibold text-text-secondary">In edit dialog</span>
                  </label>
                </div>

                {/* Move */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button type="button" onClick={() => moveRow(i, -1)} disabled={i === 0}
                    aria-label="Move status up" title="Move up"
                    className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30"
                    style={{ minWidth: 26, minHeight: 26 }}>
                    <ChevronUp size={12} />
                  </button>
                  <button type="button" onClick={() => moveRow(i, 1)} disabled={i === catalog.length - 1}
                    aria-label="Move status down" title="Move down"
                    className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30"
                    style={{ minWidth: 26, minHeight: 26 }}>
                    <ChevronDown size={12} />
                  </button>
                </div>

                {/* Remove */}
                <button type="button" onClick={() => removeRow(i)}
                  title="Remove status (existing rows keep rendering via the fallback)"
                  aria-label="Remove status"
                  className="p-1.5 rounded-lg hover:bg-error-50 flex-shrink-0"
                  style={{ minWidth: 30, minHeight: 30, border: '1px solid #fecaca' }}>
                  <Trash2 size={12} style={{ color: '#dc2626' }} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add new status */}
        <div className="flex items-center gap-2 mt-3 p-3 rounded-xl"
          style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px dashed var(--color-primary-300, #c7d2fe)' }}>
          <input type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addRow(); }}
            placeholder="New status label (e.g. Coverage gap)"
            aria-label="New status label"
            className="input text-sm py-2 flex-1" />
          <span className="text-[10px] font-mono px-2 py-1 rounded whitespace-nowrap"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
            key: <strong>{slugify(newLabel) || '—'}</strong>
          </span>
          <button type="button" onClick={addRow}
            disabled={!newLabel.trim() || catalog.some(s => s.key === slugify(newLabel))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--gradient-sidebar)', minHeight: 36 }}>
            <Plus size={13} /> Add status
          </button>
        </div>

        <p className="text-xs text-text-tertiary mt-3 flex items-start gap-1.5 leading-relaxed">
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          The status <code>key</code> is the raw value stored in <code>sales.status</code> and is locked after creation. Existing rows always render with a sane label even if the SuperAdmin removes a status from the catalog (fallback labels live in the frontend). Enabled keys are mirrored into <code>compliance.allowed_statuses</code> so the backend validator stays in sync.
        </p>
      </Section>
    </div>
  );
};

export default ComplianceRules;
