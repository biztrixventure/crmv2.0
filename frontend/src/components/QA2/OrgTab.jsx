// ============================================================================
// OrgTab.jsx — compliance-only org chart wiring: toggle QA access onto a
// compliance manager, assign companies to a QA manager, assign QA agents to
// a QA manager. Backend: qa2Org.js. Reuses existing /compliance/users and
// /compliance/companies for picker data rather than building new list
// endpoints.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, UserCog, Building2, Users2, X, Lock } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import ThemedDate from '../UI/ThemedDate';
import { Panel, SectionHeader, EmptyState, Loading, IconButton } from '../UI/kit';

function useLookups() {
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    client.get('compliance/users').then(r => {
      const seen = new Map();
      for (const u of (r.data.users || [])) if (!seen.has(u.user_id)) seen.set(u.user_id, u);
      setUsers([...seen.values()]);
    }).catch(() => {});
    client.get('compliance/companies').then(r => setCompanies(r.data.companies || [])).catch(() => {});
  }, []);
  return { users, companies };
}

// A picker you can actually type into, over a list that only contains people
// who belong in the slot.
//
// It used to be a bare <select> of EVERY user — 96 fronters and 25 closers
// ahead of the 5 QA agents — with no way to search, so finding the person you
// wanted meant scrolling past everyone who could never be a valid answer.
// filterLevel existed but was only passed on one of the four pickers.
//
// `levels` narrows to roles; `only` narrows to an explicit set of user ids (the
// QA-manager slots use it, because a QA manager here is a compliance manager
// holding a live access grant, not a role you can filter on).
function UserPicker({ value, onChange, users, levels, only, placeholder = 'Search a person…', emptyHint }) {
  const [q, setQ] = useState('');
  const [openList, setOpenList] = useState(false);

  // levels and only are alternatives, not both-must-match. A QA manager is
  // either someone holding the qa_manager role (nobody does today) or a
  // compliance manager carrying a live access grant — requiring both would
  // match nobody and leave the slot permanently empty.
  const pool = users.filter(u => {
    const byLevel = levels ? levels.includes(u.role_level) : false;
    const byId = only ? only.includes(u.user_id) : false;
    if (levels && only) return byLevel || byId;
    if (levels) return byLevel;
    if (only) return byId;
    return true;
  });
  const needle = q.trim().toLowerCase();
  const list = needle
    ? pool.filter(u => `${u.full_name || ''} ${u.email || ''}`.toLowerCase().includes(needle))
    : pool;

  const selected = users.find(u => u.user_id === value);

  if (!pool.length) {
    return (
      <div className="text-xs px-3 py-2 rounded-lg" style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-tertiary)' }}>
        {emptyHint || 'Nobody is eligible yet'}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        value={openList ? q : (selected ? selected.full_name : '')}
        onChange={e => { setQ(e.target.value); setOpenList(true); }}
        onFocus={() => { setQ(''); setOpenList(true); }}
        onBlur={() => setTimeout(() => setOpenList(false), 150)}
        placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
      />
      {openList && (
        <div className="absolute z-20 mt-1 w-full rounded-lg overflow-auto"
          style={{ maxHeight: 240, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
          {!list.length ? (
            <div className="px-3 py-2 text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Nobody matches "{q}"</div>
          ) : list.map(u => (
            <button key={u.user_id} type="button"
              onMouseDown={() => { onChange(u.user_id); setQ(''); setOpenList(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:opacity-80"
              style={{ color: 'var(--color-text)' }}>
              {u.full_name}
              <span className="text-xs ml-2" style={{ color: 'var(--color-text-tertiary)' }}>{u.role_level}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrgTab({ scope }) {
  const { users, companies } = useLookups();
  const [access, setAccess] = useState(null);
  const [managerCompanies, setManagerCompanies] = useState(null);
  const [teamMembers, setTeamMembers] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [freezeAt, setFreezeAt] = useState(undefined); // undefined = loading, null = not set
  const [freezeDraft, setFreezeDraft] = useState('');

  const [grantUser, setGrantUser] = useState('');
  const [assignCompany, setAssignCompany] = useState('');
  const [assignManager, setAssignManager] = useState('');
  const [assignAgent, setAssignAgent] = useState('');
  const [assignAgentManager, setAssignAgentManager] = useState('');

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      client.get('qa2/org/manager-access'),
      client.get('qa2/org/manager-companies'),
      client.get('qa2/org/team-members'),
      client.get('qa2/org/v1-freeze'),
    ]).then(([a, mc, tm, vf]) => {
      setAccess((a.data.grants || []).filter(g => !g.revoked_at));
      setManagerCompanies(mc.data.assignments || []);
      setTeamMembers(tm.data.members || []);
      setFreezeAt(vf.data.freeze_at || null);
      setFreezeDraft(vf.data.freeze_at ? vf.data.freeze_at.slice(0, 10) : '');
    }).catch(e => setLoadError(e.response?.data?.error || 'Could not load the org chart'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const setV1Freeze = async () => {
    if (!freezeDraft) return toast.error('Pick a cutover date');
    try {
      await client.post('qa2/org/v1-freeze', { freeze_at: new Date(freezeDraft).toISOString() });
      toast.success('V1 cutover date set'); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not set the cutover date'); }
  };
  const clearV1Freeze = async () => {
    try { await client.post('qa2/org/v1-freeze', { freeze_at: null }); toast.success('V1 cutover cleared — v1 stays writable'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not clear the cutover date'); }
  };

  // A "QA manager" is not a role anybody actually holds — there are zero
  // qa_manager users. Every one of them is a compliance manager carrying a live
  // qa2_manager_access grant, which is granted on this very tab. So the manager
  // slots below are filled from the grant list, not from a role filter.
  const qaManagerIds = (access || []).map(g => g.user_id);
  const nameFor = (userId) => users.find(u => u.user_id === userId)?.full_name || userId;

  const grantAccess = async () => {
    if (!grantUser) return toast.error('Pick a compliance manager');
    try {
      await client.post('qa2/org/manager-access', { user_id: grantUser });
      toast.success('QA access granted');
      setGrantUser(''); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not grant access'); }
  };
  const revokeAccess = async (userId) => {
    try { await client.delete(`qa2/org/manager-access/${userId}`); toast.success('Access revoked'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not revoke access'); }
  };

  const assignCompanyToManager = async () => {
    if (!assignCompany || !assignManager) return toast.error('Pick a company and a manager');
    try {
      await client.post('qa2/org/manager-companies', { company_id: assignCompany, manager_id: assignManager });
      toast.success('Company assigned');
      setAssignCompany(''); setAssignManager(''); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not assign company'); }
  };
  const unassignCompany = async (companyId) => {
    try { await client.delete(`qa2/org/manager-companies/${companyId}`); toast.success('Company unassigned'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not unassign'); }
  };

  const assignAgentToManager = async () => {
    if (!assignAgent || !assignAgentManager) return toast.error('Pick an agent and a manager');
    try {
      await client.post('qa2/org/team-members', { agent_id: assignAgent, manager_id: assignAgentManager });
      toast.success('Agent assigned');
      setAssignAgent(''); setAssignAgentManager(''); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not assign agent'); }
  };
  const unassignAgent = async (agentId) => {
    try { await client.delete(`qa2/org/team-members/${agentId}`); toast.success('Agent removed from QA org'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not remove'); }
  };

  if (loadError) return <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <SectionHeader level="page" icon={ShieldCheck} title="Org chart"
        subtitle="Compliance wires the org chart only — toggle QA access, assign companies and agents to managers. Methods/forms/day-to-day work belongs to the QA manager, not here." />

      <Panel className="space-y-3">
        <SectionHeader level="section" icon={UserCog} title="QA access toggle"
          subtitle="Grants a compliance manager IDENTICAL operational authority to a real QA manager — scoped to whatever companies you assign them below." />
        {access === null ? <Loading variant="rows" rows={2} /> : access.length === 0
          ? <EmptyState compact title="No compliance manager has been toggled on yet" />
          : (
            <div className="space-y-1.5">
              {access.map(g => (
                <div key={g.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--color-bg)' }}>
                  <span>{nameFor(g.user_id)}</span>
                  <IconButton label="Revoke" variant="ghost" tone="danger" onClick={() => revokeAccess(g.user_id)}><X size={14} /></IconButton>
                </div>
              ))}
            </div>
          )}
        <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex-1"><UserPicker value={grantUser} onChange={setGrantUser} users={users} levels={['compliance_manager']}
              placeholder="Search a compliance manager…" emptyHint="No compliance managers exist yet" /></div>
          <button className="btn btn-primary text-sm" onClick={grantAccess}>Grant</button>
        </div>
      </Panel>

      <Panel className="space-y-3">
        <SectionHeader level="section" icon={Building2} title="Company → manager" subtitle="Exactly one QA manager per company." />
        {managerCompanies === null ? <Loading variant="rows" rows={2} /> : managerCompanies.length === 0
          ? <EmptyState compact title="No companies assigned yet" />
          : (
            <div className="space-y-1.5">
              {managerCompanies.map(a => (
                <div key={a.company_id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--color-bg)' }}>
                  <span>{a.companies?.name || a.company_id} → {nameFor(a.manager_id)}</span>
                  <IconButton label="Unassign" variant="ghost" tone="danger" onClick={() => unassignCompany(a.company_id)}><X size={14} /></IconButton>
                </div>
              ))}
            </div>
          )}
        <div className="flex flex-wrap items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex-1 min-w-[160px]">
            <ThemedSelect value={assignCompany} onChange={e => setAssignCompany(e.target.value)}>
              <option value="">Pick a company…</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </ThemedSelect>
          </div>
          <div className="flex-1 min-w-[160px]"><UserPicker value={assignManager} onChange={setAssignManager} users={users} levels={['qa_manager']} only={qaManagerIds.length ? qaManagerIds : undefined}
            placeholder="Search a QA manager…" emptyHint="Grant QA access to a compliance manager first (above)" /></div>
          <button className="btn btn-primary text-sm" onClick={assignCompanyToManager}>Assign</button>
        </div>
      </Panel>

      <Panel className="space-y-3">
        <SectionHeader level="section" icon={Users2} title="Agent → manager" subtitle="Exactly one QA manager per agent." />
        {teamMembers === null ? <Loading variant="rows" rows={2} /> : teamMembers.length === 0
          ? <EmptyState compact title="No agents assigned yet" />
          : (
            <div className="space-y-1.5">
              {teamMembers.map(m => (
                <div key={m.agent_id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--color-bg)' }}>
                  <span>{nameFor(m.agent_id)} → {nameFor(m.manager_id)}</span>
                  <IconButton label="Remove" variant="ghost" tone="danger" onClick={() => unassignAgent(m.agent_id)}><X size={14} /></IconButton>
                </div>
              ))}
            </div>
          )}
        <div className="flex flex-wrap items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex-1 min-w-[160px]"><UserPicker value={assignAgent} onChange={setAssignAgent} users={users} levels={['qa_agent']}
            placeholder="Search a QA agent…" emptyHint="No users have the QA agent role yet" /></div>
          <div className="flex-1 min-w-[160px]"><UserPicker value={assignAgentManager} onChange={setAssignAgentManager} users={users} levels={['qa_manager']} only={qaManagerIds.length ? qaManagerIds : undefined}
            placeholder="Search a QA manager…" emptyHint="Grant QA access to a compliance manager first (above)" /></div>
          <button className="btn btn-primary text-sm" onClick={assignAgentToManager}>Assign</button>
        </div>
      </Panel>

      <Panel className="space-y-3" tone={freezeAt ? 'inset' : undefined}>
        <SectionHeader level="section" icon={Lock} title="QA v1 cutover"
          subtitle="Once this date passes, QA v1 stops accepting new reviews (history stays visible). Off by default — v1 stays fully writable until you set a date." />
        {freezeAt === undefined ? <Loading variant="rows" rows={1} /> : (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {freezeAt
              ? (new Date(freezeAt).getTime() <= Date.now()
                ? <>QA v1 is <strong style={{ color: 'var(--color-error-600)' }}>read-only</strong> as of {new Date(freezeAt).toLocaleDateString()}.</>
                : <>QA v1 will become read-only on <strong>{new Date(freezeAt).toLocaleDateString()}</strong>.</>)
              : 'No cutover date set — QA v1 is fully writable.'}
          </p>
        )}
        {scope?.superadmin ? (
          <div className="flex flex-wrap items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <ThemedDate value={freezeDraft} onChange={e => setFreezeDraft(e.target.value)} />
            <button className="btn btn-primary text-sm" onClick={setV1Freeze}>{freezeAt ? 'Update date' : 'Set cutover date'}</button>
            {freezeAt && <button className="btn text-sm" style={{ border: '1px solid var(--color-border)' }} onClick={clearV1Freeze}>Clear</button>}
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Only a superadmin can set or clear this date.</p>
        )}
      </Panel>
    </div>
  );
}
