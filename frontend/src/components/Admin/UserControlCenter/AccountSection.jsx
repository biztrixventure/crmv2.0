// AccountSection — profile edit (reuses UserForm → PUT /users/:assignmentId) +
// account actions (reset password, send reset link, impersonate, activate/
// deactivate, delete). All actions hit the existing audited /users endpoints.
//
// UI from components/UI/kit (docs/ui-design-system.md). This tab previously had
// NO loading state at all — it now shows the same skeleton every other tab uses
// while the role list the profile form needs is loading.
import { useState, useEffect } from 'react';
import { KeyRound, Send, LogIn, Power, Trash2, UserCog, Wrench } from 'lucide-react';
import client from '../../../api/client';
import { Button, Alert } from '../../../components/UI';
import { SectionHeader, Loading, EmptyState, ActionRow, useFlash, accent } from '../../UI/kit';
import UserForm from '../UserManagement/UserForm';

export default function AccountSection({ account, assignment, onChanged }) {
  const [roles, setRoles]     = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [busy, setBusy]       = useState(null);   // which action is running
  const { msg, flash, clear } = useFlash();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!assignment?.company_id) { setRoles([]); setRolesLoading(false); return; }
    let alive = true;
    setRolesLoading(true);
    client.get('roles', { params: { company_id: assignment.company_id, for_assignment: true } })
      .then(r => { if (alive) setRoles(r.data.roles || []); })
      .catch(() => { if (alive) setRoles([]); })
      .finally(() => { if (alive) setRolesLoading(false); });
    return () => { alive = false; };
  }, [assignment?.company_id]);

  if (!assignment) {
    return <EmptyState icon={UserCog} title="No company assignment to edit" hint="Assign this user to a company on the Companies & Role tab first." />;
  }

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
    try { await client.post(`users/${assignment.id}/send-invite`); flash('success', 'Recovery link generated (emailed if SMTP is configured).'); }
    catch (e) { flash('error', e.response?.data?.error || 'Could not send link.'); }
    finally { setBusy(null); }
  };

  const impersonate = async () => {
    setBusy('impersonate');
    try {
      const { data } = await client.post(`users/${account.user_id}/impersonate`);
      const link = data?.link || data?.action_link;   // backend returns { link }
      if (link) { window.open(link, '_blank', 'noopener'); flash('success', 'Impersonation link opened in a new tab.'); }
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

  const danger = accent('danger');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
      {/* Profile form (reused) */}
      <div>
        <SectionHeader icon={UserCog} title={`Profile · ${assignment.company_name || '—'}`} />
        {msg && <div className="mb-3"><Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert></div>}
        {rolesLoading
          ? <Loading variant="rows" rows={6} label="Loading profile…" />
          : <UserForm user={assignment} onSubmit={saveProfile} isLoading={saving} roles={roles} />}
      </div>

      {/* Account actions */}
      <div>
        <SectionHeader icon={Wrench} title="Account actions" />
        <div className="space-y-2.5">
          <ActionRow icon={KeyRound} label="Reset password" hint="Set a new password directly" onClick={resetPassword} busy={busy === 'password'} />
          <ActionRow icon={Send} label="Send reset link" hint="Email a recovery / set-password link" onClick={sendResetLink} busy={busy === 'link'} />
          <ActionRow icon={LogIn} label="Impersonate (login as)" hint="Open a one-time login link in a new tab" onClick={impersonate} busy={busy === 'impersonate'} />
          <ActionRow icon={Power}
            label={assignment.is_active ? 'Deactivate' : 'Reactivate'}
            hint={assignment.is_active ? 'Block this assignment from logging in' : 'Restore access'}
            onClick={toggleActive} busy={busy === 'active'}
            tone={assignment.is_active ? 'warn' : 'success'} />
          <div className="pt-2 mt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
            {!confirmDelete ? (
              <ActionRow icon={Trash2} label="Delete user" hint="Removes auth login + deactivates assignment" onClick={() => setConfirmDelete(true)} tone="danger" />
            ) : (
              <div className="rounded-xl p-3" style={{ background: danger.soft, border: `1px solid ${danger.fg}` }}>
                <p className="text-xs font-semibold mb-2" style={{ color: danger.fg }}>Delete {account.email}? This removes their auth login.</p>
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
