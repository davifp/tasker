'use client';

import { useCallback, useEffect, useState } from 'react';
import { pushHttp } from '@/lib/http/push';

export type PushSupport = 'unknown' | 'unsupported' | 'supported';
export type PushState = 'idle' | 'registering' | 'active' | 'error';

interface UsePushRegistrationResult {
  support: PushSupport;
  permission: NotificationPermission | 'unknown';
  state: PushState;
  error: string | null;
  isSubscribed: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
}

// Decodes the URL-safe base64 VAPID public key into the Uint8Array format
// `pushManager.subscribe` requires. Kept pure so it can be unit-tested
// without a browser context.
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw =
    typeof atob === 'function'
      ? atob(normalised)
      : Buffer.from(normalised, 'base64').toString('binary');
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// Encapsulates:
//   1. feature detection (Safari 16.4+ satisfies via the same globals)
//   2. SW registration (idempotent — Register-only-if-not-registered)
//   3. VAPID fetch
//   4. `pushManager.subscribe` with a user gesture
//   5. server-side registration through the BFF
// Never triggers on mount — the caller invokes `subscribe()` from a click.
export function usePushRegistration(): UsePushRegistrationResult {
  const [support, setSupport] = useState<PushSupport>('unknown');
  const [permission, setPermission] = useState<NotificationPermission | 'unknown'>('unknown');
  const [state, setState] = useState<PushState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);

  useEffect(() => {
    if (!supported()) {
      setSupport('unsupported');
      return;
    }
    setSupport('supported');
    setPermission(Notification.permission);
    // Reflect current subscription state without prompting.
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/sw.js');
        if (!reg) return;
        const existing = await reg.pushManager.getSubscription();
        setIsSubscribed(existing !== null);
      } catch {
        // Non-fatal — the toggle will simply appear off.
      }
    })();
  }, []);

  const subscribe = useCallback(async () => {
    if (!supported()) return;
    setState('registering');
    setError(null);
    try {
      const { publicKey } = await pushHttp.getVapidKey();
      if (!publicKey) throw new Error('push_not_configured');
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);
      if (permissionResult !== 'granted') {
        setState('error');
        setError('permission_denied');
        return;
      }
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const key = urlBase64ToUint8Array(publicKey);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // Copy into a fresh ArrayBuffer so TS's `BufferSource` overload matches
        // (Uint8Array<ArrayBufferLike> is not assignable to ArrayBufferView<ArrayBuffer>).
        applicationServerKey: key.buffer.slice(
          key.byteOffset,
          key.byteOffset + key.byteLength,
        ) as ArrayBuffer,
      });
      const json = subscription.toJSON();
      await pushHttp.subscribe({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: json.keys?.p256dh ?? '',
          auth: json.keys?.auth ?? '',
        },
        userAgent: navigator.userAgent.slice(0, 256),
      });
      setIsSubscribed(true);
      setState('active');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'unknown');
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!supported()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const existing = await reg?.pushManager.getSubscription();
      if (existing) {
        await pushHttp.unsubscribe(existing.endpoint);
        await existing.unsubscribe();
      }
      setIsSubscribed(false);
      setState('idle');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'unknown');
    }
  }, []);

  return { support, permission, state, error, isSubscribed, subscribe, unsubscribe };
}
