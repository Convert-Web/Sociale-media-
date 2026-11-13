'use strict';
// Version 5 : le Journal (actualités, podcasts, vidéos).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.NODE_ENV = 'test';
process.env.AURUM_ALLOW_LOCAL_FETCH = '1';
const config = require('../src/config');
const { createApp } = require('../src/application');
const journal = require('../src/journal');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v5-'));
let server;
let feeds;
let base;
let F;
let ctx;

// Faux sites : flux RSS, podcast, chaîne vidéo, page avec balises Open Graph
const day = (n) => new Date(Date.UTC(2026, 10, n, 8)).toUTCString();
const PAGES = {
  '/feed.xml': () => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>La Gazette</title><link>${F}/</link>
    <item><title>Marchés : la semaine &amp; ses records</title><link>${F}/a1</link><description>&lt;p&gt;Le CAC 40 au sommet.&lt;/p&gt;</description><pubDate>${day(10)}</pubDate><media:content url="${F}/img1.jpg" medium="image"/></item>
    <item><title>L'art contemporain s'envole</title><link>${F}/a2</link><description>Ventes record à Paris.</description><pubDate>${day(11)}</pubDate><enclosure url="${F}/img2.jpg" type="image/jpeg"/></item>
    <item><title>Gastronomie : trois nouvelles étoiles</title><link>${F}/a3</link><description>Le guide est paru.</description><pubDate>${day(12)}</pubDate></item>
  </channel></rss>`,
  '/podcast.xml': () => `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Le Club des Entrepreneurs</title><itunes:image href="${F}/cover.jpg"/>
    <item><title>Épisode 2 — Bâtir une maison de luxe</title><link>${F}/ep2</link><enclosure url="${F}/ep2.mp3" type="audio/mpeg" length="1"/><itunes:duration>45:30</itunes:duration><pubDate>${day(12)}</pubDate><description><![CDATA[<p>Avec une fondatrice.</p>]]></description></item>
    <item><title>Épisode 1 — Investir dans l'art</title><guid>${F}/ep1</guid><enclosure url="${F}/ep1.mp3" type="audio/mpeg" length="1"/><itunes:duration>3120</itunes:duration><pubDate>${day(5)}</pubDate></item>
  </channel></rss>`,
  '/videos.xml': () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><title>Maison de ventes</title><yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>
    <entry><yt:videoId>abcdefghijk</yt:videoId><title>Vente du soir à New York</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><published>2026-11-12T10:00:00+00:00</published><media:group><media:description>Les plus beaux lots.</media:description><media:thumbnail url="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"/></media:group></entry>
  </feed>`,
  '/site.html': () => `<html><head><title>La Gazette</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>Bienvenue</body></html>`,
  '/article.html': () => `<html><head><title>Titre brut</title><meta property="og:title" content="Les plus belles villas de la Riviera"><meta property="og:description" content="Une sélection d&#39;exception."><meta property="og:image" content="https://cdn.example.com/villa.jpg"><meta property="og:site_name" content="Revue Riviera"></head><body></body></html>`,
};

before(async () => {
  feeds = http.createServer((req, res) => {
    const page = PAGES[req.url];
    if (!page) {
      res.writeHead(404);
      return res.end('introuvable');
    }
    res.writeHead(200, { 'content-type': req.url.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/xml; charset=utf-8' });
    res.end(page());
  });
  await new Promise((r) => feeds.listen(0, '127.0.0.1', r));
  F = `http://127.0.0.1:${feeds.address().port}`;

  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v5.db')}`, authToken: '' },
    paidEntry: false,
    admissionDefault: 'open',
    demoPayments: false,
    rateLimit: false,
    adminEmails: [],
    stripe: { secretKey: '', webhookSecret: '' },
  };
  const created = await createApp(cfg, { stripe: null, mailer: { send: async () => {} } });
  ctx = created.ctx;
  await new Promise((resolve) => {
    server = created.app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  ctx.hub.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => feeds.close(r));
  ctx.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const headers = { 'x-aurum': '1' };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload });
    const m = /aurum_sid=([^;]+)/.exec(res.headers.get('set-cookie') || '');
    if (m) cookie = `aurum_sid=${m[1]}`;
    return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), del: (u, b) => call('DELETE', u, b) };
}
async function member(name, username) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.user = r.data.user;
  return c;
}

let admin;
let claire;

test('lecteurs intégrés reconnus à partir des liens', () => {
  assert.equal(journal.embedFor('https://youtu.be/dQw4w9WgXcQ').embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(journal.embedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10').kind, 'video');
  assert.equal(journal.embedFor('https://vimeo.com/76979871').embedUrl, 'https://player.vimeo.com/video/76979871');
  assert.equal(journal.embedFor('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk').embedUrl, 'https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk');
  assert.equal(journal.embedFor('https://podcasts.apple.com/fr/podcast/x/id1209142994').kind, 'podcast');
  assert.equal(journal.embedFor('https://cdn.example.com/episode.mp3').audioUrl, 'https://cdn.example.com/episode.mp3');
  assert.equal(journal.embedFor('https://www.lefigaro.fr/article'), null);
});

test('protection : adresses internes refusées hors tests', async () => {
  process.env.AURUM_ALLOW_LOCAL_FETCH = '0';
  await assert.rejects(journal.safeFetch(`${F}/feed.xml`), /non autorisée/);
  await assert.rejects(journal.safeFetch('file:///etc/passwd'), /http/);
  process.env.AURUM_ALLOW_LOCAL_FETCH = '1';
});

test('sources par défaut, réservées à la Direction', async () => {
  admin = await member('Wissam Ait', 'wissam');
  claire = await member('Claire Delmas', 'claire');
  const list = await admin.get('/api/journal');
  assert.equal(list.status, 200);
  assert.equal(list.data.stale, true);
  const s = await admin.get('/api/journal/sources');
  assert.ok(s.data.sources.length >= 8);
  assert.ok(s.data.sources.some((x) => x.kind === 'podcast') && s.data.sources.some((x) => x.kind === 'video'));
  assert.equal((await claire.get('/api/journal/sources')).status, 403);
  // On retire les sources réelles pour tester sans Internet
  for (const src of s.data.sources) assert.equal((await admin.del(`/api/journal/sources/${src.id}`)).status, 200);
});

test('ajout de sources : site (flux détecté), podcast, chaîne vidéo', async () => {
  const site = await admin.post('/api/journal/sources', { url: `${F}/site.html` });
  assert.equal(site.status, 201, JSON.stringify(site.data));
  assert.equal(site.data.source.kind, 'article');
  assert.equal(site.data.source.title, 'La Gazette');
  assert.equal(site.data.source.items, 3);
  const pod = await admin.post('/api/journal/sources', { url: `${F}/podcast.xml` });
  assert.equal(pod.data.source.kind, 'podcast');
  const vid = await admin.post('/api/journal/sources', { url: `${F}/videos.xml` });
  assert.equal(vid.data.source.kind, 'video');
  assert.equal((await admin.post('/api/journal/sources', { url: `${F}/feed.xml` })).status, 409);
  assert.equal((await admin.post('/api/journal/sources', { url: `${F}/absent.xml` })).status, 400);
  assert.equal((await claire.post('/api/journal/sources', { url: `${F}/feed.xml` })).status, 403);

  const all = await claire.get('/api/journal');
  assert.equal(all.data.items.length, 6);
  assert.equal(all.data.items[0].title, 'Vente du soir à New York'); // plus récent d'abord (12 nov., 10 h)
  const art = all.data.items.find((i) => i.title.startsWith('Marchés'));
  assert.equal(art.title, 'Marchés : la semaine & ses records');
  assert.equal(art.summary, 'Le CAC 40 au sommet.');
  assert.equal(art.image, `https://127.0.0.1:${feeds.address().port}/img1.jpg`);
  assert.equal(art.siteName, 'La Gazette');

  const pods = (await claire.get('/api/journal?kind=podcast')).data.items;
  assert.equal(pods.length, 2);
  assert.equal(pods[0].duration, 45 * 60 + 30);
  assert.match(pods[0].audioUrl, /ep2\.mp3$/);
  assert.match(pods[1].image, /cover\.jpg$/); // image de l'émission
  const vids = (await claire.get('/api/journal?kind=video')).data.items;
  assert.equal(vids[0].embedUrl, 'https://www.youtube-nocookie.com/embed/abcdefghijk');
  // Pagination
  const page1 = await claire.get('/api/journal?limit=4');
  assert.equal(page1.data.hasMore, true);
  const page2 = await claire.get(`/api/journal?limit=4&before=${page1.data.items[3].publishedAt}`);
  assert.equal(page2.data.items.length, 2);
});

test('un membre partage un lien ; à la une ; suppression', async () => {
  const p = await claire.post('/api/journal/preview', { url: `${F}/article.html` });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.preview.title, 'Les plus belles villas de la Riviera');
  assert.equal(p.data.preview.summary, 'Une sélection d’exception.'.replace('’', "'"));
  assert.equal(p.data.preview.siteName, 'Revue Riviera');
  const shared = await claire.post('/api/journal', { url: `${F}/article.html`, note: 'À lire avant l’été.' });
  assert.equal(shared.status, 201, JSON.stringify(shared.data));
  const item = shared.data.item;
  assert.equal(item.sharedBy.username, 'claire');
  assert.equal(item.note, 'À lire avant l’été.');
  assert.equal(item.kind, 'article');
  assert.equal((await claire.post('/api/journal', { url: `${F}/article.html` })).status, 409);

  assert.equal((await claire.post(`/api/journal/${item.id}/feature`)).status, 403);
  await admin.post(`/api/journal/${item.id}/feature`, { featured: true });
  const list = await claire.get('/api/journal');
  assert.equal(list.data.featured[0].id, item.id);
  await admin.post(`/api/journal/${item.id}/feature`, { featured: false });
  assert.equal((await claire.get('/api/journal')).data.featured.length, 0);

  const other = (await claire.get('/api/journal?kind=video')).data.items[0];
  assert.equal((await claire.del(`/api/journal/${other.id}`)).status, 403);
  assert.equal((await claire.del(`/api/journal/${item.id}`)).status, 200);
  assert.equal((await claire.get(`/api/journal/${item.id}`)).status, 404);
});

test('relecture des flux et suppression de compte', async () => {
  const r = await admin.post('/api/journal/refresh', { force: true });
  assert.equal(r.data.skipped, false);
  const again = await claire.post('/api/journal/refresh');
  assert.equal(again.data.skipped, true); // relu il y a moins de 20 minutes
  await claire.post('/api/journal', { url: `${F}/article.html` });
  await claire.del('/api/me', { password: 'motdepasse-solide' });
  const left = (await admin.get('/api/journal')).data.items.filter((i) => i.sharedBy);
  assert.equal(left.length, 0);
});
