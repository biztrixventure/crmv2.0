import Loading from './Loading';
import { accent } from './tokens';

// Toggle + CheckRow — the ONE switch and the ONE checkbox row. Replaces the raw
// `<input type="checkbox" className="accent-[var(--color-primary-600)]">` sprinkled
// across EgressSection / QaSection / GovernanceSection / ReadonlyAdminManager,
// each with its own label sizing and no busy state.
//
//   <Toggle checked={on} onChange={setOn} label="Allow CSV export" hint="…" busy={saving} />
//   <CheckRow checked={on} onChange={setOn} label="Sales" trailing={<SourceBadge/>} />
//
// Both take onChange(nextBoolean) — NOT an event — so callers never re-read
// e.target.checked. Both go opacity-60 + non-interactive while `busy`.

export function Toggle({ checked, onChange, label, hint, busy = false, disabled = false, tone = 'primary', className = '' }) {
  const a = accent(tone);
  const off = disabled || busy;
  return (
    <label className={`flex items-start gap-3 ${off ? 'opacity-60' : 'cursor-pointer'} ${className}`}>
      <button type="button" role="switch" aria-checked={!!checked} disabled={off}
        onClick={() => onChange?.(!checked)}
        className="relative flex-shrink-0 transition-colors"
        style={{
          width: 38, height: 22, borderRadius: 999,
          background: checked ? a.fg : 'var(--color-border)',
          cursor: off ? 'not-allowed' : 'pointer',
        }}>
        <span className="absolute top-0.5 transition-all" style={{
          left: checked ? 18 : 2, width: 18, height: 18, borderRadius: 999,
          background: 'var(--color-surface)', boxShadow: 'var(--shadow-xs)',
        }} />
      </button>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="block text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{label}</span>
          {busy && <Loading variant="inline" size={12} />}
        </span>
        {hint && <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{hint}</span>}
      </span>
    </label>
  );
}

export function CheckRow({ checked, onChange, label, hint, busy = false, disabled = false, trailing, strong = false, className = '' }) {
  const off = disabled || busy;
  return (
    <label className={`flex items-center gap-2 py-1 ${off ? 'opacity-60' : 'cursor-pointer'} ${className}`}>
      <input type="checkbox" checked={!!checked} disabled={off} onChange={e => onChange?.(e.target.checked)}
        style={{ accentColor: 'var(--color-primary-600)', width: 15, height: 15, flexShrink: 0 }} />
      <span className={`text-sm truncate ${strong ? 'font-semibold' : ''}`} style={{ color: 'var(--color-text)' }}>{label}</span>
      {hint && <span className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{hint}</span>}
      {busy && <Loading variant="inline" size={12} />}
      {trailing}
    </label>
  );
}

export default Toggle;
