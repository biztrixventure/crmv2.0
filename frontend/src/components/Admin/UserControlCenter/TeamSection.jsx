// TeamSection — the user's team membership within the active company (one team
// per user per company). Reads the company roster (GET /teams/company-members)
// to find their current team, lists teams (GET /teams) to move them, and writes
// through POST /teams/:id/members / DELETE /teams/:id/members/:userId.
//
// UI from components/UI/kit (docs/ui-design-system.md).
import { useState, useEffect, useCallback } from 'react';
import { Users2, UserMinus, Crown, User as UserIcon, Building2 } from 'lucide-react';
import client from '../../../api/client';
import { Alert, Badge } from '../../../components/UI';
import ThemedSelect from '../../UI/Select';
import { Panel, SectionHeader, Loading, EmptyState, Field, useFlash } from '../../UI/kit';

export default function TeamSection({ account, assignment }) {
  const companyId = assignment?.company_id;
  const userId    = account.user_id;
  const [teams, setTeams]     = useState([]);
  const [mine, setMine]       = useState(null);   // this user's roster row { team_id, role_in_team, ... }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const { msg, flash, clear } = useFlash();

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const [membersRes, teamsRes] = await Promise.all([
        client.get('teams/company-members', { params: { company_id: companyId } }),
        client.get('teams', { params: { company_id: companyId } }),
      ]);
      const members = membersRes.data.members || membersRes.data.users || membersRes.data || [];
      setMine((Array.isArray(members) ? members : []).find(m => m.user_id === userId) || null);
      setTeams(teamsRes.data.teams || teamsRes.data || []);
    } catch (e) { flash('error', e.response?.data?.error || 'Failed to load teams.'); }
    finally { setLoading(false); }
  }, [companyId, userId, flash]);

  useEffect(() => { load(); }, [load]);

  const currentTeamId  = mine?.team_id || '';
  const currentRole    = mine?.role_in_team || null;
  const currentTeam    = teams.find(t => t.id === currentTeamId);

  const assignTeam = async (teamId, roleInTeam) => {
    if (!teamId) return;
    setBusy(true);
    try {
      await client.post(`teams/${teamId}/members`, { user_id: userId, role_in_team: roleInTeam || 'member' });
      flash('success', 'Team membership updated.');
      await load();
    } catch (e) { flash('error', e.response?.data?.error || 'Update failed.'); }
    finally { setBusy(false); }
  };

  const removeFromTeam = async () => {
    if (!currentTeamId) return;
    setBusy(true);
    try { await client.delete(`teams/${currentTeamId}/members/${userId}`); flash('success', 'Removed from team.'); await load(); }
    catch (e) { flash('error', e.response?.data?.error || 'Remove failed.'); }
    finally { setBusy(false); }
  };

  if (!companyId) return <EmptyState icon={Building2} title="No company assignment" hint="Teams are scoped to a company." />;
  if (loading) return <Loading variant="rows" rows={4} label="Loading teams…" />;

  const btn = 'text-xs font-semibold px-3 py-2 rounded-lg';
  const btnStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="max-w-xl">
      <SectionHeader icon={Users2} title={`Team · ${assignment.company_name || '—'}`} />
      {msg && <div className="mb-3"><Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert></div>}

      {/* Current membership */}
      <Panel tone="inset" radius="xl" className="mb-4">
        {currentTeamId ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-text">{currentTeam?.name || 'Team'}</span>
                <Badge variant={currentRole === 'lead' ? 'warning' : 'default'}>
                  {currentRole === 'lead' ? <><Crown size={11} className="inline mr-1" />Lead</> : <><UserIcon size={11} className="inline mr-1" />Member</>}
                </Badge>
              </div>
              <p className="text-[11px] text-text-secondary mt-0.5">One team per user per company.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => assignTeam(currentTeamId, currentRole === 'lead' ? 'member' : 'lead')} disabled={busy}
                className={btn} style={btnStyle}>
                Make {currentRole === 'lead' ? 'member' : 'lead'}
              </button>
              <button onClick={removeFromTeam} disabled={busy}
                className={`${btn} flex items-center gap-1.5`} style={{ ...btnStyle, color: 'var(--color-error-600)' }}>
                <UserMinus size={13} /> Remove
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">Not on any team in this company.</p>
        )}
      </Panel>

      {/* Move / assign */}
      <Field label={currentTeamId ? 'Move to team' : 'Assign to team'} as="div">
        <div className="flex items-center gap-2">
          <ThemedSelect value="" onChange={e => assignTeam(e.target.value, 'member')} className="input flex-1" disabled={busy || teams.length === 0}>
            <option value="">{teams.length ? '— Select a team —' : 'No teams in this company'}</option>
            {teams.filter(t => t.id !== currentTeamId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </ThemedSelect>
          {busy && <Loading variant="inline" />}
        </div>
      </Field>
    </div>
  );
}
