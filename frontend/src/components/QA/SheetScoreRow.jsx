import { useMemo, useState } from 'react';
import { Loader2, Send, CheckCircle2, XCircle } from 'lucide-react';
import { computeSheetReview, truncPct1 } from '../../utils/qaSheetFormula';

// ============================================================================
// SheetScoreRow — horizontal, spreadsheet-style scoring strip for sheet_v2
// scorecards (WaveTech Google Sheet replication). One call = ONE horizontal
// row: 0-4 rating selectors, Y/N toggles, and computed columns (Base_Score,
// Auto_Fail, Total_Penalty, Final_Score / Quality Score, Status) as read-only
// cells at the RIGHT, recalculating LIVE. On narrow screens the row scrolls
// horizontally (overflow-x) — it never collapses to a vertical stack, to keep
// the sheet's left-to-right marking muscle memory.
// Column order = the scorecard config's array order (groups: meta → ratings →
// auto-fail → penalties → tracking → quality → outcome → computed).
// ============================================================================

const CELL_W = 116;
const selStyle = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 6, padding: '4px 6px', fontSize: 13, width: '100%' };

const GROUP_TINT = {
  meta:     'var(--color-surface-hover)',
  rating:   'rgba(37,99,235,0.10)',
  autofail: 'rgba(220,38,38,0.10)',
  penalty:  'rgba(217,119,6,0.10)',
  tracking: 'rgba(107,114,128,0.12)',
  quality:  'rgba(22,163,74,0.10)',
  outcome:  'rgba(124,58,237,0.10)',
  computed: 'rgba(22,163,74,0.16)',
};

// keep the stored label but display it readable: Customer_Product_X → "Customer Product X"
const pretty = (s) => String(s ?? '').replace(/_/g, ' ').trim();

function Col({ label, suffix, group, children, w = CELL_W }) {
  const nice = pretty(label);
  return (
    <div className="flex-shrink-0 flex flex-col" style={{ width: w, borderRight: '1px solid var(--color-border)' }}>
      <div className="px-1.5 pt-1 pb-0.5 text-[9px] font-bold leading-tight break-words flex items-end" title={nice}
        style={{ color: 'var(--color-text-secondary)', background: GROUP_TINT[group] || 'var(--color-surface-hover)', height: 46 }}>
        {nice}{suffix ? <span className="font-normal opacity-70">{suffix}</span> : null}
      </div>
      <div className="px-1.5 py-1.5 flex items-center" style={{ minHeight: 44 }}>{children}</div>
    </div>
  );
}

function YN({ value, onChange, disabled }) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} style={selStyle}>
      <option value="">—</option><option value="Y">Y</option><option value="N">N</option>
    </select>
  );
}

export default function SheetScoreRow({ config, initialValues = {}, initialNotes = '', readOnly = false, busy = false, submitLabel = 'Submit review', onSubmit, headerRight = null }) {
  const [values, setValues] = useState(() => ({ ...initialValues }));
  const [notes, setNotes] = useState(initialNotes || '');
  const set = (k, val) => setValues(m => ({ ...m, [k]: val }));

  const out = useMemo(() => computeSheetReview(config, values), [config, values]);
  const divisor = config.base_score_divisor || 30;
  const basePctDisplay = `${truncPct1(out.base_sum, divisor)}%`;

  const metaKeys = (config.meta_fields || []).map(f => f.key);
  const submit = () => {
    const meta = {};
    for (const k of metaKeys) if (values[k] !== undefined) meta[k] = values[k];
    const scoring = { ...values };
    for (const k of metaKeys) delete scoring[k];
    onSubmit?.({ values: scoring, meta, overall_notes: notes });
  };

  const status = config.pass_threshold != null
    ? (out.passed ? 'Pass' : 'FAIL')
    : (out.quality_score != null ? `${out.quality_score}%` : '—');

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      {config.sheet && (
        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-bold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
          <span>{config.sheet}</span>{headerRight}
        </div>
      )}

      {/* the horizontal sheet row — scrolls sideways, never stacks */}
      <div className="overflow-x-auto">
        <div className="flex" style={{ minWidth: 'max-content' }}>
          {/* meta / identity columns */}
          {(config.meta_fields || []).map(f => (
            <Col key={f.key} label={f.label} group="meta" w={130}>
              <input value={values[f.key] ?? ''} onChange={e => set(f.key, e.target.value)} disabled={readOnly} style={selStyle} placeholder="—" />
            </Col>
          ))}

          {/* 0-4 rating criteria (sheet column order) */}
          {(config.rating_criteria || []).map(rc => (
            <Col key={rc.key} label={`${rc.label}${rc.included_in_base === false ? ' *' : ''}`} group="rating" w={110}>
              <select value={values[rc.key] ?? ''} onChange={e => set(rc.key, e.target.value)} disabled={readOnly} style={selStyle}>
                <option value="">—</option>
                {Array.from({ length: (rc.scale ?? 4) + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </Col>
          ))}

          {/* auto-fail compliance Y/N */}
          {((config.autofail || {}).fields || []).map(f => (
            <Col key={f.key} label={f.label} group="autofail" w={110}>
              <YN value={values[f.key]} onChange={v => set(f.key, v)} disabled={readOnly} />
            </Col>
          ))}

          {/* penalty flags (each Y = penalty) */}
          {(config.penalty_flags || []).map(f => (
            <Col key={f.key} label={`${f.label} (${f.penalty ?? -5})`} group="penalty" w={110}>
              <YN value={values[f.key]} onChange={v => set(f.key, v)} disabled={readOnly} />
            </Col>
          ))}

          {/* tracking-only flags — captured, no formula consumes them */}
          {(config.tracking_flags || []).map(f => (
            <Col key={f.key} label={`${f.label} (tracking)`} group="tracking" w={110}>
              <YN value={values[f.key]} onChange={v => set(f.key, v)} disabled={readOnly} />
            </Col>
          ))}

          {/* quality checklist (Closer) */}
          {((config.quality_score || {}).fields || []).map(f => (
            <Col key={f.key} label={f.label} group="quality" w={116}>
              <YN value={values[f.key]} onChange={v => set(f.key, v)} disabled={readOnly} />
            </Col>
          ))}

          {/* call outcome */}
          {config.call_outcome && (
            <Col label={config.call_outcome.label} group="outcome" w={124}>
              <select value={values[config.call_outcome.key] ?? ''} onChange={e => set(config.call_outcome.key, e.target.value)} disabled={readOnly} style={selStyle}>
                <option value="">—</option>
                {(config.call_outcome.options || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </Col>
          )}

          {/* ── computed columns (read-only, live) ── */}
          <Col label="Base_Score" group="computed" w={96}>
            <span className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-text)' }} title={`${out.base_sum}/${divisor} = ${out.base_score}`}>{basePctDisplay}</span>
          </Col>
          <Col label="Auto_Fail" group="computed" w={88}>
            <span className="text-xs font-extrabold" style={{ color: out.autofail_result === 'Pass' ? 'var(--color-success-600)' : 'var(--color-error-600)' }}>{out.autofail_result}</span>
          </Col>
          {(config.penalty_flags || []).length > 0 && (
            <Col label="Total_Penalty" group="computed" w={96}>
              <span className="text-sm font-extrabold tabular-nums" style={{ color: (out.total_penalty || 0) < 0 ? 'var(--color-error-600)' : 'var(--color-text)' }}>{out.total_penalty ?? 0}</span>
            </Col>
          )}
          {config.final_score_formula === 'base_plus_penalty_truncated' && (
            <Col label="Final_Score" group="computed" w={96}>
              <span className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-text)' }}>{out.final_score}</span>
            </Col>
          )}
          {config.quality_score && (
            <Col label="Quality Score" group="computed" w={96}>
              <span className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-text)' }}>{out.quality_score == null ? 'N/A' : `${out.quality_score}%`}</span>
            </Col>
          )}
          {config.call_outcome && (
            <Col label="Call_Outcome_Score" group="computed" w={96}>
              <span className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-text)' }}>{out.call_outcome_score}</span>
            </Col>
          )}
          <Col label="QA Overall Status" group="computed" w={110}>
            <span className="text-xs font-extrabold inline-flex items-center gap-1"
              style={{ color: config.pass_threshold != null ? (out.passed ? 'var(--color-success-600)' : 'var(--color-error-600)') : 'var(--color-text)' }}>
              {config.pass_threshold != null && (out.passed ? <CheckCircle2 size={14} /> : <XCircle size={14} />)}{status}
            </span>
          </Col>
        </div>
      </div>

      {/* notes + submit */}
      <div className="flex items-center gap-2 p-2.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <input placeholder="Overall notes / coaching feedback" value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly}
          style={{ ...selStyle, flex: 1 }} />
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
