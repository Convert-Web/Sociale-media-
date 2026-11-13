'use strict';
// Fonctions de la version 2 : photos multiples, modification, enregistrements,
// stories, signalements, blocages, accueil guidé.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v2-'));
let server;
let base;
let ctx;

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v2.db')}`, authToken: '' },
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
  ctx.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const headers = { 'x-aurum': '1' };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload });
    const m = /aurum_sid=([^;]+)/.exec(res.headers.get('set-cookie') || '');
    if (m) cookie = `aurum_sid=${m[1]}`;
    return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b = {}) => call('POST', u, b),
    patch: (u, b = {}) => call('PATCH', u, b),
    del: (u, b) => call('DELETE', u, b),
  };
}

async function member(name, username) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.user = r.data.user;
  return c;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const photo = (name) => new Blob([PNG], { type: 'image/png' });

let admin;
let ana;
let ben;
let postId;

test('membres de test', async () => {
  admin = await member('Direction', 'direction');
  ana = await member('Ana Martin', 'ana');
  ben = await member('Ben Morel', 'ben');
  assert.equal(admin.user.isAdmin, true);
  assert.equal(ana.user.isAdmin, false);
});

test('publication à plusieurs photos, grille du profil', async () => {
  const fd = new FormData();
  fd.append('body', 'Week-end à Gstaad');
  for (let i = 0; i < 3; i++) fd.append('images', photo(), `p${i}.png`);
  const r = await ana.post('/api/posts', fd);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.post.images.length, 3);
  assert.equal(r.data.post.image, r.data.post.images[0]);
  postId = r.data.post.id;
  const grid = await ben.get('/api/users/ana/photos');
  assert.equal(grid.data.photos.length, 3);
  assert.ok(grid.data.photos.every((p) => p.postId === postId));

  const tooMany = new FormData();
  for (let i = 0; i < 7; i++) tooMany.append('images', photo(), `x${i}.png`);
  assert.equal((await ana.post('/api/posts', tooMany)).status, 400);
});

test('modifier une publication : auteur uniquement', async () => {
  assert.equal((await ben.patch(`/api/posts/${postId}`, { body: 'piraté' })).status, 403);
  const r = await ana.patch(`/api/posts/${postId}`, { body: 'Week-end à Gstaad, sous la neige' });
  assert.equal(r.status, 200);
  assert.equal(r.data.post.body, 'Week-end à Gstaad, sous la neige');
  assert.ok(r.data.post.editedAt);
});

test('enregistrer puis retirer une publication', async () => {
  await ben.post(`/api/posts/${postId}/save`);
  let saved = await ben.get('/api/saved');
  assert.equal(saved.data.posts.length, 1);
  assert.equal(saved.data.posts[0].saved, true);
  await ben.del(`/api/posts/${postId}/save`);
  saved = await ben.get('/api/saved');
  assert.equal(saved.data.posts.length, 0);
});

test('stories : publier, voir, statistiques, expiration, suppression', async () => {
  const fd = new FormData();
  fd.append('caption', 'Coucher de soleil');
  fd.append('image', photo(), 's.png');
  const r = await ana.post('/api/stories', fd);
  assert.equal(r.status, 201);
  const storyId = r.data.story.id;

  let list = await ben.get('/api/stories');
  const group = list.data.groups.find((g) => g.user.username === 'ana');
  assert.equal(group.stories.length, 1);
  assert.equal(group.allViewed, false);
  assert.equal(group.stories[0].views, undefined, 'le nombre de vues est réservé à l’auteur');

  await ben.post(`/api/stories/${storyId}/view`);
  list = await ben.get('/api/stories');
  assert.equal(list.data.groups.find((g) => g.user.username === 'ana').allViewed, true);

  assert.equal((await ben.get(`/api/stories/${storyId}/viewers`)).status, 403);
  const viewers = await ana.get(`/api/stories/${storyId}/viewers`);
  assert.deepEqual(viewers.data.users.map((u) => u.username), ['ben']);
  const mine = await ana.get('/api/stories');
  assert.equal(mine.data.groups[0].mine, true);
  assert.equal(mine.data.groups[0].stories[0].views, 1);

  assert.equal((await ben.del(`/api/stories/${storyId}`)).status, 403);
  assert.equal((await ana.del(`/api/stories/${storyId}`)).status, 200);

  // Une story expirée n'apparaît plus
  const fd2 = new FormData();
  fd2.append('image', photo(), 's2.png');
  const r2 = await ana.post('/api/stories', fd2);
  await ctx.db.run('UPDATE stories SET expires_at = ? WHERE id = ?', Date.now() - 1, r2.data.story.id);
  list = await ben.get('/api/stories');
  assert.equal(list.data.groups.length, 0);
  assert.equal((await ben.post(`/api/stories/${r2.data.story.id}/view`)).status, 404);
});

test('signaler une publication, traitement par la direction', async () => {
  assert.equal((await ben.post('/api/reports', { type: 'post', id: postId, reason: 'nimporte' })).status, 400);
  assert.equal((await ben.post('/api/reports', { type: 'post', id: postId, reason: 'spam' })).status, 201);
  await ben.post('/api/reports', { type: 'post', id: postId, reason: 'spam' }); // doublon ignoré
  assert.equal((await ben.get('/api/admin/reports')).status, 403);
  const list = await admin.get('/api/admin/reports');
  assert.equal(list.data.reports.length, 1);
  assert.equal(list.data.reports[0].reason, 'Spam ou publicité');
  assert.equal(list.data.reports[0].target.author, 'ana');
  const overview = await admin.get('/api/admin/overview');
  assert.equal(overview.data.totals.openReports, 1);

  const r = await admin.post(`/api/admin/reports/${list.data.reports[0].id}/resolve`, { action: 'remove' });
  assert.equal(r.status, 200);
  assert.equal((await ben.get(`/api/posts/${postId}`)).status, 404);
  assert.equal((await admin.get('/api/admin/reports')).data.reports.length, 0);
  const grid = await ben.get('/api/users/ana/photos');
  assert.equal(grid.data.photos.length, 0, 'les photos de la publication supprimée disparaissent');
});

test('bloquer : contenus masqués, messages et abonnement impossibles', async () => {
  const fd = new FormData();
  fd.append('body', 'Bonjour à tous');
  const post = (await ana.post('/api/posts', fd)).data.post;
  await ben.post('/api/users/ana/follow');
  await ben.post('/api/conversations/ana', { body: 'Salut Ana' });

  assert.equal((await ana.post('/api/users/ben/block')).status, 200);
  // Ben ne voit plus Ana
  assert.equal((await ben.get('/api/users/ana')).status, 404);
  assert.ok(!(await ben.get('/api/feed')).data.posts.some((p) => p.id === post.id));
  assert.equal((await ben.get(`/api/posts/${post.id}`)).status, 404);
  assert.equal((await ben.get('/api/search?q=ana')).data.users.length, 0);
  assert.equal((await ben.post('/api/conversations/ana', { body: 'Tu es là ?' })).status, 403);
  assert.equal((await ben.post('/api/users/ana/follow')).status, 404);
  assert.equal((await ben.get('/api/conversations')).data.conversations.length, 0);
  // L'abonnement a été supprimé
  const profile = await ana.get('/api/users/ben');
  assert.equal(profile.data.user.blocked, true);
  assert.equal(profile.data.user.followsYou, false);
  assert.equal((await ana.get('/api/me/blocked')).data.users[0].username, 'ben');

  // Débloquer rétablit l'accès
  await ana.del('/api/users/ben/block');
  assert.equal((await ben.get('/api/users/ana')).status, 200);
  assert.ok((await ben.get('/api/feed')).data.posts.some((p) => p.id === post.id));
});

test('accueil guidé : progression du nouveau membre', async () => {
  const fresh = await member('Nouvelle Venue', 'nouvelle');
  let p = (await fresh.get('/api/me/progress')).data;
  assert.deepEqual(p, { avatar: false, bio: false, following: 0, posts: 0 });
  await fresh.patch('/api/me', { bio: 'Galeriste à Paris' });
  await fresh.post('/api/users/ana/follow');
  p = (await fresh.get('/api/me/progress')).data;
  assert.equal(p.bio, true);
  assert.equal(p.following, 1);
});

test('suppression de compte : stories et données v2 nettoyées', async () => {
  const fd = new FormData();
  fd.append('image', photo(), 's.png');
  await ben.post('/api/stories', fd);
  await ben.post('/api/users/ana/block');
  assert.equal((await ben.del('/api/me', { password: 'motdepasse-solide' })).status, 200);
  for (const [table, col] of [['stories', 'user_id'], ['blocks', 'blocker_id'], ['bookmarks', 'user_id']]) {
    assert.equal((await ctx.db.get(`SELECT COUNT(*) AS c FROM ${table} WHERE ${col} = ?`, ben.user.id)).c, 0, table);
  }
});
