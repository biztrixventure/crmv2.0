import { useState, useEffect, useCallback } from 'react';
import { Shield, RefreshCw, Loader2, X, UserPlus, Search, Building2, Check } from 'lucide-react';
import { toast } from 'sonner';
import client from '../../api/client';

// ============================================================================
// QaAdminTab — Compliance owns the QA department. Enable/disable QA per company,
// and create/assign QA managers & agents across MANY companies (mig 181 global
// QA roles + /qa/admin endpoints, gated on manage_qa_department).
// ============================================================================

const inp = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
const METHODS = [['tra', 'TRA'], ['rcm', 'RCM']];
const lvlLabel = (l) => (l === 'qa_manager' ? 'Manager' : 'Agent');

export default function QaAdminTab() {
  const [companies, setCompanies] = useState(null);
  const [users, setUsers] = useState(null);

  const loadUsers = useCallback(() => client.get('qa/admin/users').then(r => setUsers(r.data.users || [])).catch(() => setUsers([])), []);
  const load = useCallback(() => {
    client.get('qa/admin/overview').then(r => setCompanies(r.data.companies || [])).catch(() => setCompanies([]));
    loadUsers();
  }, [loadUsers]);
  useEffect(() => { load(); }, [load]);

  const toggleMethod = async (co, m) => {
    const methods = co.methods.includes(m) ? co.methods.filter(x => x !== m) : [...co.methods, m];
    setCompanies(cs => cs.map(c => c.id === co.id ? { ...c, methods } : c));
    try { const r = await client.put('qa/admin/company-methods', { company_id: co.id, methods }); const mm = r.data.materialized; if (mm && (mm.tra || mm.rcm)) toast.success(`QA on — pulled ${mm.tra || 0} TRA + ${mm.rcm || 0} RCM`); }
    catch { toast.error('Update failed'); load(); }
  };
  const removeAssign = async (ucrId) => { try { await client.delete(`qa/admin/assign/${ucrId}`); loadUsers(); } catch { toast.error('Remove failed'); } };

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center gap-2">
        <Shield size={18} style={{ color: 'var(--color-primary-600)' }} />
        <h2 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>QA Department</h2>
        <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Compliance controls every QA setting, manager and agent — across all companies.</span>
        <button onClick={load} className="ml-auto p-2 rounded-lg" style={{ background: 'var(--color-surface-hover)' }}><RefreshCw size={14} style={{ color: 'var(--color-text-secondary)' }} /></button>
      </div>

      {/* QA per company */}
      <section>
        <div className="text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>Enable QA per company</div>
        {companies === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          : <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {companies.map(co => (
                <div key={co.id} className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <Building2 size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{co.name}</div><div className="text-[10px] uppercase" style={{ color: 'var(--color-text-tertiary)' }}>{co.company_type || ''}</div></div>
                  {METHODS.map(([k, l]) => {
                    const on = co.methods.includes(k);
                    return <button key={k} onClick={() => toggleMethod(co, k)} className="text-[11px] font-bold px-2 py-1 rounded uppercase"
                      style={on ? { background: k === 'tra' ? 'rgba(37,99,235,0.15)' : 'rgba(217,119,6,0.15)', color: k === 'tra' ? 'var(--color-primary-600)' : 'var(--color-warning-600)', border: '1px solid currentColor' } : { background: 'var(--color-surface-hover)', color: 'var(--color-text-tertiary)', border: '1px solid transparent' }}>{on ? '✓ ' : ''}{l}</button>;
                  })}
                </div>
              ))}
            </div>}
      </section>

      {/* Assign / create QA people */}
      <section className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <AssignExisting companies={companies || []} onDone={loadUsers} />
        <CreateQaUser companies={companies || []} onDone={loadUsers} />
      </section>

      {/* QA people list */}
      <section>
        <div className="text-sm font-bold mb-2" style={{ color: 'var(--color-text)' }}>QA managers &amp; agents</div>
        {users === null ? <Loader2 className="animate-spin" style={{ color: 'var(--color-text-tertiary)' }} />
          : !users.length ? <div className="text-sm p-4 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>No QA people yet — assign or create one above.</div>
          : <div className="space-y-2">
              {users.map(u => (
                <div key={u.user_id} className="p-2.5 rounded-xl" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{u.name}</span>
                    {u.levels.map(l => <span key={l} className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: 'var(--color-surface-hover)', color: l === 'qa_manager' ? 'var(--color-primary-600)' : 'var(--color-warning-600)' }}>{lvlLabel(l)}</span>)}
                    <span className="text-[11px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>{u.companies.length} compan{u.companies.length === 1 ? 'y' : 'ies'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {u.companies.map(c => (
                      <span key={c.ucr_id} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                        {c.company_name || c.company_id.slice(0, 6)} <span style={{ color: 'var(--color-text-tertiary)' }}>· {lvlLabel(c.level)}</span>
                        <button onClick={() => removeAssign(c.ucr_id)} title="Remove from this company"><X size={12} style={{ color: 'var(--color-error-600)' }} /></button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>}
      </section>
    </div>
  );
}

// ── assign an existing user to a company as a QA role ────────────────────────
function AssignExisting({ companies, onDone }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [picked, setPicked] = useState(null);
  const [companyId, setCompanyId] = useState('');
  const [level, setLevel] = useState('qa_agent');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (picked || q.trim().length < 2) { setHits([]); return; }
    let dead = false; const t = setTimeout(() => client.get('qa/admin/user-search', { params: { q } }).then(r => { if (!dead) setHits(r.data.users || []); }).catch(() => {}), 250);
    return () => { dead = true; clearTimeout(t); };
  }, [q, picked]);

  const assign = async () => {
    if (!picked || !companyId) return toast.error('Pick a user and a company');
    setBusy(true);
    try { await client.post('qa/admin/assign', { user_id: picked.user_id, company_id: companyId, level }); toast.success(`Assigned ${picked.name} as QA ${level === 'qa_manager' ? 'manager' : 'agent'}`); setPicked(null); setQ(''); onDone(); }
    catch (e) { toast.error(e.response?.data?.error || 'Assign failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Assign an existing user (multi-company)</div>
      {picked ? (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: 'var(--color-surface-hover)' }}>
          <Check size={14} style={{ color: 'var(--color-success-600)' }} /><span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{picked.name}</span>
          <button onClick={() => { setPicked(null); setQ(''); }}><X size={14} style={{ color: 'var(--color-text-tertiary)' }} /></button>
        </div>
      ) : (
        <div className="relative">
          <div className="flex items-center gap-1.5 px-2 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <Search size={13} style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search user by name…" style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--color-text)', fontSize: 13, padding: '6px 2px', width: '100%' }} />
          </div>
          {hits.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg max-h-44 overflow-auto" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
              {hits.map(h => <button key={h.user_id} onClick={() => { setPicked(h); setHits([]); }} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-surface-hover" style={{ color: 'var(--color-text)' }}>{h.name}</button>)}
            </div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <select value={companyId} onChange={e => setCompanyId(e.target.value)} style={{ ...inp, flex: 1 }}><option value="">Company…</option>{companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={level} onChange={e => setLevel(e.target.value)} style={inp}><option value="qa_agent">Agent</option><option value="qa_manager">Manager</option></select>
      </div>
      <button onClick={assign} disabled={busy || !picked || !companyId} className="w-full px-3 py-2 rounded-lg text-xs font-bold text-white" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: (busy || !picked || !companyId) ? 0.5 : 1 }}>{busy ? 'Assigning…' : 'Assign to company'}</button>
      <div className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Assign the same person to several companies by repeating with a different company.</div>
    </div>
  );
}

// ── create a brand-new QA manager/agent + assign to companies ────────────────
function CreateQaUser({ companies, onDone }) {
  const [f, setF] = useState({ email: '', full_name: '', password: '', level: 'qa_agent' });
  const [cids, setCids] = useState([]);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(o => ({ ...o, [k]: v }));
  const toggleCo = (id) => setCids(cs => cs.includes(id) ? cs.filter(x => x !== id) : [...cs, id]);

  const create = async () => {
    if (!f.email || !f.full_name) return toast.error('Email and name required');
    setBusy(true);
    try {
      const r = await client.post('qa/admin/users', { ...f, company_ids: cids });
      toast.success(`Created QA ${f.level === 'qa_manager' ? 'manager' : 'agent'}${r.data.generated_password ? ` — temp password: ${r.data.generated_password}` : ''}`, { duration: r.data.generated_password ? 12000 : 4000 });
      setF({ email: '', full_name: '', password: '', level: f.level }); setCids([]); onDone();
    } catch (e) { toast.error(e.response?.data?.error || 'Create failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-3 rounded-xl space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}><UserPlus size={13} /> Create a QA person</div>
      <div className="flex gap-2">
        <input value={f.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Full name" style={{ ...inp, flex: 1 }} />
        <select value={f.level} onChange={e => set('level', e.target.value)} style={inp}><option value="qa_agent">Agent</option><option value="qa_manager">Manager</option></select>
      </div>
      <input value={f.email} onChange={e => set('email', e.target.value)} placeholder="Email" style={{ ...inp, width: '100%' }} />
      <input value={f.password} onChange={e => set('password', e.target.value)} placeholder="Password (optional — auto-generated if blank)" style={{ ...inp, width: '100%' }} />
      <div>
        <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--color-text-tertiary)' }}>Companies</div>
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-auto">
          {companies.map(c => <button key={c.id} onClick={() => toggleCo(c.id)} className="text-[11px] px-2 py-1 rounded-lg" style={cids.includes(c.id) ? { background: 'var(--color-primary-100, #e0e7ff)', color: 'var(--color-primary-700, #4338ca)', border: '1px solid var(--color-primary-300, #c7d2fe)' } : { background: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{c.name}</button>)}
        </div>
      </div>
      <button onClick={create} disabled={busy || !f.email || !f.full_name} className="w-full px-3 py-2 rounded-lg text-xs font-bold text-white" style={{ background: 'var(--gradient-sidebar, linear-gradient(135deg,#2563eb,#7c3aed))', opacity: (busy || !f.email || !f.full_name) ? 0.5 : 1 }}>{busy ? 'Creating…' : 'Create QA person'}</button>
    </div>
  );
}
