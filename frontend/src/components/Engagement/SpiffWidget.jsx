import { useEffect, useState } from 'react';
import { Trophy, Medal, Clock } from 'lucide-react';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import RichView from '../UI/RichView';

const MEDAL = ['#f59e0b', '#94a3b8', '#b45309'];

// Live countdown to ends_at. Returns null once expired (so the card drops off).
// Granularity tightens as it nears zero: d/h/m → h/m/s → m/s.
const fmtCountdown = (ends, now) => {
  if (!ends) return null;
  let ms = new Date(ends).getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000); ms -= d * 86400000;
  const h = Math.floor(ms / 3600000);  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);    ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
};

// User-facing SPIFF card: the viewer's active campaigns with their progress,
// reward, a live countdown, and a top-5 leaderboard. A campaign disappears the
// instant its countdown hits zero (local filter) and the next poll confirms it
// server-side; ended campaigns stay in the admin Spiff manager for reporting.
const SpiffWidget = () => {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const load = () => client.get('spiff').then(r => { if (alive) setCampaigns(r.data.campaigns || []); }).catch(() => {});
    load();
    // Slow poll instead of Realtime on spiff_entries/spiff_campaigns. Progress
    // derives from sales, so a poll keeps it fresh without a per-client channel.
    const t = setInterval(load, 90 * 1000);
    return () => { alive = false; clearInterval(t); };
  }, [user?.id]);

  // 1s tick drives the countdown + instant local expiry — but only while there's
  // a spiff to show (no idle timer when the widget is empty). Re-renders only
  // this tiny widget's text; no network, no DB.
  useEffect(() => {
    if (!campaigns.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [campaigns.length]);

  // Drop any campaign whose clock has run out, without waiting for the poll.
  const live = campaigns.filter(c => !c.ends_at || new Date(c.ends_at).getTime() > now);
  if (!live.length) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      {live.map(c => {
        const target = Number(c.target_value) || 1;
        const pct = Math.min(100, Math.round((Number(c.my_value) / target) * 100));
        const left = fmtCountdown(c.ends_at, now);
        return (
          <div key={c.id} className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: 'var(--gradient-sidebar)' }}>
              <div className="flex items-center gap-2 min-w-0">
                <Trophy size={18} className="text-white flex-shrink-0" />
                <p className="font-bold text-white truncate">{c.title}</p>
              </div>
              {left && <span className="flex items-center gap-1 text-xs font-semibold text-white/90 flex-shrink-0 tabular-nums"><Clock size={12} /> {left} left</span>}
            </div>
            <div className="p-4 space-y-3">
              {(c.reward_description || c.reward_amount) && (
                <p className="text-sm font-semibold" style={{ color: 'var(--color-success-600)' }}>
                  🎁 {c.reward_description || `$${c.reward_amount}`}
                </p>
              )}
              {c.description && <RichView html={c.description} className="text-xs" style={{ color: 'var(--color-text-secondary)' }} />}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span style={{ color: 'var(--color-text-secondary)' }}>Your progress</span>
                  <span className="font-bold" style={{ color: 'var(--color-text)' }}>{c.my_value} / {target}</span>
                </div>
                <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: 'var(--gradient-sidebar)' }} />
                </div>
              </div>
              {c.leaderboard?.length > 0 && (
                <div className="space-y-1 pt-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>Leaderboard</p>
                  {c.leaderboard.slice(0, 5).map(e => (
                    <div key={e.user_id || e.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                        {e.rank <= 3 ? <Medal size={13} style={{ color: MEDAL[e.rank - 1] }} /> : <span className="w-3.5 text-center text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{e.rank}</span>}
                        <span className={e.user_id === user?.id ? 'font-bold' : ''}>{e.name}{e.user_id === user?.id ? ' (you)' : ''}</span>
                      </span>
                      <span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{e.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SpiffWidget;
