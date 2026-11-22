/* AURUM — service worker : notifications push, et ouverture instantanée.
   Les fichiers de l'application (pages, scripts, styles, polices, icônes) sont gardés sur
   le téléphone : l'application s'ouvre sans attendre le réseau. Les données (/api) et les
   photos/vidéos ne passent jamais par ce cache (les vidéos lues en ligne sont seulement
   assemblées ici à partir de leurs morceaux, voir plus bas).
   Mise à jour : la version des fichiers gardés est notée dans le cache (/__version). Quand le
   serveur (/api/version) en annonce une autre, l'application affiche le bouton « Mettre à jour »
   (js/update.js) : un toucher vide ce cache d'un bloc et relance l'application, qui charge la
   nouvelle version complète, jamais un mélange. Le message « check-version » ci-dessous fait la
   même chose d'office : il sert aux anciennes versions de l'application, et de filet de sécurité
   si l'application gardée ne démarre pas (js/boot.js). */
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

// Vidéos lues en ligne : le lecteur demande des plages d'octets (« Range »). Elles sont servies ici
// à partir des morceaux de 1 Mo que le réseau de Vercel garde au plus près (CDN) : démarrage plus
// rapide, morceaux suivants lus d'avance, et les octets ne repassent pas par le serveur (quota
// gratuit préservé, même pour une vidéo lourde en qualité d'origine). Au moindre souci (vidéo
// ancienne, morceau absent), la demande part telle quelle au serveur, qui sait aussi la servir.
const VIDEO = /^\/media\/v\/([a-f0-9]{32})\.(mp4|webm)$/;
const MB = 1024 * 1024;
const AHEAD = 3; // morceaux lus d'avance
const videoParts = new Map(); // « id:i » → promesse { buf, total } ; les 16 plus récents gardés
const videoReady = new Set(); // morceaux déjà arrivés

function videoPart(id, i) {
  const key = `${id}:${i}`;
  let p = videoParts.get(key);
  if (p) {
    videoParts.delete(key);
  } else {
    p = fetch(`/media/v/${id}/${i}.bin`).then(async (res) => {
      const total = Number(res.headers.get('x-video-size'));
      if (!res.ok || !(total > 0)) throw new Error('morceau indisponible');
      const part = { buf: await res.arrayBuffer(), total };
      if (videoParts.get(key) === p) videoReady.add(key);
      return part;
    });
    p.catch(() => videoParts.get(key) === p && videoParts.delete(key));
  }
  videoParts.set(key, p);
  while (videoParts.size > 16) {
    const old = videoParts.keys().next().value;
    videoParts.delete(old);
    videoReady.delete(old);
  }
  return p;
}

async function videoRange(req, id, ext) {
  try {
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') || '');
    if (!m) return await fetch(req);
    const start = Number(m[1]);
    const first = Math.floor(start / MB);
    const head = await videoPart(id, first);
    const total = head.total;
    if (start >= total) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
    // Le morceau demandé, et le suivant s'il est déjà là (2 Mo au plus) : la réponse part sans
    // attendre, le lecteur demande la suite de lui-même
    const more = videoReady.has(`${id}:${first + 1}`) ? 2 : 1;
    const end = Math.min(total - 1, m[2] === '' ? Infinity : Number(m[2]), (first + more) * MB - 1);
    const last = Math.floor(end / MB);
    const rest = [];
    for (let i = first + 1; i <= last; i++) rest.push(videoPart(id, i));
    const count = Math.ceil(total / MB);
    for (let i = last + 1; i <= Math.min(count - 1, last + AHEAD); i++) videoPart(id, i).catch(() => {});
    const bufs = [head.buf, ...(await Promise.all(rest)).map((r) => r.buf)];
    const body = new Blob(bufs).slice(start - first * MB, end - first * MB + 1);
    return new Response(body, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': ext === 'webm' ? 'video/webm' : 'video/mp4',
        'Content-Length': String(body.size),
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
      },
    });
  } catch {
    return fetch(req);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const video = VIDEO.exec(url.pathname);
  if (video) {
    // « ?direct=1 » : lecture par le serveur (choisie par l'application si ce téléphone coince ici)
    if (!url.search && req.headers.has('range')) event.respondWith(videoRange(req, video[1], video[2]));
    return;
  }
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
