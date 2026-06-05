import { useEffect, useMemo, useState } from 'react';
import {
  Shield, Plus, Trash2, Save, Check, X, RotateCcw, AlertTriangle, Mail, User as UserIcon, Eye, EyeOff, Info, Lock,
} from 'lucide-react';
import client from '../../../api/client';

/*
 * ReadonlyAdminManager
 *
 * SuperAdmin-only screen for managing readonly_admin users. Shows the
 * count, lists every recognized RO user with their grant source
 * (env / metadata / role assignment), and lets the operator:
 *   - create a new readonly_admin (auth user + role + initial nav)
 *   - toggle which sidebar tabs each RO user sees
 *   - revoke the role (env-stamped users need an env change too)
 *
 * Tab catalog mirrors the AdminPanel nav so the toggle matrix matches
 * what the user actually sees. Keep this list in sync with the navItems
 * array in pages/AdminPanel.jsx.
 */

// Catalog of sidebar tab IDs available to a readonly_admin. Mirrors the
// SA superset from AdminPanel.jsx. Each entry: { id, label, group, default }.
// `default: true` is preselected when creating a new RO.
const TAB_CATALOG = [
  { id: 'dashboard',      label: 'Dashboard',             group: 'overview', default: true },
  { id: 'calendar',       label: 'Calendar',              group: 'overview', default: true },
  { id: 'cc-sales',       label: 'All Sales',             group: 'cross_company', default: true },
  { id: 'cc-transfers',   label: 'All Transfers',         group: 'cross_company', default: true },
  { id: 'cc-callbacks',   label: 'All Callbacks',         group: 'cross_company', default: true },
  { id: 'companies',      label: 'Companies',             group: 'admin',    default: true },
  { id: 'forms',          label: 'Form Builder',          group: 'admin',    default: false },
  { id: 'sale-search',    label: 'Lead Search',           group: 'tools',    default: true },
  { id: 'numbers',        label: 'Numbers Intelligence',  group: 'tools',    default: false },
  { id: 'data-analyzer',  label: 'Data Analyzer',         group: 'tools',    default: true },
  { id: 'faqs',           label: 'FAQs',                  group: 'content',  default: false },
  { id: 'scripts',        label: 'Scripts',               group: 'content',  default: false },
  { id: 'bulk-upload',    label: 'Bulk Upload',           group: 'admin',    default: false },
  { id: 'announcements',  label: 'Announcements',         group: 'content',  default: false },
  { id: 'marquee',        label: 'Marquee',               group: 'content',  default: false },
  { id: 'spiff',          label: 'SPIFF',                 group: 'admin',    default: false },
  { id: 'chat',           label: 'Chat Control',          group: 'admin',    default: false },
  { id: 'features',       label: 'Features',              group: 'admin',    default: false },
  { id: 'business-rules', label: 'Business Rules',        group: 'admin',    default: false },
];
const GROUP_LABEL = {
  overview:       'Overview',
  cross_company:  'Cross-Company',
  admin:          'Admin',
  tools:          'Tools',
  content:        'Content',
};
const DEFAULT_ALLOWED = TAB_CATALOG.filter(t => t.default).map(t => t.id);

export default function ReadonlyAdminManager() {
  const [list, setList]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');
  const [savingId, setSavingId] = useState(null);
  const [openId, setOpenId]   = useState(null);

  // Create-new form
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail]     = useState('');
  const [newPass,  setNewPass]      = useState('');
  const [newFirst, setNewFirst]     = useState('');
  const [newLast,  setNewLast]      = useState('');
  const [newAllowed, setNewAllowed] = useState(DEFAULT_ALLOWED);
  const [creating, setCreating]     = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const { data } = await client.get('readonly-admins');
      setList(data?.readonly_admins || []);
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to load readonly admins.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Mutable per-row allowed set the operator is editing. Keyed by user id.
  const [editAllowed, setEditAllowed] = useState({});
  const setRowAllowed = (id, list) => setEditAllowed(s => ({ ...s, [id]: list }));
  // When the server data changes, copy nav_allowed → editAllowed for any
  // row we don't already have a pending edit for. Lets the UI render the
  // catalog matrix immediately.
  useEffect(() => {
    setEditAllowed(prev => {
      const next = { ...prev };
      list.forEach(u => {
        if (next[u.id] === undefined) next[u.id] = u.nav_allowed || null;
      });
      return next;
    });
  }, [list]);

  const isAllowed = (id, allowed) => {
    // null = full SA parity (current behavior). When the operator clicks
    // a checkbox we materialize the full set first so untoggles persist.
    if (allowed === null) return true;
    return Array.isArray(allowed) && allowed.includes(id);
  };
  const toggleTab = (userId, tabId) => {
    const current = editAllowed[userId];
    // Materialize null → full SA superset before the first edit so any
    // checkbox click produces a concrete persistable list.
    const base = current === null ? TAB_CATALOG.map(t => t.id) : (current || []);
    const next = base.includes(tabId) ? base.filter(x => x !== tabId) : [...base, tabId];
    setRowAllowed(userId, next);
  };
  const resetToDefaults = (userId) => setRowAllowed(userId, DEFAULT_ALLOWED);
  const fullAccess     = (userId) => setRowAllowed(userId, TAB_CATALOG.map(t => t.id));
  const noAccess       = (userId) => setRowAllowed(userId, ['dashboard']); // never strip the landing

  const saveRow = async (userId) => {
    setSavingId(userId);
    try {
      const allowed = editAllowed[userId] || [];
      await client.put(`readonly-admins/${userId}/nav`, { allowed });
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || 'Save failed.');
    } finally {
      setSavingId(null);
    }
  };

  const revoke = async (userId, email) => {
    if (!window.confirm(`Revoke readonly_admin from ${email}?\n\nTheir role is removed. The auth user is preserved — you can re-grant later without re-inviting. If they were stamped via READONLY_ADMIN_EMAIL, also remove their email from that env var or they'll be re-stamped on next restart.`)) return;
    setSavingId(userId);
    try {
      await client.delete(`readonly-admins/${userId}`);
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || 'Revoke failed.');
    } finally {
      setSavingId(null);
    }
  };

  const doCreate = async (e) => {
    e?.preventDefault?.();
    if (!newEmail || !newPass) { setErr('Email + password required.'); return; }
    setCreating(true); setErr('');
    try {
      await client.post('readonly-admins', {
        email: newEmail, password: newPass,
        first_name: newFirst, last_name: newLast,
        allowed: newAllowed,
      });
      setNewEmail(''); setNewPass(''); setNewFirst(''); setNewLast('');
      setNewAllowed(DEFAULT_ALLOWED);
      setShowCreate(false);
      await load();
    } catch (e) {
      setErr(e.response?.data?.error || 'Create failed.');
    } finally {
      setCreating(false);
    }
  };

  const groupedCatalog = useMemo(() => {
    const m = new Map();
    TAB_CATALOG.forEach(t => { (m.get(t.group) || m.set(t.group, []).get(t.group)).push(t); });
    return [...m.entries()];
  }, []);

  return (
    <div className="space-y-5 animate-fade-in max-w-5xl">
      {/* Hero */}
      <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: 'var(--gradient-sidebar)' }}>
        <div className="relative z-10 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Shield size={22} className="text-white" />
            <div>
              <h2 className="text-xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Readonly Admins</h2>
              <p className="text-sm text-white/80">
                Audit accounts with SuperAdmin visibility but zero write access. Backend blocks every POST/PUT/DELETE for this role.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5"
              style={{ backgroundColor: 'rgba(255,255,255,0.22)', color: 'white' }}>
              {list.length} active
            </span>
            <button onClick={() => setShowCreate(s => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border"
              style={{ borderColor: 'rgba(255,255,255,0.4)', color: 'white', background: 'rgba(255,255,255,0.12)' }}>
              <Plus size={14} /> {showCreate ? 'Close' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      {/* Env env-stamp helper note */}
      <div className="rounded-xl p-3 text-xs flex items-start gap-2"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>
          Two ways to grant readonly_admin: <strong>env</strong> (add to <code>READONLY_ADMIN_EMAIL</code>, comma-separated, then restart backend — auto-stamps on boot) or <strong>create</strong> on this page (auth user + role + initial sidebar set). Either way, <code>readonlyGuard</code> middleware enforces no-writes.
        </span>
      </div>

      {err && <div className="rounded-xl p-3 text-xs flex items-start gap-2" style={{ backgroundColor: 'var(--color-error-50, #fef2f2)', color: 'var(--color-error-700, #b91c1c)', border: '1px solid var(--color-error-200, #fecaca)' }}><AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{err}</div>}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={doCreate} className="rounded-2xl p-5 space-y-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>Create readonly admin</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Email</label>
              <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                className="input text-sm w-full" placeholder="readonly@yourco.com" required />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Temp password</label>
              <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)}
                className="input text-sm w-full" placeholder="≥8 chars" minLength={8} required />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>First name</label>
              <input value={newFirst} onChange={e => setNewFirst(e.target.value)} className="input text-sm w-full" />
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-1 block" style={{ color: 'var(--color-text-secondary)' }}>Last name</label>
              <input value={newLast} onChange={e => setNewLast(e.target.value)} className="input text-sm w-full" />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>Initial sidebar tabs</label>
            <div className="rounded-lg p-2 grid grid-cols-2 md:grid-cols-3 gap-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {TAB_CATALOG.map(t => {
                const checked = newAllowed.includes(t.id);
                return (
                  <label key={t.id} className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
                    <input type="checkbox" checked={checked}
                      onChange={() => setNewAllowed(s => checked ? s.filter(x => x !== t.id) : [...s, t.id])} />
                    {t.label}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={creating}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {creating ? '…' : <><Plus size={14} /> Create</>}
            </button>
            <button type="button" onClick={() => setShowCreate(false)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="space-y-3">
        {loading && <p className="text-sm text-center py-6 italic" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>}
        {!loading && list.length === 0 && (
          <p className="text-sm text-center py-6 italic" style={{ color: 'var(--color-text-secondary)' }}>
            No readonly admins yet. Use Add above or set the <code>READONLY_ADMIN_EMAIL</code> env var.
          </p>
        )}
        {list.map(u => {
          const expanded = openId === u.id;
          const allowed = editAllowed[u.id] === undefined ? u.nav_allowed : editAllowed[u.id];
          const dirty = JSON.stringify(allowed || []) !== JSON.stringify(u.nav_allowed || []);
          return (
            <div key={u.id} className="rounded-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <button onClick={() => setOpenId(expanded ? null : u.id)}
                className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-bg-secondary transition-colors flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--color-bg-secondary)' }}>
                    <UserIcon size={16} style={{ color: 'var(--color-primary-600)' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>
                      {u.name || u.email}
                    </p>
                    <p className="text-[11px] flex items-center gap-1.5 truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                      <Mail size={10} /> {u.email}
                      {u.last_sign_in && <> · last login {new Date(u.last_sign_in).toLocaleDateString()}</>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                  {u.via_env && (
                    <span title="Stamped via READONLY_ADMIN_EMAIL env var" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>ENV</span>
                  )}
                  {u.via_metadata && (
                    <span title="app_metadata.role = readonly_admin" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>JWT</span>
                  )}
                  {u.via_role && (
                    <span title="Active custom_roles assignment" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: '#dcfce7', color: '#166534' }}>ROLE</span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                    {allowed === null ? 'All tabs' : `${(allowed || []).length} tabs`}
                  </span>
                </div>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex items-center gap-2 pt-3 flex-wrap">
                    <button onClick={() => resetToDefaults(u.id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                      <RotateCcw size={11} /> Defaults
                    </button>
                    <button onClick={() => fullAccess(u.id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                      <Eye size={11} /> Full SA parity
                    </button>
                    <button onClick={() => noAccess(u.id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                      <EyeOff size={11} /> Dashboard only
                    </button>
                  </div>

                  <div className="space-y-2">
                    {groupedCatalog.map(([g, items]) => (
                      <div key={g}>
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{GROUP_LABEL[g] || g}</p>
                        <div className="rounded-lg p-2 grid grid-cols-2 md:grid-cols-3 gap-1.5"
                          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                          {items.map(t => {
                            const checked = isAllowed(t.id, allowed);
                            return (
                              <label key={t.id} className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
                                <input type="checkbox" checked={checked} onChange={() => toggleTab(u.id, t.id)} />
                                {t.label}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 flex-wrap">
                    <button onClick={() => revoke(u.id, u.email)}
                      disabled={savingId === u.id}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border disabled:opacity-40"
                      style={{ borderColor: 'var(--color-error-300, #fca5a5)', color: 'var(--color-error-700, #b91c1c)', backgroundColor: 'var(--color-error-50, #fef2f2)' }}>
                      <Trash2 size={12} /> Revoke
                    </button>
                    <button onClick={() => saveRow(u.id)}
                      disabled={savingId === u.id || !dirty}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40"
                      style={{ background: 'var(--gradient-sidebar)' }}>
                      <Save size={13} /> {savingId === u.id ? 'Saving…' : (dirty ? 'Save changes' : 'Saved')}
                    </button>
                  </div>

                  {u.via_env && (
                    <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--color-warning-700, #b45309)' }}>
                      <Lock size={11} className="flex-shrink-0 mt-0.5" />
                      Revoking won't be permanent: this email is in <code>READONLY_ADMIN_EMAIL</code> and will be re-stamped at next restart. Remove it from the env var too.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
