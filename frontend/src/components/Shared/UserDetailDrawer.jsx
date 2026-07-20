import { X, Mail, Shield, Calendar, User, Activity } from 'lucide-react';
import { Badge } from '../UI';
import UserPermissionsPanel from '../Admin/UserManagement/UserPermissionsPanel';

const LEVEL_COLOR = {
  superadmin:          'var(--color-primary)',
  readonly_admin:      '#8b5cf6',
  compliance_manager:  '#f59e0b',
  company_admin:       'var(--color-error-500)',
  operations_manager:  'var(--color-info-500)',
  closer_manager:      '#10b981',
  fronter_manager:     '#10b981',
  closer:              '#6b7280',
  fronter:             '#6b7280',
};

const Row = ({ label, value }) =>
  value != null && value !== '' ? (
    <div className="flex items-start gap-4 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="text-xs font-bold text-text-secondary uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-text flex-1 text-right">{value}</span>
    </div>
  ) : null;

const Section = ({ icon: Icon, title, children }) => (
  <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
    <div className="flex items-center gap-2 mb-3">
      <Icon size={14} style={{ color: 'var(--color-primary-500)' }} />
      <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest">{title}</h3>
    </div>
    {children}
  </div>
);

export default function UserDetailDrawer({ user, onClose }) {
  if (!user) return null;

  const fullName   = [user.first_name, user.last_name].filter(Boolean).join(' ') || null;
  const initials   = (user.first_name?.[0] || user.email?.[0] || '?').toUpperCase();
  const levelColor = LEVEL_COLOR[user.role_level] || '#6b7280';
  const joinedDate = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div
        className="fixed right-0 top-0 h-full w-full max-w-lg z-50 flex flex-col shadow-2xl overflow-y-auto"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {initials}
            </div>
            <div>
              <h2 className="text-lg font-bold text-text">{fullName || user.email}</h2>
              {fullName && (
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{user.email}</p>
              )}
            </div>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-bg-secondary flex-shrink-0">
            <X size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        {/* Status / Role badges */}
        <div className="flex items-center flex-wrap gap-2 px-5 py-3"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <Badge variant={user.is_active ? 'success' : 'secondary'}>
            {user.is_active ? 'Active' : 'Inactive'}
          </Badge>
          {user.role && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: `${levelColor}18`, color: levelColor, border: `1px solid ${levelColor}40` }}>
              {user.role}
            </span>
          )}
          {user.role_level && (
            <span className="text-xs text-text-secondary px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              {user.role_level.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        {/* Profile */}
        <Section icon={User} title="Profile">
          {fullName && <Row label="Full Name" value={fullName} />}
          <Row label="Email"      value={user.email} />
          <Row label="Role"       value={user.role} />
          <Row label="Role Level" value={user.role_level?.replace(/_/g, ' ')} />
        </Section>

        {/* Account */}
        <Section icon={Activity} title="Account">
          <Row label="Status"  value={user.is_active ? 'Active' : 'Inactive'} />
          <Row label="Joined"  value={joinedDate} />
          <Row label="User ID" value={user.id} />
        </Section>

        {/* Permissions */}
        <Section icon={Shield} title="Permissions">
          <UserPermissionsPanel user={user} />
        </Section>
      </div>
    </>
  );
}
