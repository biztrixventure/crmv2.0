import React, { useState, useEffect } from 'react';
import { Modal } from '../../../components/UI';
import UserForm from './UserForm';
import client from '../../../api/client';

/**
 * UserModal Component
 * Modal wrapper for UserForm
 */
const UserModal = ({ user = null, onClose, onSave }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);

  // Fetch available roles
  useEffect(() => {
    const fetchRoles = async () => {
      try {
        const rolesRes = await client.get('roles');
        setRoles(rolesRes.data.roles || []);
      } catch (err) {
        console.error('Failed to fetch roles:', err);
      } finally {
        setRolesLoading(false);
      }
    };

    fetchRoles();
  }, []);

  // Handle form submission
  const handleSubmit = async (formData) => {
    setIsLoading(true);
    try {
      await onSave(formData);
      onClose();
    } catch (error) {
      // Error is handled in the parent component
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={user ? 'Edit User' : 'Add New User'}
      size="2xl"
    >
      {rolesLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <UserForm
          user={user}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          roles={roles}
        />
      )}
    </Modal>
  );
};

export default UserModal;
