import React, { useState } from 'react';
import { Modal } from '../../../components/UI';
import RoleForm from './RoleForm';

/**
 * RoleModal Component
 * Modal wrapper for RoleForm
 */
const RoleModal = ({ role = null, onClose, onSave }) => {
  const [isLoading, setIsLoading] = useState(false);

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
      title={role ? 'Edit Role' : 'Create New Role'}
      size="2xl"
    >
      <RoleForm
        role={role}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </Modal>
  );
};

export default RoleModal;
