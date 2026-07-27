import React, { useRef, useEffect, useState, useCallback } from 'react';

// ChromeTabs — a reusable, theme-aware tab bar.
//   variant="chrome"  → browser-style connected tabs (rounded top, active tab
//                       merges into the panel below). Good for a primary nav.
//   variant="pill"    → minimalist rounded pills. Good for a sub-nav.
// Themed entirely through the CRM CSS variables, so it follows any theme in
// both light and dark with no per-theme code. Drop it in anywhere:
//   <ChromeTabs items={[{ key, label, icon, count }]} value onChange variant size />
//
// `items[i].icon` is an optional lucide component. `count` is an optional badge.
//
// Both variants SCROLL on one line. The pill variant used to `flex-wrap`, which
// on a phone broke a tab set into ragged rows (Compliance → Records stranded
// "Post Date" alone on a second line). A single scrolling line with an edge
// fade keeps the set readable as a set at any width — same rule as kit/PillTabs.

// Shows the fade only while the track actually clips AND you aren't already at
// the end, so a short tab set never carries a permanent decorative gradient.
function useEdgeFade(ref, deps) {
  const [clips, setClips] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const over = el.scrollWidth > el.clientWidth + 2;
    setClips(over);
    setAtEnd(!over || el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return { clips, atEnd, measure };
}

export default function ChromeTabs({ items = [], value, onChange, variant = 'chrome', size = 'md', className = '' }) {
  const pad = size === 'sm' ? '5px 12px' : '8px 15px';
  const fs = size === 'sm' ? 13 : 14;
  const isz = size === 'sm' ? 13 : 15;
  const radius = 'var(--radius-lg, 12px)';

  const trackRef = useRef(null);
  const activeRef = useRef(null);
  const { clips, atEnd, measure } = useEdgeFade(trackRef, [items, variant]);

  // A scrolling strip can open with the selected tab off-screen — which reads
  // as "nothing is selected". Pull it into view whenever the selection changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  const scrollCls = 'overflow-x-auto [&::-webkit-scrollbar]:hidden';
  const scrollStyle = { scrollbarWidth: 'none', msOverflowStyle: 'none' };

  const Fade = () => (
    <span aria-hidden className="pointer-events-none absolute right-0 top-0 bottom-0"
      style={{ width: 32, background: 'linear-gradient(to right, transparent, var(--color-bg))' }} />
  );

  if (variant === 'pill') {
    return (
      <div className={`relative min-w-0 ${className}`}>
        <div ref={trackRef} onScroll={measure} role="tablist"
          className={`flex gap-1 ${scrollCls}`} style={scrollStyle}>
          {items.map(t => {
            const on = t.key === value;
            return (
              <button key={t.key} ref={on ? activeRef : null} role="tab" aria-selected={on} onClick={() => onChange?.(t.key)}
                className={`inline-flex items-center gap-1.5 font-semibold whitespace-nowrap flex-shrink-0 transition-all ${on ? '' : 'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]'}`}
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
        {clips && !atEnd && <Fade />}
      </div>
    );
  }

  // chrome — connected rounded-top tabs sitting on a hairline baseline
  return (
    <div className={`relative min-w-0 ${className}`}>
      <div ref={trackRef} onScroll={measure} className={`flex items-end gap-1 ${scrollCls}`} role="tablist"
        style={{ borderBottom: '1px solid var(--color-border)', ...scrollStyle }}>
        {items.map(t => {
          const on = t.key === value;
          return (
            <button key={t.key} ref={on ? activeRef : null} role="tab" aria-selected={on} onClick={() => onChange?.(t.key)}
              className={`relative inline-flex items-center gap-2 font-bold whitespace-nowrap flex-shrink-0 transition-colors ${on ? '' : 'hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]'}`}
              style={{ padding: pad, fontSize: fs, borderRadius: `${radius} ${radius} 0 0`, cursor: 'pointer',
                background: on ? 'var(--color-surface)' : 'transparent',
                color: on ? 'var(--color-text)' : 'var(--color-text-secondary)',
                border: on ? '1px solid var(--color-border)' : '1px solid transparent',
                borderBottom: on ? '1px solid var(--color-surface)' : '1px solid transparent',
                marginBottom: -1, boxShadow: on ? '0 -3px 8px rgba(0,0,0,0.05)' : 'none' }}>
              {on && <span style={{ position: 'absolute', top: -1, left: 12, right: 12, height: 3, borderRadius: 3, background: 'var(--color-primary)' }} />}
              {t.icon && <t.icon size={isz} style={{ color: on ? 'var(--color-primary)' : 'currentColor' }} />}{t.label}
              {t.count != null && <Badge on={on}>{t.count}</Badge>}
            </button>
          );
        })}
      </div>
      {clips && !atEnd && <Fade />}
    </div>
  );
}

// 11px, not 10px: below 11 the count is unreadable on a phone. `leading-none`
// because a Tailwind arbitrary size only sets font-size, not line-height.
const Badge = ({ children, on }) => (
  <span className="text-[11px] leading-none font-bold px-1.5 py-0.5 rounded-full"
    style={{ background: on ? 'color-mix(in srgb, var(--color-primary) 16%, transparent)' : 'var(--color-surface-hover)', color: on ? 'var(--color-primary-700, var(--color-primary))' : 'var(--color-text-tertiary)' }}>
    {children}
  </span>
);
