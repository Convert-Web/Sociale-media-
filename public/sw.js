/* AURUM — service worker : notifications push, et ouverture instantanée.
   Les fichiers de l'application (pages, scripts, styles, polices, icônes) sont gardés sur
   le téléphone : l'application s'ouvre sans attendre le réseau. Les données (/api) et les
   photos/vidéos ne passent jamais par ce cache (les vidéos lues en ligne sont seulement
   assemblées ici à partir de leurs morceaux, voir plus bas).
   Mises à jour automatiques : la version des fichiers gardés est notée dans le cache (/__version).
   Quand le serveur (/api/version) en annonce une autre, la nouvelle version est téléchargée ici en
   arrière-plan, dans un cache à part (l'écran ouvert continue avec l'ancienne). Au chargement
   suivant d'une page (ouverture de l'application, ou rechargement décidé par js/update.js au bon
   moment), elle prend la place de l'ancienne d'un bloc, avant que la page ne démarre : jamais un
   mélange des deux. Chaque ouverture vérifie aussi la version, pour que la suivante soit à jour
   même sans l'application. Le message « check-version » ci-dessous vide le cache d'office : il sert
   de filet de sécurité si l'application gardée ne démarre pas (js/boot.js). */
const CACHE = 'vibz-app';
const STATIC = /^\/(js|css|fonts|img)\//;
const LOOK_EVERY = 2 * 60 * 1000;
let lastLook = 0;

// Ancien cache de l'application précédente (AURUM) : effacé
self.addEventListener('activate', (event) => event.waitUntil(caches.delete('aurum-app')));

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

// Morceaux des vidéos (1 Mo, jamais modifiés) : gardés sur le téléphone d'une visite à l'autre.
// Les vidéos préparées pendant qu'on regarde (« À suivre ») démarrent ainsi aussitôt à la
// prochaine ouverture, même sans réseau. Environ 250 Mo au plus : les plus anciens partent
// d'abord. Ce cache survit aux mises à jour de l'application (il n'a pas le même nom).
const VIDEO_CACHE = 'videos-v1';
const CHUNK = /^\/media\/v\/[a-f0-9]{32}\/\d{1,3}\.bin$/;
const VIDEO_KEEP = 250;
let videoPuts = 0;
async function videoChunk(req) {
  const cache = await caches.open(VIDEO_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic' && !res.redirected) {
    cache
      .put(req, res.clone())
      .then(() => ++videoPuts % 20 === 0 && trimVideos(cache))
      .catch(() => {}); // stockage plein : la vidéo se lit quand même
  }
  return res;
}
async function trimVideos(cache) {
  const keys = await cache.keys(); // dans l'ordre d'arrivée
  for (let i = 0; i < keys.length - VIDEO_KEEP; i++) await cache.delete(keys[i]);
}
const AHEAD = 3; // morceaux lus d'avance
const videoParts = new Map(); // « id:i » → promesse { buf, total } ; les 16 plus récents gardés
const videoReady = new Set(); // morceaux déjà arrivés

function videoPart(id, i) {
  const key = `${id}:${i}`;
  let p = videoParts.get(key);
  if (p) {
    videoParts.delete(key);
  } else {
    p = videoChunk(new Request(`/media/v/${id}/${i}.bin`)).then(async (res) => {
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
  // En passant, au plus toutes les 2 minutes : une version plus récente se télécharge d'avance
  if (Date.now() - lastLook > LOOK_EVERY) {
    lastLook = Date.now();
    event.waitUntil(lookForUpdate().catch(() => {}));
  }
  if (CHUNK.test(url.pathname)) {
    event.respondWith(videoChunk(req).catch(() => fetch(req)));
    return;
  }
  const video = VIDEO.exec(url.pathname);
  if (video) {
    // « ?direct=1 » : lecture par le serveur (choisie par l'application si ce téléphone coince ici)
    if (!url.search && req.headers.has('range')) event.respondWith(videoRange(req, video[1], video[2]));
    return;
  }
  if (req.mode === 'navigate') {
    // Application monopage : la même page sert toutes les adresses (la nouvelle version, si elle
    // attend, prend la place juste avant)
    if (isAppPage(url)) event.respondWith(serveApp(req).catch(() => fetch(req)));
    return;
  }
  if (STATIC.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(fromCache(req).catch(() => fetch(req)));
  }
});

// ── Nouvelle version de l'application ──────────────────────────────────────
const NEXT = 'vibz-app-next';
const APP_FILES = /(?:href|src)="(\/(?:js|css|fonts|img)\/[^"?#]+)"/g;
let queue = Promise.resolve();
const serial = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

async function cachedVersion(name) {
  if (!(await caches.has(name))) return null;
  const hit = await (await caches.open(name)).match('/__version');
  return hit ? hit.text() : null;
}

// Téléchargée à part, en arrière-plan : la page de l'application (index.html), puis tout ce qu'elle
// charge au démarrage (scripts, styles, polices, icônes). La version n'est notée qu'en dernier :
// elle n'est « prête » qu'une fois complète. Les écrans plus rares se chargeront à leur ouverture.
const preparing = new Map();
function prepareUpdate(version) {
  if (preparing.has(version)) return preparing.get(version);
  const job = serial(async () => {
    if (!version || (await cachedVersion(NEXT)) === version || (await cachedVersion(CACHE)) === version) return true;
    await caches.delete(NEXT);
    const page = await fetch('/index.html', { cache: 'no-store' });
    if (!page.ok || page.type !== 'basic' || page.redirected) throw new Error('page indisponible');
    const files = new Set(['/manifest.webmanifest']);
    for (const m of (await page.clone().text()).matchAll(APP_FILES)) files.add(m[1]);
    const next = await caches.open(NEXT);
    await Promise.all([...files].map(async (f) => {
      const res = await fetch(f, { cache: 'no-cache' });
      if (!res.ok || res.type !== 'basic' || res.redirected) throw new Error(`${f} indisponible`);
      await next.put(f, res);
    }));
    await next.put('/index.html', page);
    await next.put('/__version', new Response(version));
    return true;
  });
  preparing.set(version, job);
  job.catch(() => {}).finally(() => preparing.delete(version));
  return job;
}

// Au chargement d'une page : une version prête remplace l'ancienne d'un bloc, avant que la page ne
// démarre (sans attendre un téléchargement en cours : l'ouverture reste instantanée)
async function serveApp(req) {
  if (await cachedVersion(NEXT).catch(() => null)) {
    await serial(async () => {
      const ready = await cachedVersion(NEXT);
      if (!ready) return;
      if ((await cachedVersion(CACHE)) !== ready) {
        await caches.delete(CACHE);
        const [next, app] = await Promise.all([caches.open(NEXT), caches.open(CACHE)]);
        for (const r of await next.keys()) await app.put(r, await next.match(r));
      }
      await caches.delete(NEXT);
    }).catch(() => {});
  }
  return fromCache(req, '/index.html');
}

// S'il existe une version plus récente que celle gardée, elle se télécharge pour la prochaine
// ouverture (vérifié à l'ouverture, puis en passant tant que l'application sert : même une ancienne
// version de l'application, qui ne sait pas se mettre à jour seule, est ainsi remplacée)
async function lookForUpdate() {
  const res = await fetch('/api/version', { cache: 'no-store' });
  if (!res.ok) return;
  const { version } = await res.json();
  const kept = await cachedVersion(CACHE);
  if (kept && version && kept !== version) await prepareUpdate(version);
}

// Demande de l'application ouverte (js/update.js) : « started » tout de suite, puis le résultat
self.addEventListener('message', (event) => {
  const port = event.ports?.[0];
  if (event.data?.type !== 'prepare-update' || !port) return;
  port.postMessage({ state: 'started' });
  event.waitUntil(
    prepareUpdate(String(event.data.version || '')).then(
      () => port.postMessage({ ok: true }),
      () => port.postMessage({ ok: false }),
    ),
  );
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

// Notification reçue :
// - les messages d'une même personne se regroupent (« 3 nouveaux messages »), comme les J'aime
//   d'une même publication (« Léa et 2 autres ont aimé ta vidéo », mis à jour sans resonner) ;
// - la pastille de l'icône de l'application affiche le nombre de nouveautés ;
// - l'application ouverte est prévenue : bannière et son dans l'application, sans doublon.
//   Sur ordinateur et Android (Chrome), application au premier plan : pas de notification du
//   système en plus. Safari (iPhone) exige d'en afficher une à chaque fois.
const isSafari = /Safari/.test(self.navigator.userAgent) && !/Chrome|Chromium|Android/.test(self.navigator.userAgent);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      if (typeof data.count === 'number' && self.navigator.setAppBadge) {
        await (data.count > 0 ? self.navigator.setAppBadge(data.count) : self.navigator.clearAppBadge()).catch(() => {});
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const focused = windows.some((c) => c.visibilityState === 'visible' && c.focused);
      const show = !focused || isSafari;
      for (const c of windows) c.postMessage({ type: 'push', data, shown: show });
      if (!show) return;
      const tag = data.tag || undefined;
      let title = data.title || 'AURUM';
      let body = data.body || '';
      let count = 1;
      let actors = data.actor ? [data.actor] : [];
      if (tag) {
        const [prev] = await self.registration.getNotifications({ tag });
        if (prev && prev.data && prev.data.kind === data.kind) {
          count = (prev.data.count || 1) + 1;
          actors = [...new Set([...(prev.data.actors || []), ...actors])];
          if (data.kind === 'dm') body = `${plural(count, 'nouveau message', 'nouveaux messages')} · ${data.body}`;
          if (data.kind === 'like' && actors.length > 1) {
            title = `${actors[actors.length - 1]} et ${plural(actors.length - 1, 'autre personne', 'autres personnes')}`;
            body = `ont aimé ${data.what || 'ta vidéo'}.`;
          }
        }
      }
      await self.registration.showNotification(title, {
        body,
        icon: data.icon || '/img/icon-192.png',
        badge: '/img/badge-96.png',
        tag,
        renotify: Boolean(tag) && data.renotify !== false,
        timestamp: Date.now(),
        vibrate: [60, 40, 110],
        data: { url: data.url || '/activite', kind: data.kind || null, count, actors },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/activite', self.location.origin).href;
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
