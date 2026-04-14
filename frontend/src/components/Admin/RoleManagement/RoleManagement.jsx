import { useState, useEffect } from 'react';
import { Plus, Zap } from 'lucide-react';
import { Button, Alert } from '../../../components/UI';
import { useAuth } from '../../../contexts/AuthContext';
import { useRoles } from '../../../hooks/useRoles';
import client from '../../../api/client';
import RoleList from './RoleList';
import RoleModal from './RoleModal';

/**
 * RoleManagement Component
 * Main container for role management features
 * Handles CRUD operations for roles
 */
const RoleManagement = () => {
  const { user } = useAuth();
  const { roles, loading, error, fetchRoles, createRole, updateRole, deleteRole } = useRoles(user?.company_id);
  const [showModal, setShowModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');

  // Fetch roles on component mount
  useEffect(() => {
    fetchRoles();
  }, []);

  // Handle add role button click
  const handleAddRole = () => {
    setSelectedRole(null);
    setShowModal(true);
  };

  // Handle edit role
  const handleEditRole = (role) => {
    setSelectedRole(role);
    setShowModal(true);
  };

  // Handle delete role with confirmation
  const handleDeleteRole = async (roleId) => {
    if (window.confirm('Are you sure you want to delete this role?')) {
      try {
        await deleteRole(roleId);
        // Show success message (can use toast notification)
      } catch (err) {
        // Error handled in hook
      }
    }
  };

  const handleSeedDefaults = async () => {
    if (!window.confirm('Create default BLP roles for this company? Existing roles with same names will be skipped.')) return;
    setSeeding(true);
    setSeedMsg('');
    try {
      const res = await client.post(`roles/seed-defaults?company_id=${user.company_id}`);
      setSeedMsg(`Created ${res.data.created} role(s). ${res.data.skipped} skipped (already exist).`);
      fetchRoles();
      setTimeout(() => setSeedMsg(''), 6000);
    } catch (err) {
      setSeedMsg(err.response?.data?.error || 'Seed failed');
      setTimeout(() => setSeedMsg(''), 6000);
    } finally {
      setSeeding(false);
    }
  };

  // Handle modal save
  const handleSaveRole = async (roleData) => {
    try {
      if (selectedRole) {
        // Update existing role
        await updateRole(selectedRole.id, roleData.description, roleData.permissions);
      } else {
        // Create new role
        await createRole(roleData.name, roleData.description, roleData.level, roleData.permissions);
      }
      setShowModal(false);
      setSelectedRole(null);
    } catch (err) {
      // Error handled in hook
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-bold text-text">Roles & Permissions</h2>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSeedDefaults}
            variant="secondary"
            size="md"
            loading={seeding}
            disabled={seeding}
            className="flex items-center gap-2"
          >
            <Zap size={16} />
            <span>Seed BLP Defaults</span>
          </Button>
          <Button
            onClick={handleAddRole}
            variant="primary"
            size="md"
            className="flex items-center gap-2"
          >
            <Plus size={20} />
            <span>Create Role</span>
          </Button>
        </div>
      </div>

      {seedMsg && (
        <Alert
          type={seedMsg.includes('failed') || seedMsg.includes('error') ? 'error' : 'success'}
          message={seedMsg}
          className="mb-4"
          dismissible
          onDismiss={() => setSeedMsg('')}
        />
      )}

      {/* Error message */}
      {error && (
        <Alert
          type="error"
          title="Error"
          message={error}
          className="mb-6"
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      )}

      {/* Role list */}
      {!loading && <RoleList roles={roles} onEdit={handleEditRole} onDelete={handleDeleteRole} />}

      {/* Role modal */}
      {showModal && (
        <RoleModal
          role={selectedRole}
          onClose={() => {
            setShowModal(false);
            setSelectedRole(null);
          }}
          onSave={handleSaveRole}
        />
      )}
    </div>
  );
};

export default RoleManagement;
