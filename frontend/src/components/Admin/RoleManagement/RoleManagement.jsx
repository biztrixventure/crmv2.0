import React, { useState, useEffect } from 'react';
import { Plus, AlertCircle, Loader } from 'lucide-react';
import { useRoles } from '../../../hooks/useRoles';
import RoleList from './RoleList';
import RoleModal from './RoleModal';

/**
 * RoleManagement Component
 * Main container for role management features
 * Handles CRUD operations for roles
 */
const RoleManagement = () => {
  const { roles, loading, error, fetchRoles, createRole, updateRole, deleteRole } = useRoles();
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
        <h2 className="text-3xl font-bold">Roles & Permissions</h2>
        <button
          onClick={handleAddRole}
          className="btn-primary flex items-center space-x-2"
        >
          <Plus size={20} />
          <span>Create Role</span>
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div
          className="mb-6 p-4 rounded-lg flex items-center space-x-2"
          style={{
            backgroundColor: 'var(--color-error-100)',
            color: 'var(--color-error-700)',
            border: '1px solid var(--color-error-300)',
          }}
        >
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <Loader size={32} className="animate-spin" />
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
