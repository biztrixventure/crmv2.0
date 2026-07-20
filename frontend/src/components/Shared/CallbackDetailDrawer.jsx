import { X, Phone, Clock, Globe, StickyNote, Bell, User, AlertCircle } from 'lucide-react';
import { Badge } from '../UI';
import { useDrawerLayout } from '../../hooks/useDrawerLayout';

const STATUS_BADGE = {
  pending:           'warning',
  completed:         'success',
  cancelled:         'error',
  no_answer:         'secondary',
  answering_machine: 'secondary',
};

const PRIORITY_CONFIG = {
  High:   { dot: 'var(--color-error-500)', bg: 'color-mix(in srgb, var(--color-error-500) 14%, transparent)', border: 'color-mix(in srgb, var(--color-error-500) 30%, transparent)', text: 'var(--color-error-600)' },
  Medium: { dot: '#f59e0b', bg: '#fffbeb', border: '#fde68a', text: 'var(--color-warning-600)' },
  Low:    { dot: 'var(--color-info-500)', bg: 'color-mix(in srgb, var(--color-info-500) 14%, transparent)', border: 'color-mix(in srgb, var(--color-info-500) 30%, transparent)', text: 'var(--color-info-600)' },
};

// Section id → icon, so a config-driven section still gets its glyph.
const SECTION_ICON = {
  schedule: Clock, customer: User, agent: User, notes: StickyNote, meta: Globe,
};

const PriorityBadge = ({ priority }) => {
  if (!priority) return null;
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.Medium;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border"
      style={{ backgroundColor: cfg.bg, color: cfg.text, borderColor: cfg.border }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: cfg.dot }} />
      {priority}
    </span>
  );
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
      {Icon && <Icon size={14} style={{ color: 'var(--color-primary-500)' }} />}
      <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest">{title}</h3>
    </div>
    {children}
  </div>
);

export default function CallbackDetailDrawer({ callback, onClose }) {
  const { sections } = useDrawerLayout('callback');
  if (!callback) return null;

  const fd = callback.form_data || {};

  const scheduledTime = callback.callback_at
    ? new Date(callback.callback_at).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null;

  const createdTime = callback.created_at
    ? new Date(callback.created_at).toLocaleString()
    : null;

  const isOverdue = callback.callback_at && callback.status === 'pending'
    && new Date(callback.callback_at) < new Date();

  // ── Field renderers, keyed by the field ids the SuperAdmin sees in Business
  // Rules → Drawer Layout. Field-id driven so a dragged field appears in its
  // new section.
  const FIELD = {
    scheduled: <Row key="scheduled" label="Scheduled" value={scheduledTime} />,
    timezone:  <Row key="timezone"  label="Timezone"  value={callback.user_timezone} />,
    name:      <Row key="name"      label="Name"      value={callback.customer_name} />,
    phone:     <Row key="phone"     label="Phone"     value={callback.customer_phone} />,
    agent:     <Row key="agent"     label="Agent"     value={callback.user_name} />,
    company:   <Row key="company"   label="Company"   value={callback.company_name} />,
    created:   <Row key="created"   label="Created"   value={createdTime} />,
    source:    <Row key="source"    label="Source"    value={callback.source} />,
    record_id: <Row key="record_id" label="Record ID" value={callback.id} />,
  };

  const DEFAULT_FIELDS = {
    schedule: ['scheduled', 'timezone'],
    customer: ['name', 'phone'],
    agent:    ['agent', 'company'],
    meta:     ['created', 'source', 'record_id'],
  };

  const sectionFields = (s) => {
    if (Array.isArray(s.fields) && s.fields.length) {
      return [...s.fields].filter(f => f.visible !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(f => ({ id: f.id, label: f.label }));
    }
    return (DEFAULT_FIELDS[s.id] || []).map(id => ({ id }));
  };
  const renderField = ({ id, label }) => {
    if (FIELD[id] !== undefined) return FIELD[id];        // core (Row or null)
    const v = fd[id];                                     // dynamic form_data field
    return (v != null && String(v).trim() !== '' && typeof v !== 'object')
      ? <Row key={id} label={label || id.replace(/_/g, ' ')} value={String(v)} /> : null;
  };

  const notesBlock = () => (
    callback.notes ? (
      <Section key="notes" icon={StickyNote} title="Notes">
        <p className="text-sm text-text leading-relaxed">{callback.notes}</p>
      </Section>
    ) : null
  );

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

        {/* Status + priority bar */}
        <div className="flex items-center gap-2 px-5 py-3 flex-wrap"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <Badge variant={STATUS_BADGE[callback.status] || 'secondary'}>
            {(callback.status || 'unknown').replace(/_/g, ' ')}
          </Badge>
          {callback.priority && <PriorityBadge priority={callback.priority} />}
          {isOverdue && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-error-500) 14%, transparent)', color: 'var(--color-error-600)', borderColor: 'color-mix(in srgb, var(--color-error-500) 30%, transparent)' }}>
              <AlertCircle size={10} /> Overdue
            </span>
          )}
          {callback.notified && (
            <Badge variant="info" size="sm">
              <Bell size={10} className="mr-1" />Notified
            </Badge>
          )}
        </div>

        {/* Body — section order + visibility + field placement from
            useDrawerLayout (SuperAdmin configures per role). Field-id driven so
            a dragged field appears in its new section. */}
        {sections.filter(s => s.visible).map(s => {
          if (s.id === 'notes') return notesBlock();
          const rows = sectionFields(s).map(renderField).filter(Boolean);
          if (rows.length === 0) return null;
          return <Section key={s.id} icon={SECTION_ICON[s.id]} title={s.label || s.id}>{rows}</Section>;
        })}
      </div>
    </>
  );
}
