import { useEffect, useState } from 'react';
import { Target, Clock, Users, Gift } from 'lucide-react';
import client from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { SpiffCard } from './SpiffWidget';
import { accent } from '../UI/kit';

// ── "Your targets" — ONE strip for everything the viewer is measured on.
//
// Two instruments used to be two unrelated ideas: a SPIFF (a prize you can win)
// and a team quota (a number you owe). Shown apart they compete for the same
// glance and the quota — the one that is actually someone's job — loses,
// because the SPIFF is the one with the trophy on it. Merged, they read as one
// question: what am I being measured on right now?
//
// Same card geometry so they scan as a set; different tone so they never blur —
// SPIFF keeps its gradient header and trophy, a quota gets a flat primary
// header and a target. Both drop out locally the moment their window closes,
// before the next poll confirms it server-side.

const fmt = (n, unit) => (unit === 'money'
  ? `$${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  : (Number(n) || 0).toLocaleString());

// Whole days left in a date-bounded window (a quota ends at end-of-day local,
// unlike a SPIFF which ends at an instant).
const daysLeft = (endIso, now) => {
  if (!endIso) return null;
  const d = Math.ceil((Date.parse(`${endIso}T23:59:59`) - now) / 86400000);
  return d >= 0 ? d : null;
};

function QuotaCard({ q, now }) {
  const left = daysLeft(q.ends_at, now);
  const pct = Math.min(100, Math.max(0, q.pct || 0));
  const hit = (q.pct || 0) >= 100;
  const tone = accent(hit ? 'success' : 'primary');
  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' }}>
      <div className="px-4 py-3 flex items-center justify-between" style={{ background: tone.fg }}>
        <div className="flex items-center gap-2 min-w-0">
          <Target size={18} className="text-white flex-shrink-0" />
          <p className="font-bold text-white truncate m-0">{q.label || q.metric_label}</p>
        </div>
        {left != null && (
          <span className="flex items-center gap-1 text-xs font-semibold text-white/90 flex-shrink-0 tabular-nums">
            <Clock size={12} /> {left === 0 ? 'last day' : `${left}d left`}
          </span>
        )}
      </div>
      <div className="p-4 space-y-3">
        <p className="m-0 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {q.metric_label} · {q.starts_at} → {q.ends_at}
        </p>
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span style={{ color: 'var(--color-text-secondary)' }}>Your target</span>
            <span className="font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>
              {fmt(q.actual, q.metric_unit)} / {fmt(q.target_value, q.metric_unit)}
            </span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: tone.fg }} />
          </div>
          <p className="m-0 mt-1 text-[11px]" style={{ color: hit ? accent('success').fg : 'var(--color-text-secondary)' }}>
            {hit ? 'Target hit' : (q.remaining > 0 ? `${fmt(q.remaining, q.metric_unit)} to go` : '—')}
            {q.pct != null && <span className="opacity-70"> · {q.pct}%</span>}
          </p>
        </div>

        {/* The reward ladder. "40 more and you hit the $100" is a different and
            far more actionable sentence than "you are at 61%", so the NEXT rung
            leads and the earned ones sit behind it as a quiet tally. */}
        {(q.next_milestone || q.milestones_earned > 0) && (
          <div className="pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
            {q.next_milestone ? (
              <div className="pt-2">
                <div className="flex items-center justify-between text-[11px] gap-2">
                  <span className="inline-flex items-center gap-1 min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
                    <Gift size={11} className="flex-shrink-0" style={{ color: accent('warning').fg }} />
                    <span className="truncate">
                      {q.next_milestone.label || `${fmt(q.next_milestone.at, q.metric_unit)} milestone`}
                      {(q.next_milestone.reward_description || q.next_milestone.reward_amount != null) && (
                        <b style={{ color: accent('warning').fg }}>
                          {' · '}{q.next_milestone.reward_description || `$${q.next_milestone.reward_amount}`}
                        </b>
                      )}
                    </span>
                  </span>
                  <span className="font-bold tabular-nums flex-shrink-0" style={{ color: 'var(--color-text)' }}>
                    {fmt(q.next_milestone.remaining, q.metric_unit)} to go
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, q.next_milestone.pct || 0))}%`, background: accent('warning').fg }} />
                </div>
              </div>
            ) : (
              <p className="m-0 pt-2 text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: accent('success').fg }}>
                <Gift size={11} /> Every milestone earned
              </p>
            )}
            {q.milestones_earned > 0 && q.next_milestone && (
              <p className="m-0 mt-1 text-[11px]" style={{ color: accent('success').fg }}>
                {q.milestones_earned} milestone{q.milestones_earned === 1 ? '' : 's'} already earned
              </p>
            )}
          </div>
        )}

        {/* Why this number matters: the team's own progress on the quota this
            allocation was carved out of. Same role the SPIFF leaderboard plays —
            your bar, in context. */}
        {q.team_quota && (
          <div className="pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between text-[11px] pt-2">
              <span className="inline-flex items-center gap-1 min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
                <Users size={11} className="flex-shrink-0" />
                <span className="truncate">{q.team_name}</span>
              </span>
              <span className="font-semibold tabular-nums flex-shrink-0" style={{ color: 'var(--color-text)' }}>
                {fmt(q.team_quota.actual, q.metric_unit)} / {fmt(q.team_quota.target, q.metric_unit)}
                <span className="opacity-70"> · {q.team_quota.pct == null ? '—' : `${q.team_quota.pct}%`}</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TargetsStrip() {
  const { user } = useAuth();
  const [quotas, setQuotas] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!user?.id) return;
    let alive = true;
    const load = () => {
      // Independent so one failing endpoint can't blank the other card type.
      client.get('quotas/mine').then(r => { if (alive) setQuotas(r.data.quotas || []); }).catch(() => {});
      client.get('spiff').then(r => { if (alive) setCampaigns(r.data.campaigns || []); }).catch(() => {});
    };
    load();
    // Same slow poll the SPIFF widget used: quota progress derives from sales and
    // transfers, so polling keeps it fresh without a per-client realtime channel.
    // Hidden tabs are skipped and refreshed on return, so a backgrounded tab is free.
    const t = setInterval(() => { if (!document.hidden) load(); }, 90 * 1000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [user?.id]);

  // 1s tick drives the SPIFF countdown and the local expiry of both kinds — but
  // only while there is something to show, so an empty strip costs no timer.
  useEffect(() => {
    if (!campaigns.length && !quotas.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [campaigns.length, quotas.length]);

  const liveSpiffs = campaigns.filter(c => !c.ends_at || new Date(c.ends_at).getTime() > now);
  const liveQuotas = quotas.filter(q => daysLeft(q.ends_at, now) != null);

  if (!liveSpiffs.length && !liveQuotas.length) return null;

  return (
    <div className="mb-6">
      <p className="m-0 mb-2 text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>
        Your targets
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Quotas first: the obligation outranks the prize. */}
        {liveQuotas.map(q => <QuotaCard key={q.id} q={q} now={now} />)}
        {liveSpiffs.map(c => <SpiffCard key={c.id} c={c} now={now} userId={user?.id} />)}
      </div>
    </div>
  );
}
