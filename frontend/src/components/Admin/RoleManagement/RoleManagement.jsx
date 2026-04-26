import { useState, useEffect } from 'react';
import { Plus, Zap, AlertTriangle } from 'lucide-react';
import { Button, Alert } from '../../../components/UI';
import { useAuth } from '../../../contexts/AuthContext';
import { useRoles } from '../../../hooks/useRoles';
import client from '../../../api/client';
import RoleList from './RoleList';
import RoleModal from './RoleModal';

const RoleManagement = () => {
  const { user } = useAuth();
  const { roles, loading, error, fetchRoles, createRole, updateRole, deleteRole } = useRoles(user?.company_id);
  const [showModal, setShowModal]     = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const [seeding, setSeeding]         = useState(false);
  const [seedMsg, setSeedMsg]         = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting]       = useState(false);

  useEffect(() => { fetchRoles(); }, []);

  const handleEditRole = (role) => { setSelectedRole(role); setShowModal(true); };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteRole(confirmDeleteId);
    } catch {
      // error shown via hook
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    setSeedMsg('');
    try {
      const res = await client.post(`roles/seed-defaults?company_id=${user.company_id}`);
      const c = res.data.created?.length ?? 0;
      const s = res.data.skipped?.length ?? 0;
      setSeedMsg(`Created ${c} role(s). ${s} skipped (already exist).`);
      fetchRoles();
      setTimeout(() => setSeedMsg(''), 6000);
    } catch (err) {
      setSeedMsg(err.response?.data?.error || 'Seed failed');
      setTimeout(() => setSeedMsg(''), 6000);
    } finally {
      setSeeding(false);
    }
  };

  const handleSaveRole = async (roleData) => {
    try {
      if (selectedRole) {
        await updateRole(selectedRole.id, roleData.description, roleData.permissions);
      } else {
        await createRole(roleData.name, roleData.description, roleData.level, roleData.permissions);
      }
      setShowModal(false);
      setSelectedRole(null);
    } catch {
      // error handled in hook
    }
  };

  const confirmRole = roles.find(r => r.id === confirmDeleteId);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Roles & Permissions</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {roles.length} role{roles.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleSeedDefaults} variant="secondary" size="md" loading={seeding} disabled={seeding}
            className="flex items-center gap-2">
            <Zap size={15} />
            <span>Seed Defaults</span>
          </Button>
          <Button onClick={() => { setSelectedRole(null); setShowModal(true); }} variant="primary" size="md"
            className="flex items-center gap-2">
            <Plus size={18} />
            <span>Create Role</span>
          </Button>
        </div>
      </div>

      {seedMsg && (
        <Alert type={seedMsg.includes('failed') || seedMsg.includes('error') ? 'error' : 'success'}
          message={seedMsg} className="mb-4" dismissible onDismiss={() => setSeedMsg('')} />
      )}
      {error && <Alert type="error" title="Error" message={error} className="mb-6" />}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      ) : (
        <RoleList roles={roles} onEdit={handleEditRole} onDelete={setConfirmDeleteId} />
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="rounded-2xl p-6 max-w-sm w-full"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'var(--color-error-100)' }}>
                <AlertTriangle size={18} style={{ color: 'var(--color-error-600)' }} />
              </div>
              <div>
                <p className="font-bold" style={{ color: 'var(--color-text)' }}>Delete Role</p>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  "{confirmRole?.name}" will be permanently deleted.
                </p>
              </div>
            </div>
            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
              This cannot be undone. Roles assigned to active users cannot be deleted.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2 rounded-xl border text-sm font-semibold"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button onClick={handleDeleteConfirm} disabled={deleting}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-opacity"
                style={{ backgroundColor: 'var(--color-error-600)', opacity: deleting ? 0.6 : 1 }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <RoleModal role={selectedRole}
          onClose={() => { setShowModal(false); setSelectedRole(null); }}
          onSave={handleSaveRole} />
      )}
    </div>
  );
};

export default RoleManagement;
