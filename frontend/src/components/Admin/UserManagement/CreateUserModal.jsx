import { useState, useEffect } from 'react';
import { UserPlus, Eye, EyeOff, Shield, Headphones } from 'lucide-react';
import Modal from '../../UI/Modal';
import Button from '../../UI/Button';
import client from '../../../api/client';

const LEVEL_COLORS = {
  fronter:            { bg: '#10b981', light: 'rgba(16,185,129,0.1)',  label: 'Fronter' },
  fronter_manager:    { bg: '#f59e0b', light: 'rgba(245,158,11,0.1)',  label: 'Fronter Mgr' },
  closer:             { bg: '#6366f1', light: 'rgba(99,102,241,0.1)',  label: 'Closer' },
  closer_manager:     { bg: '#8b5cf6', light: 'rgba(139,92,246,0.1)', label: 'Closer Mgr' },
  operations_manager: { bg: '#3b82f6', light: 'rgba(59,130,246,0.1)', label: 'Ops Manager' },
  compliance_manager: { bg: '#f97316', light: 'rgba(249,115,22,0.1)', label: 'Compliance' },
  company_admin:      { bg: '#ef4444', light: 'rgba(239,68,68,0.1)',  label: 'Co. Admin' },
};

const RolePicker = ({ roles, value, onChange }) => {
  if (roles.length === 0) {
    return (
      <div className="rounded-xl p-4 text-center"
        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
        <Shield size={24} className="mx-auto mb-2" style={{ color: 'var(--color-text-tertiary)' }} />
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>No assignable roles</p>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          You can only assign roles with lower authority than your own. Ask an admin to create roles.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1">
      {roles.map(r => {
        const color = LEVEL_COLORS[r.level] || { bg: '#6366f1', light: 'rgba(99,102,241,0.1)', label: r.level };
        const selected = value === r.id;
        return (
          <button key={r.id} type="button" onClick={() => onChange(r.id)}
            className="flex items-center gap-3 p-3 rounded-xl text-left transition-all"
            style={{
              border: `2px solid ${selected ? color.bg : 'var(--color-border)'}`,
              backgroundColor: selected ? color.light : 'var(--color-surface)',
            }}>
            {/* radio dot */}
            <div className="w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
              style={{ borderColor: selected ? color.bg : 'var(--color-border)' }}>
              {selected && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color.bg }} />}
            </div>
            {/* role info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{r.name}</span>
                <span className="px-1.5 py-0.5 rounded-full text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: color.light, color: color.bg }}>
                  {color.label}
                </span>
              </div>
              {r.description && (
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-secondary)' }}>
                  {r.description}
                </p>
              )}
            </div>
            {/* permission count */}
            <span className="text-xs flex-shrink-0 font-semibold"
              style={{ color: selected ? color.bg : 'var(--color-text-tertiary)' }}>
              {r.permissions?.length ?? 0} perms
            </span>
          </button>
        );
      })}
    </div>
  );
};

const CreateUserModal = ({ isOpen, onClose, companyId, onCreated }) => {
  const [form, setForm] = useState({ full_name: '', email: '', password: '', role_id: '' });
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isOpen || !companyId) return;
    setRolesLoading(true);
    client.get('roles', { params: { company_id: companyId, for_assignment: true } })
      .then(r => setRoles(r.data.roles || []))
      .catch(() => setRoles([]))
      .finally(() => setRolesLoading(false));
  }, [isOpen, companyId]);

  const reset = () => {
    setForm({ full_name: '', email: '', password: '', role_id: '', vicidial_agent_id: '' });
    setError('');
    setShowPassword(false);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.full_name.trim()) { setError('Please enter the full name.'); return; }
    if (!form.role_id) { setError('Please select a role.'); return; }
    setSubmitting(true);
    try {
      const { data } = await client.post('users', { ...form, company_id: companyId, require_verification: false });
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

  const selectedRole = roles.find(r => r.id === form.role_id);

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Team Member" size="md">
      {rolesLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Full name */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Full Name <span className="text-error-500">*</span>
            </label>
            <input className="input" value={form.full_name} onChange={set('full_name')} required placeholder="John Doe" />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Email <span className="text-error-500">*</span>
            </label>
            <input className="input" type="email" value={form.email} onChange={set('email')} required placeholder="user@example.com" />
          </div>

          {/* Password */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              Password <span className="text-error-500">*</span>
            </label>
            <div className="relative">
              <input className="input pr-10" type={showPassword ? 'text' : 'password'}
                value={form.password} onChange={set('password')} required minLength={8}
                placeholder="Min. 8 characters" />
              <button type="button" onClick={() => setShowPassword(s => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--color-text-secondary)' }}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* VICIdial dialer agent id (optional) */}
          <div>
            <label className="block text-xs font-semibold text-text-secondary mb-1">
              VICIdial Agent ID(s)
            </label>
            <div className="relative">
              <Headphones size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-secondary)' }} />
              <input className="input pl-9" value={form.vicidial_agent_id} onChange={set('vicidial_agent_id')}
                placeholder="e.g. ETC0895, 2006 (optional)" />
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              Dialer agent id — maps dispositions to this user. Works two boxes with different ids? List both comma-separated.
            </p>
          </div>

          {/* Role picker */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-text-secondary">
                Role <span className="text-error-500">*</span>
              </label>
              {selectedRole && (
                <span className="text-xs font-semibold" style={{ color: LEVEL_COLORS[selectedRole.level]?.bg || 'var(--color-primary-600)' }}>
                  {selectedRole.permissions?.length ?? 0} permissions
                </span>
              )}
            </div>
            <RolePicker
              roles={roles}
              value={form.role_id}
              onChange={roleId => setForm(f => ({ ...f, role_id: roleId }))}
            />
          </div>

          {error && (
            <p className="text-sm px-3 py-2 rounded-lg"
              style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" variant="primary" loading={submitting} disabled={submitting || !form.role_id}
              className="flex items-center gap-2 flex-1 justify-center">
              <UserPlus size={15} />
              {submitting ? 'Creating…' : 'Create Member'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default CreateUserModal;
