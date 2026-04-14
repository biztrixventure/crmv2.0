/**
 * usePushNotifications
 * Registers the service worker, prompts for notification permission,
 * subscribes via Web Push API, and saves the subscription to the backend.
 * Also listens for messages from the SW to play sound and refresh bell.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import client from '../api/client';

// Tiny notification sound using Web Audio API (no file dependency)
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
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
  } catch { /* no-op on browsers that block audio */ }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

export const usePushNotifications = ({ onNewNotification } = {}) => {
  const [permission, setPermission]     = useState(Notification.permission);
  const [subscribed, setSubscribed]     = useState(false);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');
  const swRef = useRef(null);

  // Register service worker once
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        swRef.current = reg;
        // Check if already subscribed
        return reg.pushManager.getSubscription();
      })
      .then(sub => { if (sub) setSubscribed(true); })
      .catch(() => {});

    // Listen for SW → page messages (play sound + refresh bell)
    const onMessage = (event) => {
      if (event.data?.type === 'PUSH_RECEIVED') {
        playNotificationSound();
        if (onNewNotification) onNewNotification(event.data.payload);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [onNewNotification]);

  // Request permission + subscribe
  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) {
      setError('Service workers not supported in this browser');
      return false;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Request notification permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setError('Notification permission denied');
        return false;
      }

      // 2. Get VAPID public key
      const { data: vapidData } = await client.get('push/vapid-key');
      const applicationServerKey = urlBase64ToUint8Array(vapidData.publicKey);

      // 3. Get SW registration
      const reg = swRef.current || await navigator.serviceWorker.ready;

      // 4. Subscribe via Push API
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // 5. Save to backend
      const subJson = sub.toJSON();
      await client.post('push/subscribe', {
        endpoint:  subJson.endpoint,
        keys:      subJson.keys,
        userAgent: navigator.userAgent.slice(0, 200),
      });

      setSubscribed(true);
      return true;
    } catch (err) {
      setError(err.message || 'Failed to subscribe to push notifications');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Unsubscribe
  const unsubscribe = useCallback(async () => {
    try {
      const reg = swRef.current || await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;

      await client.delete('push/unsubscribe', { data: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
      setSubscribed(false);
    } catch {}
  }, []);

  const isSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  return { permission, subscribed, loading, error, isSupported, subscribe, unsubscribe, playNotificationSound };
};
