import React, { useState } from 'react';
import { X } from 'lucide-react';
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div
        className="bg-bg rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: 'var(--color-bg)' }}
      >
        {/* Modal Header */}
        <div
          className="flex justify-between items-center p-6 border-b"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <h2 className="text-2xl font-bold">
            {role ? 'Edit Role' : 'Create New Role'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors"
            style={{
              backgroundColor: 'var(--color-bg-secondary)',
              color: 'var(--color-text)',
            }}
          >
            <X size={24} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6">
          <RoleForm
            role={role}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
};

export default RoleModal;
