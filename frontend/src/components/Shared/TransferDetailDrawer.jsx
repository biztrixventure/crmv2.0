import { useState, useEffect, useCallback } from 'react';
import { X, Clock, AlertTriangle, Send, DollarSign, CheckCircle, XCircle, MessageSquare, Activity, UserPlus } from 'lucide-react';
import { Badge } from '../UI';
import FetchDispoButton from '../Vicidial/FetchDispoButton';
import { useAuth } from '../../contexts/AuthContext';
import { getTransferDisplayStatus } from '../../utils/transferStatus';
import { useDrawerLayout } from '../../hooks/useDrawerLayout';
import client from '../../api/client';

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
  // Internal/derived keys we never want to show as free-form rows.
  'manual_entry_by',   // rendered as a dedicated banner instead
  'cli_number',        // dedup key (same as Phone)
  'transfer_date',     // shown in header timestamp
  'last_redial_at',    // metadata
  'state_abbr',        // duplicate of State
]);

// ── safely stringify a form_data value for display ─────────────────────────
const renderVal = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    // Show JSON instead of [object Object] for any structured value that
    // leaks through SKIP_KEYS — surface the data without breaking the UI.
    try { return JSON.stringify(v); } catch { return ''; }
  }
  return String(v);
};

const ROLE_LABELS = {
  superadmin: 'Super Admin', readonly_admin: 'Admin', compliance_manager: 'Compliance',
  company_admin: 'Company Admin', operations_manager: 'Operations', closer_manager: 'Closer Mgr',
  fronter_manager: 'Fronter Mgr', closer: 'Closer', fronter: 'Fronter',
};

export default function TransferDetailDrawer({ transfer, onClose }) {
  const { hasPermission } = useAuth();
  const { sections } = useDrawerLayout('transfer');
  const [dispoHistory, setDispoHistory] = useState([]);
  const [histLoading,  setHistLoading]  = useState(false);

  const loadHistory = useCallback(() => {
    if (!transfer?.id) return;
    setHistLoading(true);
    client.get(`disposition-configs/history/${transfer.id}`)
      .then(res => setDispoHistory(res.data.history || []))
      .catch(() => setDispoHistory([]))
      .finally(() => setHistLoading(false));
  }, [transfer?.id]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

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

  // Extra form_data fields (beyond the standard ones). Filter out objects +
  // empty/null values so a future internal key never leaks as "[object Object]".
  const extraFields = Object.entries(fd).filter(
    ([k, v]) => !SKIP_KEYS.has(k)
      && !k.startsWith('Sale') && !k.startsWith('sale_')
      && v !== null && v !== undefined && String(v).trim() !== ''
      && typeof v !== 'object'
  );

  // Manual-entry metadata (closer who logged it on behalf of a fronter).
  const manualEntry = fd.manual_entry_by && typeof fd.manual_entry_by === 'object'
    ? fd.manual_entry_by : null;

  const hist = Array.isArray(transfer.edit_history) ? transfer.edit_history : [];

  const closerVal = transfer.closer
    ? `${transfer.closer.first_name || ''} ${transfer.closer.last_name || ''}`.trim()
    : transfer.assigned_closer_name || (transfer.assigned_to ? '(assigned)' : 'Unassigned');

  // ── Field renderers, keyed by the field ids the SuperAdmin sees in Business
  // Rules → Drawer Layout. Rendering is keyed by field id (NOT a hardcoded
  // section), so a field appears in whatever section it was placed/dragged into.
  const FIELD = {
    name:     <Row key="name"    label="Name"    value={name} />,
    phone:    <Row key="phone"   label="Phone"   value={phone} />,
    phone_2:  phone2 ? <Row key="phone_2" label="Phone 2" value={phone2} /> : null,
    email:    email   ? <Row key="email"   label="Email"   value={email} /> : null,
    address:  address ? <Row key="address" label="Address" value={address} /> : null,
    year:     fd.CarYear  ? <Row key="year"  label="Year"  value={fd.CarYear} /> : null,
    make:     fd.CarMake  ? <Row key="make"  label="Make"  value={fd.CarMake} /> : null,
    model:    fd.CarModel ? <Row key="model" label="Model" value={fd.CarModel} /> : null,
    miles:    fd.CarMiles ? <Row key="miles" label="Miles" value={Number(fd.CarMiles).toLocaleString()} /> : null,
    vin:      fd.CarVin   ? <Row key="vin"   label="VIN"   value={fd.CarVin} mono /> : null,
    fronter:  transfer.fronter_name ? <Row key="fronter" label="Fronter" value={transfer.fronter_name} /> : null,
    closer:   <Row key="closer" label="Closer" value={closerVal} />,
    rejections: transfer.rejection_count > 0 ? <Row key="rejections" label="Rejections" value={String(transfer.rejection_count)} /> : null,
    created:  <Row key="created" label="Created" value={new Date(transfer.created_at).toLocaleString()} />,
    updated:  (transfer.updated_at && transfer.updated_at !== transfer.created_at) ? <Row key="updated" label="Updated" value={new Date(transfer.updated_at).toLocaleString()} /> : null,
    rejected: transfer.rejected_at ? <Row key="rejected" label="Rejected at" value={new Date(transfer.rejected_at).toLocaleString()} /> : null,
    dialer_code:  transfer.vicidial_vendor_code ? <Row key="dialer_code"  label="Dialer lead ID"      value={transfer.vicidial_vendor_code} mono /> : null,
    dialer_dispo: transfer.vicidial_dispo       ? <Row key="dialer_dispo" label="Dialer disposition"   value={transfer.vicidial_dispo} /> : null,
  };

  const DEFAULT_FIELDS = {
    customer: ['name', 'phone', 'phone_2', 'email', 'address'],
    vehicle:  ['year', 'make', 'model', 'miles', 'vin'],
    people:   ['fronter', 'closer', 'dialer_code', 'dialer_dispo', 'rejections'],
    timeline: ['created', 'updated', 'rejected'],
  };

  // Ordered, visible {id,label} for a section: configured fields[] or catalog default.
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
      ? <Row key={id} label={label || id.replace(/_/g, ' ')} value={renderVal(v)} /> : null;
  };
  const placed = new Set(sections.flatMap(sec => (sec.fields || []).map(f => f.id)));

  // ── Special (non-field) blocks, rendered by section id. Their visibility is
  // still controlled by the layout config.
  const saleBlock = () => {
    const cfg = SALE_STATUS_CONFIG[transfer.sale_status] || { label: transfer.sale_status, color: '#6b7280', bg: '#f3f4f6', icon: Clock };
    const Icon = cfg.icon;
    return (
      <div className="mb-5" key="sale">
        <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-primary-600)' }}>
          <DollarSign size={11} className="inline mr-1" />Sale
        </p>
        <div className="rounded-xl px-4 py-3" style={{ backgroundColor: cfg.bg, border: `1px solid ${cfg.color}40` }}>
          <div className="flex items-center gap-2 mb-1">
            <Icon size={14} style={{ color: cfg.color }} />
            <span className="text-sm font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
            {transfer.sale_reference_no && (
              <span className="text-xs font-mono ml-auto" style={{ color: cfg.color }}>{transfer.sale_reference_no}</span>
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
  };

  const dispositionsBlock = () => (
    <div className="mb-5" key="dispositions">
      <div className="flex items-center gap-1.5 mb-2">
        <Activity size={11} style={{ color: 'var(--color-primary-600)' }} />
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-primary-600)' }}>Disposition History</p>
      </div>
      {histLoading ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-12 rounded-xl animate-pulse" style={{ backgroundColor: 'var(--color-bg-secondary)' }} />
          ))}
        </div>
      ) : dispoHistory.length === 0 ? (
        <div className="px-4 py-3 rounded-xl flex items-center gap-2 flex-wrap"
          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#9ca3af' }} />
          <span className="text-xs font-semibold" style={{ color: '#6b7280' }}>In Progress</span>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No actions yet</span>
          <span className="ml-auto"><FetchDispoButton transferId={transfer.id} onFetched={loadHistory} /></span>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-[7px] top-3 bottom-3 w-px" style={{ backgroundColor: 'var(--color-border)' }} />
          <div className="space-y-2">
            {dispoHistory.map((d, i) => (
              <div key={d.id || i} className="flex gap-3">
                <div className="w-3.5 h-3.5 rounded-full flex-shrink-0 mt-1 relative z-10 ring-2"
                  style={{ backgroundColor: d.color || '#6b7280', ringColor: 'var(--color-surface)' }} />
                <div className="flex-1 pb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{d.disposition_name}</span>
                    {d.setter_role && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                        {ROLE_LABELS[d.setter_role] || d.setter_role}
                      </span>
                    )}
                    <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
                      {new Date(d.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {d.setter_name && (
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>By {d.setter_name}</p>
                  )}
                  {d.note && (
                    <p className="text-[10px] mt-1 px-2 py-1 rounded-lg italic"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                      "{d.note}"
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const auditBlock = () => (
    <div className="mb-5" key="audit">
      <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-primary-600)' }}>Edit History</p>
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
  );

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

        {/* Manual entry banner — flags that the closer typed this transfer
            on behalf of the fronter via the search "Manual entry" CTA. */}
        {manualEntry?.closer_name && (
          <div className="mx-5 mt-4 p-3 rounded-xl flex items-start gap-2 flex-shrink-0"
            style={{ backgroundColor: 'var(--color-primary-50, #eef2ff)', border: '1px solid var(--color-primary-200, #c7d2fe)' }}>
            <UserPlus size={14} style={{ color: 'var(--color-primary-700, #4338ca)', marginTop: 1 }} className="flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-bold" style={{ color: 'var(--color-primary-700, #4338ca)' }}>
                Manual entry by closer · {manualEntry.closer_name}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                Logged on {manualEntry.entered_at ? new Date(manualEntry.entered_at).toLocaleString() : 'unknown date'} — attributed to this fronter.
              </p>
            </div>
          </div>
        )}

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

        {/* Scrollable body — section order + visibility + field placement come
            from useDrawerLayout (SuperAdmin configures per role in Business
            Rules → Drawer Layout). Rendering is field-id driven, so a field
            dragged into another section appears there. */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {sections.filter(s => s.visible).map(s => {
            // Special (non-field) blocks render by section id.
            if (s.id === 'dispositions') return dispositionsBlock();
            if (s.id === 'audit')        return hist.length > 0 ? auditBlock() : null;

            const rows = sectionFields(s).map(renderField).filter(Boolean);
            // 'lead_info' is the catch-all for any form_data field not placed
            // elsewhere (so newly-added form fields surface automatically).
            if (s.id === 'lead_info') {
              extraFields.filter(([k]) => !placed.has(k)).forEach(([k, v]) => rows.push(
                <Row key={`extra:${k}`} label={k.replace(/_/g, ' ')} value={renderVal(v)} />
              ));
            }
            if (rows.length === 0) return null;
            return <Section key={s.id} title={s.label || s.id}>{rows}</Section>;
          })}

          {/* Sale status — not layout-configurable; shown when a sale is linked. */}
          {transfer.sale_status && saleBlock()}
        </div>
      </div>
    </>
  );
}
