import { useState, useEffect, useCallback } from 'react';
import {
  Activity, RefreshCw, Send, CheckCircle2, XCircle, AlertTriangle, Info, BellRing,
} from 'lucide-react';
import { toast } from 'sonner';
import client from '../../../api/client';
import { Panel, SectionHeader, Loading, ActionRow } from '../../UI/kit';
import Button from '../../UI/Button';

// ============================================================================
// Diagnostics — the state of THIS browser, not of the fleet.
//
// Every value here is measured live rather than inferred from the settings
// object: "caching is enabled" in config and "a worker is actually controlling
// this tab" are different claims, and only the second one explains why
// something did or did not happen. Where the two disagree, that disagreement is
// the diagnosis.
//
// The test push goes to the caller only. A "notify everyone" button on a live
// CRM is a footgun with no undo, so it deliberately does not exist.
// ============================================================================

const OK   = 'var(--color-success-600)';
const BAD  = 'var(--color-error-600)';
const WARN = 'var(--color-warning-600)';
const DIM  = 'var(--color-text-tertiary)';

function Row({ label, value, tone = 'dim', hint }) {
  const color = tone === 'ok' ? OK : tone === 'bad' ? BAD : tone === 'warn' ? WARN : DIM;
  const Icon  = tone === 'ok' ? CheckCircle2 : tone === 'bad' ? XCircle : tone === 'warn' ? AlertTriangle : Info;
  return (
    <div className="flex items-start justify-between gap-3 py-2.5"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>{label}</div>
        {hint && <p className="text-[11px] m-0 mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{hint}</p>}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Icon size={13} style={{ color }} />
        <span className="text-[13px] font-semibold text-right break-all" style={{ color }}>{value}</span>
      </div>
    </div>
  );
}

// Base64url VAPID key → the Uint8Array the Push API wants. Same conversion as
// usePushNotifications; duplicated rather than imported because mounting that
// hook here would start a second registration loop and a second 5-minute
// health timer beside the one AdminPanel already runs.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export default function DiagnosticsSection({ vapidConfigured, requireInteraction }) {
  const [probe, setProbe]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [enabling, setEnabling] = useState(false);

  const measure = useCallback(async () => {
    setLoading(true);
    const out = {
      secure:        typeof window !== 'undefined' && window.isSecureContext,
      swSupported:   'serviceWorker' in navigator,
      pushSupported: 'PushManager' in window,
      permission:    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
      manifestHref:  document.querySelector('link[rel="manifest"]')?.getAttribute('href') || null,
      installed:     window.matchMedia?.('(display-mode: standalone)')?.matches
                     || window.navigator.standalone === true,
      state: 'none', scope: null, controlled: false, waiting: false,
      subscription: null, publicFlags: null,
    };

    try {
      if (out.swSupported) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          out.state      = reg.active ? 'active' : reg.installing ? 'installing' : reg.waiting ? 'waiting' : 'registered';
          out.scope      = reg.scope;
          out.waiting    = !!reg.waiting;
          out.controlled = !!navigator.serviceWorker.controller;
          if (out.pushSupported) {
            const sub = await reg.pushManager.getSubscription();
            // Host only — the endpoint is a capability URL, the same rule the
            // Devices list follows.
            if (sub) { try { out.subscription = new URL(sub.endpoint).host; } catch { out.subscription = 'unknown'; } }
          }
        }
      }
    } catch { /* a probe that throws is itself a finding; the rows render it as "none" */ }

    try {
      const r = await fetch('/api/pwa/public', { cache: 'no-store' });
      if (r.ok) out.publicFlags = await r.json();
    } catch { /* leave null — rendered as "unreachable" */ }

    setProbe(out);
    setLoading(false);
  }, []);

  useEffect(() => { measure(); }, [measure]);

  // Ask for permission and subscribe THIS browser. Reporting "you will not
  // receive pushes" without offering the one action that fixes it is a
  // diagnosis with no treatment — and the browser will only show its permission
  // dialog from inside a user gesture, so it has to be a button.
  const enablePush = async () => {
    setEnabling(true);
    try {
      if (!('Notification' in window) || !('PushManager' in window)) {
        toast.error('This browser does not support push notifications.');
        return;
      }
      let perm = Notification.permission;
      if (perm === 'default') perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast.error(perm === 'denied'
          ? 'Blocked. Allow notifications for this site in the browser’s site settings, then re-check.'
          : 'Permission was not granted.');
        return;
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      // Reuse an existing subscription if the browser still holds one — calling
      // subscribe() again with a different key would throw.
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { data } = await client.get('push/vapid-key');
        if (!data?.publicKey) { toast.error('Server has no VAPID public key configured.'); return; }
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.publicKey),
        });
      }
      const j = sub.toJSON();
      await client.post('push/subscribe', {
        endpoint:  j.endpoint,
        keys:      j.keys,
        userAgent: navigator.userAgent.slice(0, 200),
      });
      toast.success('This browser is subscribed. Send a test push to confirm.');
    } catch (e) {
      toast.error(e.response?.data?.error || e.message || 'Could not enable push on this browser.');
    } finally {
      setEnabling(false);
      measure();
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await client.post('pwa/test-push', {});
      setTestResult(r.data);
    } catch (e) {
      setTestResult({ sent: false, detail: e.response?.data?.error || e.message });
    } finally {
      setTesting(false);
    }
  };

  if (loading || !probe) {
    return (
      <Panel pad="lg">
        <SectionHeader icon={Activity} title="Diagnostics" subtitle="Measuring this browser…" />
        <Loading variant="rows" rows={6} />
      </Panel>
    );
  }

  const p = probe;
  const flags = p.publicFlags;
  const permTone = p.permission === 'granted' ? 'ok' : p.permission === 'denied' ? 'bad' : 'warn';

  // The single most useful line on this screen: config says one thing, the
  // browser is doing another, and here is why.
  const mismatch = flags?.enabled && p.swSupported && p.state === 'none';

  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <Panel pad="lg" className="min-w-0">
        <SectionHeader icon={Activity} title="This browser"
          subtitle="Measured now — not read back from the settings above."
          actions={<Button variant="ghost" size="sm" onClick={measure}><RefreshCw size={14} /> Re-check</Button>} />

        {mismatch && (
          <Panel tone="inset" radius="xl" pad="sm" className="mb-3">
            <p className="text-[11px] m-0" style={{ color: 'var(--color-warning-600)' }}>
              The PWA layer is enabled server-side, but no service worker is registered in this tab. Boot-time
              registration lands in a later stage — until then a worker appears only after notification permission
              has been granted.
            </p>
          </Panel>
        )}

        <div>
          <Row label="Secure context" value={p.secure ? 'Yes' : 'No'} tone={p.secure ? 'ok' : 'bad'}
            hint={p.secure ? null : 'Service workers and push require HTTPS (or localhost).'} />
          <Row label="Service worker support" value={p.swSupported ? 'Supported' : 'Unsupported'}
            tone={p.swSupported ? 'ok' : 'bad'} />
          <Row label="Worker state" value={p.state}
            tone={p.state === 'active' ? 'ok' : p.state === 'none' ? 'dim' : 'warn'}
            hint={p.scope ? `Scope ${p.scope}` : 'No registration in this browser.'} />
          <Row label="Controlling this tab" value={p.controlled ? 'Yes' : 'No'}
            tone={p.controlled ? 'ok' : 'dim'}
            hint={p.controlled ? null : 'A worker only takes control after the first reload following activation.'} />
          {p.waiting && (
            <Row label="Update waiting" value="Yes" tone="warn"
              hint="A newer worker is installed and waiting. The update banner is what applies it, deliberately." />
          )}
          <Row label="Notification permission" value={p.permission} tone={permTone}
            hint={p.permission === 'denied'
              ? 'Denied is sticky — the browser will not ask again; it has to be reset in site settings.'
              : p.permission === 'default' ? 'Not asked yet on this device.' : null} />
          <Row label="Push subscription" value={p.subscription || 'None'}
            tone={p.subscription ? 'ok' : 'dim'}
            hint={p.subscription
              ? 'Push service host for this browser.'
              : 'This browser will not receive device pushes — use the button below to enable them.'} />
          <Row label="Manifest link" value={p.manifestHref || 'Missing'} tone={p.manifestHref ? 'ok' : 'warn'} />
          <Row label="Running installed" value={p.installed ? 'Yes' : 'No — browser tab'}
            tone={p.installed ? 'ok' : 'dim'} />
        </div>

        {/* The fix, next to the finding. `denied` is the one state no button can
            resolve — the browser will not re-ask — so it gets an explanation
            rather than a control that would do nothing. */}
        {!p.subscription && p.swSupported && p.pushSupported && (
          <div className="mt-4">
            {p.permission === 'denied' ? (
              <Panel tone="inset" radius="xl" pad="sm">
                <p className="text-[11px] m-0" style={{ color: 'var(--color-error-600)' }}>
                  Notifications are blocked for this site, and a blocked browser will never ask again. Allow them in
                  the padlock menu beside the address bar, then press Re-check.
                </p>
              </Panel>
            ) : (
              <ActionRow
                icon={BellRing}
                label="Enable push on this browser"
                hint={p.permission === 'granted'
                  ? 'Permission is already granted but no subscription exists — this recreates it.'
                  : 'Asks for notification permission, then subscribes this browser.'}
                tone="primary"
                busy={enabling}
                onClick={enablePush}
              />
            )}
          </div>
        )}
      </Panel>

      <div className="space-y-5 min-w-0">
        <Panel pad="lg">
          <SectionHeader icon={Info} title="Server" subtitle="What /api/pwa/public tells every client." />
          <div>
            <Row label="VAPID keys" value={vapidConfigured ? 'Configured' : 'Missing'}
              tone={vapidConfigured ? 'ok' : 'bad'}
              hint={vapidConfigured ? null : 'Without them no device push can be delivered at all.'} />
            {flags ? (
              <>
                <Row label="PWA enabled" value={flags.enabled ? 'Yes' : 'No'} tone={flags.enabled ? 'ok' : 'dim'} />
                <Row label="Caching" value={flags.cache_enabled ? 'On' : 'Off'} tone={flags.cache_enabled ? 'ok' : 'dim'} />
                <Row label="Cache version" value={`v${flags.cache_version}`} />
                <Row label="Offline fallback" value={flags.offline_fallback ? 'On' : 'Off'}
                  tone={flags.offline_fallback ? 'ok' : 'dim'} />
                <Row label="Auto-update" value={flags.auto_update ? 'On' : 'Prompt'}
                  tone={flags.auto_update ? 'warn' : 'ok'} />
              </>
            ) : (
              <Row label="Public flags" value="Unreachable" tone="bad"
                hint="GET /api/pwa/public did not respond — the worker reads that same endpoint, so it would fall back to no caching." />
            )}
          </div>
          {flags && (
            <p className="text-[11px] m-0 mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
              These are the SAVED values. Unsaved edits above are not reflected here until you save.
            </p>
          )}
        </Panel>

        <Panel pad="lg">
          <SectionHeader icon={Send} title="Test push" subtitle="Sends to you, on this account, and to nobody else." />
          <ActionRow
            icon={Send}
            label="Send a test notification to myself"
            hint={p.permission === 'granted'
              ? (requireInteraction ? 'It will stay on screen until dismissed, per the current setting.' : 'It should appear within a second or two.')
              : 'Notification permission is not granted in this browser — the server will still try, but nothing will show here.'}
            tone="primary"
            busy={testing}
            onClick={sendTest}
          />
          {testResult && (
            <div className="flex items-start gap-2.5 mt-3">
              {testResult.sent
                ? <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" style={{ color: OK }} />
                : <XCircle size={14} className="flex-shrink-0 mt-0.5" style={{ color: BAD }} />}
              <div className="min-w-0">
                <div className="text-[13px] font-semibold" style={{ color: testResult.sent ? OK : BAD }}>
                  {testResult.sent ? 'Sent to your subscribed devices' : 'Not sent'}
                </div>
                <p className="text-[11px] m-0 mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {testResult.detail
                    || (testResult.sent
                      ? 'The server accepted it. If nothing appeared, check the OS notification settings for this browser — that layer is outside the app.'
                      : 'No detail returned.')}
                </p>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
