import React, { useState, useEffect } from 'react';
import { Button, FormField } from '../../../components/UI';
import PermissionMatrix from './PermissionMatrix';

/**
 * RoleForm Component
 * Form to create/edit roles with validation
 */
const RoleForm = ({ role = null, onSubmit, isLoading = false }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    level: 'manager',
    permissions: [],
  });
  const [errors, setErrors] = useState({});

  // Initialize form with role data if editing
  useEffect(() => {
    if (role) {
      setFormData({
        name: role.name,
        description: role.description || '',
        level: role.level,
        permissions: role.permissions || [],
      });
    }
  }, [role]);

  // Validate form
  const validate = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Role name is required';
    }

    if (!formData.level) {
      newErrors.level = 'Role level is required';
    }

    if (formData.permissions.length === 0) {
      newErrors.permissions = 'At least one permission must be selected';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  };

  // Handle input change
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
    // Clear error for this field
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: '',
      }));
    }
  };

  // Handle permissions change
  const handlePermissionsChange = (permissions) => {
    setFormData(prev => ({
      ...prev,
      permissions,
    }));
    if (errors.permissions) {
      setErrors(prev => ({
        ...prev,
        permissions: '',
      }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Role Name */}
      <FormField
        label="Role Name"
        required
        error={errors.name}
      >
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleInputChange}
          disabled={role !== null}
          placeholder="e.g., SuperAdmin, Manager"
          className="input"
        />
      </FormField>

      {/* Description */}
      <FormField label="Description">
        <textarea
          name="description"
          value={formData.description}
          onChange={handleInputChange}
          placeholder="Role description (optional)"
          rows="3"
          className="input"
        />
      </FormField>

      {/* Role Level */}
      <FormField
        label="Role Level"
        required
        error={errors.level}
      >
        <select
          name="level"
          value={formData.level}
          onChange={handleInputChange}
          disabled={role !== null}
          className="input"
        >
          <option value="">Select level</option>
          <option value="superadmin">SuperAdmin</option>
          <option value="company_admin">Company Admin</option>
          <option value="manager">Manager</option>
          <option value="operations">Operations</option>
        </select>
      </FormField>

      {/* Permissions Matrix */}
      <div>
        <PermissionMatrix
          selectedPermissions={formData.permissions}
          onChange={handlePermissionsChange}
        />
        {errors.permissions && (
          <p className="text-sm mt-2 text-error-600">
            {errors.permissions}
          </p>
        )}
      </div>

      {/* Submit Button */}
      <div className="flex justify-end pt-6 border-t border-border">
        <Button
          type="submit"
          variant="primary"
          loading={isLoading}
          disabled={isLoading}
        >
          {isLoading ? 'Saving...' : role ? 'Update Role' : 'Create Role'}
        </Button>
      </div>
    </form>
  );
};

export default RoleForm;
