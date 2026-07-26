import { Loader2 } from 'lucide-react';

// Loading — the ONE loading treatment. Every superadmin surface uses this, so a
// tab switch never changes the loading look. It replaces 9 competing variants
// (centered Loader2 at py-10/12/16, a different `Loader` icon with a text label,
// border-b-2 CSS spinners, ring spinners, italic "Loading…" text, and — on the
// Account tab — no loading state at all).
//
// Default is a shimmer SKELETON, not a spinner: it reserves the space the real
// content will occupy, so nothing jumps when data lands. `animate-shimmer` is
// already theme-aware (global.css:567) — it works in light and dark untouched.
//
//   <Loading />                       3 skeleton rows (list / form / detail)
//   <Loading variant="rows" rows={6} />
//   <Loading variant="cards" />       a grid of card placeholders
//   <Loading variant="table" rows={5} />
//   <Loading variant="block" height={220} />
//   <Loading variant="inline" />      small spinner for a button / row
//
// `label` is announced to screen readers (visually hidden) — a skeleton has no
// text of its own, so without it the state is invisible to assistive tech.
const Bar = ({ w = '100%', h = 12, className = '' }) => (
  <div className={`animate-shimmer rounded-lg ${className}`} style={{ width: w, height: h }} />
);

export default function Loading({
  variant = 'rows',
  rows = 3,
  cards = 3,
  height = 160,
  size = 16,
  label = 'Loading…',
  className = '',
}) {
  // Inline — the only spinner in the kit. For buttons and single rows where a
  // skeleton would be bigger than the thing it replaces.
  if (variant === 'inline') {
    return (
      <>
        <Loader2 size={size} className={`animate-spin ${className}`} style={{ color: 'var(--color-primary-600)' }} aria-hidden />
        <span className="sr-only">{label}</span>
      </>
    );
  }

  const wrap = (children) => (
    <div className={className} role="status" aria-busy="true" aria-live="polite">
      {children}
      <span className="sr-only">{label}</span>
    </div>
  );

  if (variant === 'block') return wrap(<Bar w="100%" h={height} />);

  if (variant === 'cards') {
    return wrap(
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="rounded-2xl p-4 space-y-2.5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <Bar w="45%" h={10} />
            <Bar w="75%" h={20} />
            <Bar w="60%" h={10} />
          </div>
        ))}
      </div>,
    );
  }

  if (variant === 'table') {
    return wrap(
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        <div className="px-3 py-2.5" style={{ background: 'var(--color-bg-secondary)' }}>
          <Bar w="30%" h={10} />
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <Bar w={28} h={28} className="!rounded-full flex-shrink-0" />
              <Bar w={`${55 - (i % 3) * 10}%`} h={12} />
              <div className="ml-auto"><Bar w={64} h={12} /></div>
            </div>
          ))}
        </div>
      </div>,
    );
  }

  // rows (default) — staggered widths so it reads as content, not a bar chart.
  const W = ['70%', '92%', '54%', '84%', '64%', '78%'];
  return wrap(
    <div className="space-y-2.5 py-1">
      {Array.from({ length: rows }, (_, i) => <Bar key={i} w={W[i % W.length]} h={12} />)}
    </div>,
  );
}
