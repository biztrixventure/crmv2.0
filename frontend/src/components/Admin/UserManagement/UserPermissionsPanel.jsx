import { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldCheck, ShieldX, Shield, Save, Loader, Search, RotateCcw, Check, X, Zap, Layers } from 'lucide-react';
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
    try {
      const permPayload = Object.entries(overrides).map(([permission_name, type]) => ({ permission_name, type }));
      const featPayload = Object.entries(featOv).map(([feature_key, is_enabled]) => ({ feature_key, is_enabled }));
      await Promise.all([
        client.put(`users/${user.id}/overrides`, { overrides: permPayload }),
        client.put(`users/${user.id}/feature-overrides`, { overrides: featPayload }),
      ]);
      setMsg({ type: 'success', text: `Saved — ${permPayload.length} permission + ${featPayload.length} feature override${(permPayload.length + featPayload.length) !== 1 ? 's' : ''} for ${user.first_name || 'this user'}.` });
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || 'Save failed' });
    } finally { setSaving(false); }
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

      {msg && <Alert type={msg.type} message={msg.text} dismissible onDismiss={() => setMsg(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tabs, features, options…" className="input text-sm py-1.5 pl-8 w-full" />
        </div>
        <button onClick={() => bulkAll('on')}      className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1" style={{ borderColor: '#bbf7d0', color: '#16a34a' }}><Check size={12} /> Grant all perms</button>
        <button onClick={() => bulkAll('off')}     className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1" style={{ borderColor: '#fecaca', color: '#dc2626' }}><X size={12} /> Revoke all</button>
        <button onClick={() => bulkAll('default')} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}><RotateCcw size={12} /> Reset</button>
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
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving} className="flex items-center gap-2">
          <Save size={15} /> Save All
        </Button>
      </div>
    </div>
  );
};

export default UserPermissionsPanel;
