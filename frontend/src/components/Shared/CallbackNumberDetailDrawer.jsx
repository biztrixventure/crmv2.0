import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Phone, User, Clock, Calendar, Hash, ArrowRight,
  CheckCircle2, XCircle, PhoneCall, PhoneMissed, PhoneOff,
  Voicemail, RefreshCw, Building2, Link2,
  PlusCircle, UserPlus, UserMinus, Edit3, Activity, Shuffle,
  History, LayoutList,
} from 'lucide-react';
import { Badge } from '../UI';
import client from '../../api/client';
import { transferPhone } from '../../utils/phone';

// ── constants ──────────────────────────────────────────────────────────────────
const OUTCOME_META = {
  answered_sold:     { label: 'Answered — Sold',       color: 'var(--color-success-600)', bg: 'color-mix(in srgb, var(--color-success-500) 16%, transparent)', icon: CheckCircle2 },
  answered_no_sale:  { label: 'Answered — No Sale',    color: 'var(--color-info-600)', bg: 'color-mix(in srgb, var(--color-info-500) 16%, transparent)', icon: PhoneCall    },
  answered_callback: { label: 'Answered — Callback',   color: 'var(--color-primary)', bg: 'color-mix(in srgb, var(--color-primary) 16%, transparent)', icon: Calendar     },
  no_answer:         { label: 'No Answer',             color: 'var(--color-warning-600)', bg: 'color-mix(in srgb, var(--color-warning-500) 16%, transparent)', icon: PhoneMissed  },
  voicemail:         { label: 'Voicemail',             color: 'var(--color-info-600)', bg: 'color-mix(in srgb, var(--color-info-500) 16%, transparent)', icon: Voicemail    },
  wrong_number:      { label: 'Wrong Number',          color: 'var(--color-error-600)', bg: 'color-mix(in srgb, var(--color-error-500) 16%, transparent)', icon: XCircle      },
  do_not_call:       { label: 'Do Not Call',           color: 'var(--color-error-700)', bg: 'color-mix(in srgb, var(--color-error-500) 30%, transparent)', icon: PhoneOff     },
};

const EVENT_CONFIG = {
  created:        { icon: PlusCircle, color: 'var(--color-info-500)', bg: 'color-mix(in srgb, var(--color-info-500) 16%, transparent)', label: 'Number Created'       },
  claimed:        { icon: UserPlus,   color: 'var(--color-success-600)', bg: 'color-mix(in srgb, var(--color-success-500) 16%, transparent)', label: 'Ownership Claimed'    },
  owner_released: { icon: UserMinus,  color: 'var(--color-text-secondary)', bg: 'var(--color-bg-secondary)', label: 'Ownership Released'   },
  field_updated:  { icon: Edit3,      color: 'var(--color-primary)', bg: 'color-mix(in srgb, var(--color-primary) 16%, transparent)', label: 'Field Updated'        },
  status_changed: { icon: Activity,   color: 'var(--color-warning-600)', bg: 'color-mix(in srgb, var(--color-warning-500) 16%, transparent)', label: 'Status Changed'       },
  reassigned:     { icon: Shuffle,    color: 'var(--color-primary)', bg: 'color-mix(in srgb, var(--color-primary) 16%, transparent)', label: 'Reassigned by Manager'},
  attempt:        { icon: Phone,      color: 'var(--color-text)', bg: 'var(--color-bg-secondary)', label: 'Call Attempt'         },
};

const RELEASE_REASON_LABEL = {
  inactivity_7d:   '7-day inactivity lockout',
  inactivity_30d:  '30-day auto-release',
  manager_reassign:'Reassigned by manager',
  manager_release: 'Released by manager',
  do_not_call:     'Marked Do Not Call',
  self_release:    'Self-released by owner',
};

const STATUS_BADGE = { active: 'success', claimable: 'warning', released: 'secondary' };

const FIELD_LABEL = { customer_name: 'Customer Name', notes: 'Notes', phone_number: 'Phone Number', status: 'Status', owner_id: 'Owner' };

// ── helpers ────────────────────────────────────────────────────────────────────
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
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
};

const initials = (name) =>
  name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : '?';

const lockDaysLeft = (lockedUntil) => {
  if (!lockedUntil) return null;
  return Math.ceil((new Date(lockedUntil) - Date.now()) / 86400000);
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
    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: m.bg, color: m.color }}>
      <Icon size={11} />
      {m.label}
    </span>
  );
};

// ── Ownership summary card (used in Overview tab) ─────────────────────────────
const ClaimCard = ({ claim, isCurrent }) => {
  const days = claim.owned_until
    ? Math.ceil((new Date(claim.owned_until) - new Date(claim.owned_from)) / 86400000)
    : Math.ceil((Date.now() - new Date(claim.owned_from)) / 86400000);

  return (
    <div className="flex gap-3 pb-4">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{
            background: isCurrent ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
            color: isCurrent ? 'white' : 'var(--color-text-secondary)',
            border: '2px solid var(--color-border)',
          }}>
          {initials(claim.owner_name)}
        </div>
        {!isCurrent && <div className="w-0.5 flex-1 mt-1" style={{ backgroundColor: 'var(--color-border)' }} />}
      </div>
      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="font-semibold text-sm text-text truncate">{claim.owner_name}</span>
          {isCurrent
            ? <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: 'var(--color-success-600)', backgroundColor: 'color-mix(in srgb, var(--color-success-500) 16%, transparent)' }}>Current</span>
            : <span className="text-xs text-text-tertiary">{days}d</span>}
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
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning-500) 16%, transparent)', color: 'var(--color-warning-600)' }}>
              {RELEASE_REASON_LABEL[claim.release_reason] || claim.release_reason}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Timeline event card (used in History tab) ─────────────────────────────────
const TimelineEvent = ({ event }) => {
  let cfg = EVENT_CONFIG[event._type] || EVENT_CONFIG.status_changed;
  let title = cfg.label;
  let color = cfg.color;
  let bg    = cfg.bg;

  // Attempts use outcome colors
  if (event._type === 'attempt') {
    const om = OUTCOME_META[event.outcome];
    if (om) { color = om.color; bg = om.bg; title = `Call — ${om.label}`; }
  }

  const Icon = cfg.icon;

  return (
    <div className="flex gap-3">
      {/* Dot + line */}
      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 32 }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: bg, border: `2px solid ${color}` }}>
          <Icon size={13} style={{ color }} />
        </div>
        <div className="w-0.5 flex-1 mt-1" style={{ backgroundColor: 'var(--color-border)', minHeight: 16 }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-text">{title}</span>
          <span className="text-xs text-text-tertiary flex-shrink-0 mt-0.5">{timeAgo(event._time)}</span>
        </div>

        {/* Actor */}
        <p className="text-xs text-text-secondary mt-0.5 mb-1.5">
          by <span className="font-medium text-text">{event._actor || 'System'}</span>
          <span className="text-text-tertiary ml-2">{fmt(event._time)}</span>
        </p>

        {/* Event-specific details */}
        {event._type === 'attempt' && (
          <div className="space-y-1">
            <OutcomePill outcome={event.outcome} />
            {event.remarks && (
              <p className="text-xs italic mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                "{event.remarks}"
              </p>
            )}
            {event.scheduled_callback_at && (
              <p className="text-xs flex items-center gap-1 mt-1" style={{ color: 'var(--color-primary-600)' }}>
                <Calendar size={11} /> Callback: {fmt(event.scheduled_callback_at)}
              </p>
            )}
          </div>
        )}

        {event._type === 'field_updated' && (
          <div className="mt-1 p-2 rounded-lg text-xs space-y-1"
            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <p className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
              {FIELD_LABEL[event.field_name] || event.field_name}
            </p>
            <div className="flex items-start gap-2">
              <span className="px-1.5 py-0.5 rounded line-through opacity-60"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-error-500) 16%, transparent)', color: 'var(--color-error-600)' }}>
                {event.old_value || '(empty)'}
              </span>
              <ArrowRight size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
              <span className="px-1.5 py-0.5 rounded font-medium"
                style={{ backgroundColor: 'color-mix(in srgb, var(--color-success-500) 16%, transparent)', color: 'var(--color-success-600)' }}>
                {event.new_value || '(empty)'}
              </span>
            </div>
          </div>
        )}

        {event._type === 'status_changed' && (
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={STATUS_BADGE[event.old_value] || 'secondary'} size="sm">
              {event.old_value || '—'}
            </Badge>
            <ArrowRight size={12} style={{ color: 'var(--color-text-tertiary)' }} />
            <Badge variant={STATUS_BADGE[event.new_value] || 'secondary'} size="sm">
              {event.new_value || '—'}
            </Badge>
            {event.metadata?.reason && (
              <span className="text-xs ml-1" style={{ color: 'var(--color-text-secondary)' }}>
                — {RELEASE_REASON_LABEL[event.metadata.reason] || event.metadata.reason}
              </span>
            )}
          </div>
        )}

        {event._type === 'reassigned' && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Number moved to new owner by manager.
          </p>
        )}

        {event._type === 'claimed' && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            <span className="text-xs px-2 py-0.5 rounded"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-success-500) 16%, transparent)', color: 'var(--color-success-600)' }}>
              {event._actor} took ownership
            </span>
            {event.attempt_count > 0 && (
              <span className="text-xs px-2 py-0.5 rounded"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                {event.attempt_count} prior attempts on this number
              </span>
            )}
          </div>
        )}

        {event._type === 'owner_released' && event.release_reason && (
          <span className="text-xs px-2 py-0.5 rounded mt-1 inline-block"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-warning-500) 16%, transparent)', color: 'var(--color-warning-600)' }}>
            {RELEASE_REASON_LABEL[event.release_reason] || event.release_reason}
          </span>
        )}

        {event._type === 'created' && event.metadata?.source && (
          <span className="text-xs px-2 py-0.5 rounded mt-1 inline-block capitalize"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-info-500) 16%, transparent)', color: 'var(--color-info-500)' }}>
            Source: {event.metadata.source}
          </span>
        )}
      </div>
    </div>
  );
};

// ── main drawer ────────────────────────────────────────────────────────────────
export default function CallbackNumberDetailDrawer({ numberId, numberRow, onClose, apiBase = 'compliance/callback-numbers' }) {
  const [detail,  setDetail]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [tab,     setTab]     = useState('overview'); // 'overview' | 'history'

  useEffect(() => {
    if (!numberId) return;
    setLoading(true);
    setError(null);
    client.get(`${apiBase}/${numberId}`)
      .then(r => setDetail(r.data))
      .catch(() => setError('Failed to load details'))
      .finally(() => setLoading(false));
  }, [numberId, apiBase]);

  // Build unified timeline from history + claims + attempts
  const timeline = useMemo(() => {
    if (!detail) return [];
    const { history = [], claims = [], attempts = [] } = detail;

    const events = [
      // Audit log events (created, field_updated, status_changed, reassigned)
      ...history.map(h => ({ ...h, _id: `h-${h.id}`, _type: h.action, _time: h.created_at, _actor: h.actor_name })),
      // Ownership events: each claim yields a "claimed" + optionally "owner_released" event
      ...claims.flatMap(c => [
        { ...c, _id: `c-in-${c.id}`,  _type: 'claimed',        _time: c.owned_from, _actor: c.owner_name },
        c.owned_until
          ? { ...c, _id: `c-out-${c.id}`, _type: 'owner_released', _time: c.owned_until, _actor: c.owner_name }
          : null,
      ]).filter(Boolean),
      // Call attempts
      ...attempts.map(a => ({ ...a, _id: `a-${a.id}`, _type: 'attempt', _time: a.attempted_at, _actor: a.caller_name })),
    ];

    return events.sort((a, b) => new Date(b._time) - new Date(a._time));
  }, [detail]);

  if (!numberId) return null;

  const number   = detail?.number   || numberRow || {};
  const claims   = detail?.claims   || [];
  const attempts = detail?.attempts || [];
  const transfer = detail?.transfer || null;

  const daysLocked  = lockDaysLeft(number.locked_until);
  const daysRelease = number.release_at
    ? Math.ceil((new Date(number.release_at) - Date.now()) / 86400000)
    : null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bsx-scrim" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-lg z-[61] flex flex-col shadow-2xl animate-slide-in-right"
        style={{ backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>

        {/* ── Header ── */}
        <div className="flex items-start justify-between p-5 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
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
          <button onClick={onClose} className="p-2 rounded-lg transition-colors hover:bg-bg-secondary flex-shrink-0">
            <X size={18} style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>

        {/* ── Status bar ── */}
        <div className="flex items-center flex-wrap gap-2 px-5 py-3 flex-shrink-0"
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
            <span className="text-xs px-2 py-0.5 rounded-full ml-auto"
              style={{ backgroundColor: 'var(--color-primary-50)', color: 'var(--color-primary-700)', border: '1px solid var(--color-primary-200)' }}>
              {claims.length} owner{claims.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* ── Tab switcher ── */}
        <div className="flex gap-1 px-5 py-2 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
          {[
            { key: 'overview', label: 'Overview', icon: LayoutList },
            { key: 'history',  label: `Full History${timeline.length ? ` (${timeline.length})` : ''}`, icon: History },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: tab === t.key ? 'var(--gradient-sidebar)' : 'transparent',
                color:      tab === t.key ? 'white' : 'var(--color-text-secondary)',
              }}>
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Loading */}
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

          {!loading && tab === 'overview' && (
            <>
              {/* Number Info */}
              <SectionHeader icon={Phone} title="Number Info" />
              <div className="px-5 py-3">
                <Row label="Phone"    value={number.phone_number} />
                <Row label="Customer" value={number.customer_name} />
                <Row label="Status"   value={number.status} />
                <Row label="Source"   value={number.source} />
                <Row label="Notes"    value={number.notes} />
                <Row label="Created"  value={fmt(number.created_at)} />
              </div>

              {/* Current Owner */}
              {number.owner_name && (
                <>
                  <SectionHeader icon={User} title="Current Owner" />
                  <div className="px-5 py-3">
                    <Row label="Owner"    value={number.owner_name} />
                    <Row label="Assigned" value={fmt(number.assigned_at)} />
                    <Row label="Lock expires"
                      value={
                        daysLocked != null
                          ? daysLocked <= 0 ? 'Expired — claimable now'
                          : `${daysLocked} day${daysLocked !== 1 ? 's' : ''} (${fmtDate(number.locked_until)})`
                          : null
                      }
                    />
                    <Row label="Auto-release"
                      value={
                        daysRelease != null
                          ? daysRelease <= 0 ? 'Expired'
                          : `${daysRelease} day${daysRelease !== 1 ? 's' : ''} (${fmtDate(number.release_at)})`
                          : null
                      }
                    />
                  </div>
                </>
              )}

              {/* Ownership Chain */}
              <SectionHeader icon={ArrowRight} title="Ownership Chain" count={claims.length} />
              <div className="px-5 py-4">
                {claims.length === 0
                  ? <p className="text-sm text-text-secondary text-center py-4">No ownership records.</p>
                  : claims.map((c, i) => (
                    <ClaimCard key={c.id} claim={c} isCurrent={i === 0 && !c.owned_until} />
                  ))
                }
              </div>

              {/* Call Attempts */}
              <SectionHeader icon={PhoneCall} title="Call Attempt Log" count={attempts.length} />
              <div className="px-5 py-3">
                {attempts.length === 0
                  ? <p className="text-sm text-text-secondary text-center py-4">No call attempts logged.</p>
                  : (
                    <div className="space-y-3">
                      {attempts.map((a, i) => (
                        <div key={a.id} className="p-3 rounded-xl"
                          style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0"
                                style={{ background: 'var(--gradient-sidebar)', fontSize: '9px' }}>
                                {initials(a.caller_name)}
                              </div>
                              <span className="text-sm font-semibold text-text">{a.caller_name}</span>
                              {i === 0 && (
                                <span className="text-xs px-1.5 py-0.5 rounded font-semibold"
                                  style={{ color: 'var(--color-primary-700)', backgroundColor: 'var(--color-primary-50)' }}>
                                  Latest
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-text-tertiary flex-shrink-0">{fmt(a.attempted_at)}</span>
                          </div>
                          <OutcomePill outcome={a.outcome} />
                          {a.remarks && (
                            <p className="text-xs text-text-secondary mt-1.5 italic">"{a.remarks}"</p>
                          )}
                          {a.scheduled_callback_at && (
                            <p className="text-xs mt-1.5 flex items-center gap-1"
                              style={{ color: 'var(--color-primary-600)' }}>
                              <Calendar size={11} />
                              Callback: {fmt(a.scheduled_callback_at)}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                }
              </div>

              {/* Linked Transfer */}
              {transfer && (
                <>
                  <SectionHeader icon={Link2} title="Linked Transfer" />
                  <div className="px-5 py-3">
                    <Row label="Customer" value={
                      transfer.form_data?.FirstName
                        ? `${transfer.form_data.FirstName} ${transfer.form_data.LastName || ''}`.trim()
                        : transfer.form_data?.customer_name || '—'
                    } />
                    <Row label="Phone"  value={transferPhone(transfer)} />
                    <Row label="Status" value={transfer.status} />
                    <Row label="Date"   value={fmt(transfer.created_at)} />
                  </div>
                </>
              )}
            </>
          )}

          {!loading && tab === 'history' && (
            <div className="px-5 pt-5">
              {timeline.length === 0 ? (
                <div className="text-center py-16">
                  <History size={36} className="mx-auto mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
                  <p className="text-sm text-text-secondary">No history recorded yet.</p>
                  <p className="text-xs text-text-tertiary mt-1">History is recorded going forward from when this feature was enabled.</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-text-tertiary mb-4">
                    {timeline.length} event{timeline.length !== 1 ? 's' : ''} — newest first
                  </p>
                  <div>
                    {timeline.map((event, i) => (
                      <TimelineEvent key={event._id} event={event} isLast={i === timeline.length - 1} />
                    ))}
                    {/* End cap */}
                    <div className="flex gap-3 pb-6">
                      <div className="flex flex-col items-center" style={{ width: 32 }}>
                        <div className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: 'var(--color-border)' }} />
                      </div>
                      <p className="text-xs text-text-tertiary pt-0.5">Start of record</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
