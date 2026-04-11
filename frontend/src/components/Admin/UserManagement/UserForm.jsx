import React, { useState, useEffect } from 'react';
import { Button, FormField } from '../../../components/UI';
import { useCompanies } from '../../../hooks/useCompanies';

/**
 * UserForm Component
 * Form to create/edit users
 */
const UserForm = ({ user = null, onSubmit, isLoading = false, roles = [] }) => {
  const { companies, loading: companiesLoading, fetchAvailableCompanies } = useCompanies();
  const [formData, setFormData] = useState({
    email: '',
    first_name: '',
    last_name: '',
    role_id: '',
    password: '',
    company_id: '',
  });
  const [errors, setErrors] = useState({});

  // Fetch available companies on mount
  useEffect(() => {
    fetchAvailableCompanies();
  }, [fetchAvailableCompanies]);

  // Initialize form with user data if editing
  useEffect(() => {
    if (user) {
      setFormData({
        email: user.email || '',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        role_id: user.role_id || '',
        password: '', // Always empty in edit mode - only update if explicitly provided
        company_id: user.company_id || '', // Show user's current company
      });
    } else {
      // Pre-select user's primary company for CREATE mode
      const userCompanyId = localStorage.getItem('user_company_id');
      setFormData((prev) => ({
        ...prev,
        company_id: userCompanyId || '',
      }));
    }
  }, [user]);

  // Validate form
  const validate = () => {
    const newErrors = {};

    if (!formData.email || !formData.email.includes('@')) {
      newErrors.email = 'Valid email is required';
    }

    if (!formData.first_name || !formData.first_name.trim()) {
      newErrors.first_name = 'First name is required';
    }

    if (!formData.last_name || !formData.last_name.trim()) {
      newErrors.last_name = 'Last name is required';
    }

    if (!formData.role_id) {
      newErrors.role_id = 'Role is required';
    }

    // Company validation - required in CREATE mode
    if (!user && !formData.company_id) {
      newErrors.company_id = 'Company is required';
    }

    // Password validation
    if (!user) {
      // CREATE mode: password is required
      if (!formData.password || !formData.password.trim()) {
        newErrors.password = 'Password is required';
      } else if (formData.password.length < 8) {
        newErrors.password = 'Password must be at least 8 characters';
      }
    } else {
      // EDIT mode: password is optional (only update if provided)
      if (formData.password && formData.password.length < 8) {
        newErrors.password = 'Password must be at least 8 characters';
      }
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
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    // Clear error for this field
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Email */}
      <FormField
        label="Email Address"
        required
        error={errors.email}
        hint="User will receive invitation at this email"
      >
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={handleInputChange}
          disabled={user !== null}
          placeholder="user@example.com"
          className="input"
        />
      </FormField>

      {/* First Name */}
      <FormField
        label="First Name"
        required
        error={errors.first_name}
      >
        <input
          type="text"
          name="first_name"
          value={formData.first_name}
          onChange={handleInputChange}
          placeholder="John"
          className="input"
        />
      </FormField>

      {/* Last Name */}
      <FormField
        label="Last Name"
        required
        error={errors.last_name}
      >
        <input
          type="text"
          name="last_name"
          value={formData.last_name}
          onChange={handleInputChange}
          placeholder="Doe"
          className="input"
        />
      </FormField>

      {/* Role Selection */}
      <FormField
        label="Role"
        required
        error={errors.role_id}
        hint="Select the user's role in the company"
      >
        <select
          name="role_id"
          value={formData.role_id}
          onChange={handleInputChange}
          className="input"
        >
          <option value="">Select a role</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </FormField>

      {/* Company Selection - CREATE MODE */}
      {!user && (
        <FormField
          label="Company"
          required
          error={errors.company_id}
          hint="Select the company to assign this user to"
        >
          <select
            name="company_id"
            value={formData.company_id}
            onChange={handleInputChange}
            disabled={companiesLoading}
            className="input"
          >
            <option value="">Select a company</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </FormField>
      )}

      {/* Company Display - EDIT MODE */}
      {user && (
        <FormField
          label="Company"
          hint="User is currently assigned to this company"
        >
          <div className="input-disabled bg-bg-secondary p-3 rounded border border-border">
            <p className="text-text">
              {companies.find(c => c.id === user.company_id)?.name || 'Unknown Company'}
            </p>
            <p className="text-text-secondary text-sm mt-1">
              Company reassignment not available in this version
            </p>
          </div>
        </FormField>
      )}

      {/* Password - Different behavior for create vs edit */}
      {!user && (
        <FormField
          label="Password"
          required
          error={errors.password}
          hint="Minimum 8 characters. User will use this to log in."
        >
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleInputChange}
            placeholder="Enter password (min 8 characters)"
            className="input"
          />
        </FormField>
      )}

      {user && (
        <FormField
          label="Password"
          error={errors.password}
          hint="Leave blank to keep current password. Enter new password to reset it."
        >
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleInputChange}
            placeholder="Leave blank to keep current password"
            className="input"
          />
        </FormField>
      )}

      {/* Submit Button */}
      <div className="flex justify-end pt-6 border-t border-border">
        <Button
          type="submit"
          variant="primary"
          loading={isLoading}
          disabled={isLoading}
        >
          {isLoading ? 'Saving...' : user ? 'Update User' : 'Create User'}
        </Button>
      </div>
    </form>
  );
};

export default UserForm;
