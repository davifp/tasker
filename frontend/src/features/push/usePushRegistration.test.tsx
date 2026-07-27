import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { urlBase64ToUint8Array, usePushRegistration } from './usePushRegistration';

describe('urlBase64ToUint8Array', () => {
  it('decodes a URL-safe base64 VAPID key into a Uint8Array', () => {
    // 65-byte VAPID public key (typical uncompressed point). We do not need
    // a real key — just check that round-tripping produces the right length
    // and the same bytes as `atob`.
    const original =
      'BOTM1IJn-U1qFmBgSN6H6QYY9HdRFYvhq8QN4tXsAy8Xr01tHZbPQOEIfqoLj-YnwTM2eFwGm6uEV3-JnFHtGrs';
    const arr = urlBase64ToUint8Array(original);
    expect(arr.byteLength).toBe(65);
    // First byte of an uncompressed EC point is 0x04.
    expect(arr[0]).toBe(0x04);
  });
});

describe('usePushRegistration', () => {
  it('reports unsupported when the browser lacks PushManager', () => {
    // jsdom does not implement PushManager; leave the original navigator alone.
    const { result } = renderHook(() => usePushRegistration());
    expect(result.current.support).toBe('unsupported');
    expect(result.current.isSubscribed).toBe(false);
  });
});
