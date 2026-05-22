import { useEffect, useState } from 'react';
import { Megaphone, AlertTriangle, X } from 'lucide-react';
import client from '../../api/client';
import { supabase } from '../../api/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { sanitizeHtml } from '../../utils/sanitizeHtml';

// Center-screen popup that shows announcements "due" for the viewer (never seen,
// or the re-show interval has elapsed since last dismiss). Cycles through
// multiple; dismissing marks it read (which also snoozes it for reshow_hours).
const ACCENT = {
  urgent: { bar: '#dc2626', chip: 'Urgent', icon: AlertTriangle },
  high:   { bar: '#d97706', chip: 'Important', icon: Megaphone },
  normal: { bar: 'var(--color-primary-600)', chip: 'Announcement', icon: Megaphone },
};

const AnnouncementPopup = () => {
  const { user } = useAuth();
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const load = () => client.get('announcements')
      .then(r => { if (alive) setQueue((r.data.announcements || []).filter(a => a.due)); })
      .catch(() => {});
    load();
    const ch = supabase
      .channel('announcement-popup')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, load)
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [user?.id]);

  const current = queue[0];
  if (!current) return null;

  const dismiss = async () => {
    setQueue(prev => prev.filter(a => a.id !== current.id));
    try { await client.post(`announcements/${current.id}/read`); } catch { /* ignore */ }
  };

  const a = ACCENT[current.priority] || ACCENT.normal;
  const Icon = a.icon;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden animate-scale-in" style={{ backgroundColor: 'var(--color-surface)', boxShadow: 'var(--shadow-xl)', borderTop: `4px solid ${a.bar}` }}>
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: a.bar }}>
              <Icon size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: a.bar }}>{a.chip}</span>
              <h3 className="text-lg font-bold leading-tight" style={{ color: 'var(--color-text)' }}>{current.title}</h3>
            </div>
          </div>
          <button onClick={dismiss} className="p-1.5 rounded-lg hover:bg-bg-secondary flex-shrink-0" style={{ color: 'var(--color-text-tertiary)' }}><X size={18} /></button>
        </div>

        <div className="px-6 pb-2 max-h-[55vh] overflow-y-auto">
          <div className="bsx-announcement text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(current.body) }} />
          <style>{`
            .bsx-announcement img { max-width: 100%; height: auto; border-radius: 8px; margin: 6px 0; }
            .bsx-announcement a { color: var(--color-primary-600); text-decoration: underline; }
            .bsx-announcement ul { list-style: disc; padding-left: 1.25rem; }
            .bsx-announcement ol { list-style: decimal; padding-left: 1.25rem; }
          `}</style>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 mt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {queue.length > 1 ? `${queue.length} announcements` : ''}
          </span>
          <button onClick={dismiss} className="px-5 py-2 rounded-xl font-bold text-sm text-white" style={{ background: 'var(--gradient-sidebar)' }}>
            {queue.length > 1 ? 'Next' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementPopup;
