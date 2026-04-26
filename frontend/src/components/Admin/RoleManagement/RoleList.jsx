import { Edit2, Trash2, Shield } from 'lucide-react';

const LEVEL_COLORS = {
  fronter:             { bg: '#10b981', light: 'rgba(16,185,129,0.1)',  label: 'Fronter' },
  fronter_manager:     { bg: '#f59e0b', light: 'rgba(245,158,11,0.1)',  label: 'Fronter Manager' },
  closer:              { bg: '#6366f1', light: 'rgba(99,102,241,0.1)',  label: 'Closer' },
  closer_manager:      { bg: '#8b5cf6', light: 'rgba(139,92,246,0.1)', label: 'Closer Manager' },
  operations_manager:  { bg: '#3b82f6', light: 'rgba(59,130,246,0.1)', label: 'Ops Manager' },
  compliance_manager:  { bg: '#f97316', light: 'rgba(249,115,22,0.1)', label: 'Compliance' },
  company_admin:       { bg: '#ef4444', light: 'rgba(239,68,68,0.1)',  label: 'Company Admin' },
  readonly_admin:      { bg: '#6b7280', light: 'rgba(107,114,128,0.1)', label: 'Readonly Admin' },
  superadmin:          { bg: '#1e293b', light: 'rgba(30,41,59,0.1)',   label: 'SuperAdmin' },
};

const RoleCard = ({ role, onEdit, onDelete }) => {
  const color = LEVEL_COLORS[role.level] || { bg: '#6366f1', light: 'rgba(99,102,241,0.1)', label: role.level };
  const permCount = role.permissions?.length || 0;

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-3 transition-shadow hover:shadow-md"
      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

      {/* Top row: level badge + actions */}
      <div className="flex items-start justify-between gap-2">
        <span className="px-2.5 py-1 rounded-full text-xs font-bold"
          style={{ backgroundColor: color.light, color: color.bg }}>
          {color.label}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={() => onEdit(role)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--color-primary-600)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}>
            <Edit2 size={14} />
          </button>
          <button onClick={() => onDelete(role.id)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--color-error-600)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Name */}
      <div>
        <p className="font-bold text-base" style={{ color: 'var(--color-text)' }}>{role.name}</p>
        {role.description && (
          <p className="text-xs mt-1 leading-relaxed line-clamp-2"
            style={{ color: 'var(--color-text-secondary)' }}>
            {role.description}
          </p>
        )}
      </div>

      {/* Permission count */}
      <div className="mt-auto pt-2 flex items-center gap-1.5"
        style={{ borderTop: '1px solid var(--color-border)' }}>
        <Shield size={12} style={{ color: permCount > 0 ? color.bg : 'var(--color-text-tertiary)' }} />
        <span className="text-xs font-semibold"
          style={{ color: permCount > 0 ? color.bg : 'var(--color-text-tertiary)' }}>
          {permCount} permission{permCount !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
};

const RoleList = ({ roles, onEdit, onDelete }) => {
  if (!roles || roles.length === 0) {
    return (
      <div className="rounded-2xl p-12 text-center"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <Shield size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
        <p className="font-semibold" style={{ color: 'var(--color-text)' }}>No roles yet</p>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Create a role or use Seed Defaults to generate standard BLP roles.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {roles.map(role => (
        <RoleCard key={role.id} role={role} onEdit={onEdit} onDelete={onDelete} />
      ))}
    </div>
  );
};

export default RoleList;
