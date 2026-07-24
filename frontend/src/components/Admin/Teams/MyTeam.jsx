import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users, Crown, Target, Pencil, Save, X, UserPlus, RefreshCw, TrendingUp,
  DollarSign, Phone, Award,
} from 'lucide-react';
import client from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import TeamAnalytics from './TeamAnalytics';

// ── My Team — the TEAM LEAD's home. Land on your own team: live progress
// (stats, trend, leaderboard, goals) + manage your roster & goals in one place.
// A plain member sees the same dashboard read-only. Managers with no team get a
// prompt to build one in the Teams tab.

const money = (n) => `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const box = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' };
const TYPE_COLOR = { fronter: '#2563eb', closer: '#16a34a', mixed: '#9333ea', general: '#6b7280' };
const MEDAL = ['#f59e0b', '#94a3b8', '#b45309'];   // gold / silver / bronze

export default function MyTeam() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState(null);
  const [isLead, setIsLead] = useState(false);
  const [report, setReport] = useState(null);
  const [roster, setRoster] = useState([]);
  const [range, setRange] = useState(30);          // 7 | 30 | 90 | 'custom'
  const [cFrom, setCFrom] = useState('');          // custom range (YYYY-MM-DD)
  const [cTo, setCTo] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [err, setErr] = useState('');
  const canCreate = ['company_admin', 'operations_manager'].includes(user?.role);

  const loadTeam = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data } = await client.get('teams/my', { params: { company_id: user?.company_id } });
      setTeam(data.team || null); setIsLead(!!data.is_lead);
    } catch (e) { setErr(e.response?.data?.error || 'Failed to load your team'); }
    finally { setLoading(false); }
  }, [user?.company_id]);
  useEffect(() => { loadTeam(); }, [loadTeam]);

  const loadReport = useCallback(async () => {
    if (!team) { setReport(null); return; }
    let from, to;
    if (range === 'custom') {
      if (!cFrom || !cTo) return;              // wait until both custom dates picked
      from = cFrom; to = cTo;                  // single day = pick the same date twice
    } else {
      to = new Date().toISOString().slice(0, 10);
      from = new Date(Date.now() - range * 864e5).toISOString().slice(0, 10);
    }
    try {
      const [r, m] = await Promise.all([
        client.get(`teams/${team.id}/report`, { params: { from, to } }),
        isLead ? client.get('teams/company-members', { params: { company_id: team.company_id } }) : Promise.resolve({ data: { members: [] } }),
      ]);
      setReport(r.data); setRoster(m.data.members || []);
    } catch { setReport({ error: true }); }
  }, [team, range, cFrom, cTo, isLead]);
  useEffect(() => { loadReport(); }, [loadReport]);

  const unassigned = useMemo(() => roster.filter(m => !m.team_id), [roster]);
  const t = report?.totals || {};

  const addMember = async (uid) => { try { await client.post(`teams/${team.id}/members`, { user_id: uid }); loadReport(); loadTeam(); } catch (e) { setErr(e.response?.data?.error || 'Add failed'); } };
  const removeMember = async (uid) => { try { await client.delete(`teams/${team.id}/members/${uid}`); loadReport(); loadTeam(); } catch (e) { setErr(e.response?.data?.error || 'Remove failed'); } };

  if (loading) return <p className="text-sm text-center py-8 italic" style={{ color: 'var(--color-text-secondary)' }}>Loading your team…</p>;

  if (!team) {
    return (
      <div className="rounded-2xl p-8 text-center max-w-lg mx-auto" style={box}>
        <Users size={28} className="mx-auto mb-2" style={{ color: 'var(--color-text-tertiary)' }} />
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>You're not on a team yet.</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          {canCreate ? 'Create one and assign members in the Teams tab.' : 'A manager will add you to a team. Once assigned, your team’s progress shows here.'}
        </p>
      </div>
    );
  }

  const Stat = ({ icon, label, value, color }) => (
    <div className="rounded-xl p-3 text-center" style={box}>
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
    <div className="space-y-4 animate-fade-in w-full">
      {/* team header */}
      <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap relative z-10">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Users size={22} className="text-white" />
              <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>{team.name}</h2>
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(255,255,255,0.22)', color: 'white' }}>{team.team_type}</span>
            </div>
            <p className="text-sm text-white/80 mt-1 flex items-center gap-3 flex-wrap">
              <span>{report?.member_count ?? '—'} members</span>
              {isLead && <span className="inline-flex items-center gap-1"><Crown size={12} /> You lead this team</span>}
              {(team.goal_monthly_sales || team.goal_monthly_transfers) && <span className="inline-flex items-center gap-1"><Target size={12} /> Goal: {team.goal_monthly_sales ? `${team.goal_monthly_sales} sales` : ''}{team.goal_monthly_sales && team.goal_monthly_transfers ? ' · ' : ''}{team.goal_monthly_transfers ? `${team.goal_monthly_transfers} transfers` : ''}/mo</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select value={range} onChange={e => setRange(e.target.value === 'custom' ? 'custom' : +e.target.value)} className="text-xs rounded-lg px-2 py-1.5 font-semibold" style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.4)' }}>
              <option value={7} style={{ color: '#111' }}>Last 7 days</option>
              <option value={30} style={{ color: '#111' }}>Last 30 days</option>
              <option value={90} style={{ color: '#111' }}>Last 90 days</option>
              <option value="custom" style={{ color: '#111' }}>Custom / single day…</option>
            </select>
            {range === 'custom' && (
              <>
                <input type="date" value={cFrom} max={cTo || undefined} onChange={e => setCFrom(e.target.value)} title="From (pick the same date twice for a single day)" className="text-xs rounded-lg px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', colorScheme: 'dark' }} />
                <input type="date" value={cTo} min={cFrom || undefined} onChange={e => setCTo(e.target.value)} title="To" className="text-xs rounded-lg px-2 py-1.5" style={{ background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', colorScheme: 'dark' }} />
              </>
            )}
            <button onClick={() => { loadTeam(); loadReport(); }} className="p-2 rounded-lg text-white" style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.4)' }}><RefreshCw size={15} /></button>
            {isLead && team.lead_can_edit && <button onClick={() => setEditOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white" style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.4)' }}><Pencil size={13} /> Edit</button>}
          </div>
        </div>
      </div>

      {err && <div className="rounded-xl p-3 text-xs" style={{ backgroundColor: 'var(--color-error-50,#fef2f2)', color: 'var(--color-error-700,#b91c1c)', border: '1px solid var(--color-error-200,#fecaca)' }}>{err}</div>}

      {report?.error ? <p className="text-sm text-center py-4" style={{ color: '#dc2626' }}>Failed to load progress.</p> : (
        <>
          <TeamAnalytics report={report} team={team} />

          {/* Lead-only roster management — UNMASKED management UI (not analysis),
              so a lead can see/remove their real members and add unassigned ones. */}
          {isLead && (
            <div className="rounded-2xl p-4" style={box}>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}><Users size={12} /> Manage roster</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(report?.members || []).map(m => (
                  <span key={m.user_id} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
                    {m.user_id === team.lead_user_id && <Crown size={10} style={{ color: '#d97706' }} />}{m.name}
                    {m.user_id !== team.lead_user_id && <button onClick={() => removeMember(m.user_id)} title="Remove from team" className="hover:opacity-60" style={{ color: '#ef4444' }}><X size={11} /></button>}
                  </span>
                ))}
                {(report?.members || []).length === 0 && <span className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>No members yet.</span>}
              </div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Add members ({unassigned.length} unassigned)</p>
              {unassigned.length === 0 ? <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Everyone in the company is on a team.</p> : (
                <div className="flex flex-wrap gap-1.5">
                  {unassigned.map(m => (
                    <button key={m.user_id} onClick={() => addMember(m.user_id)} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary-600)' }}>
                      <UserPlus size={11} /> {m.name}<span className="opacity-60">· {(m.role || '').replace(/_/g, ' ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {editOpen && <EditTeam team={team} onSaved={() => { setEditOpen(false); loadTeam(); loadReport(); }} onClose={() => setEditOpen(false)} onError={setErr} />}
    </div>
  );
}

function EditTeam({ team, onSaved, onClose, onError }) {
  const [f, setF] = useState({ name: team.name || '', color: team.color || TYPE_COLOR[team.team_type] || '#6b7280', goal_monthly_sales: team.goal_monthly_sales ?? '', goal_monthly_transfers: team.goal_monthly_transfers ?? '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));
  const inp = { backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13, width: '100%' };
  const save = async () => {
    setSaving(true);
    try { await client.put(`teams/${team.id}`, f); onSaved(); }
    catch (e) { onError(e.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="rounded-2xl p-5 w-full max-w-sm space-y-3" style={{ backgroundColor: 'var(--color-surface)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h3 className="font-bold" style={{ color: 'var(--color-text)' }}>Edit team</h3><button onClick={onClose}><X size={18} /></button></div>
        <label className="block"><span className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Name</span><input value={f.name} onChange={e => set('name', e.target.value)} style={inp} /></label>
        <label className="block"><span className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Color</span><input type="color" value={f.color} onChange={e => set('color', e.target.value)} style={{ ...inp, padding: 2, height: 34 }} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Sales goal / mo</span><input type="number" min="0" value={f.goal_monthly_sales} onChange={e => set('goal_monthly_sales', e.target.value)} placeholder="—" style={inp} /></label>
          <label className="block"><span className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Transfers goal / mo</span><input type="number" min="0" value={f.goal_monthly_transfers} onChange={e => set('goal_monthly_transfers', e.target.value)} placeholder="—" style={inp} /></label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={save} disabled={saving || !f.name} className="px-3 py-2 rounded-lg text-sm font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-40" style={{ background: 'var(--gradient-sidebar)' }}><Save size={13} /> {saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
