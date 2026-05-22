import { useEffect, useState } from 'react';
import { Megaphone, AlertTriangle, X } from 'lucide-react';
import client from '../../api/client';
import { supabase } from '../../api/supabase';
import { useAuth } from '../../contexts/AuthContext';

// Prominent banner stack for unread announcements visible to the user.
// urgent = red, high = amber, normal = blue. Dismissing marks it read.
const STYLE = {
  urgent: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c', icon: AlertTriangle },
  high:   { bg: '#fffbeb', border: '#fde68a', text: '#b45309', icon: Megaphone },
  normal: { bg: 'var(--color-primary-50)', border: 'var(--color-primary-200)', text: 'var(--color-primary-700)', icon: Megaphone },
};
const ORDER = { urgent: 0, high: 1, normal: 2 };

const AnnouncementBanner = () => {
  const { user } = useAuth();
  const [list, setList] = useState([]);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const load = () => client.get('announcements').then(r => { if (alive) setList(r.data.announcements || []); }).catch(() => {});
    load();
    const ch = supabase
      .channel('announcement-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, load)
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [user?.id]);

  const markRead = async (id) => {
    setList(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a));
    try { await client.post(`announcements/${id}/read`); } catch { /* ignore */ }
  };

  // Show unread, urgent/high first, cap at 3 to avoid clutter.
  const unread = list.filter(a => !a.is_read)
    .sort((a, b) => (ORDER[a.priority] ?? 2) - (ORDER[b.priority] ?? 2))
    .slice(0, 3);
  if (!unread.length) return null;

  return (
    <div className="space-y-px">
      {unread.map(a => {
        const s = STYLE[a.priority] || STYLE.normal;
        const Icon = s.icon;
        return (
          <div key={a.id} className="flex items-start gap-3 px-4 py-2.5" style={{ backgroundColor: s.bg, borderBottom: `1px solid ${s.border}` }}>
            <Icon size={16} className="mt-0.5 flex-shrink-0" style={{ color: s.text }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold" style={{ color: s.text }}>
                {a.priority === 'urgent' && '⚠️ '}{a.title}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{a.body}</p>
            </div>
            <button onClick={() => markRead(a.id)} title="Dismiss" className="flex-shrink-0 p-1 rounded hover:bg-black/5">
              <X size={14} style={{ color: s.text }} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default AnnouncementBanner;
