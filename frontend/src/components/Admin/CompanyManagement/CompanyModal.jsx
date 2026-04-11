import React, { useState, useEffect } from 'react';
import { Modal, Button } from '../../../components/UI';
import CompanyForm from './CompanyForm';

/**
 * CompanyModal Component
 * Modal wrapper for company form (create/edit)
 */
const CompanyModal = ({ company = null, onClose, onSave }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleSave = async (formData) => {
    setIsLoading(true);
    try {
      await onSave(formData);
      onClose();
    } catch (err) {
      // Error handled in parent component
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={company ? 'Edit Company' : 'Create Company'}
      size="md"
    >
      <CompanyForm
        company={company}
        onSubmit={handleSave}
        isLoading={isLoading}
      />
    </Modal>
  );
};

export default CompanyModal;
