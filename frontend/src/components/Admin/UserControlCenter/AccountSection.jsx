// AccountSection — profile edit (reuses UserForm → PUT /users/:assignmentId) +
// account actions (reset password, send reset link, impersonate, activate/
// deactivate, delete). All actions hit the existing audited /users endpoints.
import { useState, useEffect } from 'react';
import { KeyRound, Send, LogIn, Power, Trash2, Loader2 } from 'lucide-react';
import client from '../../../api/client';
import { Button, Alert } from '../../../components/UI';
import UserForm from '../UserManagement/UserForm';

export default function AccountSection({ account, assignment, onChanged }) {
  const [roles, setRoles]     = useState([]);
  const [saving, setSaving]   = useState(false);
  const [busy, setBusy]       = useState(null);   // which action is running
  const [msg, setMsg]         = useState(null);   // { type, text }
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!assignment?.company_id) { setRoles([]); return; }
    client.get('roles', { params: { company_id: assignment.company_id, for_assignment: true } })
      .then(r => setRoles(r.data.roles || [])).catch(() => setRoles([]));
  }, [assignment?.company_id]);

  const flash = (type, text) => { setMsg({ type, text }); setTimeout(() => setMsg(null), 5000); };

  if (!assignment) return <div className="text-sm text-text-secondary py-8 text-center">No company assignment to edit.</div>;

  // Save profile via the existing PUT /users/:id (assignment id).
  const saveProfile = async (payload) => {
    setSaving(true);
    try {
      await client.put(`users/${assignment.id}`, payload);
      flash('success', 'Profile saved.');
      onChanged?.();
    } catch (e) {
      flash('error', e.response?.data?.error || 'Save failed.');
      throw e;   // keep UserForm's loading state honest
    } finally { setSaving(false); }
  };

  const resetPassword = async () => {
    const pw = window.prompt('New password (min 8 chars):');
    if (pw == null) return;
    if (pw.trim().length < 8) { flash('error', 'Password must be at least 8 characters.'); return; }
    setBusy('password');
    try { await client.put(`users/${assignment.id}/password`, { password: pw.trim() }); flash('success', 'Password reset.'); }
    catch (e) { flash('error', e.response?.data?.error || 'Reset failed.'); }
    finally { setBusy(null); }
  };

  const sendResetLink = async () => {
    setBusy('link');
    try { await client.post(`users/${assignment.id}/send-invite`); flash('success', 'Reset/invite link generated & emailed.'); }
    catch (e) { flash('error', e.response?.data?.error || 'Could not send link.'); }
    finally { setBusy(null); }
  };

  const impersonate = async () => {
    setBusy('impersonate');
    try {
      const { data } = await client.post(`users/${account.user_id}/impersonate`);
      if (data?.action_link) { window.open(data.action_link, '_blank', 'noopener'); flash('success', 'Impersonation link opened in a new tab.'); }
      else flash('error', 'No impersonation link returned.');
    } catch (e) { flash('error', e.response?.data?.error || 'Impersonate failed.'); }
    finally { setBusy(null); }
  };

  const toggleActive = async () => {
    setBusy('active');
    try { await client.put(`users/${assignment.id}`, { is_active: !assignment.is_active }); flash('success', assignment.is_active ? 'Deactivated.' : 'Reactivated.'); onChanged?.(); }
    catch (e) { flash('error', e.response?.data?.error || 'Failed.'); }
    finally { setBusy(null); }
  };

  const doDelete = async () => {
    setBusy('delete');
    try { await client.delete(`users/${assignment.id}`); flash('success', 'User deleted (auth removed, assignment deactivated).'); setConfirmDelete(false); onChanged?.(); }
    catch (e) { flash('error', e.response?.data?.error || 'Delete failed.'); }
    finally { setBusy(null); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      {/* Profile form (reused) */}
      <div>
        <h3 className="text-sm font-bold text-text mb-3">Profile · {assignment.company_name || '—'}</h3>
        {msg && <div className="mb-3"><Alert type={msg.type}>{msg.text}</Alert></div>}
        <UserForm user={assignment} onSubmit={saveProfile} isLoading={saving} roles={roles} />
      </div>

      {/* Account actions */}
      <div>
        <h3 className="text-sm font-bold text-text mb-3">Account actions</h3>
        <div className="space-y-2.5">
          <ActionBtn icon={KeyRound} label="Reset password" hint="Set a new password directly" onClick={resetPassword} busy={busy === 'password'} />
          <ActionBtn icon={Send} label="Send reset link" hint="Email a recovery / set-password link" onClick={sendResetLink} busy={busy === 'link'} />
          <ActionBtn icon={LogIn} label="Impersonate (login as)" hint="Open a one-time login link in a new tab" onClick={impersonate} busy={busy === 'impersonate'} />
          <ActionBtn icon={Power} label={assignment.is_active ? 'Deactivate' : 'Reactivate'} hint={assignment.is_active ? 'Block this assignment from logging in' : 'Restore access'} onClick={toggleActive} busy={busy === 'active'}
            tone={assignment.is_active ? 'warn' : 'ok'} />
          <div className="pt-2 mt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            {!confirmDelete ? (
              <ActionBtn icon={Trash2} label="Delete user" hint="Removes auth login + deactivates assignment" onClick={() => setConfirmDelete(true)} tone="danger" />
            ) : (
              <div className="rounded-lg p-3" style={{ background: 'var(--color-error-50, rgba(239,68,68,0.08))', border: '1px solid var(--color-error-500)' }}>
                <p className="text-xs font-semibold mb-2" style={{ color: 'var(--color-error-600)' }}>Delete {account.email}? This removes their auth login.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="danger" loading={busy === 'delete'} onClick={doDelete}>Yes, delete</Button>
                  <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ icon: Icon, label, hint, onClick, busy, tone = 'default' }) {
  const color = tone === 'danger' ? 'var(--color-error-600)' : tone === 'warn' ? 'var(--color-warning-600)' : tone === 'ok' ? 'var(--color-success-600)' : 'var(--color-text)';
  return (
    <button onClick={onClick} disabled={busy}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors disabled:opacity-60"
      style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      {busy ? <Loader2 size={16} className="animate-spin flex-shrink-0" style={{ color }} /> : <Icon size={16} className="flex-shrink-0" style={{ color }} />}
      <span className="min-w-0">
        <span className="block text-sm font-semibold" style={{ color }}>{label}</span>
        <span className="block text-[11px] text-text-secondary truncate">{hint}</span>
      </span>
    </button>
  );
}
