import React, { useState, useEffect } from 'react';
import { Button, FormField } from '../../../components/UI';
import { useCompanies } from '../../../hooks/useCompanies';
import { Mail, Lock, ShieldCheck, UserCheck } from 'lucide-react';

// Roles that require email verification by default (big roles)
const HIGH_ROLES = ['superadmin', 'readonly_admin', 'company_admin', 'closer_manager', 'operations_manager', 'manager'];

const UserForm = ({ user = null, onSubmit, isLoading = false, roles = [] }) => {
  const { companies, loading: companiesLoading, fetchAvailableCompanies } = useCompanies();
  const [formData, setFormData] = useState({
    email: '',
    first_name: '',
    last_name: '',
    role_id: '',
    password: '',
    company_id: '',
    require_verification: false,
  });
  const [errors, setErrors] = useState({});

  useEffect(() => { fetchAvailableCompanies(); }, [fetchAvailableCompanies]);

  useEffect(() => {
    if (user) {
      setFormData({
        email: user.email || '',
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        role_id: user.role_id || '',
        password: '',
        company_id: user.company_id || '',
        require_verification: false,
      });
    } else {
      const userCompanyId = localStorage.getItem('user_company_id');
      setFormData(prev => ({ ...prev, company_id: userCompanyId || '' }));
    }
  }, [user]);

  // Auto-update require_verification when role changes
  useEffect(() => {
    if (!user && formData.role_id) {
      const selectedRole = roles.find(r => r.id === formData.role_id);
      if (selectedRole) {
        const isHighRole = HIGH_ROLES.includes(selectedRole.level);
        setFormData(prev => ({ ...prev, require_verification: isHighRole }));
      }
    }
  }, [formData.role_id, roles, user]);

  const selectedRole = roles.find(r => r.id === formData.role_id);
  const isHighRole = selectedRole ? HIGH_ROLES.includes(selectedRole.level) : false;

  const validate = () => {
    const newErrors = {};
    if (!formData.email || !formData.email.includes('@')) newErrors.email = 'Valid email is required';
    if (!formData.first_name?.trim()) newErrors.first_name = 'First name is required';
    if (!formData.last_name?.trim()) newErrors.last_name = 'Last name is required';
    if (!formData.role_id) newErrors.role_id = 'Role is required';
    if (!user && !formData.company_id) newErrors.company_id = 'Company is required';

    // Password only required when NOT using email verification
    if (!user && !formData.require_verification) {
      if (!formData.password?.trim()) newErrors.password = 'Password is required';
      else if (formData.password.length < 8) newErrors.password = 'Minimum 8 characters';
    }
    if (user && formData.password && formData.password.length < 8) {
      newErrors.password = 'Minimum 8 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) onSubmit(formData);
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Name row */}
      <div className="grid grid-cols-2 gap-4">
        <FormField label="First Name" required error={errors.first_name}>
          <input type="text" name="first_name" value={formData.first_name}
            onChange={handleInputChange} placeholder="John" className="input" />
        </FormField>
        <FormField label="Last Name" required error={errors.last_name}>
          <input type="text" name="last_name" value={formData.last_name}
            onChange={handleInputChange} placeholder="Doe" className="input" />
        </FormField>
      </div>

      {/* Email */}
      <FormField label="Email Address" required error={errors.email}>
        <div className="relative">
          <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input type="email" name="email" value={formData.email}
            onChange={handleInputChange} disabled={user !== null}
            placeholder="user@example.com"
            className="input pl-9" />
        </div>
      </FormField>

      {/* Role */}
      <FormField label="Role" required error={errors.role_id}>
        <select name="role_id" value={formData.role_id}
          onChange={handleInputChange} className="input">
          <option value="">— Select a role —</option>
          {roles.map(role => (
            <option key={role.id} value={role.id}>
              {role.name}{role.level ? ` (${role.level.replace(/_/g,' ')})` : ''}
            </option>
          ))}
        </select>
        {selectedRole && (
          <p className="text-xs mt-1 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {selectedRole.level?.replace(/_/g, ' ')} · {selectedRole.permissions?.length ?? 0} permissions
          </p>
        )}
        {roles.length === 0 && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-warning-600)' }}>
            No assignable roles available — you can only assign roles below your own level.
          </p>
        )}
      </FormField>

      {/* Company — CREATE MODE */}
      {!user && (
        <FormField label="Company" required error={errors.company_id}
          hint="Assign this user to a company">
          <select name="company_id" value={formData.company_id}
            onChange={handleInputChange} disabled={companiesLoading} className="input">
            <option value="">Select a company</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </FormField>
      )}

      {/* Company — EDIT MODE */}
      {user && (
        <FormField label="Company" hint="Reassign user to a different company">
          <select name="company_id" value={formData.company_id}
            onChange={handleInputChange} disabled={companiesLoading} className="input">
            <option value="">Keep current company</option>
            {companies.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </FormField>
      )}

      {/* Verification toggle — CREATE MODE only */}
      {!user && (
        <div className="rounded-xl border p-4 space-y-3"
          style={{
            borderColor: formData.require_verification ? 'var(--color-primary-400)' : 'var(--color-border)',
            backgroundColor: formData.require_verification ? 'var(--color-primary-50, rgba(99,102,241,0.04))' : 'var(--color-bg-secondary)',
          }}>
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <div className="relative flex-shrink-0 mt-0.5">
              <input type="checkbox" name="require_verification"
                checked={formData.require_verification}
                onChange={handleInputChange} className="sr-only" />
              <div className={`w-10 h-6 rounded-full transition-colors duration-200 ${formData.require_verification ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${formData.require_verification ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
            </div>
            <div>
              <p className="font-semibold text-sm text-text flex items-center gap-2">
                {formData.require_verification
                  ? <><ShieldCheck size={15} className="text-primary-600" /> Require email verification</>
                  : <><UserCheck size={15} className="text-success-600" /> Direct access (no email needed)</>
                }
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                {formData.require_verification
                  ? 'User receives an invite email. They must click the link before they can log in.'
                  : 'User can log in immediately using the email and password you set below.'
                }
              </p>
              {isHighRole && (
                <p className="text-xs mt-1 font-medium" style={{ color: 'var(--color-primary-600)' }}>
                  Recommended: email verification for {selectedRole?.level} role
                </p>
              )}
            </div>
          </label>
        </div>
      )}

      {/* Password — only show when NOT using verification */}
      {!user && !formData.require_verification && (
        <FormField label="Password" required error={errors.password}
          hint="Min 8 characters. User logs in with this immediately.">
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input type="password" name="password" value={formData.password}
              onChange={handleInputChange}
              placeholder="Min 8 characters"
              className="input pl-9" />
          </div>
        </FormField>
      )}

      {/* Password — EDIT MODE */}
      {user && (
        <FormField label="Reset Password" error={errors.password}
          hint="Leave blank to keep current password.">
          <div className="relative">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input type="password" name="password" value={formData.password}
              onChange={handleInputChange}
              placeholder="Leave blank to keep unchanged"
              className="input pl-9" />
          </div>
        </FormField>
      )}

      {/* Submit */}
      <div className="flex justify-end pt-4 border-t border-border">
        <Button type="submit" variant="primary" loading={isLoading} disabled={isLoading}
          className="px-8">
          {isLoading ? 'Saving...' : user
            ? 'Update User'
            : formData.require_verification ? 'Send Invite' : 'Create User'
          }
        </Button>
      </div>
    </form>
  );
};

export default UserForm;
