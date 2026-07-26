import { accent } from './tokens';

// SectionHeader — the ONE heading. Three levels, one visual language:
//
//   level="page"    a superadmin tab's title. Small gradient icon chip + h1 +
//                   subtitle + optional right-aligned actions. This REPLACES the
//                   old full-bleed gradient banner cards (Chat Control, VICIdial,
//                   Data Cleanup, …) so admin tabs read like the Compliance shell.
//   level="section" a block inside a page card (was: h3 text-sm font-bold).
//   level="sub"     a label above a group of controls (was: h4 text-xs uppercase).
//
//   <SectionHeader icon={Shield} title="Chat Control" subtitle="…" actions={<Btn/>} level="page" />
export default function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
  level = 'section',
  tone = 'primary',
  className = '',
}) {
  const a = accent(tone);

  if (level === 'page') {
    return (
      <div className={`flex items-start justify-between gap-3 flex-wrap mb-5 ${className}`}>
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Icon size={20} className="text-white" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight truncate"
              style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap flex-shrink-0">{actions}</div>}
      </div>
    );
  }

  if (level === 'sub') {
    return (
      <div className={`flex items-center justify-between gap-2 mb-2 ${className}`}>
        <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 min-w-0"
          style={{ color: 'var(--color-text-secondary)' }}>
          {Icon && <Icon size={13} className="flex-shrink-0" />}
          <span className="truncate">{title}</span>
        </h4>
        {actions && <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>}
      </div>
    );
  }

  // section
  return (
    <div className={`flex items-start justify-between gap-3 flex-wrap mb-3 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
          {Icon && <Icon size={16} className="flex-shrink-0" style={{ color: a.fg }} />}
          <span className="truncate">{title}</span>
        </h3>
        {subtitle && (
          <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap flex-shrink-0">{actions}</div>}
    </div>
  );
}
