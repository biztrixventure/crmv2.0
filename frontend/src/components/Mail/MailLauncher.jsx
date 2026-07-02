import { useState, useEffect, useRef, useCallback } from 'react';
import { Mail } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import { supabase } from '../../api/supabase';
import client from '../../api/client';
import MailPanel from './MailPanel';

// Header mail trigger + unread badge — mirrors ChatLauncher so the control
// cluster reads as one set. LIVE delivery: one realtime channel on the
// notifications table (already in the supabase_realtime publication — the
// email tables deliberately are NOT, see mig 105/164). An INSERT with
// type='email_received' bumps the badge instantly and ticks the open panel to
// refetch. A slow jittered poll (60–75s) is only the dropped-socket safety net.
const MailLauncher = () => {
  const { user, isReadOnly } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [liveTick, setLiveTick] = useState(0);   // panel refetches when this changes
  const pollRef = useRef(null);
  const channelRef = useRef(null);

  const enabled = !!user?.id && !isReadOnly && isEnabled('internal_email');

  const refresh = useCallback(() => {
    client.get('emails/unread-count')
      .then(r => setUnread(r.data.unread || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const schedule = () => {
      clearTimeout(pollRef.current);
      pollRef.current = setTimeout(() => { refresh(); schedule(); }, 60000 + Math.random() * 15000);
    };
    schedule();

    // Realtime: piggyback the notifications INSERT stream (auth already set by
    // useNotifications, which mounts in the same headers).
    const ch = supabase
      .channel(`emails-live-${user.id}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.new?.type !== 'email_received') return;
          setUnread(prev => prev + 1);
          setLiveTick(t => t + 1);
        })
      .subscribe();
    channelRef.current = ch;
    return () => {
      clearTimeout(pollRef.current);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    };
  }, [enabled, user?.id, refresh]);

  if (!enabled) return null;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl transition-all duration-200 hover:scale-110"
        style={{
          backgroundColor: open ? 'var(--color-primary-100)' : 'var(--color-surface)',
          border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)',
        }}
        aria-label={`Mail${unread > 0 ? ` (${unread} unread)` : ''}`}
        title="Mail"
      >
        <Mail size={20} style={{ color: unread > 0 ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 flex items-center justify-center text-white text-xs font-bold rounded-full px-1"
            style={{ backgroundColor: '#ef4444', fontSize: 11, lineHeight: 1 }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && <MailPanel onClose={() => { setOpen(false); refresh(); }} meId={user.id} liveTick={liveTick} onUnreadChange={refresh} />}
    </>
  );
};

export default MailLauncher;
