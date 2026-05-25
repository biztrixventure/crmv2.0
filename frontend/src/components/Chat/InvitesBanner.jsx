import { Users, Check, X, Loader2 } from 'lucide-react';

// Pending group invitations shown atop the conversation list. A user joins a
// group only by accepting here — there is no direct add.
const InvitesBanner = ({ invites = [], onAccept, onDecline, busyId }) => {
  if (!invites.length) return null;
  return (
    <div className="flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-primary-50, #f7f4ee)' }}>
      <p className="px-4 pt-2.5 pb-1 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--color-primary-700)' }}>
        Invitations
      </p>
      {invites.map(inv => {
        const busy = busyId === inv.id;
        return (
          <div key={inv.id} className="flex items-center gap-2.5 px-3 py-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
              <Users size={16} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate" style={{ color: 'var(--color-text)' }}>{inv.group_title}</p>
              <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>Invited by {inv.inviter_name}</p>
            </div>
            <button onClick={() => onAccept(inv)} disabled={busy} title="Accept"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white flex-shrink-0 disabled:opacity-50"
              style={{ background: 'var(--gradient-sidebar)' }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
            </button>
            <button onClick={() => onDecline(inv)} disabled={busy} title="Decline"
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default InvitesBanner;
