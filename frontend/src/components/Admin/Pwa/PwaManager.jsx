import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Smartphone, Save, RotateCcw, Download, HardDrive,
  BellRing, MonitorSmartphone, Activity, Power,
} from 'lucide-react';
import client from '../../../api/client';
import { Panel, SectionHeader, Loading, PillTabs, Toggle, useFlash } from '../../UI/kit';
import Alert from '../../UI/Alert';
import Button from '../../UI/Button';
import InstallSection from './InstallSection';
import ServiceWorkerSection from './ServiceWorkerSection';
import EventsSection from './EventsSection';
import DevicesSection from './DevicesSection';
import DiagnosticsSection from './DiagnosticsSection';

// ============================================================================
// PwaManager — the superadmin control surface for the Progressive Web App:
// how it installs, what the service worker caches, and — the part that actually
// changes people's day — which events notify whom, in-app or as an instant
// device push.
//
// Everything here reads and writes ONE object: business_config global key `pwa`,
// through GET/PUT /api/pwa. There is no per-field endpoint and no partial save,
// so the panel keeps the whole settings object in state and ships it as a unit.
// That is also why Save is explicit: a matrix of 17 events is something you
// finish adjusting and then commit, not something that fires a request per click.
//
// The honest framing for the event matrix, repeated in the UI: push ALREADY
// fires for every event today. The defaults describe current behaviour rather
// than propose new behaviour, so this screen's value is turning things DOWN and
// re-targeting them — not switching them on.
// ============================================================================

const SECTIONS = [
  { key: 'install',       label: 'Install',        icon: Download },
  { key: 'sw',            label: 'Service worker', icon: HardDrive },
  { key: 'events',        label: 'Push events',    icon: BellRing },
  { key: 'devices',       label: 'Devices',        icon: MonitorSmartphone },
  { key: 'diagnostics',   label: 'Diagnostics',    icon: Activity },
];

export default function PwaManager() {
  const [data, setData]         = useState(null);   // { catalog, roles, vapid_configured }
  const [settings, setSettings] = useState(null);
  const [baseline, setBaseline] = useState('');     // JSON of the last saved state
  const [branding, setBranding] = useState({});
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [tab, setTab] = useState('install');
  const { msg, flash, clear } = useFlash();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Branding is fetched alongside because the manifest is BUILT from both:
      // an empty name or theme colour here falls back to branding server-side,
      // and the install preview would be lying if it didn't show that fallback.
      const [pwa, brand] = await Promise.all([
        client.get('pwa'),
        client.get('branding').catch(() => ({ data: { branding: {} } })),
      ]);
      setData(pwa.data);
      setSettings(pwa.data.settings);
      setBaseline(JSON.stringify(pwa.data.settings));
      setBranding(brand.data?.branding || {});
    } catch (e) {
      flash('error', e.response?.data?.error || 'Could not load PWA settings.');
    } finally {
      setLoading(false);
    }
  }, [flash]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(
    () => Boolean(settings) && JSON.stringify(settings) !== baseline,
    [settings, baseline],
  );

  const patch = useCallback((section, key, value) => {
    setSettings(p => ({ ...p, [section]: { ...p[section], [key]: value } }));
  }, []);

  const save = async () => {
    setSaving(true);
    clear();
    try {
      const r = await client.put('pwa', { settings });
      // Read the response back rather than trusting local state: the server
      // bumps cache_version itself when the caching rules changed, so the saved
      // object is not always the one that was sent.
      setSettings(r.data.settings);
      setBaseline(JSON.stringify(r.data.settings));
      flash('success', 'PWA settings saved.');
    } catch (e) {
      flash('error', e.response?.data?.error || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const revert = () => { setSettings(JSON.parse(baseline)); clear(); };

  if (loading || !settings) {
    return (
      <div className="space-y-5 w-full">
        <SectionHeader level="page" icon={Smartphone} title="Progressive Web App"
          subtitle="Install, offline behaviour, and who gets notified about what." />
        <Loading variant="cards" cards={3} />
      </div>
    );
  }

  return (
    <div className="space-y-5 w-full">
      <SectionHeader
        level="page"
        icon={Smartphone}
        title="Progressive Web App"
        subtitle="How the CRM installs on a device, what works offline, and which events reach whom."
        actions={
          <>
            {dirty && (
              <Button variant="ghost" size="sm" onClick={revert}>
                <RotateCcw size={14} /> Discard
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!dirty}>
              {!saving && <Save size={14} />} {dirty ? 'Save changes' : 'Saved'}
            </Button>
          </>
        }
      />

      {msg && <Alert type={msg.type} onDismiss={clear}>{msg.text}</Alert>}

      {/* The master switch is deliberately OUTSIDE the tabs. It is the only
          control here that changes behaviour for people already signed in —
          everything else is configuration that this switch decides whether to
          apply at all. Burying it in a sub-tab hides the one thing you look for. */}
      <Panel pad="lg">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <Toggle
              checked={!!settings.enabled}
              onChange={v => setSettings(p => ({ ...p, enabled: v }))}
              label="Enable the PWA layer"
              tone={settings.enabled ? 'success' : 'muted'}
              hint="Registers the service worker at boot and offers the install prompt. Off means today's behaviour exactly: no worker unless someone grants notification permission, no caching, no install affordance."
            />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Power size={14} style={{ color: settings.enabled ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }} />
            <span className="text-[11px] font-bold uppercase tracking-wider leading-none"
              style={{ color: settings.enabled ? 'var(--color-success-600)' : 'var(--color-text-tertiary)' }}>
              {settings.enabled ? 'Live' : 'Off'}
            </span>
          </div>
        </div>
        {/* The manifest is served unconditionally — this switch does not gate it.
            Saying so here stops "why is it still installable?" being filed. */}
        <p className="text-[11px] m-0 mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
          The web app manifest is always served, so the browser's own "Install" menu item stays available either way.
          This switch controls the service worker and the in-app install prompt.
        </p>
      </Panel>

      <PillTabs items={SECTIONS} value={tab} onChange={setTab} />

      {tab === 'install' && (
        <InstallSection install={settings.install} branding={branding}
          onChange={(k, v) => patch('install', k, v)} />
      )}
      {tab === 'sw' && (
        <ServiceWorkerSection sw={settings.sw} enabled={settings.enabled}
          onChange={(k, v) => patch('sw', k, v)} />
      )}
      {tab === 'events' && (
        <EventsSection
          catalog={data.catalog}
          roles={data.roles}
          events={settings.events}
          push={settings.push}
          vapidConfigured={data.vapid_configured}
          onEventChange={(id, next) => setSettings(p => ({ ...p, events: { ...p.events, [id]: next } }))}
          onEventsReplace={next => setSettings(p => ({ ...p, events: next }))}
          onPushChange={(k, v) => patch('push', k, v)}
        />
      )}
      {tab === 'devices' && <DevicesSection />}
      {tab === 'diagnostics' && (
        <DiagnosticsSection vapidConfigured={data.vapid_configured}
          requireInteraction={settings.push.require_interaction} />
      )}

      {/* A sticky-ish footer reminder: the sub-tabs mean you can edit the event
          matrix, switch to Devices, and forget that nothing was committed. */}
      {dirty && (
        <Panel tone="inset" radius="xl" pad="sm">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[11px] sm:text-[10px] font-bold uppercase tracking-wider leading-none"
              style={{ color: 'var(--color-warning-600)' }}>
              Unsaved changes
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="xs" onClick={revert}><RotateCcw size={12} /> Discard</Button>
              <Button variant="primary" size="xs" onClick={save} loading={saving}>
                {!saving && <Save size={12} />} Save
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
