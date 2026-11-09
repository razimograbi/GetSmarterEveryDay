// Service worker: lets phones install Smarts on the home screen, and keeps a copy of the
// app's own files for when there's no connection (the app then says it can't reach the
// server instead of the browser showing an error page).
//
// It always asks the network first, so players get the newest version whenever they're
// online. API calls and question pictures are left to the browser and its own cache.

const CACHE = 'smarts-v2';
const SKIP = /^\/(api|img|signs|topics|pic)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || SKIP.test(url.pathname)) return;
  event.respondWith(networkFirst(req));
});

// Reminders from the server (server/push.js): { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data?.json() ?? {};
  } catch { /* not JSON: show the default */ }
  event.waitUntil(self.registration.showNotification(msg.title || 'Smarts', {
    body: msg.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: msg.tag,
    data: { url: msg.url || '/' },
  }));
});

// Tapping a reminder opens Smarts (or brings it forward) on the right screen.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (app) {
      await app.focus();
      return app.navigate(url).catch(() => {});
    }
    return self.clients.openWindow(url);
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (err) {
    // Offline: the saved copy, or for any page of the app, the app itself.
    const saved = (await cache.match(req)) || (req.mode === 'navigate' && (await cache.match('/')));
    if (saved) return saved;
    throw err;
  }
}
