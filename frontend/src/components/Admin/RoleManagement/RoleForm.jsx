import { useState, useEffect } from 'react';
import { Button, FormField } from '../../../components/UI';
import PermissionMatrix from './PermissionMatrix';
import { Zap } from 'lucide-react';

// ── BLP Sales Model Templates ────────────────────────────────────────────────
// Pre-built permission sets for the standard sales floor hierarchy.
// Fronters create leads → Managers route them → Closers convert → Admin oversees.
const BLP_TEMPLATES = [
  {
    id: 'fronter',
    label: 'Fronter',
    level: 'fronter',
    desc: 'Creates transfers/leads, manages own pipeline',
    permissions: ['create_transfer', 'view_own_transfers', 'update_transfer'],
  },
  {
    id: 'closer',
    label: 'Closer',
    level: 'closer',
    desc: 'Converts assigned transfers to sales',
    permissions: ['create_sale', 'view_own_sales', 'update_sale', 'view_own_transfers'],
  },
  {
    id: 'fronter_manager',
    label: 'Fronter Manager',
    level: 'manager',
    desc: 'Manages fronter team, assigns and routes transfers',
    permissions: [
      'create_transfer', 'view_own_transfers', 'view_team_transfers',
      'assign_transfer', 'update_transfer', 'delete_transfer',
      'create_user', 'view_reports',
    ],
  },
  {
    id: 'closer_manager',
    label: 'Closer Manager',
    level: 'closer_manager',
    desc: 'Manages closer team, tracks all sales, can search records',
    permissions: [
      'create_sale', 'view_own_sales', 'view_team_sales', 'update_sale',
      'assign_transfer', 'view_team_transfers',
      'view_reports', 'search_sales', 'create_user',
    ],
  },
  {
    id: 'operations_manager',
    label: 'Operations Manager',
    level: 'operations_manager',
    desc: 'Oversees ops, runs reports, searches all sale records',
    permissions: [
      'view_team_transfers', 'view_team_sales', 'update_sale', 'update_transfer',
      'view_reports', 'search_sales',
    ],
  },
  {
    id: 'company_admin',
    label: 'Company Admin',
    level: 'company_admin',
    desc: 'Full company access — manages users, roles, forms, all data',
    permissions: [
      'create_user', 'edit_user', 'delete_user', 'manage_roles',
      'create_transfer', 'view_team_transfers', 'assign_transfer', 'update_transfer', 'delete_transfer',
      'create_sale', 'view_team_sales', 'update_sale', 'delete_sale',
      'view_reports', 'manage_forms', 'view_company_members', 'search_sales',
      'view_notifications',
    ],
  },
];

const LEVEL_COLORS = {
  fronter: '#10b981',
  closer: '#6366f1',
  manager: '#f59e0b',
  closer_manager: '#8b5cf6',
  operations_manager: '#3b82f6',
  company_admin: '#ef4444',
};

const RoleForm = ({ role = null, onSubmit, isLoading = false }) => {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    level: 'manager',
    permissions: [],
  });
  const [errors, setErrors] = useState({});
  const [showTemplates, setShowTemplates] = useState(!role);

  useEffect(() => {
    if (role) {
      setFormData({
        name: role.name || '',
        description: role.description || '',
        level: role.level || 'manager',
        permissions: Array.isArray(role.permissions) ? role.permissions : [],
      });
      setShowTemplates(false);
    }
  }, [role]);

  const applyTemplate = (tpl) => {
    setFormData(prev => ({
      ...prev,
      name: prev.name || tpl.label,
      description: prev.description || tpl.desc,
      level: tpl.level,
      permissions: tpl.permissions,
    }));
    setShowTemplates(false);
    setErrors({});
  };

  const validate = () => {
    const e = {};
    if (!formData.name?.trim()) e.name = 'Role name is required';
    if (!formData.level) e.level = 'Role level is required';
    if (!formData.permissions?.length) e.permissions = 'At least one permission must be selected';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (validate()) onSubmit(formData);
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handlePermissionsChange = (permissions) => {
    setFormData(prev => ({ ...prev, permissions }));
    if (errors.permissions) setErrors(prev => ({ ...prev, permissions: '' }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── BLP Templates ── */}
      {!role && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Zap size={15} style={{ color: 'var(--color-primary-600)' }} />
              <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                Quick Templates
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                BLP Model
              </span>
            </div>
            <button type="button" onClick={() => setShowTemplates(v => !v)}
              className="text-xs font-semibold"
              style={{ color: 'var(--color-primary-600)' }}>
              {showTemplates ? 'Hide' : 'Show templates'}
            </button>
          </div>

          {showTemplates && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {BLP_TEMPLATES.map(tpl => {
                const color = LEVEL_COLORS[tpl.level] || '#6366f1';
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl)}
                    className="text-left p-3 rounded-xl border-2 transition-all hover:shadow-md"
                    style={{ borderColor: `${color}30`, backgroundColor: `${color}08` }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.backgroundColor = `${color}12`; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = `${color}30`; e.currentTarget.style.backgroundColor = `${color}08`; }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{tpl.label}</span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      {tpl.desc}
                    </p>
                    <p className="text-xs mt-1.5 font-semibold" style={{ color }}>
                      {tpl.permissions.length} permissions
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Role Name */}
      <FormField label="Role Name" required error={errors.name}>
        <input
          type="text" name="name" value={formData.name}
          onChange={handleInputChange}
          disabled={role !== null}
          placeholder="e.g., Fronter Manager, Senior Closer"
          className="input"
        />
      </FormField>

      {/* Description */}
      <FormField label="Description">
        <textarea
          name="description" value={formData.description}
          onChange={handleInputChange}
          placeholder="Role description (optional)"
          rows="2" className="input"
        />
      </FormField>

      {/* Role Level */}
      <FormField label="Role Level" required error={errors.level}>
        <select
          name="level" value={formData.level}
          onChange={handleInputChange}
          disabled={role !== null}
          className="input"
        >
          <option value="">Select level</option>
          <option value="superadmin">SuperAdmin</option>
          <option value="readonly_admin">Readonly Admin</option>
          <option value="company_admin">Company Admin</option>
          <option value="manager">Manager (Fronter Manager)</option>
          <option value="operations_manager">Operations Manager</option>
          <option value="closer_manager">Closer Manager</option>
          <option value="closer">Closer</option>
          <option value="fronter">Fronter</option>
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
          <p className="text-sm mt-2 text-error-600">{errors.permissions}</p>
        )}
      </div>

      {/* Submit */}
      <div className="flex justify-end pt-6 border-t border-border">
        <Button type="submit" variant="primary" loading={isLoading} disabled={isLoading}>
          {isLoading ? 'Saving…' : role ? 'Update Role' : 'Create Role'}
        </Button>
      </div>
    </form>
  );
};

export default RoleForm;
