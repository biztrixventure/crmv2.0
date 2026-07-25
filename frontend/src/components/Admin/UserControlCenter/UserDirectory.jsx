// UserDirectory — the "pick a user" surface for the User Control Center, built
// as a browsable directory that fills the page:
//   • a global search on top (any user, any company — /distribution-batches/recipients)
//   • Chrome tabs = companies (GET /companies)
//   • role sub-tabs = the roles present in the active company (with counts)
//   • a responsive grid of user cards → click to open that user
// Superadmin-only surface (the whole tab is gated in AdminPanel).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Loader2, Users, Building2, X, Circle } from 'lucide-react';
import client from '../../../api/client';
import ChromeTabs from '../../UI/ChromeTabs';

const LEVEL_COLOR = {
  superadmin: 'var(--color-primary)', readonly_admin: '#8b5cf6',
  compliance_manager: '#f59e0b', company_admin: 'var(--color-error-500)',
  operations_manager: 'var(--color-info-500)', closer_manager: '#10b981',
  fronter_manager: '#10b981', qa_manager: '#0ea5e9', qa_agent: '#0ea5e9',
  closer: '#6b7280', fronter: '#6b7280',
};
// Highest authority → lowest, for ordering the role sub-tabs.
const ROLE_ORDER = ['company_admin', 'operations_manager', 'compliance_manager', 'closer_manager', 'fronter_manager', 'qa_manager', 'closer', 'fronter', 'qa_agent', 'readonly_admin', 'superadmin'];
const roleRank = (r) => { const i = ROLE_ORDER.indexOf(r); return i === -1 ? 99 : i; };
const prettyRole = (r) => String(r || '').replace(/_/g, ' ');
const initialsOf = (u) => (u.first_name?.[0] || u.name?.[0] || u.email?.[0] || '?').toUpperCase();
const nameOf = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || u.name || u.email || '(unnamed)';

export default function UserDirectory({ onSelect }) {
  const [companies, setCompanies]   = useState([]);
  const [activeCo, setActiveCo]     = useState(null);
  const [users, setUsers]           = useState([]);       // active company's users
  const [role, setRole]             = useState('all');
  const [q, setQ]                   = useState('');
  const [results, setResults]       = useState(null);     // global search results (or null)
  const [loadingCo, setLoadingCo]   = useState(true);
  const [loadingU, setLoadingU]     = useState(false);
  const [searching, setSearching]   = useState(false);

  // companies
  useEffect(() => {
    setLoadingCo(true);
    client.get('companies')
      .then(r => { const c = r.data.companies || r.data || []; setCompanies(c); setActiveCo(c[0]?.id || null); })
      .catch(() => setCompanies([]))
      .finally(() => setLoadingCo(false));
  }, []);

  // users for the active company
  useEffect(() => {
    if (!activeCo) { setUsers([]); return; }
    setLoadingU(true); setRole('all');
    client.get('users', { params: { company_id: activeCo, include_inactive: true } })
      .then(r => setUsers(r.data.users || []))
      .catch(() => setUsers([]))
      .finally(() => setLoadingU(false));
  }, [activeCo]);

  // global search (debounced)
  const runSearch = useCallback(async (term) => {
    if (!term.trim()) { setResults(null); setSearching(false); return; }
    setSearching(true);
    try { const r = await client.get('distribution-batches/recipients', { params: { q: term } }); setResults(r.data.users || []); }
    catch { setResults([]); } finally { setSearching(false); }
  }, []);
  useEffect(() => { const t = setTimeout(() => runSearch(q), 250); return () => clearTimeout(t); }, [q, runSearch]);

  // role sub-tabs from the loaded company users (+ counts)
  const roleTabs = useMemo(() => {
    const counts = {};
    users.forEach(u => { counts[u.role_level] = (counts[u.role_level] || 0) + 1; });
    const tabs = Object.keys(counts).sort((a, b) => roleRank(a) - roleRank(b))
      .map(lvl => ({ key: lvl, label: prettyRole(lvl), count: counts[lvl] }));
    return [{ key: 'all', label: 'All', count: users.length }, ...tabs];
  }, [users]);

  const shown = useMemo(() => {
    if (results) return results;                 // global search overrides
    return role === 'all' ? users : users.filter(u => u.role_level === role);
  }, [results, users, role]);

  const activeCompany = companies.find(c => c.id === activeCo);

  return (
    <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 220px)' }}>
      {/* Global search */}
      <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search any user across all companies by name…"
          className="w-full text-sm rounded-xl pl-10 pr-9 py-2.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
        {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }}><X size={15} /></button>}
        {searching && <Loader2 size={15} className="absolute right-9 top-1/2 -translate-y-1/2 animate-spin" style={{ color: 'var(--color-primary-600)' }} />}
      </div>

      {results ? (
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-text-secondary flex items-center gap-1.5">
          <Users size={13} /> {results.length} match{results.length === 1 ? '' : 'es'} across all companies
        </div>
      ) : (
        <>
          {/* Company chrome tabs */}
          {loadingCo ? (
            <div className="py-4"><Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>
          ) : companies.length === 0 ? (
            <div className="text-sm text-text-secondary py-4">No companies found.</div>
          ) : (
            <ChromeTabs variant="chrome" value={activeCo} onChange={setActiveCo}
              items={companies.map(c => ({ key: c.id, label: c.name, icon: Building2 }))} />
          )}

          {/* Role sub-tabs */}
          {!loadingCo && companies.length > 0 && (
            <div className="flex items-center gap-1.5 mt-3 flex-wrap">
              {roleTabs.map(t => {
                const on = role === t.key;
                const col = t.key === 'all' ? 'var(--color-primary-600)' : (LEVEL_COLOR[t.key] || '#6b7280');
                return (
                  <button key={t.key} onClick={() => setRole(t.key)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                    style={{ background: on ? col + '22' : 'var(--color-surface)', color: on ? col : 'var(--color-text-secondary)', border: `1px solid ${on ? col : 'var(--color-border)'}` }}>
                    {t.label}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: on ? col + '33' : 'var(--color-bg-secondary)' }}>{t.count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* User grid */}
      <div className="flex-1 overflow-y-auto mt-3 -mx-1 px-1">
        {(loadingU && !results) ? (
          <div className="flex justify-center py-16"><Loader2 size={26} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16 text-sm text-text-secondary">
            <Users size={34} className="mx-auto mb-2 opacity-40" />
            {results ? 'No users match your search.' : `No users in ${activeCompany?.name || 'this company'}${role !== 'all' ? ` with role ${prettyRole(role)}` : ''}.`}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pb-4">
            {shown.map(u => {
              const uid = results ? u.id : u.user_id;   // recipients: id=user_id; /users: user_id
              const lvl = u.role_level || u.role;
              const col = LEVEL_COLOR[lvl] || '#6b7280';
              const inactive = results ? false : u.is_active === false;
              return (
                <button key={(results ? 'r' : 'c') + uid} onClick={() => onSelect(uid)}
                  className="text-left rounded-xl p-3 flex items-center gap-3 transition-all hover:-translate-y-0.5"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', opacity: inactive ? 0.6 : 1, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}>
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
                    style={{ background: 'var(--gradient-sidebar, var(--color-primary-600))' }}>
                    {initialsOf(u)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{nameOf(u)}</span>
                      {inactive && <Circle size={7} fill="var(--color-error-500)" style={{ color: 'var(--color-error-500)' }} />}
                    </div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>{u.email || (results ? u.company_name : activeCompany?.name) || '—'}</div>
                    <span className="inline-block mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: col + '22', color: col }}>{prettyRole(lvl)}{results && u.company_name ? ` · ${u.company_name}` : ''}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
