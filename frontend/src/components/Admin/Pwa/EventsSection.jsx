import { useState, useMemo } from 'react';
import {
  BellRing, BellOff, Bell, Users, RotateCcw, Zap,
  Pin, Info, AlertTriangle,
} from 'lucide-react';
import { Panel, SectionHeader, PillTabs, Toggle, CheckRow, Field } from '../../UI/kit';
import ThemedSelect from '../../UI/Select';
import Button from '../../UI/Button';
import Badge from '../../UI/Badge';

// ============================================================================
// Push events — the event × role matrix.
//
// READ THIS BEFORE CHANGING A DEFAULT. Push already fires for every event
// today: notifyUsers() calls sendPushToUsers() unconditionally. So "in-app +
// push, default recipients" across all 17 is a faithful description of current
// behaviour, not an aspiration. The value of this screen is turning things DOWN
// and re-targeting them — which is why the copy says so out loud, instead of
// letting someone assume they are switching features on.
//
// Two axes per event:
//   mode   off → nothing at all · in-app → the bell only · push → bell + device
//   roles  null → whoever this event already notifies (the existing routing,
//          untouched) · an explicit list → an override the admin chose.
//
// `roles: null` is NOT "nobody". Rendering it as an unchecked grid would read as
// exactly that, so it gets its own state with its own words.
// ============================================================================

const MODES = [
  { key: 'off',   label: 'Off',    icon: BellOff },
  { key: 'inapp', label: 'In-app', icon: Bell },
  { key: 'push',  label: 'Push',   icon: BellRing },
];

const modeOf = (ev) => (ev?.push ? 'push' : ev?.inapp ? 'inapp' : 'off');
const fromMode = (m) => (
  m === 'push'    ? { inapp: true,  push: true }
  : m === 'inapp' ? { inapp: true,  push: false }
                  : { inapp: false, push: false }
);

const URGENCY = [
  { v: 'very-low', label: 'Very low — deliver whenever convenient' },
  { v: 'low',      label: 'Low — may wait for the device to wake' },
  { v: 'normal',   label: 'Normal' },
  { v: 'high',     label: 'High — wake the device now' },
];

// Half-hour options: enough resolution for a quiet window, and it keeps this a
// ThemedSelect rather than a native time input.
const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  return `${h}:${i % 2 ? '30' : '00'}`;
});

const inputStyle = { background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };
const INPUT = 'w-full min-w-0 px-3 py-2 text-sm rounded-lg';

const prettyRole = (r) => r.replace(/_/g, ' ');

function EventRow({ event, value, roles, onChange }) {
  const [open, setOpen] = useState(false);
  const mode = modeOf(value);
  const custom = Array.isArray(value?.roles);
  const chosen = custom ? value.roles : [];

  const toggleRole = (role, on) => {
    const next = on ? [...new Set([...chosen, role])] : chosen.filter(r => r !== role);
    onChange({ ...value, roles: next });
  };

  return (
    <Panel tone="inset" radius="xl" pad="sm">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1" style={{ minWidth: 170 }}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{event.label}</span>
            {event.legacyKey && <Badge variant="info" size="sm">Also in Business Rules</Badge>}
          </div>
          <p className="text-[11px] m-0 mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{event.detail}</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <PillTabs items={MODES} value={mode} onChange={m => onChange({ ...value, ...fromMode(m) })} />
          {/* Targeting is meaningless for an event nobody is told about, so the
              control disappears rather than sitting there disabled. */}
          {mode !== 'off' && (
            <Button variant="ghost" size="xs" onClick={() => setOpen(o => !o)}>
              <Users size={12} />
              {custom ? `${chosen.length} role${chosen.length === 1 ? '' : 's'}` : 'Default recipients'}
            </Button>
          )}
        </div>
      </div>

      {open && mode !== 'off' && (
        <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
            <span className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none"
              style={{ color: 'var(--color-text-secondary)' }}>
              Who is notified
            </span>
            {custom && (
              <Button variant="ghost" size="xs" onClick={() => onChange({ ...value, roles: null })}>
                <RotateCcw size={12} /> Use default recipients
              </Button>
            )}
          </div>

          {!custom ? (
            <div className="flex items-start gap-2.5">
              <Info size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-info-600)' }} />
              <div className="min-w-0">
                <p className="text-[11px] m-0" style={{ color: 'var(--color-text-secondary)' }}>
                  Whoever this event already notifies — the assigned closer, the submitting fronter, the compliance
                  queue, and so on, exactly as today. Pick roles only to override that.
                </p>
                <div className="mt-2">
                  <Button variant="secondary" size="xs" onClick={() => onChange({ ...value, roles: [] })}>
                    Choose roles instead
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4">
                {roles.map(r => (
                  <CheckRow key={r} checked={chosen.includes(r)} label={prettyRole(r)}
                    onChange={on => toggleRole(r, on)} />
                ))}
              </div>
              {chosen.length === 0 && (
                <p className="text-[11px] m-0 mt-2" style={{ color: 'var(--color-warning-600)' }}>
                  No role selected — an explicit override with an empty list means nobody is notified about this event.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

export default function EventsSection({
  catalog, roles, events, push, vapidConfigured,
  onEventChange, onEventsReplace, onPushChange,
}) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const e of catalog) {
      if (!m.has(e.group)) m.set(e.group, []);
      m.get(e.group).push(e);
    }
    return [...m.entries()];
  }, [catalog]);

  const tally = useMemo(() => {
    let off = 0, inapp = 0, pushed = 0, targeted = 0;
    for (const e of catalog) {
      const v = events[e.id] || {};
      const m = modeOf(v);
      if (m === 'off') off++; else if (m === 'inapp') inapp++; else pushed++;
      if (Array.isArray(v.roles)) targeted++;
    }
    return { off, inapp, pushed, targeted };
  }, [catalog, events]);

  const setMany = (list, m) => {
    const next = { ...events };
    for (const e of list) next[e.id] = { ...(next[e.id] || { roles: null }), ...fromMode(m) };
    onEventsReplace(next);
  };

  const qh = push.quiet_hours || {};

  return (
    <div className="space-y-5">
      {!vapidConfigured && (
        <Panel pad="lg">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning-600)' }} />
            <div className="min-w-0">
              <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                VAPID keys are not configured on the server
              </div>
              <p className="text-[11px] m-0 mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                Instant device push cannot be delivered until <span className="font-mono">VAPID_PUBLIC_KEY</span> and{' '}
                <span className="font-mono">VAPID_PRIVATE_KEY</span> are set in the backend environment. Events set to
                “Push” still notify in-app.
              </p>
            </div>
          </div>
        </Panel>
      )}

      {/* The framing, stated once and up front. Without it this matrix reads as
          a list of features to enable, and the first thing someone does is turn
          "on" something that was never off. */}
      <Panel pad="lg">
        <SectionHeader icon={Info} title="What this matrix does"
          subtitle="Every event below already notifies and already pushes. This is where you turn that down." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            ['Instant push',  tally.pushed,   'var(--color-success-600)', BellRing],
            ['In-app only',   tally.inapp,    'var(--color-info-600)',    Bell],
            ['Off',           tally.off,      'var(--color-text-tertiary)', BellOff],
            ['Re-targeted',   tally.targeted, 'var(--color-warning-600)', Users],
          ].map(([label, n, color, Icon]) => (
            <div key={label} className="rounded-xl px-3 py-2.5 flex items-center gap-2.5 min-w-0"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <Icon size={15} className="flex-shrink-0" style={{ color }} />
              <div className="min-w-0">
                <div className="text-lg font-bold leading-none" style={{ color: 'var(--color-text)' }}>{n}</div>
                <div className="text-[11px] sm:text-[10px] leading-none mt-1 truncate"
                  style={{ color: 'var(--color-text-secondary)' }}>{label}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-4">
          <span className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none"
            style={{ color: 'var(--color-text-secondary)' }}>Set every event to</span>
          {MODES.map(m => (
            <Button key={m.key} variant="secondary" size="xs" onClick={() => setMany(catalog, m.key)}>
              <m.icon size={12} /> {m.label}
            </Button>
          ))}
        </div>
      </Panel>

      {/* ── Delivery behaviour ────────────────────────────────────────────── */}
      <Panel pad="lg">
        <SectionHeader icon={Zap} title="How a push behaves" subtitle="Applies to every event set to Push." />
        <div className="grid lg:grid-cols-2 gap-5">
          <div className="space-y-4 min-w-0">
            <Toggle checked={!!push.vibrate} onChange={v => onPushChange('vibrate', v)}
              label="Vibrate" tone="primary"
              hint="Short buzz pattern on phones that support it." />
            <Toggle checked={!!push.require_interaction} onChange={v => onPushChange('require_interaction', v)}
              label="Stay on screen until dismissed" tone={push.require_interaction ? 'warn' : 'primary'}
              hint="Desktop only. The notification will not auto-hide — use it sparingly; a stack of sticky notifications is worse than a missed one." />
          </div>
          <div className="space-y-4 min-w-0">
            <Field label="Urgency" hint="How hard the push service tries to wake a sleeping device.">
              <ThemedSelect value={push.urgency || 'high'} onChange={e => onPushChange('urgency', e.target.value)}
                className={INPUT} style={inputStyle}>
                {URGENCY.map(u => <option key={u.v} value={u.v}>{u.label}</option>)}
              </ThemedSelect>
            </Field>
            <Field label="Time to live (seconds)"
              hint="How long the push service holds an undelivered message for an offline device. 86400 = one day.">
              <input type="number" min={0} max={2419200} value={push.ttl ?? 86400}
                onChange={e => onPushChange('ttl', Number(e.target.value))}
                className={`${INPUT} font-mono`} style={inputStyle} />
            </Field>
          </div>
        </div>

        <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--color-border)' }}>
          <Toggle checked={!!qh.enabled}
            onChange={v => onPushChange('quiet_hours', { ...qh, enabled: v })}
            label="Quiet hours" tone="primary"
            hint="Suppress device pushes inside this window. In-app notifications still arrive, so nothing is lost — it just does not buzz." />
          {qh.enabled && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 max-w-lg">
                <Field label="From">
                  <ThemedSelect value={qh.start || '22:00'}
                    onChange={e => onPushChange('quiet_hours', { ...qh, start: e.target.value })}
                    className={INPUT} style={inputStyle}>
                    {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                  </ThemedSelect>
                </Field>
                <Field label="Until">
                  <ThemedSelect value={qh.end || '07:00'}
                    onChange={e => onPushChange('quiet_hours', { ...qh, end: e.target.value })}
                    className={INPUT} style={inputStyle}>
                    {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
                  </ThemedSelect>
                </Field>
              </div>
              <p className="text-[11px] m-0 mt-2" style={{ color: 'var(--color-text-tertiary)' }}>
                Server time. A window that crosses midnight (22:00 → 07:00) is read as overnight, not as an empty range.
              </p>
            </>
          )}
        </div>
      </Panel>

      {/* ── The matrix ────────────────────────────────────────────────────── */}
      {groups.map(([group, list]) => (
        <Panel key={group} pad="lg">
          <SectionHeader
            icon={BellRing}
            title={group}
            subtitle={`${list.length} event${list.length === 1 ? '' : 's'}`}
            actions={
              <div className="flex items-center gap-1.5 flex-wrap">
                {MODES.map(m => (
                  <Button key={m.key} variant="ghost" size="xs" onClick={() => setMany(list, m.key)}>
                    {m.label}
                  </Button>
                ))}
              </div>
            }
          />
          <div className="space-y-2">
            {list.map(e => (
              <EventRow key={e.id} event={e} roles={roles}
                value={events[e.id] || { inapp: true, push: true, roles: null }}
                onChange={next => onEventChange(e.id, next)} />
            ))}
          </div>
        </Panel>
      ))}

      <Panel tone="inset" radius="xl" pad="sm">
        <div className="flex items-start gap-2.5">
          <Pin size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-tertiary)' }} />
          <p className="text-[11px] m-0" style={{ color: 'var(--color-text-tertiary)' }}>
            Events tagged <span className="font-semibold">Also in Business Rules</span> already had a switch there.
            Saving here writes both, so the two panels can never disagree about one setting.
          </p>
        </div>
      </Panel>
    </div>
  );
}
