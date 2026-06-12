import { useEffect, useState, useCallback } from 'react';
import { Copy, X, RefreshCw, Clock, User, ArrowRight, AlertTriangle } from 'lucide-react';
import client from '../../api/client';

// Auditable list of duplicate-transfer records. The backend
// (GET /transfers/dedup-events) scopes the rows by role — fronters see only
// their own, managers see their company, compliance/superadmin see everyone —
// so this single modal works in every shell. Each row shows when the duplicate
// was detected, the reason/status, who submitted it, and the original record
// (created date + creator + status), all honoring the SuperAdmin dedup window.

const REASON_STYLE = {
  refresh:      { label: 'Refresh',      bg: 'var(--color-info-50, #eff6ff)',    fg: 'var(--color-info-700, #1d4ed8)',    Icon: RefreshCw },
  reengage:     { label: 'Re-engage',    bg: 'var(--color-warning-50, #fffbeb)', fg: 'var(--color-warning-700, #b45309)', Icon: Clock },
  sale_overlap: { label: 'Sale overlap', bg: 'var(--color-error-50, #fef2f2)',   fg: 'var(--color-error-700, #b91c1c)',   Icon: AlertTriangle },
};

const EVENT_FILTERS = [
  { key: '',             label: 'All' },
  { key: 'refresh',      label: 'Refresh' },
  { key: 'reengage',     label: 'Re-engage' },
  { key: 'sale_overlap', label: 'Sale overlap' },
];

const fmt = (s) => s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const fmtDay = (s) => s ? new Date(s).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const ReasonBadge = ({ type }) => {
  const s = REASON_STYLE[type] || { label: type, bg: 'var(--color-bg-secondary)', fg: 'var(--color-text-secondary)', Icon: Copy };
  const { Icon } = s;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.fg }}>
      <Icon size={11} /> {s.label}
    </span>
  );
};

// showCompany: render the company column (true for compliance/superadmin views).
const DuplicateRecordsModal = ({ onClose, showCompany = false, title = 'Duplicate Transfer Records' }) => {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [eventType, setEventType] = useState('');
  const [total, setTotal]     = useState(0);
  const [error, setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await client.get('transfers/dedup-events', { params: { event_type: eventType || undefined, limit: 100 } });
      setRows(r.data.events || []);
      setTotal(r.data.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load duplicate records');
    } finally { setLoading(false); }
  }, [eventType]);

  useEffect(() => { load(); }, [load]);

  const windowDays = rows[0]?.dedup_window_days;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative w-full max-w-5xl my-6 rounded-2xl animate-scale-in flex flex-col"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)', maxHeight: '88vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 rounded-t-2xl flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-white/20 rounded-xl"><Copy size={18} className="text-white" /></div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white truncate">{title}</h2>
              <p className="text-xs text-white/80">
                {total} record{total === 1 ? '' : 's'}
                {windowDays != null && ` · detection window ${windowDays} day${windowDays === 1 ? '' : 's'}`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 flex-shrink-0"><X size={18} className="text-white" /></button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-6 py-3 flex-wrap flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {EVENT_FILTERS.map(f => (
            <button key={f.key} onClick={() => setEventType(f.key)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              style={{
                background: eventType === f.key ? 'var(--gradient-sidebar)' : 'var(--color-surface)',
                color: eventType === f.key ? 'white' : 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
              }}>{f.label}</button>
          ))}
          <button onClick={load} className="ml-auto p-2 rounded-lg" title="Refresh"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4" style={{ backgroundColor: 'var(--color-bg)' }}>
          {error ? (
            <p className="text-sm text-center py-10" style={{ color: 'var(--color-error-600)' }}>{error}</p>
          ) : loading ? (
            <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16">
              <Copy size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
              <p className="font-semibold" style={{ color: 'var(--color-text)' }}>No duplicate records</p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>Nothing matched within the configured detection window.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.id} className="rounded-xl p-3"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <ReasonBadge type={r.event_type} />
                    <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                      {r.current_transfer?.customer_name || r.original_transfer?.customer_name || 'Unknown customer'}
                    </span>
                    {r.normalized_phone && (
                      <code className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                        {r.normalized_phone}
                      </code>
                    )}
                    {showCompany && r.company && (
                      <span className="text-[11px] px-2 py-0.5 rounded-md font-semibold"
                        style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}>
                        {r.company.name}
                      </span>
                    )}
                    <span className="ml-auto text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                      Detected {fmt(r.detected_at)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    {/* Submitted by */}
                    <div className="rounded-lg px-2.5 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Submitted by</p>
                      <p className="flex items-center gap-1 font-semibold" style={{ color: 'var(--color-text)' }}>
                        <User size={11} /> {r.fronter?.name || 'Unknown'}
                      </p>
                      <p style={{ color: 'var(--color-text-secondary)' }}>Reason: {r.reason}</p>
                    </div>

                    {/* Original record */}
                    <div className="rounded-lg px-2.5 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Original record</p>
                      {r.original_transfer ? (
                        <>
                          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>Created {fmtDay(r.original_transfer.created_at)}</p>
                          <p style={{ color: 'var(--color-text-secondary)' }}>
                            by {r.original_transfer.created_by_name} · {r.original_transfer.status}
                          </p>
                        </>
                      ) : <p style={{ color: 'var(--color-text-tertiary)' }}>—</p>}
                    </div>

                    {/* Current record */}
                    <div className="rounded-lg px-2.5 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5 flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
                        <ArrowRight size={10} /> Current record
                      </p>
                      {r.current_transfer ? (
                        <>
                          <p className="font-semibold" style={{ color: 'var(--color-text)' }}>{r.current_transfer.status}</p>
                          <p style={{ color: 'var(--color-text-secondary)' }}>Updated {fmtDay(r.current_transfer.created_at)}</p>
                        </>
                      ) : <p style={{ color: 'var(--color-text-tertiary)' }}>—</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DuplicateRecordsModal;
