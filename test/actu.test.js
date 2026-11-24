'use strict';
// L'Actu : lecture des flux (articles, podcasts, chaînes vidéo), rubriques, « À la une »,
// sources gérées par l'administration, et vidéos qui réagissent à une actualité.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.VIBZ_ALLOW_LOCAL_FETCH = '1';
const { startServer, client, signup, publishVideo } = require('./helpers');
const journal = require('../src/journal');

let srv;
let base;
let feeds;
let F;
let admin;
let lea;

// Faux médias : flux RSS, podcast, chaîne vidéo, page d'un site qui annonce son flux
const day = (n) => new Date(Date.UTC(2026, 10, n, 8)).toUTCString();
const PAGES = {
  '/feed.xml': () => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>La Gazette</title><link>${F}/</link>
    <item><title>Climat : un accord historique &amp; attendu</title><link>${F}/a1</link><description>&lt;p&gt;Les pays se sont entendus.&lt;/p&gt;</description><pubDate>${day(10)}</pubDate><media:content url="${F}/img1.jpg" medium="image"/></item>
    <item><title>Une nouvelle puce record</title><link>${F}/a2</link><description>Plus rapide, moins gourmande.</description><pubDate>${day(11)}</pubDate><enclosure url="${F}/img2.jpg" type="image/jpeg"/></item>
    <item><title>Le festival ouvre ses portes</title><link>${F}/a3</link><description>Trois jours de concerts.</description><pubDate>${day(12)}</pubDate></item>
  </channel></rss>`,
  '/podcast.xml': () => `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Le Récap</title><itunes:image href="${F}/cover.jpg"/>
    <item><title>Épisode 2 — L’actualité de la semaine</title><link>${F}/ep2</link><enclosure url="${F}/ep2.mp3" type="audio/mpeg" length="1"/><itunes:duration>45:30</itunes:duration><pubDate>${day(12)}</pubDate><description><![CDATA[<p>Le résumé en 45 minutes.</p>]]></description></item>
    <item><title>Épisode 1 — Comprendre l’inflation</title><guid>${F}/ep1</guid><enclosure url="${F}/ep1.mp3" type="audio/mpeg" length="1"/><itunes:duration>3120</itunes:duration><pubDate>${day(5)}</pubDate></item>
  </channel></rss>`,
  '/videos.xml': () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><title>Le Média Vidéo</title><yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId>
    <entry><yt:videoId>abcdefghijk</yt:videoId><title>Le point sur la journée</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><published>2026-11-12T10:00:00+00:00</published><media:group><media:description>L’essentiel en images.</media:description><media:thumbnail url="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"/></media:group></entry>
  </feed>`,
  '/site.html': () => '<html><head><title>La Gazette</title><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head><body>Bienvenue</body></html>',
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
  srv = await startServer();
  base = srv.base;
  admin = await signup(base, 'admin_actu');
  lea = await signup(base, 'lea_actu');
  // Les sources réelles proposées au premier lancement sont retirées : seuls les faux médias restent
  const s = await admin.get('/api/actu/sources');
  for (const src of s.data.sources) assert.equal((await admin.del(`/api/actu/sources/${src.id}`)).status, 200);
});
after(async () => {
  await srv.close();
  feeds.close();
});

test('lecteurs intégrés et protection contre les adresses internes', async () => {
  assert.equal(journal.embedFor('https://youtu.be/dQw4w9WgXcQ').embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(journal.embedFor('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk').kind, 'podcast');
  assert.equal(journal.embedFor('https://www.exemple.fr/article'), null);
  process.env.VIBZ_ALLOW_LOCAL_FETCH = '0';
  await assert.rejects(journal.safeFetch(`${F}/feed.xml`), /non autorisée/);
  await assert.rejects(journal.safeFetch('file:///etc/passwd'), /http/);
  process.env.VIBZ_ALLOW_LOCAL_FETCH = '1';
});

test('sources : ajout par l’administration (site, podcast, chaîne vidéo), rubriques, refus', async () => {
  const site = await admin.post('/api/actu/sources', { url: `${F}/site.html`, topic: 'monde' });
  assert.equal(site.status, 201, JSON.stringify(site.data));
  assert.equal(site.data.source.kind, 'article');
  assert.equal(site.data.source.items, 3);
  const pod = await admin.post('/api/actu/sources', { url: `${F}/podcast.xml`, topic: 'eco' });
  assert.equal(pod.data.source.kind, 'podcast');
  const vid = await admin.post('/api/actu/sources', { url: `${F}/videos.xml`, topic: 'une' });
  assert.equal(vid.data.source.kind, 'video');
  assert.equal((await admin.post('/api/actu/sources', { url: `${F}/feed.xml` })).status, 409);
  assert.equal((await admin.post('/api/actu/sources', { url: `${F}/absent.xml` })).status, 400);
  assert.equal((await lea.post('/api/actu/sources', { url: `${F}/feed.xml` })).status, 403);
  assert.equal((await client(base).get('/api/actu/sources')).status, 401);
});

test('lecture : tout le monde, par rubrique et par format, page après page', async () => {
  const guest = client(base);
  const all = await guest.get('/api/actu');
  assert.equal(all.status, 200);
  assert.equal(all.data.items.length, 6);
  const first = all.data.items[0];
  assert.ok(first.publishedAt >= all.data.items[1].publishedAt);
  const climat = all.data.items.find((i) => i.title.startsWith('Climat'));
  assert.equal(climat.title, 'Climat : un accord historique & attendu');
  assert.equal(climat.summary, 'Les pays se sont entendus.');
  assert.equal(climat.siteName, 'La Gazette');
  assert.equal(climat.topic, 'monde');
  const monde = await guest.get('/api/actu?topic=monde');
  assert.equal(monde.data.items.length, 3);
  const pods = (await guest.get('/api/actu?kind=podcast')).data.items;
  assert.equal(pods.length, 2);
  assert.equal(pods[0].audioUrl, `${F}/ep2.mp3`.replace('http://', 'https://'));
  assert.equal(pods[0].duration, 2730);
  const vids = (await guest.get('/api/actu?kind=video')).data.items;
  assert.equal(vids[0].embedUrl, 'https://www.youtube-nocookie.com/embed/abcdefghijk');
  const page1 = await guest.get('/api/actu?limit=4');
  assert.equal(page1.data.hasMore, true);
  const page2 = await guest.get(`/api/actu?limit=4&before=${page1.data.items[3].publishedAt}`);
  assert.ok(page2.data.items.every((i) => !page1.data.items.some((x) => x.id === i.id)));
  const une = await guest.get('/api/actu/une');
  assert.equal(une.status, 200);
  assert.ok(une.data.brief.length >= 1);
  assert.equal(une.data.podcasts.length, 2);
  assert.equal(une.data.videos.length, 1);
  assert.ok(une.data.topics.some((t) => t.id === 'tech'));
});

test('« À la une » et retrait : réservés à l’administration', async () => {
  const items = (await client(base).get('/api/actu?kind=article')).data.items;
  const item = items[items.length - 1];
  assert.equal((await lea.post(`/api/actu/${item.id}/feature`)).status, 403);
  await admin.post(`/api/actu/${item.id}/feature`, { featured: true });
  const une = await client(base).get('/api/actu/une');
  assert.equal(une.data.lead[0].id, item.id);
  assert.ok(une.data.brief.every((b) => b.id !== item.id));
  await admin.post(`/api/actu/${item.id}/feature`, { featured: false });
  assert.equal((await lea.del(`/api/actu/${item.id}`)).status, 403);
});

test('réagir en vidéo : la vidéo porte l’actualité, l’actualité liste ses réactions', async () => {
  const item = (await client(base).get('/api/actu?kind=article')).data.items[0];
  const post = await publishVideo(base, lea, 'Mon avis sur cette nouvelle #actu', { actuId: item.id });
  assert.equal(post.actu.id, item.id);
  assert.equal(post.actu.title, item.title);
  const detail = await client(base).get(`/api/actu/${item.id}`);
  assert.equal(detail.data.item.reactions, 1);
  assert.equal(detail.data.reactions[0].id, post.id);
  const une = await client(base).get('/api/actu/une');
  assert.equal(une.data.reacted[0].id, item.id);
  // Une actualité qui n'existe pas : refus clair
  const bad = await lea.post('/api/posts', { body: 'Texte', bg: 'ocean', actuId: 999999 });
  assert.equal(bad.status, 400);
  // La source retirée : l'actualité à laquelle une vidéo répond reste lisible
  const s = await admin.get('/api/actu/sources');
  for (const src of s.data.sources) await admin.del(`/api/actu/sources/${src.id}`);
  assert.equal((await client(base).get(`/api/actu/${item.id}`)).status, 200);
});

test('relecture des flux : une seule à la fois, et pas plus d’une fois toutes les 20 minutes', async () => {
  const guest = client(base);
  const r1 = await guest.post('/api/actu/refresh');
  assert.equal(r1.status, 200);
  const r2 = await guest.post('/api/actu/refresh');
  assert.equal(r2.data.skipped, true);
  // Forcée seulement par l'administration
  const forced = await admin.post('/api/actu/refresh', { force: true });
  assert.equal(forced.data.skipped, false);
});
