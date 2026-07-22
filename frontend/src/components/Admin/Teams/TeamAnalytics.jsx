import { useState, useEffect, useRef, useMemo } from 'react';
import {
  TrendingUp, DollarSign, Phone, Target, Users, Award, Crown, ChevronDown,
  ArrowUpRight, ArrowDownRight, Minus, Repeat, AlertTriangle,
} from 'lucide-react';

// ============================================================================
// TeamAnalytics — ONE shared, dependency-free SVG analytics body used by BOTH
// the TeamReport modal (TeamManager) and MyTeam, so the charts and the privacy
// mask can never drift between the two surfaces. Consumes the GET
// /api/teams/:id/report payload verbatim (totals, members, trend, goal,
// momentum, previous, range, capped) + the team row (for team.lead_user_id).
//
// Charts: a pseudo-3D extruded combo (bars = a chosen metric, line = another)
// with metric switchers + hover/keyboard tooltips; a gross-share donut with
// hover-explode; a fronting/closing split donut; a goal-pace ring; a KPI grid
// with vs-prior delta chips + sparklines; and a masked member leaderboard.
//
// PRIVACY: the team LEAD's personal name is masked to "Team Lead" in EVERY
// analysis surface (leaderboard, donut, table, tooltips) while their numbers
// still count in every total. Fail-open: no lead_user_id → real names shown.
// ============================================================================

const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];
const box = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' };
const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// Per-metric brand color + light/lit/shadow tints for the 3D extrusion.
const SERIES = {
  transfers: { label: 'Transfers', color: '#2563eb', tints: ['#60a5fa', '#93c5fd', '#1d4ed8'] },
  assigned:  { label: 'Assigned',  color: '#0891b2', tints: ['#22d3ee', '#67e8f9', '#0e7490'] },
  callbacks: { label: 'Callbacks', color: '#9333ea', tints: ['#c084fc', '#d8b4fe', '#7e22ce'] },
  sales:     { label: 'Sales',     color: '#16a34a', tints: ['#4ade80', '#86efac', '#15803d'] },
  gross:     { label: 'Gross',     color: '#d97706', tints: ['#fbbf24', '#fcd34d', '#b45309'], money: true },
};
const BAR_METRICS = ['transfers', 'assigned', 'callbacks'];
const LINE_METRICS = ['sales', 'gross', 'callbacks'];

// ── shared hooks ────────────────────────────────────────────────────────────
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setM(true); return undefined; }
    const id = requestAnimationFrame(() => setM(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return m;
}
function useMeasure() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Continuous day axis over [from,to] — the report trend is SPARSE (only active
// days), which would compress the chart and lie about cadence.
function zeroFillTrend(trend, from, to) {
  const list = trend || [];
  const map = new Map(list.map(r => [r.date, r]));
  let start = from, end = to;
  if (!start || !end) {
    if (!list.length) return [];
    start = start || list[0].date; end = end || list[list.length - 1].date;
  }
  const cur = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`);
  if (isNaN(cur.getTime()) || isNaN(last.getTime()) || cur > last) return list;
  const out = [];
  let guard = 0;
  while (cur <= last && guard < 800) {
    const k = cur.toISOString().slice(0, 10);
    out.push(map.get(k) || { date: k, transfers: 0, sales: 0, gross: 0, callbacks: 0, assigned: 0 });
    cur.setUTCDate(cur.getUTCDate() + 1); guard++;
  }
  return out;
}

const polar = (cx, cy, r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
function slicePath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

// ── little UI atoms ─────────────────────────────────────────────────────────
function Pill({ active, onClick, children, color }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className="text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors"
      style={{
        background: active ? (color || 'var(--color-primary-600)') : 'var(--color-bg-secondary)',
        color: active ? '#fff' : 'var(--color-text-secondary)',
        border: '1px solid var(--color-border)',
      }}>{children}</button>
  );
}
function DeltaChip({ pct }) {
  if (pct == null) return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>NEW</span>;
  const flat = pct === 0, up = pct > 0;
  const Icon = flat ? Minus : (up ? ArrowUpRight : ArrowDownRight);
  const color = flat ? 'var(--color-text-tertiary)' : (up ? '#16a34a' : '#dc2626');
  return <span className="inline-flex items-center gap-0.5 text-[10px] font-bold tabular-nums" style={{ color }}><Icon size={11} />{up ? '+' : ''}{pct}%</span>;
}
function Sparkline({ points, color }) {
  const mounted = useMounted();
  const vals = points || [];
  if (vals.length < 2) return null;
  const w = 54, h = 16, max = Math.max(1, ...vals);
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - (v / max) * h}`).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: mounted ? 0 : 1, transition: 'stroke-dashoffset .6s ease' }} />
    </svg>
  );
}
function KpiTile({ label, value, color, deltaPct, spark, icon }) {
  return (
    <div className="rounded-xl p-3" style={{ ...box, borderLeft: `3px solid ${color}` }}>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 truncate" style={{ color: 'var(--color-text-tertiary)' }}>{icon}{label}</span>
        {deltaPct !== undefined && <DeltaChip pct={deltaPct} />}
      </div>
      <div className="flex items-end justify-between gap-2 mt-1">
        <span className="text-xl font-extrabold tabular-nums" style={{ color: color }}>{value}</span>
        {spark && <Sparkline points={spark} color={color} />}
      </div>
    </div>
  );
}

// ── the hero: pseudo-3D extruded combo (bars + line) ────────────────────────
function Combo3DChart({ trend }) {
  const mounted = useMounted();
  const [wrapRef, w] = useMeasure();
  const [barMetric, setBarMetric] = useState('transfers');
  const [lineMetric, setLineMetric] = useState('sales');
  const [dual, setDual] = useState(true);
  const [tip, setTip] = useState(null);

  const rows = trend || [];
  const n = rows.length;
  const H = 224, padL = 42, padR = 44, padT = 16, padB = 26;
  const measured = Math.max(320, Math.round(w) || 640);
  const W = Math.max(measured, padL + padR + n * 16);   // ≥16px/day → owns its x-scroll
  const innerW = W - padL - padR;
  const innerH = H - padT - padB - 6;
  const y0 = padT + innerH;
  const slot = n ? innerW / n : innerW;
  const barW = Math.min(22, Math.max(4, slot * 0.55));
  const dx = 6, dy = -5;

  const barVals = rows.map(r => r[barMetric] || 0);
  const lineVals = rows.map(r => r[lineMetric] || 0);
  const yMaxBar = dual ? Math.max(1, ...barVals) : Math.max(1, ...barVals, ...lineVals);
  const yMaxLine = dual ? Math.max(1, ...lineVals) : Math.max(1, ...barVals, ...lineVals);
  const barTop = (v) => y0 - (v / yMaxBar) * innerH;
  const lineY = (v) => y0 - (v / yMaxLine) * innerH;
  const bx = (i) => padL + i * slot + Math.max(0, (slot - barW - dx) / 2);
  const cx = (i) => bx(i) + barW / 2;

  const bs = SERIES[barMetric], ls = SERIES[lineMetric];
  const gid = `t3d-${barMetric}`;
  const gy = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(innerW / 64))));
  const linePts = rows.map((r, i) => `${cx(i) + dx},${lineY(lineVals[i]) + dy}`).join(' ');

  const showTip = (i) => setTip({
    x: cx(i) + dx, y: Math.min(barTop(barVals[i]), lineY(lineVals[i]) + dy) - 10,
    title: rows[i].date,
    rows: [
      { label: bs.label, color: bs.color, value: bs.money ? money(barVals[i]) : barVals[i] },
      { label: ls.label, color: ls.color, value: ls.money ? money(lineVals[i]) : lineVals[i] },
    ],
  });

  return (
    <div className="rounded-2xl p-4" style={box}>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>Daily trend — 3D</p>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="inline-flex items-center gap-1"><span style={{ width: 9, height: 9, background: bs.color, display: 'inline-block', borderRadius: 2 }} />{bs.label}</span>
          <span className="inline-flex items-center gap-1"><span style={{ width: 12, height: 3, background: ls.color, display: 'inline-block', borderRadius: 2 }} />{ls.label}</span>
        </div>
      </div>

      {/* metric switchers */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-widest mr-1" style={{ color: 'var(--color-text-tertiary)' }}>Bars</span>
        {BAR_METRICS.map(k => <Pill key={k} active={barMetric === k} onClick={() => setBarMetric(k)} color={SERIES[k].color}>{SERIES[k].label}</Pill>)}
        <span className="text-[10px] font-bold uppercase tracking-widest mx-1" style={{ color: 'var(--color-text-tertiary)' }}>Line</span>
        {LINE_METRICS.map(k => <Pill key={k} active={lineMetric === k} onClick={() => setLineMetric(k)} color={SERIES[k].color}>{SERIES[k].label}</Pill>)}
        <Pill active={dual} onClick={() => setDual(d => !d)}>{dual ? 'Dual axis' : 'Shared axis'}</Pill>
      </div>

      {/* Outer wrapper has VISIBLE overflow and holds the tooltip, so a tooltip
          for a tall bar (anchored near y=0) is never clipped. The inner wrapper
          owns the horizontal scroll and carries wrapRef — rendered
          unconditionally so the ResizeObserver attaches at mount even when the
          first render has no data (n===0), keeping the chart responsive. */}
      <div style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
        <div ref={wrapRef} style={{ overflowX: 'auto' }}>
          {n === 0 ? (
            <p className="text-[11px] italic py-8 text-center" style={{ color: 'var(--color-text-tertiary)' }}>No activity in this range to chart.</p>
          ) : (
          <svg width={W} height={H} role="img" aria-label={`${bs.label} bars and ${ls.label} line by day`} style={{ display: 'block' }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={bs.tints[0]} />
                <stop offset="100%" stopColor={bs.color} />
              </linearGradient>
            </defs>
            {/* gridlines + dual axes */}
            {gy.map((f, i) => {
              const y = padT + innerH * f;
              return (
                <g key={i}>
                  <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--color-border)" strokeWidth="1" opacity="0.6" />
                  <text x={padL - 5} y={y + 3} textAnchor="end" fontSize="9" fill={bs.color}>{Math.round(yMaxBar * (1 - f))}</text>
                  {dual && <text x={W - padR + 5} y={y + 3} textAnchor="start" fontSize="9" fill={ls.color}>{Math.round(yMaxLine * (1 - f))}</text>}
                </g>
              );
            })}
            {/* 3D bars */}
            {rows.map((r, i) => {
              const v = barVals[i];
              if (v <= 0) return null;
              const x = bx(i), yt = barTop(v), h = y0 - yt;
              return (
                <g key={i} style={{ transformBox: 'fill-box', transformOrigin: 'bottom', transform: mounted ? 'scaleY(1)' : 'scaleY(0)', transition: `transform .7s cubic-bezier(.2,.8,.2,1) ${Math.min(i, 20) * 0.04}s` }}>
                  <polygon points={`${x},${yt} ${x + dx},${yt + dy} ${x + barW + dx},${yt + dy} ${x + barW},${yt}`} fill={bs.tints[1]} />
                  <polygon points={`${x + barW},${yt} ${x + barW + dx},${yt + dy} ${x + barW + dx},${y0 + dy} ${x + barW},${y0}`} fill={bs.tints[2]} />
                  <rect x={x} y={yt} width={barW} height={h} rx="1.5" fill={`url(#${gid})`} />
                  <rect x={x + 1} y={yt} width="2" height={h} fill="#fff" opacity="0.16" />
                </g>
              );
            })}
            {/* sales/line on the back plane */}
            {n > 1 && <polyline points={linePts} fill="none" stroke={ls.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"
              pathLength="1" strokeDasharray="1" style={{ strokeDashoffset: mounted ? 0 : 1, transition: 'stroke-dashoffset .9s ease .2s' }} />}
            {rows.map((r, i) => ((lineVals[i] > 0 || n <= 45)
              ? <circle key={i} cx={cx(i) + dx} cy={lineY(lineVals[i]) + dy} r={n > 40 ? 1.6 : 3.4} fill={ls.color} stroke="var(--color-surface)" strokeWidth="1.4"
                  style={{ opacity: mounted ? 1 : 0, transition: `opacity .3s ease ${0.3 + (i / Math.max(1, n)) * 0.6}s` }} />
              : null))}
            {/* x labels */}
            {rows.map((r, i) => (i % labelEvery === 0)
              ? <text key={i} x={cx(i)} y={H - 7} textAnchor="middle" fontSize="9" fill="var(--color-text-tertiary)">{String(r.date).slice(5)}</text>
              : null)}
            {/* invisible hover/focus targets */}
            {rows.map((r, i) => (
              <rect key={i} x={padL + i * slot} y={padT} width={slot} height={innerH + 6} fill="transparent" tabIndex={0}
                onMouseEnter={() => showTip(i)} onMouseMove={() => showTip(i)} onFocus={() => showTip(i)} onBlur={() => setTip(null)}
                style={{ cursor: 'pointer', outline: 'none' }}>
                <title>{`${r.date}: ${bs.label} ${barVals[i]}, ${ls.label} ${ls.money ? money(lineVals[i]) : lineVals[i]}`}</title>
              </rect>
            ))}
          </svg>
          )}
        </div>
        {n > 0 && tip && (
          <div style={{ position: 'absolute', left: Math.max(0, Math.min(W, tip.x)) - (wrapRef.current?.scrollLeft || 0), top: tip.y, transform: 'translate(-50%, calc(-100% - 8px))', pointerEvents: 'none', zIndex: 20, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg,0 8px 24px rgba(0,0,0,.15))', borderRadius: 8, padding: '6px 9px', minWidth: 128 }}>
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{tip.title}</div>
            {tip.rows.map((row, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: row.color, display: 'inline-block' }} />
                <span style={{ color: 'var(--color-text-secondary)' }}>{row.label}</span>
                <span className="font-bold tabular-nums ml-auto" style={{ color: 'var(--color-text)' }}>{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-[10px] mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
        Left axis: {bs.label} · right axis: {ls.label} · empty days shown as zero. Transfer days use created date; sale days use sale date — don’t over-read single-day gaps.
      </p>
    </div>
  );
}

// ── donut (hover-explode + center swap) ─────────────────────────────────────
function DonutChart({ data, centerLabel, isMoney, size = 168, top = 6 }) {
  const mounted = useMounted();
  const [hi, setHi] = useState(-1);
  const base = (data || []).filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  let items = base;
  if (base.length > top + 1) {
    const rest = base.slice(top).reduce((s, d) => s + d.value, 0);
    items = [...base.slice(0, top), { label: 'Others', value: rest, color: '#6b7280' }];
  }
  const total = items.reduce((s, d) => s + d.value, 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 2;
  const fmt = (v) => (isMoney ? money(v) : (v || 0).toLocaleString());
  const center = (hi >= 0 && items[hi])
    ? { big: fmt(items[hi].value), small: `${items[hi].label} · ${total ? Math.round(items[hi].value / total * 100) : 0}%` }
    : { big: fmt(total), small: centerLabel };
  let a = -Math.PI / 2;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <g style={{ transformOrigin: 'center', transformBox: 'fill-box', transition: 'opacity .5s ease, transform .5s cubic-bezier(.2,.8,.2,1)', opacity: mounted ? 1 : 0, transform: mounted ? 'scale(1) rotate(0deg)' : 'scale(.85) rotate(-25deg)' }}>
          {total === 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth="14" />}
          {items.map((d, i) => {
            const frac = d.value / total;
            const a0 = a, a1 = a + frac * Math.PI * 2; a = a1;
            const mid = (a0 + a1) / 2, ex = hi === i ? 8 : 0;
            const color = d.color || PALETTE[i % PALETTE.length];
            const node = items.length === 1
              ? <circle cx={cx} cy={cy} r={r} fill={color} />
              : <path d={slicePath(cx, cy, r, a0, a1)} fill={color} />;
            return (
              <g key={i} transform={`translate(${Math.cos(mid) * ex},${Math.sin(mid) * ex})`}
                onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(-1)}
                style={{ transition: 'transform .25s cubic-bezier(.2,.8,.2,1), opacity .2s', opacity: hi >= 0 && hi !== i ? 0.5 : 1, cursor: 'pointer' }}>{node}</g>
            );
          })}
          <circle cx={cx} cy={cy} r={r * 0.6} fill="var(--color-bg)" />
        </g>
        <text x={cx} y={cy - 1} textAnchor="middle" fontSize={size * 0.15} fontWeight="800" fill="var(--color-text)">{center.big}</text>
        <text x={cx} y={cy + size * 0.13} textAnchor="middle" fontSize={size * 0.072} fill="var(--color-text-tertiary)">{center.small}</text>
      </svg>
      <div className="space-y-1 min-w-0 flex-1">
        {items.map((d, i) => (
          <div key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(-1)}
            className="flex items-center gap-2 text-xs cursor-pointer" style={{ opacity: hi >= 0 && hi !== i ? 0.5 : 1 }}>
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color || PALETTE[i % PALETTE.length] }} />
            <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>{d.label}</span>
            <span className="font-bold tabular-nums ml-auto" style={{ color: 'var(--color-text)' }}>{fmt(d.value)}</span>
            <span className="tabular-nums text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{total ? Math.round(d.value / total * 100) : 0}%</span>
          </div>
        ))}
        {items.length === 0 && <div className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>No data in range.</div>}
      </div>
    </div>
  );
}

// ── goal-pace ring ──────────────────────────────────────────────────────────
function RingGauge({ pct, projectedPct, label, sub, color = '#16a34a', size = 128 }) {
  const mounted = useMounted();
  const r = size / 2 - 13, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  const p = Math.max(0, pct || 0);
  const off = mounted ? circ * (1 - Math.min(1, p / 100)) : circ;
  const projAngle = projectedPct != null ? (-Math.PI / 2 + Math.min(100, Math.max(0, projectedPct)) / 100 * 2 * Math.PI) : null;
  const pj = projAngle != null ? polar(cx, cy, r, projAngle) : null;
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth="12" opacity="0.7" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={off} transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)' }} />
        {pj && <circle cx={pj[0]} cy={pj[1]} r="3.5" fill="#d97706" stroke="var(--color-surface)" strokeWidth="1.5" />}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={size * 0.2} fontWeight="800" fill="var(--color-text)">{pct != null ? `${pct}%` : '—'}</text>
        <text x={cx} y={cy + size * 0.14} textAnchor="middle" fontSize={size * 0.085} fill="var(--color-text-tertiary)">{label}</text>
      </svg>
      {sub && <p className="text-[11px] mt-1 text-center" style={{ color: 'var(--color-text-secondary)' }}>{sub}</p>}
    </div>
  );
}

// ── masked member leaderboard ───────────────────────────────────────────────
const LB_METRICS = [
  { k: 'sales', label: 'Sales' }, { k: 'gross', label: 'Gross' },
  { k: 'transfers', label: 'Transfers' }, { k: 'callbacks', label: 'Callbacks' },
  { k: 'fronted', label: 'Fronted wins' },
];
const MEDAL = ['#f59e0b', '#94a3b8', '#b45309'];
function Leaderboard({ members, team, dn }) {
  const mounted = useMounted();
  const [metric, setMetric] = useState('sales');
  const [showAll, setShowAll] = useState(false);
  const isMoney = metric === 'gross' || metric === 'fronted_gross';
  const sorted = [...(members || [])].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  // medals computed over NON-lead members so the lead is never crowned.
  const medalOf = new Map(sorted.filter(m => m.user_id !== team?.lead_user_id).slice(0, 3).map((m, i) => [m.user_id, i]));
  const hi = Math.max(1, ...sorted.map(m => m[metric] || 0));
  const shown = showAll ? sorted : sorted.slice(0, 15);
  const fmt = (v) => (isMoney ? money(v) : (v || 0));
  return (
    <div className="rounded-2xl p-4" style={box}>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <p className="text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}><Award size={12} /> Member leaderboard</p>
        <div className="flex items-center gap-1 flex-wrap">
          {LB_METRICS.map(m => <Pill key={m.k} active={metric === m.k} onClick={() => setMetric(m.k)}>{m.label}</Pill>)}
        </div>
      </div>
      <div className="space-y-1.5">
        {shown.map((m, i) => {
          const medal = medalOf.get(m.user_id);
          const v = m[metric] || 0;
          return (
            <div key={m.user_id} className="flex items-center gap-2" title={`${dn(m)} · ${m.transfers} transfers · ${m.sales} sales · ${money(m.gross)} · ${m.callbacks} callbacks`}>
              <span className="w-5 flex-shrink-0 text-center">
                {medal != null
                  ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-black text-white" style={{ backgroundColor: MEDAL[medal] }}>{medal + 1}</span>
                  : <span className="text-[11px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</span>}
              </span>
              <span className="text-[11px] truncate w-28 flex-shrink-0 flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                {m.user_id === team?.lead_user_id && <Crown size={10} style={{ color: '#94a3b8' }} />}{dn(m)}
              </span>
              <div className="flex-1 h-4 rounded" style={{ background: 'var(--color-bg-secondary)' }}>
                <div className="h-4 rounded" style={{ width: mounted ? `${Math.max(2, (v / hi) * 100)}%` : '0%', background: 'var(--gradient-sidebar)', transition: `width .7s cubic-bezier(.2,.8,.2,1) ${Math.min(i, 20) * 0.04}s` }} />
              </div>
              <span className="text-[11px] font-bold tabular-nums w-16 text-right flex-shrink-0" style={{ color: 'var(--color-text)' }}>{fmt(v)}</span>
            </div>
          );
        })}
        {sorted.length === 0 && <p className="text-xs italic text-center py-3" style={{ color: 'var(--color-text-tertiary)' }}>No members.</p>}
      </div>
      {sorted.length > 15 && (
        <button onClick={() => setShowAll(s => !s)} className="text-[11px] font-semibold mt-2" style={{ color: 'var(--color-primary-600)' }}>
          {showAll ? 'Show top 15' : `Show all ${sorted.length}`}
        </button>
      )}
    </div>
  );
}

// ── assembled analytics body ────────────────────────────────────────────────
export default function TeamAnalytics({ report, team }) {
  const [tableOpen, setTableOpen] = useState(false);
  const totals = report?.totals || {};
  const members = report?.members || [];
  const mo = report?.momentum || {};
  const goal = report?.goal || {};
  const leadId = team?.lead_user_id;
  const dn = (m) => (m.user_id === leadId ? 'Team Lead' : (m.name || 'Unknown'));

  const filled = useMemo(() => zeroFillTrend(report?.trend, report?.range?.from, report?.range?.to), [report]);
  const spark = (key) => filled.slice(-7).map(r => r[key] || 0);

  const grossData = members.map((m, i) => ({ label: dn(m), value: m.gross, color: PALETTE[i % PALETTE.length] }));
  const splitData = [
    { label: 'Fronting (transfers)', value: totals.transfers || 0, color: '#2563eb' },
    { label: 'Closing (sales)', value: totals.sales || 0, color: '#16a34a' },
  ];

  const rangeDays = Math.max(1, filled.length);
  const projMonthlySales = (totals.sales || 0) / rangeDays * 30;
  const goalPct = goal.monthly_sales ? Math.round(100 * (totals.sales || 0) / goal.monthly_sales) : null;
  const projPct = goal.monthly_sales ? Math.round(100 * projMonthlySales / goal.monthly_sales) : null;
  const participation = report?.member_count ? Math.round(100 * (totals.active_members || 0) / report.member_count) : null;
  const cbPerSale = totals.sales ? +(((totals.callbacks || 0) / totals.sales).toFixed(1)) : null;

  return (
    <div className="space-y-4">
      {report?.capped && (
        <div className="rounded-xl p-2.5 flex items-center gap-2 text-xs" style={{ backgroundColor: 'var(--color-warning-50,#fffbeb)', color: 'var(--color-warning-700,#b45309)', border: '1px solid var(--color-warning-200,#fde68a)' }}>
          <AlertTriangle size={14} /> Large result set — some rows were capped; totals may undercount. Narrow the date range for exact figures.
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KpiTile label="Transfers" icon={<TrendingUp size={11} />} color="#2563eb" value={totals.transfers ?? 0} deltaPct={mo.transfers_pct} spark={spark('transfers')} />
        <KpiTile label="Sales" icon={<DollarSign size={11} />} color="#16a34a" value={totals.sales ?? 0} deltaPct={mo.sales_pct} spark={spark('sales')} />
        <KpiTile label="Gross" icon={<DollarSign size={11} />} color="#d97706" value={money(totals.gross)} deltaPct={mo.gross_pct} spark={spark('gross')} />
        <KpiTile label="MRR" icon={<Repeat size={11} />} color="#7c3aed" value={money(totals.mrr)} deltaPct={mo.mrr_pct} />
        <KpiTile label="Avg deal" icon={<DollarSign size={11} />} color="#d97706" value={totals.avg_deal != null ? money(totals.avg_deal) : '—'} />
        <KpiTile label="Close rate" icon={<Target size={11} />} color="#16a34a" value={totals.close_rate != null ? `${totals.close_rate}%` : '—'} />
      </div>

      {/* secondary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiTile label="Callbacks" icon={<Phone size={11} />} color="#9333ea" value={totals.callbacks ?? 0} spark={spark('callbacks')} />
        <KpiTile label="Fronted wins" icon={<TrendingUp size={11} />} color="#0891b2" value={totals.fronted ?? 0} />
        <KpiTile label="Active" icon={<Users size={11} />} color="#2563eb" value={participation != null ? `${totals.active_members}/${report.member_count}` : (totals.active_members ?? 0)} />
        <KpiTile label="Callbacks / sale" icon={<Phone size={11} />} color="#9333ea" value={cbPerSale != null ? cbPerSale : '—'} />
      </div>

      {/* hero combo */}
      <Combo3DChart trend={filled} />

      {/* gross-share donut + goal pace */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl p-4" style={box}>
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Gross share by member</p>
          <DonutChart data={grossData} centerLabel="TEAM GROSS" isMoney />
        </div>
        <div className="rounded-2xl p-4 flex flex-col items-center justify-center" style={box}>
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2 self-start" style={{ color: 'var(--color-text-tertiary)' }}>Goal pace (monthly sales)</p>
          {goal.monthly_sales
            ? <RingGauge pct={goalPct} projectedPct={projPct} label="of goal" color={goalPct >= 100 ? '#16a34a' : (projPct != null && projPct >= 100 ? '#2563eb' : '#d97706')}
                sub={`${totals.sales}/${goal.monthly_sales} sales · projected ~${Math.round(projMonthlySales)} (${projPct ?? '—'}%)`} />
            : <p className="text-xs italic py-8" style={{ color: 'var(--color-text-tertiary)' }}>No monthly sales goal set for this team.</p>}
        </div>
      </div>

      {/* leaderboard */}
      <Leaderboard members={members} team={team} dn={dn} />

      {/* fronting/closing split + funnel stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl p-4" style={box}>
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Fronting vs closing</p>
          <DonutChart data={splitData} centerLabel="ACTIVITY" size={150} top={6} />
        </div>
        <div className="rounded-2xl p-4 grid grid-cols-2 gap-2" style={box}>
          {[
            { l: 'Close rate', v: totals.close_rate != null ? `${totals.close_rate}%` : '—', c: '#16a34a' },
            { l: 'Conversion', v: totals.conversion != null ? `${totals.conversion}%` : '—', c: '#2563eb' },
            { l: 'Participation', v: participation != null ? `${participation}%` : '—', c: '#0891b2' },
            { l: 'Avg MRR/deal', v: totals.sales ? money((totals.mrr || 0) / totals.sales) : '—', c: '#7c3aed' },
          ].map((s, i) => (
            <div key={i} className="rounded-xl p-3 text-center" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>{s.l}</div>
              <div className="text-lg font-extrabold mt-0.5 tabular-nums" style={{ color: s.c }}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* dense table (collapsible, masked) */}
      <div className="rounded-2xl overflow-hidden" style={box}>
        <button onClick={() => setTableOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-2.5 text-left">
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>Full member table</span>
          <ChevronDown size={16} style={{ color: 'var(--color-text-tertiary)', transform: tableOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
        {tableOpen && (
          <div className="overflow-x-auto border-t" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-xs">
              <thead><tr style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                {['#', 'Member', 'Transfers', 'Assigned', 'Sales', 'Gross', 'MRR', 'Fronted', 'Callbacks', 'Avg deal'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}
              </tr></thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={m.user_id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-1.5" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</td>
                    <td className="px-3 py-1.5 font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{dn(m)}</td>
                    <td className="px-3 py-1.5">{m.transfers}</td>
                    <td className="px-3 py-1.5">{m.assigned}</td>
                    <td className="px-3 py-1.5">{m.sales}</td>
                    <td className="px-3 py-1.5">{money(m.gross)}</td>
                    <td className="px-3 py-1.5">{money(m.mrr)}</td>
                    <td className="px-3 py-1.5">{m.fronted}</td>
                    <td className="px-3 py-1.5">{m.callbacks}</td>
                    <td className="px-3 py-1.5">{m.avg_deal != null ? money(m.avg_deal) : '—'}</td>
                  </tr>
                ))}
                {members.length === 0 && <tr><td colSpan={10} className="text-center py-4 italic" style={{ color: 'var(--color-text-tertiary)' }}>No members.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Includes nested sub-teams. Sales credited to the closer (won deals); transfers to the fronter; gross = down payment; MRR = monthly payment. Live from records. The team lead’s name is hidden in this analysis.
      </p>
    </div>
  );
}
