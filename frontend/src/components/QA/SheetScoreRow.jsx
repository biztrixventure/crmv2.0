import { useEffect, useMemo, useState } from 'react';
import { Loader2, Send, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { computeSheetReview, truncPct1, resolveSheetFields } from '../../utils/qaSheetFormula';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';

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
  outcome: 'rgba(124,58,237,0.10)', verdict: 'rgba(37,99,235,0.14)', computed: 'rgba(22,163,74,0.16)',
};
const GROUP_BAND = {
  meta: 'rgba(107,114,128,0.22)', rating: 'rgba(37,99,235,0.22)', autofail: 'rgba(220,38,38,0.22)',
  penalty: 'rgba(217,119,6,0.22)', tracking: 'rgba(107,114,128,0.20)', quality: 'rgba(22,163,74,0.22)',
  outcome: 'rgba(124,58,237,0.22)', verdict: 'rgba(37,99,235,0.28)', computed: 'rgba(22,163,74,0.30)',
};
const GROUP_LABEL = {
  meta: 'Call info', rating: 'Ratings', autofail: 'Auto-Fail', penalty: 'Penalties',
  tracking: 'Tracking', quality: 'Sale Compliance', outcome: 'Outcome', verdict: 'QA Verdict', computed: 'Score',
};

// A select can only show a value that is IN its option list: a cell holding
// "Yes" against Y/N options renders as blank, so a saved review looked
// unanswered. Normalise on read (the client's sheets spell it Yes/No), keep
// writing the CRM's Y/N.
const ynNorm = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1') return 'Y';
  if (s === 'N' || s === 'NO' || s === 'FALSE' || s === '0') return 'N';
  return '';
};
function YN({ value, onChange, disabled }) {
  const v = ynNorm(value);
  const y = v === 'Y', n = v === 'N';
  return (
    <div className="relative">
      <div className="absolute inset-0 rounded pointer-events-none" style={{ background: y ? 'rgba(22,163,74,0.14)' : n ? 'rgba(220,38,38,0.10)' : 'transparent' }} />
      <ThemedSelect value={v} onChange={e => onChange(e.target.value)} disabled={disabled} style={{ ...selStyle, position: 'relative', fontWeight: 700, color: y ? '#059669' : n ? '#dc2626' : 'var(--color-text)' }}>
        <option value="">—</option><option value="Y">Y</option><option value="N">N</option>
      </ThemedSelect>
    </div>
  );
}

// min–scale rating with an in-cell data bar (red→green by value). Cards can set
// min (e.g. 1 for a 1–5 sheet); default 0 keeps legacy 0–4 cards unchanged.
function Rating({ value, scale = 4, min = 0, onChange, disabled }) {
  const has = value !== '' && value != null;
  const v = has ? Number(value) : null;
  const span = Math.max(1, scale - min);
  const frac = v == null ? 0 : Math.max(0, Math.min(1, (v - min) / span));
  const hue = Math.round(frac * 120);                    // low=red → high=green
  const color = v == null ? 'transparent' : `hsl(${hue},70%,45%)`;
  return (
    <div className="relative rounded" style={{ background: v == null ? 'transparent' : `hsla(${hue},70%,45%,0.14)` }}>
      <ThemedSelect value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} style={{ ...selStyle, position: 'relative', fontWeight: 700 }}>
        <option value="">—</option>
        {Array.from({ length: scale - min + 1 }, (_, i) => <option key={i} value={min + i}>{min + i}</option>)}
      </ThemedSelect>
      <div className="absolute left-0.5 right-0.5 bottom-0.5 h-1 rounded-full" style={{ background: 'var(--color-border)' }}>
        <div className="h-1 rounded-full" style={{ width: `${frac * 100}%`, background: color, transition: 'width .25s ease' }} />
      </div>
    </div>
  );
}

// Which way the reviewer reads the sheet. Remembered per browser: an agent who
// prefers the vertical form should not have to re-pick it on every call.
const VIEW_KEY = 'qa.sheetView';
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'v' ? 'v' : 'h'; } catch { return 'h'; } };

// ── draft persistence ───────────────────────────────────────────────────────
// A half-scored call must survive the reviewer closing the task — clicking
// outside the box, opening another one, a stray refresh. Losing twenty typed
// cells because a dialog was dismissed is the kind of thing that makes people
// score in a spreadsheet instead. Drafts are per-assignment, local to the
// browser, and cleared the moment the review is submitted.
// v2: drafts saved while Date columns were still auto-filled hold a wrong date
// that would be restored forever, outranking the fix. Bumping the namespace
// retires those once. Any draft written from here on can only contain a date the
// reviewer picked themselves, so it is kept.
const DRAFT_NS = 'qa.draft.v2.';
const readDraft = (id) => {
  if (!id) return null;
  try { return JSON.parse(localStorage.getItem(DRAFT_NS + id) || 'null'); } catch { return null; }
};
const writeDraft = (id, draft) => {
  if (!id) return;
  try { localStorage.setItem(DRAFT_NS + id, JSON.stringify(draft)); } catch { /* private mode / quota — the form still works */ }
};
export const clearSheetDraft = (id) => { try { localStorage.removeItem(DRAFT_NS + id); } catch { /* nothing to clear */ } };

export default function SheetScoreRow({ config, draftKey = null, initialValues = {}, initialNotes = '', readOnly = false, busy = false, submitLabel = 'Submit review', onSubmit, headerRight = null }) {
  // A saved draft outranks the auto-filled seed: it is what the reviewer
  // actually typed. A readOnly view (an already-submitted review) never reads one.
  const draft = readOnly ? null : readDraft(draftKey);
  const [values, setValues] = useState(() => ({ ...initialValues, ...(draft?.values || {}) }));
  const [notes, setNotes] = useState(draft?.notes ?? (initialNotes || ''));
  const [restored, setRestored] = useState(!!draft);
  const [afMissing, setAfMissing] = useState(() => new Set());   // required Auto-Fail fields left blank on a submit attempt
  // A restored cell counts as TOUCHED: the reviewer typed it, so a late-arriving
  // auto-fill must not overwrite it any more than it would overwrite live typing.
  const [touched, setTouched] = useState(() => new Set(Object.keys(draft?.values || {})));
  const [view, setView] = useState(readView);
  const setViewPersist = (v) => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode — just don't remember */ } };
  const set = (k, val) => {
    setValues(m => ({ ...m, [k]: val }));
    setTouched(s => { const n = new Set(s); n.add(k); return n; });
    setAfMissing(s => { if (!s.has(k)) return s; const n = new Set(s); n.delete(k); return n; });   // clear the flag once answered
  };

  // Auto-filled details arrive LATE. The CRM fields and the dialer lookup are
  // separate round-trips that land after this component mounts, and seeding
  // state once in useState meant anything not yet arrived was simply dropped —
  // the parent's only way to get it in was remounting the whole form, which
  // throws away everything already typed. THIS is why details "weren't
  // fetching": they were fetched, then discarded.
  //
  // Merge instead: fill a cell only when the reviewer has not touched it and it
  // is still empty, so a late answer can never overwrite a real one.
  const seed = JSON.stringify(initialValues || {});
  useEffect(() => {
    const inc = initialValues || {};
    setValues(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [k, v] of Object.entries(inc)) {
        if (v === undefined || v === null || v === '') continue;
        if (touched.has(k)) continue;
        if (next[k] !== undefined && String(next[k]).trim() !== '') continue;
        next[k] = v; changed = true;
      }
      return changed ? next : prev;
    });
    // Keyed on the SERIALIZED values: initialValues is a fresh object literal on
    // every parent render, so depending on its identity would loop forever. Its
    // content changing is the real signal.
  }, [seed]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Save the draft as it is typed. Debounced so a fast typist doesn't write to
  // localStorage on every keystroke, and skipped entirely for a read-only view.
  useEffect(() => {
    if (readOnly || !draftKey) return;
    const t = setTimeout(() => {
      const hasWork = Object.values(values).some(v => String(v ?? '').trim() !== '') || String(notes || '').trim() !== '';
      if (hasWork) writeDraft(draftKey, { values, notes, at: new Date().toISOString() });
    }, 400);
    return () => clearTimeout(t);
  }, [values, notes, draftKey, readOnly]);

  const out = useMemo(() => computeSheetReview(config, values), [config, values]);
  const divisor = config.base_score_divisor || 30;
  const basePct = truncPct1(out.base_sum, divisor);          // number
  const verdictDriven = !!config.manual_status || config.pass_threshold != null;
  const status = verdictDriven
    ? (out.passed == null ? '—' : (out.passed ? 'Pass' : 'FAIL'))
    : (out.quality_score != null ? `${out.quality_score}%` : '—');

  // ── build the flat, ordered column list (matches the sheet's left→right order)
  //
  // ONE source of order and type: resolveSheetFields. A field carries its own
  // scoring `role` (which coloured band it lands in) and its own `input` (which
  // widget the reviewer gets) — independently — so a column moved to another
  // group keeps its widget, and a column can be Y/N, 0–4, 1–5 or 5/10/15/20/25
  // wherever it sits. Cards written before that (no role/input) resolve to
  // exactly the six-array order this used to hard-code.
  const sheetFields = resolveSheetFields(config);
  const ROLE_GROUP = { meta: 'meta', score: 'rating', autofail: 'autofail', penalty: 'penalty', tracking: 'tracking', quality: 'quality' };
  const columns = [];
  // The outcome / verdict dropdowns are singletons (call_outcome, manual_status)
  // that used to be appended after every field. A card can now place them
  // anywhere by carrying a field with role 'outcome'/'verdict'; the config still
  // owns the options and the scoring. Cards that don't → appended as before.
  const outcomeCol = () => config.call_outcome && ({ key: config.call_outcome.key, label: config.call_outcome.label, group: 'outcome', kind: 'outcome', options: config.call_outcome.options || [], w: 130 });
  const verdictCol = () => config.manual_status && ({ key: config.manual_status.key, label: config.manual_status.label, group: 'verdict', kind: 'verdict', options: config.manual_status.options || ['Pass', 'Fail'], passValue: config.manual_status.pass_value || 'Pass', w: 132 });
  let outcomePlaced = false, verdictPlaced = false;
  for (const f of sheetFields) {
    if (f.role === 'outcome') { const c = outcomeCol(); if (c && !outcomePlaced) { columns.push(c); outcomePlaced = true; } continue; }
    if (f.role === 'verdict') { const c = verdictCol(); if (c && !verdictPlaced) { columns.push(c); verdictPlaced = true; } continue; }
    const group = ROLE_GROUP[f.role] || 'meta';
    const suffix = f.role === 'penalty' ? ` (${f.penalty ?? -5})`
      : f.role === 'tracking' ? ' (tracking)'
        : (f.role === 'score' && f.included_in_base === false) ? ' *' : '';
    const label = `${f.label ?? f.key}${suffix}`;
    const kind = f.input.kind;
    // Comment-ish columns hold sentences, not values. A one-line input for
    // "Additional Comments" means typing through a slot, so those get a real
    // resizable box — and a wider column to sit in.
    const long = kind === 'text' && /comment|note|reason|feedback|remark|detail/i.test(`${f.key} ${f.label || ''}`);
    const w = long ? 300 : (kind === 'text' || kind === 'date' ? 130 : (group === 'quality' ? 116 : 108));
    if (long) columns.push({ key: f.key, label, group, kind: 'longtext', w });
    else if (kind === 'scale') columns.push({ key: f.key, label, group, kind: 'rating', scale: f.input.max, min: f.input.min, w });
    else if (kind === 'choice') columns.push({ key: f.key, label, group, kind: 'choice', options: f.input.options || [], w: Math.max(w, 116) });
    else columns.push({ key: f.key, label, group, kind, w });
  }
  const roleCount = (r) => sheetFields.filter(f => f.role === r).length;
  if (config.call_outcome && !outcomePlaced) columns.push(outcomeCol());
  // manual verdict input (fronter RCM: the evaluator's "QA Overall Status")
  if (config.manual_status && !verdictPlaced) columns.push(verdictCol());
  // computed (read-only, live). Only show a computed column when its inputs exist.
  if (roleCount('score')) columns.push({ key: '__base', label: 'Base_Score', group: 'computed', kind: 'calc', w: 92, text: `${basePct}%`, bar: basePct / 100, tint: '#2563eb' });
  if (roleCount('autofail')) columns.push({ key: '__af', label: 'Auto_Fail', group: 'computed', kind: 'flag', w: 84, text: out.autofail_result, ok: out.autofail_result === 'Pass' });
  if (roleCount('penalty')) columns.push({ key: '__pen', label: 'Total_Penalty', group: 'computed', kind: 'num', w: 92, text: out.total_penalty ?? 0, neg: (out.total_penalty || 0) < 0 });
  if (config.final_score_formula === 'base_plus_penalty_truncated') columns.push({ key: '__final', label: 'Final_Score', group: 'computed', kind: 'calc', w: 92, text: out.final_score ?? '—', bar: Math.max(0, Math.min(1, (Number(out.final_score) || 0) / 100)), tint: '#16a34a' });
  if (roleCount('quality')) columns.push({ key: '__q', label: 'Quality Score', group: 'computed', kind: 'calc', w: 96, text: out.quality_score == null ? 'N/A' : `${out.quality_score}%`, bar: (out.quality_score || 0) / 100, tint: '#16a34a' });
  if (config.call_outcome) columns.push({ key: '__os', label: 'Call_Outcome_Score', group: 'computed', kind: 'num', w: 92, text: out.call_outcome_score });
  columns.push({ key: '__status', label: 'QA Overall Status', group: 'computed', kind: 'status', w: 112, text: status, pass: verdictDriven ? out.passed : null });

  // group bands (merge consecutive same-group columns)
  const bands = [];
  for (const c of columns) { const last = bands[bands.length - 1]; if (last && last.group === c.group) { last.w += c.w; } else bands.push({ group: c.group, w: c.w }); }

  const renderCell = (c) => {
    switch (c.kind) {
      case 'text': return <input value={values[c.key] ?? ''} onChange={e => set(c.key, e.target.value)} disabled={readOnly} style={selStyle} placeholder="—" />;
      // resizable in both directions — drag the corner to give a long comment room
      case 'longtext': return (
        <textarea value={values[c.key] ?? ''} onChange={e => set(c.key, e.target.value)} disabled={readOnly}
          rows={5} placeholder="—" title="Drag the bottom-right corner to make this bigger"
          style={{ ...selStyle, minHeight: 110, resize: 'both', lineHeight: 1.5, fontFamily: 'inherit' }} />
      );
      case 'date': return <ThemedDate value={values[c.key] ?? ''} onChange={e => set(c.key, e.target.value)} disabled={readOnly} style={selStyle} />;
      case 'rating': return <Rating value={values[c.key]} scale={c.scale} min={c.min} onChange={v => set(c.key, v)} disabled={readOnly} />;
      case 'yn': return <YN value={values[c.key]} onChange={v => set(c.key, v)} disabled={readOnly} />;
      // A fixed list of scoring options (e.g. 5/10/15/20/25). Coloured by where
      // the pick sits in its own list, so a 25 reads as strong and a 5 as weak
      // exactly like the 0–4 data bar does.
      case 'choice': {
        const idx = c.options.findIndex(o => String(o) === String(values[c.key] ?? ''));
        const frac = idx < 0 || c.options.length < 2 ? null : idx / (c.options.length - 1);
        const hue = frac == null ? null : Math.round(frac * 120);
        return (
          <div className="rounded" style={{ background: hue == null ? 'transparent' : `hsla(${hue},70%,45%,0.14)` }}>
            <ThemedSelect value={values[c.key] ?? ''} onChange={e => set(c.key, e.target.value)} disabled={readOnly}
              style={{ ...selStyle, fontWeight: 700 }}>
              <option value="">—</option>{c.options.map(o => <option key={o} value={o}>{o}</option>)}
            </ThemedSelect>
          </div>
        );
      }
      case 'outcome': return (
        <ThemedSelect value={values[c.key] ?? ''} onChange={e => set(c.key, e.target.value)} disabled={readOnly} style={selStyle}>
          <option value="">—</option>{c.options.map(o => <option key={o} value={o}>{o}</option>)}
        </ThemedSelect>
      );
      case 'verdict': {
        const val = values[c.key] ?? '';
        const pass = val && val === c.passValue;
        const set2 = val && !pass;
        return (
          <div className="relative">
            <div className="absolute inset-0 rounded pointer-events-none" style={{ background: pass ? 'rgba(22,163,74,0.16)' : set2 ? 'rgba(220,38,38,0.14)' : 'transparent' }} />
            <ThemedSelect value={val} onChange={e => set(c.key, e.target.value)} disabled={readOnly}
              style={{ ...selStyle, position: 'relative', fontWeight: 800, color: pass ? '#059669' : set2 ? '#dc2626' : 'var(--color-text)' }}>
              <option value="">—</option>{c.options.map(o => <option key={o} value={o}>{o}</option>)}
            </ThemedSelect>
          </div>
        );
      }
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

  const metaKeys = sheetFields.filter(f => f.role === 'meta').map(f => f.key);
  const afKeys = sheetFields.filter(f => f.role === 'autofail').map(f => f.key);
  const submit = () => {
    // Auto-Fail (compliance) fields must be answered Y/N before submitting — a
    // blank one is ambiguous and drives the whole call's pass/fail, so require an
    // explicit answer rather than silently auto-failing (or auto-passing) it.
    const miss = afKeys.filter(k => String(values[k] ?? '').trim() === '');
    if (miss.length) {
      setAfMissing(new Set(miss));
      toast.error(`Answer all Auto-Fail compliance fields (Y or N) before submitting — ${miss.length} left blank.`);
      return;
    }
    const meta = {}; for (const k of metaKeys) if (values[k] !== undefined) meta[k] = values[k];
    const scoring = { ...values }; for (const k of metaKeys) delete scoring[k];
    onSubmit?.({ values: scoring, meta, overall_notes: notes });
  };

  const cell = (c, children, extra = {}) => (
    <div key={c.key} className="flex-shrink-0" style={{ width: c.w, borderRight: '1px solid var(--color-border)', ...extra }}>{children}</div>
  );

  // Vertical layout: the SAME columns, the same order, the same state — just
  // stacked and grouped instead of scrolled sideways. Nothing is dropped or
  // reordered, so a reviewer switching views is reading one sheet, not two
  // different forms. Computed columns render as read-only rows at the end of
  // their group exactly as they sit at the end of the row.
  const verticalGroups = [];
  for (const c of columns) {
    const last = verticalGroups[verticalGroups.length - 1];
    if (last && last.group === c.group) last.cols.push(c);
    else verticalGroups.push({ group: c.group, cols: [c] });
  }

  const ViewToggle = (
    <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
      {[['h', 'Row'], ['v', 'List']].map(([k, l]) => (
        <button key={k} onClick={() => setViewPersist(k)} type="button"
          title={k === 'h' ? 'Spreadsheet row — one call left to right, like the Excel sheet' : 'Vertical list — one question per line, easier on a narrow screen'}
          className="px-2 py-0.5 rounded text-[10px] font-bold"
          style={{ background: view === k ? 'var(--color-primary-600)' : 'transparent', color: view === k ? '#fff' : 'var(--color-text-secondary)' }}>{l}</button>
      ))}
    </div>
  );

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-bold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
        <span className="truncate">{config.sheet || 'Scorecard'}</span>
        <span className="flex items-center gap-2 flex-shrink-0">{headerRight}{ViewToggle}</span>
      </div>

      {view === 'v' ? (
        <div className="p-2 space-y-3">
          {verticalGroups.map((g, gi) => (
            <div key={gi} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <div className="px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider"
                style={{ background: GROUP_BAND[g.group], color: 'var(--color-text-secondary)' }}>
                {GROUP_LABEL[g.group] || g.group}
              </div>
              {g.cols.map(c => (
                <div key={c.key}
                  className="flex items-center gap-3 px-2.5 py-1.5"
                  style={{
                    borderTop: '1px solid var(--color-border)',
                    background: GROUP_TINT[c.group],
                    ...(c.group === 'autofail' && afMissing.has(c.key) ? { boxShadow: 'inset 0 0 0 2px var(--color-error-600)' } : {}),
                  }}>
                  <div className="text-[12px] font-bold leading-tight flex-1 min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
                    {pretty(c.label)}
                  </div>
                  <div className="flex-shrink-0" style={{ width: c.kind === 'longtext' ? 320 : 160, maxWidth: '55%' }}>{renderCell(c)}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
      <div className="overflow-x-auto">
        <div style={{ minWidth: 'max-content' }}>
          {/* group band */}
          <div className="flex">
            {bands.map((b, i) => (
              <div key={i} className="flex-shrink-0 px-2 py-1 text-[11px] sm:text-[9px] font-extrabold uppercase tracking-wider truncate"
                style={{ width: b.w, background: GROUP_BAND[b.group], color: 'var(--color-text-secondary)', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                {GROUP_LABEL[b.group] || b.group}
              </div>
            ))}
          </div>
          {/* column labels */}
          <div className="flex">
            {columns.map(c => (
              <div key={c.key} className="flex-shrink-0 px-1.5 py-1 text-[11px] sm:text-[9px] font-bold leading-tight break-words flex items-end"
                title={pretty(c.label)} style={{ width: c.w, height: 42, background: GROUP_TINT[c.group], color: 'var(--color-text-secondary)', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                {pretty(c.label)}
              </div>
            ))}
          </div>
          {/* values */}
          <div className="flex">
            {columns.map(c => cell(c, <div className="px-1.5 py-1.5 flex items-center" style={{ minHeight: 46 }}>{renderCell(c)}</div>,
              c.group === 'autofail' && afMissing.has(c.key) ? { boxShadow: 'inset 0 0 0 2px var(--color-error-600)' } : {}))}
          </div>
        </div>
      </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end gap-2 p-2.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Overall notes / coaching feedback</span>
            {restored && !readOnly && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                style={{ background: 'color-mix(in srgb, var(--color-primary-600) 12%, transparent)', color: 'var(--color-primary-600)' }}
                title="You had already started scoring this call — your answers were brought back.">
                draft restored
                <button type="button" onClick={() => { clearSheetDraft(draftKey); setRestored(false); }}
                  style={{ textDecoration: 'underline' }} title="Discard the restored draft note">dismiss</button>
              </span>
            )}
          </div>
          {/* Coaching feedback is the longest thing anyone types here, and it was
              a 3-row box. Taller by default, and freely resizable in BOTH
              directions so a reviewer writing a paragraph is not typing through
              a letterbox. */}
          <textarea placeholder="Write detailed feedback — multiple lines welcome. Drag the corner to make this bigger." value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly}
            rows={6} style={{ ...selStyle, width: '100%', minHeight: 132, resize: 'both', lineHeight: 1.55, fontFamily: 'inherit' }} />
        </div>
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
