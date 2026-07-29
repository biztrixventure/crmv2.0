import { Mail, Shield, Calendar, User, Activity } from 'lucide-react';
import { Badge } from '../UI';
import DrawerShell from './DrawerShell';
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
    <DrawerShell
      // headerTone="plain" keeps this drawer's surface-coloured header: it has
      // never used the brand gradient, and adopting the shared shell must not
      // restyle it. The avatar puck is passed as the icon so the header reads
      // exactly as it did before.
      headerTone="plain"
      icon={(
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center text-white font-bold text-base flex-shrink-0"
          style={{ background: 'var(--gradient-sidebar)' }}>
          {initials}
        </div>
      )}
      title={fullName || user.email}
      subtitle={fullName ? user.email : null}
      onClose={onClose}
      recordKey={user?.id}
      width={512}
      labelledById="user-drawer-title"
      chrome={(
        /* Status / Role badges */
        <div className="flex items-center flex-wrap gap-2 px-3 sm:px-5 py-3 flex-shrink-0"
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
      )}
    >
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
    </DrawerShell>
  );
}
