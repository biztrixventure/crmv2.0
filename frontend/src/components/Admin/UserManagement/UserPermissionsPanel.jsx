import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldX, Shield, Save, Loader } from 'lucide-react';
import { Button, Alert } from '../../../components/UI';
import { usePermissions } from '../../../hooks/usePermissions';
import client from '../../../api/client';

// 3-state pill: null (default) | 'grant' | 'revoke'
const OverridePill = ({ state, roleHas, onChange }) => {
  const defaultActive = state === null;
  const grantActive   = state === 'grant';
  const revokeActive  = state === 'revoke';

  const btn = (label, active, color, onClick) => (
    <button
      type="button"
      onClick={onClick}
      className="px-2.5 py-1 text-xs font-semibold rounded transition-all"
      style={{
        backgroundColor: active ? color + '22' : 'transparent',
        color: active ? color : 'var(--color-text-secondary)',
        border: `1.5px solid ${active ? color : 'var(--color-border)'}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      {btn('Default', defaultActive, 'var(--color-text-secondary)', () => onChange(null))}
      {btn('+ Grant', grantActive, '#16a34a', () => onChange(grantActive ? null : 'grant'))}
      {btn('− Revoke', revokeActive, '#dc2626', () => onChange(revokeActive ? null : 'revoke'))}
    </div>
  );
};

const UserPermissionsPanel = ({ user }) => {
  const { permissions: allPerms, loading: permsLoading, fetchPermissions } = usePermissions();
  const [rolePerms, setRolePerms] = useState(new Set());
  const [overrides, setOverrides] = useState({}); // { permName: 'grant'|'revoke'|null }
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'success'|'error', text }

  // Load permissions list + current overrides for this user
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
  }, [user.id]);

  useEffect(() => { load(); }, [load]);

  const handleChange = (permName, value) => {
    setOverrides(prev => {
      const next = { ...prev };
      if (value === null) delete next[permName];
      else next[permName] = value;
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const payload = Object.entries(overrides).map(([permission_name, type]) => ({ permission_name, type }));
      await client.put(`users/${user.id}/overrides`, { overrides: payload });
      setMsg({ type: 'success', text: 'Permission overrides saved.' });
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || 'Save failed' });
    } finally {
      setSaving(false);
    }
  };

  if (loading || permsLoading) {
    return (
      <div className="flex items-center justify-center py-12 gap-3 text-text-secondary">
        <Loader size={20} className="animate-spin" />
        <span>Loading permissions…</span>
      </div>
    );
  }

  const overrideCount = Object.keys(overrides).length;

  return (
    <div className="space-y-5">
      {/* Info banner */}
      <div className="rounded-xl p-3 text-sm flex items-start gap-2"
        style={{ backgroundColor: 'var(--color-primary-50, rgba(99,102,241,0.06))', border: '1px solid var(--color-primary-200, rgba(99,102,241,0.2))' }}>
        <Shield size={15} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary-600)' }} />
        <span style={{ color: 'var(--color-text-secondary)' }}>
          Role <strong style={{ color: 'var(--color-text)' }}>{user.role}</strong> defines base permissions.
          Overrides apply on top — grant extras or block specific ones for this user only.
        </span>
      </div>

      {msg && (
        <Alert type={msg.type} message={msg.text} dismissible onDismiss={() => setMsg(null)} />
      )}

      {/* Permission groups */}
      {Object.entries(allPerms).map(([category, perms]) => (
        <div key={category} className="rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-2.5 font-semibold text-sm capitalize"
            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text)' }}>
            {category.replace(/_/g, ' ')}
          </div>
          <div className="divide-y divide-border">
            {perms.map(perm => {
              const hasRole  = rolePerms.has(perm.name);
              const override = overrides[perm.name] ?? null;

              // Effective: grant override beats no-role; revoke beats has-role
              const effectiveState = override === 'grant' ? true
                                   : override === 'revoke' ? false
                                   : hasRole;

              return (
                <div key={perm.id} className="flex items-center gap-3 px-4 py-2.5">
                  {/* Status icon */}
                  {effectiveState
                    ? <ShieldCheck size={14} className="flex-shrink-0" style={{ color: '#16a34a' }} />
                    : <ShieldX size={14} className="flex-shrink-0" style={{ color: '#9ca3af' }} />
                  }
                  {/* Name + description */}
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm" style={{ color: 'var(--color-text)' }}>{perm.name}</span>
                    {perm.description && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{perm.description}</span>
                    )}
                  </div>
                  {/* Role badge */}
                  <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: hasRole ? '#dcfce7' : 'var(--color-bg-secondary)',
                      color: hasRole ? '#166534' : 'var(--color-text-tertiary)',
                      border: '1px solid',
                      borderColor: hasRole ? '#bbf7d0' : 'var(--color-border)',
                    }}>
                    {hasRole ? 'Role ✓' : 'Role ✗'}
                  </span>
                  {/* 3-state control */}
                  <OverridePill
                    state={override}
                    roleHas={hasRole}
                    onChange={v => handleChange(perm.name, v)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Save */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {overrideCount > 0 ? `${overrideCount} override${overrideCount !== 1 ? 's' : ''} active` : 'No overrides — all defaults'}
        </span>
        <Button variant="primary" onClick={handleSave} loading={saving} disabled={saving}
          className="flex items-center gap-2">
          <Save size={15} />
          Save Overrides
        </Button>
      </div>
    </div>
  );
};

export default UserPermissionsPanel;
