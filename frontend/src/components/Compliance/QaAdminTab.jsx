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
  { key: 'tra', label: 'Transfer calls (TRA)', icon: ArrowRightLeft, tint: '#2563eb', desc: 'The calls that are IN the CRM — every transfer the fronters enter. A transfer means TRA.' },
  { key: 'rcm', label: 'Random calls (RCM)', icon: Shuffle, tint: '#d97706', desc: 'Random RAW dialer calls of the users — numbers NOT entered in the CRM. Sampled daily at the configured rate.' },
  { key: 'closer_sales', label: 'Closer sales calls', icon: DollarSign, tint: '#059669', desc: 'The sales calls of the closers — every sale gets a review task.' },
  { key: 'closer_dispo', label: 'Closer-landed, other dispositions', icon: PhoneOff, tint: '#dc2626', desc: 'Transfers that reached a closer but ended with a different disposition — pick which codes count (none picked = any non-SALE).' },
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
  const removeAssign = async (ucrId) => { try { await client.delete(`qa/admin/assign/${ucrId}`); loadUsers(); } catch { toast.error('Remove failed'); } };
  const [distributing, setDistributing] = useState(null);   // company id being distributed
  const distribute = async (co) => {
    setDistributing(co.id);
    try {
      const r = await client.post('qa/admin/auto-assign', { company_id: co.id });
      if (r.data.assigned) toast.success(`Routed ${r.data.assigned} task(s) to ${co.name}'s covering agents`);
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
          <InfoTip text="Turn on TRA (CRM transfers) and/or RCM (random raw dialer calls) per company, open the gear for sampling/retention settings, and see who covers each company's calls. Distribute routes waiting tasks to the covering agents." />
        </div>
        {companies === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          : <div className="space-y-2">
              {companies.map(co => (
                <div key={co.id} className="rounded-xl overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2 p-2.5">
                    <Building2 size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{co.name}</div><div className="text-[10px] uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{co.company_type || ''}</div></div>
                    {METHODS.map(([k, l]) => {
                      const on = co.methods.includes(k);
                      return <button key={k} onClick={() => toggleMethod(co, k)} className="text-[11px] font-bold px-2 py-1 rounded uppercase"
                        style={on ? { background: k === 'tra' ? 'rgba(37,99,235,0.15)' : 'rgba(217,119,6,0.15)', color: k === 'tra' ? 'var(--color-primary-600)' : 'var(--color-warning-600)', border: '1px solid currentColor' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', border: '1px solid transparent' }}>{on ? '✓ ' : ''}{l}</button>;
                    })}
                    <button onClick={() => setExpanded(e => e === co.id ? null : co.id)} title="Configure QA for this company" className="p-1.5 rounded-lg" style={{ background: expanded === co.id ? 'var(--color-surface-hover)' : 'transparent' }}>
                      <Settings2 size={14} style={{ color: 'var(--color-text-secondary)' }} />
                      <ChevronDown size={11} style={{ color: 'var(--color-text-tertiary)', transition: 'transform .15s', transform: expanded === co.id ? 'rotate(180deg)' : 'none' }} />
                    </button>
                  </div>
                  {/* coverage + routing — who handles this company's calls, and any backlog */}
                  {co.methods.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap px-2.5 pb-2.5 -mt-0.5">
                      <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>Covered by</span>
                      {METHODS.filter(([k]) => co.methods.includes(k)).map(([k, l]) => {
                        const names = (co.coverage?.[k]) || [];
                        return (
                          <span key={k} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                            <span className="font-bold" style={{ color: k === 'tra' ? 'var(--color-primary-600)' : 'var(--color-warning-600)' }}>{l}</span>
                            {names.length ? <span style={{ color: 'var(--color-text-secondary)' }}>{names.join(', ')}</span> : <span style={{ color: 'var(--color-error-600)' }}>nobody</span>}
                          </span>
                        );
                      })}
                      {co.unassigned > 0 && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-lg" style={{ background: 'rgba(217,119,6,0.12)', color: 'var(--color-warning-600)' }}>{co.unassigned} unassigned</span>}
                      <button onClick={() => distribute(co)} disabled={distributing === co.id}
                        className="ml-auto text-[11px] font-bold px-2 py-1 rounded-lg inline-flex items-center gap-1"
                        style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary-600)', opacity: distributing === co.id ? 0.6 : 1 }}
                        title="Route this company's unassigned tasks to its covering agents (round-robin)">
                        {distributing === co.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Distribute
                      </button>
                    </div>
                  )}
                  {expanded === co.id && <CompanyConfig companyId={co.id} methods={co.methods} />}
                </div>
              ))}
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

      {/* STEP 3 — work rules overview across companies */}
      <section>
        <div className="text-sm font-bold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
          <StepBadge n={3} /> Work rules — all companies
          <InfoTip w={300} text="Every active listening rule, grouped by company. A rule sends a kind of work — TRA, RCM, closer sales, or closer-landed calls with chosen dispositions — to one QA reviewer, for everyone or specific agents. Run now pulls matching calls and routes them immediately." />
        </div>
        <RulesSection companies={companies || []} qaUsers={users || []} rules={rules} reload={loadRules} />
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

  const shown = useMemo(() => {
    if (!users) return null;
    const term = q.trim().toLowerCase();
    return users.filter(u =>
      (!term || u.name.toLowerCase().includes(term)) &&
      (!lvl || u.levels.includes(lvl)));
  }, [users, q, lvl]);

  const person = (users || []).find(u => u.user_id === sel) || null;
  const personRules = (rules || []).filter(r => r.reviewer_id === sel);
  useEffect(() => { setAssigning(false); setAddCo(''); }, [sel]);

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
                    <span className="block text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{u.levels.map(lvlLabel).join(' + ')} · {u.companies.length} co · {nRules} task{nRules === 1 ? '' : 's'}</span>
                  </span>
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
            <button onClick={() => setAssigning(a => !a)} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold text-white"
              style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))' }}>
              <Headphones size={13} /> Assign work
            </button>
          </div>

          {/* the assign-work builder (person-fixed) */}
          {assigning && (
            <RuleBuilder companies={companies} qaUsers={users} fixedReviewer={person}
              onDone={() => { setAssigning(false); reloadAll(); }} onCancel={() => setAssigning(false)} />
          )}

          {/* company access */}
          <div className="p-3 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="text-[10px] font-bold uppercase tracking-wide mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Company access <InfoTip text="The companies this person can work. For agents, TRA/RCM chips show which method they cover there (needed for manual assigns; work rules route regardless). × removes them from that company." />
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {person.companies.map(c => (
                <span key={c.ucr_id} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{c.company_name || c.company_id.slice(0, 6)}</span>
                  {c.level === 'qa_agent' ? (
                    <span className="inline-flex items-center gap-0.5">
                      {METHODS.map(([k, l]) => {
                        const on = (c.methods || []).includes(k);
                        return <button key={k} onClick={() => setAgentMethod(person.user_id, c.company_id, c.methods || [], k)} className="font-bold px-1 rounded uppercase text-[10px]"
                          style={on ? { background: k === 'tra' ? 'rgba(37,99,235,0.18)' : 'rgba(217,119,6,0.18)', color: k === 'tra' ? 'var(--color-primary-600)' : 'var(--color-warning-600)' } : { color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>{on ? '✓' : ''}{l}</button>;
                      })}
                    </span>
                  ) : <span className="text-[10px] font-bold" style={{ color: 'var(--color-primary-600)' }}>MGR</span>}
                  <button onClick={() => removeAssign(c.ucr_id)} title="Remove from this company"><X size={12} style={{ color: 'var(--color-error-600)' }} /></button>
                </span>
              ))}
              {!person.companies.length && <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>No company access yet.</span>}
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
function RuleBuilder({ companies, qaUsers, onDone, onCancel, fixedReviewer = null }) {
  const [companyId, setCompanyId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [types, setTypes] = useState([]);
  const [subjectMode, setSubjectMode] = useState('all');   // all | specific
  const [subjects, setSubjects] = useState([]);
  const [dispos, setDispos] = useState([]);
  const [dispoAdd, setDispoAdd] = useState('');
  const [companyUsers, setCompanyUsers] = useState(null);
  const [dispoOptions, setDispoOptions] = useState([]);
  const [accessLevel, setAccessLevel] = useState('qa_agent');   // when adding access on the fly
  const [runNow, setRunNow] = useState(!!fixedReviewer);
  const [busy, setBusy] = useState(false);

  const rid = fixedReviewer ? fixedReviewer.user_id : reviewerId;
  const personEntry = fixedReviewer ? (fixedReviewer.companies || []).find(c => c.company_id === companyId) : null;
  const needsAccess = !!fixedReviewer && !!companyId && !personEntry;

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
    if (!companyId || !rid || !types.length) return toast.error('Pick a company' + (fixedReviewer ? '' : ', a reviewer') + ' and at least one kind of call');
    if (subjectMode === 'specific' && !subjects.length) return toast.error('Pick at least one agent to listen to, or switch back to All agents');
    setBusy(true);
    try {
      // 1. company access on the fly (person-fixed mode)
      if (needsAccess) await client.post('qa/admin/assign', { user_id: rid, company_id: companyId, level: accessLevel });
      // 2. bind the implied methods so manual assigns/coverage also work
      const isAgent = fixedReviewer ? (personEntry ? personEntry.level === 'qa_agent' : accessLevel === 'qa_agent') : false;
      if (fixedReviewer && isAgent) {
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
          toast.success(`Assigned — routed ${r.data.routed} matching call(s) now; new ones follow automatically.`);
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
        <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{fixedReviewer ? `Assign work to ${fixedReviewer.name}` : 'New work rule'}</span>
        <button onClick={onCancel} className="ml-auto"><X size={16} style={{ color: 'var(--color-text-tertiary)' }} /></button>
      </div>

      {/* where (+ who, when not person-fixed) */}
      <div className="grid gap-2" style={{ gridTemplateColumns: fixedReviewer ? '1fr' : '1fr 1fr' }}>
        <label className="text-[11px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>COMPANY
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={{ ...inp, display: 'block', width: '100%', marginTop: 3 }}>
            <option value="">Choose company…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}{fixedReviewer && (fixedReviewer.companies || []).some(pc => pc.company_id === c.id) ? ' ✓' : ''}</option>)}
          </select>
        </label>
        {!fixedReviewer && (
          <label className="text-[11px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>QA REVIEWER (who listens)
            <select value={reviewerId} onChange={e => setReviewerId(e.target.value)} style={{ ...inp, display: 'block', width: '100%', marginTop: 3 }}>
              <option value="">Choose QA person…</option>
              {qaUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.name}{u.levels?.includes('qa_manager') ? ' (manager)' : ''}</option>)}
            </select>
          </label>
        )}
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
              {companyUsers.map(u => (
                <button key={u.user_id} onClick={() => toggleSubject(u.user_id)} className="text-[11px] px-2 py-1 rounded-lg"
                  style={subjects.includes(u.user_id) ? { background: 'var(--color-primary-100, #e0e7ff)', color: 'var(--color-primary-700, #4338ca)', border: '1px solid var(--color-primary-300, #c7d2fe)', fontWeight: 700 } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                  {subjects.includes(u.user_id) ? '✓ ' : ''}{u.name} <span className="opacity-60">· {u.level.replace('_', ' ')}</span>
                </button>
              ))}
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
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {fixedReviewer ? 'Assign' : 'Create rule'}
          </button>
        </span>
      </div>
    </div>
  );
}

// ── STEP 3 — rules overview grouped by company (controlled) ───────────────────
function RulesSection({ companies, qaUsers, rules, reload }) {
  const [building, setBuilding] = useState(false);
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
      toast.success(`Rules ran — pulled ${bits.length ? bits.join(' + ') : 'no new calls'}, routed ${r.data.routed} task(s)`);
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
            No work rules yet — assign work from the QA Team console above (pick a person → Assign work), or build a rule here.
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

      {building
        ? <RuleBuilder companies={companies} qaUsers={qaUsers} onDone={() => { setBuilding(false); reload(); }} onCancel={() => setBuilding(false)} />
        : <button onClick={() => setBuilding(true)} className="w-full py-2.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5"
            style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', color: '#fff' }}>
            <Headphones size={14} /> New work rule — assign a reviewer to calls
          </button>}
    </div>
  );
}

// ── per-company QA config (RCM sampling, covers, retention) ──────────────────
function CompanyConfig({ companyId, methods }) {
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
  return (
    <div className="p-3 space-y-3" style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
      {methods.includes('rcm') ? (
        <div>
          <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--color-text-tertiary)' }}>RCM sampling</div>
          <div className="flex gap-2 items-center flex-wrap">
            <select value={rcm.mode} onChange={e => setKey('qa.rcm.sample', { ...rcm, mode: e.target.value })} style={inp}><option value="percentage">Percentage</option><option value="fixed">Fixed N</option></select>
            <input type="number" value={rcm.value} onChange={e => setKey('qa.rcm.sample', { ...rcm, value: +e.target.value })} style={{ ...inp, width: 70 }} />
            <select value={rcm.period} onChange={e => setKey('qa.rcm.sample', { ...rcm, period: e.target.value })} style={inp}><option value="week">per week</option><option value="day">per day</option></select>
            <span className="text-[11px] font-bold uppercase ml-2" style={{ color: 'var(--color-text-tertiary)' }}>Covers</span>
            {['fronter', 'closer'].map(r => <label key={r} className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}><input type="checkbox" checked={covers.includes(r)} onChange={e => setKey('qa.rcm.covers', e.target.checked ? [...new Set([...covers, r])] : covers.filter(x => x !== r))} />{r}</label>)}
          </div>
        </div>
      ) : <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Enable RCM above to configure sampling. TRA reviews every CRM transfer.</div>}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--color-text-tertiary)' }}>Keep untouched tasks</span>
        <input type="number" min={1} max={30} value={retention} onChange={e => setKey('qa.retention_days', Math.max(1, Math.min(30, +e.target.value || 2)))} style={{ ...inp, width: 60 }} />
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>days, then auto-purge</span>
      </div>
    </div>
  );
}
