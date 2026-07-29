import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { Target, Plus, Pencil, Trash2, Save, X, Crown, AlertTriangle, Check, Gift } from 'lucide-react';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import { Panel, TableScroll, Loading, EmptyState, Field, accent } from '../UI/kit';

// ── Quota panel — the same component at both tiers (mig 216).
//
// The server decides what this viewer may do and says so in `can`:
//   can.team   → a company manager: may set the TEAM target
//   can.member → a manager, or the lead of a team whose lead_can_edit is on:
//                may allocate that target across members
// Nothing here infers permission from a role name; the panel just renders what
// the server already allowed, so the admin surface and the lead surface can be
// one file instead of two that drift apart.
//
// The allocation gap is stated, never enforced. A lead legitimately over- or
// under-allocates; hiding that would only make the number a lie.

const PERIODS = [
  { k: 'month', label: 'This month' },
  { k: 'week',  label: 'This week' },
  { k: 'day',   label: 'Today' },
  { k: 'range', label: 'Custom range…' },
];

const fmt = (n, unit) => (unit === 'money'
  ? `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  : (Number(n) || 0).toLocaleString());

// Days remaining in a window, or null once it has closed.
const daysLeft = (endIso) => {
  if (!endIso) return null;
  const end = Date.parse(`${endIso}T23:59:59`);
  const d = Math.ceil((end - Date.now()) / 86400000);
  return d >= 0 ? d : null;
};

// Progress bar. Colour encodes state, not decoration: hit = success, otherwise
// primary. accent() keeps it correct in dark mode, where the -50/-600 scales
// invert and a hex literal would read wrong.
function Bar({ pct, tone }) {
  const t = accent(tone || ((pct || 0) >= 100 ? 'success' : 'primary'));
  return (
    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, pct || 0))}%`, background: t.fg }} />
    </div>
  );
}

export default function QuotaPanel({ teamId, onError, compact = false }) {
  const [data, setData] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);       // { tier:'team'|'member', quota? }
  const [ladderFor, setLadderFor] = useState(null);   // member-quota id whose ladder is open

  const load = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    try {
      const [q, m] = await Promise.all([
        client.get(`quotas/team/${teamId}`),
        client.get('quotas/metrics'),
      ]);
      setData(q.data);
      setMetrics(m.data.metrics || []);
    } catch (e) {
      onError?.(e.response?.data?.error || 'Failed to load quotas');
      setData(null);
    } finally { setLoading(false); }
  }, [teamId, onError]);
  useEffect(() => { load(); }, [load]);

  const save = async (form) => {
    try {
      if (form.id) await client.put(`quotas/${form.id}`, form);
      else await client.post('quotas', { ...form, team_id: teamId });
      setEdit(null); load();
    } catch (e) { onError?.(e.response?.data?.error || 'Could not save that quota'); }
  };
  const remove = async (q) => {
    if (!window.confirm(`Remove the ${q.metric_label} quota${q.member_name ? ` for ${q.member_name}` : ''}? Past attainment is kept.`)) return;
    try { await client.delete(`quotas/${q.id}`); load(); }
    catch (e) { onError?.(e.response?.data?.error || 'Delete failed'); }
  };

  const can = data?.can || {};
  const teamQuotas   = data?.team_quotas || [];
  const memberQuotas = data?.member_quotas || [];
  const gaps         = data?.gaps || [];
  const gapByQuota = useMemo(() => Object.fromEntries(gaps.map(g => [g.quota_id, g])), [gaps]);

  if (loading) return <Loading variant="rows" rows={3} label="Loading quotas…" />;
  if (!data) return null;

  return (
    <div className="space-y-3">
      {/* ── TEAM TIER ─────────────────────────────────────────────────────── */}
      <Panel tone={compact ? 'inset' : 'surface'} className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="m-0 text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5"
            style={{ color: 'var(--color-text-tertiary)' }}>
            <Target size={12} /> Team quota
          </p>
          {can.team && (
            <button onClick={() => setEdit({ tier: 'team' })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white"
              style={{ background: 'var(--color-primary-600)' }}>
              <Plus size={12} /> Set target
            </button>
          )}
        </div>

        {teamQuotas.length === 0 ? (
          <EmptyState icon={Target} title="No team target set"
            hint={can.team ? 'Set one, then the team lead can split it across members.' : 'A company manager sets this.'} />
        ) : teamQuotas.map(q => {
          const g = gapByQuota[q.id];
          const left = daysLeft(q.ends_at);
          const over = g && g.gap < 0;
          return (
            <Panel key={q.id} tone="inset" radius="xl" className="space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                    {q.label || q.metric_label}
                  </p>
                  <p className="m-0 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                    {q.metric_label} · {q.starts_at} → {q.ends_at}
                    {left != null && <> · <b>{left}d left</b></>}
                    {!q.metric_known && <> · <span style={{ color: accent('warning').fg }}>metric no longer in the catalog</span></>}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-sm font-extrabold tabular-nums" style={{ color: 'var(--color-text)' }}>
                    {fmt(q.actual, q.metric_unit)} / {fmt(q.target_value, q.metric_unit)}
                  </span>
                  {can.team && (
                    <>
                      <button onClick={() => setEdit({ tier: 'team', quota: q })} title="Edit target"
                        className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><Pencil size={12} /></button>
                      <button onClick={() => remove(q)} title="Remove target"
                        className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: accent('danger').fg }}><Trash2 size={12} /></button>
                    </>
                  )}
                </div>
              </div>
              <Bar pct={q.pct} />
              <div className="flex items-center justify-between gap-2 text-[11px] flex-wrap">
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {q.pct == null ? '—' : `${q.pct}% of target`}
                  {q.remaining > 0 && <> · {fmt(q.remaining, q.metric_unit)} to go</>}
                </span>
                {g && (
                  // The gap is the lead's working number, so it is stated plainly
                  // in both directions rather than only flagged when negative.
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-semibold"
                    style={{
                      background: over ? accent('warning').soft : accent('primary').soft,
                      color: over ? accent('warning').fg : accent('primary').fg,
                    }}>
                    {over ? <AlertTriangle size={11} /> : <Check size={11} />}
                    {g.allocated_to === 0
                      ? 'Nothing allocated yet'
                      : over
                        ? `Over-allocated by ${fmt(-g.gap, q.metric_unit)} across ${g.allocated_to}`
                        : g.gap === 0
                          ? `Fully allocated across ${g.allocated_to}`
                          : `${fmt(g.gap, q.metric_unit)} still to allocate`}
                  </span>
                )}
              </div>
              <MilestoneLadder quota={q} canEdit={!!can.team} unit={q.metric_unit}
                onChanged={load} onError={onError} />
            </Panel>
          );
        })}
      </Panel>

      {/* ── MEMBER TIER ───────────────────────────────────────────────────── */}
      <Panel tone={compact ? 'inset' : 'surface'} className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="m-0 text-[11px] font-bold uppercase tracking-widest flex items-center gap-1.5"
            style={{ color: 'var(--color-text-tertiary)' }}>
            <Crown size={12} /> Member allocations
          </p>
          {can.member && (
            <button onClick={() => setEdit({ tier: 'member' })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white"
              style={{ background: 'var(--color-primary-600)' }}>
              <Plus size={12} /> Allocate
            </button>
          )}
        </div>

        {memberQuotas.length === 0 ? (
          <EmptyState icon={Crown} title="No member allocations yet"
            hint={can.member
              ? 'Give each member their own number and period — they do not have to add up to the team target.'
              : can.isLead
                ? 'Your manager has not switched on "let the team lead edit this team" yet.'
                : 'The team lead allocates these.'} />
        ) : (
          <TableScroll stickyFirst label="Member allocations">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--color-text-tertiary)' }}>
                  <th className="text-left font-bold uppercase tracking-widest py-1.5 px-2 text-[11px]">Member</th>
                  <th className="text-left font-bold uppercase tracking-widest py-1.5 px-2 text-[11px]">Metric</th>
                  <th className="text-left font-bold uppercase tracking-widest py-1.5 px-2 text-[11px]">Period</th>
                  <th className="text-right font-bold uppercase tracking-widest py-1.5 px-2 text-[11px]">Progress</th>
                  <th className="py-1.5 px-2" style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {memberQuotas.map(q => {
                  const left = daysLeft(q.ends_at);
                  return (
                    <Fragment key={q.id}>
                    <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td className="py-2 px-2 font-semibold" style={{ color: 'var(--color-text)' }}>{q.member_name}</td>
                      <td className="py-2 px-2" style={{ color: 'var(--color-text-secondary)' }}>{q.metric_label}</td>
                      <td className="py-2 px-2 whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                        {q.starts_at} → {q.ends_at}
                        {left != null && <span className="opacity-70"> · {left}d</span>}
                      </td>
                      <td className="py-2 px-2" style={{ minWidth: 140 }}>
                        <div className="flex items-center justify-end gap-2">
                          <span className="tabular-nums font-bold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                            {fmt(q.actual, q.metric_unit)} / {fmt(q.target_value, q.metric_unit)}
                          </span>
                          <span className="tabular-nums text-[11px] w-11 text-right"
                            style={{ color: (q.pct ?? 0) >= 100 ? accent('success').fg : 'var(--color-text-secondary)' }}>
                            {q.pct == null ? '—' : `${q.pct}%`}
                          </span>
                        </div>
                        <div className="mt-1"><Bar pct={q.pct} /></div>
                      </td>
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1 justify-end">
                          {/* The ladder is per-allocation, so it opens under its
                              own row rather than in a modal that would hide the
                              number it is measured against. */}
                          <button onClick={() => setLadderFor(id => (id === q.id ? null : q.id))}
                            title={ladderFor === q.id ? 'Hide milestones' : 'Milestones'}
                            className="p-1.5 rounded-lg inline-flex items-center gap-1"
                            style={{
                              border: '1px solid var(--color-border)',
                              color: (q.milestones || []).length ? accent('warning').fg : 'var(--color-text-tertiary)',
                            }}>
                            <Gift size={12} />
                            {(q.milestones || []).length > 0 && (
                              <span className="text-[11px] font-bold tabular-nums">
                                {q.milestones_earned || 0}/{q.milestones.length}
                              </span>
                            )}
                          </button>
                          {can.member && (
                            <>
                              <button onClick={() => setEdit({ tier: 'member', quota: q })} title="Edit allocation"
                                className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><Pencil size={12} /></button>
                              <button onClick={() => remove(q)} title="Remove allocation"
                                className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: accent('danger').fg }}><Trash2 size={12} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {ladderFor === q.id && (
                      <tr>
                        <td colSpan={5} className="px-2 pb-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                          <MilestoneLadder quota={q} canEdit={!!can.member} unit={q.metric_unit}
                            onChanged={load} onError={onError} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>

      {edit && (
        <QuotaModal
          tier={edit.tier} quota={edit.quota} metrics={metrics} teamQuotas={teamQuotas}
          teamId={teamId} onSave={save} onClose={() => setEdit(null)} />
      )}
    </div>
  );
}

// ── milestone ladder (mig 218) ──────────────────────────────────────────────
// The rungs inside a quota. Rendered read-only for anyone who may see the quota
// and editable for whoever may edit that tier — the server already decided that
// and says so in `can_edit`, so this never re-derives it from a role.
//
// A percent rung shows its resolved absolute value too ("50% · 750"), because
// the lead thinks in percentages when handing out ten allocations and the member
// thinks in transfers when working.
function MilestoneLadder({ quota, canEdit, unit, onChanged, onError }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ threshold_kind: 'value', threshold: '', label: '', reward_amount: '', reward_description: '' });
  const [busy, setBusy] = useState(false);
  const list = quota.milestones || [];

  const inp = { backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '5px 8px', fontSize: 12, width: '100%' };
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  const add = async () => {
    if (!(Number(f.threshold) > 0)) return;
    setBusy(true);
    try {
      await client.post(`quotas/${quota.id}/milestones`, f);
      setF({ threshold_kind: 'value', threshold: '', label: '', reward_amount: '', reward_description: '' });
      setAdding(false); onChanged();
    } catch (e) { onError?.(e.response?.data?.error || 'Could not add that milestone'); }
    finally { setBusy(false); }
  };
  const remove = async (m) => {
    if (!window.confirm(`Remove the milestone at ${m.at}${m.label ? ` (${m.label})` : ''}?`)) return;
    try { await client.delete(`quotas/milestones/${m.id}`); onChanged(); }
    catch (e) { onError?.(e.response?.data?.error || 'Remove failed'); }
  };

  if (!list.length && !canEdit) return null;

  return (
    <div className="pt-2 mt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        <p className="m-0 text-[11px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5"
          style={{ color: 'var(--color-text-tertiary)' }}>
          <Gift size={11} /> Milestones{list.length ? ` (${list.filter(m => m.earned).length}/${list.length} earned)` : ''}
        </p>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary-600)' }}>
            <Plus size={11} /> Add milestone
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <p className="m-0 text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>
          No milestones yet — add one to reward progress before the full target lands.
        </p>
      ) : (
        <div className="space-y-1">
          {list.map(m => (
            <div key={m.id} className="flex items-center gap-2 text-[11px]">
              <span className="flex-shrink-0" style={{ color: m.earned ? accent('success').fg : 'var(--color-text-tertiary)' }}>
                {m.earned ? <Check size={12} /> : <span className="inline-block w-3 text-center">○</span>}
              </span>
              <span className="tabular-nums font-bold flex-shrink-0" style={{ color: 'var(--color-text)', minWidth: 52 }}>
                {fmt(m.at, unit)}
              </span>
              <span className="truncate flex-1 min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
                {m.threshold_kind === 'percent' && <span className="opacity-70">{m.threshold}% · </span>}
                {m.label || '—'}
                {(m.reward_description || m.reward_amount != null) && (
                  <b style={{ color: accent('warning').fg }}>
                    {' · '}{m.reward_description || `$${m.reward_amount}`}
                  </b>
                )}
              </span>
              <span className="flex-shrink-0 tabular-nums" style={{ color: m.earned ? accent('success').fg : 'var(--color-text-tertiary)' }}>
                {m.earned ? 'earned' : `${fmt(m.remaining, unit)} to go`}
              </span>
              {canEdit && (
                <button onClick={() => remove(m)} title="Remove milestone"
                  className="flex-shrink-0 p-1 rounded" style={{ color: accent('danger').fg }}><Trash2 size={11} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-2 rounded-xl p-2 space-y-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
          <div className="grid grid-cols-2 gap-1.5">
            <ThemedSelect value={f.threshold_kind} onChange={e => set('threshold_kind', e.target.value)} className="w-full" style={{ fontSize: 12 }}>
              <option value="value">At a number</option>
              <option value="percent">At a % of target</option>
            </ThemedSelect>
            <input type="number" min="1" value={f.threshold} onChange={e => set('threshold', e.target.value)}
              placeholder={f.threshold_kind === 'percent' ? 'e.g. 50' : 'e.g. 750'} style={inp} />
          </div>
          <input value={f.label} onChange={e => set('label', e.target.value)} placeholder="Name (e.g. Halfway push)" style={inp} />
          <div className="grid grid-cols-2 gap-1.5">
            <input type="number" min="0" value={f.reward_amount} onChange={e => set('reward_amount', e.target.value)} placeholder="Reward $" style={inp} />
            <input value={f.reward_description} onChange={e => set('reward_description', e.target.value)} placeholder="or describe the prize" style={inp} />
          </div>
          <div className="flex justify-end gap-1.5">
            <button onClick={() => setAdding(false)} className="px-2 py-1 rounded-lg text-[11px] font-semibold border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
            <button onClick={add} disabled={busy || !(Number(f.threshold) > 0)}
              className="px-2 py-1 rounded-lg text-[11px] font-bold text-white inline-flex items-center gap-1 disabled:opacity-40"
              style={{ background: 'var(--color-primary-600)' }}><Save size={11} /> {busy ? 'Saving…' : 'Add'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── create / edit ───────────────────────────────────────────────────────────
function QuotaModal({ tier, quota, metrics, teamQuotas, teamId, onSave, onClose }) {
  const isEdit = !!quota;
  const [members, setMembers] = useState([]);
  const [f, setF] = useState({
    id: quota?.id,
    user_id: quota?.user_id || '',
    metric: quota?.metric || metrics[0]?.key || 'transfers',
    target_value: quota?.target_value ?? '',
    period_kind: quota?.period_kind || 'month',
    starts_at: quota?.starts_at || '',
    ends_at: quota?.ends_at || '',
    label: quota?.label || '',
    parent_quota_id: quota?.parent_quota_id || '',
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const inp = { backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13, width: '100%' };

  // The member picker only lists people actually on the team — the server
  // rejects anyone else, so offering them would only produce a 400.
  useEffect(() => {
    if (tier !== 'member') return;
    client.get(`teams/${teamId}/report`).then(r => setMembers(r.data.members || [])).catch(() => setMembers([]));
  }, [tier, teamId]);

  const chosen = metrics.find(m => m.key === f.metric);
  const needsRange = f.period_kind === 'range';
  const valid = !!f.metric && Number(f.target_value) > 0
    && (tier === 'team' || !!f.user_id)
    && (!needsRange || (!!f.starts_at && !!f.ends_at && f.ends_at >= f.starts_at));

  // A member allocation offers to hang itself off a matching team quota so the
  // member's own card can show "team at 61%" for context.
  const parentOptions = teamQuotas.filter(t => t.metric === f.metric);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl p-5 w-full max-w-md space-y-3 max-h-[90vh] overflow-auto"
        style={{ backgroundColor: 'var(--color-surface)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold m-0" style={{ color: 'var(--color-text)' }}>
            {isEdit ? 'Edit ' : ''}{tier === 'team' ? 'Team target' : 'Member allocation'}
          </h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>

        {tier === 'member' && (
          <Field label="Member">
            <ThemedSelect value={f.user_id} onChange={e => set('user_id', e.target.value)} className="w-full"
              disabled={isEdit} placeholder="— pick a member —">
              <option value="">— pick a member —</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </ThemedSelect>
          </Field>
        )}

        <Field label="Metric">
          <ThemedSelect value={f.metric} onChange={e => set('metric', e.target.value)} className="w-full" disabled={isEdit}>
            {metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </ThemedSelect>
        </Field>
        {chosen?.hint && <p className="m-0 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{chosen.hint}</p>}
        {isEdit && <p className="m-0 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          The metric can’t change after creation — it would re-point the quota at a different counter and make its history meaningless. Remove it and add a new one instead.
        </p>}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Target">
            <input type="number" min="1" value={f.target_value} onChange={e => set('target_value', e.target.value)} placeholder="e.g. 1500" style={inp} />
          </Field>
          <Field label="Period">
            <ThemedSelect value={f.period_kind} onChange={e => set('period_kind', e.target.value)} className="w-full">
              {PERIODS.map(p => <option key={p.k} value={p.k}>{p.label}</option>)}
            </ThemedSelect>
          </Field>
        </div>

        {needsRange && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><ThemedDate value={f.starts_at} max={f.ends_at || undefined} onChange={e => set('starts_at', e.target.value)} placeholder="From" /></Field>
            <Field label="To"><ThemedDate value={f.ends_at} min={f.starts_at || undefined} onChange={e => set('ends_at', e.target.value)} placeholder="To" /></Field>
          </div>
        )}

        {tier === 'member' && parentOptions.length > 0 && !isEdit && (
          <Field label="Counts toward (optional)">
            <ThemedSelect value={f.parent_quota_id} onChange={e => set('parent_quota_id', e.target.value)} className="w-full" placeholder="— standalone —">
              <option value="">— standalone —</option>
              {parentOptions.map(t => <option key={t.id} value={t.id}>{t.label || t.metric_label} · {t.starts_at} → {t.ends_at} · {t.target_value}</option>)}
            </ThemedSelect>
          </Field>
        )}

        <Field label="Name (optional)">
          <input value={f.label} onChange={e => set('label', e.target.value)} placeholder="e.g. July push" style={inp} />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-semibold border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={() => valid && onSave(f)} disabled={!valid}
            className="px-3 py-2 rounded-lg text-sm font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: 'var(--gradient-sidebar)' }}><Save size={13} /> Save</button>
        </div>
      </div>
    </div>
  );
}
