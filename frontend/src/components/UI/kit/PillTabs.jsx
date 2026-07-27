import { useRef, useEffect, useState } from 'react';

// PillTabs — the ONE sub-navigation, drawn as a real segmented control.
//
// Why not bare pills: with only the ACTIVE tab tinted, the inactive ones are
// unstyled text floating on the page background — they read as links, not as a
// set of choices, and the group has no edge. A track (recessed rail + border)
// gives the set a boundary, so every tab sits on a surface and the active one
// is lifted out of it. That also answers "where am I" at a glance, which is the
// job this control actually has in a console someone uses all day.
//
// Rule of thumb:
//   • ChromeTabs variant="chrome" → a shell's PRIMARY nav (connected tabs).
//     The AdminPanel's sidebar is its primary nav, so admin tabs skip it.
//   • PillTabs                    → sub-nav INSIDE a tab. Everything else.
//
//   <PillTabs items={[{ key, label, icon, count }]} value={tab} onChange={setTab} />
//
// `scrollable` (default) keeps a long set on one line with an overflow fade
// rather than wrapping into a ragged second row.
export default function PillTabs({ items = [], value, onChange, className = '', scrollable = true }) {
  const trackRef = useRef(null);
  const [overflow, setOverflow] = useState(false);

  // Only show the fade when the track actually clips — a permanent fade on a
  // short tab set is decoration.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  return (
    <div className={`relative inline-flex max-w-full ${className}`}>
      <div
        ref={trackRef}
        role="tablist"
        className={`inline-flex items-center gap-1 p-1 ${scrollable ? 'overflow-x-auto [&::-webkit-scrollbar]:hidden' : 'flex-wrap'}`}
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 999,
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          maxWidth: '100%',
        }}
      >
        {items.map((t) => {
          const on = t.key === value;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={on}
              onClick={() => onChange?.(t.key)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold transition-all flex-shrink-0"
              style={{
                padding: '6px 13px',
                fontSize: 13,
                borderRadius: 999,
                cursor: 'pointer',
                // Active is LIFTED out of the recessed track (surface + shadow),
                // which reads as selected without relying on color alone.
                background: on ? 'var(--color-surface)' : 'transparent',
                color: on ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                boxShadow: on ? 'var(--shadow-sm)' : 'none',
                border: `1px solid ${on ? 'var(--color-border)' : 'transparent'}`,
              }}
              onMouseEnter={(e) => { if (!on) e.currentTarget.style.color = 'var(--color-text)'; }}
              onMouseLeave={(e) => { if (!on) e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
            >
              {Icon && <Icon size={14} style={{ color: on ? 'var(--color-primary-600)' : 'currentColor' }} />}
              {t.label}
              {t.count != null && (
                <span
                  className="text-[11px] sm:text-[10px] font-bold px-1.5 rounded-full"
                  style={{
                    background: on
                      ? 'color-mix(in srgb, var(--color-primary-600) 14%, transparent)'
                      : 'var(--color-surface)',
                    color: on ? 'var(--color-primary-600)' : 'var(--color-text-tertiary)',
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Edge fade — signals "more tabs this way" only when the track clips. */}
      {overflow && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 bottom-0"
          style={{
            width: 36,
            borderRadius: 999,
            background: 'linear-gradient(to right, transparent, var(--color-bg-secondary))',
          }}
        />
      )}
    </div>
  );
}
