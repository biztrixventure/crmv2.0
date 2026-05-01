import React, { useState, useRef, useEffect } from 'react';
import SmartText from './SmartText';
import { Bell, BellOff, Check, Trash2, X, DollarSign, Users, ArrowRight, Phone, ShieldCheck, RotateCcw, AlertCircle, AlertTriangle } from 'lucide-react';

// Icon per notification type
const TYPE_ICON = {
  sale_created:        { icon: DollarSign,  bg: '#dcfce7', color: '#16a34a' },
  sale_updated:        { icon: DollarSign,  bg: '#fef9c3', color: '#ca8a04' },
  sale_approved:       { icon: ShieldCheck, bg: '#dcfce7', color: '#15803d' },
  sale_needs_revision: { icon: RotateCcw,   bg: '#fee2e2', color: '#b91c1c' },
  sale_pending_review: { icon: AlertCircle, bg: '#fef3c7', color: '#b45309' },
  transfer_created:    { icon: Users,       bg: '#dbeafe', color: '#2563eb' },
  transfer_assigned:   { icon: ArrowRight,  bg: '#f3e8ff', color: '#7c3aed' },
  transfer_rejected:   { icon: X,           bg: '#fee2e2', color: '#b91c1c' },
  callback_due:        { icon: Phone,       bg: '#fef3c7', color: '#d97706' },
  number_claimable:    { icon: Phone,       bg: '#dbeafe', color: '#2563eb' },
  compliance_updated:  { icon: ShieldCheck, bg: '#f3e8ff', color: '#7c3aed' },
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const NotificationBell = ({
  notifications = [],
  unreadCount = 0,
  onMarkRead,
  onMarkAllRead,
  onDelete,
  onClearAll,
  // Push notification props
  pushSubscribed   = null,  // null = loading/unknown, false = not subscribed, true = active
  pushPermission   = 'default',
  pushLoading      = false,
  pushError        = '',
  onEnablePush     = null,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpen = () => setOpen(o => !o);

  // Push status derived state
  const pushDenied      = pushPermission === 'denied';
  const pushNotSetup    = pushSubscribed === false && !pushDenied;
  const showPushWarning = pushDenied || pushNotSetup;

  return (
    <div ref={ref} className="relative">
      {/* Bell button */}
      <button
        onClick={handleOpen}
        className="relative p-2 rounded-xl transition-all duration-200 hover:scale-110"
        style={{
          backgroundColor: open ? 'var(--color-primary-100)' : 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-sm)',
        }}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell size={20} style={{ color: unreadCount > 0 ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }} />

        {/* Unread count badge */}
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-5 h-5 flex items-center justify-center text-white text-xs font-bold rounded-full px-1 animate-pulse"
            style={{ backgroundColor: '#ef4444', fontSize: '11px', lineHeight: 1 }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}

        {/* Push warning dot (only when no unread badge) */}
        {unreadCount === 0 && showPushWarning && (
          <span
            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center"
            style={{ backgroundColor: pushDenied ? '#ef4444' : '#f59e0b' }}
            title={pushDenied ? 'Notifications blocked' : 'OS notifications off'}
          />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute right-0 top-12 w-96 rounded-2xl z-50 animate-scale-in"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-xl)',
            maxHeight: '520px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 rounded-t-2xl flex-shrink-0"
            style={{ borderBottom: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center gap-2">
              <Bell size={16} style={{ color: 'var(--color-primary-600)' }} />
              <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
                Notifications
              </span>
              {unreadCount > 0 && (
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: '#ef4444' }}
                >
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={onMarkAllRead}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors hover:bg-green-50"
                  style={{ color: '#16a34a' }}
                  title="Mark all read"
                >
                  <Check size={12} /> All read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={onClearAll}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors"
                  style={{ color: 'var(--color-text-tertiary)' }}
                  title="Clear all"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Push status banner — only shown when there's an issue */}
          {pushDenied && (
            <div
              className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0"
              style={{ backgroundColor: '#fef2f2', borderBottom: '1px solid var(--color-border)' }}
            >
              <AlertTriangle size={14} style={{ color: '#b91c1c', flexShrink: 0 }} />
              <span className="text-xs" style={{ color: '#b91c1c' }}>
                OS notifications blocked — unblock in browser settings
              </span>
            </div>
          )}

          {pushNotSetup && onEnablePush && (
            <div
              className="flex items-center justify-between gap-2 px-4 py-2.5 flex-shrink-0"
              style={{ backgroundColor: '#fffbeb', borderBottom: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <BellOff size={13} style={{ color: '#b45309', flexShrink: 0 }} />
                <span className="text-xs truncate" style={{ color: '#92400e' }}>
                  OS notifications are off
                </span>
              </div>
              <button
                onClick={() => { onEnablePush(); setOpen(false); }}
                disabled={pushLoading}
                className="text-xs px-2.5 py-1 rounded-lg font-semibold text-white flex-shrink-0 disabled:opacity-50"
                style={{ background: 'var(--gradient-sidebar)' }}
              >
                {pushLoading ? 'Enabling…' : 'Enable'}
              </button>
            </div>
          )}

          {pushError && (
            <div
              className="px-4 py-2 flex-shrink-0"
              style={{ backgroundColor: '#fef2f2', borderBottom: '1px solid var(--color-border)' }}
            >
              <p className="text-xs" style={{ color: '#b91c1c' }}>{pushError}</p>
            </div>
          )}

          {/* List */}
          <div className="overflow-y-auto flex-1" style={{ minHeight: 0 }}>
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Bell size={32} style={{ color: 'var(--color-text-tertiary)', opacity: 0.4 }} />
                <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                  No notifications yet
                </p>
              </div>
            ) : (
              notifications.map(n => {
                const typeInfo = TYPE_ICON[n.type] || { icon: Bell, bg: '#f1f5f9', color: '#64748b' };
                const Icon = typeInfo.icon;
                return (
                  <div
                    key={n.id}
                    className="flex items-start gap-3 px-4 py-3 transition-colors cursor-pointer group"
                    style={{
                      backgroundColor: n.is_read ? 'transparent' : 'var(--color-primary-50, #f5f3ff)',
                      borderBottom: '1px solid var(--color-border)',
                    }}
                    onClick={() => !n.is_read && onMarkRead(n.id)}
                  >
                    {/* Icon */}
                    <div
                      className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5"
                      style={{ backgroundColor: typeInfo.bg }}
                    >
                      <Icon size={14} style={{ color: typeInfo.color }} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold truncate"
                        style={{ color: 'var(--color-text)' }}
                      >
                        {n.title}
                      </p>
                      {n.message && (
                        <SmartText
                          text={n.message}
                          maxLines={2}
                          className="text-xs mt-0.5"
                          style={{ color: 'var(--color-text-secondary)' }}
                        />
                      )}
                      <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                        {timeAgo(n.created_at)}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!n.is_read && (
                        <button
                          onClick={e => { e.stopPropagation(); onMarkRead(n.id); }}
                          className="p-1 rounded-lg hover:bg-green-100 transition-colors"
                          title="Mark read"
                        >
                          <Check size={12} style={{ color: '#16a34a' }} />
                        </button>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); onDelete(n.id); }}
                        className="p-1 rounded-lg hover:bg-red-100 transition-colors"
                        title="Delete"
                      >
                        <X size={12} style={{ color: '#ef4444' }} />
                      </button>
                    </div>

                    {/* Unread dot */}
                    {!n.is_read && (
                      <div
                        className="flex-shrink-0 w-2 h-2 rounded-full mt-2"
                        style={{ backgroundColor: 'var(--color-primary-500)' }}
                      />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
