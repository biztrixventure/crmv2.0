import { useState } from 'react';
import { Workflow, AlertTriangle, Info, Plus, Trash2, ChevronUp, ChevronDown, GripVertical } from 'lucide-react';
import { clearTransferStatusCache } from '../../../hooks/useTransferStatuses';
import ThemedSelect from '../../UI/Select';

/*
 * TransferStatusRules
 *
 * Admin UI for transfer.status_catalog. Mirrors ComplianceRules in shape but
 * trimmed for the transfer lifecycle: no editable_by_compliance flag, no
 * category bucket (transfer flow is linear). SuperAdmin can:
 *   - rename labels (display only — sales/reports still write the raw key)
 *   - change badge color
 *   - disable a status (hides from new filter pills, existing rows still render)
 *   - reorder pills with up/down
 *   - add a new status (auto-slugified key)
 */

const Section = ({ title, desc, accent = 'primary', children }) => (
  <section
    className="rounded-2xl mb-4 overflow-hidden"
    style={{
      backgroundColor: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderTop: `3px solid var(--color-${accent}-500, #6366f1)`,
    }}
  >
    <div className="p-5">
      <h2 className="text-base font-bold text-text mb-1">{title}</h2>
      {desc && <p className="text-xs text-text-secondary mb-4 max-w-2xl leading-relaxed">{desc}</p>}
      {children}
    </div>
  </section>
);

const FALLBACK_CATALOG = [
  { key: 'pending',   label: 'Pending',   badge: 'warning',   enabled: true },
  { key: 'assigned',  label: 'Assigned',  badge: 'info',      enabled: true },
  { key: 'completed', label: 'Completed', badge: 'success',   enabled: true },
  { key: 'rejected',  label: 'Rejected',  badge: 'error',     enabled: true },
  { key: 'cancelled', label: 'Cancelled', badge: 'secondary', enabled: true },
];

const BADGE_OPTIONS = [
  { v: 'success',   label: 'Success (green)' },
  { v: 'error',     label: 'Error (red)' },
  { v: 'warning',   label: 'Warning (amber)' },
  { v: 'info',      label: 'Info (blue)' },
  { v: 'primary',   label: 'Primary (brand)' },
  { v: 'secondary', label: 'Secondary (grey)' },
];

const BADGE_DOT = {
  success:   '#16a34a',
  error:     '#dc2626',
  warning:   '#d97706',
  info:      '#2563eb',
  primary:   '#6366f1',
  secondary: '#6b7280',
};

const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

const TransferStatusRules = ({ config, scope, onSave }) => {
  const stored = config?.['transfer.status_catalog'];
  const catalog = Array.isArray(stored) && stored.length ? stored : FALLBACK_CATALOG;

  const persistCatalog = (next) => {
    onSave('transfer.status_catalog', next);
    clearTransferStatusCache();
  };

  const updateRow = (idx, patch) => {
    const next = catalog.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    persistCatalog(next);
  };
  const removeRow = (idx) => {
    const row = catalog[idx];
    if (!window.confirm(
      `Remove status "${row.label || row.key}"?\n\nExisting transfers with this status keep rendering via the runtime fallback. They just stop being selectable in new filter pills until you add the key back.`,
    )) return;
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
    if (!key || catalog.some((s) => s.key === key)) return;
    persistCatalog([...catalog, { key, label, badge: 'info', enabled: true }]);
    setNewLabel('');
  };

  return (
    <div className="max-w-3xl pb-8">
      {scope !== 'global' && (
        <div
          className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{
            backgroundColor: 'var(--color-warning-50, #fffbeb)',
            border: '1px solid var(--color-warning-300, #fcd34d)',
          }}
        >
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>
              Per-company override active
            </p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>
              Changes here apply only to the selected company.
            </p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-xl font-bold text-text mb-1 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
          <Workflow size={20} className="text-primary-600" /> Transfer Lifecycle
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Controls the transfer status pills that appear in the Manager and Staff shells. Statuses follow the
          fronter→closer handoff flow: <strong>Pending</strong> (fronter created, no closer yet) →{' '}
          <strong>Assigned</strong> (closer working) → <strong>Completed</strong> (sale created), with{' '}
          <strong>Rejected</strong> and <strong>Cancelled</strong> as off-ramps.
        </p>
      </div>

      <Section
        accent="primary"
        title="Transfer status catalog"
        desc="Add, edit, reorder, or remove the statuses that appear in the transfer filter pills. Each entry has a label (what users see), a badge color, and an enabled flag. Disabled statuses stay valid for existing records but disappear from new filter pills."
      >
        <div className="space-y-1.5">
          {catalog.map((s, i) => (
            <div
              key={s.key + ':' + i}
              className="rounded-xl overflow-hidden"
              style={{
                backgroundColor: s.enabled === false ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderLeft: `3px solid ${BADGE_DOT[s.badge] || '#6b7280'}`,
                opacity: s.enabled === false ? 0.6 : 1,
              }}
            >
              <div className="flex items-center gap-2 p-2.5 flex-wrap">
                <GripVertical size={13} style={{ color: 'var(--color-text-tertiary)' }} className="flex-shrink-0" />

                {/* Key — locked after creation. */}
                <div className="flex flex-col" style={{ minWidth: 110 }}>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary">Key</span>
                  <code
                    className="text-xs font-mono px-1 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}
                  >
                    {s.key}
                  </code>
                </div>

                {/* Label */}
                <div className="flex flex-col flex-1 min-w-[120px]">
                  <label className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary">Label</label>
                  <input
                    type="text"
                    value={s.label || ''}
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                    placeholder="Display label"
                    className="input text-xs py-1"
                  />
                </div>

                {/* Badge color */}
                <div className="flex flex-col" style={{ minWidth: 140 }}>
                  <label className="text-[9px] font-bold uppercase tracking-wider text-text-tertiary">Badge color</label>
                  <ThemedSelect
                    value={s.badge || 'secondary'}
                    onChange={(e) => updateRow(i, { badge: e.target.value })}
                    className="input text-xs py-1"
                  >
                    {BADGE_OPTIONS.map((o) => (
                      <option key={o.v} value={o.v}>{o.label}</option>
                    ))}
                  </ThemedSelect>
                </div>

                {/* Enabled toggle */}
                <label className="inline-flex items-center gap-1.5 cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={s.enabled !== false}
                    onChange={(e) => updateRow(i, { enabled: e.target.checked })}
                  />
                  <span className="text-[10px] font-semibold text-text-secondary">Enabled</span>
                </label>

                {/* Move */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => moveRow(i, -1)}
                    disabled={i === 0}
                    aria-label="Move status up"
                    title="Move up"
                    className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30"
                    style={{ minWidth: 26, minHeight: 26 }}
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveRow(i, 1)}
                    disabled={i === catalog.length - 1}
                    aria-label="Move status down"
                    title="Move down"
                    className="p-1 rounded hover:bg-bg-secondary disabled:opacity-30"
                    style={{ minWidth: 26, minHeight: 26 }}
                  >
                    <ChevronDown size={12} />
                  </button>
                </div>

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  title="Remove status (existing rows keep rendering via the fallback)"
                  aria-label="Remove status"
                  className="p-1.5 rounded-lg hover:bg-error-50 flex-shrink-0"
                  style={{ minWidth: 30, minHeight: 30, border: '1px solid #fecaca' }}
                >
                  <Trash2 size={12} style={{ color: '#dc2626' }} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add new status */}
        <div
          className="flex items-center gap-2 mt-3 p-3 rounded-xl"
          style={{
            backgroundColor: 'var(--color-primary-50, #eef2ff)',
            border: '1px dashed var(--color-primary-300, #c7d2fe)',
          }}
        >
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addRow(); }}
            placeholder="New status label (e.g. On hold)"
            aria-label="New status label"
            className="input text-sm py-2 flex-1"
          />
          <span
            className="text-[10px] font-mono px-2 py-1 rounded whitespace-nowrap"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}
          >
            key: <strong>{slugify(newLabel) || '—'}</strong>
          </span>
          <button
            type="button"
            onClick={addRow}
            disabled={!newLabel.trim() || catalog.some((s) => s.key === slugify(newLabel))}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--gradient-sidebar)', minHeight: 36 }}
          >
            <Plus size={13} /> Add status
          </button>
        </div>

        <p className="text-xs text-text-tertiary mt-3 flex items-start gap-1.5 leading-relaxed">
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          The status <code>key</code> is the raw value stored in <code>transfers.status</code> and cannot be changed
          after creation. Existing rows always render with a sane label even if you remove the key from the catalog
          (fallback labels live in the frontend). The default five (<code>pending</code>, <code>assigned</code>,{' '}
          <code>completed</code>, <code>rejected</code>, <code>cancelled</code>) are referenced by the backend
          transfer routes — disabling them only hides the filter pill; the lifecycle still uses those keys.
        </p>
      </Section>
    </div>
  );
};

export default TransferStatusRules;
