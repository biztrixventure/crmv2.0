import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button, Alert } from '../../../components/UI';
import { useAuth } from '../../../contexts/AuthContext';
import { useRoles } from '../../../hooks/useRoles';
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
