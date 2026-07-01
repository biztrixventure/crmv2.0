import { useRef, useState, useLayoutEffect, useCallback } from 'react';

// Presentational scrolling marquee strip (CSS-only, no extra package).
// Used by the superadmin manager preview and the live MarqueeBanner.
//
// Timing is length-aware: each message scrolls at a CONSTANT visual speed
// (pixels/second), so the duration is computed from the actual rendered width
// instead of a fixed number of seconds — short and long messages feel the same,
// and long ones are never cut off. Each run is a SINGLE pass; on completion it
// calls onDone (so the banner can advance to the next item only once the current
// one has fully scrolled off), or — with no onDone (standalone preview) — loops
// itself.
const SPEED_PXPS = { slow: 45, normal: 75, fast: 120 };   // pixels per second

// Inject the keyframes once.
if (typeof document !== 'undefined' && !document.getElementById('bsx-marquee-kf')) {
  const s = document.createElement('style');
  s.id = 'bsx-marquee-kf';
  s.textContent = '@keyframes bsx-marquee{0%{transform:translateX(0)}100%{transform:translateX(-100%)}}';
  document.head.appendChild(s);
}

const MarqueeStrip = ({ item, onDone }) => {
  const wrapRef = useRef(null);   // the visible viewport (feeds the 100% left pad)
  const textRef = useRef(null);   // the scrolling track
  const [dur, setDur] = useState(0);
  const [runId, setRunId] = useState(0);   // bump to restart when self-looping

  // Distance travelled = the track's own width, which is the viewport width
  // (paddingLeft:100%) + the text width. translateX(-100%) moves exactly that,
  // so duration = distance / speed keeps px/sec constant regardless of length.
  const measure = useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    const pxps = SPEED_PXPS[item?.speed] || SPEED_PXPS.normal;
    const distance = el.offsetWidth;
    setDur(distance > 0 ? distance / pxps : 0);
  }, [item?.speed]);

  useLayoutEffect(() => {
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && wrapRef.current) ro.observe(wrapRef.current);
    return () => { if (ro) ro.disconnect(); };
  }, [measure, item?.content, item?.byline, runId]);

  if (!item) return null;

  const handleEnd = () => {
    if (onDone) onDone();          // banner drives sequencing
    else setRunId(id => id + 1);   // standalone preview → loop itself
  };

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 overflow-hidden" style={{ backgroundColor: item.bg_color || '#1e40af', color: item.text_color || '#ffffff' }}>
      <span className="font-extrabold text-sm whitespace-nowrap flex-shrink-0 tracking-wide">{item.byline}</span>
      <div ref={wrapRef} className="relative flex-1 overflow-hidden">
        <div
          ref={textRef}
          key={runId}
          onAnimationEnd={handleEnd}
          className="text-sm font-medium"
          style={{
            display: 'inline-block', whiteSpace: 'nowrap', paddingLeft: '100%',
            animation: dur ? `bsx-marquee ${dur}s linear` : 'none',
          }}
        >
          {item.content}
        </div>
      </div>
    </div>
  );
};

export default MarqueeStrip;
