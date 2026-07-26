// ActivitySection — read-only per-user activity: presence/engagement summary
// (GET /presence/admin/activity), the activity log (GET /activity-logs?user_id),
// and the field-audit trail of records this user changed (GET /audit/by-actor).
//
// UI from components/UI/kit (docs/ui-design-system.md). The local Panel helper
// this file used to declare is now the kit's Panel; the wrapper that adds a
// sub-heading is `Block` so it doesn't shadow the import.
import { useState, useEffect, useCallback } from 'react';
import { Activity, Clock, Zap, LogIn, Pencil } from 'lucide-react';
import client from '../../../api/client';
import { Panel, SectionHeader, Loading, EmptyState } from '../../UI/kit';

const fmt = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export default function ActivitySection({ account }) {
  const userId = account.user_id;
  const [presence, setPresence] = useState(null);
  const [logs, setLogs]     = useState([]);
  const [audit, setAudit]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [presRes, logRes, audRes] = await Promise.allSettled([
      client.get('presence/admin/activity'),
      client.get('activity-logs', { params: { user_id: userId, limit: 50 } }),
      client.get(`audit/by-actor/${userId}`, { params: { limit: 50 } }),
    ]);
    if (presRes.status === 'fulfilled') setPresence((presRes.value.data.users || []).find(u => u.user_id === userId) || null);
    if (logRes.status === 'fulfilled') setLogs(logRes.value.data.logs || []);
    if (audRes.status === 'fulfilled') setAudit(audRes.value.data.events || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading variant="rows" rows={6} label="Loading activity…" />;

  return (
    <div className="space-y-5">
      <SectionHeader icon={Activity} title="Activity & audit" />

      {/* Presence summary */}
      {presence ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat icon={Clock} label="Last seen" value={fmt(presence.last_seen_at)} />
          <Stat icon={Zap} label="Active min today" value={presence.today?.active_minutes ?? 0} />
          <Stat icon={LogIn} label="Logins today" value={presence.today?.login_count ?? 0} />
          <Stat icon={Activity} label="Engagement" value={`${presence.engagement ?? 0}/100`} />
          <Stat label="Week minutes" value={presence.week_minutes ?? 0} />
          <Stat label="Active days (30d)" value={presence.month_active_days ?? 0} />
          <Stat label="Device" value={presence.device || '—'} />
          <Stat label="Last page" value={presence.last_page || '—'} />
        </div>
      ) : (
        <EmptyState icon={Activity} compact title="No presence data"
          hint="The activity monitor may be off, or this user has never been seen." />
      )}

      {/* Activity log */}
      <Block title={`Activity log (${logs.length})`}>
        {logs.length === 0 ? <Nothing /> : (
          <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {logs.map(l => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium text-text">{(l.action || 'action').replace(/_/g, ' ')}</span>
                <span className="text-[11px] text-text-secondary flex-shrink-0">{fmt(l.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {/* Field audit trail */}
      <Block title={`Record changes by this user (${audit.length})`} icon={Pencil}>
        {audit.length === 0 ? <Nothing /> : (
          <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {audit.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-text">{e.operation} · {e.table_name}</span>
                  <span className="text-[11px] text-text-secondary block truncate">
                    {e.record_id ? `#${String(e.record_id).slice(0, 8)}… ` : ''}
                    {e.changes && typeof e.changes === 'object' ? Object.keys(e.changes).slice(0, 6).join(', ') : ''}
                  </span>
                </span>
                <span className="text-[11px] text-text-secondary flex-shrink-0">{fmt(e.changed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}

// A compact label/value cell. Deliberately NOT KpiTile — these values are dates
// and strings ("Jul 26, 04:29 PM"), which a 2xl numeric tile would truncate.
function Stat({ icon: Icon, label, value }) {
  return (
    <Panel tone="inset" radius="xl" pad="sm">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-secondary mb-1">
        {Icon && <Icon size={12} />}{label}
      </div>
      <div className="text-sm font-semibold text-text truncate">{value}</div>
    </Panel>
  );
}

function Block({ title, icon, children }) {
  return (
    <Panel tone="inset" radius="xl">
      <SectionHeader level="sub" icon={icon} title={title} />
      {children}
    </Panel>
  );
}

function Nothing() { return <EmptyState compact title="Nothing recorded" />; }
