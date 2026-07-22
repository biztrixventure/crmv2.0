import { useEffect, useMemo, useState } from 'react';
import {
  Shield, Plus, Trash2, Save, RotateCcw, AlertTriangle, Mail, User as UserIcon,
  Eye, EyeOff, Info, Lock, Send, Skull, Building2, Download, Activity, ChevronDown, Sliders,
} from 'lucide-react';
import client from '../../../api/client';
import {
  RO_ELIGIBLE_TABS, RO_PARITY_TAB_IDS, RO_DEFAULT_TAB_IDS, ADMIN_TAB_GROUPS, groupedRoTabs,
} from '../../../config/adminTabs';
import { ADMIN_CONTROLS, ALL_CONTROL_KEYS, groupedControls } from '../../../config/adminControls';

/*
 * ReadonlyAdminManager — SuperAdmin control center for every readonly_admin.
 *
 * One place to decide, per read-only admin (or as a role-wide default):
 *   • which sidebar tabs they see            (nav allowlist, from the shared
 *                                              adminTabs catalog — no drift)
 *   • which companies' data they can see      (server-enforced isolation)
 *   • what they can see vs. masked            (PII / financial / audit history)
 *   • whether they can copy anything          (no_copy → hard copy-lock)
 *   • which areas they can download           (per-area export toggles)
 *   • what they actually did                  (merged activity timeline)
 *
 * Posture is FULL PARITY, OPT-OUT: an unconfigured RO sees everything a
 * superadmin would (minus superadmin-only tabs); the operator removes access.
 */

// Capability flags. no_copy defaults FALSE (copy allowed) so a fresh RO is
// never locked out; the rest default TRUE (parity).
const FLAG_CATALOG = [
  { key: 'view_financial_data', label: 'See financial data', desc: 'Monthly + down payment amounts, revenue rollups', def: true },
  { key: 'view_pii',            label: 'See customer PII',   desc: 'Phone / email / address / name / VIN columns',  def: true },
  { key: 'view_audit_history',  label: 'See audit history',  desc: 'Expand edit_history audit trail in drawers',     def: true },
  { key: 'view_recordings',     label: 'Play call recordings', desc: 'Listen to / stream sale-call recordings',      def: true },
  { key: 'can_export',          label: 'Allow exports',      desc: 'Master switch for every CSV / Excel download',   def: true },
  { key: 'show_readonly_badge', label: 'Show read-only badge', desc: 'The "read-only admin — view only" banner on their dashboard', def: true },
  { key: 'no_copy',             label: 'Block copying',      desc: 'Disable select / copy / cut / right-click / drag', def: false },
];
const DEFAULT_FLAGS = Object.fromEntries(FLAG_CATALOG.map(f => [f.key, f.def]));

const EXPORT_AREA_LABEL = {
  sales: 'Sales', transfers: 'Transfers', callbacks: 'Callbacks',
  customer_profile: 'Customer Profiles', numbers: 'Numbers', data_analyzer: 'Data Analyzer',
  company_data: 'Company Data', chat: 'Chat Transcripts', reviews: 'QA Reviews',
};

const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export default function ReadonlyAdminManager() {
  const [list, setList]         = useState([]);
  const [companies, setCompanies] = useState([]);
  const [exportAreas, setExportAreas] = useState([]);
  const [roleDefaults, setRoleDefaults] = useState(null);
  const [loading, setLoading]   = useState(false);
  const [err, setErr]           = useState('');
  const [savingId, setSavingId] = useState(null);
  const [openId, setOpenId]     = useState(null);

  // Create-new form
  const [showCreate, setShowCreate] = useState(false);
  const [nf, setNf] = useState({ email: '', pass: '', first: '', last: '', invite: false });
  const [newAllowed, setNewAllowed]   = useState(RO_DEFAULT_TAB_IDS);
  const [newFlags, setNewFlags]       = useState(DEFAULT_FLAGS);
  const [newCompanies, setNewCompanies] = useState(null);  // null = all
  const [creating, setCreating]       = useState(false);

  // Per-row edit state, keyed by user id.
  const [edit, setEdit] = useState({});   // { [id]: { allowed, flags, companies, export } }
  const [activity, setActivity] = useState({});  // { [id]: rows[] }
  const [showDefaults, setShowDefaults] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const [{ data }, cos] = await Promise.all([
        client.get('readonly-admins'),
        client.get('companies').catch(() => ({ data: [] })),
      ]);
      setList(data?.readonly_admins || []);
      setExportAreas(data?.export_areas || Object.keys(EXPORT_AREA_LABEL));
      setRoleDefaults(data?.role_defaults || null);
      const rawCos = Array.isArray(cos.data) ? cos.data : (cos.data?.companies || []);
      setCompanies(rawCos.map(c => ({ id: c.id, name: c.name })).filter(c => c.id));
    } catch (e) {
      setErr(e.response?.data?.error || 'Failed to load readonly admins.');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // Seed per-row edit state when server data arrives (don't clobber pending edits).
  useEffect(() => {
    setEdit(prev => {
      const next = { ...prev };
      list.forEach(u => {
        if (next[u.id] === undefined) next[u.id] = {
          allowed:   u.nav_allowed || null,
          flags:     { ...DEFAULT_FLAGS, ...(u.flags || {}) },
          companies: u.companies || null,
          export:    { ...(u.export || {}) },
          controls:  Array.isArray(u.controls) ? u.controls : [],   // disabled action keys
        };
      });
      return next;
    });
  }, [list]);

  const setRow = (id, patch) => setEdit(s => ({ ...s, [id]: { ...(s[id] || {}), ...patch } }));

  // ── tab helpers ────────────────────────────────────────────────────────────
  const toggleTab = (id, tabId) => {
    const cur = edit[id]?.allowed;
    const base = cur === null ? RO_PARITY_TAB_IDS.slice() : (cur || []);
    const next = base.includes(tabId) ? base.filter(x => x !== tabId) : [...base, tabId];
    setRow(id, { allowed: next });
  };

  // ── company helpers ──────────────────────────────────────────────────────
  const toggleCompany = (id, cid) => {
    const cur = edit[id]?.companies;
    const base = cur === null ? companies.map(c => c.id) : (cur || []);
    const next = base.includes(cid) ? base.filter(x => x !== cid) : [...base, cid];
    setRow(id, { companies: next });
  };

  // controls: `disabled` is the list of hidden action keys. Toggling a control
  // adds/removes its key from that list (checked = allowed/visible).
  const toggleControl = (id, key) => {
    const cur = edit[id]?.controls || [];
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    setRow(id, { controls: next });
  };
  const setAllControls = (id, disableAll) => setRow(id, { controls: disableAll ? [...ALL_CONTROL_KEYS] : [] });

  // ── save one RO ─────────────────────────────────────────────────────────
  const saveRow = async (id) => {
    setSavingId(id); setErr('');
    const e = edit[id] || {};
    const u = list.find(x => x.id === id) || {};
    const server = { allowed: u.nav_allowed || null, flags: { ...DEFAULT_FLAGS, ...(u.flags || {}) }, companies: u.companies || null, export: { ...(u.export || {}) }, controls: Array.isArray(u.controls) ? u.controls : [] };
    // Only persist facets the operator actually changed. This is critical: an
    // unconditional write would (a) stamp a full per-user flags/export override
    // that clobbers the role-default template, and (b) coerce a parity null nav
    // to [] → Dashboard-only lockout. We also never write a null nav (parity is
    // represented by the key being absent); the companies PUT handles null itself.
    const puts = [];
    if (!eq(e.allowed, server.allowed) && Array.isArray(e.allowed)) puts.push(client.put(`readonly-admins/${id}/nav`, { allowed: e.allowed }));
    if (!eq(e.flags, server.flags))         puts.push(client.put(`readonly-admins/${id}/flags`,     { flags: e.flags }));
    if (!eq(e.companies, server.companies)) puts.push(client.put(`readonly-admins/${id}/companies`, { companies: e.companies }));
    if (!eq(e.export, server.export))       puts.push(client.put(`readonly-admins/${id}/export`,    { export: e.export }));
    if (!eq(e.controls || [], server.controls)) puts.push(client.put(`readonly-admins/${id}/controls`, { controls: e.controls || [] }));
    try {
      await Promise.all(puts);
      await load();
    } catch (er) {
      setErr(er.response?.data?.error || 'Save failed.');
    } finally { setSavingId(null); }
  };

  const loadActivity = async (id) => {
    try {
      const { data } = await client.get(`readonly-admins/${id}/activity`, { params: { limit: 100 } });
      setActivity(s => ({ ...s, [id]: data?.activity || [] }));
    } catch { setActivity(s => ({ ...s, [id]: [] })); }
  };

  const revoke = async (id, email) => {
    if (!window.confirm(`Revoke readonly_admin from ${email}?\n\nRole removed; auth user preserved (re-grant later without re-inviting). If stamped via READONLY_ADMIN_EMAIL, also remove them from that env var.`)) return;
    setSavingId(id);
    try { await client.delete(`readonly-admins/${id}`); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Revoke failed.'); }
    finally { setSavingId(null); }
  };
  const permanentDelete = async (id, email) => {
    if (!window.confirm(`PERMANENTLY delete ${email}?\n\nRemoves the auth user entirely. Irreversible.`)) return;
    if (window.prompt(`Type the email exactly to confirm:\n${email}`) !== email) { setErr('Email did not match. Cancelled.'); return; }
    setSavingId(id);
    try { await client.delete(`readonly-admins/${id}?permanent=true`); await load(); }
    catch (e) { setErr(e.response?.data?.error || 'Permanent delete failed.'); }
    finally { setSavingId(null); }
  };

  const doCreate = async (ev) => {
    ev?.preventDefault?.();
    if (!nf.email) { setErr('Email required.'); return; }
    if (!nf.invite && !nf.pass) { setErr('Password required (or check "Send invite email").'); return; }
    setCreating(true); setErr('');
    try {
      await client.post('readonly-admins', {
        email: nf.email, password: nf.invite ? undefined : nf.pass, send_invite: nf.invite,
        first_name: nf.first, last_name: nf.last,
        allowed: newAllowed, flags: newFlags, companies: newCompanies,
      });
      setNf({ email: '', pass: '', first: '', last: '', invite: false });
      setNewAllowed(RO_DEFAULT_TAB_IDS); setNewFlags(DEFAULT_FLAGS); setNewCompanies(null);
      setShowCreate(false);
      await load();
    } catch (e) { setErr(e.response?.data?.error || 'Create failed.'); }
    finally { setCreating(false); }
  };

  const groupedTabs = useMemo(() => groupedRoTabs(), []);

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
                Full SuperAdmin visibility, zero writes — governed per person: tabs, companies, masked fields, exports, copy-lock, and an activity log.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold" style={{ backgroundColor: 'rgba(255,255,255,0.22)', color: 'white' }}>{list.length} active</span>
            <button onClick={() => setShowDefaults(s => !s)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border" style={{ borderColor: 'rgba(255,255,255,0.4)', color: 'white', background: 'rgba(255,255,255,0.12)' }}>
              <Sliders size={14} /> Role defaults
            </button>
            <button onClick={() => setShowCreate(s => !s)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold border" style={{ borderColor: 'rgba(255,255,255,0.4)', color: 'white', background: 'rgba(255,255,255,0.12)' }}>
              <Plus size={14} /> {showCreate ? 'Close' : 'Add'}
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-xl p-3 text-xs flex items-start gap-2" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
        <Info size={13} className="flex-shrink-0 mt-0.5" />
        <span>Every control here is <strong>server-enforced</strong> (company scope + PII/financial masking + export gates) and takes effect on the RO's next load. Frontend hiding is only the polish — a hidden tab or button can't be re-enabled via devtools. Missing config = full parity.</span>
      </div>

      {err && <div className="rounded-xl p-3 text-xs flex items-start gap-2" style={{ backgroundColor: 'var(--color-error-50, #fef2f2)', color: 'var(--color-error-700, #b91c1c)', border: '1px solid var(--color-error-200, #fecaca)' }}><AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />{err}</div>}

      {showDefaults && <RoleDefaultsPanel initial={roleDefaults} companies={companies} exportAreas={exportAreas} groupedTabs={groupedTabs} onSaved={() => { setShowDefaults(false); load(); }} onError={setErr} />}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={doCreate} className="rounded-2xl p-5 space-y-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-secondary)' }}>Create readonly admin</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Email"><input type="email" value={nf.email} onChange={e => setNf(s => ({ ...s, email: e.target.value }))} className="input text-sm w-full" placeholder="readonly@yourco.com" required /></Field>
            <Field label={nf.invite ? 'Password (invite link emailed)' : 'Temp password'}>
              <input type="password" value={nf.pass} onChange={e => setNf(s => ({ ...s, pass: e.target.value }))} className="input text-sm w-full" placeholder={nf.invite ? '— skipped —' : '≥8 chars'} minLength={nf.invite ? 0 : 8} disabled={nf.invite} required={!nf.invite} />
              <label className="flex items-center gap-1.5 mt-2 cursor-pointer text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                <input type="checkbox" checked={nf.invite} onChange={e => setNf(s => ({ ...s, invite: e.target.checked }))} /><Send size={11} /> Send invite email
              </label>
            </Field>
            <Field label="First name"><input value={nf.first} onChange={e => setNf(s => ({ ...s, first: e.target.value }))} className="input text-sm w-full" /></Field>
            <Field label="Last name"><input value={nf.last} onChange={e => setNf(s => ({ ...s, last: e.target.value }))} className="input text-sm w-full" /></Field>
          </div>
          <Field label="Initial sidebar tabs">
            <TabMatrix grouped={groupedTabs} allowed={newAllowed} onToggle={(tid) => setNewAllowed(s => s.includes(tid) ? s.filter(x => x !== tid) : [...s, tid])} />
          </Field>
          <Field label="Permission flags">
            <div className="rounded-lg p-2 space-y-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
              {FLAG_CATALOG.map(f => (
                <label key={f.key} className="flex items-start gap-2 cursor-pointer text-xs">
                  <input type="checkbox" className="mt-0.5" checked={newFlags[f.key] === true} onChange={() => setNewFlags(s => ({ ...s, [f.key]: !s[f.key] }))} />
                  <span><strong>{f.label}</strong><span style={{ color: 'var(--color-text-tertiary)' }}> · {f.desc}</span></span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="Company scope (unchecked all = every company)">
            <CompanyMatrix companies={companies} selected={newCompanies} onToggle={(cid) => setNewCompanies(s => {
              const base = s === null ? companies.map(c => c.id) : s;
              return base.includes(cid) ? base.filter(x => x !== cid) : [...base, cid];
            })} onAll={() => setNewCompanies(null)} onNone={() => setNewCompanies([])} />
          </Field>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={creating} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40" style={{ background: 'var(--gradient-sidebar)' }}>{creating ? '…' : <><Plus size={14} /> Create</>}</button>
            <button type="button" onClick={() => setShowCreate(false)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Cancel</button>
          </div>
        </form>
      )}

      {/* List */}
      <div className="space-y-3">
        {loading && <p className="text-sm text-center py-6 italic" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>}
        {!loading && list.length === 0 && (
          <p className="text-sm text-center py-6 italic" style={{ color: 'var(--color-text-secondary)' }}>No readonly admins yet. Use Add above or set the <code>READONLY_ADMIN_EMAIL</code> env var.</p>
        )}
        {list.map(u => {
          const e = edit[u.id] || {};
          const expanded = openId === u.id;
          const server = { allowed: u.nav_allowed || null, flags: { ...DEFAULT_FLAGS, ...(u.flags || {}) }, companies: u.companies || null, export: { ...(u.export || {}) }, controls: Array.isArray(u.controls) ? u.controls : [] };
          const dirty = !eq(e.allowed, server.allowed) || !eq(e.flags, server.flags) || !eq(e.companies, server.companies) || !eq(e.export, server.export) || !eq(e.controls || [], server.controls);
          return (
            <div key={u.id} className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <button onClick={() => { const willOpen = !expanded; setOpenId(willOpen ? u.id : null); if (willOpen && !activity[u.id]) loadActivity(u.id); }}
                className="w-full p-4 flex items-center justify-between gap-3 text-left hover:bg-bg-secondary transition-colors flex-wrap">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--color-bg-secondary)' }}><UserIcon size={16} style={{ color: 'var(--color-primary-600)' }} /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>{u.name || u.email}</p>
                    <p className="text-[11px] flex items-center gap-1.5 truncate" style={{ color: 'var(--color-text-tertiary)' }}><Mail size={10} /> {u.email}{u.last_sign_in && <> · last login {new Date(u.last_sign_in).toLocaleDateString()}</>}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                  {u.via_env && <Badge color="#fef3c7" text="#92400e" title="READONLY_ADMIN_EMAIL env">ENV</Badge>}
                  {u.via_role && <Badge color="#dcfce7" text="#166534" title="custom_roles assignment">ROLE</Badge>}
                  <Badge color="var(--color-bg-secondary)" text="var(--color-text-secondary)">{(e.allowed ?? server.allowed) === null ? 'All tabs' : `${(e.allowed || []).length} tabs`}</Badge>
                  <Badge color="var(--color-bg-secondary)" text="var(--color-text-secondary)">{(e.companies ?? server.companies) === null ? 'All cos' : `${(e.companies || []).length} cos`}</Badge>
                  {dirty && <Badge color="#fef9c3" text="#854d0e">unsaved</Badge>}
                  <ChevronDown size={16} style={{ color: 'var(--color-text-tertiary)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                </div>
              </button>

              {expanded && (
                <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
                  {/* Tabs */}
                  <Section icon={<Eye size={12} />} title="Sidebar tabs">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <QuickBtn onClick={() => setRow(u.id, { allowed: RO_DEFAULT_TAB_IDS })} icon={<RotateCcw size={11} />}>Defaults</QuickBtn>
                      <QuickBtn onClick={() => setRow(u.id, { allowed: RO_PARITY_TAB_IDS.slice() })} icon={<Eye size={11} />}>All tabs</QuickBtn>
                      <QuickBtn onClick={() => setRow(u.id, { allowed: ['dashboard'] })} icon={<EyeOff size={11} />}>Dashboard only</QuickBtn>
                    </div>
                    <TabMatrix grouped={groupedTabs} allowed={e.allowed ?? server.allowed} onToggle={(tid) => toggleTab(u.id, tid)} />
                  </Section>

                  {/* Companies */}
                  <Section icon={<Building2 size={12} />} title="Company scope (server-enforced)">
                    <CompanyMatrix companies={companies} selected={e.companies ?? server.companies}
                      onToggle={(cid) => toggleCompany(u.id, cid)} onAll={() => setRow(u.id, { companies: null })} onNone={() => setRow(u.id, { companies: [] })} />
                  </Section>

                  {/* Flags */}
                  <Section icon={<Lock size={12} />} title="Data & capability flags">
                    <div className="rounded-lg p-2 space-y-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                      {FLAG_CATALOG.map(f => {
                        const on = (e.flags || server.flags)[f.key] === true;
                        return (
                          <label key={f.key} className="flex items-start gap-2 cursor-pointer text-xs">
                            <input type="checkbox" className="mt-0.5" checked={on} onChange={() => setRow(u.id, { flags: { ...(e.flags || server.flags), [f.key]: !on } })} />
                            <span><strong>{f.label}</strong><span style={{ color: 'var(--color-text-tertiary)' }}> · {f.desc}</span></span>
                          </label>
                        );
                      })}
                    </div>
                  </Section>

                  {/* Export areas */}
                  <Section icon={<Download size={12} />} title="Downloads by area">
                    <div className="rounded-lg p-2 grid grid-cols-2 md:grid-cols-3 gap-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                      {exportAreas.map(a => {
                        const cfg = e.export || server.export;
                        const on = cfg[a] !== false;
                        return (
                          <label key={a} className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
                            <input type="checkbox" checked={on} onChange={() => setRow(u.id, { export: { ...cfg, [a]: !on } })} />{EXPORT_AREA_LABEL[a] || a}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>The “Allow exports” flag above is the master switch; these refine it per area. Enforced at the egress guard.</p>
                  </Section>

                  {/* Per-button controls */}
                  <Section icon={<Sliders size={12} />} title="Buttons & actions (per tab)">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <QuickBtn onClick={() => setAllControls(u.id, false)} icon={<Eye size={11} />}>All buttons</QuickBtn>
                      <QuickBtn onClick={() => setAllControls(u.id, true)} icon={<EyeOff size={11} />}>Hide all buttons</QuickBtn>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Unchecked = the button never renders for this admin.</span>
                    </div>
                    <ControlsMatrix disabled={e.controls ?? server.controls} onToggle={(k) => toggleControl(u.id, k)} />
                  </Section>

                  {/* Activity */}
                  <Section icon={<Activity size={12} />} title="Activity">
                    <ActivityTimeline rows={activity[u.id]} onRefresh={() => loadActivity(u.id)} />
                  </Section>

                  {/* Actions */}
                  <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => revoke(u.id, u.email)} disabled={savingId === u.id} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border disabled:opacity-40" style={{ borderColor: 'var(--color-error-300, #fca5a5)', color: 'var(--color-error-700, #b91c1c)', backgroundColor: 'var(--color-error-50, #fef2f2)' }}><Trash2 size={12} /> Revoke</button>
                      <button onClick={() => permanentDelete(u.id, u.email)} disabled={savingId === u.id} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40" style={{ backgroundColor: '#dc2626' }}><Skull size={12} /> Permanent delete</button>
                    </div>
                    <button onClick={() => saveRow(u.id)} disabled={savingId === u.id || !dirty} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40" style={{ background: 'var(--gradient-sidebar)' }}><Save size={13} /> {savingId === u.id ? 'Saving…' : (dirty ? 'Save changes' : 'Saved')}</button>
                  </div>

                  {u.via_env && <p className="text-[11px] flex items-start gap-1.5" style={{ color: 'var(--color-warning-700, #b45309)' }}><Lock size={11} className="flex-shrink-0 mt-0.5" />Revoke isn't permanent while this email is in <code>READONLY_ADMIN_EMAIL</code> — remove it from the env var too.</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── small presentational helpers ────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-widest mb-1.5 block" style={{ color: 'var(--color-text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}
function Section({ icon, title, children }) {
  return (
    <div className="pt-3">
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-tertiary)' }}>{icon}{title}</p>
      {children}
    </div>
  );
}
function Badge({ color, text, title, children }) {
  return <span title={title} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ backgroundColor: color, color: text }}>{children}</span>;
}
function QuickBtn({ onClick, icon, children }) {
  return <button onClick={onClick} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>{icon}{children}</button>;
}
function TabMatrix({ grouped, allowed, onToggle }) {
  const isOn = (id) => allowed === null ? true : (Array.isArray(allowed) && allowed.includes(id));
  return (
    <div className="space-y-2">
      {grouped.map(([g, items]) => (
        <div key={g}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{ADMIN_TAB_GROUPS[g] || g}</p>
          <div className="rounded-lg p-2 grid grid-cols-2 md:grid-cols-3 gap-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {items.map(t => (
              <label key={t.id} className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
                <input type="checkbox" checked={isOn(t.id)} disabled={t.id === 'dashboard'} onChange={() => onToggle(t.id)} />{t.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
const TAB_LABEL = Object.fromEntries(RO_ELIGIBLE_TABS.map(t => [t.id, t.label]));
const CC_LABEL = { 'cc-sales': 'All Sales', 'cc-transfers': 'All Transfers', 'cc-callbacks': 'All Callbacks' };
function ControlsMatrix({ disabled, onToggle }) {
  const dis = Array.isArray(disabled) ? disabled : [];
  return (
    <div className="space-y-2">
      {groupedControls().map(([tabId, controls]) => (
        <div key={tabId}>
          <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-tertiary)' }}>{TAB_LABEL[tabId] || CC_LABEL[tabId] || tabId}</p>
          <div className="rounded-lg p-2 grid grid-cols-2 md:grid-cols-3 gap-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            {controls.map(c => (
              <label key={c.key} className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
                <input type="checkbox" checked={!dis.includes(c.key)} onChange={() => onToggle(c.key)} />{c.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
function CompanyMatrix({ companies, selected, onToggle, onAll, onNone }) {
  const all = selected === null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <QuickBtn onClick={onAll} icon={<Eye size={11} />}>All companies</QuickBtn>
        <QuickBtn onClick={onNone} icon={<EyeOff size={11} />}>None</QuickBtn>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{all ? 'Every company (parity)' : `${(selected || []).length} of ${companies.length}`}</span>
      </div>
      {companies.length === 0 ? (
        <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>No companies loaded.</p>
      ) : (
        <div className="rounded-lg p-2 grid grid-cols-2 md:grid-cols-3 gap-1.5 max-h-48 overflow-auto" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {companies.map(c => (
            <label key={c.id} className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="checkbox" checked={all || (selected || []).includes(c.id)} onChange={() => onToggle(c.id)} /><span className="truncate">{c.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
function ActivityTimeline({ rows, onRefresh }) {
  if (rows === undefined) return <p className="text-xs italic" style={{ color: 'var(--color-text-tertiary)' }}>Loading activity…</p>;
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between px-2 py-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>{rows.length} recent events</span>
        <QuickBtn onClick={onRefresh} icon={<RotateCcw size={11} />}>Refresh</QuickBtn>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs italic px-2 py-3" style={{ color: 'var(--color-text-tertiary)' }}>No activity recorded yet.</p>
      ) : (
        <div className="max-h-64 overflow-auto divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {rows.map((r, i) => (
            <div key={i} className="px-2 py-1.5 text-xs flex items-center gap-2 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
              <span style={{ color: 'var(--color-text-tertiary)', minWidth: 128 }}>{new Date(r.created_at).toLocaleString()}</span>
              <span className="font-bold" style={{ color: r.status === 'denied' || r.status === 'blocked' ? 'var(--color-error-700, #b91c1c)' : 'var(--color-text)' }}>{r.action_type}</span>
              {r.dataset && <span style={{ color: 'var(--color-text-secondary)' }}>{r.dataset}</span>}
              {r.surface && <span style={{ color: 'var(--color-text-tertiary)' }}>{r.surface}</span>}
              {r.path && <span style={{ color: 'var(--color-text-tertiary)' }}>{r.http_method} {r.path}</span>}
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: r.verified ? '#dcfce7' : '#f1f5f9', color: r.verified ? '#166534' : '#64748b' }}>{r.verified ? 'verified' : 'reported'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── role-wide default template editor ───────────────────────────────────────
function RoleDefaultsPanel({ initial, companies, exportAreas, groupedTabs, onSaved, onError }) {
  const [tabs, setTabs] = useState(initial?.tabs ?? null);           // null = parity
  const [flags, setFlags] = useState({ ...DEFAULT_FLAGS, ...(initial?.flags || {}) });
  const [comp, setComp] = useState(initial?.companies ?? null);      // null = parity
  const [exp, setExp] = useState(initial?.export || {});
  const [saving, setSaving] = useState(false);
  const toggleTab = (tid) => setTabs(s => {
    const base = s === null ? RO_PARITY_TAB_IDS.slice() : s;
    return base.includes(tid) ? base.filter(x => x !== tid) : [...base, tid];
  });
  const save = async () => {
    setSaving(true);
    try { await client.put('readonly-admins/defaults', { tabs, flags, companies: comp, export: exp }); onSaved(); }
    catch (e) { onError(e.response?.data?.error || 'Save defaults failed.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="rounded-2xl p-5 space-y-3" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-primary-300, var(--color-border))' }}>
      <p className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}><Sliders size={13} /> Role-wide default template</p>
      <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Applies to EVERY readonly admin under their own per-user overrides. Leave a section at parity (All) to not force it.</p>
      <Section icon={<Eye size={12} />} title="Default tabs">
        <div className="flex items-center gap-2 mb-2">
          <QuickBtn onClick={() => setTabs(null)} icon={<Eye size={11} />}>All (parity)</QuickBtn>
          <QuickBtn onClick={() => setTabs(RO_DEFAULT_TAB_IDS)} icon={<RotateCcw size={11} />}>Suggested</QuickBtn>
        </div>
        <TabMatrix grouped={groupedTabs} allowed={tabs} onToggle={toggleTab} />
      </Section>
      <Section icon={<Lock size={12} />} title="Default flags">
        <div className="rounded-lg p-2 space-y-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {FLAG_CATALOG.map(f => (
            <label key={f.key} className="flex items-start gap-2 cursor-pointer text-xs">
              <input type="checkbox" className="mt-0.5" checked={flags[f.key] === true} onChange={() => setFlags(s => ({ ...s, [f.key]: !s[f.key] }))} />
              <span><strong>{f.label}</strong><span style={{ color: 'var(--color-text-tertiary)' }}> · {f.desc}</span></span>
            </label>
          ))}
        </div>
      </Section>
      <Section icon={<Download size={12} />} title="Default downloads by area">
        <div className="rounded-lg p-2 grid grid-cols-2 md:grid-cols-3 gap-1.5" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          {exportAreas.map(a => (
            <label key={a} className="inline-flex items-center gap-1.5 cursor-pointer text-xs">
              <input type="checkbox" checked={exp[a] !== false} onChange={() => setExp(s => ({ ...s, [a]: !(s[a] !== false) }))} />{EXPORT_AREA_LABEL[a] || a}
            </label>
          ))}
        </div>
      </Section>
      <Section icon={<Building2 size={12} />} title="Default company scope">
        <CompanyMatrix companies={companies} selected={comp} onToggle={(cid) => setComp(s => {
          const base = s === null ? companies.map(c => c.id) : s;
          return base.includes(cid) ? base.filter(x => x !== cid) : [...base, cid];
        })} onAll={() => setComp(null)} onNone={() => setComp([])} />
      </Section>
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-40" style={{ background: 'var(--gradient-sidebar)' }}><Save size={13} /> {saving ? 'Saving…' : 'Save template'}</button>
      </div>
    </div>
  );
}
