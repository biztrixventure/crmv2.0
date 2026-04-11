import React, { useState, useEffect } from 'react';
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
      <div>
        <label className="block text-sm font-semibold mb-2">Role Name</label>
        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={handleInputChange}
          disabled={role !== null}
          placeholder="e.g., SuperAdmin, Manager"
          className="w-full px-4 py-2 rounded-lg border"
          style={{
            borderColor: errors.name ? 'var(--color-error-300)' : 'var(--color-border)',
            backgroundColor: role !== null ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
        />
        {errors.name && (
          <p className="text-sm mt-1" style={{ color: 'var(--color-error-600)' }}>
            {errors.name}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-semibold mb-2">Description</label>
        <textarea
          name="description"
          value={formData.description}
          onChange={handleInputChange}
          placeholder="Role description (optional)"
          rows="3"
          className="w-full px-4 py-2 rounded-lg border"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
        />
      </div>

      {/* Role Level */}
      <div>
        <label className="block text-sm font-semibold mb-2">Role Level</label>
        <select
          name="level"
          value={formData.level}
          onChange={handleInputChange}
          disabled={role !== null}
          className="w-full px-4 py-2 rounded-lg border"
          style={{
            borderColor: errors.level ? 'var(--color-error-300)' : 'var(--color-border)',
            backgroundColor: role !== null ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
        >
          <option value="">Select level</option>
          <option value="superadmin">SuperAdmin</option>
          <option value="company_admin">Company Admin</option>
          <option value="manager">Manager</option>
          <option value="operations">Operations</option>
        </select>
        {errors.level && (
          <p className="text-sm mt-1" style={{ color: 'var(--color-error-600)' }}>
            {errors.level}
          </p>
        )}
      </div>

      {/* Permissions Matrix */}
      <div>
        <PermissionMatrix
          selectedPermissions={formData.permissions}
          onChange={handlePermissionsChange}
        />
        {errors.permissions && (
          <p className="text-sm mt-2" style={{ color: 'var(--color-error-600)' }}>
            {errors.permissions}
          </p>
        )}
      </div>

      {/* Submit Button */}
      <div className="flex justify-end pt-6 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button
          type="submit"
          disabled={isLoading}
          className="px-6 py-2 rounded-lg font-semibold transition-opacity"
          style={{
            backgroundColor: 'var(--color-primary-600)',
            color: 'white',
            opacity: isLoading ? 0.6 : 1,
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {isLoading ? 'Saving...' : role ? 'Update Role' : 'Create Role'}
        </button>
      </div>
    </form>
  );
};

export default RoleForm;
