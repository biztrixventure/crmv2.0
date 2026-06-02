import { Search, Info, AlertTriangle, RotateCcw } from 'lucide-react';

const cfg = (config, key, fallback) => (config?.[key] !== undefined ? config[key] : fallback);

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

const CheckboxRow = ({ checked, onChange, label, sub, danger }) => (
  <label className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
      style={{ accentColor: danger ? 'var(--color-error-600)' : 'var(--color-primary-600)' }}
      aria-label={label}
    />
    <div className="flex-1">
      <span className="text-sm font-semibold text-text">{label}</span>
      {sub && <p className="text-xs text-text-tertiary mt-0.5">{sub}</p>}
    </div>
  </label>
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

const DEDUP_OPTS = [
  { key: 'new_transfer', label: 'Always create a new transfer',  detail: 'Current default — each different fronter gets their own record' },
  { key: 'update',       label: 'Update the existing transfer',  detail: 'Replaces fronter ownership with the latest caller' },
  { key: 'conflict',     label: 'Surface as conflict (manual)',  detail: 'Superadmin must decide on bulk upload' },
];

const CROSS_OPTS = [
  { key: 'new_transfer', label: 'Always new transfer',           detail: 'No cross-company linking' },
  { key: 'warn',         label: 'Warn but allow',                detail: 'Closer sees prior-policy badge from other co' },
  { key: 'block',        label: 'Block, require admin override', detail: 'Strict — same phone never in two cos at once' },
];

const SORT_OPTS = [
  { key: 'updated_at', label: 'Most recently updated first',     detail: 'Re-engaged leads bubble to the top' },
  { key: 'created_at', label: 'Most recently created first',     detail: 'Birth-order — no bubble on update' },
];

const DedupRules = ({ config, scope, onSave }) => {
  const dedupDays      = cfg(config, 'dedup.window_days', 30);
  const sameCo         = cfg(config, 'dedup.different_fronter_same_co', 'new_transfer');
  const crossCo        = cfg(config, 'dedup.cross_company', 'new_transfer');
  const sortBy         = cfg(config, 'search.sort_by', 'updated_at');
  const showStale      = cfg(config, 'search.show_stale', true);
  const applyToBulk    = cfg(config, 'dedup.apply_to_bulk_upload', true);

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
          <Search size={20} className="text-primary-600" /> Dedup &amp; Search
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Controls how the same phone number is handled across calls — within a fronter, across fronters in one company, and across companies. Also tunes how the closer's PhoneSearch sorts results.
        </p>
      </div>

      <Section accent="primary"
        title="Dedup window (same fronter, same company)"
        desc="When a fronter calls the same number again within this window, the existing transfer is updated instead of duplicated. After the window expires, a new transfer is created and counts toward fresh-lead stats.">
        <NumberInput value={dedupDays} onChange={(v) => onSave('dedup.window_days', v)}
          unit="days" helper="0 = always new transfer (no dedup). Recommended: 30 days for warranty workflows." />
      </Section>

      <Section accent="warning"
        title="Different fronter, same company"
        desc="What happens when the SAME phone appears under a DIFFERENT fronter in the same company? The current behavior is to create a separate transfer so each fronter keeps their attribution.">
        <RadioGroup name="diff-fronter-same-co" value={sameCo}
          onChange={(v) => onSave('dedup.different_fronter_same_co', v)} options={DEDUP_OPTS} />
      </Section>

      <Section accent="error"
        title="Cross-company same phone"
        desc="Same phone seen across DIFFERENT companies. Warranty leads frequently exist across clients — usually they're fresh contacts that should not link.">
        <RadioGroup name="cross-co" value={crossCo}
          onChange={(v) => onSave('dedup.cross_company', v)} options={CROSS_OPTS} />
      </Section>

      <Section accent="info"
        title="Closer PhoneSearch — sort priority"
        desc="When closer searches a phone number, which transfer floats to the top of the result list.">
        <RadioGroup name="search-sort" value={sortBy}
          onChange={(v) => onSave('search.sort_by', v)} options={SORT_OPTS} />
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <CheckboxRow checked={showStale} onChange={(v) => onSave('search.show_stale', v)}
            label="Show stale transfers in search"
            sub="Older transfers from other fronters/companies still appear below the priority result" />
        </div>
      </Section>

      <Section accent="success"
        title="Bulk upload"
        desc="Apply the dedup window during bulk transfer uploads too, so re-imported old leads do not bypass the rule.">
        <CheckboxRow checked={applyToBulk} onChange={(v) => onSave('dedup.apply_to_bulk_upload', v)}
          label="Apply the dedup window to bulk uploads"
          sub="When OFF, bulk uploads always insert (and may produce duplicates the manual flow would have merged)" />
      </Section>
    </div>
  );
};

export default DedupRules;
