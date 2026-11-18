'use strict';
// Version 12 : vidéos — envoi en morceaux, diffusion par plages, publication, suppression.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v12-'));
let server;
let base;
let ctx;

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v12.db')}`, authToken: '' },
    paidEntry: false,
    admissionDefault: 'open',
    bots: false,
    rateLimit: false,
    adminEmails: [],
    videoStorageBytes: 8 * 1024 * 1024, // 8 Mo pour vérifier le plafond
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

// Faux fichier MP4 : signature « ftyp » puis octets aléatoires
function fakeMp4(size) {
  const buf = crypto.randomBytes(size);
  buf.write('\0\0\0\x18ftypmp42', 0, 'latin1');
  return buf;
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function send(c, buf, { duration = 12, mime = 'video/mp4' } = {}) {
  const fd = new FormData();
  fd.append('mime', mime);
  fd.append('size', String(buf.length));
  fd.append('duration', String(duration));
  fd.append('width', '1080');
  fd.append('height', '1920');
  fd.append('poster', new Blob([PNG], { type: 'image/png' }), 'apercu.png');
  const init = await c.post('/api/videos', fd);
  if (init.status !== 201) return init;
  for (let i = 0; i < init.data.chunks; i++) {
    const part = buf.subarray(i * init.data.chunkSize, (i + 1) * init.data.chunkSize);
    const r = await c.put(`/api/videos/${init.data.id}/chunks/${i}`, part);
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  return c.post(`/api/videos/${init.data.id}/complete`);
}

let alice;
let bob;
let video;
let bytes;

test('envoi en morceaux de 1 Mo, puis publication dans le Salon', async () => {
  alice = await member('Alice Martin', 'alice');
  bob = await member('Bob Durand', 'bob');
  bytes = fakeMp4(2.5 * 1024 * 1024);
  const done = await send(alice, bytes);
  assert.equal(done.status, 200, JSON.stringify(done.data));
  video = done.data.video;
  assert.match(video.url, /^\/media\/v\/[a-f0-9]{32}\.mp4$/);
  assert.match(video.poster, /^\/media\/[a-f0-9]{32}\.png$/);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM video_chunks WHERE video_id = ?', video.id)).n, 3);

  // Une vidéo n'est jointe que par son auteur, et une seule fois
  assert.equal((await bob.post('/api/posts', { body: 'Pas à moi', video: video.id })).status, 400);
  const posted = await alice.post('/api/posts', { body: 'Coucher de soleil à Capri', video: video.id });
  assert.equal(posted.status, 201, JSON.stringify(posted.data));
  assert.equal(posted.data.post.video.url, video.url);
  assert.equal(posted.data.post.video.width, 1080);
  assert.deepEqual(posted.data.post.images, []);
  assert.equal(posted.data.post.image, video.poster);
  assert.equal((await alice.post('/api/posts', { body: 'Encore', video: video.id })).status, 400);
  const feed = (await bob.get('/api/feed')).data.posts;
  assert.equal(feed[0].video.url, video.url);
  const reels = (await bob.get('/api/videos/feed')).data.posts;
  assert.equal(reels.length, 1);
  video.postId = posted.data.post.id;
});

test('diffusion par plages : début, milieu, fin, jamais plus de 3 Mo', async () => {
  const anon = client();
  // Safari commence par demander deux octets
  let r = await anon.get(video.url, { range: 'bytes=0-1' });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), `bytes 0-1/${bytes.length}`);
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  assert.deepEqual(r.data, bytes.subarray(0, 2));
  // À cheval sur deux morceaux
  const s = 1024 * 1024 - 10;
  r = await anon.get(video.url, { range: `bytes=${s}-${s + 99}` });
  assert.deepEqual(r.data, bytes.subarray(s, s + 100));
  // « Jusqu'à la fin » : réponse plafonnée, le lecteur demande la suite
  r = await anon.get(video.url, { range: 'bytes=0-' });
  assert.equal(r.status, 206);
  assert.equal(r.data.length, bytes.length); // 2,5 Mo < 3 Mo
  assert.deepEqual(r.data, bytes);
  r = await anon.get(video.url, { range: 'bytes=-100' });
  assert.deepEqual(r.data, bytes.subarray(bytes.length - 100));
  r = await anon.get(video.url, { range: `bytes=${bytes.length + 5}-` });
  assert.equal(r.status, 416);
  // Sans plage : fichier entier
  r = await anon.get(video.url);
  assert.equal(r.status, 200);
  assert.equal(r.data.length, bytes.length);
});

test('limites : durée, taille, format, signature, plafond d’espace', async () => {
  const fd = (fields) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };
  assert.equal((await alice.post('/api/videos', fd({ mime: 'video/mp4', size: '5000', duration: '95' }))).status, 400);
  assert.equal((await alice.post('/api/videos', fd({ mime: 'video/mp4', size: String(41 * 1024 * 1024), duration: '20' }))).status, 413);
  assert.equal((await alice.post('/api/videos', fd({ mime: 'video/avi', size: '5000', duration: '20' }))).status, 400);
  // Un fichier qui n'est pas une vidéo est refusé dès le premier morceau
  const init = await alice.post('/api/videos', fd({ mime: 'video/mp4', size: '5000', duration: '3' }));
  assert.equal((await alice.put(`/api/videos/${init.data.id}/chunks/0`, crypto.randomBytes(5000))).status, 400);
  assert.equal((await alice.post(`/api/videos/${init.data.id}/complete`)).status, 409);
  // Plafond de 8 Mo dans ce test : 2,5 Mo déjà utilisés
  const big = await send(bob, fakeMp4(6 * 1024 * 1024));
  assert.equal(big.status, 409);
  assert.match(big.data.error, /espace vidéo/);
});

test('supprimer la publication supprime la vidéo et son aperçu', async () => {
  assert.equal((await alice.del(`/api/posts/${video.postId}`)).status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await ctx.db.get('SELECT id FROM videos WHERE id = ?', video.id), undefined);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM video_chunks WHERE video_id = ?', video.id)).n, 0);
  assert.equal((await client().get(video.url, { range: 'bytes=0-1' })).status, 404);
});

test('vidéo éphémère : invisible puis effacée après 24 h', async () => {
  const done = await send(alice, fakeMp4(300 * 1024), { duration: 6 });
  const posted = await alice.post('/api/posts', { body: 'Éphémère', video: done.data.video.id });
  const { post } = posted.data;
  assert.ok(Math.abs(post.video.expiresAt - (post.createdAt + 24 * 3600 * 1000)) < 2000);
  assert.equal((await client().get(post.video.url, { range: 'bytes=0-1' })).status, 206);
  // 25 heures plus tard
  await ctx.db.run('UPDATE posts SET created_at = ? WHERE id = ?', Date.now() - 25 * 3600 * 1000, post.id);
  assert.equal((await client().get(post.video.url, { range: 'bytes=0-1' })).status, 404);
  assert.ok(!(await bob.get('/api/feed')).data.posts.some((p) => p.id === post.id));
  assert.ok(!(await bob.get('/api/videos/feed')).data.posts.some((p) => p.id === post.id));
  assert.ok(!(await bob.get('/api/users/alice/posts')).data.posts.some((p) => p.id === post.id));
  assert.equal((await bob.get(`/api/posts/${post.id}`)).status, 404);
  // Le ménage efface tout : publication, morceaux, fiche
  await require('../src/videos').purgeExpired(ctx, { force: true });
  assert.equal(await ctx.db.get('SELECT id FROM posts WHERE id = ?', post.id), undefined);
  assert.equal(await ctx.db.get('SELECT id FROM videos WHERE id = ?', done.data.video.id), undefined);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM video_chunks WHERE video_id = ?', done.data.video.id)).n, 0);
});
