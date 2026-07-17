import React, { useState, useEffect } from 'react';
import { Button, FormField } from '../../../components/UI';
import { useCompanies } from '../../../hooks/useCompanies';
import { Mail, Lock, ShieldCheck, UserCheck, Headphones } from 'lucide-react';

// Roles that require email verification by default (big roles)
const HIGH_ROLES = ['superadmin', 'readonly_admin', 'company_admin', 'closer_manager', 'operations_manager', 'manager'];

const UserForm = ({ user = null, onSubmit, isLoading = false, roles = [] }) => {
  const { companies, loading: companiesLoading, fetchAvailableCompanies } = useCompanies();
  const [formData, setFormData] = useState({
    email: '',
    full_name: '',
    role_id: '',
    password: '',
    company_id: '',
    require_verification: false,
    vicidial_agent_id: '',
  });
  const [errors, setErrors] = useState({});
  // Whether the VICIdial field was actually edited. In EDIT mode we only send it
  // when touched — so opening + saving a user never wipes a mapped id the form
  // didn't (or couldn't) prefill.
  const [agentTouched, setAgentTouched] = useState(false);

  useEffect(() => { fetchAvailableCompanies(); }, [fetchAvailableCompanies]);

  useEffect(() => {
    if (user) {
      setFormData({
        email: user.email || '',
        full_name: [user.first_name, user.last_name].filter(Boolean).join(' '),
        role_id: user.role_id || '',
        password: '',
        company_id: user.company_id || '',
        require_verification: false,
        vicidial_agent_id: user.vicidial_agent_id || '',
      });
      setAgentTouched(false);
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
    if (!formData.full_name?.trim()) newErrors.full_name = 'Full name is required';
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
    if (!validate()) return;
    const payload = { ...formData };
    // EDIT mode: don't send the VICIdial id unless the user actually changed it,
    // so saving never silently clears a mapped id (present key = "set it" server-side).
    if (user && !agentTouched) delete payload.vicidial_agent_id;
    onSubmit(payload);
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === 'vicidial_agent_id') setAgentTouched(true);
    setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Full name */}
      <FormField label="Full Name" required error={errors.full_name}>
        <input type="text" name="full_name" value={formData.full_name}
          onChange={handleInputChange} placeholder="John Doe" className="input" />
      </FormField>

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
      </FormField>
      {selectedRole && (
        <p className="text-xs -mt-3 font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
          {selectedRole.level?.replace(/_/g, ' ')} · {selectedRole.permissions?.length ?? 0} permissions
        </p>
      )}
      {roles.length === 0 && (
        <p className="text-xs -mt-3" style={{ color: 'var(--color-warning-600)' }}>
          No assignable roles available — you can only assign roles below your own level.
        </p>
      )}

      {/* VICIdial dialer agent id — maps dialer dispositions to this user */}
      <FormField label="VICIdial Agent ID(s)"
        hint="Dialer login/agent id (e.g. ETC0895). If this person works MORE than one box with different ids, list all comma-separated (e.g. ETC0895, 2006) — dispositions from any of them map to this user. Leave blank if not on the dialer.">
        <div className="relative">
          <Headphones size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input type="text" name="vicidial_agent_id" value={formData.vicidial_agent_id}
            onChange={handleInputChange} placeholder="e.g. ETC0895, 2006"
            className="input pl-9" />
        </div>
        {user && (user.vicidial_agent_id
          ? <p className="text-xs mt-1 font-semibold" style={{ color: 'var(--color-success-600)' }}>Currently mapped: {user.vicidial_agent_id} — leave as-is to keep it.</p>
          : <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>No dialer id mapped. Leave blank if this person isn't on the dialer.</p>
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
