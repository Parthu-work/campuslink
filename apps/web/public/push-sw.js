/* Web push for the PWA (imported into the generated service worker).
 * Payload: { title, body, url, tag } — names and session times only, never message text. */
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' ? data.title.slice(0, 120) : '';
  if (!title) return;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body.slice(0, 240) : '',
      tag: typeof data.tag === 'string' ? data.tag : undefined,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      data: {
        url:
          typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')
            ? data.url
            : '/home',
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Same-origin paths only (no open redirects from a push payload).
  const target = new URL(event.notification.data?.url ?? '/home', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === target.origin && 'focus' in w) {
          w.navigate(target.href);
          return w.focus();
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
