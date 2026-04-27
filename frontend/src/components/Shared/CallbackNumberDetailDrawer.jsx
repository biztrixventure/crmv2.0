import { useState, useEffect } from 'react';
import {
  X, Phone, User, Clock, Calendar, Hash, ArrowRight,
  CheckCircle2, XCircle, PhoneCall, PhoneMissed, PhoneOff,
  AlertTriangle, Voicemail, RefreshCw, Building2, Link2,
} from 'lucide-react';
import { Badge } from '../UI';
import client from '../../api/client';

// ── constants ──────────────────────────────────────────────────────────────────
const OUTCOME_META = {
  answered_sold:     { label: 'Answered — Sold',       color: '#16a34a', bg: '#dcfce7', icon: CheckCircle2   },
  answered_no_sale:  { label: 'Answered — No Sale',    color: '#2563eb', bg: '#dbeafe', icon: PhoneCall       },
  answered_callback: { label: 'Answered — Callback',   color: '#7c3aed', bg: '#ede9fe', icon: Calendar        },
  no_answer:         { label: 'No Answer',             color: '#d97706', bg: '#fef3c7', icon: PhoneMissed     },
  voicemail:         { label: 'Voicemail',             color: '#0891b2', bg: '#cffafe', icon: Voicemail       },
  wrong_number:      { label: 'Wrong Number',          color: '#dc2626', bg: '#fee2e2', icon: XCircle         },
  do_not_call:       { label: 'Do Not Call',           color: '#7f1d1d', bg: '#fecaca', icon: PhoneOff        },
};

const RELEASE_REASON_LABEL = {
  inactivity_7d:   'Locked out — 7 days no attempt',
  inactivity_30d:  'Auto-released — 30 day limit reached',
  manager_reassign:'Reassigned by manager',
  do_not_call:     'Marked Do Not Call',
  self_release:    'Released by owner',
};

const STATUS_BADGE = {
  active:    'success',
  claimable: 'warning',
  released:  'secondary',
};

// ── helpers ────────────────────────────────────────────────────────────────────
const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const initials = (name) =>
  name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';

const lockDaysLeft = (lockedUntil) => {
  if (!lockedUntil) return null;
  const diff = Math.ceil((new Date(lockedUntil) - Date.now()) / 86400000);
  return diff;
};

// ── sub-components ─────────────────────────────────────────────────────────────
const Row = ({ label, value }) =>
  value != null && value !== '' ? (
    <div className="flex items-start gap-4 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="text-xs font-bold text-text-secondary uppercase tracking-wider w-32 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-text flex-1">{value}</span>
    </div>
  ) : null;

const SectionHeader = ({ icon: Icon, title, count }) => (
  <div className="flex items-center gap-2 px-5 py-3"
    style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
    <Icon size={14} style={{ color: 'var(--color-primary-500)' }} />
    <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest flex-1">{title}</h3>
    {count != null && (
      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
        style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
        {count}
      </span>
    )}
  </div>
);

const OutcomePill = ({ outcome }) => {
  const m = OUTCOME_META[outcome];
  if (!m) return <span className="text-xs text-text-secondary">{outcome || '—'}</span>;
  const Icon = m.icon;
  return (
    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: m.bg, color: m.color }}>
      <Icon size={11} />
      {m.label}
    </span>
  );
};

// Vertical ownership timeline entry
const ClaimEntry = ({ claim, isCurrent }) => {
  const days = claim.owned_until
    ? Math.ceil((new Date(claim.owned_until) - new Date(claim.owned_from)) / 86400000)
    : Math.ceil((Date.now() - new Date(claim.owned_from)) / 86400000);

  return (
    <div className="flex gap-3 pb-4">
      {/* Timeline line + dot */}
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ background: isCurrent ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)', color: isCurrent ? 'white' : 'var(--color-text-secondary)', border: '2px solid var(--color-border)' }}>
          {initials(claim.owner_name)}
        </div>
        {!isCurrent && <div className="w-0.5 flex-1 mt-1" style={{ backgroundColor: 'var(--color-border)' }} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="font-semibold text-sm text-text truncate">{claim.owner_name}</span>
          {isCurrent
            ? <span className="text-xs font-bold px-2 py-0.5 rounded-full text-success-700 bg-success-50">Current</span>
            : <span className="text-xs text-text-tertiary">{days}d</span>
          }
        </div>
        <p className="text-xs text-text-secondary mb-1">
          {fmtDate(claim.owned_from)} — {claim.owned_until ? fmtDate(claim.owned_until) : 'Present'}
        </p>
        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className="text-xs px-2 py-0.5 rounded"
            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            {claim.attempt_count} attempt{claim.attempt_count !== 1 ? 's' : ''}
          </span>
          {claim.last_outcome && <OutcomePill outcome={claim.last_outcome} />}
          {!isCurrent && claim.release_reason && (
            <span className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: 'var(--color-warning-50)', color: 'var(--color-warning-700)' }}>
              {RELEASE_REASON_LABEL[claim.release_reason] || claim.release_reason}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ── main drawer ────────────────────────────────────────────────────────────────
export default function CallbackNumberDetailDrawer({ numberId, numberRow, onClose, apiBase = 'compliance/callback-numbers' }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!numberId) return;
    setLoading(true);
    setError(null);
    client.get(`${apiBase}/${numberId}`)
      .then(r => setDetail(r.data))
      .catch(() => setError('Failed to load details'))
      .finally(() => setLoading(false));
  }, [numberId, apiBase]);

  if (!numberId) return null;

  const number   = detail?.number   || numberRow || {};
  const claims   = detail?.claims   || [];
  const attempts = detail?.attempts || [];
  const transfer = detail?.transfer || null;

  const daysLocked = lockDaysLeft(number.locked_until);
  const daysRelease = number.release_at
    ? Math.ceil((new Date(number.release_at) - Date.now()) / 86400000)
    : null;

  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-lg z-50 flex flex-col shadow-2xl overflow-y-auto"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>

        {/* ── Header ── */}
        <div className="flex items-start justify-between p-5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'var(--gradient-sidebar)' }}>
              <Hash size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text font-mono">{number.phone_number || '—'}</h2>
              {number.customer_name && (
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{number.customer_name}</p>
              )}
            </div>
          </div>
          <button onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:bg-bg-secondary flex-shrink-0">
            <X size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        {/* ── Status bar ── */}
        <div className="flex items-center flex-wrap gap-2 px-5 py-3"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          <Badge variant={STATUS_BADGE[number.status] || 'secondary'}>
            {number.status || '—'}
          </Badge>
          {number.company_name && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              {number.company_name}
            </span>
          )}
          {claims.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary-700)', border: '1px solid var(--color-primary-200)' }}>
              {claims.length} owner{claims.length !== 1 ? 's' : ''} total
            </span>
          )}
        </div>

        {/* ── Loading / Error ── */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <RefreshCw size={22} className="animate-spin" style={{ color: 'var(--color-primary-500)' }} />
          </div>
        )}
        {error && (
          <div className="mx-5 mt-4 p-3 rounded-xl text-sm"
            style={{ backgroundColor: 'var(--color-error-50)', color: 'var(--color-error-700)' }}>
            {error}
          </div>
        )}

        {!loading && (
          <>
            {/* ── Number Info ── */}
            <SectionHeader icon={Phone} title="Number Info" />
            <div className="px-5 py-3">
              <Row label="Phone"        value={number.phone_number} />
              <Row label="Customer"     value={number.customer_name} />
              <Row label="Status"       value={number.status} />
              <Row label="Source"       value={number.source} />
              <Row label="Notes"        value={number.notes} />
              <Row label="Created"      value={fmt(number.created_at)} />
            </div>

            {/* ── Current Owner ── */}
            {number.owner_name && (
              <>
                <SectionHeader icon={User} title="Current Owner" />
                <div className="px-5 py-3">
                  <Row label="Owner"        value={number.owner_name} />
                  <Row label="Assigned"     value={fmt(number.assigned_at)} />
                  <Row label="Lock expires"
                    value={
                      daysLocked != null
                        ? daysLocked <= 0
                          ? 'Expired — claimable now'
                          : `${daysLocked} day${daysLocked !== 1 ? 's' : ''} (${fmtDate(number.locked_until)})`
                        : null
                    }
                  />
                  <Row label="Auto-release"
                    value={
                      daysRelease != null
                        ? daysRelease <= 0
                          ? 'Expired'
                          : `${daysRelease} day${daysRelease !== 1 ? 's' : ''} (${fmtDate(number.release_at)})`
                        : null
                    }
                  />
                </div>
              </>
            )}

            {/* ── Ownership Chain ── */}
            <SectionHeader icon={ArrowRight} title="Ownership Chain" count={claims.length} />
            <div className="px-5 py-4">
              {claims.length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-4">No ownership records.</p>
              ) : (
                <div>
                  {claims.map((c, i) => (
                    <ClaimEntry key={c.id} claim={c} isCurrent={i === 0 && !c.owned_until} />
                  ))}
                </div>
              )}
            </div>

            {/* ── Call Attempt Log ── */}
            <SectionHeader icon={PhoneCall} title="Call Attempt Log" count={attempts.length} />
            <div className="px-5 py-3">
              {attempts.length === 0 ? (
                <p className="text-sm text-text-secondary text-center py-4">No call attempts logged.</p>
              ) : (
                <div className="space-y-3">
                  {attempts.map((a, i) => (
                    <div key={a.id}
                      className="p-3 rounded-xl"
                      style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                            style={{ background: 'var(--gradient-sidebar)', fontSize: '9px' }}>
                            {initials(a.caller_name)}
                          </div>
                          <span className="text-sm font-semibold text-text">{a.caller_name}</span>
                          {i === 0 && (
                            <span className="text-xs px-1.5 py-0.5 rounded text-primary-700 bg-primary-50 font-semibold">Latest</span>
                          )}
                        </div>
                        <span className="text-xs text-text-tertiary flex-shrink-0">{fmt(a.attempted_at)}</span>
                      </div>
                      <OutcomePill outcome={a.outcome} />
                      {a.remarks && (
                        <p className="text-xs text-text-secondary mt-1.5 leading-relaxed italic">
                          "{a.remarks}"
                        </p>
                      )}
                      {a.scheduled_callback_at && (
                        <p className="text-xs mt-1.5 flex items-center gap-1"
                          style={{ color: 'var(--color-primary-600)' }}>
                          <Calendar size={11} />
                          Callback scheduled: {fmt(a.scheduled_callback_at)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Status Timeline (derived from claims) ── */}
            {claims.length > 0 && (
              <>
                <SectionHeader icon={Clock} title="Status Timeline" />
                <div className="px-5 py-3 space-y-2">
                  {/* Current state */}
                  <div className="flex items-center gap-3 text-xs">
                    <div className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: number.status === 'active' ? '#16a34a' : number.status === 'claimable' ? '#d97706' : '#6b7280' }} />
                    <span className="text-text font-semibold capitalize">{number.status}</span>
                    <span className="text-text-tertiary ml-auto">{fmtDate(number.updated_at || number.created_at)}</span>
                  </div>

                  {/* Each claim transition */}
                  {claims.filter(c => c.owned_until).map(c => (
                    <div key={c.id} className="flex items-center gap-3 text-xs pl-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-warning-400" />
                      <span className="text-text-secondary">
                        {RELEASE_REASON_LABEL[c.release_reason] || c.release_reason}
                      </span>
                      <span className="text-text-tertiary ml-auto">{fmtDate(c.owned_until)}</span>
                    </div>
                  ))}

                  {/* Creation */}
                  <div className="flex items-center gap-3 text-xs pl-1">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: 'var(--color-primary-400)' }} />
                    <span className="text-text-secondary">Number created</span>
                    <span className="text-text-tertiary ml-auto">{fmtDate(number.created_at)}</span>
                  </div>
                </div>
              </>
            )}

            {/* ── Linked Transfer ── */}
            {transfer && (
              <>
                <SectionHeader icon={Link2} title="Linked Transfer" />
                <div className="px-5 py-3">
                  <Row label="Customer" value={
                    transfer.form_data?.FirstName
                      ? `${transfer.form_data.FirstName} ${transfer.form_data.LastName || ''}`.trim()
                      : transfer.form_data?.customer_name || '—'
                  } />
                  <Row label="Phone"   value={transfer.form_data?.Phone || transfer.form_data?.customer_phone} />
                  <Row label="Status"  value={transfer.status} />
                  <Row label="Date"    value={fmt(transfer.created_at)} />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
