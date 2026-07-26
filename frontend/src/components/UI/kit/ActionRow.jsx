import Loading from './Loading';
import { accent } from './tokens';

// ActionRow — the ONE full-width action button (icon + label + hint + busy).
// Generalized from AccountSection's local ActionBtn, which the Governance and QA
// sections had each re-rolled slightly differently.
//
//   <ActionRow icon={KeyRound} label="Reset password" hint="Set a new password directly"
//              onClick={reset} busy={busy === 'password'} />
//   <ActionRow icon={Trash2} label="Delete user" tone="danger" onClick={…} />
//
// `tone` colors the icon AND the label from tokens.ACCENT, so a destructive row
// reads as destructive without any hardcoded hex.
export default function ActionRow({
  icon: Icon,
  label,
  hint,
  onClick,
  busy = false,
  disabled = false,
  tone = 'default',
  trailing,
  className = '',
}) {
  const a = accent(tone);
  const off = busy || disabled;
  return (
    <button type="button" onClick={onClick} disabled={off}
      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors disabled:opacity-60 ${className}`}
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <span className="flex-shrink-0 flex items-center" style={{ color: a.fg }}>
        {busy ? <Loading variant="inline" size={16} /> : (Icon ? <Icon size={16} /> : null)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: a.fg }}>{label}</span>
        {hint && <span className="block text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{hint}</span>}
      </span>
      {trailing}
    </button>
  );
}
