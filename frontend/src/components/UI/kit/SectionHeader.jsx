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
    // The hairline baseline is structural, not decoration: it separates the
    // page's identity from its controls, so the tab strip and content below
    // read as belonging to this title instead of floating on the background.
    return (
      <div className={`flex items-end justify-between gap-4 flex-wrap pb-4 mb-5 ${className}`}
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--gradient-sidebar)', boxShadow: 'var(--shadow-sm)' }}>
              <Icon size={18} className="text-white" />
            </div>
          )}
          <div className="min-w-0">
            {/* clamp, not a fixed 26px: at 390 a long tab title either
                truncated to a few characters or shoved the actions off-screen. */}
            <h1 className="font-bold leading-tight truncate"
              style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)', fontSize: 'clamp(20px, 4.5vw, 26px)', letterSpacing: '-0.015em' }}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-[13px] m-0 mt-1 max-w-3xl" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>
            )}
          </div>
        </div>
        {/* `flex-wrap` with `flex-shrink-0` cancel each other out: the container
            refuses to narrow, so a wide action group pushes past the viewport
            instead of wrapping inside it. That one pairing was the entire
            +304px overflow on Data Analyzer and +92px on Branding. */}
        {actions && <div className="flex items-center gap-2 flex-wrap min-w-0">{actions}</div>}
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
          <p className="text-[11px] m-0 mt-1" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap min-w-0">{actions}</div>}
    </div>
  );
}
