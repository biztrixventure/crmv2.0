import { useState, useEffect, useCallback } from 'react';
import { Info, RotateCcw } from 'lucide-react';
import client from '../../../api/client';
import DrawerLayoutRules from '../BusinessRules/DrawerLayoutRules';
import { clearDrawerLayoutCache } from '../../../hooks/useDrawerLayout';
import RecordViewTemplates from './RecordViewTemplates';

const RV_TYPES = ['sale', 'transfer', 'callback'];

// Per-user record-view layout. Reuses the rich per-role drawer editor, but
// targets drawer.layout.<type>.user.<userId> (which useDrawerLayout resolves
// BEFORE the role layout). Superadmin-only — the save hits business-config.
export default function UserRecordViewsPanel({ user }) {
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    client.get('business-config')
      .then(r => setConfig(r.data?.config || {}))
      .catch(() => setConfig({}))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));   // optimistic so the editor reflects it
    try {
      await client.put('business-config', { scope: 'global', key, value });
      setMsg({ type: 'ok', text: 'Saved' }); setTimeout(() => setMsg(null), 1400);
    } catch (e) {
      setMsg({ type: 'err', text: e.response?.data?.error || 'Save failed' });
    }
  };

  if (loading) {
    return <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" /></div>;
  }

  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'this user';
  const uid = user.user_id || user.id;
  const userRole = (user.role_level || user.custom_roles?.level || user.role || '').toLowerCase() || null;
  const hasOverride = RV_TYPES.some(t => Array.isArray(config[`drawer.layout.${t}.user.${uid}`]));

  // Remove this user's per-user layouts → they fall back to their role layout.
  const resetToRole = async () => {
    if (!window.confirm(`Remove ${userName}'s custom record views and follow their role layout everywhere?`)) return;
    for (const t of RV_TYPES) {
      const key = `drawer.layout.${t}.user.${uid}`;
      if (config[key]) { try { await client.delete(`business-config/global/${key}`); } catch { /* ignore */ } }
    }
    clearDrawerLayoutCache();
    setConfig(prev => { const n = { ...prev }; RV_TYPES.forEach(t => delete n[`drawer.layout.${t}.user.${uid}`]); return n; });
    setMsg({ type: 'ok', text: 'Removed — now following role layout.' }); setTimeout(() => setMsg(null), 2200);
  };

  return (
    <div>
      <div className="rounded-xl p-3 mb-3 text-sm flex items-start gap-2"
        style={{ backgroundColor: 'var(--color-primary-50, rgba(99,102,241,0.06))', border: '1px solid var(--color-primary-200, rgba(99,102,241,0.2))' }}>
        <Info size={15} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary-600)' }} />
        <span style={{ color: 'var(--color-text-secondary)' }}>
          Control exactly what <strong style={{ color: 'var(--color-text)' }}>{userName}</strong> sees inside the Sale / Transfer / Callback record drawers — hide whole sections or individual fields (Down Payment, VIN, …), reorder them, and move fields between sections. This overrides their role layout; untouched drawers keep the role default.
        </span>
      </div>
      {hasOverride && (
        <div className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded-lg"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-warning-800, #92400e)' }}>
            {userName} has custom record views overriding their role.
          </span>
          <button onClick={resetToRole}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1.5 flex-shrink-0 hover:opacity-80"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
            <RotateCcw size={12} /> Reset to role default
          </button>
        </div>
      )}
      {msg && <p className="text-xs mb-2 font-semibold" style={{ color: msg.type === 'ok' ? '#16a34a' : '#dc2626' }}>{msg.text}</p>}
      <RecordViewTemplates uid={uid} userRole={userRole} userName={userName} companyId={user.company_id} config={config} onApplied={load} />
      <DrawerLayoutRules config={config} scope="global" userId={uid} userName={userName} userRole={userRole} onSave={save} />
    </div>
  );
}
