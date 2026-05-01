/**
 * usePushNotifications
 * Registers the service worker, manages push subscription, and performs
 * automatic health checks so notifications always reach the OS reliably.
 *
 * Health checks run:
 *   - On mount (full setup + verification)
 *   - Every 5 minutes (subscription re-validation)
 *   - On permission change (browser settings watcher)
 *   - On manual subscribe/unsubscribe
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client';

export function playNotificationSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch { /* blocked by browser */ }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

const IS_SUPPORTED = typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export const usePushNotifications = ({ onNewNotification } = {}) => {
  const [permission,    setPermission]    = useState(() => IS_SUPPORTED ? Notification.permission : 'unsupported');
  const [subscribed,    setSubscribed]    = useState(false);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [healthStatus,  setHealthStatus]  = useState({
    swActive:           false,
    permissionGranted:  false,
    subscriptionActive: false,
    vapidConfigured:    false,
    ready:              false,
  });

  const swRef        = useRef(null);
  const onNewRef     = useRef(onNewNotification);
  const verifyTimer  = useRef(null);
  const permStatus   = useRef(null);

  // Keep onNewNotification ref in sync without re-running effects
  onNewRef.current = onNewNotification;

  const patchHealth = useCallback((partial) => {
    setHealthStatus(prev => {
      const next = { ...prev, ...partial };
      next.ready = next.swActive && next.permissionGranted && next.subscriptionActive && next.vapidConfigured;
      return next;
    });
  }, []);

  // ── Save subscription object to backend ────────────────────────────────────
  const saveSubscription = useCallback(async (sub) => {
    const j = sub.toJSON();
    await client.post('push/subscribe', {
      endpoint:  j.endpoint,
      keys:      j.keys,
      userAgent: navigator.userAgent.slice(0, 200),
    });
  }, []);

  // ── Create new push subscription and save to backend ──────────────────────
  const doSubscribe = useCallback(async (reg) => {
    const { data } = await client.get('push/vapid-key');
    patchHealth({ vapidConfigured: true });
    const appKey = urlBase64ToUint8Array(data.publicKey);
    const sub    = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    await saveSubscription(sub);
    setSubscribed(true);
    patchHealth({ subscriptionActive: true });
    return sub;
  }, [patchHealth, saveSubscription]);

  // ── Verify existing subscription is still alive in browser + DB ───────────
  const verifySubscription = useCallback(async (reg) => {
    try {
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setSubscribed(false);
        patchHealth({ subscriptionActive: false });
        // Auto-recover if permission still granted
        if (Notification.permission === 'granted') {
          await doSubscribe(reg).catch(() => {});
        }
        return;
      }

      // Cross-check with backend — re-save if server lost it
      try {
        const res = await client.post('push/verify', { endpoint: sub.endpoint });
        if (!res.data?.found) {
          await saveSubscription(sub);
        }
      } catch {
        // /push/verify might not exist — assume OK if browser subscription is alive
      }

      setSubscribed(true);
      patchHealth({ subscriptionActive: true });
    } catch {
      setSubscribed(false);
      patchHealth({ subscriptionActive: false });
    }
  }, [patchHealth, doSubscribe, saveSubscription]);

  // ── Main setup effect (runs once, after component mounts) ─────────────────
  useEffect(() => {
    if (!IS_SUPPORTED) return;

    let cancelled = false;

    const setup = async () => {
      // 1. Confirm VAPID endpoint is reachable
      try {
        await client.get('push/vapid-key');
        if (!cancelled) patchHealth({ vapidConfigured: true });
      } catch {
        if (!cancelled) patchHealth({ vapidConfigured: false });
      }

      // 2. Register service worker
      let reg;
      try {
        reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        if (cancelled) return;
        swRef.current = reg;
        patchHealth({ swActive: true });
      } catch {
        if (!cancelled) patchHealth({ swActive: false });
        return;
      }

      // 3. Read current permission state
      const perm = Notification.permission;
      if (!cancelled) {
        setPermission(perm);
        patchHealth({ permissionGranted: perm === 'granted' });
      }

      if (perm === 'granted' && !cancelled) {
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          await verifySubscription(reg);
        } else {
          // Subscription was lost (browser update, cleared storage, etc.) — auto-recover
          await doSubscribe(reg).catch(() => {});
        }
      }

      // 4. Watch for permission changes in browser settings (Chrome/Edge/FF)
      try {
        const ps = await navigator.permissions.query({ name: 'notifications' });
        permStatus.current = ps;
        ps.onchange = () => {
          if (cancelled) return;
          const p = ps.state === 'granted' ? 'granted'
                  : ps.state === 'denied'  ? 'denied'
                  : 'default';
          setPermission(p);
          patchHealth({ permissionGranted: p === 'granted' });

          if (p === 'granted' && swRef.current) {
            // Permission just (re-)granted — ensure subscription is active
            swRef.current.pushManager.getSubscription().then(sub => {
              if (!sub) doSubscribe(swRef.current).catch(() => {});
              else      verifySubscription(swRef.current);
            });
          } else if (p !== 'granted') {
            setSubscribed(false);
            patchHealth({ subscriptionActive: false });
          }
        };
      } catch { /* PermissionStatus.onchange not supported in all browsers */ }

      // 5. Periodic re-validation every 5 minutes
      verifyTimer.current = setInterval(() => {
        if (Notification.permission === 'granted' && swRef.current && !cancelled) {
          verifySubscription(swRef.current);
        }
      }, 5 * 60 * 1000);
    };

    setup();

    // SW → page message listener (in-page sound + bell refresh)
    const onMessage = (event) => {
      if (event.data?.type === 'PUSH_RECEIVED') {
        playNotificationSound();
        onNewRef.current?.(event.data.payload);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('message', onMessage);
      clearInterval(verifyTimer.current);
      if (permStatus.current) permStatus.current.onchange = null;
    };
  }, []); // intentionally empty — callbacks accessed via refs; setup runs once after login

  // ── Manual subscribe (user clicks Enable) ────────────────────────────────
  const subscribe = useCallback(async () => {
    if (!IS_SUPPORTED) { setError('Push notifications not supported in this browser'); return false; }
    setLoading(true);
    setError('');
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      patchHealth({ permissionGranted: perm === 'granted' });
      if (perm !== 'granted') { setError('Notification permission denied'); return false; }

      const reg = swRef.current || await navigator.serviceWorker.ready;
      swRef.current = reg;
      patchHealth({ swActive: true });

      await doSubscribe(reg);
      return true;
    } catch (err) {
      setError(err.message || 'Failed to enable push notifications');
      return false;
    } finally {
      setLoading(false);
    }
  }, [patchHealth, doSubscribe]);

  // ── Manual unsubscribe ────────────────────────────────────────────────────
  const unsubscribe = useCallback(async () => {
    try {
      const reg = swRef.current || await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await client.delete('push/unsubscribe', { data: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      patchHealth({ subscriptionActive: false });
    } catch {}
  }, [patchHealth]);

  // ── Diagnostic function — call to get a full health report ───────────────
  const checkHealth = useCallback(async () => {
    const issues = [];
    if (!IS_SUPPORTED) return { ok: false, issues: ['Push not supported in this browser'], healthStatus };

    if (!swRef.current?.active) issues.push('Service worker is not active');
    if (Notification.permission === 'denied')       issues.push('Notifications are blocked — unblock in browser settings');
    else if (Notification.permission !== 'granted') issues.push('Notification permission not yet granted');
    if (!subscribed) issues.push('No active push subscription');

    try {
      const res = await client.get('push/vapid-key');
      if (!res.data?.publicKey) issues.push('Server VAPID key is missing or misconfigured');
    } catch { issues.push('Push API endpoint unreachable — check server configuration'); }

    return {
      ok:        issues.length === 0,
      issues,
      healthStatus,
      canRepair: IS_SUPPORTED && Notification.permission !== 'denied',
    };
  }, [subscribed, healthStatus]);

  return {
    permission,
    subscribed,
    loading,
    error,
    isSupported:          IS_SUPPORTED,
    healthStatus,
    subscribe,
    unsubscribe,
    checkHealth,
    playNotificationSound,
  };
};
