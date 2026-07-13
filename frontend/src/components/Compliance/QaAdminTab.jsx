import { useState, useEffect, useCallback, useMemo } from 'react';
import { Shield, RefreshCw, Loader2, X, Search, Building2, Check, Settings2, ChevronDown, ChevronRight, Info, Lock, Headphones, ArrowRightLeft, Shuffle, DollarSign, PhoneOff, Play, Users, User, Plus } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// ============================================================================
// QaAdminTab — Compliance owns the QA department (mig 181 + 186).
//   1. Companies — enable/configure QA + coverage/backlog per company
//   2. QA Team — person-centric console: pick a QUALITY person, then assign
//      any combination of work in one flow (company access + kinds of calls +
//      one/many/all subject users + dispositions + route now)
//   3. Work rules — the all-companies overview of who listens to what
// QA accounts are created by the Super Admin and appear here automatically.
// ============================================================================

const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
const METHODS = [['tra', 'TRA'], ['rcm', 'RCM']];
const lvlLabel = (l) => (l === 'qa_manager' ? 'Manager' : 'Agent');

// Small "i" helper — hover or tap for a plain-language explanation (mirrors the
// QA shell's InfoTip so both surfaces explain themselves the same way).
function InfoTip({ text, w = 250 }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex" style={{ verticalAlign: 'middle' }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }}
        className="inline-flex items-center justify-center rounded-full cursor-help"
        style={{ width: 15, height: 15, background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', flexShrink: 0 }} aria-label="What does this do?">
        <Info size={10} />
      </button>
      {open && (
        <span className="absolute z-[60] text-[11px] font-normal normal-case tracking-normal leading-snug p-2.5 rounded-lg"
          onClick={(e) => e.stopPropagation()}
          style={{ width: w, top: 'calc(100% + 5px)', left: 0, background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', boxShadow: '0 8px 24px rgba(0,0,0,0.20)', whiteSpace: 'normal' }}>
          {text}
        </span>
      )}
    </span>
  );
}

const StepBadge = ({ n }) => (
  <span className="inline-flex items-center justify-center rounded-full text-[10px] font-bold" style={{ width: 16, height: 16, background: 'var(--color-primary-600)', color: '#fff' }}>{n}</span>
);

const WORK_TYPE_DEFS = [
  { key: 'tra', label: 'TRA — Transfer calls (Fronter)', icon: ArrowRightLeft, tint: '#2563eb', desc: 'The fronters\' transfer calls — the ones entered IN the CRM. A transfer means TRA. Comes from CRM records.' },
  { key: 'rcm', label: 'RCM — Random calls (Fronter)', icon: Shuffle, tint: '#d97706', desc: 'The fronters\' OTHER calls — raw dialer calls NOT in the CRM. This is the only type fetched live from the dialer, sampled daily at the configured rate.' },
  { key: 'closer_sales', label: 'Closed Sale calls (Closer)', icon: DollarSign, tint: '#059669', desc: 'The closers\' calls that CLOSED a sale. Every TRA that became a sale. Pick the closer company for its own sales, or a fronter company for the sales its transfers produced.' },
  { key: 'closer_dispo', label: 'Unclosed Sale calls (Closer)', icon: PhoneOff, tint: '#dc2626', desc: 'The closers\' calls that did NOT close — a TRA that landed on the closer but ended with a non-sale disposition. Pick which codes count (none = any non-sale). With "Closed Sale" this covers EVERY closer call.' },
];
const wtDef = (k) => WORK_TYPE_DEFS.find(w => w.key === k) || { label: k, tint: 'var(--color-text-tertiary)', icon: Headphones };

export default function QaAdminTab() {
  const [companies, setCompanies] = useState(null);
  const [users, setUsers] = useState(null);
  const [rules, setRules] = useState(null);
  const [expanded, setExpanded] = useState(null);   // company id whose config is open

  const loadUsers = useCallback(() => client.get('qa/admin/users').then(r => setUsers(r.data.users || [])).catch(() => setUsers([])), []);
  const loadRules = useCallback(() => client.get('qa/admin/rules').then(r => setRules(r.data.rules || [])).catch(e => { setRules([]); const m = e.response?.data?.error; if (m && /migration 186/.test(m)) toast.error(m); }), []);
  const load = useCallback(() => {
    client.get('qa/admin/overview').then(r => setCompanies(r.data.companies || [])).catch(() => setCompanies([]));
    loadUsers(); loadRules();
  }, [loadUsers, loadRules]);
  useEffect(() => { load(); }, [load]);

  const toggleMethod = async (co, m) => {
    const methods = co.methods.includes(m) ? co.methods.filter(x => x !== m) : [...co.methods, m];
    setCompanies(cs => cs.map(c => c.id === co.id ? { ...c, methods } : c));
    try { const r = await client.put('qa/admin/company-methods', { company_id: co.id, methods }); const mm = r.data.materialized; if (mm && (mm.tra || mm.rcm)) toast.success(`QA on — pulled ${mm.tra || 0} TRA + ${mm.rcm || 0} RCM`); }
    catch { toast.error('Update failed'); load(); }
  };
  // Remove COMPANY ACCESS only — soft, reversible, never a user delete. The
  // backend also pauses their rules there + returns unscored calls to the pool.
  const removeAssign = async (ucrId, label) => {
    try {
      const r = await client.delete(`qa/admin/assign/${ucrId}`);
      const bits = [];
      if (r.data.released_tasks) bits.push(`${r.data.released_tasks} unscored call(s) returned to the pool`);
      if (r.data.paused_rules) bits.push(`${r.data.paused_rules} listening rule(s) paused`);
      toast.success(`Access removed${label ? ` from ${label}` : ''}. The account is NOT deleted — they stay in the QA team and can be re-added anytime.${bits.length ? ` ${bits.join('; ')}.` : ''}`, { duration: 7000 });
      loadUsers(); loadRules();
    } catch { toast.error('Remove failed'); }
  };
  const [pulling, setPulling] = useState(null);   // company id whose RCM is being pulled
  const pullRcm = async (co) => {
    setPulling(co.id);
    try {
      const r = await client.post('qa/admin/sample-rcm', { company_id: co.id });
      const reasonMsg = {
        no_mapped_users: 'no fronter/closer here has a dialer id mapped',
        no_recordings_that_day: `no dialer calls found for ${r.data.day}`,
        all_calls_are_in_crm: 'every call that day is already in the CRM (those are TRA, not RCM)',
        already_sampled: 'already sampled',
        nothing_new: 'nothing new to add',
      };
      if (r.data.sampled) toast.success(`Pulled ${r.data.sampled} random call(s) from ${r.data.day} and routed ${r.data.routed}.`);
      else toast.info(`No RCM added for ${r.data.day} — ${reasonMsg[r.data.reason] || r.data.reason}.`, { duration: 7000 });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Pull failed'); }
    finally { setPulling(null); }
  };
  const [distributing, setDistributing] = useState(null);   // company id being distributed
  const distribute = async (co) => {
    setDistributing(co.id);
    try {
      const r = await client.post('qa/admin/auto-assign', { company_id: co.id });
      const held = r.data.held || 0;
      if (r.data.assigned) toast.success(`Routed ${r.data.assigned} task(s) to ${co.name}'s covering agents${held ? ` — ${held} waiting behind the workload cap` : ''}`);
      else if (held) toast.info(`All covering reviewers are at their workload cap — ${held} task(s) will flow in as reviews get done.`);
      else toast.info(co.coverage && (co.coverage.tra.length || co.coverage.rcm.length) ? 'Nothing waiting to route — all caught up.' : 'No covering agent yet. Assign work to a QA person below first.');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Distribute failed'); }
    finally { setDistributing(null); }
  };
  // bind an agent's review method(s) for a company (else manual assigns 400).
  const setAgentMethod = async (userId, companyId, current, m) => {
    const methods = current.includes(m) ? current.filter(x => x !== m) : [...current, m];
    setUsers(us => us.map(u => u.user_id === userId ? { ...u, companies: u.companies.map(c => c.company_id === companyId ? { ...c, methods } : c) } : u));
    try { await client.put('qa/agent-methods', { user_id: userId, company_id: companyId, methods }); }
    catch { toast.error('Method update failed'); loadUsers(); }
  };

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center gap-2 flex-wrap">
        <Shield size={18} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>QA Department</h2>
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          Enable QA per company, then pick a QA person and assign <b>any combination</b> of work. QA accounts are created by the Super Admin and appear here automatically.
        </span>
        <button onClick={load} className="ml-auto p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }} title="Refresh"><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
      </div>

      {/* STEP 1 — QA per company: enable + configure + route */}
      <section>
        <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <StepBadge n={1} /> Companies — enable, configure &amp; route
          <InfoTip text="Turn on the review types per company, open the gear for the settings, and see who reviews that company's calls. If a company shows waiting calls with no reviewer, assign someone in the QA Team below." />
        </div>
        {/* one-line legend so the toggles are never a mystery */}
        <div className="text-[11px] mb-2 flex items-center gap-3 flex-wrap" style={{ color: 'var(--color-text-tertiary)' }}>
          <span><b style={{ color: 'var(--color-primary-600)' }}>TRA</b> = calls entered in the CRM — every transfer gets reviewed</span>
          <span><b style={{ color: 'var(--color-warning-600)' }}>RCM</b> = random raw dialer calls — sampled daily</span>
        </div>
        {companies === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          : <div className="space-y-2">
              {companies.map(co => {
                const noCoverage = co.methods.length > 0 && !((co.coverage?.tra || []).length || (co.coverage?.rcm || []).length);
                return (
                <div key={co.id} className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: noCoverage && co.unassigned > 0 ? '1px solid rgba(217,119,6,0.5)' : '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2 p-2.5">
                    <Building2 size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{co.name}</div><div className="text-[10px] uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{co.company_type || ''}</div></div>
                    {METHODS.map(([k, l]) => {
                      const on = co.methods.includes(k);
                      return <button key={k} onClick={() => toggleMethod(co, k)} className="text-[11px] font-bold px-2 py-1 rounded uppercase"
                        title={k === 'tra'
                          ? (on ? 'TRA is ON — every CRM transfer of this company gets a review task. Click to turn off.' : 'Turn ON TRA — review every transfer entered in the CRM for this company.')
                          : (on ? 'RCM is ON — a daily random sample of this company\'s raw dialer calls gets review tasks. Click to turn off.' : 'Turn ON RCM — sample random raw dialer calls of this company daily.')}
                        style={on ? { background: k === 'tra' ? 'rgba(37,99,235,0.15)' : 'rgba(217,119,6,0.15)', color: k === 'tra' ? 'var(--color-primary-600)' : 'var(--color-warning-600)', border: '1px solid currentColor' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', border: '1px solid transparent' }}>{on ? '✓ ' : ''}{l}</button>;
                    })}
                    <button onClick={() => setExpanded(e => e === co.id ? null : co.id)} title="Settings: sample size, task expiry, workload cap" className="p-1.5 rounded-lg" style={{ background: expanded === co.id ? 'var(--color-surface-hover)' : 'transparent' }}>
                      <Settings2 size={14} style={{ color: 'var(--color-text-secondary)' }} />
                      <ChevronDown size={11} style={{ color: 'var(--color-text-tertiary)', transition: 'transform .15s', transform: expanded === co.id ? 'rotate(180deg)' : 'none' }} />
                    </button>
                  </div>
                  {/* who reviews this company's calls + waiting work */}
                  {co.methods.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap px-2.5 pb-2.5 -mt-0.5">
                      <span className="text-[10px] font-bold uppercase inline-flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>Reviewers
                        <InfoTip text="The QA people currently set up to receive this company's calls, per review type. 'nobody yet' = tasks are being created but have no owner — assign a person in the QA Team below and they start flowing." />
                      </span>
                      {METHODS.filter(([k]) => co.methods.includes(k)).map(([k, l]) => {
                        const names = (co.coverage?.[k]) || [];
                        return (
                          <span key={k} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                            <span className="font-bold" style={{ color: k === 'tra' ? 'var(--color-primary-600)' : 'var(--color-warning-600)' }}>{l}</span>
                            {names.length ? <span style={{ color: 'var(--color-text-secondary)' }}>{names.join(', ')}</span> : <span style={{ color: 'var(--color-error-600)' }}>nobody yet</span>}
                          </span>
                        );
                      })}
                      {co.unassigned > 0 && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-lg" title="Review tasks created for this company that no QA person owns yet. They wait in the pool (and expire after the task-expiry days) until someone is assigned."
                        style={{ background: 'rgba(217,119,6,0.12)', color: 'var(--color-warning-600)' }}>{co.unassigned} call{co.unassigned === 1 ? '' : 's'} waiting for a reviewer</span>}
                      {co.methods.includes('rcm') && (
                        <button onClick={() => pullRcm(co)} disabled={pulling === co.id}
                          className="text-[11px] font-bold px-2 py-1 rounded-lg inline-flex items-center gap-1"
                          style={{ background: 'rgba(217,119,6,0.12)', color: 'var(--color-warning-600)', opacity: pulling === co.id ? 0.6 : 1 }}
                          title="Fetch yesterday's random raw dialer calls LIVE from the dialer right now, and route them. Tells you exactly why if nothing comes.">
                          {pulling === co.id ? <Loader2 size={12} className="animate-spin" /> : <Shuffle size={12} />} Pull RCM now
                        </button>
                      )}
                      <button onClick={() => distribute(co)} disabled={distributing === co.id}
                        className="ml-auto text-[11px] font-bold px-2 py-1 rounded-lg inline-flex items-center gap-1"
                        style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)', opacity: distributing === co.id ? 0.6 : 1 }}
                        title="Hand the waiting calls to this company's reviewers now (does nothing while there are no reviewers)">
                        {distributing === co.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Distribute
                      </button>
                    </div>
                  )}
                  {/* the one action that fixes a 'nobody yet' company, spelled out */}
                  {noCoverage && co.unassigned > 0 && (
                    <div className="px-2.5 pb-2.5 -mt-1 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--color-warning-600)' }}>
                      ⚠ Work is piling up with no reviewer. Fix: <b>QA Team below → pick a person → Assign work → {co.name}</b> — the waiting calls route to them instantly.
                    </div>
                  )}
                  {expanded === co.id && <CompanyConfig companyId={co.id} methods={co.methods} companyType={co.company_type} />}
                </div>
                );
              })}
            </div>}
      </section>

      {/* STEP 2 — QA TEAM: person-centric assignment console */}
      <section>
        <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <StepBadge n={2} /> QA Team — pick a person, assign anything
          <InfoTip w={300} text="Only QUALITY people show here (QA managers & agents — the Super Admin creates them). Click one to open their file: which companies they can work, what they currently listen to, and an Assign-work builder that combines everything — one/many/all agents, TRA, RCM, closer sales, closer-landed dispositions — in a single flow." />
        </div>
        <TeamConsole companies={companies || []} users={users} rules={rules}
          reloadUsers={loadUsers} reloadRules={loadRules} reloadAll={load}
          removeAssign={removeAssign} setAgentMethod={setAgentMethod} />
      </section>

      {/* STEP 3 — read-only overview of the SAME assignments, grouped by company */}
      <section>
        <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <StepBadge n={3} /> Listening overview — by company
          <InfoTip w={300} text="The same assignments you created in the QA Team console above, viewed by company: who listens to what in each one. Run now pulls matching calls and routes them immediately; pause/× manage a rule. New assignments are made in the QA Team console — one place only, no duplicates." />
        </div>
        <RulesSection rules={rules} reload={loadRules} />
      </section>
    </div>
  );
}

// ── STEP 2 — the person-centric console ──────────────────────────────────────
function TeamConsole({ companies, users, rules, reloadUsers, reloadRules, reloadAll, removeAssign, setAgentMethod }) {
  const [q, setQ] = useState('');
  const [lvl, setLvl] = useState('');
  const [sel, setSel] = useState(null);          // selected user_id
  const [assigning, setAssigning] = useState(false);
  const [addCo, setAddCo] = useState('');        // add-to-company picker
  const [addLvl, setAddLvl] = useState('qa_agent');
  const [confirmRemove, setConfirmRemove] = useState(null);   // ucr_id awaiting confirmation

  const shown = useMemo(() => {
    if (!users) return null;
    const term = q.trim().toLowerCase();
    return users.filter(u =>
      (!term || u.name.toLowerCase().includes(term)) &&
      (!lvl || u.levels.includes(lvl)));
  }, [users, q, lvl]);

  const person = (users || []).find(u => u.user_id === sel) || null;
  const personRules = (rules || []).filter(r => r.reviewer_id === sel);
  useEffect(() => { setAssigning(false); setAddCo(''); setConfirmRemove(null); }, [sel]);

  const addToCompany = async () => {
    if (!person || !addCo) return;
    try {
      await client.post('qa/admin/assign', { user_id: person.user_id, company_id: addCo, level: addLvl });
      toast.success(`${person.name} added as QA ${lvlLabel(addLvl).toLowerCase()}`);
      setAddCo(''); reloadUsers();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not add'); }
  };

  const toggleRule = async (rule) => {
    try { await client.put(`qa/admin/rules/${rule.id}`, { is_active: !rule.is_active }); reloadRules(); }
    catch { toast.error('Could not update rule'); }
  };
  const removeRule = async (rule) => {
    try { await client.delete(`qa/admin/rules/${rule.id}`); toast.success('Assignment removed'); reloadRules(); }
    catch { toast.error('Could not remove'); }
  };

  if (users === null) return <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />;
  if (!users.length) return <div className="text-sm p-4 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>No QA people yet — ask the Super Admin to create QA manager/agent accounts; they appear here automatically.</div>;

  const notIn = companies.filter(c => person && !person.companies.some(pc => pc.company_id === c.id));

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: '280px 1fr', alignItems: 'start' }}>
      {/* LEFT — quality people only */}
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="p-2 space-y-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-1 px-2 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <Search size={12} style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search QA people…" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', fontSize: 12, padding: '5px 2px', width: '100%' }} />
          </div>
          <div className="flex items-center gap-1">
            {[['', 'All'], ['qa_manager', 'Managers'], ['qa_agent', 'Agents']].map(([k, l]) => (
              <button key={k} onClick={() => setLvl(k)} className="text-[10px] font-bold px-2 py-1 rounded-lg flex-1"
                style={lvl === k ? { background: 'var(--color-primary-600)', color: '#fff' } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{l}</button>
            ))}
          </div>
        </div>
        <div className="max-h-[380px] overflow-auto">
          {!shown.length ? <div className="text-[11px] p-3" style={{ color: 'var(--color-text-tertiary)' }}>No QA people match.</div>
            : shown.map(u => {
              const nRules = (rules || []).filter(r => r.reviewer_id === u.user_id && r.is_active).length;
              const active = sel === u.user_id;
              return (
                <button key={u.user_id} onClick={() => setSel(u.user_id)}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-2"
                  style={{ background: active ? 'var(--color-surface-hover)' : 'transparent', borderLeft: active ? '3px solid var(--color-primary-600)' : '3px solid transparent', borderBottom: '1px solid var(--color-border)' }}>
                  <span className="inline-flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 26, height: 26, background: 'var(--color-primary-100, #e0e7ff)' }}>
                    <User size={13} style={{ color: 'var(--color-primary-700, #4338ca)' }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-bold truncate" style={{ color: 'var(--color-text)' }}>{u.name}</span>
                    <span className="block text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{u.levels.map(lvlLabel).join(' + ')} · {u.companies.length} co · {nRules} rule{nRules === 1 ? '' : 's'}</span>
                  </span>
                  {u.open_tasks > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums" title={`${u.open_tasks} open call(s) on their plate right now`}
                      style={u.open_tasks >= 25 ? { background: 'rgba(220,38,38,0.12)', color: '#dc2626' } : u.open_tasks >= 15 ? { background: 'rgba(217,119,6,0.12)', color: '#d97706' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                      {u.open_tasks}
                    </span>
                  )}
                  <ChevronRight size={13} style={{ color: 'var(--color-text-tertiary)' }} />
                </button>
              );
            })}
        </div>
        <div className="p-2 text-[10px] flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)', borderTop: '1px solid var(--color-border)' }}>
          <Lock size={11} /> New QA accounts are created by the Super Admin.
        </div>
      </div>

      {/* RIGHT — the selected person's file */}
      {!person ? (
        <div className="rounded-xl p-8 text-center" style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
          <Headphones size={22} className="inline mb-2" style={{ color: 'var(--color-text-tertiary)' }} />
          <div className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Pick a QA person on the left</div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>Then assign them any combination: one or many agents to listen to, transfer calls (TRA), random calls (RCM), closer sales, closer-landed dispositions — all in one flow.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* header */}
          <div className="flex items-center gap-2.5 p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <span className="inline-flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 34, height: 34, background: 'var(--color-primary-100, #e0e7ff)' }}>
              <User size={17} style={{ color: 'var(--color-primary-700, #4338ca)' }} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-extrabold truncate" style={{ color: 'var(--color-text)' }}>{person.name}</div>
              <div className="flex items-center gap-1 mt-0.5">{person.levels.map(l => <span key={l} className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: 'var(--color-surface-hover)', color: l === 'qa_manager' ? 'var(--color-primary-600)' : 'var(--color-warning-600)' }}>{lvlLabel(l)}</span>)}</div>
            </div>
            <span className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-lg tabular-nums"
              title="Open (unscored) calls on their plate right now — routing pauses at the company's workload cap so they never drown"
              style={(person.open_tasks || 0) >= 25 ? { background: 'rgba(220,38,38,0.10)', color: '#dc2626' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
              <Headphones size={11} /> {person.open_tasks || 0} on their plate
            </span>
            <button onClick={() => setAssigning(a => !a)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-white"
              style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' }}>
              <Headphones size={13} /> Assign work
            </button>
          </div>

          {/* the assign-work builder (person-fixed) */}
          {assigning && (
            <RuleBuilder companies={companies} fixedReviewer={person}
              onDone={() => { setAssigning(false); reloadAll(); }} onCancel={() => setAssigning(false)} />
          )}

          {/* company access */}
          <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Company access <InfoTip text="The companies this person can work. For agents, TRA/RCM chips show which method they cover there (needed for manual assigns; work rules route regardless). × removes them from that company." />
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {person.companies.map(c => {
                const coName = c.company_name || c.company_id.slice(0, 6);
                // × asks first — one accidental click must never remove access.
                if (confirmRemove === c.ucr_id) return (
                  <span key={c.ucr_id} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid #dc262666', color: 'var(--color-text-secondary)' }}>
                    <span>Remove <b style={{ color: 'var(--color-text)' }}>{person.name}</b> from <b style={{ color: 'var(--color-text)' }}>{coName}</b>? Their unscored calls return to the pool; the account is <b>not</b> deleted.</span>
                    <button onClick={() => { setConfirmRemove(null); removeAssign(c.ucr_id, coName); }} className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: '#dc2626', color: '#fff' }}>Remove access</button>
                    <button onClick={() => setConfirmRemove(null)} className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>Keep</button>
                  </span>
                );
                return (
                  <span key={c.ucr_id} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{coName}</span>
                    {c.level === 'qa_agent' ? (
                      <span className="inline-flex items-center gap-0.5">
                        {METHODS.map(([k, l]) => {
                          const on = (c.methods || []).includes(k);
                          return <button key={k} onClick={() => setAgentMethod(person.user_id, c.company_id, c.methods || [], k)} className="font-bold px-1 rounded uppercase text-[10px]"
                            style={on ? { background: k === 'tra' ? 'rgba(37,99,235,0.18)' : 'rgba(217,119,6,0.18)', color: k === 'tra' ? 'var(--color-primary-600)' : 'var(--color-warning-600)' } : { color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>{on ? '✓' : ''}{l}</button>;
                        })}
                      </span>
                    ) : <span className="text-[10px] font-bold" style={{ color: 'var(--color-primary-600)' }}>MGR</span>}
                    <button onClick={() => setConfirmRemove(c.ucr_id)} title="Remove access to this company (asks first — never deletes the account)"><X size={12} style={{ color: 'var(--color-error-600)' }} /></button>
                  </span>
                );
              })}
              {!person.companies.length && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>No company access right now — the account still exists. Use “+ add to company” to restore it.</span>}
              {notIn.length > 0 && (
                <span className="inline-flex items-center gap-1 ml-1">
                  <select value={addCo} onChange={e => setAddCo(e.target.value)} style={{ ...inp, fontSize: 11, padding: '4px 6px' }}>
                    <option value="">+ add to company…</option>
                    {notIn.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {addCo && <>
                    <select value={addLvl} onChange={e => setAddLvl(e.target.value)} style={{ ...inp, fontSize: 11, padding: '4px 6px' }}>
                      <option value="qa_agent">Agent</option><option value="qa_manager">Manager</option>
                    </select>
                    <button onClick={addToCompany} className="p-1 rounded-lg" style={{ background: 'var(--color-primary-600)' }} title="Add"><Plus size={12} color="#fff" /></button>
                  </>}
                </span>
              )}
            </div>
          </div>

          {/* their current listening assignments */}
          <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
              What they listen to <InfoTip text="Every listening assignment this person holds — the kinds of calls, whose calls, which company. Pause stops routing without deleting; × removes it." />
              <span className="font-normal normal-case">— {personRules.length || 'none yet'}</span>
            </div>
            {!personRules.length ? <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Nothing assigned yet — click <b>Assign work</b> above.</div>
              : <div className="space-y-1.5">
                  {personRules.map(r => (
                    <div key={r.id} className="flex items-start gap-2 p-2 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', opacity: r.is_active ? 1 : 0.45 }}>
                      <Building2 size={12} className="mt-1" style={{ color: 'var(--color-text-tertiary)' }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>{r.company_name || r.company_id.slice(0, 6)}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(r.work_types || []).map(k => { const d = wtDef(k); const I = d.icon; return (
                            <span key={k} className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${d.tint}18`, color: d.tint }}><I size={10} />{d.label}</span>
                          ); })}
                          {(r.work_types || []).includes('closer_dispo') && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                              {(r.dispositions || []).length ? `dispo: ${r.dispositions.join(', ')}` : 'dispo: any non-SALE'}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                            {(r.subject_names || []).length ? <><User size={10} />{r.subject_names.join(', ')}</> : <><Users size={10} />all agents</>}
                          </span>
                        </div>
                      </div>
                      <button onClick={() => toggleRule(r)} className="text-[10px] font-bold px-2 py-0.5 rounded uppercase" style={r.is_active ? { background: 'rgba(5,150,105,0.14)', color: '#059669' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{r.is_active ? 'Active' : 'Paused'}</button>
                      <button onClick={() => removeRule(r)} title="Remove"><X size={13} style={{ color: 'var(--color-error-600)' }} /></button>
                    </div>
                  ))}
                </div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── work-rule builder — standalone (Step 3) or person-fixed (Team console) ────
// Person-fixed by design: the QA Team console is the ONLY place assignments are
// created, so fixedReviewer is always provided.
function RuleBuilder({ companies, onDone, onCancel, fixedReviewer }) {
  const [companyId, setCompanyId] = useState('');
  const [types, setTypes] = useState([]);
  const [subjectMode, setSubjectMode] = useState('all');   // all | specific
  const [subjects, setSubjects] = useState([]);
  const [dispos, setDispos] = useState([]);
  const [dispoAdd, setDispoAdd] = useState('');
  const [companyUsers, setCompanyUsers] = useState(null);
  const [dispoOptions, setDispoOptions] = useState([]);
  const [accessLevel, setAccessLevel] = useState('qa_agent');   // when adding access on the fly
  const [runNow, setRunNow] = useState(true);
  const [busy, setBusy] = useState(false);

  const rid = fixedReviewer.user_id;
  const personEntry = (fixedReviewer.companies || []).find(c => c.company_id === companyId) || null;
  const needsAccess = !!companyId && !personEntry;

  useEffect(() => {
    if (!companyId) { setCompanyUsers(null); setDispoOptions([]); return; }
    setCompanyUsers(null); setSubjects([]);
    client.get('qa/admin/company-users', { params: { company_id: companyId } }).then(r => setCompanyUsers(r.data.users || [])).catch(() => setCompanyUsers([]));
    client.get('qa/admin/dispositions', { params: { company_id: companyId } }).then(r => setDispoOptions(r.data.dispositions || [])).catch(() => setDispoOptions([]));
  }, [companyId]);

  const toggleType = (k) => setTypes(ts => ts.includes(k) ? ts.filter(x => x !== k) : [...ts, k]);
  const toggleSubject = (id) => setSubjects(ss => ss.includes(id) ? ss.filter(x => x !== id) : [...ss, id]);
  const toggleDispo = (c) => setDispos(ds => ds.includes(c) ? ds.filter(x => x !== c) : [...ds, c]);
  const addDispo = () => { const c = dispoAdd.trim().toUpperCase(); if (c && !dispos.includes(c)) setDispos(ds => [...ds, c]); setDispoAdd(''); };

  const save = async () => {
    if (!companyId || !types.length) return toast.error('Pick a company and at least one kind of call');
    if (subjectMode === 'specific' && !subjects.length) return toast.error('Pick at least one agent to listen to, or switch back to All agents');
    setBusy(true);
    try {
      // 1. company access on the fly
      if (needsAccess) await client.post('qa/admin/assign', { user_id: rid, company_id: companyId, level: accessLevel });
      // 2. Method binding = company-wide "catch-all" coverage (Distribute uses it).
      //    Bind it ONLY when the rule covers ALL agents — otherwise a
      //    "listen to 3 specific users" reviewer would ALSO be flooded with the
      //    whole company via Distribute. Specific-user rules route via the rule
      //    alone, so they stay focused.
      const isAgent = personEntry ? personEntry.level === 'qa_agent' : accessLevel === 'qa_agent';
      if (isAgent && subjectMode === 'all') {
        const implied = [...new Set(types.map(t => t === 'tra' ? 'tra' : 'rcm'))];
        const merged = [...new Set([...(personEntry?.methods || []), ...implied])];
        await client.put('qa/agent-methods', { user_id: rid, company_id: companyId, methods: merged }).catch(() => {});
      }
      // 3. the rule itself
      await client.post('qa/admin/rules', {
        company_id: companyId, reviewer_id: rid, work_types: types,
        subject_user_ids: subjectMode === 'specific' ? subjects : [],
        dispositions: types.includes('closer_dispo') ? dispos : [],
      });
      // 4. optionally pull + route right away
      if (runNow) {
        try {
          const r = await client.post('qa/admin/rules/apply', { company_id: companyId });
          const held = r.data.held || 0;
          toast.success(`Assigned — routed ${r.data.routed} call(s) now${held ? `; ${held} waiting behind the workload cap (they'll flow in as reviews get done)` : ''}. New calls follow automatically.`);
        } catch { toast.success('Assigned — matching calls route automatically from now on.'); }
      } else {
        toast.success('Assigned — matching calls route automatically from now on.');
      }
      onDone();
    } catch (e) { toast.error(e.response?.data?.error || 'Could not create the assignment'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-3.5 rounded-xl space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-primary-600)' }}>
      <div className="flex items-center gap-2">
        <Headphones size={15} style={{ color: 'var(--color-primary-600)' }} />
        <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Assign work to {fixedReviewer.name}</span>
        <button onClick={onCancel} className="ml-auto"><X size={16} style={{ color: 'var(--color-text-tertiary)' }} /></button>
      </div>

      {/* where */}
      <div className="grid gap-2" style={{ gridTemplateColumns: '1fr' }}>
        <label className="text-[11px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>COMPANY
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={{ ...inp, display: 'block', width: '100%', marginTop: 3 }}>
            <option value="">Choose company…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}{(fixedReviewer.companies || []).some(pc => pc.company_id === c.id) ? ' ✓' : ''}</option>)}
          </select>
        </label>
      </div>
      {needsAccess && (
        <div className="flex items-center gap-2 text-[11px] p-2 rounded-lg" style={{ background: 'rgba(217,119,6,0.08)', color: 'var(--color-warning-600)' }}>
          <Plus size={12} /> Not in this company yet — they'll be added automatically as
          <select value={accessLevel} onChange={e => setAccessLevel(e.target.value)} style={{ ...inp, fontSize: 11, padding: '3px 6px' }}>
            <option value="qa_agent">Agent</option><option value="qa_manager">Manager</option>
          </select>
        </div>
      )}

      {/* what kinds of calls */}
      <div>
        <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>KINDS OF CALLS <span className="font-normal">— pick any combination</span></div>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {WORK_TYPE_DEFS.map(w => {
            const on = types.includes(w.key); const I = w.icon;
            return (
              <button key={w.key} onClick={() => toggleType(w.key)} className="text-left p-2 rounded-lg flex items-start gap-2"
                style={{ background: on ? `${w.tint}12` : 'var(--color-bg)', border: `1px solid ${on ? w.tint : 'var(--color-border)'}` }}>
                <I size={14} className="mt-0.5 flex-shrink-0" style={{ color: w.tint }} />
                <span>
                  <span className="block text-xs font-bold" style={{ color: on ? w.tint : 'var(--color-text)' }}>{on ? '✓ ' : ''}{w.label}</span>
                  <span className="block text-[10px] leading-snug mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{w.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* dispositions — only for closer_dispo */}
      {types.includes('closer_dispo') && (
        <div>
          <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>WHICH DISPOSITIONS <span className="font-normal">— none picked = any non-SALE</span></div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {dispoOptions.map(d => (
              <button key={d.code} onClick={() => toggleDispo(d.code)} className="text-[11px] font-bold px-2 py-1 rounded-lg"
                style={dispos.includes(d.code) ? { background: 'rgba(220,38,38,0.12)', color: '#dc2626', border: '1px solid #dc262666' } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                {d.code} <span className="font-normal opacity-70">({d.count})</span>
              </button>
            ))}
            {dispos.filter(c => !dispoOptions.some(o => o.code === c)).map(c => (
              <button key={c} onClick={() => toggleDispo(c)} className="text-[11px] font-bold px-2 py-1 rounded-lg" style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626', border: '1px solid #dc262666' }}>{c}</button>
            ))}
            <input value={dispoAdd} onChange={e => setDispoAdd(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDispo()} placeholder="Add code…" style={{ ...inp, width: 90, fontSize: 11, padding: '4px 8px' }} />
          </div>
        </div>
      )}

      {/* whose calls */}
      <div>
        <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>LISTEN TO</div>
        <div className="flex items-center gap-2 mb-1.5">
          {[['all', 'All agents', Users], ['specific', 'Specific agents', User]].map(([k, l, I]) => (
            <button key={k} onClick={() => setSubjectMode(k)} className="text-[11px] font-bold px-2.5 py-1 rounded-lg inline-flex items-center gap-1"
              style={subjectMode === k ? { background: 'var(--color-primary-600)', color: '#fff' } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              <I size={11} />{l}
            </button>
          ))}
          {subjectMode === 'specific' && <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{subjects.length} selected — single or multiple, your choice</span>}
        </div>
        {subjectMode === 'specific' && (
          !companyId ? <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Pick a company first to see its agents.</div>
          : companyUsers === null ? <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          : !companyUsers.length ? <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>No fronters/closers found in this company.</div>
          : <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
              {companyUsers.map(u => {
                // RCM needs a dialer mapping to attribute raw calls; warn if missing
                const rcmNeedsDialer = types.includes('rcm') && !u.has_dialer;
                return (
                <button key={u.user_id} onClick={() => toggleSubject(u.user_id)} className="text-[11px] px-2 py-1 rounded-lg"
                  title={rcmNeedsDialer ? 'No dialer id mapped — this person\'s RANDOM (RCM) raw calls can\'t be sampled until their vicidial_agent_ids is set on their profile.' : (u.linked ? `Closer at the linked company ${u.company_name || ''} — receives this company's transferred calls` : undefined)}
                  style={subjects.includes(u.user_id) ? { background: 'var(--color-primary-100, #e0e7ff)', color: 'var(--color-primary-700, #4338ca)', border: '1px solid var(--color-primary-300, #c7d2fe)', fontWeight: 700 } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: `1px solid ${rcmNeedsDialer ? '#dc262655' : 'var(--color-border)'}` }}>
                  {subjects.includes(u.user_id) ? '✓ ' : ''}{u.name} <span className="opacity-60">· {u.level.replace('_', ' ')}{u.linked && u.company_name ? ` @ ${u.company_name}` : ''}</span>
                  {rcmNeedsDialer && <span title="No dialer mapping" style={{ color: '#dc2626', marginLeft: 3 }}>⚠</span>}
                </button>
                );
              })}
              {types.includes('rcm') && companyUsers.some(u => subjects.includes(u.user_id) && !u.has_dialer) && (
                <div className="w-full text-[10px] mt-1" style={{ color: 'var(--color-warning-600)' }}>⚠ Users marked ⚠ have no dialer id — their random (RCM) calls can't be pulled until their dialer mapping is set. TRA/closer reviews still work for them.</div>
              )}
            </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          <input type="checkbox" checked={runNow} onChange={e => setRunNow(e.target.checked)} /> Route matching calls now
          <InfoTip text="Pull the matching calls that already exist and hand them to this reviewer immediately. New calls route automatically either way." />
        </label>
        <span className="ml-auto flex items-center gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-xs font-bold text-white inline-flex items-center gap-1.5"
            style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: busy ? 0.6 : 1 }}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Assign
          </button>
        </span>
      </div>
    </div>
  );
}

// ── STEP 3 — rules overview grouped by company (read-only + Run now/pause/×).
// Assignments are CREATED in one place only: the QA Team console above — this
// section is the by-company view of the same rules, so there's never a second,
// competing "assign" flow to confuse anyone. ──────────────────────────────────
function RulesSection({ rules, reload }) {
  const [applying, setApplying] = useState(null);   // company id being run

  const toggle = async (rule) => {
    try { await client.put(`qa/admin/rules/${rule.id}`, { is_active: !rule.is_active }); reload(); }
    catch { toast.error('Could not update rule'); }
  };
  const remove = async (rule) => {
    try { await client.delete(`qa/admin/rules/${rule.id}`); toast.success('Rule removed'); reload(); }
    catch { toast.error('Could not remove rule'); }
  };
  const runNow = async (companyId) => {
    setApplying(companyId);
    try {
      const r = await client.post('qa/admin/rules/apply', { company_id: companyId });
      const bits = [];
      const m = r.data.materialized || {}; const c = r.data.closer || {};
      if (m.tra) bits.push(`${m.tra} TRA`); if (m.rcm) bits.push(`${m.rcm} RCM`);
      if (c.closer_sales) bits.push(`${c.closer_sales} sales`); if (c.closer_dispo) bits.push(`${c.closer_dispo} dispo`);
      const held = r.data.held || 0;
      toast.success(`Rules ran — pulled ${bits.length ? bits.join(' + ') : 'no new calls'}, routed ${r.data.routed} task(s)${held ? `; ${held} waiting behind the workload cap` : ''}`);
    } catch (e) { toast.error(e.response?.data?.error || 'Run failed'); }
    finally { setApplying(null); }
  };

  const byCompany = useMemo(() => {
    const m = {};
    for (const r of (rules || [])) (m[r.company_id] ||= { name: r.company_name, rules: [] }).rules.push(r);
    return m;
  }, [rules]);

  return (
    <div className="space-y-3">
      {rules === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
        : !rules.length ? (
          <div className="text-[12px] p-3 rounded-xl leading-relaxed" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            No listening assignments yet. Create them in the <b>QA Team</b> console above — pick a person, click <b>Assign work</b>. They'll appear here grouped by company.
          </div>
        ) : Object.entries(byCompany).map(([coId, g]) => (
          <div key={coId} className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Building2 size={13} style={{ color: 'var(--color-text-tertiary)' }} />
              <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{g.name || coId.slice(0, 8)}</span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{g.rules.length} rule{g.rules.length === 1 ? '' : 's'}</span>
              <button onClick={() => runNow(coId)} disabled={applying === coId}
                className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-lg inline-flex items-center gap-1"
                style={{ background: 'var(--color-primary-600)', color: '#fff', opacity: applying === coId ? 0.6 : 1 }}
                title="Pull the matching calls and route them to the rule reviewers right now">
                {applying === coId ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run now
              </button>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {g.rules.map(r => (
                <div key={r.id} className="flex items-start gap-2 px-3 py-2" style={{ opacity: r.is_active ? 1 : 0.45 }}>
                  <Headphones size={14} className="mt-0.5" style={{ color: 'var(--color-primary-600)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{r.reviewer_name || r.reviewer_id.slice(0, 6)} <span className="text-[11px] font-normal" style={{ color: 'var(--color-text-tertiary)' }}>listens to</span></div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(r.work_types || []).map(k => { const d = wtDef(k); const I = d.icon; return (
                        <span key={k} className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${d.tint}18`, color: d.tint }}><I size={10} />{d.label}</span>
                      ); })}
                      {(r.work_types || []).includes('closer_dispo') && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                          {(r.dispositions || []).length ? `dispo: ${r.dispositions.join(', ')}` : 'dispo: any non-SALE'}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)' }}>
                        {(r.subject_names || []).length ? <><User size={10} />{r.subject_names.join(', ')}</> : <><Users size={10} />all agents</>}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => toggle(r)} className="text-[10px] font-bold px-2 py-1 rounded uppercase" style={r.is_active ? { background: 'rgba(5,150,105,0.14)', color: '#059669' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)' }}>{r.is_active ? 'Active' : 'Paused'}</button>
                  <button onClick={() => remove(r)} title="Delete rule"><X size={14} style={{ color: 'var(--color-error-600)' }} /></button>
                </div>
              ))}
            </div>
          </div>
        ))}

    </div>
  );
}

// ── per-company QA config (RCM sampling, covers, retention) ──────────────────
function CompanyConfig({ companyId, methods, companyType }) {
  const [cfg, setCfg] = useState(null);
  useEffect(() => { client.get('qa/admin/company-config', { params: { company_id: companyId } }).then(r => setCfg(r.data.config || {})).catch(() => setCfg({})); }, [companyId]);
  const setKey = async (key, value) => {
    setCfg(c => ({ ...c, [key]: value }));
    try { await client.put('qa/admin/company-config', { company_id: companyId, key, value }); }
    catch { toast.error('Save failed'); }
  };
  if (!cfg) return <div className="p-3" style={{ borderTop: '1px solid var(--color-border)' }}><Loader2 className="animate-spin" size={14} style={{ color: 'var(--color-text-tertiary)' }} /></div>;
  const rcm = (cfg['qa.rcm.sample'] && typeof cfg['qa.rcm.sample'] === 'object') ? cfg['qa.rcm.sample'] : { mode: 'percentage', value: 10, period: 'week' };
  const covers = Array.isArray(cfg['qa.rcm.covers']) ? cfg['qa.rcm.covers'] : ['fronter'];
  const retention = cfg['qa.retention_days'] ?? 2;
  // one settings row: bold title + plain-language sentence + the controls
  const Row = ({ title, tip, children, sub }) => (
    <div className="flex items-start gap-3 py-2" style={{ borderBottom: '1px dashed var(--color-border)' }}>
      <div style={{ width: 210 }} className="flex-shrink-0">
        <div className="text-xs font-bold flex items-center gap-1" style={{ color: 'var(--color-text)' }}>{title}{tip && <InfoTip text={tip} />}</div>
        {sub && <div className="text-[10px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-tertiary)' }}>{sub}</div>}
      </div>
      <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">{children}</div>
    </div>
  );

  return (
    <div className="px-3 pb-2" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
      {methods.includes('rcm') ? (
        <Row title="Random sample size (RCM)"
          sub="How many raw dialer calls to pull for review, and whose calls the sample listens to."
          tip="'A fixed number' pulls exactly that many calls; 'A percentage' takes that share of the day's calls. Weekly amounts are spread evenly across the days. 'Fronters/Closers' picks whose dialer calls go into the random draw.">
          <select value={rcm.mode} onChange={e => setKey('qa.rcm.sample', { ...rcm, mode: e.target.value })} style={inp}>
            <option value="fixed">A fixed number</option><option value="percentage">A percentage</option>
          </select>
          <input type="number" value={rcm.value} onChange={e => setKey('qa.rcm.sample', { ...rcm, value: +e.target.value })} style={{ ...inp, width: 70 }} />
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{rcm.mode === 'percentage' ? '% of calls' : 'calls'}</span>
          <select value={rcm.period} onChange={e => setKey('qa.rcm.sample', { ...rcm, period: e.target.value })} style={inp}><option value="day">per day</option><option value="week">per week</option></select>
          {/* Only the roles this company ACTUALLY has: fronter companies employ
              fronters, the closer company employs closers — never both boxes. */}
          {(() => {
            const opts = companyType === 'fronter' ? [['fronter', 'fronters']]
              : companyType === 'closer' ? [['closer', 'closers']]
              : [['fronter', 'fronters'], ['closer', 'closers']];
            return (
              <>
                <span className="text-[11px] ml-2" style={{ color: 'var(--color-text-tertiary)' }}>listen to:</span>
                {opts.map(([r, label]) => (
                  <label key={r} className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    <input type="checkbox" checked={covers.includes(r)} onChange={e => setKey('qa.rcm.covers', e.target.checked ? [...new Set([...covers, r])] : covers.filter(x => x !== r))} />{label}
                  </label>
                ))}
                {companyType === 'fronter' && <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>(this company has fronters only — the closers' calls are reviewed via "Closer" work types on the closer company)</span>}
              </>
            );
          })()}
        </Row>
      ) : (
        <div className="text-[11px] py-2" style={{ color: 'var(--color-text-tertiary)', borderBottom: '1px dashed var(--color-border)' }}>
          Turn on <b>RCM</b> above to set the random-sample size. TRA needs no settings — it always reviews every CRM transfer.
        </div>
      )}
      <Row title="Unclaimed calls expire after"
        sub="A waiting call nobody picks up is removed automatically — old calls never pile into an endless backlog."
        tip="Only applies to calls still sitting in the pool with no reviewer. Anything assigned, in progress, or scored is kept forever.">
        <input type="number" min={1} max={30} value={retention} onChange={e => setKey('qa.retention_days', Math.max(1, Math.min(30, +e.target.value || 2)))} style={{ ...inp, width: 60 }} />
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>days</span>
      </Row>
      <Row title="Max open calls per reviewer"
        sub="No QA person ever holds more than this many unscored calls — extra work waits and flows in as they finish."
        tip="The workload cap. Routing always picks the least-loaded reviewer and stops at this number, so a big backlog trickles onto plates instead of burying anyone.">
        <input type="number" min={5} max={200} value={cfg['qa.reviewer_cap'] ?? 25} onChange={e => setKey('qa.reviewer_cap', Math.max(5, Math.min(200, +e.target.value || 25)))} style={{ ...inp, width: 60 }} />
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>open calls</span>
      </Row>
    </div>
  );
}
