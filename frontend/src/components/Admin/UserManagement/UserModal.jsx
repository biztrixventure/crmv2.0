import React, { useState, useEffect } from 'react';
import { UserCog, ShieldCheck, LayoutTemplate } from 'lucide-react';
import { Modal } from '../../../components/UI';
import { useAuth } from '../../../contexts/AuthContext';
import UserForm from './UserForm';
import UserPermissionsPanel from './UserPermissionsPanel';
import UserRecordViewsPanel from './UserRecordViewsPanel';
import client from '../../../api/client';

const UserModal = ({ user = null, onClose, onSave }) => {
  const { user: viewer } = useAuth();
  const isSuperadmin = viewer?.role === 'superadmin';
  const TABS = [
    { id: 'details',      label: 'Details',      icon: UserCog },
    { id: 'permissions',  label: 'Permissions',  icon: ShieldCheck },
    // Per-user record-view layout writes global business-config → superadmin only.
    ...(isSuperadmin ? [{ id: 'record_views', label: 'Record Views', icon: LayoutTemplate }] : []),
  ];
  const [tab, setTab]           = useState('details');
  const [isLoading, setIsLoading] = useState(false);
  const [roles, setRoles]       = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);

  useEffect(() => {
    const companyId = user?.company_id;
    client.get('roles', { params: { company_id: companyId, for_assignment: true } })
      .then(res => setRoles(res.data.roles || []))
      .catch(() => {})
      .finally(() => setRolesLoading(false));
  }, [user?.company_id]);

  // Reset to Details tab when user changes
  useEffect(() => { setTab('details'); }, [user?.id]);

  const handleSubmit = async (formData) => {
    setIsLoading(true);
    try {
      await onSave(formData);
      onClose();
    } catch {
      setIsLoading(false);
    }
  };

  const isEdit = !!user;

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={isEdit ? `Edit User — ${user.email || ''}` : 'Add New User'}
      size="2xl"
    >
      {/* Tabs — only in edit mode */}
      {isEdit && (
        <div className="flex gap-1 mb-5 border-b border-border">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px"
                style={{
                  borderBottomColor: active ? 'var(--color-primary-600)' : 'transparent',
                  color: active ? 'var(--color-primary-600)' : 'var(--color-text-secondary)',
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      {rolesLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : tab === 'details' ? (
        <UserForm
          user={user}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          roles={roles}
        />
      ) : tab === 'record_views' ? (
        <UserRecordViewsPanel user={user} />
      ) : (
        <UserPermissionsPanel user={user} />
      )}
    </Modal>
  );
};

export default UserModal;
