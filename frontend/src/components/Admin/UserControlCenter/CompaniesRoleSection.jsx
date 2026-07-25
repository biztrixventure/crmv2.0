// CompaniesRoleSection — every company assignment for the user, with per-company
// role change (PUT /users/:assignmentId { role_id }) and active toggle. "Primary"
// company is derived server-side = newest active assignment (there is no
// is_primary column), so it's shown, not edited. Company MOVE / new assignment
// stays in the existing User Management screen (superadmin-gated there too).
import { useState, useEffect } from 'react';
import { Building2, Check, Power, Loader2, Star } from 'lucide-react';
import client from '../../../api/client';
import { Badge, Alert } from '../../../components/UI';
import ThemedSelect from '../../UI/Select';

export default function CompaniesRoleSection({ account, assignments, onChanged, onPick }) {
  const [rolesByCompany, setRolesByCompany] = useState({});   // company_id → roles[]
  const [busy, setBusy] = useState(null);
  const [msg, setMsg]   = useState(null);

  // "Primary" = newest active assignment (mirrors the backbone loader).
  const primaryId = [...assignments].filter(a => a.is_active)
    .sort((x, y) => new Date(y.created_at) - new Date(x.created_at))[0]?.id || null;

  useEffect(() => {
    const companyIds = [...new Set(assignments.map(a => a.company_id).filter(Boolean))];
    companyIds.forEach(cid => {
      if (rolesByCompany[cid]) return;
      client.get('roles', { params: { company_id: cid, for_assignment: true } })
        .then(r => setRolesByCompany(prev => ({ ...prev, [cid]: r.data.roles || [] })))
        .catch(() => setRolesByCompany(prev => ({ ...prev, [cid]: [] })));
    });
  }, [assignments]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 4000); };

  const changeRole = async (a, roleId) => {
    if (!roleId || roleId === a.role_id) return;
    setBusy(a.id + ':role');
    try { await client.put(`users/${a.id}`, { role_id: roleId }); flash('success', 'Role updated.'); onChanged?.(); }
    catch (e) { flash('error', e.response?.data?.error || 'Update failed.'); }
    finally { setBusy(null); }
  };

  const toggleActive = async (a) => {
    setBusy(a.id + ':active');
    try { await client.put(`users/${a.id}`, { is_active: !a.is_active }); flash('success', a.is_active ? 'Deactivated.' : 'Reactivated.'); onChanged?.(); }
    catch (e) { flash('error', e.response?.data?.error || 'Failed.'); }
    finally { setBusy(null); }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Building2 size={16} style={{ color: 'var(--color-primary-600)' }} />
        <h3 className="text-sm font-bold text-text">Company assignments ({assignments.length})</h3>
      </div>
      {msg && <div className="mb-3"><Alert type={msg.type}>{msg.text}</Alert></div>}

      <div className="space-y-3">
        {assignments.map(a => {
          const roles = rolesByCompany[a.company_id] || [];
          const isPrimary = a.id === primaryId;
          return (
            <div key={a.id} className="rounded-xl p-4 flex items-center gap-4 flex-wrap"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', opacity: a.is_active ? 1 : 0.65 }}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-text">{a.company_name || '—'}</span>
                  {isPrimary && <span className="inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: 'var(--color-warning-600)' }}><Star size={11} fill="currentColor" /> Primary</span>}
                  <Badge variant={a.is_active ? 'success' : 'error'}>{a.is_active ? 'Active' : 'Inactive'}</Badge>
                </div>
                <p className="text-[11px] text-text-secondary mt-0.5">Assignment {a.id.slice(0, 8)}… · role: {a.role || a.role_level}</p>
              </div>

              {/* Role picker (scoped to that company, strictly-lower levels) */}
              <div className="w-56">
                <ThemedSelect value={a.role_id || ''} onChange={e => changeRole(a, e.target.value)} className="input"
                  disabled={busy === a.id + ':role' || roles.length === 0}>
                  {roles.length === 0 && <option value={a.role_id || ''}>{a.role || a.role_level}</option>}
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}{r.level ? ` (${r.level.replace(/_/g, ' ')})` : ''}</option>)}
                </ThemedSelect>
              </div>

              <button onClick={() => onPick?.(a.id)}
                className="text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-primary-600)' }}>
                <Check size={13} /> Use context
              </button>

              <button onClick={() => toggleActive(a)} disabled={busy === a.id + ':active'}
                className="text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: a.is_active ? 'var(--color-warning-600)' : 'var(--color-success-600)' }}>
                {busy === a.id + ':active' ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                {a.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          );
        })}
        {assignments.length === 0 && <div className="text-sm text-text-secondary py-6 text-center">No company assignments.</div>}
      </div>
      <p className="text-[11px] text-text-secondary mt-3">To move a user to a different company or add a new company assignment, use User Management (company reassignment is superadmin-only).</p>
    </div>
  );
}
