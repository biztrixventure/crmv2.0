import { useRef, useEffect, useState, useCallback } from 'react';

// TableScroll — the ONE responsive strategy for a wide table.
//
// Rule: wide content scrolls inside its OWN box, never the page. 30 files in
// this repo render a <table>; most had an ad-hoc `overflow-x-auto` div, four
// had nothing at all, and none pinned the identifying column — so scrolling
// right on a phone left you reading anonymous numbers.
//
// Why scroll and not card-per-row: these are dense comparison grids. Turning a
// row into a card destroys the column alignment that makes them scannable, and
// there are 30 of them. A pinned first column solves the actual complaint
// (which row am I looking at?) without rewriting every surface.
//
//   <TableScroll><table className="w-full">…</table></TableScroll>
//
// `stickyFirst` pins column 1 (see .bsx-table-sticky in global.css). Leave it
// OFF when the first cell is a checkbox or drag handle. `inheritRowBg` lets a
// per-row tint (compliance duplicate highlight, focus highlight) show through
// the pinned cell instead of being painted over with the surface color.
export default function TableScroll({
  children,
  stickyFirst = false,
  inheritRowBg = false,
  className = '',
  style,
  label = 'Table',
}) {
  const ref = useRef(null);
  const [clips, setClips] = useState(false);   // wider than its box at all
  const [atEnd, setAtEnd] = useState(false);   // scrolled fully right

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const over = el.scrollWidth > el.clientWidth + 2;
    setClips(over);
    setAtEnd(!over || el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);

  // Re-measure on resize AND on content change — a table that gains rows or
  // columns after a fetch would otherwise keep the first paint's verdict.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure, children]);

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={measure}
        // tabIndex + role: a scroll container with no focusable child is
        // unreachable by keyboard otherwise.
        tabIndex={0}
        role="region"
        aria-label={label}
        className={[
          'overflow-x-auto outline-none',
          stickyFirst ? 'bsx-table-sticky' : '',
          stickyFirst && inheritRowBg ? 'bsx-table-sticky--inherit' : '',
          className,
        ].filter(Boolean).join(' ')}
        style={style}
      >
        {children}
      </div>

      {/* Edge fade — the affordance that says "there is more this way". Shown
          only while it actually clips AND you aren't already at the end, so it
          never sits there as decoration (same rule as PillTabs). */}
      {clips && !atEnd && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 bottom-0"
          style={{ width: 28, background: 'linear-gradient(to right, transparent, var(--color-surface))' }}
        />
      )}
    </div>
  );
}
