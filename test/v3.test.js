'use strict';
// Version 3 : notifications push, amis, groupes privés.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v3-'));
const pushes = [];
let server;
let base;
let ctx;

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v3.db')}`, authToken: '' },
    paidEntry: false,
    demoPayments: false,
    rateLimit: false,
    adminEmails: [],
    stripe: { secretKey: '', webhookSecret: '' },
  };
  // Faux service d'envoi : enregistre les notifications ; l'appareil « expire » renvoie 410.
  const pushSender = async (sub, body) => {
    if (sub.endpoint.includes('expire')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
  };
  const created = await createApp(cfg, { stripe: null, mailer: { send: async () => {} }, pushSender });
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
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), patch: (u, b = {}) => call('PATCH', u, b), del: (u, b) => call('DELETE', u, b) };
}

async function member(name, username) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.user = r.data.user;
  return c;
}
const sub = (name) => ({ endpoint: `https://push.example.com/${name}`, keys: { p256dh: 'BPublicKeyDeTest1234567890', auth: 'authsecret12' } });

let owner;
let ana;
let ben;
let eve;

test('membres de test', async () => {
  owner = await member('Direction', 'direction');
  ana = await member('Ana Martin', 'ana');
  ben = await member('Ben Morel', 'ben');
  eve = await member('Ève Durand', 'eve');
});

test('push : clé publique, abonnement, notification à la réception d’un message', async () => {
  const key = await ben.get('/api/push/key');
  assert.match(key.data.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  // La même clé est renvoyée ensuite (conservée en base)
  assert.equal((await ana.get('/api/push/key')).data.publicKey, key.data.publicKey);

  assert.equal((await ben.post('/api/push/subscribe', { endpoint: 'http://pas-https', keys: {} })).status, 400);
  assert.equal((await ben.post('/api/push/subscribe', sub('ben-iphone'))).status, 201);
  assert.equal((await ben.post('/api/push/subscribe', sub('ben-expire'))).status, 201);
  assert.equal((await ben.get('/api/push/status')).data.devices, 2);

  await ana.post('/api/conversations/ben', { body: 'Dîner jeudi au Plaza ?' });
  const sent = pushes.filter((p) => p.endpoint.endsWith('ben-iphone'));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].payload, { title: 'Ana Martin', body: 'Dîner jeudi au Plaza ?', url: '/messages/ana', tag: `dm-${ana.user.id}` });
  // L'appareil expiré a été oublié
  assert.equal((await ben.get('/api/push/status')).data.devices, 1);

  const t = await ben.post('/api/push/test');
  assert.equal(t.data.delivered, 1);
  await ben.post('/api/push/unsubscribe', { endpoint: sub('ben-iphone').endpoint });
  assert.equal((await ben.get('/api/push/status')).data.devices, 0);
});

test('amis : demande, compteur, acceptation, abonnement mutuel, retrait', async () => {
  await ben.post('/api/push/subscribe', sub('ben-iphone'));
  pushes.length = 0;
  let r = await ana.post('/api/users/ben/friend');
  assert.equal(r.data.status, 'outgoing');
  assert.equal(pushes[0].payload.title, 'Nouvelle demande d’ami');
  assert.equal((await ben.get('/api/counters')).data.requests, 1);
  assert.equal((await ana.get('/api/users/ben')).data.user.friendStatus, 'outgoing');
  assert.equal((await ben.get('/api/users/ana')).data.user.friendStatus, 'incoming');
  const lists = (await ben.get('/api/friends')).data;
  assert.equal(lists.incoming[0].username, 'ana');

  r = await ben.post('/api/users/ana/friend'); // accepter
  assert.equal(r.data.status, 'friends');
  assert.equal((await ben.get('/api/counters')).data.requests, 0);
  const profile = (await ana.get('/api/users/ben')).data.user;
  assert.equal(profile.friendStatus, 'friends');
  assert.equal(profile.stats.friends, 1);
  assert.equal(profile.isFollowing, true, 'amis = abonnés l’un à l’autre');
  assert.ok((await ana.get('/api/notifications')).data.notifications.some((n) => n.type === 'friend_accept'));
  assert.deepEqual((await eve.get('/api/users/ana/friends')).data.users.map((u) => u.username), ['ben']);

  await ana.del('/api/users/ben/friend');
  assert.equal((await ana.get('/api/users/ben')).data.user.friendStatus, 'none');
  assert.equal((await ana.post('/api/users/ana/friend')).status, 400);
});

test('amis : impossible avec un membre bloqué, et le blocage efface la demande', async () => {
  await eve.post('/api/users/ana/friend');
  await ana.post('/api/users/eve/block');
  assert.equal((await ana.get('/api/counters')).data.requests, 0);
  assert.equal((await eve.post('/api/users/ana/friend')).status, 403);
  await ana.del('/api/users/eve/block');
});

let groupId;
let groupPostId;

test('groupes : création, annuaire, demande d’adhésion validée', async () => {
  const fd = new FormData();
  fd.append('name', 'Cercle des collectionneurs');
  fd.append('description', 'Montres, art et voitures anciennes.');
  const r = await ana.post('/api/groups', fd);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  groupId = r.data.group.id;
  assert.equal(r.data.group.role, 'owner');

  const dir = (await ben.get('/api/groups')).data;
  assert.equal(dir.discover[0].name, 'Cercle des collectionneurs');
  assert.equal(dir.mine.length, 0);

  // Les non-membres ne voient pas le contenu
  assert.equal((await ben.get(`/api/groups/${groupId}/posts`)).status, 403);
  assert.equal((await ben.get(`/api/groups/${groupId}/members`)).status, 403);

  assert.equal((await ben.post(`/api/groups/${groupId}/join`)).data.status, 'requested');
  assert.ok((await ana.get('/api/notifications')).data.notifications.some((n) => n.type === 'group_request' && n.group?.id === groupId));
  const members = (await ana.get(`/api/groups/${groupId}/members`)).data;
  assert.equal(members.requests[0].username, 'ben');
  assert.equal((await eve.post(`/api/groups/${groupId}/requests/${ben.user.id}/approve`)).status, 403);
  assert.equal((await ana.post(`/api/groups/${groupId}/requests/${ben.user.id}/approve`)).data.status, 'member');
  assert.equal((await ben.get(`/api/groups/${groupId}`)).data.group.status, 'member');
});

test('groupes : publications strictement réservées aux membres', async () => {
  const fd = new FormData();
  fd.append('body', 'Vente privée jeudi soir, @eve et @ben bienvenus #confidentiel');
  const r = await ben.post(`/api/groups/${groupId}/posts`, fd);
  assert.equal(r.status, 201);
  groupPostId = r.data.post.id;
  assert.equal(r.data.post.groupId, groupId);

  // Visible dans le groupe…
  assert.equal((await ana.get(`/api/groups/${groupId}/posts`)).data.posts.length, 1);
  // …mais jamais ailleurs
  for (const viewer of [ana, eve]) {
    assert.ok(!(await viewer.get('/api/feed')).data.posts.some((p) => p.id === groupPostId), 'fil');
    assert.ok(!(await viewer.get('/api/users/ben/posts')).data.posts.some((p) => p.id === groupPostId), 'profil');
    assert.equal((await viewer.get('/api/search?q=Vente')).data.posts.length, 0, 'recherche');
  }
  assert.ok(!(await eve.get('/api/trending')).data.tags.some((t) => t.tag === 'confidentiel'), 'tendances');
  assert.equal((await eve.get(`/api/posts/${groupPostId}`)).status, 404);
  assert.equal((await eve.post(`/api/posts/${groupPostId}/like`)).status, 404);
  assert.equal((await eve.get(`/api/posts/${groupPostId}/comments`)).status, 404);
  assert.equal((await eve.post(`/api/groups/${groupId}/posts`, new FormData())).status, 403);
  // Mention : seule une personne membre est prévenue
  assert.ok(!(await eve.get('/api/notifications')).data.notifications.some((n) => n.type === 'mention'));
  // Un membre peut réagir et commenter
  assert.equal((await ana.post(`/api/posts/${groupPostId}/like`, { reaction: 'fire' })).status, 200);
  assert.equal((await ana.post(`/api/posts/${groupPostId}/comments`, { body: 'J’y serai.' })).status, 201);
});

test('groupes : invitation acceptée, retrait, rôles, départ, suppression', async () => {
  pushes.length = 0;
  assert.equal((await ben.post(`/api/groups/${groupId}/invite`, { username: 'eve' })).data.status, 'invited');
  assert.equal((await ben.post(`/api/groups/${groupId}/invite`, { username: 'ana' })).status, 409);
  assert.equal((await eve.get('/api/groups')).data.invitations[0].id, groupId);
  assert.ok((await eve.get('/api/notifications')).data.notifications.some((n) => n.type === 'group_invite'));
  assert.equal((await eve.post(`/api/groups/${groupId}/join`)).data.status, 'member');
  assert.equal((await eve.get(`/api/posts/${groupPostId}`)).status, 200, 'devenue membre, elle voit la publication');

  assert.equal((await ben.post(`/api/groups/${groupId}/members/${ana.user.id}/role`, { role: 'admin' })).status, 403);
  assert.equal((await ana.post(`/api/groups/${groupId}/members/${ben.user.id}/role`, { role: 'admin' })).data.role, 'admin');
  assert.equal((await ben.post(`/api/groups/${groupId}/members/${ana.user.id}/remove`)).status, 400, 'le créateur ne peut pas être retiré');
  assert.equal((await ben.post(`/api/groups/${groupId}/members/${eve.user.id}/remove`)).status, 200);
  assert.equal((await eve.get(`/api/posts/${groupPostId}`)).status, 404);

  assert.equal((await ana.post(`/api/groups/${groupId}/leave`)).status, 400);
  assert.equal((await ben.post(`/api/groups/${groupId}/leave`)).status, 200);
  assert.equal((await ben.del(`/api/groups/${groupId}`)).status, 403);
  assert.equal((await ana.del(`/api/groups/${groupId}`)).status, 200);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS c FROM posts WHERE groupe_id = ?', groupId)).c, 0);
  assert.equal((await ana.get(`/api/groups/${groupId}`)).status, 404);
});

test('suppression de compte : groupes créés, amitiés et appareils effacés', async () => {
  const fd = new FormData();
  fd.append('name', 'Groupe éphémère');
  const g = (await eve.post('/api/groups', fd)).data.group;
  await eve.post('/api/push/subscribe', sub('eve-android'));
  await eve.post('/api/users/ben/friend');
  assert.equal((await eve.del('/api/me', { password: 'motdepasse-solide' })).status, 200);
  assert.equal((await ben.get(`/api/groups/${g.id}`)).status, 404);
  for (const [sql, label] of [
    ['SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?', 'appareils'],
    ['SELECT COUNT(*) AS c FROM friend_requests WHERE requester_id = ? OR addressee_id = ?', 'amitiés'],
    ['SELECT COUNT(*) AS c FROM groupe_members WHERE user_id = ?', 'groupes'],
  ]) {
    const params = sql.split('?').length - 1;
    assert.equal((await ctx.db.get(sql, ...Array(params).fill(eve.user.id))).c, 0, label);
  }
});
