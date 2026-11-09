const C = 'tq-v2';
const WORKER = 'https://tagesquest-health.tq-mjs-2026.workers.dev';
const FILES = ['./', 'index.html', 'style.css', 'schedule.js', 'extras.js', 'app.js', 'icon.svg', 'icon.png', 'manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
});

// Web-Push: der Server schickt ein leeres Signal, den Text holt sich das Service Worker vom Server.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let d = { title: 'Tagesquest', body: 'Eine Quest ist fällig.' };
    try { const r = await fetch(WORKER + '/lastpush', { cache: 'no-store' }); if (r.ok) d = await r.json(); } catch {}
    await self.registration.showNotification(d.title, { body: d.body, icon: 'icon.png', badge: 'icon.png', tag: 'tq-quest' });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => {
    for (const c of cs) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});
