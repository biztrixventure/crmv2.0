import { X, User, Phone, Mail, MapPin, Calendar, Clock, AlertTriangle, ChevronDown, ChevronUp, Send, DollarSign, CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '../UI';
import { useAuth } from '../../contexts/AuthContext';
import { getTransferDisplayStatus } from '../../utils/transferStatus';

const SALE_STATUS_CONFIG = {
  open:           { label: 'Sale Open',      color: '#2563eb', bg: '#dbeafe',  icon: Clock        },
  sold:           { label: 'Sold',           color: '#16a34a', bg: '#dcfce7',  icon: CheckCircle  },
  pending_review: { label: 'In Review',      color: '#d97706', bg: '#fef3c7',  icon: Clock        },
  needs_revision: { label: 'Needs Revision', color: '#dc2626', bg: '#fee2e2',  icon: AlertTriangle},
  closed_won:     { label: 'Approved',       color: '#16a34a', bg: '#dcfce7',  icon: CheckCircle  },
  closed_lost:    { label: 'Lost',           color: '#6b7280', bg: '#f3f4f6',  icon: XCircle      },
  follow_up:      { label: 'Follow Up',      color: '#8b5cf6', bg: '#ede9fe',  icon: Clock        },
  cancelled:      { label: 'Cancelled',      color: '#6b7280', bg: '#f3f4f6',  icon: XCircle      },
};

const XFER_BADGE = {
  pending: 'warning', assigned: 'info',
  completed: 'success', cancelled: 'error', rejected: 'error',
};

const Row = ({ label, value, mono = false }) => {
  if (!value && value !== 0) return null;
  return (
    <div className="flex justify-between items-start gap-4 py-2"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide flex-shrink-0">{label}</span>
      <span className={`text-sm text-text text-right ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
};

const Section = ({ title, children }) => (
  <div className="mb-5">
    <p className="text-xs font-bold uppercase tracking-widest mb-2"
      style={{ color: 'var(--color-primary-600)' }}>{title}</p>
    <div className="rounded-xl px-4 py-1"
      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
      {children}
    </div>
  </div>
);

const SKIP_KEYS = new Set([
  'customer_name', 'customer_phone', 'customer_email', 'customer_address',
  'FirstName', 'LastName', 'Phone', 'Phone2', 'Email', 'Address', 'City', 'State', 'Zip',
]);

export default function TransferDetailDrawer({ transfer, onClose }) {
  const { hasPermission } = useAuth();
  if (!transfer) return null;

  const fd = transfer.form_data || {};
  const firstName = fd.FirstName || '';
  const lastName  = fd.LastName  || '';
  const name = fd.customer_name || (firstName ? `${firstName} ${lastName}`.trim() : null) || 'Unknown';
  const phone   = fd.customer_phone || fd.Phone || '';
  const phone2  = fd.Phone2 || '';
  const email   = fd.customer_email || fd.Email || '';
  const address = [fd.Address, fd.City, fd.State, fd.Zip].filter(Boolean).join(', ')
    || fd.customer_address || '';

  // Extra form_data fields (beyond the standard ones)
  const extraFields = Object.entries(fd).filter(
    ([k]) => !SKIP_KEYS.has(k) && !k.startsWith('Sale') && !k.startsWith('sale_')
  );

  const hist = Array.isArray(transfer.edit_history) ? transfer.edit_history : [];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
        onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full z-50 flex flex-col shadow-2xl animate-slide-in-right"
        style={{
          width: 'min(480px, 100vw)',
          backgroundColor: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
        }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-white/20">
              <Send size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white truncate max-w-[260px]">{name}</h2>
              <p className="text-xs text-white/70">Transfer Details</p>
            </div>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-xl bg-white/20 hover:bg-white/30 transition-colors">
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* Status bar */}
        {(() => {
          const ds = getTransferDisplayStatus(transfer);
          return (
            <div className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
              style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              <Badge variant={ds.variant}>{ds.label.toUpperCase()}</Badge>
              <span className="text-xs text-text-tertiary ml-auto">
                {new Date(transfer.created_at).toLocaleString()}
              </span>
            </div>
          );
        })()}

        {/* Rejection banner */}
        {transfer.status === 'rejected' && transfer.rejection_reason && (
          <div className="mx-5 mt-4 p-3 rounded-xl flex items-start gap-2 flex-shrink-0"
            style={{ backgroundColor: 'var(--color-error-50)', border: '1px solid var(--color-error-200)' }}>
            <AlertTriangle size={14} className="text-error-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-bold text-error-700">Rejected</p>
              <p className="text-xs text-error-600 mt-0.5">{transfer.rejection_reason}</p>
              {transfer.rejection_count > 1 && (
                <p className="text-xs text-error-500 mt-0.5">Rejected {transfer.rejection_count} time(s)</p>
              )}
            </div>
          </div>
        )}

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {/* Customer */}
          <Section title="Customer">
            <Row label="Name"    value={name} />
            <Row label="Phone"   value={phone} />
            {phone2  && <Row label="Phone 2" value={phone2} />}
            {email   && <Row label="Email"   value={email} />}
            {address && <Row label="Address" value={address} />}
            {fd.BirthDate && <Row label="Birth Date" value={fd.BirthDate} />}
            {fd.Gender    && <Row label="Gender"     value={fd.Gender} />}
          </Section>

          {/* Vehicle (if present) */}
          {(fd.CarYear || fd.CarMake || fd.CarModel) && (
            <Section title="Vehicle">
              {fd.CarYear  && <Row label="Year"  value={fd.CarYear} />}
              {fd.CarMake  && <Row label="Make"  value={fd.CarMake} />}
              {fd.CarModel && <Row label="Model" value={fd.CarModel} />}
              {fd.CarMiles && <Row label="Miles" value={Number(fd.CarMiles).toLocaleString()} />}
              {fd.CarVin   && <Row label="VIN"   value={fd.CarVin} mono />}
            </Section>
          )}

          {/* Extra form fields */}
          {extraFields.length > 0 && (
            <Section title="Additional Info">
              {extraFields.map(([k, v]) => (
                <Row key={k} label={k.replace(/_/g, ' ')} value={String(v)} />
              ))}
            </Section>
          )}

          {/* Sale Status — shown when a sale is linked to this transfer */}
          {transfer.sale_status && (() => {
            const cfg = SALE_STATUS_CONFIG[transfer.sale_status] || { label: transfer.sale_status, color: '#6b7280', bg: '#f3f4f6', icon: Clock };
            const Icon = cfg.icon;
            return (
              <div className="mb-5">
                <p className="text-xs font-bold uppercase tracking-widest mb-2"
                  style={{ color: 'var(--color-primary-600)' }}>
                  <DollarSign size={11} className="inline mr-1" />Sale
                </p>
                <div className="rounded-xl px-4 py-3"
                  style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.color}40` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={14} style={{ color: cfg.color }} />
                    <span className="text-sm font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
                    {transfer.sale_reference_no && (
                      <span className="text-xs font-mono ml-auto" style={{ color: cfg.color }}>
                        {transfer.sale_reference_no}
                      </span>
                    )}
                  </div>
                  {transfer.sale_status === 'needs_revision' && transfer.sale_compliance_note && (
                    <div className="mt-2 flex items-start gap-1.5">
                      <AlertTriangle size={12} style={{ color: '#dc2626', marginTop: 1, flexShrink: 0 }} />
                      <p className="text-xs" style={{ color: '#dc2626' }}>{transfer.sale_compliance_note}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* People */}
          <Section title="People">
            <Row label="Closer" value={
              transfer.closer
                ? `${transfer.closer.first_name || ''} ${transfer.closer.last_name || ''}`.trim()
                : transfer.assigned_to ? '(assigned)' : 'Unassigned'
            } />
            {transfer.fronter_name && <Row label="Fronter" value={transfer.fronter_name} />}
            {transfer.rejection_count > 0 && (
              <Row label="Rejections" value={String(transfer.rejection_count)} />
            )}
          </Section>

          {/* Timeline */}
          <Section title="Timeline">
            <Row label="Created"  value={new Date(transfer.created_at).toLocaleString()} />
            {transfer.updated_at && transfer.updated_at !== transfer.created_at && (
              <Row label="Updated" value={new Date(transfer.updated_at).toLocaleString()} />
            )}
            {transfer.rejected_at && (
              <Row label="Rejected at" value={new Date(transfer.rejected_at).toLocaleString()} />
            )}
          </Section>

          {/* Edit history */}
          {hist.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-bold uppercase tracking-widest mb-2"
                style={{ color: 'var(--color-primary-600)' }}>Edit History</p>
              <div className="space-y-2">
                {hist.map((h, i) => (
                  <div key={i} className="p-3 rounded-xl text-xs"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                    <div className="flex justify-between text-text-tertiary mb-1">
                      <span className="font-semibold capitalize">{h.action || 'Edit'}</span>
                      <span>{new Date(h.edited_at).toLocaleString()}</span>
                    </div>
                    {h.reason && <p className="text-text italic">"{h.reason}"</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
