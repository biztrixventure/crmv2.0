import { useEffect, useState } from 'react';
import { Trophy, Plus, Edit2, Trash2, X, BarChart3, Medal, Zap } from 'lucide-react';
import { Button, Alert, Badge } from '../../UI';
import RichTextEditor from '../../UI/RichTextEditor';
import RichView from '../../UI/RichView';
import client from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import AudienceTargetPicker from './AudienceTargetPicker';

// Plain-text preview for compact UI surfaces (table cells, lists). Mirrors
// RichView's "has tags?" heuristic so legacy plain-text descriptions stay
// readable.
const stripHtml = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const METRICS = [
  { v: 'deals_closed', l: 'Deals Closed' }, { v: 'revenue', l: 'Revenue' },
  { v: 'calls_made', l: 'Calls Made' }, { v: 'demos_booked', l: 'Demos Booked' }, { v: 'custom', l: 'Custom…' },
];
const KNOWN = METRICS.map(m => m.v).filter(v => v !== 'custom');

// `metric_source` decides where the score comes from:
//   manual    → typed in per-participant (legacy behavior)
//   transfers → live count of completed transfers attributed to created_by
//   sales     → live count of sales attributed to closer_id (closed/pending statuses)
//   revenue   → live sum of monthly_payment on closed_won/sold sales
// Picking an auto source also pre-fills the human-readable `metric` label below.
const METRIC_SOURCES = [
  { v: 'manual',    l: 'Manual entry',                  hint: 'Scores typed in per participant. Use only when activity isn’t tracked in the CRM.' },
  { v: 'transfers', l: 'Auto: Transfers completed',     hint: 'Counts transfers each participant created within the campaign window.', label: 'transfers' },
  { v: 'sales',     l: 'Auto: Sales closed',            hint: 'Counts sales each participant closed within the campaign window.',     label: 'sales_closed' },
  { v: 'revenue',   l: 'Auto: Revenue (monthly)',       hint: 'Sums monthly_payment on each participant’s closed_won/sold sales.', label: 'revenue' },
];
const SOURCE_LABEL = Object.fromEntries(METRIC_SOURCES.map(s => [s.v, s.l]));
const isAuto = (s) => s && s !== 'manual';

const blank = { title: '', description: '', metric: 'deals_closed', metric_source: 'manual', target_value: 10, reward_amount: '', reward_description: '', target_company_ids: [], target_roles: [], target_user_ids: [], status: 'active', starts_at: '', ends_at: '' };
const MEDAL = ['#f59e0b', '#94a3b8', '#b45309'];

const Modal = ({ row, reference, onClose, onSave, viewer }) => {
  const isSuperadmin = viewer?.role === 'superadmin';
  const myCompanyId  = viewer?.company_id || null;
  // For a non-superadmin creating a NEW SPIFF, pre-pin the company so the
  // hierarchical picker only ever offers users from their own company.
  const seededBlank = !row && !isSuperadmin && myCompanyId
    ? { ...blank, target_company_ids: [myCompanyId] }
    : blank;
  const init = row
    ? { ...blank, ...row, starts_at: row.starts_at ? row.starts_at.slice(0, 16) : '', ends_at: row.ends_at ? row.ends_at.slice(0, 16) : '' }
    : seededBlank;
  const [form, setForm] = useState(init);
  const [customMetric, setCustomMetric] = useState(row && !KNOWN.includes(row.metric) ? row.metric : '');
  const [metricSel, setMetricSel] = useState(row ? (KNOWN.includes(row.metric) ? row.metric : 'custom') : 'deals_closed');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    const metric = metricSel === 'custom' ? customMetric.trim() : metricSel;
    if (!form.title.trim() || !metric || !form.starts_at || !form.ends_at) { setErr('Title, metric, start and end are required.'); return; }
    setSaving(true); setErr('');
    try {
      await onSave({ ...form, metric, target_value: Number(form.target_value) || 0, reward_amount: form.reward_amount === '' ? null : Number(form.reward_amount),
        starts_at: new Date(form.starts_at).toISOString(), ends_at: new Date(form.ends_at).toISOString() });
      onClose();
    } catch (er) { setErr(er.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-xl my-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5"><Trophy size={20} className="text-white" /><h3 className="text-lg font-bold text-white">{row ? 'Edit SPIFF' : 'New SPIFF Campaign'}</h3></div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && <Alert type="error" message={err} />}
          <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Title <span style={{ color: '#ef4444' }}>*</span></label>
            <input value={form.title} onChange={e => set('title', e.target.value)} className="input" placeholder="May Deal Sprint" /></div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Description</label>
            <RichTextEditor value={form.description || ''} onChange={(html) => set('description', html)} placeholder="Optional — bold, lists, links supported." minHeight={120} />
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Source <span style={{ color: '#ef4444' }}>*</span></label>
            <select value={form.metric_source} onChange={e => {
              const src = e.target.value;
              const preset = METRIC_SOURCES.find(s => s.v === src);
              setForm(f => ({ ...f, metric_source: src, ...(preset?.label ? { metric: preset.label } : {}) }));
              if (preset?.label) { setMetricSel('custom'); setCustomMetric(preset.label); }
            }} className="input">{METRIC_SOURCES.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{METRIC_SOURCES.find(s => s.v === form.metric_source)?.hint}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Label</label>
              <select value={metricSel} onChange={e => setMetricSel(e.target.value)} className="input" disabled={isAuto(form.metric_source)}>{METRICS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}</select>
              {metricSel === 'custom' && <input value={customMetric} onChange={e => setCustomMetric(e.target.value)} className="input mt-1.5" placeholder="custom_metric" disabled={isAuto(form.metric_source)} />}
            </div>
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Target value <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="number" value={form.target_value} onChange={e => set('target_value', e.target.value)} className="input" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Reward amount ($)</label>
              <input type="number" value={form.reward_amount} onChange={e => set('reward_amount', e.target.value)} className="input" placeholder="500" /></div>
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Reward description</label>
              <input value={form.reward_description} onChange={e => set('reward_description', e.target.value)} className="input" placeholder="$500 Amazon gift card" /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Starts <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)} className="input" /></div>
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Ends <span style={{ color: '#ef4444' }}>*</span></label>
              <input type="datetime-local" value={form.ends_at} onChange={e => set('ends_at', e.target.value)} className="input" /></div>
            <div><label className="block text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="input"><option value="draft">Draft</option><option value="active">Active</option><option value="ended">Ended</option></select></div>
          </div>
          <AudienceTargetPicker
            value={form}
            onChange={v => setForm(f => ({ ...f, ...v }))}
            reference={reference}
            hierarchical
            restrictToCompanyId={isSuperadmin ? null : myCompanyId}
          />
          <div className="flex gap-3 pt-2"><Button type="button" variant="secondary" onClick={onClose} className="flex-1">Cancel</Button><Button type="submit" variant="primary" disabled={saving} className="flex-1">{saving ? 'Saving…' : row ? 'Save' : 'Create'}</Button></div>
        </form>
      </div>
    </div>
  );
};

const DetailModal = ({ campaign, reference, onClose, onChanged }) => {
  const [data, setData] = useState(null);
  const [uid, setUid] = useState('');
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  const load = () => client.get(`spiff/${campaign.id}`).then(r => setData(r.data)).catch(() => {});
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [campaign.id]);

  const addEntry = async (e) => {
    e.preventDefault();
    if (!uid || val === '') return;
    setSaving(true);
    try { await client.post(`spiff/${campaign.id}/entry`, { user_id: uid, value: Number(val) }); setUid(''); setVal(''); load(); onChanged?.(); }
    catch {} finally { setSaving(false); }
  };

  const target = Number(campaign.target_value) || 1;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-2xl my-6 rounded-2xl animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}>
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-2.5"><BarChart3 size={20} className="text-white" /><div><h3 className="text-lg font-bold text-white">{campaign.title}</h3><p className="text-xs text-white/70">{campaign.reward_description || (campaign.reward_amount ? `$${campaign.reward_amount}` : '')} · target {target} {campaign.metric}</p></div></div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={18} className="text-white" /></button>
        </div>
        <div className="p-6 space-y-4">
          {campaign.description && (
            <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Description</p>
              <RichView html={campaign.description} className="text-sm" style={{ color: 'var(--color-text)' }} />
            </div>
          )}
          {isAuto(campaign.metric_source) ? (
            <div className="flex items-start gap-2 rounded-xl p-3 text-xs" style={{ backgroundColor: 'var(--color-primary-50, #f5f3ff)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <Zap size={14} style={{ color: 'var(--color-primary-600)', marginTop: 1, flexShrink: 0 }} />
              <span><strong>Auto-computed</strong> — scores update from real activity ({SOURCE_LABEL[campaign.metric_source]}) within the campaign window. Manual entry is disabled.</span>
            </div>
          ) : (
            <form onSubmit={addEntry} className="flex items-end gap-2 rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <div className="flex-1"><label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>Participant</label>
                <select value={uid} onChange={e => setUid(e.target.value)} className="input text-sm"><option value="">Select user…</option>{(reference.users || []).map(u => <option key={u.user_id} value={u.user_id}>{u.name}{u.company_name ? ` (${u.company_name})` : ''}</option>)}</select></div>
              <div className="w-28"><label className="block text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--color-text-secondary)' }}>Score</label>
                <input type="number" value={val} onChange={e => setVal(e.target.value)} className="input text-sm" /></div>
              <Button type="submit" variant="primary" disabled={saving || !uid || val === ''}>Set</Button>
            </form>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {!data ? <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-tertiary)' }}>Loading…</p>
            : data.leaderboard.length === 0 ? <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-tertiary)' }}>No participants yet. Add scores above.</p>
            : data.leaderboard.map(e => {
              const pct = Math.min(100, Math.round((Number(e.value) / target) * 100));
              return (
                <div key={e.user_id || e.id} className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                      {e.rank <= 3 ? <Medal size={15} style={{ color: MEDAL[e.rank - 1] }} /> : <span className="w-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{e.rank}</span>}
                      {e.name}
                    </span>
                    <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{e.value} <span className="text-xs font-normal opacity-60">/ {target}</span></span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--gradient-sidebar)' }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const SpiffManager = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [reference, setReference] = useState({ roles: [], companies: [], users: [] });
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');

  const load = async () => { setLoading(true); try { const r = await client.get('spiff/manage'); setRows(r.data.campaigns || []); } catch (e) { setError(e.response?.data?.error || 'Failed to load'); } finally { setLoading(false); } };
  useEffect(() => { load(); client.get('spiff/reference').then(r => setReference(r.data)).catch(() => {}); }, []);

  const save = async (payload) => { if (modal?.row) await client.put(`spiff/${modal.row.id}`, payload); else await client.post('spiff', payload); load(); };
  const del = async (c) => { try { await client.delete(`spiff/${c.id}`); } catch {} setConfirm(null); load(); };
  const fmt = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return '—'; } };
  const statusVariant = { draft: 'secondary', active: 'success', ended: 'warning', expired: 'warning' };
  // An 'active' campaign past its ends_at is effectively over — show "Expired" to
  // the admin even if the stored status hasn't been flipped (the user widget
  // already hides it). Keeps the report list honest without a status-flip job.
  const effStatus = (c) => (c.status === 'active' && c.ends_at && new Date(c.ends_at).getTime() < Date.now()) ? 'expired' : c.status;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="rounded-2xl p-6 relative overflow-hidden flex items-center justify-between flex-wrap gap-3" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-center gap-2.5"><Trophy size={22} className="text-white" /><div>
          <h2 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>SPIFF Campaigns</h2>
          <p className="text-sm text-white/80">Incentive competitions with live leaderboards.</p>
        </div></div>
        <Button variant="primary" onClick={() => setModal({ row: null })} className="flex items-center gap-1.5"><Plus size={16} /> New SPIFF</Button>
      </div>

      {error && <Alert type="error" message={error} />}

      {loading ? <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
      : rows.length === 0 ? <div className="rounded-2xl p-12 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}><Trophy size={40} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)', opacity: 0.5 }} /><p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No campaigns yet.</p></div>
      : (
        <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead><tr style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['Title', 'Metric', 'Target', 'Reward', 'Status', 'Dates', 'Players', ''].map(h => <th key={h} className="px-4 py-2.5 text-left text-xs font-bold uppercase" style={{ color: 'var(--color-text-secondary)' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-4 py-3" style={{ color: 'var(--color-text)' }}>
                    <div className="flex items-center gap-1.5 font-semibold">
                      {c.title}
                      {isAuto(c.metric_source) && (
                        <span title={`Auto-computed from ${SOURCE_LABEL[c.metric_source]}`}
                          className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                          <Zap size={10} /> Auto
                        </span>
                      )}
                    </div>
                    {c.description && (() => {
                      const text = stripHtml(c.description);
                      return text ? (
                        <p className="text-xs mt-0.5 line-clamp-2" title={text} style={{ color: 'var(--color-text-tertiary)' }}>
                          {text.length > 120 ? `${text.slice(0, 117)}…` : text}
                        </p>
                      ) : null;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs capitalize" style={{ color: 'var(--color-text-secondary)' }}>{String(c.metric).replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.target_value}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.reward_description || (c.reward_amount ? `$${c.reward_amount}` : '—')}</td>
                  <td className="px-4 py-3">{(() => { const st = effStatus(c); return <Badge variant={statusVariant[st] || 'secondary'} size="sm">{st}</Badge>; })()}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{fmt(c.starts_at)} – {fmt(c.ends_at)}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{c.participant_count}</td>
                  <td className="px-4 py-3"><div className="flex items-center gap-1">
                    <button onClick={() => setDetail(c)} title="Leaderboard / scores" className="p-1.5 rounded hover:bg-bg-secondary"><BarChart3 size={15} style={{ color: 'var(--color-primary-600)' }} /></button>
                    {/* Non-superadmin viewers cannot edit/delete a campaign the superadmin
                        created, even when it targets their company — mirrors backend canTouch. */}
                    {(user?.role === 'superadmin' || !c.created_by_superadmin) ? (
                      <>
                        <button onClick={() => setModal({ row: c })} title="Edit" className="p-1.5 rounded hover:bg-bg-secondary"><Edit2 size={15} style={{ color: 'var(--color-primary-500)' }} /></button>
                        <button onClick={() => setConfirm(c)} title="Delete" className="p-1.5 rounded hover:bg-error-50"><Trash2 size={15} style={{ color: 'var(--color-error-500)' }} /></button>
                      </>
                    ) : (
                      <span title="Created by a superadmin — only superadmins can edit or delete this campaign." className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>Locked</span>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <Modal row={modal.row} reference={reference} onClose={() => setModal(null)} onSave={save} viewer={user} />}
      {detail && <DetailModal campaign={detail} reference={reference} onClose={() => setDetail(null)} onChanged={load} />}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 rounded-2xl" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <h3 className="text-lg font-bold mb-1" style={{ color: 'var(--color-text)' }}>Delete campaign</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>Delete “{confirm.title}” and all its entries? This cannot be undone.</p>
            <div className="flex gap-3"><Button variant="secondary" onClick={() => setConfirm(null)} className="flex-1">Cancel</Button><Button variant="danger" onClick={() => del(confirm)} className="flex-1">Delete</Button></div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpiffManager;
