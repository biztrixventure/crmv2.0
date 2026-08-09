// ============================================================================
// CalibrationTab.jsx — a calibration group is 2+ reviewers scored against the
// SAME call (created via ReviewScreen's assignment /calibrate action, Phase
// 7). This tab shows the group list, then a side-by-side compare with
// manager actions (flag/override/void) wired straight to the existing
// qa2Evaluations.js routes — no new write logic, this is a view + dispatch.
//
// Override reuses ParameterInput from ReviewScreen.jsx rather than
// reimplementing per-parameter controls — same reasoning as the audio player
// reuse in Phase 7 (brief ground rule: reuse, never reimplement).
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Scale, Flag, RotateCcw, Ban, Send } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import { Panel, SectionHeader, TableScroll, EmptyState, Loading } from '../UI/kit';
import { ParameterInput } from './ReviewScreen';

function answerText(a) {
  if (!a) return '—';
  if (a.is_na) return 'N/A';
  if (a.value_text != null && a.value_text !== '') return a.value_text;
  if (a.value_num != null) return String(a.value_num);
  if (a.value_bool != null) return a.value_bool ? 'Yes' : 'No';
  return '—';
}

function GroupList({ onOpen }) {
  const [groups, setGroups] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    client.get('qa2/calibration')
      .then(r => setGroups(r.data.groups || []))
      .catch(e => setLoadError(e.response?.data?.error || 'Could not load calibration groups'));
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <SectionHeader level="page" icon={Scale} title="Calibration" subtitle="Calls sent to two or more reviewers — compare scores and reconcile disagreement." />
      {loadError && <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>}
      {!loadError && groups === null && <Loading variant="table" rows={4} />}
      {!loadError && groups && groups.length === 0 && (
        <EmptyState icon={Scale} title="No calibration groups yet" hint="Send a call for calibration from an assignment in the queue to start comparing reviewers." />
      )}
      {!loadError && groups && groups.length > 0 && (
        <Panel pad="none">
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Company</th>
                <th className="text-left font-semibold px-3 py-2">Method</th>
                <th className="text-left font-semibold px-3 py-2">Agent</th>
                <th className="text-left font-semibold px-3 py-2">Reviewers</th>
                <th className="px-3 py-2" />
              </tr></thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.calibration_group_id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2">{g.call?.companies?.name || '—'}</td>
                    <td className="px-3 py-2">{g.call?.qa2_method?.label || '—'}</td>
                    <td className="px-3 py-2">{g.call?.agent_user || '—'} ({g.call?.leg || '—'})</td>
                    <td className="px-3 py-2">{g.scored_count}/{g.assignment_count} scored</td>
                    <td className="px-3 py-2 text-right">
                      <button className="btn btn-primary text-xs" onClick={() => onOpen(g.calibration_group_id)}>Compare</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
}

function OverridePanel({ evaluation, def, onDone, onCancel }) {
  const [answers, setAnswers] = useState(() => {
    const m = {};
    for (const a of evaluation.answers || []) {
      m[a.parameter_id] = { value_num: a.value_num, value_text: a.value_text, value_bool: a.value_bool, is_na: a.is_na, comment: a.comment };
    }
    return m;
  });
  const [notes, setNotes] = useState(evaluation.overall_notes || '');
  const [saving, setSaving] = useState(false);

  const setAnswer = (pid, patch) => setAnswers(prev => ({ ...prev, [pid]: { ...prev[pid], ...patch } }));

  const bySection = useMemo(() => {
    if (!def) return new Map();
    const map = new Map(def.sections.map(s => [s.id, []]));
    map.set(null, []);
    for (const p of def.parameters) {
      if (!map.has(p.section_id)) map.set(p.section_id, []);
      map.get(p.section_id).push(p);
    }
    return map;
  }, [def]);

  const submit = async () => {
    setSaving(true);
    try {
      const payload = Object.entries(answers).map(([parameter_id, v]) => ({ parameter_id, ...v }));
      await client.post(`qa2/evaluations/${evaluation.id}/override`, { answers: payload, overall_notes: notes });
      toast.success('Override submitted — the original is now superseded');
      onDone();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not submit the override'); }
    finally { setSaving(false); }
  };

  if (!def) return <Loading variant="cards" />;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button className="text-sm font-semibold flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }} onClick={onCancel}>
          <ArrowLeft size={14} />Cancel override
        </button>
        <button className="btn btn-primary text-sm flex items-center gap-1.5" onClick={submit} disabled={saving}>
          <Send size={14} />{saving ? 'Submitting…' : 'Submit override'}
        </button>
      </div>
      <Panel tone="inset">
        <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Overriding {evaluation.reviewer_name}'s evaluation. This creates a new evaluation as the record of truth — the original is kept, marked superseded.
        </p>
      </Panel>
      {[...def.sections, { id: null, name: 'Other' }].map(sec => {
        const params = bySection.get(sec.id) || [];
        if (!params.length) return null;
        return (
          <Panel key={sec.id || 'other'}>
            <SectionHeader level="section" title={sec.name || 'Other'} />
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {params.map(p => (
                <ParameterInput key={p.id} param={p} answer={answers[p.id]} onChange={patch => setAnswer(p.id, patch)} />
              ))}
            </div>
          </Panel>
        );
      })}
      <Panel>
        <SectionHeader level="section" title="Override notes" />
        <textarea className="input w-full" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Why this correction was made…" />
      </Panel>
    </div>
  );
}

function GroupDetail({ groupId, scope, onBack }) {
  const [data, setData] = useState(null);
  const [def, setDef] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [overriding, setOverriding] = useState(null);

  const load = useCallback(() => {
    setLoadError(null);
    client.get(`qa2/calibration/${groupId}`).then(async r => {
      setData(r.data);
      const firstEval = r.data.assignments.flatMap(a => a.evaluations)[0];
      if (firstEval) {
        const dr = await client.get(`qa2/versions/${firstEval.form_version_id}`);
        setDef(dr.data);
      }
    }).catch(e => setLoadError(e.response?.data?.error || 'Could not load this group'));
  }, [groupId]);
  useEffect(() => { load(); }, [load]);

  const flag = async (evalId) => {
    try { await client.post(`qa2/evaluations/${evalId}/flag`); toast.success('Flagged'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not flag'); }
  };
  const voidEval = async (evalId) => {
    const reason = window.prompt('Why void this evaluation?');
    if (!reason || !reason.trim()) return;
    try { await client.post(`qa2/evaluations/${evalId}/void`, { reason: reason.trim() }); toast.success('Voided'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not void'); }
  };

  if (overriding) return <OverridePanel evaluation={overriding} def={def} onDone={() => { setOverriding(null); load(); }} onCancel={() => setOverriding(null)} />;

  if (loadError) return (
    <div className="max-w-4xl mx-auto space-y-3">
      <button className="text-sm font-semibold flex items-center gap-1" onClick={onBack}><ArrowLeft size={14} />Back</button>
      <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>
    </div>
  );
  if (!data) return <Loading variant="cards" />;

  const allEvals = data.assignments.flatMap(a => a.evaluations.map(e => ({ ...e, assignment: a })));
  const params = def?.parameters || [];

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <button className="text-sm font-semibold flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }} onClick={onBack}>
        <ArrowLeft size={14} />Back to calibration
      </button>

      <Panel>
        <SectionHeader level="section" title="Call context" />
        <div className="text-sm" style={{ color: 'var(--color-text)' }}>
          {data.call?.companies?.name || '—'} · {data.call?.qa2_method?.label || '—'} · {data.call?.agent_user || '—'} ({data.call?.leg || '—'})
          {data.call?.customer_phone && <> · {data.call.customer_phone}</>}
        </div>
      </Panel>

      <Panel pad="none">
        <div style={{ padding: '12px 16px 0' }}><SectionHeader level="section" title="Score comparison" /></div>
        <TableScroll>
          <table className="w-full text-sm">
            <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
              <th className="text-left font-semibold px-3 py-2">Reviewer</th>
              <th className="text-left font-semibold px-3 py-2">Status</th>
              <th className="text-left font-semibold px-3 py-2">Base %</th>
              <th className="text-left font-semibold px-3 py-2">Penalty</th>
              <th className="text-left font-semibold px-3 py-2">Final</th>
              <th className="text-left font-semibold px-3 py-2">Result</th>
              {scope?.managerAccess && <th className="px-3 py-2" />}
            </tr></thead>
            <tbody>
              {allEvals.map(e => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2">{e.reviewer_name}</td>
                  <td className="px-3 py-2">{e.status}</td>
                  <td className="px-3 py-2">{e.base_pct ?? '—'}</td>
                  <td className="px-3 py-2">{e.penalty_total ?? '—'}</td>
                  <td className="px-3 py-2"><strong>{e.final_score ?? '—'}</strong></td>
                  <td className="px-3 py-2">{e.result ?? '—'}</td>
                  {scope?.managerAccess && (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {e.status === 'submitted' && (
                        <button className="btn text-xs" style={{ border: '1px solid var(--color-border)' }} onClick={() => flag(e.id)} title="Flag">
                          <Flag size={12} />
                        </button>
                      )}
                      {['submitted', 'flagged'].includes(e.status) && def && (
                        <button className="btn text-xs ml-1.5" style={{ border: '1px solid var(--color-border)' }} onClick={() => setOverriding(e)} title="Override">
                          <RotateCcw size={12} />
                        </button>
                      )}
                      {e.status !== 'void' && (
                        <button className="btn text-xs ml-1.5" style={{ border: '1px solid var(--color-error-600)', color: 'var(--color-error-600)' }} onClick={() => voidEval(e.id)} title="Void">
                          <Ban size={12} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Panel>

      {def && params.length > 0 && (
        <Panel pad="none">
          <div style={{ padding: '12px 16px 0' }}><SectionHeader level="section" title="Per-parameter answers" /></div>
          <TableScroll>
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--color-text-secondary)' }}>
                <th className="text-left font-semibold px-3 py-2">Parameter</th>
                {allEvals.map(e => <th key={e.id} className="text-left font-semibold px-3 py-2">{e.reviewer_name}</th>)}
              </tr></thead>
              <tbody>
                {params.map(p => (
                  <tr key={p.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="px-3 py-2">{p.label || p.key}</td>
                    {allEvals.map(e => {
                      const a = (e.answers || []).find(x => x.parameter_id === p.id);
                      return (
                        <td key={e.id} className="px-3 py-2">
                          {answerText(a)}
                          {a?.comment && <div className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{a.comment}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
    </div>
  );
}

export default function CalibrationTab({ scope }) {
  const [openGroup, setOpenGroup] = useState(null);
  if (openGroup) return <GroupDetail groupId={openGroup} scope={scope} onBack={() => setOpenGroup(null)} />;
  return <GroupList onOpen={setOpenGroup} />;
}
