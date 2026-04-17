import { useState, useEffect } from 'react';
import { UserPlus, Eye, EyeOff } from 'lucide-react';
import Modal from '../../UI/Modal';
import Button from '../../UI/Button';
import client from '../../../api/client';

const CreateUserModal = ({ isOpen, onClose, companyId, onCreated }) => {
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '', role_id: '' });
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isOpen || !companyId) return;
    setRolesLoading(true);
    client.get('roles', { params: { company_id: companyId } })
      .then(r => setRoles(r.data.roles || []))
      .catch(() => setRoles([]))
      .finally(() => setRolesLoading(false));
  }, [isOpen, companyId]);

  const reset = () => {
    setForm({ first_name: '', last_name: '', email: '', password: '', role_id: '' });
    setError('');
    setShowPassword(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.role_id) { setError('Please select a role.'); return; }
    setSubmitting(true);
    try {
      const { data } = await client.post('users', {
        ...form,
        company_id: companyId,
        require_verification: false,
      });
      reset();
      onCreated?.(data.user);
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.details?.[0]?.msg || 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  };

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Create User" size="md">
      {rolesLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">First Name <span className="text-error-500">*</span></label>
              <input className="input" value={form.first_name} onChange={set('first_name')} required placeholder="John" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Last Name <span className="text-error-500">*</span></label>
              <input className="input" value={form.last_name} onChange={set('last_name')} required placeholder="Doe" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Email <span className="text-error-500">*</span></label>
            <input className="input" type="email" value={form.email} onChange={set('email')} required placeholder="user@example.com" />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Password <span className="text-error-500">*</span></label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={set('password')}
                required
                minLength={8}
                placeholder="Min. 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Role <span className="text-error-500">*</span></label>
            <select className="input" value={form.role_id} onChange={set('role_id')} required>
              <option value="">— Select a role —</option>
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            {roles.length === 0 && !rolesLoading && (
              <p className="text-xs text-warning-600 mt-1">No roles found. Seed default roles first.</p>
            )}
          </div>

          {error && <p className="text-sm text-error-600">{error}</p>}

          <div className="flex gap-3 pt-2 border-t border-border">
            <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant="primary" loading={submitting} disabled={submitting} className="flex items-center gap-2">
              <UserPlus size={16} />
              {submitting ? 'Creating…' : 'Create User'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default CreateUserModal;
