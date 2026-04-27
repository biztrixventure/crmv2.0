import { useState, useEffect } from 'react';
import { X, Phone, AlertTriangle, RefreshCw, CheckCircle, Clock, XCircle, PhoneMissed, Star } from 'lucide-react';
import { Badge } from '../UI';
import client from '../../api/client';

const STATUS_META = {
  pending:   { label: 'Pending',   variant: 'warning', icon: Clock       },
  completed: { label: 'Completed', variant: 'success', icon: CheckCircle },
  cancelled: { label: 'Cancelled', variant: 'secondary', icon: XCircle   },
  no_answer: { label: 'No Answer', variant: 'error',   icon: PhoneMissed },
};

const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const timeAgo = (iso) => {
  if (!iso) return '';
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const initials = (name) =>
  name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';

export default function CallbackPhoneHistoryDrawer({ phone, customerName, onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!phone) return;
    setLoading(true);
    setError(null);
    client.get('compliance/callbacks/phone-history', { params: { phone } })
      .then(r => setData(r.data))
      .catch(() => setError('Failed to load history'))
      .finally(() => setLoading(false));
  }, [phone]);

  if (!phone) return null;

  const callbacks     = data?.callbacks     || [];
  const pendingCount  = data?.pending_count ?? 0;
  const hasDuplicates = pendingCount > 1;

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-lg z-50 flex flex-col shadow-2xl"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>

        {/* Header */}
        <div className="flex items-start justify-between p-5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Phone size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text font-mono">{phone}</h2>
              {customerName && (
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{customerName}</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg transition-colors hover:bg-bg-secondary flex-shrink-0">
            <X size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        {/* Stats bar */}
        {data && (
          <div className="flex items-center flex-wrap gap-2 px-5 py-3 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              {data.total} callback{data.total !== 1 ? 's' : ''} total
            </span>
            {pendingCount > 0 && (
              <Badge variant="warning" size="sm">{pendingCount} pending</Badge>
            )}
            {hasDuplicates && (
              <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: '#fef3c7', color: '#d97706', border: '1px solid #fde68a' }}>
                <AlertTriangle size={11} />
                {pendingCount} agents scheduled this number
              </span>
            )}
            {data.first_agent && (
              <span className="text-xs ml-auto" style={{ color: 'var(--color-text-secondary)' }}>
                First: <span className="font-semibold text-text">{data.first_agent}</span>
                <span className="ml-1 text-text-tertiary">({fmtDate(data.first_at)})</span>
              </span>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex justify-center items-center py-16">
              <RefreshCw size={22} className="animate-spin" style={{ color: 'var(--color-primary-500)' }} />
            </div>
          )}
          {error && (
            <div className="mx-5 mt-4 p-3 rounded-xl text-sm"
              style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)' }}>
              {error}
            </div>
          )}

          {!loading && data && callbacks.length === 0 && (
            <div className="text-center py-16">
              <Phone size={36} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
              <p className="text-sm text-text-secondary">No callbacks found for this number.</p>
            </div>
          )}

          {!loading && callbacks.length > 0 && (
            <div className="px-5 pt-5">
              <p className="text-xs text-text-tertiary mb-4">
                Sorted oldest first — first scheduled is at top
              </p>

              {/* Duplicate warning box */}
              {hasDuplicates && (
                <div className="mb-4 p-3 rounded-xl flex items-start gap-2"
                  style={{ backgroundColor: '#fef3c7', border: '1px solid #fde68a' }}>
                  <AlertTriangle size={15} style={{ color: '#d97706', flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <p className="text-xs font-bold" style={{ color: '#d97706' }}>Duplicate Active Callbacks</p>
                    <p className="text-xs mt-0.5" style={{ color: '#92400e' }}>
                      {pendingCount} agents have this number pending simultaneously.
                      Only <strong>{callbacks.find(c => c.status === 'pending')?.agent_name}</strong> scheduled it first.
                    </p>
                  </div>
                </div>
              )}

              {/* Timeline */}
              <div>
                {callbacks.map((cb, i) => {
                  const sm = STATUS_META[cb.status] || STATUS_META.pending;
                  const StatusIcon = sm.icon;
                  const isFirst = i === 0;
                  const isLast  = i === callbacks.length - 1;

                  return (
                    <div key={cb.id} className="flex gap-3">
                      {/* Dot + line */}
                      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 32 }}>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ background: isFirst ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)', color: isFirst ? 'white' : 'var(--color-text-secondary)', border: '2px solid var(--color-border)' }}>
                          {isFirst ? <Star size={13} /> : initials(cb.agent_name)}
                        </div>
                        {!isLast && <div className="w-0.5 flex-1 mt-1" style={{ backgroundColor: 'var(--color-border)', minHeight: 20 }} />}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pb-5">
                        {/* Name row */}
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-sm text-text">{cb.agent_name}</span>
                            {isFirst && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}>
                                First
                              </span>
                            )}
                            {cb.status === 'pending' && !isFirst && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: '#fef3c7', color: '#d97706' }}>
                                Also pending
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-text-tertiary flex-shrink-0">{timeAgo(cb.created_at)}</span>
                        </div>

                        {/* Company */}
                        {cb.company_name && (
                          <p className="text-xs text-text-secondary mb-1">{cb.company_name}</p>
                        )}

                        {/* Detail card */}
                        <div className="p-3 rounded-xl mt-1"
                          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-1.5">
                              <StatusIcon size={13} style={{ color: `var(--color-${sm.variant}-600)` }} />
                              <Badge variant={sm.variant} size="sm">{sm.label}</Badge>
                            </div>
                            <span className="text-xs text-text-tertiary">Scheduled: {fmt(cb.callback_at)}</span>
                          </div>

                          <div className="space-y-0.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                            <p>Customer: <span className="text-text font-medium">{cb.customer_name || '—'}</span></p>
                            <p>Created: <span className="text-text">{fmt(cb.created_at)}</span></p>
                            {cb.source !== 'manual' && (
                              <p>Source: <span className="text-text capitalize">{cb.source}</span></p>
                            )}
                          </div>

                          {cb.notes && (
                            <p className="text-xs italic mt-2 pt-2"
                              style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                              "{cb.notes}"
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* End cap */}
                <div className="flex gap-3 pb-6">
                  <div className="flex flex-col items-center" style={{ width: 32 }}>
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: 'var(--color-border)' }} />
                  </div>
                  <p className="text-xs text-text-tertiary pt-0.5">End of records</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
