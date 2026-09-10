// CloserSearchRules — how the closer's phone search behaves.
//
// These three settings used to live at the bottom of Dedup & Search, and that
// was wrong twice over. They are not duplicate-handling rules — they govern
// what a closer sees when they type a number — and the dedup panel greys its
// entire body out when duplicate handling is switched off, which took the
// search settings down with it. Turning dedup off is a legitimate choice; it
// should not cost you control of the search.
//
// Own tab, always reachable, independent of every other rule.
import { Search } from 'lucide-react';

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

const CheckboxRow = ({ checked, onChange, label, sub }) => (
  <label className="flex items-start gap-3 py-2 px-3 rounded-lg cursor-pointer hover:bg-bg-secondary transition-colors min-h-[44px]">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-1 w-4 h-4 flex-shrink-0 cursor-pointer"
      style={{ accentColor: 'var(--color-primary-600)' }}
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

const SORT_OPTS = [
  { key: 'updated_at', label: 'Most recently updated first', detail: 'Re-engaged leads bubble to the top' },
  { key: 'created_at', label: 'Most recently created first', detail: 'Birth-order — no bubble on update' },
];

const CloserSearchRules = ({ config, scope, onSave }) => {
  const sortBy     = cfg(config, 'search.sort_by', 'updated_at');
  const maxAgeDays = cfg(config, 'search.max_age_days', 0);
  const showHidden = cfg(config, 'search.show_hidden_count', true);

  return (
    <div className="w-full pb-8">
      {scope !== 'global' && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <Search size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning-600, #d97706)' }} />
          <p className="text-xs m-0" style={{ color: 'var(--color-warning-700, #b45309)' }}>
            You are editing one company. These settings override the global default for that company only.
          </p>
        </div>
      )}

      <div className="rounded-2xl p-5 mb-4"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        <h1 className="text-lg font-bold text-text mb-1 flex items-center gap-2">
          <Search size={20} className="text-primary-600" /> Closer Search
        </h1>
        <p className="text-xs text-text-secondary m-0 max-w-2xl leading-relaxed">
          What a closer sees when they type a phone number on their dashboard — which record comes
          first, how far back the search reaches, and whether they are told about the ones it left out.
          Independent of duplicate handling: these stay editable whether that is on or off.
        </p>
      </div>

      <Section accent="info"
        title="Which transfer comes first"
        desc="When a closer searches a phone number, which transfer floats to the top of the result list.">
        <RadioGroup name="search-sort" value={sortBy}
          onChange={(v) => onSave('search.sort_by', v)} options={SORT_OPTS} />
      </Section>

      <Section accent="warning"
        title="How far back the search reaches"
        desc="Counted from when the transfer was MADE, not when it was last touched — so a disposition on an old lead does not pull it back into range. A re-transfer of the same customer is its own transfer, so a genuine new call always shows. Compliance and superadmin are exempt, because an investigation that stops at N days is worse than useless.">
        <NumberInput value={maxAgeDays} onChange={(v) => onSave('search.max_age_days', v)}
          unit="days" helper="0 = no limit (default). Set 7 to show only transfers created in the last week." />
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <CheckboxRow checked={showHidden} onChange={(v) => onSave('search.show_hidden_count', v)}
            label="Tell the closer how many older transfers were hidden"
            sub="Shows a count only, never the records — so they can tell a brand-new customer from one whose earlier calls are out of range. No effect while the limit is 0." />
        </div>
      </Section>
    </div>
  );
};

export default CloserSearchRules;
