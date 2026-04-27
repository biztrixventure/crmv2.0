import { X, Phone, Clock, Globe, StickyNote, Bell, User } from 'lucide-react';
import { Badge } from '../UI';

const STATUS_BADGE = {
  pending:   'warning',
  completed: 'success',
  cancelled: 'error',
  no_answer: 'secondary',
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

export default function CallbackDetailDrawer({ callback, onClose }) {
  if (!callback) return null;

  const scheduledTime = callback.callback_at
    ? new Date(callback.callback_at).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null;

  const createdTime = callback.created_at
    ? new Date(callback.created_at).toLocaleString()
    : null;

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }} onClick={onClose} />
      <div
        className="fixed right-0 top-0 h-full w-full max-w-md z-50 flex flex-col shadow-2xl overflow-y-auto"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--gradient-sidebar)' }}>
                <Phone size={15} className="text-white" />
              </div>
              <h2 className="text-lg font-bold text-text">
                {callback.customer_name || 'Callback'}
              </h2>
            </div>
            {callback.customer_phone && (
              <p className="text-sm font-mono ml-10" style={{ color: 'var(--color-text-secondary)' }}>
                {callback.customer_phone}
              </p>
            )}
          </div>
          <button onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-bg-secondary flex-shrink-0">
            <X size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-2 px-5 py-3"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <Badge variant={STATUS_BADGE[callback.status] || 'secondary'}>
            {(callback.status || 'unknown').replace(/_/g, ' ')}
          </Badge>
          {callback.notified && (
            <Badge variant="info" size="sm">
              <Bell size={10} className="mr-1" />Notified
            </Badge>
          )}
        </div>

        {/* Schedule */}
        <Section icon={Clock} title="Schedule">
          <Row label="Scheduled" value={scheduledTime} />
          <Row label="Timezone"  value={callback.user_timezone} />
        </Section>

        {/* Customer */}
        <Section icon={User} title="Customer">
          <Row label="Name"  value={callback.customer_name} />
          <Row label="Phone" value={callback.customer_phone} />
        </Section>

        {/* Notes */}
        {callback.notes && (
          <Section icon={StickyNote} title="Notes">
            <p className="text-sm text-text leading-relaxed">{callback.notes}</p>
          </Section>
        )}

        {/* Meta */}
        <Section icon={Globe} title="Meta">
          <Row label="Created"  value={createdTime} />
          <Row label="Record ID" value={callback.id} />
        </Section>
      </div>
    </>
  );
}
