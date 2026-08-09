// ============================================================================
// FormBuilder.jsx — full control over one qa2_form_version: sections,
// parameters (input type, points, roles, N/A, comment rules), options with
// their own point values, base denominator (auto-computed true max shown
// beside a manual override), threshold/comparator, auto-fail config, a live
// preview, and an explicit Publish with a permanence warning. Backend:
// qa2Forms.js. A published version is READ-ONLY here — "Edit as new version"
// clones it into a fresh draft (POST .../versions) rather than mutating it.
// ============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ArrowLeft, Plus, Trash2, Save, Rocket, Copy, Eye, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import { Panel, SectionHeader, Field, Loading, IconButton } from '../UI/kit';
import { Toggle } from '../UI/kit';

const INPUT_TYPES = ['yes_no', 'scale', 'choice', 'number', 'text'];
const ROLES = ['score', 'autofail', 'penalty', 'outcome', 'info'];
const COMMENT_RULES = ['never', 'on_fail', 'always'];
const ROUNDING_MODES = ['truncate_1', 'round_1', 'round_2'];
const AUTOFAIL_MODES = ['none', 'all_yes', 'explicit_table'];

function newParam(sectionId) {
  return {
    _tempId: `new-${Math.random().toString(36).slice(2)}`,
    section_id: sectionId,
    key: '', label: '', input_type: 'scale', role: 'score',
    points_yes: 1, points_no: 0, scale_min: 0, scale_max: 4, scale_step: 1,
    penalty_value: -5, allow_na: false, included_in_base: true,
    requires_comment: 'never', sort: 0, options: [],
  };
}

function ParameterRow({ p, onChange, onRemove }) {
  const set = (k, v) => onChange({ ...p, [k]: v });
  const setOption = (i, k, v) => {
    const opts = [...p.options]; opts[i] = { ...opts[i], [k]: v }; onChange({ ...p, options: opts });
  };
  const addOption = () => onChange({ ...p, options: [...p.options, { value: '', label: '', points: 0, sort: p.options.length }] });
  const removeOption = (i) => onChange({ ...p, options: p.options.filter((_, idx) => idx !== i) });

  return (
    <Panel tone="inset" className="space-y-2.5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Field label="Key"><input className="input" value={p.key} onChange={e => set('key', e.target.value)} /></Field>
        <Field label="Label"><input className="input" value={p.label} onChange={e => set('label', e.target.value)} /></Field>
        <Field label="Input type">
          <ThemedSelect value={p.input_type} onChange={e => set('input_type', e.target.value)}>
            {INPUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </ThemedSelect>
        </Field>
        <Field label="Role">
          <ThemedSelect value={p.role} onChange={e => set('role', e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </ThemedSelect>
        </Field>
      </div>

      {p.input_type === 'yes_no' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Points if Yes"><input type="number" className="input" value={p.points_yes ?? 1} onChange={e => set('points_yes', Number(e.target.value))} /></Field>
          <Field label="Points if No"><input type="number" className="input" value={p.points_no ?? 0} onChange={e => set('points_no', Number(e.target.value))} /></Field>
        </div>
      )}
      {p.input_type === 'scale' && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Min"><input type="number" className="input" value={p.scale_min ?? 0} onChange={e => set('scale_min', Number(e.target.value))} /></Field>
          <Field label="Max"><input type="number" className="input" value={p.scale_max ?? 4} onChange={e => set('scale_max', Number(e.target.value))} /></Field>
          <Field label="Step"><input type="number" className="input" value={p.scale_step ?? 1} onChange={e => set('scale_step', Number(e.target.value))} /></Field>
        </div>
      )}
      {p.role === 'penalty' && (
        <Field label="Penalty value" hint="Negative — subtracted from final score when answered Yes">
          <input type="number" className="input" value={p.penalty_value ?? -5} onChange={e => set('penalty_value', Number(e.target.value))} />
        </Field>
      )}
      {p.input_type === 'choice' && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Options — each carries its own weight</span>
          {p.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input" placeholder="value" style={{ maxWidth: 100 }} value={o.value} onChange={e => setOption(i, 'value', e.target.value)} />
              <input className="input" placeholder="label" value={o.label} onChange={e => setOption(i, 'label', e.target.value)} />
              <input type="number" className="input" placeholder="points" style={{ maxWidth: 90 }} value={o.points} onChange={e => setOption(i, 'points', Number(e.target.value))} />
              <button onClick={() => removeOption(i)} aria-label="Remove option"><Trash2 size={14} style={{ color: 'var(--color-error-600)' }} /></button>
            </div>
          ))}
          <button className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }} onClick={addOption}><Plus size={12} />Add option</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Toggle checked={!!p.allow_na} onChange={v => set('allow_na', v)} label="Allow N/A" />
        {p.role === 'score' && <Toggle checked={p.included_in_base !== false} onChange={v => set('included_in_base', v)} label="Counts toward base" />}
        <Field label="Comment" as="div" className="min-w-[140px]">
          <ThemedSelect value={p.requires_comment} onChange={e => set('requires_comment', e.target.value)}>
            {COMMENT_RULES.map(c => <option key={c} value={c}>{c}</option>)}
          </ThemedSelect>
        </Field>
        <button className="ml-auto text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--color-error-600)' }} onClick={onRemove}>
          <Trash2 size={13} />Remove parameter
        </button>
      </div>
    </Panel>
  );
}

function LivePreview({ versionId, parameters }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const setAnswer = (paramId, patch) => setAnswers(a => ({ ...a, [paramId]: { ...a[paramId], ...patch } }));

  const run = async () => {
    setBusy(true);
    try {
      const payload = Object.entries(answers).map(([parameter_id, v]) => ({ parameter_id, ...v }));
      const r = await client.post(`qa2/versions/${versionId}/preview-score`, { answers: payload });
      setResult(r.data.result);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not compute preview'); }
    finally { setBusy(false); }
  };

  return (
    <Panel className="space-y-3">
      <SectionHeader level="section" icon={Eye} title="Live preview" subtitle="Enter test values, then compute — this never persists anything." />
      <div className="space-y-2">
        {parameters.map(p => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            <span className="w-40 truncate flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{p.label || p.key}</span>
            {p.input_type === 'yes_no' && (
              <ThemedSelect variant="pill" value={answers[p.id]?.value_text || ''} onChange={e => setAnswer(p.id, { value_text: e.target.value })}>
                <option value="">—</option><option value="Y">Y</option><option value="N">N</option>
              </ThemedSelect>
            )}
            {p.input_type === 'scale' && (
              <input type="number" className="input" style={{ maxWidth: 100 }} value={answers[p.id]?.value_num ?? ''} onChange={e => setAnswer(p.id, { value_num: e.target.value === '' ? null : Number(e.target.value) })} />
            )}
            {p.input_type === 'choice' && (
              <ThemedSelect variant="pill" value={answers[p.id]?.value_text || ''} onChange={e => setAnswer(p.id, { value_text: e.target.value })}>
                <option value="">—</option>
                {(p.options || []).map(o => <option key={o.value} value={o.value}>{o.label || o.value}</option>)}
              </ThemedSelect>
            )}
            {(p.input_type === 'number' || p.input_type === 'text') && (
              <input className="input" style={{ maxWidth: 160 }} value={answers[p.id]?.value_text || ''} onChange={e => setAnswer(p.id, { value_text: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <button className="btn btn-primary text-sm" onClick={run} disabled={busy}>{busy ? 'Computing…' : 'Compute preview score'}</button>
      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div><span style={{ color: 'var(--color-text-secondary)' }}>Base %</span><br /><strong>{result.base_pct ?? '—'}</strong></div>
          <div><span style={{ color: 'var(--color-text-secondary)' }}>Penalty</span><br /><strong>{result.penalty_total ?? '—'}</strong></div>
          <div><span style={{ color: 'var(--color-text-secondary)' }}>Final score</span><br /><strong>{result.final_score ?? '—'}</strong></div>
          <div><span style={{ color: 'var(--color-text-secondary)' }}>Autofail</span><br /><strong>{result.autofail_result ?? 'none'}</strong></div>
          <div><span style={{ color: 'var(--color-text-secondary)' }}>Result</span><br /><strong>{result.result ?? '—'}</strong></div>
        </div>
      )}
    </Panel>
  );
}

export default function FormBuilder({ form, initialVersionId, onBack }) {
  const [versionId, setVersionId] = useState(initialVersionId);
  const [version, setVersion] = useState(null);
  const [sections, setSections] = useState([]);
  const [parameters, setParameters] = useState([]);
  const [computedMax, setComputedMax] = useState(0);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const resolveVersionId = useCallback(async () => {
    if (initialVersionId) return initialVersionId;
    const r = await client.get(`qa2/forms/${form.id}/versions`);
    const list = r.data.versions || [];
    return list[0]?.id || null; // already ordered version_no DESC
  }, [form.id, initialVersionId]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const vid = await resolveVersionId();
      if (!vid) { setLoadError('This form has no version yet'); return; }
      setVersionId(vid);
      const r = await client.get(`qa2/forms/${form.id}/versions/${vid}`);
      setVersion(r.data.version);
      setSections(r.data.sections || []);
      setParameters((r.data.parameters || []).map(p => ({ ...p, options: p.options || [] })));
      setComputedMax(r.data.computed_max || 0);
    } catch (e) { setLoadError(e.response?.data?.error || 'Could not load this form version'); }
  }, [form.id, resolveVersionId]);
  useEffect(() => { load(); }, [load]);

  const isDraft = version && !version.published_at;
  const bySection = useMemo(() => {
    const map = new Map(sections.map(s => [s.id, []]));
    map.set(null, []);
    for (const p of parameters) {
      if (!map.has(p.section_id)) map.set(p.section_id, []);
      map.get(p.section_id).push(p);
    }
    return map;
  }, [sections, parameters]);

  const updateParam = (updated) => {
    setParameters(prev => prev.map(p => (p.id || p._tempId) === (updated.id || updated._tempId) ? updated : p));
  };
  const removeParam = (target) => {
    setParameters(prev => prev.filter(p => (p.id || p._tempId) !== (target.id || target._tempId)));
  };
  const addParam = (sectionId) => setParameters(prev => [...prev, newParam(sectionId)]);
  const addSection = () => setSections(prev => [...prev, { _tempId: `new-${Math.random().toString(36).slice(2)}`, name: 'New section', sort: prev.length }]);

  // Reorders within ONE section — walks the flat `parameters` array in its
  // existing order and, for entries belonging to this section only, swaps in
  // the next item from the freshly-reordered subset. Position-matching works
  // because bySection was built by iterating `parameters` in that same order.
  const moveParam = (sectionId, from, to) => {
    const list = [...(bySection.get(sectionId) || [])];
    if (to < 0 || to >= list.length || from === to) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    let i = 0;
    setParameters(prev => prev.map(p => (p.section_id === sectionId ? list[i++] : p)));
  };
  const moveSection = (from, to) => {
    if (to < 0 || to >= sections.length || from === to) return;
    setSections(prev => { const next = [...prev]; next.splice(to, 0, next.splice(from, 1)[0]); return next; });
  };
  const dragParam = useRef(null);   // { sectionId, index }
  const dragSection = useRef(null); // index

  const updateVersionField = (k, v) => setVersion(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        base_denominator_mode: version.base_denominator_mode,
        base_denominator: version.base_denominator,
        final_score_formula: version.final_score_formula,
        rounding_mode: version.rounding_mode,
        pass_threshold: version.pass_threshold,
        pass_comparator: version.pass_comparator,
        autofail_mode: version.autofail_mode,
        autofail_table: version.autofail_table,
        sections: [
          // sort is taken from the array's LIVE position, not each item's own
          // stale `sort` field (every freshly-added parameter defaults to 0,
          // which is exactly what made drag-to-reorder need this fix) — the
          // on-screen order IS the order that gets persisted.
          ...sections.map((s, si) => ({
            name: s.name, sort: si,
            parameters: (bySection.get(s.id) || []).map(({ _tempId, id, form_version_id, created_at, options, sort, ...rest }, pi) => ({ ...rest, options, sort: pi })),
          })),
          {
            name: null, sort: sections.length, // ungrouped bucket
            parameters: (bySection.get(null) || []).map(({ _tempId, id, form_version_id, created_at, options, sort, ...rest }, pi) => ({ ...rest, options, sort: pi })),
          },
        ],
      };
      await client.put(`qa2/versions/${versionId}`, payload);
      toast.success('Saved');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };

  const publish = async () => {
    setSaving(true);
    try {
      await client.post(`qa2/versions/${versionId}/publish`);
      toast.success('Published — this version is now permanent');
      setConfirmingPublish(false);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not publish'); }
    finally { setSaving(false); }
  };

  const editAsNewVersion = async () => {
    try {
      const r = await client.post(`qa2/forms/${form.id}/versions`);
      toast.success('New draft created from the published version');
      setVersionId(r.data.version.id);
    } catch (e) { toast.error(e.response?.data?.error || 'Could not create a new version'); }
  };

  if (loadError) return (
    <div className="max-w-4xl mx-auto space-y-3">
      <button className="text-sm font-semibold flex items-center gap-1" onClick={onBack}><ArrowLeft size={14} />Back</button>
      <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>
    </div>
  );
  if (!version) return <Loading variant="cards" />;

  const trueMax = computedMax;
  const usingManualQuirk = version.base_denominator_mode === 'manual' && Number(version.base_denominator) !== trueMax;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button className="text-sm font-semibold flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }} onClick={onBack}><ArrowLeft size={14} />Back to forms</button>
        <div className="flex items-center gap-2">
          {!isDraft && (
            <button className="btn btn-primary text-sm flex items-center gap-1.5" onClick={editAsNewVersion}><Copy size={14} />Edit as new version</button>
          )}
          {isDraft && (
            <>
              <button className="btn text-sm flex items-center gap-1.5" style={{ border: '1px solid var(--color-border)' }} onClick={save} disabled={saving}><Save size={14} />{saving ? 'Saving…' : 'Save draft'}</button>
              {!confirmingPublish
                ? <button className="btn btn-primary text-sm flex items-center gap-1.5" onClick={() => setConfirmingPublish(true)}><Rocket size={14} />Publish</button>
                : (
                  <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--color-warning-600)' }}>
                    Published versions are permanent.
                    <button className="btn btn-primary text-xs" onClick={publish} disabled={saving}>Yes, publish</button>
                    <button style={{ color: 'var(--color-text-secondary)' }} onClick={() => setConfirmingPublish(false)}>Cancel</button>
                  </span>
                )}
            </>
          )}
        </div>
      </div>

      <SectionHeader level="page" title={form.name} subtitle={isDraft ? `Draft — version ${version.version_no}` : `Published — version ${version.version_no} (read-only)`} />

      <Panel className="space-y-3">
        <SectionHeader level="section" title="Scoring settings" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Base denominator">
            <ThemedSelect value={version.base_denominator_mode} onChange={e => updateVersionField('base_denominator_mode', e.target.value)} disabled={!isDraft}>
              <option value="auto">Auto (sum of max points)</option>
              <option value="manual">Manual</option>
            </ThemedSelect>
          </Field>
          <Field label={version.base_denominator_mode === 'manual' ? 'Divisor' : 'True maximum (auto)'}
            hint={version.base_denominator_mode === 'manual' ? `True max is ${trueMax}${usingManualQuirk ? ' — you are deliberately overriding it' : ''}` : undefined}>
            {version.base_denominator_mode === 'manual'
              ? <input type="number" className="input" value={version.base_denominator ?? ''} onChange={e => updateVersionField('base_denominator', Number(e.target.value))} disabled={!isDraft} />
              : <input className="input" value={trueMax} disabled />}
          </Field>
          <Field label="Rounding">
            <ThemedSelect value={version.rounding_mode} onChange={e => updateVersionField('rounding_mode', e.target.value)} disabled={!isDraft}>
              {ROUNDING_MODES.map(r => <option key={r} value={r}>{r}</option>)}
            </ThemedSelect>
          </Field>
          <Field label="Pass threshold" hint="Leave blank for an informational-only card">
            <input type="number" className="input" value={version.pass_threshold ?? ''} onChange={e => updateVersionField('pass_threshold', e.target.value === '' ? null : Number(e.target.value))} disabled={!isDraft} />
          </Field>
          <Field label="Comparator">
            <ThemedSelect value={version.pass_comparator} onChange={e => updateVersionField('pass_comparator', e.target.value)} disabled={!isDraft}>
              <option value="gte">&gt;= (default — v1's off-by-one bug fixed)</option>
              <option value="gt">&gt; (v1's exact legacy behaviour)</option>
            </ThemedSelect>
          </Field>
          <Field label="Auto-fail mode">
            <ThemedSelect value={version.autofail_mode} onChange={e => updateVersionField('autofail_mode', e.target.value)} disabled={!isDraft}>
              {AUTOFAIL_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </ThemedSelect>
          </Field>
        </div>
        {version.autofail_mode === 'explicit_table' && (
          <Field label="Auto-fail table (JSON)" hint='{"field_order":["key1","key2"],"pass_combinations":[["Y","N"]]}'>
            <textarea className="input" rows={3}
              value={JSON.stringify(version.autofail_table || {})}
              onChange={e => { try { updateVersionField('autofail_table', JSON.parse(e.target.value)); } catch { /* keep typing */ } }}
              disabled={!isDraft} />
          </Field>
        )}
      </Panel>

      {[...sections.map((s, si) => ({ ...s, _idx: si, _real: true })), { id: null, name: 'Ungrouped', sort: 999, _real: false }].map(s => (
        <Panel key={s.id || 'ungrouped'} className="space-y-3"
          draggable={isDraft && s._real}
          onDragStart={() => { if (s._real) dragSection.current = s._idx; }}
          onDragOver={e => { if (s._real) e.preventDefault(); }}
          onDrop={e => {
            if (!s._real) return;
            e.preventDefault();
            if (dragSection.current != null) moveSection(dragSection.current, s._idx);
            dragSection.current = null;
          }}>
          <SectionHeader level="section" title={s.name || 'Ungrouped'} actions={isDraft && (
            <div className="flex items-center gap-1">
              {s._real && (
                <>
                  <GripVertical size={14} style={{ color: 'var(--color-text-tertiary)', cursor: 'grab' }} />
                  <IconButton label="Move section up" variant="ghost" onClick={() => moveSection(s._idx, s._idx - 1)} disabled={s._idx === 0}><ChevronUp size={13} /></IconButton>
                  <IconButton label="Move section down" variant="ghost" onClick={() => moveSection(s._idx, s._idx + 1)} disabled={s._idx === sections.length - 1}><ChevronDown size={13} /></IconButton>
                </>
              )}
              <button className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--color-primary-600)' }} onClick={() => addParam(s.id)}>
                <Plus size={13} />Add parameter
              </button>
            </div>
          )} />
          <div className="space-y-2">
            {(bySection.get(s.id) || []).map((p, pi, arr) => (
              <div key={p.id || p._tempId} className="flex items-start gap-1.5"
                draggable={isDraft}
                onDragStart={() => { dragParam.current = { sectionId: s.id, index: pi }; }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const d = dragParam.current;
                  if (d && d.sectionId === s.id) moveParam(s.id, d.index, pi);
                  dragParam.current = null;
                }}>
                {isDraft && (
                  <div className="flex flex-col items-center gap-0.5 pt-2 flex-shrink-0" style={{ cursor: 'grab' }}>
                    <GripVertical size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    <IconButton label="Move up" variant="ghost" onClick={() => moveParam(s.id, pi, pi - 1)} disabled={pi === 0}><ChevronUp size={13} /></IconButton>
                    <IconButton label="Move down" variant="ghost" onClick={() => moveParam(s.id, pi, pi + 1)} disabled={pi === arr.length - 1}><ChevronDown size={13} /></IconButton>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <ParameterRow p={p} onChange={updateParam} onRemove={() => removeParam(p)} />
                </div>
              </div>
            ))}
            {(bySection.get(s.id) || []).length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No parameters here yet.</p>
            )}
          </div>
        </Panel>
      ))}

      {isDraft && (
        <button className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-primary-600)' }} onClick={addSection}>
          <Plus size={14} />Add section
        </button>
      )}

      <LivePreview versionId={versionId} parameters={parameters} />
    </div>
  );
}
