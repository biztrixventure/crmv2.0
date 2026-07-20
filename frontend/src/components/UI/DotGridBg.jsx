import React from 'react';

// DotGridBg — the same themed dot-grid backdrop used on the Kanban task board.
// A fine dot grid with hollow boxes + crosses at the coarser meet-points, drawn
// as SVG patterns in the theme's border colour so it stays subtle and works in
// both light and dark. Render it as the first child of a positioned container
// (or leave it fixed to the viewport, the default) — it's pointer-transparent
// and sits behind everything.
export default function DotGridBg({ fixed = true, opacity = 0.6 }) {
  return (
    <svg aria-hidden="true" width="100%" height="100%"
      style={{ position: fixed ? 'fixed' : 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', color: 'var(--color-border)', opacity }}>
      <defs>
        <pattern id="dg-dots" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="1" fill="currentColor" />
        </pattern>
        <pattern id="dg-marks" width="104" height="104" patternUnits="userSpaceOnUse">
          <rect x="-3.5" y="-3.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          <rect x="48.5" y="48.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.6" />
          <path d="M23 78 h6 M26 75 v6 M78 23 h6 M81 20 v6" stroke="currentColor" strokeWidth="1" opacity="0.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dg-dots)" />
      <rect width="100%" height="100%" fill="url(#dg-marks)" />
    </svg>
  );
}
