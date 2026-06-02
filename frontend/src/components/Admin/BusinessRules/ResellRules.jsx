import { useState } from 'react';
import { RefreshCw, Check, X, Plus, Trash2, Info, AlertTriangle, RotateCcw } from 'lucide-react';

// ── Reference data ──────────────────────────────────────────────────────────
const ALL_SALE_STATUSES = [
  { key: 'cancelled',            label: 'Cancelled',            danger: false },
  { key: 'compliance_cancelled', label: 'Compliance Cancelled', danger: false },
  { key: 'closed_won',           label: 'Closed Won (Sold)',    danger: false },
  { key: 'sold',                 label: 'Sold (legacy)',        danger: false },
  { key: 'closed_lost',          label: 'Closed Lost',          danger: false },
  { key: 'expired',              label: 'Expired',              danger: false },
  { key: 'chargeback',           label: 'Chargeback',           danger: true  },
  { key: 'dispute',              label: 'Dispute',              danger: true  },
];

const ATTRIBUTION_OPTS = [
  { key: 'closer',   label: 'Closer keeps full credit',   detail: 'Original fronter sees nothing extra' },
  { key: 'fronter',  label: 'Fronter retains credit',     detail: 'Closer logged as actor only' },
  { key: 'split',    label: 'Split 50/50',                detail: 'Both attributed half a sale' },
];

const INTENT_EMPHASIS = [
  { key: 'warn',  label: 'Warning (amber)' },
  { key: 'info',  label: 'Info (neutral)' },
  { key: 'muted', label: 'Muted (grey)' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
const cfg = (config, key, fallback) => (config?.[key] !== undefined ? config[key] : fallback);

// ── Sub-components ──────────────────────────────────────────────────────────

/* Section card — consistent visual rhythm across all settings.
   Layout: title + description on left, control area on right. Uses 4/8 spacing
   rhythm + readable line-length. Border-top accent reinforces the section
   color so the eye can skim. */
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

/* Checkbox row — meets 44pt touch target via py-2 + min-h-[44px]. */
const CheckboxRow = ({ checked, onChange, label, sub, danger, locked, onResetOverride, isOverridden }) => (
  <label
    className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]"
    style={{ opacity: locked ? 0.55 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={locked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
      style={{ accentColor: danger ? 'var(--color-error-600)' : 'var(--color-primary-600)' }}
      aria-label={label}
    />
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-text">{label}</span>
        {danger && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide"
            style={{ backgroundColor: 'var(--color-warning-100, #fef3c7)', color: 'var(--color-warning-700, #b45309)' }}>
            Risky
          </span>
        )}
        {isOverridden && (
          <button type="button" onClick={(e) => { e.preventDefault(); onResetOverride?.(); }}
            title="Reset to global default"
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', color: 'var(--color-warning-700, #b45309)' }}>
            <RotateCcw size={10} /> Override
          </button>
        )}
      </div>
      {sub && <p className="text-xs text-text-tertiary mt-0.5">{sub}</p>}
    </div>
  </label>
);

/* Radio group — block layout so each option has full-row hit area. */
const RadioGroup = ({ value, onChange, options, name }) => (
  <div role="radiogroup" aria-label={name} className="space-y-1.5">
    {options.map(opt => (
      <label
        key={opt.key}
        className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]"
        style={{
          border: '1px solid',
          borderColor: value === opt.key ? 'var(--color-primary-400, #818cf8)' : 'var(--color-border)',
          backgroundColor: value === opt.key ? 'var(--color-primary-50, #eef2ff)' : 'transparent',
        }}
      >
        <input
          type="radio"
          name={name}
          checked={value === opt.key}
          onChange={() => onChange(opt.key)}
          className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
          style={{ accentColor: 'var(--color-primary-600)' }}
        />
        <div className="flex-1">
          <p className="text-sm font-semibold text-text">{opt.label}</p>
          {opt.detail && <p className="text-xs text-text-tertiary mt-0.5">{opt.detail}</p>}
        </div>
      </label>
    ))}
  </div>
);

/* Numeric input w/ unit suffix. */
const NumberInput = ({ value, onChange, unit, min = 0, max = 999, helper }) => (
  <div>
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        min={min} max={max}
        className="input text-sm py-2 w-24 text-right tabular-nums"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      />
      <span className="text-sm text-text-secondary">{unit}</span>
    </div>
    {helper && <p className="text-xs text-text-tertiary mt-1.5 max-w-md leading-relaxed">{helper}</p>}
  </div>
);

// ── Main page ────────────────────────────────────────────────────────────────
const ResellRules = ({ config, scope, onSave, onResetOverride }) => {
  const enabledStatuses = cfg(config, 'resell.enabled_statuses', []);
  const warningStatuses = cfg(config, 'resell.warning_statuses', []);
  const intents         = cfg(config, 'resell.intents', []);
  const confirmPrompt   = cfg(config, 'resell.confirm_prompt', '');
  const cooldownDays    = cfg(config, 'resell.cooldown_days', 7);
  const hideFronter     = cfg(config, 'resell.hide_from_fronter', true);
  const hideFrManager   = cfg(config, 'resell.hide_from_fronter_manager', true);
  const hideCompliance  = cfg(config, 'resell.hide_from_compliance', false);
  const attribution     = cfg(config, 'resell.attribution', 'closer');
  const autoBlockCb     = cfg(config, 'resell.auto_block_after_chargebacks', 2);
  const requireReason   = cfg(config, 'resell.require_reason_text', false);

  const [newIntent, setNewIntent] = useState('');

  const toggleStatus = (which, statusKey) => {
    const set = which === 'enabled' ? [...enabledStatuses] : [...warningStatuses];
    const i = set.indexOf(statusKey);
    if (i >= 0) set.splice(i, 1); else set.push(statusKey);
    onSave(`resell.${which}_statuses`, set);
  };

  const updateIntent = (idx, patch) => {
    const next = [...intents];
    next[idx] = { ...next[idx], ...patch };
    onSave('resell.intents', next);
  };

  const removeIntent = (idx) => {
    if (!window.confirm('Remove this intent option?')) return;
    onSave('resell.intents', intents.filter((_, i) => i !== idx));
  };

  const addIntent = () => {
    const label = newIntent.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
    if (!key || intents.some(i => i.key === key)) return;
    onSave('resell.intents', [...intents, { key, label, emphasis: 'info' }]);
    setNewIntent('');
  };

  return (
    <div className="max-w-3xl pb-8">
      {/* Scope banner — high-contrast warning when editing per-company so user
          knows changes don't apply globally. */}
      {scope !== 'global' && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>
              Per-company override active
            </p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>
              Changes here apply only to the selected company. Unchecked items fall back to the global defaults.
            </p>
          </div>
        </div>
      )}

      {/* Page intro */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-text mb-1 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
          <RefreshCw size={20} className="text-primary-600" /> Resell &amp; Re-engagement
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Controls how closers resell to existing customers. Resells create a new sale on the same transfer, preserving the original fronter attribution. These rules govern visibility, attribution, and safety failsafes.
        </p>
      </div>

      {/* ── 1. When can closers resell ─────────────────────────────────── */}
      <Section
        accent="primary"
        title="When can closers resell?"
        desc="Resell button appears on the sale drawer only when the sale is in one of these statuses. Risky statuses (chargeback, dispute) require manager confirmation if enabled."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {ALL_SALE_STATUSES.map(s => (
            <CheckboxRow
              key={s.key}
              checked={enabledStatuses.includes(s.key)}
              onChange={() => toggleStatus('enabled', s.key)}
              label={s.label}
              danger={s.danger}
              sub={s.danger ? 'Customer history flagged — confirm reason' : null}
            />
          ))}
        </div>

        <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="text-xs font-bold uppercase tracking-wide text-text-secondary mb-2 flex items-center gap-1.5">
            <AlertTriangle size={12} /> Statuses that require a written reason
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            {ALL_SALE_STATUSES.filter(s => s.danger).map(s => (
              <CheckboxRow
                key={s.key}
                checked={warningStatuses.includes(s.key)}
                onChange={() => toggleStatus('warning', s.key)}
                label={s.label}
                danger
              />
            ))}
          </div>
        </div>
      </Section>

      {/* ── 2. Intent dropdown ────────────────────────────────────────── */}
      <Section
        accent="info"
        title="Resell intent options"
        desc="The dropdown shown on the confirm modal. Each intent labels the new sale for analytics ('Resell' vs 'Additional car' vs 'Renewal'). Add custom intents as your business evolves."
      >
        <div className="space-y-2">
          {intents.map((intent, idx) => (
            <div key={intent.key + idx}
              className="flex items-center gap-2 p-2.5 rounded-lg"
              style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded font-bold"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-tertiary)' }}>
                {intent.key}
              </span>
              <input
                type="text"
                value={intent.label}
                onChange={(e) => updateIntent(idx, { label: e.target.value })}
                className="input text-sm py-1.5 flex-1"
                aria-label={`Intent label for ${intent.key}`}
              />
              <select
                value={intent.emphasis || 'info'}
                onChange={(e) => updateIntent(idx, { emphasis: e.target.value })}
                className="input text-xs py-1.5 w-32"
                aria-label={`Emphasis for ${intent.key}`}
              >
                {INTENT_EMPHASIS.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
              </select>
              <button
                type="button"
                onClick={() => removeIntent(idx)}
                className="p-2 rounded-lg hover:bg-error-50 transition-colors"
                aria-label={`Remove intent ${intent.label}`}
                style={{ minWidth: 36, minHeight: 36 }}
              >
                <Trash2 size={14} style={{ color: 'var(--color-error-600)' }} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <input
            type="text"
            value={newIntent}
            onChange={(e) => setNewIntent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addIntent(); }}
            placeholder="New intent label (e.g. Coverage upgrade)"
            className="input text-sm py-2 flex-1"
            aria-label="New intent label"
          />
          <button
            type="button"
            onClick={addIntent}
            disabled={!newIntent.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'var(--gradient-sidebar)', minHeight: 40 }}
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </Section>

      {/* ── 3. Confirmation prompt ────────────────────────────────────── */}
      <Section
        accent="warning"
        title="Confirmation prompt"
        desc="Shown in the modal before the resell is committed. Mandatory failsafe — closers can't bypass."
      >
        <textarea
          value={confirmPrompt}
          onChange={(e) => onSave('resell.confirm_prompt', e.target.value)}
          rows={3}
          className="input text-sm py-2 w-full font-mono leading-relaxed"
          aria-label="Confirmation prompt"
        />
        <p className="text-xs text-text-tertiary mt-2 leading-relaxed flex items-start gap-1.5">
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          Use clear, concrete language. State what happens to the old policy and what happens next.
        </p>
      </Section>

      {/* ── 4. Cooldown ────────────────────────────────────────────────── */}
      <Section
        accent="warning"
        title="Cooldown between resells"
        desc="Minimum days between resells on the same sale. Prevents accidental double-clicks and inflated stats."
      >
        <NumberInput
          value={cooldownDays}
          onChange={(v) => onSave('resell.cooldown_days', v)}
          unit="days"
          min={0}
          max={365}
          helper="0 = no cooldown. Recommended: 7 days for warranty workflows."
        />
      </Section>

      {/* ── 5. Privacy ─────────────────────────────────────────────────── */}
      <Section
        accent="error"
        title="Privacy — who sees resells?"
        desc="Fronters get credit for the original lead, not the resell. Hiding resell rows from fronter views protects KPI integrity and avoids surprising attribution disputes."
      >
        <div className="space-y-1">
          <CheckboxRow
            checked={hideFronter}
            onChange={(v) => onSave('resell.hide_from_fronter', v)}
            label="Hide resells from fronters"
            sub="Original fronter sees only their first sale on the lead"
          />
          <CheckboxRow
            checked={hideFrManager}
            onChange={(v) => onSave('resell.hide_from_fronter_manager', v)}
            label="Hide resells from fronter managers"
            sub="Fronter company's manager dashboard excludes resells"
          />
          <CheckboxRow
            checked={hideCompliance}
            onChange={(v) => onSave('resell.hide_from_compliance', v)}
            label="Hide resells from compliance"
            sub="Not recommended — compliance needs full audit visibility"
            danger
          />
        </div>
      </Section>

      {/* ── 6. Attribution ─────────────────────────────────────────────── */}
      <Section
        accent="success"
        title="Attribution model"
        desc="Who gets the sale count credit when a resell closes. Affects closer + fronter dashboards and conversion-rate calculations."
      >
        <RadioGroup
          name="attribution"
          value={attribution}
          onChange={(v) => onSave('resell.attribution', v)}
          options={ATTRIBUTION_OPTS}
        />
      </Section>

      {/* ── 7. Auto-block ──────────────────────────────────────────────── */}
      <Section
        accent="error"
        title="Auto-block after repeated chargebacks"
        desc="Prevents endless resell loops on customers who keep disputing charges. After this many chargebacks, the customer becomes resell-blocked and only a manager can override."
      >
        <NumberInput
          value={autoBlockCb}
          onChange={(v) => onSave('resell.auto_block_after_chargebacks', v)}
          unit="chargebacks"
          min={0}
          max={20}
          helper="0 = never auto-block. 2 = block after 2 chargebacks on the same customer."
        />
      </Section>

      {/* ── 8. Require reason ──────────────────────────────────────────── */}
      <Section
        accent="primary"
        title="Reason text"
        desc="Force closers to type a short explanation alongside the intent. Improves audit log quality but adds friction to the workflow."
      >
        <CheckboxRow
          checked={requireReason}
          onChange={(v) => onSave('resell.require_reason_text', v)}
          label="Require closer to type a reason"
          sub="Otherwise reason field is optional"
        />
      </Section>
    </div>
  );
};

export default ResellRules;
