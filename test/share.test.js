'use strict';
// Aperçus des liens partagés : chaque lien (vidéo, profil, invitation, Sujet du jour, hashtag) a son
// titre, sa description et son image dessinée ; rien de privé n'y apparaît.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, signup, publishVideo } = require('./helpers');
const S = require('../src/subjects');

let srv;
let base;
before(async () => {
  srv = await startServer();
  base = srv.base;
  await signup(base, 'ap_admin'); // le premier compte devient administrateur
});
after(async () => srv.close());

// Contenu d'une balise, entités décodées
const meta = (html, name) => {
  const raw = (new RegExp(`<meta (?:property|name)="${name}" content="([^"]*)">`).exec(html) || [])[1];
  return raw?.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
};
async function page(p) {
  const res = await fetch(base + p);
  return { status: res.status, html: await res.text(), cache: res.headers.get('cache-control') };
}
// Largeur et hauteur d'un JPEG (segment SOF)
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}
async function image(url) {
  const u = new URL(url);
  const res = await fetch(base + u.pathname + u.search, { redirect: 'manual' });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}

test('vidéo publique : titre, légende, image dessinée en 1200 × 630', async () => {
  const cam = await signup(base, 'ap_camille', { displayName: 'Camille Roux' });
  const post = await publishVideo(base, cam, 'Coucher de soleil sur le pont 🌅 #paris');
  const { status, html, cache } = await page(`/@ap_camille/video/${post.id}`);
  assert.equal(status, 200);
  assert.match(html, /<title>Vidéo de Camille Roux sur AURUM<\/title>/);
  assert.equal(meta(html, 'og:title'), 'Vidéo de Camille Roux sur AURUM');
  assert.equal(meta(html, 'og:description'), 'Coucher de soleil sur le pont 🌅 #paris');
  assert.equal(meta(html, 'og:url'), `${srv.ctx.config.baseUrl}/@ap_camille/video/${post.id}`);
  const img = meta(html, 'og:image');
  assert.match(img, new RegExp(`/apercu/video/${post.id}\\.jpg\\?v=[0-9a-f]{10}$`));
  assert.equal(meta(html, 'twitter:image'), img);
  assert.match(cache, /s-maxage=300/);
  assert.match(html, /<script src="\/js\/boot\.js"><\/script>/); // la même application
  const { res, buf } = await image(img);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.deepEqual(jpegSize(buf), [1200, 630]);
  assert.ok(buf.length < 300 * 1024, `${buf.length} octets`);
  // Une autre version renvoie vers la bonne (jamais dessinée deux fois)
  const wrong = await fetch(`${base}/apercu/video/${post.id}.jpg?v=0000000000`, { redirect: 'manual' });
  assert.equal(wrong.status, 302);
  assert.equal(wrong.headers.get('location'), new URL(img).pathname + new URL(img).search);
});

test('rien de privé : vidéo « moi uniquement », compte privé, publication inconnue', async () => {
  const bob = await signup(base, 'ap_bob');
  const priv = await publishVideo(base, bob, 'Mon secret absolu', { privacy: 'private' });
  let p = await page(`/@ap_bob/video/${priv.id}`);
  assert.equal(p.status, 200);
  assert.ok(!p.html.includes('Mon secret absolu'));
  assert.match(meta(p.html, 'og:image'), /\/img\/og\.jpg/);
  assert.match(p.cache, /no-store/);
  const img = await fetch(`${base}/apercu/video/${priv.id}.jpg`, { redirect: 'manual' });
  assert.equal(img.status, 302);
  assert.match(img.headers.get('location'), /^\/img\/og\.jpg/);
  // Compte privé : ses vidéos ne sont pas décrites, son profil oui (nom seulement)
  const dan = await signup(base, 'ap_dan', { displayName: 'Dan' });
  const pub = await publishVideo(base, dan, 'Réservé à mes abonnés');
  await dan.patch('/api/me/settings', { privateAccount: true });
  p = await page(`/@ap_dan/video/${pub.id}`);
  assert.ok(!p.html.includes('Réservé à mes abonnés'));
  p = await page('/@ap_dan');
  assert.equal(meta(p.html, 'og:title'), 'Dan (@ap_dan) sur AURUM');
  // Publication ou compte inconnus : l'aperçu général
  p = await page('/@ap_dan/video/999999');
  assert.equal(p.status, 200);
  assert.equal(meta(p.html, 'og:title'), 'AURUM — Vidéos courtes et actu du jour');
  p = await page('/@personne.inconnue');
  assert.equal(meta(p.html, 'og:title'), 'AURUM — Vidéos courtes et actu du jour');
});

test('profil et invitation : nom, abonnés, « X t’invite sur AURUM »', async () => {
  const zoe = await signup(base, 'ap_zoe', { displayName: 'Zoé "Zozo" & Co' });
  await zoe.patch('/api/me', { bio: 'Danse et cuisine' });
  let p = await page('/@ap_zoe');
  assert.equal(meta(p.html, 'og:title'), 'Zoé "Zozo" & Co (@ap_zoe) sur AURUM');
  assert.match(p.html, /content="Zoé &quot;Zozo&quot; &amp; Co \(@ap_zoe\) sur AURUM"/); // échappé
  assert.equal(meta(p.html, 'og:description'), 'Danse et cuisine');
  const { res, buf } = await image(meta(p.html, 'og:image'));
  assert.equal(res.status, 200);
  assert.deepEqual(jpegSize(buf), [1200, 630]);
  p = await page('/rejoindre?par=ap_zoe');
  assert.equal(p.status, 200);
  assert.match(meta(p.html, 'og:title'), /^Zoé "Zozo" & Co t’invite sur AURUM$/);
  assert.match(meta(p.html, 'og:image'), /\/apercu\/invitation\/ap_zoe\.jpg\?v=/);
  assert.match(meta(p.html, 'og:url'), /\/rejoindre\?par=ap_zoe$/);
  // Sans invitation : la page d'entrée habituelle
  p = await page('/rejoindre');
  assert.equal(meta(p.html, 'og:title'), 'AURUM — Vidéos courtes et actu du jour');
});

test('Sujet du jour, hashtag : la question, le nombre de réponses ; jamais un texte inventé', async () => {
  const s = await S.ensureCurrent(srv.ctx);
  let p = await page(`/sujet/${s.id}`);
  assert.equal(meta(p.html, 'og:title'), `Le Sujet du jour : ${s.title}`);
  assert.match(meta(p.html, 'og:image'), new RegExp(`/apercu/sujet/${s.id}\\.jpg\\?v=`));
  p = await page('/sujet');
  assert.equal(meta(p.html, 'og:url'), `${srv.ctx.config.baseUrl}/sujet/${s.id}`);
  const { res } = await image(meta(p.html, 'og:image'));
  assert.equal(res.status, 200);
  // Hashtag existant (publication publique) ; un hashtag inventé n'a pas d'aperçu à lui
  p = await page('/tag/paris');
  assert.equal(meta(p.html, 'og:title'), '#paris sur AURUM');
  p = await page('/tag/nimportequoi');
  assert.equal(meta(p.html, 'og:title'), 'AURUM — Vidéos courtes et actu du jour');
});

test('accord avec vercel.json : les liens partagés passent par le serveur', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const { STATIC_SOURCE } = require('../src/pages');
  const rule = vercel.rewrites[0];
  assert.equal(rule.source, `/(${STATIC_SOURCE.replace('(?:|', '(?:')})?`);
  assert.deepEqual(rule.missing, [{ type: 'query', key: 'par' }]);
  const re = new RegExp(`^${rule.source}$`);
  for (const p of ['/', '/explorer', '/rejoindre', '/actu', '/live']) assert.ok(re.test(p), p);
  for (const p of ['/@alice', '/@alice/video/1', '/sujet', '/sujet/4', '/live/bob', '/actu/3', '/tag/danse', '/son/1']) assert.ok(!re.test(p), p);
  const noStore = vercel.headers.find((h) => h.source === rule.source);
  assert.deepEqual(noStore.missing, rule.missing);
});
