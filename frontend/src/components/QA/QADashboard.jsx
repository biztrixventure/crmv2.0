// ============================================================================
// QADashboard — role-aware QA landing. Agent sees their own workload + scores;
// manager sees a per-agent breakdown. Big stat cards, per-method cards, and
// dependency-free SVG charts (radar / donut / bars). Themed via CSS variables.
// ============================================================================
import { useState, useEffect } from 'react';
import { Loader2, Gauge, ListTodo, CheckCircle2, TrendingUp, CalendarDays, Users, ArrowRight } from 'lucide-react';
import client from '../../api/client';

export const WT_META = {
  tra:          { label: 'TRA',      sub: 'Transfers',      color: '#2563eb' },
  rcm:          { label: 'RCM',      sub: 'Random calls',   color: '#d97706' },
  closer_sales: { label: 'Closed',   sub: 'Closed sales',   color: '#059669' },
  closer_dispo: { label: 'Unclosed', sub: 'Unclosed sales', color: '#dc2626' },
};
const WT = ['tra', 'rcm', 'closer_sales', 'closer_dispo'];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ── SVG charts ───────────────────────────────────────────────────────────────
function Radar({ axes, size = 220, max }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 34;
  const n = axes.length || 1;
  const top = max || Math.max(1, ...axes.map(a => a.value));
  const pt = (i, frac) => { const ang = (Math.PI * 2 * i) / n - Math.PI / 2; return [cx + Math.cos(ang) * r * frac, cy + Math.sin(ang) * r * frac]; };
  const poly = axes.map((a, i) => pt(i, Math.max(0.02, a.value / top)).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1];
  return (
    <svg width={size} height={size} style={{ maxWidth: '100%' }}>
      {rings.map((f, k) => <polygon key={k} points={axes.map((_, i) => pt(i, f).join(',')).join(' ')} fill="none" stroke="var(--color-border)" strokeWidth="1" opacity={0.7} />)}
      {axes.map((_, i) => { const [x, y] = pt(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--color-border)" strokeWidth="1" opacity={0.6} />; })}
      <polygon points={poly} fill="var(--color-primary-500)" fillOpacity="0.28" stroke="var(--color-primary-600)" strokeWidth="2" />
      {axes.map((a, i) => { const [x, y] = pt(i, 1); const c = a.color || 'var(--color-primary-600)'; const dot = pt(i, Math.max(0.02, a.value / top)); return (
        <g key={i}>
          <circle cx={dot[0]} cy={dot[1]} r="3.5" fill={c} />
          <text x={x} y={y} dx={x < cx - 4 ? -6 : x > cx + 4 ? 6 : 0} dy={y < cy ? -6 : 14} textAnchor={x < cx - 4 ? 'end' : x > cx + 4 ? 'start' : 'middle'} fontSize="11" fontWeight="700" fill="var(--color-text-secondary)">{a.label}</text>
          <text x={x} y={y} dx={x < cx - 4 ? -6 : x > cx + 4 ? 6 : 0} dy={y < cy ? 6 : 26} textAnchor={x < cx - 4 ? 'end' : x > cx + 4 ? 'start' : 'middle'} fontSize="11" fontWeight="800" fill={c}>{a.value}</text>
        </g>
      ); })}
    </svg>
  );
}

function Donut({ pass = 0, fail = 0, size = 130 }) {
  const total = pass + fail, r = size / 2 - 12, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r;
  const passLen = total ? (pass / total) * circ : 0;
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-border)" strokeWidth="12" />
      {total > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="#dc2626" strokeWidth="12" strokeDasharray={`${circ} ${circ}`} transform={`rotate(-90 ${cx} ${cy})`} />}
      {total > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke="#059669" strokeWidth="12" strokeDasharray={`${passLen} ${circ}`} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cy})`} />}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--color-text)">{pct(pass, total)}%</text>
      <text x={cx} y={cy + 15} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--color-text-tertiary)">PASS RATE</text>
    </svg>
  );
}

function Bars({ data, height = 90, color = 'var(--color-primary-500)' }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
      {data.map((d, i) => (
        <div key={i} title={`${d.label}: ${d.value}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
          <div style={{ width: '100%', minHeight: 2, height: `${(d.value / max) * 100}%`, background: color, borderRadius: 3, opacity: d.value ? 1 : 0.25 }} />
        </div>
      ))}
    </div>
  );
}

// mini per-method stacked bar (done vs pending)
function MethodMini({ m }) {
  const total = Math.max(1, m.total || 0);
  return (
    <div style={{ height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--color-border)', display: 'flex' }}>
      <div style={{ width: `${pct(m.done || 0, total)}%`, background: '#059669' }} />
      <div style={{ width: `${pct(m.pending || 0, total)}%`, background: 'var(--color-primary-400)' }} />
    </div>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────
const Card = ({ children, style }) => <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 16, ...style }}>{children}</div>;
function Stat({ icon: Icon, label, value, sub, tint = 'var(--color-primary-600)' }) {
  return (
    <Card>
      <div className="flex items-center gap-2" style={{ color: 'var(--color-text-tertiary)' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: `color-mix(in srgb, ${tint} 15%, transparent)`, color: tint, display: 'grid', placeItems: 'center' }}><Icon size={16} /></span>
        <span className="text-[11px] font-bold uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-3xl font-extrabold" style={{ color: 'var(--color-text)' }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</div>}
    </Card>
  );
}

function MethodCard({ wt, m, day }) {
  const meta = WT_META[wt];
  // Date picked → show THAT DAY's tasks (assigned that day) + that day's done.
  // Otherwise → the live pending backlog + range done.
  const pending = day ? (m.day_pending || 0) : (m.pending || 0);
  const done = day ? (m.day_done || 0) : (m.done || 0);
  const mini = day ? { done: m.day_done || 0, pending: m.day_pending || 0, total: m.day_total || 0 } : m;
  return (
    <Card style={{ borderTop: `3px solid ${meta.color}` }}>
      <div className="flex items-baseline justify-between">
        <div><div className="text-base font-extrabold" style={{ color: 'var(--color-text)' }}>{meta.label}</div><div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{meta.sub}</div></div>
        <div className="text-right"><div className="text-2xl font-extrabold" style={{ color: meta.color }}>{pending}</div><div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{day ? 'Pending that day' : 'Pending'}</div></div>
      </div>
      <div className="mt-3"><MethodMini m={mini} /></div>
      <div className="flex items-center justify-between mt-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <span>{day ? 'Done that day' : 'Done'} <b style={{ color: 'var(--color-text)' }}>{done}</b></span>
        {day && <span>Tasks <b style={{ color: 'var(--color-text)' }}>{m.day_total || 0}</b></span>}
        <span>Pass <b style={{ color: '#059669' }}>{pct(m.pass || 0, (m.pass || 0) + (m.fail || 0))}%</b></span>
      </div>
    </Card>
  );
}

// ── agent dashboard ──────────────────────────────────────────────────────────
export function QAAgentDashboard({ companyId }) {
  const { data, loading, date, setDate } = useDashboard(companyId);
  if (loading || !data) return <Loading />;
  const t = data.totals || {}, by = data.by_method || {};
  const radar = WT.map(w => ({ label: WT_META[w].label, value: (by[w]?.total) || 0, color: WT_META[w].color }));
  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <Welcome name={data.me?.name} sub="Here's your QA workload and scoring." date={date} setDate={setDate} methods={data.me?.methods} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={ListTodo} label={date ? 'Pending that day' : 'Pending'} value={date ? (t.day_pending || 0) : (t.pending || 0)} sub={date ? `of ${t.day_total || 0} tasks` : 'tasks to review'} tint="#d97706" />
        <Stat icon={CheckCircle2} label={date ? 'Done that day' : 'Done'} value={date ? (t.done_day || 0) : (t.done || 0)} sub={date ? `on ${date}` : 'in range'} tint="#059669" />
        <Stat icon={Gauge} label="Pass rate" value={`${pct(t.pass || 0, (t.pass || 0) + (t.fail || 0))}%`} sub={`${t.pass || 0} pass · ${t.fail || 0} fail`} />
        <Stat icon={TrendingUp} label="Avg score" value={t.avg_score ?? '—'} sub="across reviews" tint="#7c3aed" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {WT.map(w => <MethodCard key={w} wt={w} m={by[w] || {}} day={date} />)}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card><div className="text-sm font-bold mb-1" style={{ color: 'var(--color-text)' }}>Workload by method</div><div className="grid place-items-center"><Radar axes={radar} /></div></Card>
        <Card>
          <div className="text-sm font-bold mb-3" style={{ color: 'var(--color-text)' }}>Reviews — last 14 days</div>
          <Bars data={(data.daily || []).map(d => ({ label: d.date.slice(5), value: d.done }))} />
          <div className="flex items-center gap-4 mt-4">
            <Donut pass={t.pass || 0} fail={t.fail || 0} />
            <div className="text-xs space-y-1" style={{ color: 'var(--color-text-secondary)' }}>
              <div className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 3, background: '#059669', display: 'inline-block' }} /> Passed {t.pass || 0}</div>
              <div className="flex items-center gap-1.5"><span style={{ width: 10, height: 10, borderRadius: 3, background: '#dc2626', display: 'inline-block' }} /> Failed {t.fail || 0}</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── manager dashboard ────────────────────────────────────────────────────────
export function QAManagerDashboard({ companyId, onOpenReports }) {
  const { data, loading, date, setDate } = useDashboard(companyId);
  const [detail, setDetail] = useState(null);   // selected QA agent for drill-down
  if (loading || !data) return <Loading />;
  const t = data.totals || {}, by = data.by_method || {}, agents = data.agents || [];
  const radar = WT.map(w => ({ label: WT_META[w].label, value: (by[w]?.total) || 0, color: WT_META[w].color }));
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <Welcome name={data.me?.name} sub="Your team's QA performance at a glance." date={date} setDate={setDate} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Active agents" value={agents.length} sub="with work in range" />
        <Stat icon={ListTodo} label={date ? 'Pending that day' : 'Pending'} value={date ? (t.day_pending || 0) : (t.pending || 0)} sub={date ? `of ${t.day_total || 0} tasks` : 'team backlog'} tint="#d97706" />
        <Stat icon={CheckCircle2} label={date ? 'Done that day' : 'Done'} value={date ? (t.done_day || 0) : (t.done || 0)} sub={date ? `on ${date}` : 'in range'} tint="#059669" />
        <Stat icon={Gauge} label="Team pass rate" value={`${pct(t.pass || 0, (t.pass || 0) + (t.fail || 0))}%`} sub={`avg score ${t.avg_score ?? '—'}`} tint="#7c3aed" />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card><div className="text-sm font-bold mb-1" style={{ color: 'var(--color-text)' }}>Team workload by method</div><div className="grid place-items-center"><Radar axes={radar} /></div></Card>
        <Card><div className="text-sm font-bold mb-3" style={{ color: 'var(--color-text)' }}>Team reviews — last 14 days</div><Bars data={(data.daily || []).map(d => ({ label: d.date.slice(5), value: d.done }))} height={120} />
          <div className="grid grid-cols-4 gap-2 mt-4">{WT.map(w => <div key={w} className="text-center"><div className="text-lg font-extrabold" style={{ color: WT_META[w].color }}>{(by[w]?.total) || 0}</div><div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{WT_META[w].label}</div></div>)}</div>
        </Card>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><Users size={16} /> QA agents ({agents.length}) <span className="text-[11px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>— click an agent for their review report</span></div>
          {onOpenReports && <button onClick={onOpenReports} className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>Fronter / closer quality reports <ArrowRight size={12} /></button>}
        </div>
        {agents.length === 0 ? <Card><div className="text-sm text-center py-6" style={{ color: 'var(--color-text-tertiary)' }}>No agent activity in this window.</div></Card> : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {agents.map(a => <AgentCard key={a.user_id} a={a} date={date} onOpen={() => setDetail(a)} />)}
          </div>
        )}
      </div>

      {detail && <AgentDetail agent={detail} companyId={companyId} date={date} range={data.range} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ── per-QA-agent drill-down (the agent's OWN review activity — NOT the
// fronter/closer quality report, which is the separate Reports tab). ──────────
function AgentDetail({ agent, companyId, date, range, onClose }) {
  const [rows, setRows] = useState(null);
  const from = date || range?.from, to = date || range?.to;
  useEffect(() => {
    const params = { reviewer_id: agent.user_id, date_from: from, date_to: to };
    if (companyId) params.company_id = companyId;
    client.get('qa/reviews', { params }).then(r => setRows(r.data.reviews || [])).catch(() => setRows([]));
  }, [agent.user_id, from, to, companyId]);
  const radar = WT.map(w => ({ label: WT_META[w].label, value: (agent.by_method[w]?.total) || 0, color: WT_META[w].color }));
  const scoreOf = (r) => r.final_score ?? r.quality_score ?? r.total_score;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,20,35,.5)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} className="w-full" style={{ maxWidth: 860, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 18, padding: 18 }}>
        <div className="flex items-center gap-3">
          <span style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--color-primary-100)', color: 'var(--color-primary-700)', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{(agent.name || '?').slice(0, 2).toUpperCase()}</span>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-extrabold" style={{ color: 'var(--color-text)' }}>{agent.name}</div>
            <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>QA agent · {date ? `report for ${date}` : `${from} → ${to}`}</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 22, color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>

        <div className="grid grid-cols-4 gap-2 mt-4">
          <MiniStat label={date ? 'Pending' : 'Pending'} value={date ? (agent.day_pending || 0) : agent.pending} tint="#d97706" />
          <MiniStat label={date ? 'Done that day' : 'Done'} value={date ? (agent.done_day || 0) : agent.done} tint="#059669" />
          <MiniStat label="Pass rate" value={`${pct(agent.pass, agent.pass + agent.fail)}%`} />
          <MiniStat label="Avg score" value={agent.avg_score ?? '—'} tint="#7c3aed" />
        </div>

        <div className="grid md:grid-cols-2 gap-4 mt-4 items-center">
          <div className="grid place-items-center"><Radar axes={radar} size={180} /></div>
          <div className="space-y-2">
            {WT.map(w => { const m = agent.by_method[w] || {}; return (
              <div key={w} className="text-xs">
                <div className="flex justify-between" style={{ color: 'var(--color-text-secondary)' }}><span style={{ color: WT_META[w].color, fontWeight: 700 }}>{WT_META[w].label}</span><span>{date ? `${m.done_day || 0} done · ${m.day_pending || 0} pending` : `${m.done || 0} done · ${m.pending || 0} pending`}</span></div>
                <MethodMini m={date ? { done: m.day_done || 0, pending: m.day_pending || 0, total: m.day_total || 0 } : m} />
              </div>
            ); })}
          </div>
        </div>

        <div className="text-sm font-bold mt-5 mb-2" style={{ color: 'var(--color-text)' }}>Reviews by this agent {rows && `(${rows.length})`}</div>
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', maxHeight: 320, overflowY: 'auto' }}>
          {rows === null ? <div className="py-6 text-center"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>
            : rows.length === 0 ? <div className="py-6 text-center text-sm" style={{ color: 'var(--color-text-tertiary)' }}>No reviews in this window.</div>
            : (
              <table className="w-full text-xs">
                <thead><tr style={{ background: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)' }}>
                  {['Date', 'Method', 'Reviewed', 'Customer', 'Result', 'Score'].map(h => <th key={h} className="text-left px-3 py-2 font-bold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                      <td className="px-3 py-1.5 whitespace-nowrap">{r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-1.5"><span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: `color-mix(in srgb, ${WT_META[r.method]?.color || '#888'} 15%, transparent)`, color: WT_META[r.method]?.color || '#888' }}>{WT_META[r.method]?.label || r.method}</span></td>
                      <td className="px-3 py-1.5 truncate" style={{ maxWidth: 140, color: 'var(--color-text)' }}>{r.agent || r.subject_name || '—'}</td>
                      <td className="px-3 py-1.5 truncate" style={{ maxWidth: 130 }}>{r.customer_name || '—'}</td>
                      <td className="px-3 py-1.5 font-bold" style={{ color: r.passed === false ? '#dc2626' : r.passed === true ? '#059669' : 'var(--color-text-tertiary)' }}>{r.passed === true ? 'Pass' : r.passed === false ? 'Fail' : (r.autofail_result || '—')}</td>
                      <td className="px-3 py-1.5 font-bold" style={{ color: 'var(--color-text)' }}>{scoreOf(r) != null ? scoreOf(r) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </div>
  );
}
const MiniStat = ({ label, value, tint = 'var(--color-primary-600)' }) => (
  <div style={{ background: 'var(--color-bg-secondary)', borderRadius: 12, padding: 10, textAlign: 'center' }}>
    <div className="text-xl font-extrabold" style={{ color: tint }}>{value}</div>
    <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{label}</div>
  </div>
);

function AgentCard({ a, date, onOpen }) {
  const radar = WT.map(w => ({ label: WT_META[w].label, value: (a.by_method[w]?.total) || 0, color: WT_META[w].color }));
  const pending = date ? (a.day_pending || 0) : a.pending;
  const done = date ? (a.done_day || 0) : a.done;
  return (
    <div onClick={() => onOpen?.()} style={{ cursor: 'pointer' }}>
      <Card style={{ transition: 'border-color .12s' }}>
        <div className="flex items-center gap-3">
          <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--color-primary-100)', color: 'var(--color-primary-700)', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{(a.name || '?').slice(0, 2).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <div className="font-bold truncate" style={{ color: 'var(--color-text)' }}>{a.name}</div>
            <div className="flex gap-1 mt-0.5 flex-wrap">{(a.methods || []).map(m => <span key={m} className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: `color-mix(in srgb, ${WT_META[m]?.color || '#888'} 16%, transparent)`, color: WT_META[m]?.color || '#888' }}>{WT_META[m]?.label || m}</span>)}</div>
          </div>
          <div className="text-right"><div className="text-2xl font-extrabold" style={{ color: '#d97706' }}>{pending}</div><div className="text-[9px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{date ? 'Pending·day' : 'Pending'}</div></div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3 items-center">
          <Radar axes={radar} size={150} />
          <div className="space-y-1.5">
            {WT.map(w => { const m = a.by_method[w] || {}; if (!m.total && !m.day_total) return null; return (
              <div key={w} className="text-[11px]">
                <div className="flex justify-between" style={{ color: 'var(--color-text-secondary)' }}><span style={{ color: WT_META[w].color, fontWeight: 700 }}>{WT_META[w].label}</span><span>{date ? (m.done_day || 0) : (m.done || 0)}/{date ? (m.day_total || 0) : (m.total || 0)}</span></div>
                <MethodMini m={date ? { done: m.day_done || 0, pending: m.day_pending || 0, total: m.day_total || 0 } : m} />
              </div>
            ); })}
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Pass <b style={{ color: '#059669' }}>{pct(a.pass, a.pass + a.fail)}%</b> · Avg <b style={{ color: 'var(--color-text)' }}>{a.avg_score ?? '—'}</b> · Done <b style={{ color: 'var(--color-text)' }}>{done}</b></div>
          <span className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }}>View report <ArrowRight size={12} /></span>
        </div>
      </Card>
    </div>
  );
}

// ── hook + chrome ────────────────────────────────────────────────────────────
function useDashboard(companyId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');   // '' = whole range; a value = single-day "done that day"
  useEffect(() => {
    let dead = false; setLoading(true);
    const params = {}; if (companyId) params.company_id = companyId; if (date) params.date = date;
    client.get('qa/dashboard', { params }).then(r => { if (!dead) { setData(r.data); setLoading(false); } }).catch(() => { if (!dead) setLoading(false); });
    return () => { dead = true; };
  }, [companyId, date]);
  return { data, loading, date, setDate };
}

function Welcome({ name, sub, date, setDate, methods }) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div className="rounded-2xl p-5 flex items-center gap-4 flex-wrap" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#6366f1,#7c3aed))' }}>
      <div className="flex-1 min-w-0">
        <div className="text-white/80 text-sm font-semibold">{greet},</div>
        <div className="text-2xl font-extrabold text-white truncate">{name || 'there'} 👋</div>
        <div className="text-white/80 text-sm mt-0.5">{sub}</div>
        {methods && methods.length > 0 && <div className="flex gap-1 mt-2">{methods.map(m => <span key={m} className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.22)', color: '#fff' }}>{WT_META[m]?.label || m}</span>)}</div>}
      </div>
      <label className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(255,255,255,0.16)' }}>
        <CalendarDays size={16} className="text-white" />
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-transparent text-white text-sm font-semibold outline-none" style={{ colorScheme: 'dark' }} />
        {date && <button onClick={() => setDate('')} className="text-white/80 text-xs font-bold">clear</button>}
      </label>
    </div>
  );
}

const Loading = () => <div className="py-20 text-center"><Loader2 className="animate-spin inline" style={{ color: 'var(--color-text-tertiary)' }} /></div>;
