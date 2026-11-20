'use strict';
// Version 16 (Vidéos façon TikTok) : envoi pendant la préparation, « Pour toi » (nouveautés
// d'abord), « Abonnements », vues, J'aime et réponses sur les commentaires, vidéos du profil.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v16-'));
let server;
let base;
let ctx;

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v16.db')}`, authToken: '' },
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
let carol;

test('envoi pendant la préparation : morceaux dans le désordre, taille donnée à la fin, tout vérifié', async () => {
  alice = await member('Alice Martin', 'alice');
  bob = await member('Bob Durand', 'bob');
  carol = await member('Carol Petit', 'carol');
  const buf = fakeMp4(2.5 * MB);
  const init = await alice.post('/api/videos', openForm({ streaming: 1, estimate: 3 * MB }));
  assert.equal(init.status, 201, JSON.stringify(init.data));
  assert.equal(init.data.chunks, 0);
  const id = init.data.id;
  // Le deuxième et le dernier morceau arrivent avant le premier (envoi trois par trois)
  assert.equal((await alice.put(`/api/videos/${id}/chunks/1`, buf.subarray(MB, 2 * MB))).status, 200);
  assert.equal((await alice.put(`/api/videos/${id}/chunks/2`, buf.subarray(2 * MB))).status, 200);
  // Rien d'autre que la vidéo de l'auteur, et pas de morceau vide ni trop gros
  assert.equal((await bob.put(`/api/videos/${id}/chunks/0`, buf.subarray(0, MB))).status, 404);
  assert.equal((await alice.put(`/api/videos/${id}/chunks/3`, Buffer.alloc(0))).status, 400);
  // Il manque le premier morceau : refus
  assert.equal((await alice.post(`/api/videos/${id}/complete`, { size: buf.length })).status, 409);
  assert.equal((await alice.put(`/api/videos/${id}/chunks/0`, buf.subarray(0, MB))).status, 200);
  // Taille annoncée fausse : refus ; juste : acceptée
  assert.equal((await alice.post(`/api/videos/${id}/complete`, { size: buf.length + 1 })).status, 409);
  assert.equal((await alice.post(`/api/videos/${id}/complete`, { size: 500 })).status, 400);
  const done = await alice.post(`/api/videos/${id}/complete`, { size: buf.length });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal(done.data.video.size, buf.length);
  const row = await ctx.db.get('SELECT size, chunks, complete FROM videos WHERE id = ?', id);
  assert.deepEqual({ ...row }, { size: buf.length, chunks: 3, complete: 1 });
  // Publiée puis lue : les octets sont exactement ceux envoyés
  const posted = await alice.post('/api/posts', { body: 'En direct de Capri', video: id });
  assert.equal(posted.status, 201, JSON.stringify(posted.data));
  const anon = client();
  const tail = await anon.get(posted.data.post.video.url, { range: `bytes=${2 * MB}-` });
  assert.equal(tail.status, 206);
  assert.ok(tail.data.equals(buf.subarray(2 * MB)));
  const part = await anon.get(`${posted.data.post.video.url.replace(/\.mp4$/, '')}/1.bin`);
  assert.ok(part.data.equals(buf.subarray(MB, 2 * MB)));
});

test('envoi pendant la préparation : un morceau du milieu trop court est refusé à la fin', async () => {
  const init = await alice.post('/api/videos', openForm({ streaming: 1, estimate: 3 * MB }));
  const id = init.data.id;
  const buf = fakeMp4(2 * MB + 10);
  await alice.put(`/api/videos/${id}/chunks/0`, buf.subarray(0, MB));
  await alice.put(`/api/videos/${id}/chunks/1`, buf.subarray(MB, 2 * MB - 5)); // 5 octets perdus
  await alice.put(`/api/videos/${id}/chunks/2`, buf.subarray(2 * MB - 5));
  assert.equal((await alice.post(`/api/videos/${id}/complete`, { size: buf.length })).status, 409);
  // Une vidéo inachevée ne peut pas être publiée
  assert.equal((await alice.post('/api/posts', { body: 'Raté', video: id })).status, 400);
  assert.equal((await alice.del(`/api/videos/${id}`)).status, 200);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM video_chunks WHERE video_id = ?', id)).n, 0);
});

test('vues : une par membre, celles de l’auteur ne comptent pas, visibles dans le fil et le profil', async () => {
  const [first] = (await alice.get('/api/videos/feed')).data.posts;
  assert.equal(first.video.views, 0);
  assert.equal((await alice.post(`/api/posts/${first.id}/view`)).data.views, 0);
  assert.equal((await bob.post(`/api/posts/${first.id}/view`)).data.views, 1);
  assert.equal((await bob.post(`/api/posts/${first.id}/view`)).data.views, 1);
  assert.equal((await carol.post(`/api/posts/${first.id}/view`)).data.views, 2);
  const profile = await bob.get('/api/users/alice/videos');
  assert.equal(profile.status, 200);
  assert.equal(profile.data.posts.length, 1);
  assert.equal(profile.data.posts[0].video.views, 2);
  // Une publication sans vidéo : aucune vue enregistrée
  const text = await alice.post('/api/posts', { body: 'Simple texte' });
  await bob.post(`/api/posts/${text.data.post.id}/view`);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM video_views WHERE post_id = ?', text.data.post.id)).n, 0);
});

test('« Pour toi » : les vidéos pas encore vues d’abord, puis les autres, sans doublon', async () => {
  const firstId = (await bob.get('/api/users/alice/videos')).data.posts[0].id; // vidéo du premier test
  const ids = [];
  for (let i = 0; i < 9; i++) ids.push((await postVideo(alice, `Clip ${i}`)).id);
  const all = [firstId, ...ids]; // 10 vidéos au total
  // Bob a déjà vu la première vidéo (test précédent) ; il regarde aussi le clip 8 (le plus récent)
  await bob.post(`/api/posts/${ids[8]}/view`);
  const p1 = (await bob.get('/api/videos/feed')).data;
  assert.equal(p1.posts.length, 8);
  assert.equal(p1.hasMore, true);
  assert.ok(p1.cursor);
  assert.deepEqual(p1.posts.map((p) => p.id), ids.slice(0, 8).reverse()); // nouveautés, les plus récentes d'abord
  const p2 = (await bob.get(`/api/videos/feed?cursor=${p1.cursor}`)).data;
  assert.deepEqual(p2.posts.map((p) => p.id), [ids[8], all[0]]); // puis les vidéos déjà vues
  assert.equal(p2.hasMore, false);
  const seen = [...p1.posts, ...p2.posts].map((p) => p.id);
  assert.equal(new Set(seen).size, all.length);
  // Ses propres vidéos passent après les nouveautés des autres
  const own = await postVideo(bob, 'Ma vidéo');
  const p = (await bob.get('/api/videos/feed')).data.posts;
  assert.notEqual(p[0].id, own.id);
  // Ancienne application (?before=) : ordre chronologique, comme avant
  const legacy = (await bob.get(`/api/videos/feed?before=${own.id}`)).data.posts;
  assert.deepEqual(legacy.map((x) => x.id), [...all].reverse().slice(0, 8));
});

test('« Abonnements » : seulement les membres suivis (et soi-même)', async () => {
  const carolVideo = await postVideo(carol, 'Chez Carol');
  let feed = (await bob.get('/api/videos/feed?scope=following')).data.posts;
  assert.ok(feed.every((p) => p.author.username === 'bob'));
  assert.equal((await bob.post('/api/users/alice/follow')).status, 200);
  feed = (await bob.get('/api/videos/feed?scope=following')).data;
  assert.ok(feed.posts.some((p) => p.author.username === 'alice'));
  assert.ok(!feed.posts.some((p) => p.id === carolVideo.id));
  // Suite de la liste
  if (feed.hasMore) {
    const next = (await bob.get(`/api/videos/feed?scope=following&cursor=${feed.cursor}`)).data.posts;
    assert.ok(next.every((p) => p.id < feed.posts[feed.posts.length - 1].id));
  }
  // « Pour toi » montre tout le cercle
  const forYou = (await bob.get('/api/videos/feed')).data.posts;
  assert.ok(forYou.some((p) => p.id === carolVideo.id));
});

test('commentaires : réponses (un seul niveau), J’aime, notifications, suppression avec les réponses', async () => {
  const post = (await alice.get('/api/videos/feed')).data.posts[0];
  const top = (await bob.post(`/api/posts/${post.id}/comments`, { body: 'Superbe lumière' })).data.comment;
  assert.equal(top.parentId, null);
  assert.equal(top.likeCount, 0);
  const reply = await alice.post(`/api/posts/${post.id}/comments`, { body: '@bob merci !', parentId: top.id });
  assert.equal(reply.status, 201, JSON.stringify(reply.data));
  assert.equal(reply.data.comment.parentId, top.id);
  // Réponse à une réponse : rangée sous le commentaire de départ
  const deep = await carol.post(`/api/posts/${post.id}/comments`, { body: 'Tout à fait', parentId: reply.data.comment.id });
  assert.equal(deep.data.comment.parentId, top.id);
  // Commentaire d'une autre publication : refusé
  const other = (await alice.post('/api/posts', { body: 'Autre sujet' })).data.post;
  assert.equal((await bob.post(`/api/posts/${other.id}/comments`, { body: 'Hors sujet', parentId: top.id })).status, 404);

  // Bob est prévenu de la réponse d'Alice (en plus du commentaire)
  const notifs = (await bob.get('/api/notifications')).data.notifications;
  assert.ok(notifs.some((n) => n.type === 'reply' && n.actor.username === 'alice'));

  // J'aime : compté une fois, retiré, notification sans doublon
  assert.deepEqual((await alice.post(`/api/comments/${top.id}/like`)).data, { liked: true, likeCount: 1 });
  assert.deepEqual((await alice.post(`/api/comments/${top.id}/like`)).data, { liked: true, likeCount: 1 });
  assert.deepEqual((await carol.post(`/api/comments/${top.id}/like`)).data, { liked: true, likeCount: 2 });
  let list = (await alice.get(`/api/posts/${post.id}/comments`)).data.comments;
  const seen = list.find((c) => c.id === top.id);
  assert.equal(seen.likeCount, 2);
  assert.equal(seen.liked, true);
  assert.equal(list.find((c) => c.id === deep.data.comment.id).liked, false);
  const likes = (await bob.get('/api/notifications')).data.notifications.filter((n) => n.type === 'comment_like');
  assert.equal(likes.length, 2);
  assert.deepEqual((await alice.del(`/api/comments/${top.id}/like`)).data, { liked: false, likeCount: 1 });
  assert.equal((await bob.get('/api/notifications')).data.notifications.filter((n) => n.type === 'comment_like').length, 1);

  // Supprimer le commentaire de départ emporte ses réponses et leurs J'aime
  assert.equal((await bob.del(`/api/comments/${top.id}`)).status, 200);
  list = (await alice.get(`/api/posts/${post.id}/comments`)).data.comments;
  assert.equal(list.length, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM comment_likes')).n, 0);
});

test('publication supprimée : vues et J’aime des commentaires effacés aussi', async () => {
  const post = await postVideo(alice, 'Éphémère');
  await bob.post(`/api/posts/${post.id}/view`);
  const c = (await bob.post(`/api/posts/${post.id}/comments`, { body: 'Joli' })).data.comment;
  await alice.post(`/api/comments/${c.id}/like`);
  assert.equal((await alice.del(`/api/posts/${post.id}`)).status, 200);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM video_views WHERE post_id = ?', post.id)).n, 0);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', c.id)).n, 0);
});
