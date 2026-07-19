import React from 'react';

// ChromeTabs — a reusable, theme-aware tab bar.
//   variant="chrome"  → browser-style connected tabs (rounded top, active tab
//                       merges into the panel below). Good for a primary nav.
//   variant="pill"    → minimalist rounded pills. Good for a sub-nav.
// Themed entirely through the CRM CSS variables, so it follows any theme in
// both light and dark with no per-theme code. Drop it in anywhere:
//   <ChromeTabs items={[{ key, label, icon, count }]} value onChange variant size />
//
// `items[i].icon` is an optional lucide component. `count` is an optional badge.
export default function ChromeTabs({ items = [], value, onChange, variant = 'chrome', size = 'md', className = '' }) {
  const pad = size === 'sm' ? '5px 12px' : '8px 15px';
  const fs = size === 'sm' ? 13 : 14;
  const isz = size === 'sm' ? 13 : 15;
  const radius = 'var(--radius-lg, 12px)';

  if (variant === 'pill') {
    return (
      <div className={`flex flex-wrap gap-1 ${className}`} role="tablist">
        {items.map(t => {
          const on = t.key === value;
          return (
            <button key={t.key} role="tab" aria-selected={on} onClick={() => onChange?.(t.key)}
              className={`inline-flex items-center gap-1.5 font-semibold transition-all ${on ? '' : 'hover:bg-[var(--color-surface-hover)]'}`}
              style={{ padding: pad, fontSize: fs, borderRadius: 999, cursor: 'pointer',
                background: on ? 'color-mix(in srgb, var(--color-primary) 14%, transparent)' : 'transparent',
                color: on ? 'var(--color-primary-700, var(--color-primary))' : 'var(--color-text-secondary)',
                border: `1px solid ${on ? 'color-mix(in srgb, var(--color-primary) 34%, transparent)' : 'transparent'}` }}>
              {t.icon && <t.icon size={isz} />}{t.label}
              {t.count != null && <Badge on={on}>{t.count}</Badge>}
            </button>
          );
        })}
      </div>
    );
  }

  // chrome — connected rounded-top tabs sitting on a hairline baseline
  return (
    <div className={`flex items-end gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden ${className}`} role="tablist"
      style={{ borderBottom: '1px solid var(--color-border)', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
      {items.map(t => {
        const on = t.key === value;
        return (
          <button key={t.key} role="tab" aria-selected={on} onClick={() => onChange?.(t.key)}
            className={`relative inline-flex items-center gap-2 font-bold whitespace-nowrap transition-colors ${on ? '' : 'hover:bg-[var(--color-surface-hover)]'}`}
            style={{ padding: pad, fontSize: fs, borderRadius: `${radius} ${radius} 0 0`, cursor: 'pointer',
              background: on ? 'var(--color-surface)' : 'transparent',
              color: on ? 'var(--color-text)' : 'var(--color-text-secondary)',
              border: on ? '1px solid var(--color-border)' : '1px solid transparent',
              borderBottom: on ? '1px solid var(--color-surface)' : '1px solid transparent',
              marginBottom: -1, boxShadow: on ? '0 -3px 8px rgba(0,0,0,0.05)' : 'none' }}>
            {on && <span style={{ position: 'absolute', top: -1, left: 12, right: 12, height: 3, borderRadius: 3, background: 'var(--color-primary)' }} />}
            {t.icon && <t.icon size={isz} />}{t.label}
            {t.count != null && <Badge on={on}>{t.count}</Badge>}
          </button>
        );
      })}
    </div>
  );
}

const Badge = ({ children, on }) => (
  <span className="text-[10px] font-bold px-1.5 rounded-full"
    style={{ background: on ? 'color-mix(in srgb, var(--color-primary) 16%, transparent)' : 'var(--color-surface-hover)', color: on ? 'var(--color-primary-700, var(--color-primary))' : 'var(--color-text-tertiary)' }}>
    {children}
  </span>
);
