import { useState } from 'react';
import { HardDrive, WifiOff, RefreshCw, Trash2, ShieldCheck, ArrowUpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Panel, SectionHeader, Toggle, ActionRow } from '../../UI/kit';

// ============================================================================
// Service worker — what gets cached, and how an update reaches a live session.
//
// The rule this panel exists to protect: /api is NEVER cached. It is not a
// setting, so it is not a control here — it is stated as a fact, because a
// cached authenticated response replayed to the wrong tenant is a data-leak
// class bug rather than a stale-UI annoyance.
//
// "Force update" bumps cache_version. The worker re-reads /api/pwa/public on
// activate and deletes every cache that isn't the current version, so a bump is
// how you evict a bad shell from devices you cannot reach.
// ============================================================================

export default function ServiceWorkerSection({ sw, enabled, onChange }) {
  const [clearing, setClearing] = useState(false);

  const clearLocalCaches = async () => {
    setClearing(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg?.active) reg.active.postMessage({ type: 'CLEAR_CACHES' });
      // Belt and braces: if no worker controls this tab, drop the caches directly.
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('bsx-shell-v')).map(k => caches.delete(k)));
      }
      toast.success('Caches cleared on this device.');
    } catch (e) {
      toast.error(e.message || 'Could not clear caches.');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <div className="space-y-5 min-w-0">
        <Panel pad="lg">
          <SectionHeader icon={HardDrive} title="Caching"
            subtitle="Only the app shell and content-hashed build assets. Never data." />

          {!enabled && (
            <Panel tone="inset" radius="xl" pad="sm" className="mb-4">
              <p className="text-[11px] m-0" style={{ color: 'var(--color-warning-600)' }}>
                The PWA layer is off, so nothing below is in effect yet. These settings are stored and apply
                the moment you enable it.
              </p>
            </Panel>
          )}

          <div className="space-y-4">
            <Toggle
              checked={!!sw.cache_enabled}
              onChange={v => onChange('cache_enabled', v)}
              label="Cache the app shell"
              tone="primary"
              hint="Hashed /assets/* served cache-first (they are immutable), navigations network-first with a cached fallback. Turning this on or off bumps the cache version automatically on save."
            />
            <Toggle
              checked={!!sw.offline_fallback}
              onChange={v => onChange('offline_fallback', v)}
              label="Offline fallback page"
              tone="primary"
              hint="When a navigation fails and nothing is cached for it, show /offline.html instead of the browser's error page."
            />
          </div>
        </Panel>

        <Panel pad="lg">
          <SectionHeader icon={ArrowUpCircle} title="Updates" />
          <Toggle
            checked={!!sw.auto_update}
            onChange={v => onChange('auto_update', v)}
            label="Apply updates without asking"
            tone={sw.auto_update ? 'warn' : 'primary'}
            hint={sw.auto_update
              ? 'A new build activates and reloads on its own. It can swap the bundle under someone mid-form — the update banner exists precisely to avoid that.'
              : 'Recommended. A new build waits, and the existing update banner lets the user apply it with one deliberate click.'}
          />
        </Panel>
      </div>

      <div className="space-y-5 min-w-0">
        <Panel pad="lg">
          <SectionHeader icon={RefreshCw} title="Cache version"
            subtitle="Every client holding an older version drops it on next activate." />

          <div className="flex items-center gap-4 flex-wrap">
            <div className="rounded-2xl px-5 py-3 flex-shrink-0"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <div className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none mb-1"
                style={{ color: 'var(--color-text-secondary)' }}>Current</div>
              <div className="text-2xl font-bold leading-none font-mono" style={{ color: 'var(--color-text)' }}>
                v{sw.cache_version || 1}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] m-0" style={{ color: 'var(--color-text-secondary)' }}>
                The worker re-reads this on activate and deletes every cache that is not the current version.
                Bumping it is how you evict a bad app shell from devices you cannot reach.
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <ActionRow
              icon={ArrowUpCircle}
              label={`Force update — bump to v${(Number(sw.cache_version) || 1) + 1}`}
              hint="Takes effect when you save. Every client rebuilds its shell cache from the network."
              tone="warn"
              onClick={() => onChange('cache_version', (Number(sw.cache_version) || 1) + 1)}
            />
            <ActionRow
              icon={Trash2}
              label="Clear caches on this device"
              hint="Local only — nobody else is affected. Useful for checking a change with your own eyes."
              tone="danger"
              busy={clearing}
              onClick={clearLocalCaches}
            />
          </div>
        </Panel>

        {/* Not a setting — an invariant. It is here so nobody goes looking for
            the switch that would turn it off. */}
        <Panel pad="lg">
          <SectionHeader icon={ShieldCheck} title="What is never cached" tone="success" />
          <ul className="space-y-2.5 m-0 pl-0" style={{ listStyle: 'none' }}>
            {[
              ['/api/*', 'Network-only, no fallback, no exceptions. This is a multi-tenant CRM — a cached authenticated response replayed to the wrong tenant, or after a permission change, is a data leak.'],
              ['/manifest.webmanifest', 'It IS configuration, so it always comes fresh.'],
              ['Anything that is not a GET', 'Writes never touch the cache layer.'],
              ['Third-party origins', 'Not ours to manage.'],
            ].map(([what, why]) => (
              <li key={what} className="flex items-start gap-2.5">
                <WifiOff size={13} className="flex-shrink-0 mt-1" style={{ color: 'var(--color-success-600)' }} />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold font-mono" style={{ color: 'var(--color-text)' }}>{what}</div>
                  <p className="text-[11px] m-0" style={{ color: 'var(--color-text-secondary)' }}>{why}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
