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
//
// UI: composed from components/UI/kit (see docs/ui-design-system.md) so this tab
// looks like the Compliance shell and like every other admin tab. No local
// padding/max-width — the AdminPanel wrapper owns page padding.
// ============================================================================
import { useState, useEffect, useCallback } from 'react';
import {
  UserCog, ShieldCheck, Building2, Users2, Headphones, LayoutTemplate,
  Lock, Activity, Download, RefreshCw, Mail, Clock, Circle, ClipboardCheck, ArrowLeft, Briefcase,
  Smartphone, Layers, Search,

} from 'lucide-react';
import client from '../../../api/client';
import { useAuth } from '../../../contexts/AuthContext';
import { Badge, Alert } from '../../../components/UI';
import ThemedSelect from '../../UI/Select';
import { Panel, SectionHeader, Loading, EmptyState, PillTabs, Field } from '../../UI/kit';
import UserDirectory from './UserDirectory';
import UserPermissionsPanel from '../UserManagement/UserPermissionsPanel';
import UserRecordViewsPanel from '../UserManagement/UserRecordViewsPanel';
import AccountSection from './AccountSection';
import CompaniesRoleSection from './CompaniesRoleSection';
import TeamSection from './TeamSection';
import VicidialSection from './VicidialSection';
import ProfileVerifySection from './ProfileVerifySection';
import ProfileVerifyQueue from './ProfileVerifyQueue';
import GovernanceSection from './GovernanceSection';
import EgressSection from './EgressSection';
import ActivitySection from './ActivitySection';
import QaSection from './QaSection';
import ClientAccessSection from './ClientAccessSection';
import PwaSection from './PwaSection';
import ModulesSection from './ModulesSection';
import CustomerLookupSection from './CustomerLookupSection';

// compliance_manager is here so the QA tab shows for them: they are the users a
// superadmin designates as quality managers (mig 227), and in practice nobody
// holds the qa_manager role at all.
const QA_ROLES = ['qa_agent', 'qa_manager', 'compliance_manager'];

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
  { id: 'client_access', label: 'Client Access', icon: Briefcase,      scope: 'company' },
  { id: 'permissions',  label: 'Permissions',    icon: ShieldCheck,    scope: 'company' },
  { id: 'teams',        label: 'Teams',          icon: Users2,         scope: 'company' },
  { id: 'vicidial',     label: 'VICIdial',       icon: Headphones,     scope: 'user' },
  { id: 'record_views', label: 'Record Views',   icon: LayoutTemplate, scope: 'company' },
  { id: 'qa',           label: 'QA',             icon: ClipboardCheck, scope: 'company', qaOnly: true },
  // Notification + install overrides. `scope:'user'` — these follow the person
  // across companies, exactly like their push subscriptions do.
  { id: 'pwa',          label: 'Notifications',  icon: Smartphone,     scope: 'user' },
  // Accounting / HR designations (mig 290). scope:'user' -- a designation
  // follows the person across every company, exactly like the QA one.
  { id: 'modules',      label: 'Modules',        icon: Layers,        scope: 'user' },
  // External customer lookup — per-user switches + the service the tool calls.
  { id: 'customer_lookup', label: 'Customer Lookup', icon: Search,      scope: 'user' },
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
  const isQaUser         = assignments.some(a => QA_ROLES.includes(a.role_level));
  const visibleTabs      = TABS.filter(t => !t.qaOnly || isQaUser);
  const initials = (account?.first_name?.[0] || account?.email?.[0] || '?').toUpperCase();

  // Shared secondary-button styling for the header actions.
  const btn = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold';
  const btnStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

  return (
    <div>
      <SectionHeader
        level="page"
        icon={UserCog}
        title="User Control Center"
        subtitle="Every control for one user — account, role, permissions, teams, dialer, governance, egress, activity."
        actions={account && (
          <>
            <button onClick={() => { setPicked(null); setData(null); }} className={btn} style={btnStyle}>
              <ArrowLeft size={14} /> Directory
            </button>
            <button onClick={reload} disabled={loading} className={btn} style={btnStyle}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Reload
            </button>
          </>
        )}
      />

      {/* ── Step 1: pick a user (company → role → user directory) ──────────── */}
      {!account && !loading && (
        <>
          {/* Estate-wide verification controls live here, not inside one user's
              record: asking/stopping everyone and approving submissions are
              global actions, and burying them per-user meant opening an
              unrelated person just to reach them. */}
          <ProfileVerifyQueue />
          <UserDirectory onSelect={(uid) => setPicked({ id: uid })} />
        </>
      )}

      {error && <div className="mb-4"><Alert type="error" onDismiss={() => setError(null)}>{error}</Alert></div>}

      {loading && !data && <Loading variant="rows" rows={5} label="Loading user…" />}

      {/* ── Step 2: detail ────────────────────────────────────────────────── */}
      {account && (
        <>
          {/* Sticky zone: identity header + tab bar stay pinned while the tab
              body scrolls underneath. Opaque bg so scrolled content hides
              behind it; the negative margins bleed it to the AdminPanel
              wrapper's padding edges, so they track that padding scale. */}
          <div className="sticky top-0 z-30 -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 xl:-mx-10 xl:px-10 pt-1 pb-3"
            style={{ background: 'var(--color-bg)', boxShadow: '0 10px 20px -18px rgba(0,0,0,0.35)' }}>

            {/* Identity header */}
            <Panel className="mb-3">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0 overflow-hidden"
                  style={{ background: 'var(--gradient-sidebar, var(--color-primary-600))' }}>
                  {account.avatar_url ? <img src={account.avatar_url} alt="" className="w-12 h-12 rounded-full object-cover" /> : initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-text truncate">{account.full_name || '(unnamed)'}</h2>
                    <Badge variant={account.is_active ? 'success' : 'error'} size="sm">{account.is_active ? 'Active' : 'Inactive'}</Badge>
                    {isReadonlyAdmin && <Badge variant="info" size="sm">Readonly Admin</Badge>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[13px] text-text-secondary flex-wrap">
                    <span className="flex items-center gap-1"><Mail size={12} />{account.email}</span>
                    <span className="flex items-center gap-1"><Clock size={12} />Joined {fmtDate(account.created_at)}</span>
                    <span className="flex items-center gap-1"><Circle size={8} fill="currentColor" />Last seen {fmtDateTime(account.last_sign_in_at)}</span>
                  </div>
                </div>

                {/* Company-context switcher — drives the company-scoped tabs */}
                {assignments.length > 1 && (
                  <Field label="Company context" className="flex-shrink-0">
                    <ThemedSelect value={activeId || ''} onChange={e => setActiveId(e.target.value)} className="input min-w-[200px]">
                      {assignments.map(a => (
                        <option key={a.id} value={a.id}>{a.company_name || '—'} · {prettyRole(a.role_level)}{a.is_active ? '' : ' (inactive)'}</option>
                      ))}
                    </ThemedSelect>
                  </Field>
                )}
              </div>

              {/* Role/company chips */}
              <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
                {assignments.map(a => (
                  <button key={a.id} onClick={() => setActiveId(a.id)}
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full transition-all"
                    style={{
                      background: (LEVEL_COLOR[a.role_level] || '#6b7280') + (a.id === activeId ? '33' : '18'),
                      color: LEVEL_COLOR[a.role_level] || '#6b7280',
                      border: `1px solid ${a.id === activeId ? (LEVEL_COLOR[a.role_level] || '#6b7280') : 'transparent'}`,
                      opacity: a.is_active ? 1 : 0.5,
                    }}>
                    {prettyRole(a.role_level)} · {a.company_name || '—'}{a.is_active ? '' : ' (inactive)'}
                  </button>
                ))}
              </div>
            </Panel>

            {/* Sub-nav — the one pill tab bar (matches the Compliance sub-nav) */}
            <PillTabs
              value={tab}
              onChange={setTab}
              items={visibleTabs.map(t => ({ key: t.id, label: t.label, icon: t.icon }))}
            />
          </div>

          {/* Tab body — one standalone page card */}
          <Panel pad="lg" className="min-h-[300px] mt-3">
            {tab === 'account'      && <AccountSection account={account} assignment={activeAssignment} onChanged={reload} />}
            {tab === 'companies'    && <CompaniesRoleSection account={account} assignments={assignments} onChanged={reload} onPick={setActiveId} />}
            {tab === 'permissions'  && (activeAssignment
              ? <UserPermissionsPanel user={activeAssignment} />
              : <NoAssignment hint="Permissions are scoped to a company — assign this user to one on the Companies & Role tab first." />)}
            {tab === 'teams'        && (activeAssignment
              ? <TeamSection account={account} assignment={activeAssignment} />
              : <NoAssignment />)}
            {tab === 'vicidial'     && (
              <div className="space-y-6">
                <VicidialSection account={account} onChanged={reload} />
                {/* Asking the user themselves is the reliable way to fix a wrong
                    dialer id — they know their own login. Lives here rather than
                    in a new tab so stored readonly-admin tab governance stays valid. */}
                <div className="pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <ProfileVerifySection account={account} onChanged={reload} />
                </div>
              </div>
            )}
            {tab === 'record_views' && (activeAssignment
              ? <UserRecordViewsPanel user={activeAssignment} />
              : <NoAssignment />)}
            {tab === 'client_access' && (activeAssignment
              ? <ClientAccessSection account={account} assignment={activeAssignment} />
              : <NoAssignment />)}
            {tab === 'qa'           && (activeAssignment
              ? <QaSection account={account} assignment={activeAssignment} />
              : <NoAssignment />)}
            {tab === 'pwa'          && <PwaSection account={account} />}
            {tab === 'modules'      && <ModulesSection account={account} />}
            {tab === 'customer_lookup' && <CustomerLookupSection account={account} />}
            {tab === 'governance'   && <GovernanceSection account={account} isReadonlyAdmin={isReadonlyAdmin} />}
            {tab === 'egress'       && <EgressSection account={account} assignment={activeAssignment} />}
            {tab === 'activity'     && <ActivitySection account={account} />}
          </Panel>
        </>
      )}

    </div>
  );
}

function NoAssignment({ hint }) {
  return (
    <EmptyState
      icon={Building2}
      title="No company assignment"
      hint={hint || 'Assign this user to a company on the Companies & Role tab first.'}
    />
  );
}
