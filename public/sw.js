/* AURUM — service worker : notifications push, et ouverture instantanée.
   Les fichiers de l'application (pages, scripts, styles, polices, icônes) sont gardés sur
   le téléphone : l'application s'ouvre sans attendre le réseau. Les données (/api) et les
   photos/vidéos ne passent jamais par ce cache.
   Mise à jour : une fois l'application démarrée, la page demande de comparer la version
   gardée avec celle du serveur (/api/version). Si elle a changé, le cache est vidé d'un
   bloc : le lancement suivant charge la nouvelle version complète, jamais un mélange. */
const CACHE = 'aurum-app';
const STATIC = /^\/(js|css|fonts|img)\//;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function isAppPage(url) {
  return !/^\/(api|media)\//.test(url.pathname) && url.pathname !== '/sw.js';
}

async function fromCache(request, key) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key || request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic' && !res.redirected) await cache.put(key || request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Application monopage : la même page sert toutes les adresses
    if (isAppPage(url)) event.respondWith(fromCache(req, '/index.html').catch(() => fetch(req)));
    return;
  }
  if (STATIC.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(fromCache(req).catch(() => fetch(req)));
  }
});

async function checkVersion() {
  const res = await fetch('/api/version', { cache: 'no-store' });
  if (!res.ok) return false;
  const { version } = await res.json();
  const cache = await caches.open(CACHE);
  const stored = await cache.match('/__version');
  const old = stored ? await stored.text() : null;
  if (old === version) return false;
  if (old) {
    await caches.delete(CACHE);
    await (await caches.open(CACHE)).put('/__version', new Response(version));
    return true;
  }
  await cache.put('/__version', new Response(version));
  return false;
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'check-version') return;
  event.waitUntil(
    checkVersion()
      .then((updated) => updated && event.source?.postMessage({ type: 'updated' }))
      .catch(() => {}),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'AURUM';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/img/icon-192.png',
      badge: '/img/badge-96.png',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || '/salon' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/salon', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          client.postMessage({ type: 'navigate', url });
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
