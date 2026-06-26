import { Activity, AlertTriangle, Gauge } from 'lucide-react';

const cfg = (config, key, fallback) => (config?.[key] !== undefined ? config[key] : fallback);

/*
 * SystemRules — global performance switches (superadmin, global scope only).
 * Today: the Activity Monitor kill-switch. When OFF, the whole presence /
 * user-activity subsystem stops everywhere — clients don't open the realtime
 * channel or send heartbeats, the server writes nothing, and the slide-out
 * monitor disappears. Flip it back ON when you need it.
 */
const SystemRules = ({ config, scope, onSave }) => {
  const activityOn = cfg(config, 'activity_monitor.enabled', true);
  const isGlobal = scope === 'global';

  return (
    <div className="max-w-3xl pb-8">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-text mb-1 flex items-center gap-2" style={{ fontFamily: 'var(--font-display)' }}>
          <Gauge size={20} className="text-primary-600" /> System &amp; Performance
        </h2>
        <p className="text-sm text-text-secondary max-w-2xl leading-relaxed">
          Heavy, optional subsystems you can switch off to shed load on the app and database, then turn back on when needed.
        </p>
      </div>

      {!isGlobal && (
        <div className="rounded-2xl p-4 mb-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--color-warning-50, #fffbeb)', border: '1px solid var(--color-warning-300, #fcd34d)' }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning-700, #b45309)' }} className="flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-bold mb-0.5" style={{ color: 'var(--color-warning-800, #92400e)' }}>This is a global switch</p>
            <p style={{ color: 'var(--color-warning-700, #b45309)' }}>Switch the scope back to <b>Global</b> to change it — it applies to everyone.</p>
          </div>
        </div>
      )}

      <section className="rounded-2xl mb-4 overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderTop: '3px solid var(--color-primary-500, #6366f1)' }}>
        <div className="p-5">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <Activity size={20} style={{ color: activityOn ? '#059669' : 'var(--color-text-tertiary)' }} className="mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>
                  User Activity Monitor {activityOn ? '' : '— OFF'}
                </p>
                <p className="text-xs mt-1 leading-relaxed max-w-xl" style={{ color: 'var(--color-text-secondary)' }}>
                  The live presence + per-user activity panel (the slide-out tab on the right of the admin screen).
                  When <b>OFF</b>, it disappears completely and <b>all of its load stops</b>: no realtime presence channel,
                  no 2-minute heartbeats, and zero activity writes to the database. Chat still works (it just won't show
                  online dots / “last seen” while off). Turn it back <b>ON</b> any time to resume.
                </p>
              </div>
            </div>
            <button
              onClick={() => isGlobal && onSave('activity_monitor.enabled', !activityOn)}
              role="switch" aria-checked={activityOn} disabled={!isGlobal}
              title={isGlobal ? (activityOn ? 'Turn the activity monitor OFF' : 'Turn the activity monitor ON') : 'Switch to Global scope to change'}
              className="relative w-12 h-7 rounded-full transition-colors flex-shrink-0 disabled:opacity-40"
              style={{ backgroundColor: activityOn ? '#059669' : '#cbd5e1' }}>
              <span className="absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all" style={{ left: activityOn ? '26px' : '4px' }} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default SystemRules;
