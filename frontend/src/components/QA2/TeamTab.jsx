// ============================================================================
// TeamTab.jsx — a QA manager sub-assigns THEIR OWN companies and methods to
// THEIR OWN agents. Backend: qa2Team.js. Phase 8 adds sampling rules (feeds
// qa2AutoAssign.js) and agent targets — same manager-owned-config shape as
// the company/method grants above, so they're additional sections here
// rather than a new tab.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Users2, Building2, ListChecks, X, Gauge, Target } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';
import ThemedSelect from '../UI/Select';
import { Panel, SectionHeader, EmptyState, Loading, IconButton, Toggle } from '../UI/kit';

// Chip-toggle multi-select — replaces a single-value <ThemedSelect> wherever
// a manager needs to pick several agents/companies/methods at once instead
// of repeating one grant at a time.
function ChipMultiSelect({ label, items, selected, onToggle, getId, getLabel }) {
  return (
    <div className="flex-1 min-w-[200px]">
      <p className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 rounded-lg" style={{ border: '1px solid var(--color-border)' }}>
        {items.length === 0 && <span className="text-xs px-1" style={{ color: 'var(--color-text-tertiary)' }}>None available</span>}
        {items.map(item => {
          const id = getId(item);
          const on = selected.has(id);
          return (
            <button key={id} type="button" onClick={() => onToggle(id)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: on ? 'var(--color-primary-600)' : 'var(--color-bg-secondary)', color: on ? '#fff' : 'var(--color-text)' }}>
              {getLabel(item)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SAMPLING_MODES = [
  { value: 'full_coverage', label: 'Full coverage' },
  { value: 'per_agent_per_day', label: 'Per agent, per day' },
  { value: 'per_agent_per_week', label: 'Per agent, per week' },
  { value: 'percent', label: 'Percent of calls' },
];

export default function TeamTab({ scope }) {
  const [agents, setAgents] = useState(null);
  const [companyGrants, setCompanyGrants] = useState(null);
  const [methodGrants, setMethodGrants] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [methods, setMethods] = useState([]);
  const [samplingRules, setSamplingRules] = useState(null);
  const [targets, setTargets] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Multi-select — a manager can grant one company/method to their whole
  // team, or several to several agents, in one submit instead of repeating a
  // single-pair pick every time.
  const [pickAgentsCo, setPickAgentsCo] = useState(new Set());
  const [pickCompanies, setPickCompanies] = useState(new Set());
  const [pickAgentsMethod, setPickAgentsMethod] = useState(new Set());
  const [pickMethods, setPickMethods] = useState(new Set());

  const [ruleCompany, setRuleCompany] = useState('');
  const [ruleMethod, setRuleMethod] = useState('');
  const [ruleMode, setRuleMode] = useState('full_coverage');
  const [ruleQty, setRuleQty] = useState('');
  const [ruleMinTalk, setRuleMinTalk] = useState('');

  const [targetAgent, setTargetAgent] = useState('');
  const [targetMethod, setTargetMethod] = useState('');
  const [targetPerDay, setTargetPerDay] = useState('');

  const myCompanyIds = scope?.operationalCompanyIds === 'all' ? null : (scope?.operationalCompanyIds || []);

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([
      client.get('qa2/team/roster'),
      client.get('qa2/team/agent-companies'),
      client.get('qa2/team/agent-methods'),
      client.get('compliance/companies'),
      client.get('qa2/methods'),
      client.get('qa2/team/sampling-rules'),
      client.get('qa2/team/targets'),
    ]).then(([roster, ac, am, comps, meth, rules, tgts]) => {
      setAgents(roster.data.agents || []);
      setCompanyGrants(ac.data.grants || []);
      setMethodGrants(am.data.grants || []);
      const allComps = comps.data.companies || [];
      setCompanies(myCompanyIds ? allComps.filter(c => myCompanyIds.includes(c.id)) : allComps);
      setMethods((meth.data.methods || []).filter(m => m.is_active));
      setSamplingRules(rules.data.rules || []);
      setTargets(tgts.data.targets || []);
    }).catch(e => setLoadError(e.response?.data?.error || 'Could not load your team'));
  }, [myCompanyIds]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);

  const nameForAgent = (id) => agents?.find(a => a.agent_id === id)?.name || id;
  const nameForCompany = (id) => companies.find(c => c.id === id)?.name || id;
  const nameForMethod = (id) => methods.find(m => m.id === id)?.label || id;

  const toggleInSet = (setter) => (id) => setter(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const grantCompany = async () => {
    if (!pickAgentsCo.size || !pickCompanies.size) return toast.error('Pick at least one agent and one company');
    try {
      const r = await client.post('qa2/team/agent-companies', { agent_ids: [...pickAgentsCo], company_ids: [...pickCompanies] });
      toast.success(`Granted ${r.data.granted} of ${r.data.attempted} (rest already existed)`);
      setPickAgentsCo(new Set()); setPickCompanies(new Set()); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not grant company'); }
  };
  const revokeCompany = async (agentId, companyId) => {
    try { await client.delete(`qa2/team/agent-companies/${agentId}/${companyId}`); toast.success('Revoked'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not revoke'); }
  };

  const grantMethod = async () => {
    if (!pickAgentsMethod.size || !pickMethods.size) return toast.error('Pick at least one agent and one method');
    try {
      const r = await client.post('qa2/team/agent-methods', { agent_ids: [...pickAgentsMethod], method_ids: [...pickMethods] });
      toast.success(`Granted ${r.data.granted} of ${r.data.attempted} (rest already existed)`);
      setPickAgentsMethod(new Set()); setPickMethods(new Set()); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not grant method'); }
  };
  const revokeMethod = async (agentId, methodId) => {
    try { await client.delete(`qa2/team/agent-methods/${agentId}/${methodId}`); toast.success('Revoked'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not revoke'); }
  };

  const addRule = async () => {
    if (!ruleCompany || !ruleMethod) return toast.error('Pick a company and a method');
    if (ruleMode !== 'full_coverage' && !(Number(ruleQty) > 0)) return toast.error('Enter a quantity for this mode');
    try {
      await client.post('qa2/team/sampling-rules', {
        company_id: ruleCompany, method_id: ruleMethod, mode: ruleMode,
        quantity: ruleMode === 'full_coverage' ? null : Number(ruleQty),
        min_talk_sec: ruleMinTalk === '' ? 0 : Number(ruleMinTalk),
      });
      toast.success('Sampling rule added'); setRuleQty(''); setRuleMinTalk(''); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not add rule'); }
  };
  const toggleRule = async (rule) => {
    try { await client.put(`qa2/team/sampling-rules/${rule.id}`, { is_active: !rule.is_active }); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not update rule'); }
  };
  const deleteRule = async (id) => {
    try { await client.delete(`qa2/team/sampling-rules/${id}`); toast.success('Rule removed'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not remove rule'); }
  };

  const addTarget = async () => {
    if (!targetAgent || !(Number(targetPerDay) > 0)) return toast.error('Pick an agent and a positive per-day target');
    try {
      await client.post('qa2/team/targets', { agent_id: targetAgent, method_id: targetMethod || null, per_day: Number(targetPerDay) });
      toast.success('Target set'); setTargetPerDay(''); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not set target'); }
  };
  const deleteTarget = async (id) => {
    try { await client.delete(`qa2/team/targets/${id}`); toast.success('Target removed'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Could not remove target'); }
  };

  if (loadError) return <Panel tone="inset"><p className="text-sm" style={{ color: 'var(--color-error-600)' }}>{loadError}</p></Panel>;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <SectionHeader level="page" icon={Users2} title="My team"
        subtitle="Sub-assign your own companies and methods to your own agents. Only companies compliance has assigned to you appear here." />

      {agents === null ? <Loading variant="rows" rows={2} /> : agents.length === 0 && (
        <EmptyState icon={Users2} title="No agents assigned to you yet" hint="Compliance wires agents to a QA manager on the Org tab." />
      )}

      <Panel className="space-y-3">
        <SectionHeader level="section" icon={Building2} title="Agent → company" />
        {companyGrants === null ? <Loading variant="rows" rows={2} /> : companyGrants.length === 0
          ? <EmptyState compact title="No company grants yet" />
          : (
            <div className="space-y-1.5">
              {companyGrants.map(g => (
                <div key={g.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--color-bg)' }}>
                  <span>{nameForAgent(g.agent_id)} → {g.companies?.name || nameForCompany(g.company_id)}</span>
                  <IconButton label="Revoke" variant="ghost" tone="danger" onClick={() => revokeCompany(g.agent_id, g.company_id)}><X size={14} /></IconButton>
                </div>
              ))}
            </div>
          )}
        {agents && agents.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <ChipMultiSelect label={`Agents${pickAgentsCo.size ? ` (${pickAgentsCo.size})` : ''}`}
              items={agents} selected={pickAgentsCo} onToggle={toggleInSet(setPickAgentsCo)}
              getId={a => a.agent_id} getLabel={a => a.name} />
            <ChipMultiSelect label={`Companies${pickCompanies.size ? ` (${pickCompanies.size})` : ''}`}
              items={companies} selected={pickCompanies} onToggle={toggleInSet(setPickCompanies)}
              getId={c => c.id} getLabel={c => c.name} />
            <button className="btn btn-primary text-sm flex-shrink-0" onClick={grantCompany}>Grant</button>
          </div>
        )}
      </Panel>

      <Panel className="space-y-3">
        <SectionHeader level="section" icon={ListChecks} title="Agent → method" />
        {methodGrants === null ? <Loading variant="rows" rows={2} /> : methodGrants.length === 0
          ? <EmptyState compact title="No method grants yet" />
          : (
            <div className="space-y-1.5">
              {methodGrants.map(g => (
                <div key={g.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--color-bg)' }}>
                  <span>{nameForAgent(g.agent_id)} → {g.qa2_method?.label || nameForMethod(g.method_id)}</span>
                  <IconButton label="Revoke" variant="ghost" tone="danger" onClick={() => revokeMethod(g.agent_id, g.method_id)}><X size={14} /></IconButton>
                </div>
              ))}
            </div>
          )}
        {agents && agents.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <ChipMultiSelect label={`Agents${pickAgentsMethod.size ? ` (${pickAgentsMethod.size})` : ''}`}
              items={agents} selected={pickAgentsMethod} onToggle={toggleInSet(setPickAgentsMethod)}
              getId={a => a.agent_id} getLabel={a => a.name} />
            <ChipMultiSelect label={`Methods${pickMethods.size ? ` (${pickMethods.size})` : ''}`}
              items={methods} selected={pickMethods} onToggle={toggleInSet(setPickMethods)}
              getId={m => m.id} getLabel={m => m.label} />
            <button className="btn btn-primary text-sm flex-shrink-0" onClick={grantMethod}>Grant</button>
          </div>
        )}
      </Panel>

      <Panel className="space-y-3">
        <SectionHeader level="section" icon={Gauge} title="Sampling rules" subtitle="What gets pulled into the pool for your companies + methods." />
        {samplingRules === null ? <Loading variant="rows" rows={2} /> : samplingRules.length === 0
          ? <EmptyState compact title="No sampling rules yet" hint="Without one, calls sit in Unclassified/never enter a pool automatically — agents can still self-claim once classified." />
          : (
            <div className="space-y-1.5">
              {samplingRules.map(r => (
                <div key={r.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg flex-wrap gap-2" style={{ background: 'var(--color-bg)' }}>
                  <span>
                    {r.companies?.name || nameForCompany(r.company_id)} → {r.qa2_method?.label || nameForMethod(r.method_id)}
                    {' — '}{SAMPLING_MODES.find(m => m.value === r.mode)?.label || r.mode}
                    {r.mode !== 'full_coverage' && ` (${r.quantity}${r.mode === 'percent' ? '%' : '/agent'})`}
                    {r.min_talk_sec > 0 && ` · min ${r.min_talk_sec}s`}
                  </span>
                  <div className="flex items-center gap-2">
                    <Toggle checked={!!r.is_active} onChange={() => toggleRule(r)} label={r.is_active ? 'Active' : 'Paused'} />
                    <IconButton label="Remove" variant="ghost" tone="danger" onClick={() => deleteRule(r.id)}><X size={14} /></IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        {agents && companies.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="flex-1 min-w-[140px]">
              <ThemedSelect value={ruleCompany} onChange={e => setRuleCompany(e.target.value)}>
                <option value="">Company…</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </ThemedSelect>
            </div>
            <div className="flex-1 min-w-[140px]">
              <ThemedSelect value={ruleMethod} onChange={e => setRuleMethod(e.target.value)}>
                <option value="">Method…</option>
                {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </ThemedSelect>
            </div>
            <div className="flex-1 min-w-[160px]">
              <ThemedSelect value={ruleMode} onChange={e => setRuleMode(e.target.value)}>
                {SAMPLING_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </ThemedSelect>
            </div>
            {ruleMode !== 'full_coverage' && (
              <input className="input" style={{ maxWidth: 90 }} type="number" min={1} placeholder={ruleMode === 'percent' ? '%' : 'qty'}
                value={ruleQty} onChange={e => setRuleQty(e.target.value)} />
            )}
            <input className="input" style={{ maxWidth: 100 }} type="number" min={0} placeholder="min sec"
              value={ruleMinTalk} onChange={e => setRuleMinTalk(e.target.value)} />
            <button className="btn btn-primary text-sm" onClick={addRule}>Add</button>
          </div>
        )}
      </Panel>

      <Panel className="space-y-3">
        <SectionHeader level="section" icon={Target} title="Agent targets" subtitle="A daily pace per agent — informational, shown alongside their queue." />
        {targets === null ? <Loading variant="rows" rows={2} /> : targets.length === 0
          ? <EmptyState compact title="No targets set" />
          : (
            <div className="space-y-1.5">
              {targets.map(t => (
                <div key={t.id} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--color-bg)' }}>
                  <span>{nameForAgent(t.agent_id)} → {t.qa2_method?.label || (t.method_id ? nameForMethod(t.method_id) : 'All methods')} · {t.per_day}/day</span>
                  <IconButton label="Remove" variant="ghost" tone="danger" onClick={() => deleteTarget(t.id)}><X size={14} /></IconButton>
                </div>
              ))}
            </div>
          )}
        {agents && agents.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="flex-1 min-w-[160px]">
              <ThemedSelect value={targetAgent} onChange={e => setTargetAgent(e.target.value)}>
                <option value="">Pick an agent…</option>
                {agents.map(a => <option key={a.agent_id} value={a.agent_id}>{a.name}</option>)}
              </ThemedSelect>
            </div>
            <div className="flex-1 min-w-[160px]">
              <ThemedSelect value={targetMethod} onChange={e => setTargetMethod(e.target.value)}>
                <option value="">All methods</option>
                {methods.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </ThemedSelect>
            </div>
            <input className="input" style={{ maxWidth: 90 }} type="number" min={1} placeholder="per day"
              value={targetPerDay} onChange={e => setTargetPerDay(e.target.value)} />
            <button className="btn btn-primary text-sm" onClick={addTarget}>Set</button>
          </div>
        )}
      </Panel>
    </div>
  );
}
