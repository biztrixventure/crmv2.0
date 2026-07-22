import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Plus, Pencil, Trash2, Save, X, Crown, UserPlus, BarChart3, Target,
  RefreshCw, TrendingUp, Phone, DollarSign,
} from 'lucide-react';
import client from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';

// ── Team structure + reporting (superadmin / company_admin / operations_manager)
// Additive org layer: create teams per company, assign members, set goals, and
// view live team progress. Does not change any existing access.

const TEAM_TYPES = [
  { k: 'general',  label: 'General' },
  { k: 'fronter',  label: 'Fronter team' },
  { k: 'closer',   label: 'Closer team' },
  { k: 'mixed',    label: 'Mixed' },
];
const TYPE_COLOR = { fronter: '#2563eb', closer: '#16a34a', mixed: '#9333ea', general: '#6b7280' };
const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const box = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' };

export default function TeamManager() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [companyId, setCompanyId] = useState('');
  const [teams, setTeams] = useState([]);
  const [members, setMembers] = useState([]);   // company roster
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [editTeam, setEditTeam] = useState(null);   // team obj or {} for new
  const [reportTeam, setReportTeam] = useState(null);

  useEffect(() => {
    client.get('companies').then(r => {
      const cos = (Array.isArray(r.data) ? r.data : r.data?.companies || []).map(c => ({ id: c.id, name: c.name })).filter(c => c.id);
      setCompanies(cos);
      setCompanyId(prev => prev || user?.company_id || cos[0]?.id || '');
    }).catch(() => setCompanies([]));
  }, [user?.company_id]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true); setErr('');
    try {
      const [t, m] = await Promise.all([
        client.get('teams', { params: { company_id: companyId } }),
        client.get('teams/company-members', { params: { company_id: companyId } }),
      ]);
      setTeams(t.data.teams || []);
      setMembers(m.data.members || []);
    } catch (e) { setErr(e.response?.data?.error || 'Failed to load teams'); }
    finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const unassigned = useMemo(() => members.filter(m => !m.team_id), [members]);
  const nameOf = useMemo(() => Object.fromEntries(members.map(m => [m.user_id, m.name])), [members]);

  const roots = teams.filter(t => !t.parent_team_id);
  const childrenOf = (id) => teams.filter(t => t.parent_team_id === id);

  const saveTeam = async (form) => {
    try {
      if (form.id) await client.put(`teams/${form.id}`, form);
      else await client.post('teams', { ...form, company_id: companyId });
      setEditTeam(null); load();
    } catch (e) { setErr(e.response?.data?.error || 'Save failed'); }
  };
  const delTeam = async (t) => {
    if (!window.confirm(`Delete team "${t.name}"? Members become unassigned.`)) return;
    try { await client.delete(`teams/${t.id}`); load(); } catch (e) { setErr(e.response?.data?.error || 'Delete failed'); }
  };
  const addMember = async (teamId, userId) => { try { await client.post(`teams/${teamId}/members`, { user_id: userId }); load(); } catch (e) { setErr(e.response?.data?.error || 'Add failed'); } };
  const removeMember = async (teamId, userId) => { try { await client.delete(`teams/${teamId}/members/${userId}`); load(); } catch (e) { setErr(e.response?.data?.error || 'Remove failed'); } };

  const TeamCard = ({ t, depth = 0 }) => (
    <div style={{ marginLeft: depth * 20 }}>
      <div className="rounded-2xl p-4 mb-2" style={{ ...box, borderLeft: `4px solid ${t.color || TYPE_COLOR[t.team_type] || '#6b7280'}` }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Users size={16} style={{ color: t.color || TYPE_COLOR[t.team_type] }} />
              <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{t.name}</span>
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{t.team_type}</span>
              <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{t.member_count} member{t.member_count === 1 ? '' : 's'}</span>
            </div>
            {t.lead_name && <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}><Crown size={11} style={{ color: '#d97706' }} /> Lead: {t.lead_name}</p>}
            {(t.goal_monthly_sales || t.goal_monthly_transfers) && (
              <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}><Target size={11} /> Goal: {t.goal_monthly_sales ? `${t.goal_monthly_sales} sales` : ''}{t.goal_monthly_sales && t.goal_monthly_transfers ? ' · ' : ''}{t.goal_monthly_transfers ? `${t.goal_monthly_transfers} transfers` : ''}/mo</p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => setReportTeam(t)} title="Team report" className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-primary-600)' }}><BarChart3 size={14} /></button>
            <button onClick={() => setEditTeam(t)} title="Edit" className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><Pencil size={14} /></button>
            <button onClick={() => delTeam(t)} title="Delete" className="p-1.5 rounded-lg" style={{ border: '1px solid var(--color-border)', color: '#ef4444' }}><Trash2 size={14} /></button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(t.members || []).map(m => (
            <span key={m.user_id} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
              {m.role_in_team === 'lead' && <Crown size={10} style={{ color: '#d97706' }} />}{m.name}
              <button onClick={() => removeMember(t.id, m.user_id)} className="hover:opacity-60"><X size={11} /></button>
            </span>
          ))}
          <AddMemberInline unassigned={unassigned} onAdd={(uid) => addMember(t.id, uid)} />
        </div>
      </div>
      {childrenOf(t.id).map(c => <TeamCard key={c.id} t={c} depth={depth + 1} />)}
    </div>
  );

  return (
    <div className="space-y-4 animate-fade-in max-w-5xl">
      <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap relative z-10">
          <div className="flex items-center gap-3">
            <Users size={22} className="text-white" />
            <div>
              <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Teams</h2>
              <p className="text-sm text-white/80">Org structure, members, goals and live progress — per company.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {companies.length > 1 && (
              <select value={companyId} onChange={e => setCompanyId(e.target.value)}
                className="text-sm rounded-lg px-3 py-2 font-semibold" style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.4)' }}>
                {companies.map(c => <option key={c.id} value={c.id} style={{ color: '#111' }}>{c.name}</option>)}
              </select>
            )}
            <button onClick={load} className="p-2 rounded-lg text-white" style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.4)' }}><RefreshCw size={15} /></button>
            <button onClick={() => setEditTeam({})} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.4)' }}><Plus size={14} /> New team</button>
          </div>
        </div>
      </div>

      {err && <div className="rounded-xl p-3 text-xs" style={{ backgroundColor: 'var(--color-error-50,#fef2f2)', color: 'var(--color-error-700,#b91c1c)', border: '1px solid var(--color-error-200,#fecaca)' }}>{err}</div>}

      {loading ? <p className="text-sm text-center py-6 italic" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p> : (
        <>
          {roots.length === 0 ? (
            <p className="text-sm text-center py-8 italic" style={{ color: 'var(--color-text-secondary)' }}>No teams yet for this company. Click <b>New team</b> to start.</p>
          ) : roots.map(t => <TeamCard key={t.id} t={t} />)}

          <div className="rounded-2xl p-4" style={box}>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-tertiary)' }}>Unassigned ({unassigned.length})</p>
            {unassigned.length === 0 ? <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Everyone in this company is on a team.</p> : (
              <div className="flex flex-wrap gap-1.5">
                {unassigned.map(m => (
                  <span key={m.user_id} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                    {m.name}<span className="opacity-60">· {(m.role || '').replace(/_/g, ' ')}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {editTeam && <TeamModal team={editTeam} teams={teams} members={members} onSave={saveTeam} onClose={() => setEditTeam(null)} />}
      {reportTeam && <TeamReport team={reportTeam} onClose={() => setReportTeam(null)} />}
    </div>
  );
}

function AddMemberInline({ unassigned, onAdd }) {
  const [open, setOpen] = useState(false);
  if (!unassigned.length) return null;
  return (
    <span className="relative">
      <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary-600)' }}><UserPlus size={11} /> Add</button>
      {open && (
        <div className="absolute z-30 mt-1 left-0 w-56 max-h-52 overflow-auto rounded-xl py-1" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg,0 8px 24px rgba(0,0,0,.15))' }}>
          {unassigned.map(m => (
            <button key={m.user_id} onClick={() => { onAdd(m.user_id); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-bg-secondary">
              {m.name} <span className="opacity-60">· {(m.role || '').replace(/_/g, ' ')}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function TeamModal({ team, teams, members, onSave, onClose }) {
  const [f, setF] = useState({
    id: team.id, name: team.name || '', description: team.description || '', team_type: team.team_type || 'general',
    lead_user_id: team.lead_user_id || '', parent_team_id: team.parent_team_id || '',
    goal_monthly_sales: team.goal_monthly_sales ?? '', goal_monthly_transfers: team.goal_monthly_transfers ?? '', color: team.color || '',
  });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const inp = { backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13, width: '100%' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl p-5 w-full max-w-md space-y-3" style={{ backgroundColor: 'var(--color-surface)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold" style={{ color: 'var(--color-text)' }}>{f.id ? 'Edit team' : 'New team'}</h3><button onClick={onClose}><X size={18} /></button></div>
        <Field label="Name"><input value={f.name} onChange={e => set('name', e.target.value)} style={inp} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type"><select value={f.team_type} onChange={e => set('team_type', e.target.value)} style={inp}>{TEAM_TYPES.map(t => <option key={t.k} value={t.k}>{t.label}</option>)}</select></Field>
          <Field label="Color"><input type="color" value={f.color || TYPE_COLOR[f.team_type]} onChange={e => set('color', e.target.value)} style={{ ...inp, padding: 2, height: 34 }} /></Field>
        </div>
        <Field label="Team lead"><select value={f.lead_user_id} onChange={e => set('lead_user_id', e.target.value)} style={inp}><option value="">— none —</option>{members.map(m => <option key={m.user_id} value={m.user_id}>{m.name} ({(m.role || '').replace(/_/g, ' ')})</option>)}</select></Field>
        <Field label="Parent team (nesting)"><select value={f.parent_team_id} onChange={e => set('parent_team_id', e.target.value)} style={inp}><option value="">— top level —</option>{teams.filter(t => t.id !== f.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Monthly sales goal"><input type="number" min="0" value={f.goal_monthly_sales} onChange={e => set('goal_monthly_sales', e.target.value)} placeholder="—" style={inp} /></Field>
          <Field label="Monthly transfers goal"><input type="number" min="0" value={f.goal_monthly_transfers} onChange={e => set('goal_monthly_transfers', e.target.value)} placeholder="—" style={inp} /></Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={() => f.name && onSave(f)} disabled={!f.name} className="px-3 py-2 rounded-lg text-sm font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-40" style={{ background: 'var(--gradient-sidebar)' }}><Save size={13} /> Save</button>
        </div>
      </div>
    </div>
  );
}

function TeamReport({ team, onClose }) {
  const [rep, setRep] = useState(null);
  const [range, setRange] = useState(30);
  useEffect(() => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - range * 864e5).toISOString().slice(0, 10);
    client.get(`teams/${team.id}/report`, { params: { from, to } }).then(r => setRep(r.data)).catch(() => setRep({ error: true }));
  }, [team.id, range]);
  const t = rep?.totals || {};
  const Stat = ({ icon, label, value, color }) => (
    <div className="rounded-xl p-3 text-center" style={{ ...box }}>
      <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>{icon}{label}</div>
      <div className="text-xl font-extrabold mt-1" style={{ color: color || 'var(--color-text)' }}>{value}</div>
    </div>
  );
  const bar = (pct) => (
    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <div style={{ width: `${Math.min(100, pct || 0)}%`, height: '100%', background: (pct || 0) >= 100 ? '#16a34a' : 'var(--gradient-sidebar)' }} />
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl p-5 w-full max-w-2xl max-h-[88vh] overflow-auto space-y-4" style={{ backgroundColor: 'var(--color-surface)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-bold flex items-center gap-2" style={{ color: 'var(--color-text)' }}><BarChart3 size={18} /> {team.name} — progress</h3>
          <div className="flex items-center gap-2">
            <select value={range} onChange={e => setRange(+e.target.value)} className="text-xs rounded-lg px-2 py-1.5" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
            </select>
            <button onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        {!rep ? <p className="text-sm italic text-center py-6" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p> : rep.error ? <p className="text-sm text-center py-6" style={{ color: '#dc2626' }}>Failed to load report.</p> : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Stat icon={<TrendingUp size={11} />} label="Transfers" value={t.transfers ?? 0} color="#2563eb" />
              <Stat icon={<DollarSign size={11} />} label="Sales" value={t.sales ?? 0} color="#16a34a" />
              <Stat icon={<DollarSign size={11} />} label="Gross" value={money(t.gross)} />
              <Stat icon={<Phone size={11} />} label="Callbacks" value={t.callbacks ?? 0} />
              <Stat icon={<Target size={11} />} label="Conversion" value={t.conversion != null ? `${t.conversion}%` : '—'} />
            </div>

            <TrendChart data={rep.trend} />

            {(rep.goal?.monthly_sales || rep.goal?.monthly_transfers) && (
              <div className="rounded-xl p-3 space-y-2" style={box}>
                <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>Goal progress</p>
                {rep.goal.monthly_sales != null && <div><div className="flex justify-between text-xs mb-1"><span>Sales</span><span>{t.sales}/{rep.goal.monthly_sales} ({rep.goal.sales_pct}%)</span></div>{bar(rep.goal.sales_pct)}</div>}
                {rep.goal.monthly_transfers != null && <div><div className="flex justify-between text-xs mb-1"><span>Transfers</span><span>{t.transfers}/{rep.goal.monthly_transfers} ({rep.goal.transfers_pct}%)</span></div>{bar(rep.goal.transfers_pct)}</div>}
              </div>
            )}

            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <table className="w-full text-xs">
                <thead><tr style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                  {['#', 'Member', 'Transfers', 'Sales', 'Gross', 'Callbacks'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {(rep.members || []).map((m, i) => (
                    <tr key={m.user_id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-3 py-1.5" style={{ color: 'var(--color-text-tertiary)' }}>{i + 1}</td>
                      <td className="px-3 py-1.5 font-semibold" style={{ color: 'var(--color-text)' }}>{m.name}</td>
                      <td className="px-3 py-1.5">{m.transfers}</td>
                      <td className="px-3 py-1.5">{m.sales}</td>
                      <td className="px-3 py-1.5">{money(m.gross)}</td>
                      <td className="px-3 py-1.5">{m.callbacks}</td>
                    </tr>
                  ))}
                  {(rep.members || []).length === 0 && <tr><td colSpan={6} className="text-center py-4 italic" style={{ color: 'var(--color-text-tertiary)' }}>No members.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Includes nested sub-teams. Sales credited to the closer (won deals); transfers to the fronter; gross = down payment. Live from records.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>{children}</label>;
}

// Small dependency-free daily trend: grouped bars (transfers = blue, sales =
// green) per day over the selected range. Shows how the team is working over time.
function TrendChart({ data }) {
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) return <p className="text-[11px] italic" style={{ color: 'var(--color-text-tertiary)' }}>No activity in this range to chart.</p>;
  const max = Math.max(1, ...rows.map(r => Math.max(r.transfers || 0, r.sales || 0)));
  const W = Math.max(rows.length * 16, 200), H = 90, pad = 4;
  const bw = (W - pad * 2) / rows.length;   // per-day slot
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  return (
    <div className="rounded-xl p-3" style={box}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>Daily trend</p>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, background: '#2563eb', display: 'inline-block', borderRadius: 2 }} /> Transfers</span>
          <span className="inline-flex items-center gap-1"><span style={{ width: 8, height: 8, background: '#16a34a', display: 'inline-block', borderRadius: 2 }} /> Sales</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg width={W} height={H} style={{ display: 'block' }}>
          {rows.map((r, i) => {
            const x = pad + i * bw;
            const w = Math.max(2, bw / 2 - 1);
            return (
              <g key={r.date}>
                <rect x={x} y={y(r.transfers || 0)} width={w} height={H - pad - y(r.transfers || 0)} fill="#2563eb" rx="1">
                  <title>{`${r.date}: ${r.transfers || 0} transfers`}</title>
                </rect>
                <rect x={x + w + 1} y={y(r.sales || 0)} width={w} height={H - pad - y(r.sales || 0)} fill="#16a34a" rx="1">
                  <title>{`${r.date}: ${r.sales || 0} sales`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
