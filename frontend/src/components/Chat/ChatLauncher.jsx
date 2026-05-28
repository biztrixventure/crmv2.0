import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useFeatureFlags } from '../../contexts/FeatureFlagsContext';
import { useChatUnread } from '../../hooks/useChatUnread';
import ChatPanel from './ChatPanel';

// Header chat trigger + total-unread badge (mirrors NotificationBell styling).
// Self-contained: gated by the user being present and the 'chat' flag enabled,
// so a single placement in each header lights up chat for every shell.
const ChatLauncher = () => {
  const { user, isReadOnly } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const [open, setOpen] = useState(false);
  // readonly_admin can't send messages (backend readonlyGuard would 403 the
  // POST anyway), so hide the launcher entirely instead of showing a button
  // that opens a panel they can only stare at.
  const enabled = !!user?.id && !isReadOnly && isEnabled('chat');
  const { total, banned, refresh } = useChatUnread(enabled);

  if (!enabled) return null;

  const toggle = () => { const next = !open; setOpen(next); if (!next) refresh(); };

  return (
    <>
      <button
        onClick={toggle}
        className="relative p-2 rounded-xl transition-all duration-200 hover:scale-110"
        style={{
          backgroundColor: open ? 'var(--color-primary-100)' : 'var(--color-surface)',
          border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)',
        }}
        aria-label={`Chat${total > 0 ? ` (${total} unread)` : ''}`}
        title="Chat"
      >
        <MessageSquare size={20} style={{ color: total > 0 ? 'var(--color-primary-600)' : 'var(--color-text-secondary)' }} />
        {total > 0 && (
          <span className="absolute -top-1 -right-1 min-w-5 h-5 flex items-center justify-center text-white text-xs font-bold rounded-full px-1"
            style={{ backgroundColor: '#ef4444', fontSize: 11, lineHeight: 1 }}>
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      <ChatPanel open={open} onClose={() => { setOpen(false); refresh(); }} meId={user.id} banned={banned} />
    </>
  );
};

export default ChatLauncher;
