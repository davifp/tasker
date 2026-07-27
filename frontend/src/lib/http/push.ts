// Push subscriptions travel through the BFF at `/api/push/*` because they
// carry endpoints and keys that must not touch the client-side session
// token. Every fetch here targets a Next.js route handler, not the raw
// browser proxy.

export interface VapidKeyResponse {
  publicKey: string | null;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

export const pushHttp = {
  async getVapidKey(): Promise<VapidKeyResponse> {
    const res = await fetch('/api/push/vapid', { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`vapid-key request failed: ${res.status}`);
    return (await res.json()) as VapidKeyResponse;
  },
  async subscribe(payload: PushSubscriptionPayload): Promise<{ id: string }> {
    const res = await fetch('/api/push/subscriptions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
    return (await res.json()) as { id: string };
  },
  async unsubscribe(endpoint: string): Promise<void> {
    const res = await fetch(`/api/push/subscriptions/${encodeURIComponent(endpoint)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(`unsubscribe failed: ${res.status}`);
    }
  },
};
