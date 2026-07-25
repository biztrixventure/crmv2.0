// ============================================================================
// UserControlCenter — SuperAdmin 360° control panel for ONE user at a time.
//
// Pick any CRM user (reuses Distribution/UserPicker → /distribution-batches/
// recipients) → a full-page detail with Chrome-style top tabs, each surfacing
// one family of per-user controls. Every control reuses an EXISTING audited
// endpoint (see backend/routes/users.js GET /users/full/:userId for the loader);
// nothing here bypasses validation. Superadmin-only (gated in AdminPanel too).
//
// The loader returns `assignments[]` (one per company), each shaped exactly like
// a GET /users list row, so the existing embeddable panels (UserPermissionsPanel,
// UserRecordViewsPanel, UserForm) work unchanged when handed one assignment.
// The company switcher chooses which assignment the company-scoped tabs act on.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import {
  UserCog, ShieldCheck, Building2, Users2, Headphones, LayoutTemplate,
  Lock, Activity, Download, Search, Loader2, RefreshCw, Mail, Clock, Circle,
} from 'lucide-react';
import client from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import { Badge } from '../../../components/UI';
import ThemedSelect from '../../UI/Select';
import UserPicker from '../../Distribution/UserPicker';
import UserPermissionsPanel from '../UserManagement/UserPermissionsPanel';
import UserRecordViewsPanel from '../UserManagement/UserRecordViewsPanel';
import AccountSection from './AccountSection';
import CompaniesRoleSection from './CompaniesRoleSection';
import TeamSection from './TeamSection';
import VicidialSection from './VicidialSection';
import GovernanceSection from './GovernanceSection';
import EgressSection from './EgressSection';
import ActivitySection from './ActivitySection';

const LEVEL_COLOR = {
  superadmin: 'var(--color-primary)', readonly_admin: '#8b5cf6',
  compliance_manager: '#f59e0b', company_admin: 'var(--color-error-500)',
  operations_manager: 'var(--color-info-500)', closer_manager: '#10b981',
  fronter_manager: '#10b981', closer: '#6b7280', fronter: '#6b7280',
};
const prettyRole = (lvl) => (lvl || '').replace(/_/g, ' ');
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'never';

// Chrome-style tab catalog. `scope:'company'` tabs act on the active assignment;
// `scope:'user'` tabs act on the auth user across companies.
const TABS = [
  { id: 'account',      label: 'Account',        icon: UserCog,        scope: 'company' },
  { id: 'companies',    label: 'Companies & Role', icon: Building2,     scope: 'user' },
  { id: 'permissions',  label: 'Permissions',    icon: ShieldCheck,    scope: 'company' },
  { id: 'teams',        label: 'Teams',          icon: Users2,         scope: 'company' },
  { id: 'vicidial',     label: 'VICIdial',       icon: Headphones,     scope: 'user' },
  { id: 'record_views', label: 'Record Views',   icon: LayoutTemplate, scope: 'company' },
  { id: 'governance',   label: 'Governance',     icon: Lock,           scope: 'user' },
  { id: 'egress',       label: 'Data Egress',    icon: Download,       scope: 'user' },
  { id: 'activity',     label: 'Activity',       icon: Activity,       scope: 'user' },
];

export default function UserControlCenter() {
  const { user: viewer } = useAuth();
  const [picked, setPicked]       = useState(null);   // { id: user_id, name, ... } from UserPicker
  const [data, setData]           = useState(null);   // { account, assignments[], primary_assignment_id }
  const [activeId, setActiveId]   = useState(null);   // active assignment id (ucr.id)
  const [tab, setTab]             = useState('account');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);

  const load = useCallback(async (userId, keepTab = false) => {
    if (!userId) return;
    setLoading(true); setError(null);
    try {
      const { data: d } = await client.get(`users/full/${userId}`);
      setData(d);
      setActiveId(prev => (keepTab && prev && d.assignments.some(a => a.id === prev)) ? prev : (d.primary_assignment_id || d.assignments[0]?.id || null));
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load user');
      setData(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (picked?.id) { setTab('account'); load(picked.id); } }, [picked?.id, load]);

  const reload = useCallback(() => load(picked?.id, true), [picked?.id, load]);

  const account     = data?.account || null;
  const assignments = data?.assignments || [];
  const activeAssignment = assignments.find(a => a.id === activeId) || assignments[0] || null;
  const isReadonlyAdmin  = assignments.some(a => a.role_level === 'readonly_admin');
  const initials = (account?.first_name?.[0] || account?.email?.[0] || '?').toUpperCase();

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* ── Title ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-text flex items-center gap-2">
            <UserCog size={24} style={{ color: 'var(--color-primary-600)' }} />
            User Control Center
          </h1>
          <p className="text-sm text-text-secondary mt-0.5">Every control for one user — account, role, permissions, teams, dialer, governance, egress, activity.</p>
        </div>
        {picked && (
          <button onClick={reload} disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Reload
          </button>
        )}
      </div>

      {/* ── Step 1: pick a user ───────────────────────────────────────────── */}
      <div className="rounded-xl p-4 mb-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-text-secondary">
          <Search size={13} /> Pick a user
        </div>
        <UserPicker value={picked} onChange={setPicked} placeholder="Search any CRM user by name…" />
      </div>

      {error && (
        <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: 'var(--color-error-50, rgba(239,68,68,0.08))', border: '1px solid var(--color-error-500)', color: 'var(--color-error-600)' }}>{error}</div>
      )}

      {loading && !data && (
        <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-primary-600)' }} /></div>
      )}

      {/* ── Step 2: detail ────────────────────────────────────────────────── */}
      {account && (
        <>
          {/* Header card */}
          <div className="rounded-xl p-5 mb-4" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-start gap-4 flex-wrap">
              <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                style={{ background: 'var(--gradient-sidebar, var(--color-primary-600))' }}>
                {account.avatar_url ? <img src={account.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover" /> : initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-text">{account.full_name || '(unnamed)'}</h2>
                  <Badge variant={account.is_active ? 'success' : 'error'}>{account.is_active ? 'Active' : 'Inactive'}</Badge>
                  {isReadonlyAdmin && <Badge variant="info">Readonly Admin</Badge>}
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-text-secondary flex-wrap">
                  <span className="flex items-center gap-1"><Mail size={13} />{account.email}</span>
                  <span className="flex items-center gap-1"><Clock size={13} />Joined {fmtDate(account.created_at)}</span>
                  <span className="flex items-center gap-1"><Circle size={9} fill="currentColor" />Last seen {fmtDateTime(account.last_sign_in_at)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {assignments.map(a => (
                    <span key={a.id} className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ background: (LEVEL_COLOR[a.role_level] || '#6b7280') + '22', color: LEVEL_COLOR[a.role_level] || '#6b7280', opacity: a.is_active ? 1 : 0.5 }}>
                      {prettyRole(a.role_level)} · {a.company_name || '—'}{a.is_active ? '' : ' (inactive)'}
                    </span>
                  ))}
                </div>
              </div>

              {/* Company-context switcher — drives the company-scoped tabs */}
              {assignments.length > 1 && (
                <div className="flex-shrink-0">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary block mb-1">Company context</label>
                  <ThemedSelect value={activeId || ''} onChange={e => setActiveId(e.target.value)} className="input min-w-[220px]">
                    {assignments.map(a => (
                      <option key={a.id} value={a.id}>{a.company_name || '—'} · {prettyRole(a.role_level)}{a.is_active ? '' : ' (inactive)'}</option>
                    ))}
                  </ThemedSelect>
                </div>
              )}
            </div>
          </div>

          {/* Chrome-style tab bar */}
          <div className="flex items-end gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--color-border)' }}>
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold whitespace-nowrap rounded-t-lg -mb-px transition-colors"
                  style={{
                    background: active ? 'var(--color-surface)' : 'transparent',
                    border: active ? '1px solid var(--color-border)' : '1px solid transparent',
                    borderBottomColor: active ? 'var(--color-surface)' : 'transparent',
                    color: active ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                  }}>
                  <Icon size={15} /> {t.label}
                  {t.scope === 'company' && assignments.length > 1 && active && (
                    <span className="text-[10px] font-medium opacity-70">· {activeAssignment?.company_name}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab body */}
          <div className="rounded-b-xl rounded-tr-xl p-5 min-h-[300px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: 'none' }}>
            {tab === 'account'      && <AccountSection account={account} assignment={activeAssignment} onChanged={reload} />}
            {tab === 'companies'    && <CompaniesRoleSection account={account} assignments={assignments} onChanged={reload} onPick={setActiveId} />}
            {tab === 'permissions'  && (activeAssignment
              ? <UserPermissionsPanel user={activeAssignment} />
              : <Empty text="No company assignment to scope permissions to." />)}
            {tab === 'teams'        && (activeAssignment
              ? <TeamSection account={account} assignment={activeAssignment} />
              : <Empty text="No company assignment." />)}
            {tab === 'vicidial'     && <VicidialSection account={account} onChanged={reload} />}
            {tab === 'record_views' && (activeAssignment
              ? <UserRecordViewsPanel user={activeAssignment} />
              : <Empty text="No company assignment." />)}
            {tab === 'governance'   && <GovernanceSection account={account} isReadonlyAdmin={isReadonlyAdmin} />}
            {tab === 'egress'       && <EgressSection account={account} activeRole={activeAssignment?.role_level} />}
            {tab === 'activity'     && <ActivitySection account={account} />}
          </div>
        </>
      )}

      {!picked && !loading && (
        <div className="text-center py-16 text-text-secondary">
          <UserCog size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Search and pick a user above to see every control for that person.</p>
        </div>
      )}
    </div>
  );
}

function Empty({ text }) {
  return <div className="text-center py-12 text-sm text-text-secondary">{text}</div>;
}
