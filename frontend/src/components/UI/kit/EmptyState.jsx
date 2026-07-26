import { Inbox } from 'lucide-react';
import { accent } from './tokens';

// EmptyState — the ONE "nothing here" treatment. Replaces 6 shapes (py-6 italic,
// py-8 text-center, py-12 text-sm, a bare <p>No FAQs yet.</p>, …). Modeled on the
// one good existing empty state (NumbersIntelligence): a dashed rounded box with
// a tinted icon, a title, and an optional hint + action.
//
//   <EmptyState icon={Users} title="No teams yet" hint="Click New team to start."
//               action={<Button>New team</Button>} />
export default function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  action,
  tone = 'muted',
  compact = false,
  className = '',
}) {
  const a = accent(tone);
  return (
    <div className={`text-center rounded-2xl ${compact ? 'py-6 px-4' : 'py-10 px-6'} ${className}`}
      style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
      <div className={`${compact ? 'w-9 h-9' : 'w-11 h-11'} rounded-full mx-auto flex items-center justify-center mb-2.5`}
        style={{ background: a.soft }}>
        <Icon size={compact ? 17 : 20} style={{ color: a.fg }} />
      </div>
      {title && <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>}
      {hint && <p className="text-xs mt-1 max-w-md mx-auto" style={{ color: 'var(--color-text-secondary)' }}>{hint}</p>}
      {action && <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">{action}</div>}
    </div>
  );
}
