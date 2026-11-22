'use strict';
// Version 17 : les vidéos publiées sont gardées (plus d'effacement après 24 h) ; les stories restent
// éphémères ; la Direction peut toujours régler une durée de vie (VIDEO_TTL_HOURS).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v17-'));
let server;
let base;
let ctx;

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v17.db')}`, authToken: '' },
    paidEntry: false,
    admissionDefault: 'open',
    bots: false,
    rateLimit: false,
    adminEmails: [],
    stripe: { secretKey: '', webhookSecret: '' },
  };
  const created = await createApp(cfg, { stripe: null, mailer: { send: async () => {}, sendBatch: async (l) => l.length } });
  ctx = created.ctx;
  await new Promise((resolve) => {
    server = created.app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  ctx.hub.close();
  await new Promise((r) => server.close(r));
  ctx.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  const call = async (method, url, body, headers = {}) => {
    const hd = { 'x-aurum': '1', ...headers };
    if (cookie) hd.cookie = cookie;
    let payload;
    if (body instanceof FormData || Buffer.isBuffer(body)) payload = body;
    else if (body !== undefined) {
      hd['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers: hd, body: payload });
    const m = /aurum_sid=([^;]+)/.exec(res.headers.get('set-cookie') || '');
    if (m) cookie = `aurum_sid=${m[1]}`;
    const isJson = res.headers.get('content-type')?.includes('json');
    return { status: res.status, headers: res.headers, data: isJson ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b = {}) => call('POST', u, b),
    put: (u, b) => call('PUT', u, b, { 'content-type': 'application/octet-stream' }),
    del: (u) => call('DELETE', u),
  };
}

async function member(name, username) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.user = r.data.user;
  return c;
}

const MB = 1024 * 1024;
function fakeMp4(size) {
  const buf = crypto.randomBytes(size);
  buf.write('\0\0\0\x18ftypmp42', 0, 'latin1');
  return buf;
}
function openForm(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ mime: 'video/mp4', duration: '12', width: '1080', height: '1920', ...fields })) fd.append(k, String(v));
  return fd;
}

// Envoi classique (taille connue d'avance), puis publication
async function postVideo(c, body, size = 2000) {
  const buf = fakeMp4(size);
  const init = await c.post('/api/videos', openForm({ size: buf.length }));
  assert.equal(init.status, 201, JSON.stringify(init.data));
  for (let i = 0; i < init.data.chunks; i++) {
    assert.equal((await c.put(`/api/videos/${init.data.id}/chunks/${i}`, buf.subarray(i * MB, (i + 1) * MB))).status, 200);
  }
  const done = await c.post(`/api/videos/${init.data.id}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const posted = await c.post('/api/posts', { body, video: done.data.video.id });
  assert.equal(posted.status, 201, JSON.stringify(posted.data));
  return posted.data.post;
}

let alice;
let bob;

test('par défaut, une vidéo publiée reste en ligne bien après 24 h', async () => {
  assert.equal(ctx.config.videoTtlHours, 0);
  alice = await member('Alice Martin', 'alice');
  bob = await member('Bob Durand', 'bob');
  const post = await postVideo(alice, 'Souvenir de Capri', 2500);
  assert.equal(post.video.expiresAt, null);
  // Trois jours plus tard
  const old = Date.now() - 3 * 24 * 3600 * 1000;
  await ctx.db.run('UPDATE posts SET created_at = ? WHERE id = ?', old, post.id);
  await ctx.db.run('UPDATE videos SET created_at = ? WHERE id = (SELECT video_id FROM posts WHERE id = ?)', old, post.id);
  await require('../src/videos').purgeExpired(ctx, { force: true });
  assert.equal((await bob.get(`/api/posts/${post.id}`)).status, 200);
  assert.ok((await bob.get('/api/videos/feed')).data.posts.some((p) => p.id === post.id));
  assert.ok((await bob.get('/api/feed')).data.posts.some((p) => p.id === post.id));
  assert.ok((await bob.get('/api/users/alice/videos')).data.posts.some((p) => p.id === post.id));
  assert.ok((await bob.get('/api/users/alice/posts')).data.posts.some((p) => p.id === post.id));
  // Les morceaux restent servis, mis en cache par le réseau pour 30 jours au plus
  const part = await client().get(`${post.video.url.replace(/\.mp4$/, '')}/0.bin`);
  assert.equal(part.status, 200);
  const age = Number(/max-age=(\d+)/.exec(part.headers.get('cache-control'))[1]);
  assert.ok(age > 29 * 86400 && age <= 30 * 86400, String(age));
  // Lecture par plages : toujours possible
  const range = await client().get(post.video.url, { range: 'bytes=0-99' });
  assert.equal(range.status, 206);
});

test('une vidéo gardée disparaît quand son auteur la supprime', async () => {
  const post = await postVideo(alice, 'À effacer', 1500);
  assert.equal((await alice.del(`/api/posts/${post.id}`)).status, 200);
  assert.equal((await bob.get(`/api/posts/${post.id}`)).status, 404);
  assert.equal((await client().get(`${post.video.url.replace(/\.mp4$/, '')}/0.bin`)).status, 404);
});

test('les réglages publics annoncent des vidéos gardées', async () => {
  const pub = await client().get('/api/legal');
  assert.equal(pub.data.videoTtlHours, 0);
});

test('fiche technique d’une vidéo : enregistrée à la fin de l’envoi, lisible par la Direction seulement', async () => {
  // Le premier membre inscrit est la Direction
  const buf = fakeMp4(3000);
  const init = await alice.post('/api/videos', openForm({ size: buf.length }));
  assert.equal((await alice.put(`/api/videos/${init.data.id}/chunks/0`, buf)).status, 200);
  const meta = { methode: 'rapide', secondes: 4.2, controle: { ok: true, diffs: [1, 0, 1] }, appareil: 'iPhone' };
  assert.equal((await alice.post(`/api/videos/${init.data.id}/complete`, { meta })).status, 200);
  const list = await alice.get('/api/admin/videos');
  assert.equal(list.status, 200, JSON.stringify(list.data));
  const v = list.data.videos.find((x) => x.id === init.data.id);
  assert.deepEqual(v.meta, meta);
  assert.equal(v.complete, true);
  assert.match(v.url, /^\/media\/v\/[a-f0-9]{32}\.mp4$/);
  // Un membre ordinaire n'y a pas accès
  assert.equal((await bob.get('/api/admin/videos')).status, 403);
});

test('qualité d’origine : 250 Mo par vidéo par défaut, annoncés à l’application', async () => {
  assert.equal(ctx.config.videoMaxBytes, 250 * MB);
  const session = await alice.get('/api/session');
  assert.equal(session.data.config.videoMaxBytes, 250 * MB);
  // Une vidéo 4K d'une minute (~170 Mo) est acceptée ; au-delà de 250 Mo, refus clair
  const big = await alice.post('/api/videos', openForm({ size: 170 * MB, duration: '58', width: '2160', height: '3840' }));
  assert.equal(big.status, 201, JSON.stringify(big.data));
  assert.equal(big.data.chunks, 170);
  assert.equal((await alice.del(`/api/videos/${big.data.id}`)).status, 200);
  const tooBig = await alice.post('/api/videos', openForm({ size: 251 * MB }));
  assert.equal(tooBig.status, 413);
  assert.match(tooBig.data.error, /250 Mo maximum/);
});

test('envoi reprenable : morceaux renvoyés sans dommage, manque détecté puis complété', async () => {
  const buf = fakeMp4(3 * MB + 1234);
  const init = await alice.post('/api/videos', openForm({ size: buf.length }));
  assert.equal(init.data.chunks, 4);
  const put = (i) => alice.put(`/api/videos/${init.data.id}/chunks/${i}`, buf.subarray(i * MB, (i + 1) * MB));
  // Coupure après deux morceaux : la fin manque, l'envoi n'est pas terminé
  assert.equal((await put(0)).status, 200);
  assert.equal((await put(2)).status, 200);
  assert.equal((await alice.post(`/api/videos/${init.data.id}/complete`)).status, 409);
  // Reprise : le même morceau renvoyé ne gêne pas, puis les manquants
  assert.equal((await put(2)).status, 200);
  assert.equal((await put(1)).status, 200);
  assert.equal((await put(3)).status, 200);
  const done = await alice.post(`/api/videos/${init.data.id}/complete`, { meta: { methode: 'originale', reprises: 1 } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const posted = await alice.post('/api/posts', { body: 'Originale', video: done.data.video.id });
  assert.equal(posted.status, 201);
  // Octet pour octet : la vidéo publiée est exactement le fichier envoyé
  const base = posted.data.post.video.url.replace(/\.mp4$/, '');
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const r = await client().get(`${base}/${i}.bin`);
    assert.equal(r.status, 200);
    // Taille totale annoncée avec chaque morceau (lecture en ligne assemblée par le téléphone)
    assert.equal(r.headers.get('x-video-size'), String(buf.length));
    parts.push(r.data);
  }
  assert.ok(Buffer.concat(parts).equals(buf));
  const range = await client().get(posted.data.post.video.url, { range: `bytes=${3 * MB}-` });
  assert.equal(range.status, 206);
  assert.ok(range.data.equals(buf.subarray(3 * MB)));
});
