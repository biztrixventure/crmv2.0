import { useState, useEffect, useCallback, useMemo } from 'react';
import { ShieldCheck, ShieldX, Shield, Save, Loader, Search, RotateCcw, Check, X, Zap } from 'lucide-react';
import { Button, Alert } from '../../../components/UI';
import { usePermissions } from '../../../hooks/usePermissions';
import client from '../../../api/client';

// Friendly area labels — the permission category maps roughly to a shell area.
const AREA_LABEL = {
  sales: 'Sales', transfers: 'Transfers', callbacks: 'Callbacks',
  reports: 'Reports & Stats', reviews: 'Call Reviews', forms: 'Forms & FAQs',
  user_management: 'User Management', users: 'Company Users',
  company_management: 'Companies', companies: 'Closer Pool', notifications: 'Notifications',
};
const areaLabel = (c) => AREA_LABEL[c] || c.replace(/_/g, ' ');
const pretty = (name) => name.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

// 3-state pill: null (default) | 'grant' | 'revoke'
const OverridePill = ({ state, onChange }) => {
  const btn = (label, active, color, onClick) => (
    <button type="button" onClick={onClick}
      className="px-2.5 py-1 text-xs font-semibold rounded transition-all"
      style={{ backgroundColor: active ? color + '22' : 'transparent', color: active ? color : 'var(--color-text-secondary)', border: `1.5px solid ${active ? color : 'var(--color-border)'}` }}>
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {btn('Default', state === null, 'var(--color-text-secondary)', () => onChange(null))}
      {btn('+ Grant', state === 'grant', '#16a34a', () => onChange(state === 'grant' ? null : 'grant'))}
      {btn('− Revoke', state === 'revoke', '#dc2626', () => onChange(state === 'revoke' ? null : 'revoke'))}
    </div>
  );
};

const UserPermissionsPanel = ({ user }) => {
  const { permissions: allPerms, loading: permsLoading, fetchPermissions } = usePermissions();
  const [rolePerms, setRolePerms] = useState(new Set());
  const [overrides, setOverrides] = useState({}); // { permName: 'grant'|'revoke'|null }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await fetchPermissions();
      const { data } = await client.get(`users/${user.id}/overrides`);
      setRolePerms(new Set(data.role_permissions || []));
      const map = {};
      (data.overrides || []).forEach(o => { map[o.permission_name] = o.type; });
      setOverrides(map);
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || 'Failed to load overrides' });
    } finally {
      setLoading(false);
    }
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const setOne = (permName, value) => setOverrides(prev => {
    const next = { ...prev };
    if (value === null) delete next[permName]; else next[permName] = value;
    return next;
  });

  // effective access for a permission given its current override
  const effective = (name) => {
    const o = overrides[name] ?? null;
    return o === 'grant' ? true : o === 'revoke' ? false : rolePerms.has(name);
  };

  // Bulk: force a whole group to ON (grant where role lacks) / OFF (revoke where
  // role has) / DEFAULT (clear overrides). Only writes overrides that differ from
  // the role so we don't store redundant ones.
  const bulkGroup = (perms, mode) => setOverrides(prev => {
    const next = { ...prev };
    perms.forEach(p => {
      const has = rolePerms.has(p.name);
      if (mode === 'default') { delete next[p.name]; }
      else if (mode === 'on')  { has ? delete next[p.name] : (next[p.name] = 'grant'); }
      else if (mode === 'off') { has ? (next[p.name] = 'revoke') : delete next[p.name]; }
    });
    return next;
  });

  const allPermList = useMemo(() => Object.values(allPerms || {}).flat(), [allPerms]);
  const bulkAll = (mode) => bulkGroup(allPermList, mode);

  const handleSave = async () => {
    setSaving(true); setMsg(null);
    try {
      const payload = Object.entries(overrides).map(([permission_name, type]) => ({ permission_name, type }));
      await client.put(`users/${user.id}/overrides`, { overrides: payload });
      setMsg({ type: 'success', text: `Saved — ${payload.length} override${payload.length !== 1 ? 's' : ''} active for ${user.first_name || 'this user'}.` });
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || 'Save failed' });
    } finally { setSaving(false); }
  };

  if (loading || permsLoading) {
    return <div className="flex items-center justify-center py-12 gap-3 text-text-secondary"><Loader size={20} className="animate-spin" /><span>Loading permissions…</span></div>;
  }

  const q = search.trim().toLowerCase();
  const matches = (p) => !q || p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || pretty(p.name).toLowerCase().includes(q);
  const overrideCount = Object.keys(overrides).length;
  const grantCount = Object.values(overrides).filter(v => v === 'grant').length;
  const revokeCount = Object.values(overrides).filter(v => v === 'revoke').length;
  const effGranted = allPermList.filter(p => effective(p.name)).length;

  return (
    <div className="space-y-4">
      {/* Banner */}
      <div className="rounded-xl p-3 text-sm flex items-start gap-2"
        style={{ backgroundColor: 'var(--color-primary-50, rgba(99,102,241,0.06))', border: '1px solid var(--color-primary-200, rgba(99,102,241,0.2))' }}>
        <Shield size={15} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary-600)' }} />
        <span style={{ color: 'var(--color-text-secondary)' }}>
          Base access comes from the role <strong style={{ color: 'var(--color-text)' }}>{user.role}</strong>. Toggle any option below to
          <strong style={{ color: '#16a34a' }}> grant</strong> or <strong style={{ color: '#dc2626' }}> revoke</strong> it for <strong style={{ color: 'var(--color-text)' }}>{[user.first_name, user.last_name].filter(Boolean).join(' ') || 'this user'}</strong> only — even across roles (e.g. give a fronter a closer option, or lock a single tab).
        </span>
      </div>

      {msg && <Alert type={msg.type} message={msg.text} dismissible onDismiss={() => setMsg(null)} />}

      {/* Toolbar: search + presets + summary */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search options…"
            className="input text-sm py-1.5 pl-8 w-full" />
        </div>
        <button onClick={() => bulkAll('on')} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1"
          style={{ borderColor: '#bbf7d0', color: '#16a34a' }}><Check size={12} /> Grant all</button>
        <button onClick={() => bulkAll('off')} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1"
          style={{ borderColor: '#fecaca', color: '#dc2626' }}><X size={12} /> Revoke all</button>
        <button onClick={() => bulkAll('default')} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border flex items-center gap-1"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}><RotateCcw size={12} /> Reset</button>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="px-2 py-1 rounded-full font-semibold" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>{effGranted}/{allPermList.length} options enabled</span>
        {grantCount > 0 && <span className="px-2 py-1 rounded-full font-semibold" style={{ backgroundColor: '#dcfce7', color: '#166534' }}><Zap size={10} className="inline" /> {grantCount} granted</span>}
        {revokeCount > 0 && <span className="px-2 py-1 rounded-full font-semibold" style={{ backgroundColor: '#fee2e2', color: '#991b1b' }}>{revokeCount} revoked</span>}
        {overrideCount === 0 && <span className="px-2 py-1 rounded-full" style={{ color: 'var(--color-text-tertiary)' }}>No overrides — all role defaults</span>}
      </div>

      {/* Groups */}
      {Object.entries(allPerms).map(([category, perms]) => {
        const visible = perms.filter(matches);
        if (!visible.length) return null;
        return (
          <div key={category} className="rounded-xl border border-border overflow-hidden">
            <div className="px-4 py-2 flex items-center justify-between gap-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
              <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{areaLabel(category)}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => bulkGroup(perms, 'on')} title="Grant all in this area" className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ color: '#16a34a' }}>Grant all</button>
                <button onClick={() => bulkGroup(perms, 'off')} title="Revoke all in this area" className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ color: '#dc2626' }}>Revoke all</button>
                <button onClick={() => bulkGroup(perms, 'default')} title="Reset this area" className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ color: 'var(--color-text-secondary)' }}>Reset</button>
              </div>
            </div>
            <div className="divide-y divide-border">
              {visible.map(perm => {
                const hasRole  = rolePerms.has(perm.name);
                const override = overrides[perm.name] ?? null;
                const on = effective(perm.name);
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
                    <OverridePill state={override} onChange={v => setOne(perm.name, v)} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Sticky save bar */}
      <div className="sticky bottom-0 flex items-center justify-between pt-3 pb-1 border-t border-border"
        style={{ backgroundColor: 'var(--color-surface)' }}>
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {overrideCount > 0 ? `${overrideCount} override${overrideCount !== 1 ? 's' : ''} — unsaved until you click Save` : 'No overrides — all role defaults'}
        </span>
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving} className="flex items-center gap-2">
          <Save size={15} /> Save Overrides
        </Button>
      </div>
    </div>
  );
};

export default UserPermissionsPanel;
