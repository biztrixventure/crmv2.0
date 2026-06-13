/**
 * ActivityPanel — SuperAdmin slide-out user-activity monitor.
 *
 * An arrow tab sits on the right edge of the admin screen (opposite the
 * sidebar); clicking it slides out a panel of live user activity:
 *   - Online / Idle / Offline per user — realtime from the global presence
 *     channel (no refresh, no polling for the live state).
 *   - Last seen, today's first login / active minutes / login count, current
 *     page, sessions (tabs/devices), device, IP, engagement score.
 *   - Business summary: online now, DAU / WAU / MAU, avg session length.
 *   - Search + filters (status / role / company) built for big rosters.
 *
 * Server aggregates refresh every 60s; the presence layer updates instantly.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronLeft, ChevronRight, X, Search, Users, Activity, Clock, RefreshCw,
  Monitor, MapPin, Zap, TrendingUp, TrendingDown,
} from 'lucide-react';
import client from '../../api/client';
import { usePresenceContext } from '../../contexts/PresenceContext';
import { formatLastSeen } from '../../utils/lastSeen';

const fmtMin = (m) => {
  const v = Math.round(m || 0);
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${v % 60}m`;
};
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';

const STATUS_META = {
  online:  { label: 'Online',  dot: '#22c55e', bg: '#dcfce7', fg: '#166534' },
  idle:    { label: 'Idle',    dot: '#f59e0b', bg: '#fef3c7', fg: '#b45309' },
  offline: { label: 'Offline', dot: '#9ca3af', bg: 'var(--color-bg-secondary)', fg: 'var(--color-text-secondary)' },
};

const FILTERS = [
  { k: 'all',     label: 'All' },
  { k: 'online',  label: 'Online' },
  { k: 'idle',    label: 'Idle' },
  { k: 'offline', label: 'Offline' },
  { k: 'today',   label: 'Active today' },
  { k: 'never',   label: 'Never logged in' },
];

const Chip = ({ icon: Icon, label, value, accent }) => (
  <div className="rounded-xl px-2.5 py-2 flex items-center gap-2 min-w-0"
    style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
    <Icon size={14} style={{ color: accent || 'var(--color-primary-600)', flexShrink: 0 }} />
    <div className="min-w-0">
      <p className="text-sm font-bold leading-none" style={{ color: 'var(--color-text)' }}>{value}</p>
      <p className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{label}</p>
    </div>
  </div>
);

const StatusBadge = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.offline;
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: m.bg, color: m.fg }}>
      <span className="rounded-full" style={{ width: 6, height: 6, backgroundColor: m.dot }} />
      {m.label}
    </span>
  );
};

const UserRow = ({ u, status, sessions, livePage }) => {
  const [open, setOpen] = useState(false);
  const page = status !== 'offline' ? (livePage || u.last_page) : u.last_page;
  return (
    <div className="border-b" style={{ borderColor: 'var(--color-border)' }}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 text-left hover:bg-bg-secondary transition-colors">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{u.name}</p>
              <StatusBadge status={status} />
              {sessions > 1 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: 'var(--color-primary-100)', color: 'var(--color-primary-700)' }}
                  title={`${sessions} active sessions (tabs/devices)`}>
                  ×{sessions}
                </span>
              )}
            </div>
            <p className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
              {[u.role?.replace(/_/g, ' '), u.company].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-[11px] font-semibold" style={{ color: status === 'online' ? '#16a34a' : 'var(--color-text-secondary)' }}>
              {status === 'online' ? 'Active now'
                : status === 'idle' ? 'Idle'
                : u.never_seen ? 'Never logged in'
                : formatLastSeen(u.last_seen_at, { prefix: '' })?.trim() || '—'}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              today {fmtMin(u.today.active_minutes)}
            </p>
          </div>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          <p><span className="font-semibold">Logged in today:</span> {u.today.logged_in ? `yes · ${u.today.login_count}×` : 'no'}</p>
          <p><span className="font-semibold">First login:</span> {fmtTime(u.today.first_seen_at)}</p>
          <p><span className="font-semibold">Last activity:</span> {fmtTime(u.today.last_seen_at)}</p>
          <p><span className="font-semibold">Active today:</span> {fmtMin(u.today.active_minutes)}</p>
          <p><span className="font-semibold">Avg session:</span> {u.today.login_count ? fmtMin(u.today.active_minutes / u.today.login_count) : '—'}</p>
          <p><span className="font-semibold">7-day total:</span> {fmtMin(u.week_minutes)}</p>
          <p><span className="font-semibold">Active days (30d):</span> {u.month_active_days}</p>
          <p className="flex items-center gap-1"><Zap size={10} /> <span className="font-semibold">Engagement:</span> {u.engagement}/100</p>
          <p className="col-span-2 truncate"><span className="font-semibold">{status !== 'offline' ? 'Current page' : 'Last page'}:</span> <code className="text-[10px]">{page || '—'}</code></p>
          {u.today.top_module && <p><span className="font-semibold">Top module:</span> {u.today.top_module}</p>}
          <p className="flex items-center gap-1 truncate"><Monitor size={10} /> {u.device || '—'}</p>
          {u.ip && <p className="flex items-center gap-1 col-span-2"><MapPin size={10} /> {u.ip}</p>}
        </div>
      )}
    </div>
  );
};

const ActivityPanel = () => {
  const [open, setOpen]       = useState(false);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ]             = useState('');
  const [filter, setFilter]   = useState('all');
  const [roleF, setRoleF]     = useState('');
  const [coF, setCoF]         = useState('');
  const { onlineIds, idleIds, sessions, pages } = usePresenceContext();

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await client.get('presence/admin/activity'); setData(r.data); }
    catch { /* non-critical */ } finally { setLoading(false); }
  }, []);

  // Fetch on open + refresh aggregates every 60s while open. Live status needs
  // no polling — it rides the realtime presence channel.
  useEffect(() => {
    if (!open) return;
    load();
    // 30s poll — cheap, the server caches the heavy computation for 15s so
    // multiple admins / polls share it. Live status is realtime regardless.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [open, load]);

  const statusOf = (u) =>
    onlineIds.has(u.user_id) ? (idleIds.has(u.user_id) ? 'idle' : 'online') : 'offline';

  const users = data?.users || [];
  const roles     = useMemo(() => [...new Set(users.map(u => u.role).filter(Boolean))].sort(), [users]);
  const companies = useMemo(() => [...new Set(users.map(u => u.company).filter(Boolean))].sort(), [users]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users
      .filter(u => {
        const st = statusOf(u);
        if (filter === 'online'  && st !== 'online')  return false;
        if (filter === 'idle'    && st !== 'idle')    return false;
        if (filter === 'offline' && st !== 'offline') return false;
        if (filter === 'today'   && !u.today.logged_in) return false;
        if (filter === 'never'   && !u.never_seen)    return false;
        if (roleF && u.role !== roleF)       return false;
        if (coF   && u.company !== coF)      return false;
        if (needle && !`${u.name} ${u.role || ''} ${u.company || ''}`.toLowerCase().includes(needle)) return false;
        return true;
      })
      // Online first, then idle, then by most recently seen.
      .sort((a, b) => {
        const rank = { online: 0, idle: 1, offline: 2 };
        const d = rank[statusOf(a)] - rank[statusOf(b)];
        if (d) return d;
        return new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0);
      });
  }, [users, q, filter, roleF, coF, onlineIds, idleIds]); // eslint-disable-line

  // Most / least active today (among users who logged in).
  const ranked = useMemo(() => {
    const active = users.filter(u => u.today.logged_in).sort((a, b) => b.today.active_minutes - a.today.active_minutes);
    return { most: active[0] || null, least: active.length > 1 ? active[active.length - 1] : null };
  }, [users]);

  const onlineCount = users.filter(u => onlineIds.has(u.user_id)).length;

  return (
    <>
      {/* Edge arrow tab — opposite side from the sidebar. */}
      {!open && (
        <button onClick={() => setOpen(true)} title="User activity monitor"
          className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1 py-3 px-1 rounded-l-xl shadow-md transition-all hover:px-2"
          style={{ background: 'var(--gradient-sidebar)', color: 'white' }}>
          <ChevronLeft size={16} />
          <Activity size={14} />
          {onlineCount > 0 && (
            <span className="text-[9px] font-bold px-1 rounded-full" style={{ backgroundColor: '#22c55e' }}>{onlineCount}</span>
          )}
        </button>
      )}

      {/* Slide-out panel */}
      <aside
        className="fixed top-0 right-0 h-full z-50 flex flex-col transition-transform duration-300 shadow-2xl"
        style={{
          width: 'min(440px, 100vw)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          backgroundColor: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
        }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 flex-shrink-0" style={{ background: 'var(--gradient-sidebar)' }}>
          <span className="flex items-center gap-2 font-bold text-white text-sm">
            <Activity size={16} /> User Activity
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.25)' }}>
              {onlineCount} online
            </span>
          </span>
          <div className="flex items-center gap-1">
            <button onClick={load} disabled={loading} title="Refresh aggregates"
              className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30">
              <RefreshCw size={14} className={`text-white ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30">
              <ChevronRight size={16} className="text-white" />
            </button>
          </div>
        </div>

        {/* Business summary */}
        <div className="grid grid-cols-3 gap-1.5 p-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <Chip icon={Users}    label="Online now"  value={onlineCount} accent="#22c55e" />
          <Chip icon={Activity} label="Active today (DAU)" value={data?.summary?.dau ?? '—'} />
          <Chip icon={Clock}    label="Avg session" value={fmtMin(data?.summary?.avg_session_min)} />
          <Chip icon={TrendingUp} label="Weekly (WAU)"  value={data?.summary?.wau ?? '—'} />
          <Chip icon={TrendingUp} label="Monthly (MAU)" value={data?.summary?.mau ?? '—'} />
          <Chip icon={Users}    label="Total users" value={data?.summary?.total_users ?? '—'} accent="var(--color-text-tertiary)" />
        </div>

        {/* Most / least active */}
        {(ranked.most || ranked.least) && (
          <div className="px-3 py-2 flex items-center gap-2 flex-wrap text-[11px] flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
            {ranked.most && (
              <span className="inline-flex items-center gap-1">
                <TrendingUp size={11} style={{ color: '#16a34a' }} />
                Most active: <strong>{ranked.most.name}</strong> ({fmtMin(ranked.most.today.active_minutes)})
              </span>
            )}
            {ranked.least && (
              <span className="inline-flex items-center gap-1">
                <TrendingDown size={11} style={{ color: '#d97706' }} />
                Least: <strong>{ranked.least.name}</strong> ({fmtMin(ranked.least.today.active_minutes)})
              </span>
            )}
          </div>
        )}

        {/* Search + filters */}
        <div className="p-3 space-y-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, role, company…"
              className="input text-sm py-1.5 w-full" style={{ paddingLeft: 30 }} />
          </div>
          <div className="flex gap-1 flex-wrap">
            {FILTERS.map(f => (
              <button key={f.k} onClick={() => setFilter(f.k)}
                className="text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors"
                style={{
                  background: filter === f.k ? 'var(--gradient-sidebar)' : 'var(--color-bg-secondary)',
                  color: filter === f.k ? 'white' : 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}>{f.label}</button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <select value={roleF} onChange={e => setRoleF(e.target.value)} className="input text-xs py-1 flex-1">
              <option value="">All roles</option>
              {roles.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={coF} onChange={e => setCoF(e.target.value)} className="input text-xs py-1 flex-1">
              <option value="">All companies</option>
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto">
          {!data && loading ? (
            <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-primary-600" /></div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-center py-10" style={{ color: 'var(--color-text-tertiary)' }}>No users match.</p>
          ) : (
            shown.map(u => (
              <UserRow key={u.user_id} u={u} status={statusOf(u)}
                sessions={sessions[u.user_id] || 0} livePage={pages[u.user_id]} />
            ))
          )}
        </div>

        <p className="px-3 py-1.5 text-[10px] flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
          Live status is realtime · aggregates refresh every 60s
          {data?.generated_at ? ` · updated ${new Date(data.generated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
        </p>
      </aside>

      {/* Click-away backdrop (transparent — panel overlays without dimming work) */}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </>
  );
};

export default ActivityPanel;
