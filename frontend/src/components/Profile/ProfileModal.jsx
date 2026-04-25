import { User, Building2, Shield, Mail, Hash, Briefcase } from 'lucide-react';
import Modal from '../UI/Modal';

const ROLE_COLORS = {
  superadmin:         '#6366f1',
  readonly_admin:     '#8b5cf6',
  compliance_manager: '#ec4899',
  company_admin:      '#8b5cf6',
  operations_manager: '#3b82f6',
  closer_manager:     '#8b5cf6',
  fronter_manager:    '#10b981',
  manager:            '#f59e0b',
  closer:             '#6366f1',
  fronter:            '#10b981',
  operations:         '#6b7280',
};

const Avatar = ({ firstName, lastName }) => {
  const initials = [firstName, lastName].filter(Boolean).map(n => n[0].toUpperCase()).join('') || '?';
  return (
    <div className="w-20 h-20 rounded-full flex items-center justify-center font-bold text-white text-2xl flex-shrink-0"
      style={{ background: 'var(--gradient-sidebar)' }}>
      {initials}
    </div>
  );
};

const InfoRow = ({ icon: Icon, label, value }) => {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-3"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
        <Icon size={14} style={{ color: 'var(--color-primary-600)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide mb-0.5"
          style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
        <p className="text-sm font-medium break-all" style={{ color: 'var(--color-text)' }}>{value}</p>
      </div>
    </div>
  );
};

const ProfileModal = ({ isOpen, onClose, user }) => {
  const roleColor = ROLE_COLORS[user?.role] || '#6366f1';
  const fullName  = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="My Profile" size="md">
      <div className="space-y-5">

        {/* ── Avatar + identity ── */}
        <div className="flex items-center gap-4 p-4 rounded-xl"
          style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <Avatar firstName={user?.first_name} lastName={user?.last_name} />
          <div className="flex-1 min-w-0">
            <p className="text-xl font-bold truncate" style={{ color: 'var(--color-text)' }}>
              {fullName || user?.email || '—'}
            </p>
            <p className="text-sm truncate mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              {user?.email}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {user?.role_name && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
                  style={{ backgroundColor: `${roleColor}18`, color: roleColor, border: `1px solid ${roleColor}30` }}>
                  <Shield size={11} /> {user.role_name}
                </span>
              )}
              {user?.company_name && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                  <Building2 size={11} /> {user.company_name}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Info fields ── */}
        <div className="rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 px-4 py-3"
            style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
            <User size={15} style={{ color: 'var(--color-primary-600)' }} />
            <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Account Details</span>
          </div>
          <div className="px-4 [&>*:last-child]:border-b-0">
            <InfoRow icon={User}     label="Full Name"   value={fullName} />
            <InfoRow icon={Mail}     label="Email"       value={user?.email} />
            <InfoRow icon={Shield}   label="Role"        value={user?.role_name} />
            <InfoRow icon={Building2} label="Company"    value={user?.company_name} />
            <InfoRow icon={Briefcase} label="Department" value={user?.department || null} />
            <InfoRow icon={Hash}     label="User ID"     value={user?.id} />
          </div>
        </div>

      </div>
    </Modal>
  );
};

export default ProfileModal;
