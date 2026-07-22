import { useState, useEffect, useRef } from 'react';

// ============================================================================
// Charts.jsx — tiny dependency-free SVG charts for the QA reports tab (no chart
// library / no external requests). Donut (pie), horizontal Bars, and a multi-
// series Line chart. Theme-aware via CSS vars. Each animates in on mount
// (donut fades+scales, bars grow, lines draw) via CSS transitions — no keyframes.
// ============================================================================

export const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

// flips false→true on the next frame so mount transitions actually run.
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setM(true)); return () => cancelAnimationFrame(id); }, []);
  return m;
}

const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
function slicePath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

// data: [{ label, value, color? }]
export function Donut({ data = [], size = 150, centerValue, centerLabel }) {
  const mounted = useMounted();
  const items = data.filter(d => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  let a = -Math.PI / 2;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <g style={{ transformOrigin: 'center', transformBox: 'fill-box', transition: 'opacity .5s ease, transform .5s cubic-bezier(.2,.8,.2,1)', opacity: mounted ? 1 : 0, transform: mounted ? 'scale(1) rotate(0deg)' : 'scale(.85) rotate(-25deg)' }}>
          {total === 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth="14" />}
          {items.map((d, i) => {
            const frac = d.value / total;
            const a0 = a, a1 = a + frac * Math.PI * 2; a = a1;
            const color = d.color || PALETTE[i % PALETTE.length];
            if (items.length === 1) return <circle key={i} cx={cx} cy={cy} r={r} fill={color} />;
            return <path key={i} d={slicePath(cx, cy, r, a0, a1)} fill={color} />;
          })}
          <circle cx={cx} cy={cy} r={r * 0.58} fill="var(--color-bg)" />
        </g>
        {(centerValue != null) && <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.2} fontWeight="800" fill="var(--color-text)" style={{ opacity: mounted ? 1 : 0, transition: 'opacity .6s ease .2s' }}>{centerValue}</text>}
        {centerLabel && <text x={cx} y={cy + size * 0.13} textAnchor="middle" fontSize={size * 0.08} fill="var(--color-text-tertiary)" style={{ opacity: mounted ? 1 : 0, transition: 'opacity .6s ease .2s' }}>{centerLabel}</text>}
      </svg>
      <div className="space-y-1 min-w-0">
        {items.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs" style={{ opacity: mounted ? 1 : 0, transform: mounted ? 'none' : 'translateX(6px)', transition: `opacity .4s ease ${0.1 + i * 0.05}s, transform .4s ease ${0.1 + i * 0.05}s` }}>
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color || PALETTE[i % PALETTE.length] }} />
            <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>{d.label}</span>
            <span className="font-bold tabular-nums ml-auto" style={{ color: 'var(--color-text)' }}>{d.value}</span>
            <span className="tabular-nums text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{total ? Math.round(d.value / total * 100) : 0}%</span>
          </div>
        ))}
        {items.length === 0 && <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No data</div>}
      </div>
    </div>
  );
}

// data: [{ label, value, color? }]   max optional
export function Bars({ data = [], max, unit = '', color = PALETTE[0] }) {
  const mounted = useMounted();
  const hi = max ?? Math.max(1, ...data.map(d => d.value));
  return (
    <div className="space-y-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[11px] truncate w-28 flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }} title={d.label}>{d.label}</span>
          <div className="flex-1 h-4 rounded" style={{ background: 'var(--color-surface-hover)' }}>
            <div className="h-4 rounded" style={{ width: mounted ? `${Math.max(2, (d.value / hi) * 100)}%` : '0%', background: d.color || color, transition: `width .7s cubic-bezier(.2,.8,.2,1) ${i * 0.04}s` }} />
          </div>
          <span className="text-[11px] font-bold tabular-nums w-12 text-right flex-shrink-0" style={{ color: 'var(--color-text)' }}>{d.value}{unit}</span>
        </div>
      ))}
      {data.length === 0 && <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No data</div>}
    </div>
  );
}

// series: [{ name, color, points: [{ x(label), y(number) }] }]  — shared x axis.
// Renders at a FIXED height and fills the container width (measured, not aspect-
// scaled) so it never balloons vertically on a wide screen. Coordinates are in
// real pixels, so lines/dots never distort no matter how wide the card is.
export function Lines({ series = [], height = 160, yMax = 100, yUnit = '' }) {
  const mounted = useMounted();
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const W = Math.max(260, Math.round(w) || 520), H = height;
  const padL = 32, padB = 20, padT = 8, padR = 10;
  const xs = series[0]?.points || [];
  const n = xs.length;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xAt = (i) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (v) => padT + innerH - (Math.max(0, Math.min(yMax, v)) / yMax) * innerH;
  const gy = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: Math.round(yMax * (1 - f)), y: padT + innerH * f }));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(innerW / 64))));
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={W} height={H} style={{ display: 'block', maxWidth: '100%' }}>
        {gy.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="var(--color-border)" strokeWidth="1" />
            <text x={padL - 4} y={g.y + 3} textAnchor="end" fontSize="9" fill="var(--color-text-tertiary)">{g.v}{yUnit}</text>
          </g>
        ))}
        {xs.map((p, i) => (i % labelEvery === 0) && (
          <text key={i} x={xAt(i)} y={H - 5} textAnchor="middle" fontSize="9" fill="var(--color-text-tertiary)">{String(p.x).slice(5)}</text>
        ))}
        {series.map((s, si) => {
          const pts = (s.points || []).map((p, i) => `${xAt(i)},${yAt(p.y ?? 0)}`).join(' ');
          const color = s.color || PALETTE[si % PALETTE.length];
          return (
            <g key={si}>
              {n > 1 && <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
                pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: mounted ? 0 : 1, transition: 'stroke-dashoffset .9s ease' }} />}
              {(s.points || []).map((p, i) => <circle key={i} cx={xAt(i)} cy={yAt(p.y ?? 0)} r={n > 40 ? 1.5 : 3} fill={color}
                style={{ opacity: mounted ? 1 : 0, transition: `opacity .3s ease ${0.3 + (i / Math.max(1, n)) * 0.6}s` }} />)}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <div className="flex items-center gap-4 justify-center mt-1">
          {series.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="w-3 h-1.5 rounded-full" style={{ background: s.color || PALETTE[i % PALETTE.length] }} />{s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
