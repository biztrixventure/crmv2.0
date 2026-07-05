import { useMemo, useState } from 'react';
import { Loader2, Send, CheckCircle2, XCircle } from 'lucide-react';
import { computeSheetReview, truncPct1 } from '../../utils/qaSheetFormula';

// ============================================================================
// SheetScoreRow — horizontal, spreadsheet-style scoring strip for sheet_v2
// scorecards (WaveTech Master Evaluation Sheet replication). One call = ONE
// horizontal row. Three aligned header/value bands like the sheet:
//   1) coloured GROUP band (Ratings / Auto-Fail / Penalties / Sale Compliance /
//      Tracking / Outcome / Score)
//   2) column labels
//   3) the editable value cells (+ live computed columns on the right)
// 0–4 rating cells show an in-cell data-bar (red→green, conditional-formatting
// style); computed score columns show a fill bar. Scrolls sideways on narrow
// screens; never collapses to a vertical stack.
// ============================================================================

const selStyle = { background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 6, padding: '4px 6px', fontSize: 13, width: '100%' };
const pretty = (s) => String(s ?? '').replace(/_/g, ' ').trim();

const GROUP_TINT = {
  meta: 'var(--color-surface-hover)', rating: 'rgba(37,99,235,0.10)', autofail: 'rgba(220,38,38,0.10)',
  penalty: 'rgba(217,119,6,0.10)', tracking: 'rgba(107,114,128,0.12)', quality: 'rgba(22,163,74,0.10)',
  outcome: 'rgba(124,58,237,0.10)', computed: 'rgba(22,163,74,0.16)',
};
const GROUP_BAND = {
  meta: 'rgba(107,114,128,0.22)', rating: 'rgba(37,99,235,0.22)', autofail: 'rgba(220,38,38,0.22)',
  penalty: 'rgba(217,119,6,0.22)', tracking: 'rgba(107,114,128,0.20)', quality: 'rgba(22,163,74,0.22)',
  outcome: 'rgba(124,58,237,0.22)', computed: 'rgba(22,163,74,0.30)',
};
const GROUP_LABEL = {
  meta: 'Call info', rating: 'Ratings (0–4)', autofail: 'Auto-Fail', penalty: 'Penalties',
  tracking: 'Tracking', quality: 'Sale Compliance', outcome: 'Outcome', computed: 'Score',
};

function YN({ value, onChange, disabled }) {
  const y = String(value || '').toUpperCase() === 'Y';
  const n = String(value || '').toUpperCase() === 'N';
  return (
    <div className="relative">
      <div className="absolute inset-0 rounded pointer-events-none" style={{ background: y ? 'rgba(22,163,74,0.14)' : n ? 'rgba(220,38,38,0.10)' : 'transparent' }} />
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} style={{ ...selStyle, position: 'relative', fontWeight: 700, color: y ? '#059669' : n ? '#dc2626' : 'var(--color-text)' }}>
        <option value="">—</option><option value="Y">Y</option><option value="N">N</option>
      </select>
    </div>
  );
}

// 0–N rating with an in-cell data bar (red→green by value).
function Rating({ value, scale = 4, onChange, disabled }) {
  const has = value !== '' && value != null;
  const v = has ? Number(value) : null;
  const frac = v == null ? 0 : Math.max(0, Math.min(1, v / scale));
  const hue = Math.round(frac * 120);                    // 0=red → 120=green
  const color = v == null ? 'transparent' : `hsl(${hue},70%,45%)`;
  return (
    <div className="relative rounded" style={{ background: v == null ? 'transparent' : `hsla(${hue},70%,45%,0.14)` }}>
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} style={{ ...selStyle, position: 'relative', fontWeight: 700 }}>
        <option value="">—</option>
        {Array.from({ length: scale + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
      </select>
      <div className="absolute left-0.5 right-0.5 bottom-0.5 h-1 rounded-full" style={{ background: 'var(--color-border)' }}>
        <div className="h-1 rounded-full" style={{ width: `${frac * 100}%`, background: color, transition: 'width .25s ease' }} />
      </div>
    </div>
  );
}

export default function SheetScoreRow({ config, initialValues = {}, initialNotes = '', readOnly = false, busy = false, submitLabel = 'Submit review', onSubmit, headerRight = null }) {
  const [values, setValues] = useState(() => ({ ...initialValues }));
  const [notes, setNotes] = useState(initialNotes || '');
  const set = (k, val) => setValues(m => ({ ...m, [k]: val }));

  const out = useMemo(() => computeSheetReview(config, values), [config, values]);
  const divisor = config.base_score_divisor || 30;
  const basePct = truncPct1(out.base_sum, divisor);          // number
  const status = config.pass_threshold != null ? (out.passed ? 'Pass' : 'FAIL') : (out.quality_score != null ? `${out.quality_score}%` : '—');

  // ── build the flat, ordered column list (matches the sheet's left→right order)
  const columns = [];
  (config.meta_fields || []).forEach(f => columns.push({ key: f.key, label: f.label, group: 'meta', kind: 'text', w: 130 }));
  (config.rating_criteria || []).forEach(rc => columns.push({ key: rc.key, label: `${rc.label}${rc.included_in_base === false ? ' *' : ''}`, group: 'rating', kind: 'rating', scale: rc.scale ?? 4, w: 108 }));
  ((config.autofail || {}).fields || []).forEach(f => columns.push({ key: f.key, label: f.label, group: 'autofail', kind: 'yn', w: 108 }));
  (config.penalty_flags || []).forEach(f => columns.push({ key: f.key, label: `${f.label} (${f.penalty ?? -5})`, group: 'penalty', kind: 'yn', w: 108 }));
  (config.tracking_flags || []).forEach(f => columns.push({ key: f.key, label: `${f.label} (tracking)`, group: 'tracking', kind: 'yn', w: 108 }));
  ((config.quality_score || {}).fields || []).forEach(f => columns.push({ key: f.key, label: f.label, group: 'quality', kind: 'yn', w: 116 }));
  if (config.call_outcome) columns.push({ key: config.call_outcome.key, label: config.call_outcome.label, group: 'outcome', kind: 'outcome', options: config.call_outcome.options || [], w: 130 });
  // computed (read-only, live)
  columns.push({ key: '__base', label: 'Base_Score', group: 'computed', kind: 'calc', w: 92, text: `${basePct}%`, bar: basePct / 100, tint: '#2563eb' });
  columns.push({ key: '__af', label: 'Auto_Fail', group: 'computed', kind: 'flag', w: 84, text: out.autofail_result, ok: out.autofail_result === 'Pass' });
  if ((config.penalty_flags || []).length) columns.push({ key: '__pen', label: 'Total_Penalty', group: 'computed', kind: 'num', w: 92, text: out.total_penalty ?? 0, neg: (out.total_penalty || 0) < 0 });
  if (config.final_score_formula === 'base_plus_penalty_truncated') columns.push({ key: '__final', label: 'Final_Score', group: 'computed', kind: 'calc', w: 92, text: out.final_score ?? '—', bar: Math.max(0, Math.min(1, (Number(out.final_score) || 0) / 100)), tint: '#16a34a' });
  if (config.quality_score) columns.push({ key: '__q', label: 'Quality Score', group: 'computed', kind: 'calc', w: 96, text: out.quality_score == null ? 'N/A' : `${out.quality_score}%`, bar: (out.quality_score || 0) / 100, tint: '#16a34a' });
  if (config.call_outcome) columns.push({ key: '__os', label: 'Call_Outcome_Score', group: 'computed', kind: 'num', w: 92, text: out.call_outcome_score });
  columns.push({ key: '__status', label: 'QA Overall Status', group: 'computed', kind: 'status', w: 112, text: status, pass: config.pass_threshold != null ? out.passed : null });

  // group bands (merge consecutive same-group columns)
  const bands = [];
  for (const c of columns) { const last = bands[bands.length - 1]; if (last && last.group === c.group) { last.w += c.w; } else bands.push({ group: c.group, w: c.w }); }

  const renderCell = (c) => {
    switch (c.kind) {
      case 'text': return <input value={values[c.key] ?? ''} onChange={e => set(c.key, e.target.value)} disabled={readOnly} style={selStyle} placeholder="—" />;
      case 'rating': return <Rating value={values[c.key]} scale={c.scale} onChange={v => set(c.key, v)} disabled={readOnly} />;
      case 'yn': return <YN value={values[c.key]} onChange={v => set(c.key, v)} disabled={readOnly} />;
      case 'outcome': return (
        <select value={values[c.key] ?? ''} onChange={e => set(c.key, e.target.value)} disabled={readOnly} style={selStyle}>
          <option value="">—</option>{c.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      case 'calc': return (
        <div>
          <div className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-text)' }}>{c.text}</div>
          <div className="mt-0.5 h-1 rounded-full" style={{ background: 'var(--color-border)' }}><div className="h-1 rounded-full" style={{ width: `${Math.max(0, Math.min(1, c.bar || 0)) * 100}%`, background: c.tint, transition: 'width .3s ease' }} /></div>
        </div>
      );
      case 'flag': return <span className="text-xs font-extrabold" style={{ color: c.ok ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>{c.text}</span>;
      case 'num': return <span className="text-sm font-extrabold tabular-nums" style={{ color: c.neg ? 'var(--color-error-600)' : 'var(--color-text)' }}>{c.text}</span>;
      case 'status': return (
        <span className="text-xs font-extrabold inline-flex items-center gap-1" style={{ color: c.pass == null ? 'var(--color-text)' : c.pass ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>
          {c.pass != null && (c.pass ? <CheckCircle2 size={14} /> : <XCircle size={14} />)}{c.text}
        </span>
      );
      default: return null;
    }
  };

  const metaKeys = (config.meta_fields || []).map(f => f.key);
  const submit = () => {
    const meta = {}; for (const k of metaKeys) if (values[k] !== undefined) meta[k] = values[k];
    const scoring = { ...values }; for (const k of metaKeys) delete scoring[k];
    onSubmit?.({ values: scoring, meta, overall_notes: notes });
  };

  const cell = (c, children, extra = {}) => (
    <div key={c.key} className="flex-shrink-0" style={{ width: c.w, borderRight: '1px solid var(--color-border)', ...extra }}>{children}</div>
  );

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      {config.sheet && (
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-bold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
          <span>{config.sheet}</span>{headerRight}
        </div>
      )}
      <div className="overflow-x-auto">
        <div style={{ minWidth: 'max-content' }}>
          {/* group band */}
          <div className="flex">
            {bands.map((b, i) => (
              <div key={i} className="flex-shrink-0 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wider truncate"
                style={{ width: b.w, background: GROUP_BAND[b.group], color: 'var(--color-text-secondary)', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                {GROUP_LABEL[b.group] || b.group}
              </div>
            ))}
          </div>
          {/* column labels */}
          <div className="flex">
            {columns.map(c => (
              <div key={c.key} className="flex-shrink-0 px-1.5 py-1 text-[9px] font-bold leading-tight break-words flex items-end"
                title={pretty(c.label)} style={{ width: c.w, height: 42, background: GROUP_TINT[c.group], color: 'var(--color-text-secondary)', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                {pretty(c.label)}
              </div>
            ))}
          </div>
          {/* values */}
          <div className="flex">
            {columns.map(c => cell(c, <div className="px-1.5 py-1.5 flex items-center" style={{ minHeight: 46 }}>{renderCell(c)}</div>))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 p-2.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <input placeholder="Overall notes / coaching feedback" value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly} style={{ ...selStyle, flex: 1 }} />
        {!readOnly && (
          <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-bold text-white flex items-center gap-1.5 flex-shrink-0"
            style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: busy ? 0.6 : 1 }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {submitLabel}
          </button>
        )}
      </div>
    </div>
  );
}
