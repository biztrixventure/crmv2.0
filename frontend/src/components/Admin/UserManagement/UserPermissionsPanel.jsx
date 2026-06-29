import { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldCheck, ShieldX, Shield, Save, Loader, Search, RotateCcw, Check, X, Zap, Layers, Users, Eye, BookmarkPlus, ChevronUp, ChevronDown } from 'lucide-react';
import { Button, Alert } from '../../../components/UI';
import { usePermissions } from '../../../hooks/usePermissions';
import client from '../../../api/client';

const AREA_LABEL = {
  sales: 'Sales', transfers: 'Transfers', callbacks: 'Callbacks',
  reports: 'Reports & Stats', reviews: 'Call Reviews', forms: 'Forms & FAQs',
  user_management: 'User Management', users: 'Company Users',
  company_management: 'Companies', companies: 'Closer Pool', notifications: 'Notifications',
};
const areaLabel = (c) => AREA_LABEL[c] || (c || 'other').replace(/_/g, ' ');
const pretty = (name) => name.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

// Generic 3-state pill.
const TriPill = ({ value, options, onChange }) => {
  const btn = (label, active, color, onClick) => (
    <button type="button" onClick={onClick}
      className="px-2.5 py-1 text-xs font-semibold rounded transition-all"
      style={{ backgroundColor: active ? color + '22' : 'transparent', color: active ? color : 'var(--color-text-secondary)', border: `1.5px solid ${active ? color : 'var(--color-border)'}` }}>
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {options.map(o => btn(o.label, value === o.value, o.color, () => onChange(value === o.value && o.toggleOff ? o.toggleOff : o.value)))}
    </div>
  );
};

const UserPermissionsPanel = ({ user }) => {
  const { permissions: allPerms, loading: permsLoading, fetchPermissions } = usePermissions();
  const [rolePerms, setRolePerms] = useState(new Set());
  const [overrides, setOverrides] = useState({});         // perm overrides: { name: 'grant'|'revoke' }
  const [featCatalog, setFeatCatalog] = useState([]);     // [{key,label,description,category,...}]
  const [featCompany, setFeatCompany] = useState({});     // { key: bool } company-effective
  const [featOv, setFeatOv]           = useState({});     // { key: bool } user overrides
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]   = useState(null);
  const [search, setSearch] = useState('');
  const [peers, setPeers]   = useState([]);   // same-company users, for "copy from"

  // Load same-company users so the superadmin can copy one user's access onto another.
  useEffect(() => {
    if (!user.company_id) return;
    client.get('users', { params: { company_id: user.company_id } })
      .then(r => setPeers((r.data.users || []).filter(u => u.id && u.id !== user.id)))
      .catch(() => {});
  }, [user.company_id, user.id]);

  const copyFrom = async (srcId) => {
    if (!srcId) return;
    try {
      const [p, f] = await Promise.all([
        client.get(`users/${srcId}/overrides`),
        client.get(`users/${srcId}/feature-overrides`).catch(() => ({ data: { user_overrides: {} } })),
      ]);
      const pm = {}; (p.data.overrides || []).forEach(o => { pm[o.permission_name] = o.type; });
      setOverrides(pm);
      setFeatOv(f.data.user_overrides || {});
      const src = peers.find(x => x.id === srcId);
      setMsg({ type: 'success', text: `Loaded access from ${[src?.first_name, src?.last_name].filter(Boolean).join(' ') || 'that user'} — review, then click Save All to apply.` });
    } catch { setMsg({ type: 'error', text: 'Failed to copy access' }); }
  };

  const clearAll = () => { setOverrides({}); setFeatOv({}); };

  // Apply the CURRENT editor toggles to many other users at once.
  const [applyOpen, setApplyOpen]       = useState(false);
  const [applyTargets, setApplyTargets] = useState(() => new Set());
  const [applySearch, setApplySearch]   = useState('');
  const [applying, setApplying]         = useState(false);
  const toggleTarget = (id) => setApplyTargets(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const applyToOthers = async () => {
    if (!applyTargets.size) return;
    setApplying(true);
    try {
      const permission_overrides = Object.entries(overrides).map(([permission_name, type]) => ({ permission_name, type }));
      const feature_overrides    = Object.entries(featOv).map(([feature_key, is_enabled]) => ({ feature_key, is_enabled }));
      const r = await client.post('users/apply-overrides', { target_assignment_ids: [...applyTargets], permission_overrides, feature_overrides });
      setApplyOpen(false); setApplyTargets(new Set()); setApplySearch('');
      setMsg({ type: 'success', text: `Applied this access to ${r.data.applied} user${r.data.applied !== 1 ? 's' : ''}.${r.data.feature_warning ? ' (' + r.data.feature_warning + ')' : ''}` });
    } catch (e) { setMsg({ type: 'error', text: e.response?.data?.error || 'Apply failed' }); }
    finally { setApplying(false); }
  };

  // Templates (saved override sets) + preview-as-user.
  const [templates, setTemplates] = useState([]);
  const [previewLink, setPreviewLink] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => { client.get('users/access-templates').then(r => setTemplates(r.data.templates || [])).catch(() => {}); }, []);

  const saveTemplate = async () => {
    const name = window.prompt('Name this access template (e.g. "Fronter — no callbacks"):');
    if (!name || !name.trim()) return;
    try {
      const permission_overrides = Object.entries(overrides).map(([permission_name, type]) => ({ permission_name, type }));
      const feature_overrides    = Object.entries(featOv).map(([feature_key, is_enabled]) => ({ feature_key, is_enabled }));
      const r = await client.post('users/access-templates', { name: name.trim(), permission_overrides, feature_overrides });
      setTemplates(prev => [...prev, r.data.template]);
      setMsg({ type: 'success', text: `Template “${r.data.template.name}” saved.` });
    } catch { setMsg({ type: 'error', text: 'Failed to save template' }); }
  };
  const loadTemplate = (id) => {
    const t = templates.find(x => x.id === id); if (!t) return;
    const pm = {}; (t.permission_overrides || []).forEach(o => { pm[o.permission_name] = o.type; });
    const fm = {}; (t.feature_overrides || []).forEach(o => { fm[o.feature_key] = o.is_enabled; });
    setOverrides(pm); setFeatOv(fm);
    setMsg({ type: 'success', text: `Loaded template “${t.name}” — review, then Save All (or Apply to others).` });
  };
  const deleteTemplate = async (id) => {
    if (!window.confirm('Delete this template?')) return;
    try { await client.delete(`users/access-templates/${id}`); setTemplates(prev => prev.filter(t => t.id !== id)); } catch {}
  };
  const previewAsUser = async () => {
    setPreviewing(true);
    try { const r = await client.post(`users/${user.user_id || user.id}/impersonate`); setPreviewLink({ link: r.data.link, email: r.data.email }); }
    catch (e) { setMsg({ type: 'error', text: e.response?.data?.error || 'Preview failed' }); }
    finally { setPreviewing(false); }
  };

  // Overview — who in this company already has custom access.
  const [overview, setOverview] = useState([]);
  const [showOverview, setShowOverview] = useState(false);
  useEffect(() => {
    if (!user.company_id) return;
    client.get('users/access-overview', { params: { company_id: user.company_id } }).then(r => setOverview(r.data.users || [])).catch(() => {});
  }, [user.company_id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await fetchPermissions();
      const [permRes, featRes] = await Promise.all([
        client.get(`users/${user.id}/overrides`),
        client.get(`users/${user.id}/feature-overrides`).catch(() => ({ data: { catalog: [], company_effective: {}, user_overrides: {} } })),
      ]);
      setRolePerms(new Set(permRes.data.role_permissions || []));
      const map = {}; (permRes.data.overrides || []).forEach(o => { map[o.permission_name] = o.type; });
      setOverrides(map);
      setFeatCatalog(featRes.data.catalog || []);
      setFeatCompany(featRes.data.company_effective || {});
      setFeatOv(featRes.data.user_overrides || {});
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || 'Failed to load access settings' });
    } finally { setLoading(false); }
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const setOnePerm = (name, value) => setOverrides(prev => {
    const next = { ...prev }; if (value === null) delete next[name]; else next[name] = value; return next;
  });
  const setOneFeat = (key, value) => setFeatOv(prev => {
    const next = { ...prev }; if (value === undefined) delete next[key]; else next[key] = value; return next;
  });

  const effPerm = (name) => { const o = overrides[name] ?? null; return o === 'grant' ? true : o === 'revoke' ? false : rolePerms.has(name); };
  const effFeat = (key) => (featOv[key] !== undefined ? featOv[key] : featCompany[key]);

  const allPermList = useMemo(() => Object.values(allPerms || {}).flat(), [allPerms]);
  const bulkGroup = (perms, mode) => setOverrides(prev => {
    const next = { ...prev };
    perms.forEach(p => { const has = rolePerms.has(p.name);
      if (mode === 'default') delete next[p.name];
      else if (mode === 'on')  has ? delete next[p.name] : (next[p.name] = 'grant');
      else if (mode === 'off') has ? (next[p.name] = 'revoke') : delete next[p.name];
    });
    return next;
  });
  const bulkAll = (mode) => bulkGroup(allPermList, mode);

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    const permPayload = Object.entries(overrides).map(([permission_name, type]) => ({ permission_name, type }));
    const featPayload = Object.entries(featOv).map(([feature_key, is_enabled]) => ({ feature_key, is_enabled }));
    // Save the two halves INDEPENDENTLY so a feature error (e.g. migration 122
    // not applied) never makes a successful permission save look failed.
    const [permRes, featRes] = await Promise.allSettled([
      client.put(`users/${user.id}/overrides`, { overrides: permPayload }),
      client.put(`users/${user.id}/feature-overrides`, { overrides: featPayload }),
    ]);
    setSaving(false);
    const permOk = permRes.status === 'fulfilled';
    const featOk = featRes.status === 'fulfilled';
    if (permOk && featOk) {
      setMsg({ type: 'success', text: `Saved — ${permPayload.length} permission + ${featPayload.length} feature override${(permPayload.length + featPayload.length) !== 1 ? 's' : ''}.` });
    } else if (permOk && !featOk) {
      setMsg({ type: 'error', text: `Permissions saved ✓ — feature toggles NOT saved: ${featRes.reason?.response?.data?.error || 'failed'}` });
    } else {
      setMsg({ type: 'error', text: permRes.reason?.response?.data?.error || 'Save failed' });
    }
  };

  if (loading || permsLoading) {
    return <div className="flex items-center justify-center py-12 gap-3 text-text-secondary"><Loader size={20} className="animate-spin" /><span>Loading access settings…</span></div>;
  }

  const q = search.trim().toLowerCase();
  const matchP = (p) => !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || pretty(p.name).toLowerCase().includes(q);
  const matchF = (f) => !q || f.key.toLowerCase().includes(q) || (f.label || '').toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q);

  const overrideCount = Object.keys(overrides).length;
  const featOvCount   = Object.keys(featOv).length;
  const grantCount    = Object.values(overrides).filter(v => v === 'grant').length;
  const revokeCount   = Object.values(overrides).filter(v => v === 'revoke').length;
  const effGranted    = allPermList.filter(p => effPerm(p.name)).length;
  const visibleFeats  = featCatalog.filter(matchF);
  const roleLevel = (user.role_level || user.custom_roles?.level || user.role || '').toLowerCase();
  const bypassRole = roleLevel === 'superadmin';
  const readonlyRole = roleLevel === 'readonly_admin';

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-3 text-sm flex items-start gap-2"
        style={{ backgroundColor: 'var(--color-primary-50, rgba(99,102,241,0.06))', border: '1px solid var(--color-primary-200, rgba(99,102,241,0.2))' }}>
        <Shield size={15} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary-600)' }} />
        <span style={{ color: 'var(--color-text-secondary)' }}>
          Base access = role <strong style={{ color: 'var(--color-text)' }}>{user.role}</strong> + company features. Toggle anything below to
          <strong style={{ color: '#16a34a' }}> enable</strong> or <strong style={{ color: '#dc2626' }}> disable</strong> it for <strong style={{ color: 'var(--color-text)' }}>{[user.first_name, user.last_name].filter(Boolean).join(' ') || 'this user'}</strong> only.
          “Default” inherits the role/company.
        </span>
      </div>

      {(bypassRole || readonlyRole) && (
        <div className="rounded-xl p-3 text-sm flex items-start gap-2" style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
          <ShieldX size={15} className="mt-0.5 flex-shrink-0" style={{ color: '#d97706' }} />
          <span style={{ color: '#92400e' }}>
            {bypassRole
              ? 'This user is a Superadmin — they bypass all permission and feature checks, so overrides here have no effect.'
              : 'This user is a Readonly Admin — they have broad read access by design; overrides may have limited effect.'}
          </span>
        </div>
      )}

      {/* Overview — who already has custom access */}
      {overview.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <button onClick={() => setShowOverview(v => !v)} className="w-full flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{overview.length} user{overview.length !== 1 ? 's' : ''} in this company have custom access</span>
            {showOverview ? <ChevronUp size={14} style={{ color: 'var(--color-text-tertiary)' }} /> : <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />}
          </button>
          {showOverview && (
            <div className="divide-y divide-border max-h-48 overflow-y-auto">
              {overview.map(u => (
                <div key={u.user_id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span style={{ color: 'var(--color-text)' }}>{u.name}{u.user_id === user.user_id && <span style={{ color: 'var(--color-primary-600)' }}> · this user</span>}</span>
                  <span className="flex gap-2 text-xs font-semibold">
                    {u.grants > 0 && <span style={{ color: '#16a34a' }}>+{u.grants}</span>}
                    {u.revokes > 0 && <span style={{ color: '#dc2626' }}>−{u.revokes}</span>}
                    {u.features > 0 && <span style={{ color: '#7c3aed' }}>{u.features} feat</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <Alert type={msg.type} message={msg.text} dismissible onDismiss={() => setMsg(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tabs, features, options…" className="input text-sm py-1.5 pl-8 w-full" />
        </div>
        {peers.length > 0 && (
          <select onChange={e => { copyFrom(e.target.value); e.target.value = ''; }} defaultValue=""
            className="input text-xs py-1.5" style={{ maxWidth: 210 }} title="Copy another user's access into the editor">
            <option value="">Copy access from…</option>
            {peers.map(p => (
              <option key={p.id} value={p.id}>
                {[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'User'}
                {` · ${(p.role_level || p.custom_roles?.level || p.role || '').replace(/_/g, ' ') || '—'}`}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => bulkAll('on')}  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1" style={{ borderColor: '#bbf7d0', color: '#16a34a' }}><Check size={12} /> Grant all perms</button>
        <button onClick={() => bulkAll('off')} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1" style={{ borderColor: '#fecaca', color: '#dc2626' }}><X size={12} /> Revoke all</button>
        <button onClick={clearAll}             className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }} title="Clear ALL overrides (perms + features) back to defaults"><RotateCcw size={12} /> Reset all</button>
      </div>

      {/* Templates row */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={saveTemplate} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
          <BookmarkPlus size={13} /> Save as template
        </button>
        {templates.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Templates:</span>
            {templates.map(t => (
              <span key={t.id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border" style={{ borderColor: 'var(--color-border)' }}>
                <button onClick={() => loadTemplate(t.id)} className="font-semibold" style={{ color: 'var(--color-primary-600)' }} title="Load this template into the editor">{t.name}</button>
                <button onClick={() => deleteTemplate(t.id)} title="Delete template"><X size={10} style={{ color: 'var(--color-text-tertiary)' }} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-1 rounded-full font-semibold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{effGranted}/{allPermList.length} options enabled</span>
        {grantCount > 0 && <span className="px-2 py-1 rounded-full font-semibold" style={{ backgroundColor: '#dcfce7', color: '#166534' }}><Zap size={10} className="inline" /> {grantCount} granted</span>}
        {revokeCount > 0 && <span className="px-2 py-1 rounded-full font-semibold" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>{revokeCount} revoked</span>}
        {featOvCount > 0 && <span className="px-2 py-1 rounded-full font-semibold" style={{ backgroundColor: '#ede9fe', color: '#5b21b6' }}>{featOvCount} feature override{featOvCount !== 1 ? 's' : ''}</span>}
        {overrideCount === 0 && featOvCount === 0 && <span className="px-2 py-1 rounded-full" style={{ color: 'var(--color-text-tertiary)' }}>No overrides — all defaults</span>}
      </div>

      {/* ── TABS & FEATURES ── */}
      {visibleFeats.length > 0 && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-2 flex items-center gap-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <Layers size={14} style={{ color: 'var(--color-primary-600)' }} />
            <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Tabs &amp; Features</span>
            <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>· entire tabs/areas, on or off for this user</span>
          </div>
          <div className="divide-y divide-border">
            {visibleFeats.map(f => {
              const on = effFeat(f.key);
              const ov = featOv[f.key];
              return (
                <div key={f.key} className="flex items-center gap-3 px-4 py-2.5">
                  {on ? <ShieldCheck size={15} className="flex-shrink-0" style={{ color: '#16a34a' }} />
                      : <ShieldX size={15} className="flex-shrink-0" style={{ color: '#9ca3af' }} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{f.label || pretty(f.key)}</p>
                    <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{f.description || f.key}</p>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 font-semibold"
                    style={{ backgroundColor: featCompany[f.key] ? '#dcfce7' : 'var(--color-bg-secondary)', color: featCompany[f.key] ? '#166534' : 'var(--color-text-tertiary)', border: `1px solid ${featCompany[f.key] ? '#bbf7d0' : 'var(--color-border)'}` }}>
                    {featCompany[f.key] ? 'company ✓' : 'company ✗'}
                  </span>
                  <TriPill value={ov === undefined ? 'default' : ov} options={[
                    { label: 'Default', value: 'default' },
                    { label: 'On',  value: true,  color: '#16a34a' },
                    { label: 'Off', value: false, color: '#dc2626' },
                  ].map(o => ({ ...o, color: o.color || 'var(--color-text-secondary)' }))}
                    onChange={(v) => setOneFeat(f.key, v === 'default' ? undefined : v)} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── PERMISSIONS ── */}
      {Object.entries(allPerms).map(([category, perms]) => {
        const visible = perms.filter(matchP);
        if (!visible.length) return null;
        return (
          <div key={category} className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{areaLabel(category)}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => bulkGroup(perms, 'on')}      className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ color: '#16a34a' }}>Grant all</button>
                <button onClick={() => bulkGroup(perms, 'off')}     className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ color: '#dc2626' }}>Revoke all</button>
                <button onClick={() => bulkGroup(perms, 'default')} className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ color: 'var(--color-text-secondary)' }}>Reset</button>
              </div>
            </div>
            <div className="divide-y divide-border">
              {visible.map(perm => {
                const hasRole = rolePerms.has(perm.name);
                const on = effPerm(perm.name);
                const ov = overrides[perm.name] ?? null;
                return (
                  <div key={perm.id} className="flex items-center gap-3 px-4 py-2.5">
                    {on ? <ShieldCheck size={15} className="flex-shrink-0" style={{ color: '#16a34a' }} />
                        : <ShieldX size={15} className="flex-shrink-0" style={{ color: '#9ca3af' }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{perm.description || pretty(perm.name)}</p>
                      <p className="text-[11px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{perm.name}</p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 font-semibold"
                      style={{ backgroundColor: hasRole ? '#dcfce7' : 'var(--color-bg-secondary)', color: hasRole ? '#166534' : 'var(--color-text-tertiary)', border: `1px solid ${hasRole ? '#bbf7d0' : 'var(--color-border)'}` }}>
                      {hasRole ? 'role ✓' : 'role ✗'}
                    </span>
                    <TriPill value={ov === null ? 'default' : ov} options={[
                      { label: 'Default', value: 'default', color: 'var(--color-text-secondary)' },
                      { label: '+ Grant',  value: 'grant',  color: '#16a34a', toggleOff: 'default' },
                      { label: '− Revoke', value: 'revoke', color: '#dc2626', toggleOff: 'default' },
                    ]} onChange={(v) => setOnePerm(perm.name, v === 'default' ? null : v)} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="sticky bottom-0 flex items-center justify-between pt-3 pb-1 border-t border-border" style={{ backgroundColor: 'var(--color-surface)' }}>
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {(overrideCount + featOvCount) > 0 ? `${overrideCount + featOvCount} override${(overrideCount + featOvCount) !== 1 ? 's' : ''} — unsaved` : 'No overrides — all defaults'}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={previewAsUser} disabled={previewing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }} title="Open the app as this user (new tab) to see exactly their tabs">
            <Eye size={14} /> {previewing ? 'Opening…' : 'Preview as user'}
          </button>
          {peers.length > 0 && (
            <button onClick={() => setApplyOpen(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }} title="Apply these toggles to several users at once">
              <Users size={14} /> Apply to others…
            </button>
          )}
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving} className="flex items-center gap-2">
            <Save size={15} /> Save All
          </Button>
        </div>
      </div>

      {/* Apply-to-many modal */}
      {applyOpen && (() => {
        const aq = applySearch.trim().toLowerCase();
        const list = peers.filter(p => !aq || `${p.first_name || ''} ${p.last_name || ''} ${p.email || ''}`.toLowerCase().includes(aq));
        return (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setApplyOpen(false)}>
            <div className="w-full max-w-md rounded-2xl border max-h-[85vh] flex flex-col" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }} onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <h3 className="font-bold text-base" style={{ color: 'var(--color-text)' }}>Apply this access to other users</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Replaces each selected user's overrides with the <strong>{overrideCount}</strong> permission + <strong>{featOvCount}</strong> feature toggle{(overrideCount + featOvCount) !== 1 ? 's' : ''} shown here.
                </p>
              </div>
              <div className="p-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
                <input value={applySearch} onChange={e => setApplySearch(e.target.value)} placeholder="Search users…" className="input text-sm py-1.5 flex-1" />
                <button onClick={() => setApplyTargets(new Set(list.map(p => p.id)))} className="text-xs font-semibold px-2 py-1.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Select all</button>
                {applyTargets.size > 0 && <button onClick={() => setApplyTargets(new Set())} className="text-xs font-semibold px-2 py-1.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Clear</button>}
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {list.length === 0 ? <p className="text-xs text-center py-6" style={{ color: 'var(--color-text-tertiary)' }}>No users</p> : list.map(p => {
                  const sel = applyTargets.has(p.id);
                  return (
                    <button key={p.id} onClick={() => toggleTarget(p.id)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left hover:bg-bg-secondary">
                      <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: sel ? 'var(--color-primary-600)' : 'transparent', border: `1.5px solid ${sel ? 'var(--color-primary-600)' : 'var(--color-border)'}` }}>
                        {sel && <Check size={11} color="#fff" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{[p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'User'}</span>
                        <span className="block text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{(p.role_level || p.custom_roles?.level || p.role || '').replace(/_/g, ' ') || '—'}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="p-3 border-t flex gap-2" style={{ borderColor: 'var(--color-border)' }}>
                <button onClick={() => setApplyOpen(false)} className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>Cancel</button>
                <button onClick={applyToOthers} disabled={!applyTargets.size || applying} className="flex-1 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ background: 'var(--gradient-sidebar)' }}>
                  {applying ? 'Applying…' : `Apply to ${applyTargets.size} user${applyTargets.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Preview-as-user modal */}
      {previewLink && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setPreviewLink(null)}>
          <div className="w-full max-w-sm rounded-2xl border p-5" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-base mb-1" style={{ color: 'var(--color-text)' }}>Preview as {previewLink.email}</h3>
            <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>
              Opens a one-time login as this user in a new tab — you'll see exactly their tabs and options. Tip: use a separate/incognito window so your own session stays put.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setPreviewLink(null)} className="px-3 py-2 rounded-xl text-sm font-semibold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>Close</button>
              <a href={previewLink.link} target="_blank" rel="noopener noreferrer" onClick={() => setPreviewLink(null)}
                className="flex-1 text-center py-2 rounded-xl text-sm font-bold text-white" style={{ background: 'var(--gradient-sidebar)' }}>Open as user ↗</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserPermissionsPanel;
