// Tasker Web Push service worker.
//
// The push and notificationclick handlers are the only surface — no fetch
// interception, no offline caching — so the SW stays boring and cheap to
// register. The payload comes serialised from the backend via web-push and
// is expected to have {title, body, url, eventType, notificationId}.

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Tasker', body: 'You have a new notification', url: '/' };
  }
  const title = payload.title || 'Tasker';
  const options = {
    body: payload.body || '',
    icon: '/icon.png',
    badge: '/badge.png',
    tag: payload.notificationId || undefined,
    data: { url: payload.url || '/', notificationId: payload.notificationId },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of clientsList) {
        // Focus the first tab already showing the workspace shell.
        if (client.url.includes(new URL(url, self.location.origin).origin)) {
          await client.focus();
          if ('navigate' in client) {
            try {
              await client.navigate(url);
            } catch {
              // navigate() throws on cross-origin — fall back to openWindow.
              await self.clients.openWindow(url);
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
