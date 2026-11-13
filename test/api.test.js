'use strict';
// Tests d'intégration de l'API : serveur réel sur un port libre, base SQLite temporaire.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Stripe = require('stripe');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/app');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-test-'));
const WEBHOOK_SECRET = 'whsec_test_secret';
const mails = [];

// Stripe réel (signature des webhooks) avec des appels réseau simulés
const stripe = new Stripe('sk_test_dummy');
const createdSessions = [];
stripe.checkout.sessions.create = async (params) => {
  const s = { id: `cs_test_${createdSessions.length + 1}`, url: 'https://checkout.stripe.com/c/pay/test', params };
  createdSessions.push(s);
  return s;
};
stripe.checkout.sessions.retrieve = async (id) => {
  const s = createdSessions.find((x) => x.id === id);
  return { id, payment_status: 'paid', client_reference_id: s.params.client_reference_id, amount_total: 999, currency: 'eur' };
};

let server;
let base;
let ctx;

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    databasePath: path.join(tmp, 'test.db'),
    uploadsDir: path.join(tmp, 'uploads'),
    demoPayments: true,
    rateLimit: false,
    adminEmails: ['admin@aurum.test'],
    stripe: { secretKey: 'sk_test_dummy', webhookSecret: WEBHOOK_SECRET },
  };
  const created = createApp(cfg, { stripe, mailer: { send: async (m) => mails.push(m) } });
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

// Petit client HTTP avec cookie de session
function client() {
  let cookie = '';
  const call = async (method, url, body, { csrf = true, raw = false } = {}) => {
    const headers = {};
    if (csrf) headers['x-aurum'] = '1';
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /aurum_sid=([^;]*)/.exec(set);
      if (m) cookie = m[1] ? `aurum_sid=${m[1]}` : '';
    }
    if (raw) return res;
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
  return {
    get: (u, o) => call('GET', u, undefined, o),
    post: (u, b = {}, o) => call('POST', u, b, o),
    patch: (u, b = {}, o) => call('PATCH', u, b, o),
    del: (u, b, o) => call('DELETE', u, b, o),
  };
}

async function member(name, username, email = `${username}@aurum.test`) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email, password: 'motdepasse-solide' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const p = await c.post('/api/billing/demo', { waiver: true });
  assert.equal(p.status, 200, JSON.stringify(p.data));
  c.user = p.data.user;
  return c;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let alice;
let bob;

test('inscription : validations et unicité', async () => {
  const c = client();
  let r = await c.post('/api/auth/signup', { displayName: 'A', username: 'x', email: 'bad', password: '123' });
  assert.equal(r.status, 400);
  r = await c.post('/api/auth/signup', { displayName: 'Admin', username: 'admin', email: 'a@b.fr', password: 'motdepasse' });
  assert.equal(r.status, 409);
  r = await c.post('/api/auth/signup', { displayName: 'Alice Martin', username: 'alice', email: 'alice@aurum.test', password: 'motdepasse-solide' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.isMember, false);
  assert.equal(r.data.user.password_hash, undefined);
  const dup = await client().post('/api/auth/signup', { displayName: 'Alice 2', username: 'ALICE', email: 'x@aurum.test', password: 'motdepasse-solide' });
  assert.equal(dup.status, 409);
  alice = c;
});

test('protection CSRF : en-tête obligatoire pour écrire', async () => {
  const r = await client().post('/api/auth/login', { login: 'alice', password: 'x' }, { csrf: false });
  assert.equal(r.status, 403);
});

test("accès refusé tant que le droit d'entrée n'est pas réglé", async () => {
  const r = await alice.get('/api/feed');
  assert.equal(r.status, 402);
  assert.equal(r.data.code, 'PAYMENT_REQUIRED');
  const anon = await client().get('/api/feed');
  assert.equal(anon.status, 401);
});

test('paiement : renonciation obligatoire, numéro de membre unique et idempotent', async () => {
  let r = await alice.post('/api/billing/demo', {});
  assert.equal(r.status, 400);
  r = await alice.post('/api/billing/demo', { waiver: true });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.isMember, true);
  assert.equal(r.data.user.memberNumber, 1);
  assert.equal(r.data.user.founder, true);
  r = await alice.post('/api/billing/demo', { waiver: true });
  assert.equal(r.data.user.memberNumber, 1);
  alice.user = r.data.user;
  bob = await member('Bob Durand', 'bob.durand');
  assert.equal(bob.user.memberNumber, 2);
});

test('connexion par e-mail ou pseudo, mauvais mot de passe refusé', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/login', { login: 'alice', password: 'faux-mot-de-passe' })).status, 401);
  const r = await c.post('/api/auth/login', { login: 'ALICE@aurum.test', password: 'motdepasse-solide' });
  assert.equal(r.status, 200);
  assert.equal((await c.get('/api/session')).data.user.username, 'alice');
});

let postId;
test('publication avec image, rejet des faux fichiers image', async () => {
  const fd = new FormData();
  fd.append('body', 'Bonjour @bob.durand ! #lancement');
  fd.append('image', new Blob([PNG], { type: 'image/png' }), 'photo.png');
  const r = await alice.post('/api/posts', fd);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.match(r.data.post.image, /^\/uploads\/[a-f0-9]{32}\.png$/);
  postId = r.data.post.id;
  const img = await fetch(base + r.data.post.image);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  const bad = new FormData();
  bad.append('body', 'piège');
  bad.append('image', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
  assert.equal((await alice.post('/api/posts', bad)).status, 400);

  const empty = new FormData();
  empty.append('body', '   ');
  assert.equal((await alice.post('/api/posts', empty)).status, 400);
});

test('mention : notification envoyée au membre cité', async () => {
  const r = await bob.get('/api/notifications');
  assert.ok(r.data.notifications.some((n) => n.type === 'mention' && n.actor.username === 'alice'));
});

test("j'aime : compteur, notification puis retrait", async () => {
  let r = await bob.post(`/api/posts/${postId}/like`);
  assert.deepEqual(r.data, { liked: true, likeCount: 1 });
  r = await bob.post(`/api/posts/${postId}/like`);
  assert.equal(r.data.likeCount, 1);
  let n = await alice.get('/api/notifications');
  assert.equal(n.data.notifications.filter((x) => x.type === 'like').length, 1);
  r = await bob.del(`/api/posts/${postId}/like`);
  assert.deepEqual(r.data, { liked: false, likeCount: 0 });
  n = await alice.get('/api/notifications');
  assert.equal(n.data.notifications.filter((x) => x.type === 'like').length, 0);
});

test('commentaires : ajout, compteur, suppression réservée', async () => {
  const r = await bob.post(`/api/posts/${postId}/comments`, { body: 'Félicitations !' });
  assert.equal(r.status, 201);
  const post = await alice.get(`/api/posts/${postId}`);
  assert.equal(post.data.post.commentCount, 1);
  const carol = await member('Carol', 'carol');
  assert.equal((await carol.del(`/api/comments/${r.data.comment.id}`)).status, 403);
  assert.equal((await bob.del(`/api/comments/${r.data.comment.id}`)).status, 200);
});

test('abonnements et fil « mes abonnements »', async () => {
  let feed = await bob.get('/api/feed?scope=following');
  assert.equal(feed.data.posts.length, 0);
  assert.equal((await bob.post('/api/users/alice/follow')).status, 200);
  feed = await bob.get('/api/feed?scope=following');
  assert.equal(feed.data.posts.length, 1);
  const profile = await alice.get('/api/users/bob.durand');
  assert.equal(profile.data.user.followsYou, true);
  assert.equal(profile.data.user.stats.following, 1);
  assert.equal((await bob.post('/api/users/bob.durand/follow')).status, 400);
});

test('messagerie privée : envoi, non-lus, lecture', async () => {
  assert.equal((await alice.post('/api/conversations/bob.durand', { body: '' })).status, 400);
  const r = await alice.post('/api/conversations/bob.durand', { body: 'Dîner jeudi ?' });
  assert.equal(r.status, 201);
  assert.equal((await bob.get('/api/counters')).data.messages, 1);
  const convs = await bob.get('/api/conversations');
  assert.equal(convs.data.conversations[0].user.username, 'alice');
  assert.equal(convs.data.conversations[0].unread, 1);
  const thread = await bob.get('/api/conversations/alice');
  assert.equal(thread.data.messages.length, 1);
  assert.equal((await bob.get('/api/counters')).data.messages, 0);
});

test('recherche, suggestions et tendances', async () => {
  const s = await bob.get('/api/search?q=alic');
  assert.equal(s.data.users[0].username, 'alice');
  const tag = await bob.get(`/api/search?q=${encodeURIComponent('#lancement')}`);
  assert.equal(tag.data.posts.length, 1);
  const t = await bob.get('/api/trending');
  assert.deepEqual(t.data.tags[0], { tag: 'lancement', count: 1 });
  const sug = await bob.get('/api/suggestions');
  assert.ok(sug.data.users.every((u) => u.username !== 'bob.durand' && u.username !== 'alice'));
});

test('suppression de publication : propriétaire uniquement', async () => {
  assert.equal((await bob.del(`/api/posts/${postId}`)).status, 403);
  assert.equal((await alice.del(`/api/posts/${postId}`)).status, 200);
  assert.equal((await alice.get(`/api/posts/${postId}`)).status, 404);
});

test('profil : mise à jour et site web normalisé', async () => {
  const r = await alice.patch('/api/me', { bio: 'Collectionneuse', website: 'alice.fr', city: 'Paris' });
  assert.equal(r.data.user.website, 'https://alice.fr');
  assert.equal((await alice.patch('/api/me', { website: 'javascript:alert(1)' })).status, 400);
});

test('Stripe : session de paiement, retour vérifié et webhook signé', async () => {
  const c = client();
  await c.post('/api/auth/signup', { displayName: 'Dora', username: 'dora', email: 'dora@aurum.test', password: 'motdepasse-solide' });
  assert.equal((await c.post('/api/billing/checkout', {})).status, 400);
  const r = await c.post('/api/billing/checkout', { waiver: true });
  assert.equal(r.data.url, 'https://checkout.stripe.com/c/pay/test');
  const session = createdSessions.at(-1);
  assert.equal(session.params.line_items[0].price_data.unit_amount, 999);
  assert.equal(session.params.mode, 'payment');

  const ret = await c.get(`/api/billing/return?session_id=${session.id}`, { raw: true });
  assert.equal(ret.status, 302);
  assert.equal(ret.headers.get('location'), '/bienvenue');
  const me = (await c.get('/api/session')).data.user;
  assert.equal(me.isMember, true);

  // Webhook pour un autre membre
  const e = client();
  const signup = await e.post('/api/auth/signup', { displayName: 'Eve', username: 'eve', email: 'eve@aurum.test', password: 'motdepasse-solide' });
  const payload = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_webhook_1', payment_status: 'paid', client_reference_id: String(signup.data.user.id), amount_total: 999, currency: 'eur' } },
  });
  const bad = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, body: payload });
  assert.equal(bad.status, 400);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const ok = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  assert.equal(ok.status, 200);
  // Rejoué : aucun double numéro
  await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: payload });
  const eve = (await e.get('/api/session')).data.user;
  assert.equal(eve.isMember, true);
  assert.equal(ctx.db.get("SELECT COUNT(*) AS c FROM payments WHERE provider_ref = 'cs_webhook_1'").c, 1);
});

test('mot de passe oublié : lien unique, sessions révoquées', async () => {
  const old = client();
  await old.post('/api/auth/login', { login: 'bob.durand', password: 'motdepasse-solide' });
  const r = await client().post('/api/auth/forgot', { email: 'bob.durand@aurum.test' });
  assert.equal(r.status, 200);
  assert.equal((await client().post('/api/auth/forgot', { email: 'inconnu@aurum.test' })).status, 200);
  const token = /jeton=([\w-]+)/.exec(mails.at(-1).text)[1];
  const c = client();
  assert.equal((await c.post('/api/auth/reset', { token, password: 'nouveau-mot-de-passe' })).status, 200);
  assert.equal((await client().post('/api/auth/reset', { token, password: 'encore-un-autre' })).status, 400);
  assert.equal((await old.get('/api/feed')).status, 401);
  assert.equal((await client().post('/api/auth/login', { login: 'bob.durand', password: 'nouveau-mot-de-passe' })).status, 200);
});

test('administration réservée aux adresses autorisées', async () => {
  assert.equal((await alice.get('/api/admin/overview')).status, 403);
  const admin = await member('Direction', 'direction', 'admin@aurum.test');
  const r = await admin.get('/api/admin/overview');
  assert.equal(r.status, 200);
  assert.ok(r.data.totals.members >= 5);
  assert.equal(r.data.totals.revenue, 999 * 2); // deux paiements Stripe
});

test('export RGPD puis suppression du compte', async () => {
  const exp = await alice.get('/api/me/export');
  assert.equal(exp.data.profile.username, 'alice');
  assert.equal(exp.data.profile.password_hash, undefined);
  assert.equal((await alice.del('/api/me', { password: 'faux' })).status, 400);
  assert.equal((await alice.del('/api/me', { password: 'motdepasse-solide' })).status, 200);
  const viewer = client();
  await viewer.post('/api/auth/login', { login: 'bob.durand', password: 'nouveau-mot-de-passe' });
  assert.equal((await viewer.get('/api/users/alice')).status, 404);
  // Le numéro d'un membre parti n'est jamais réattribué
  const last = await member('Dernier', 'dernier');
  const gone = last.user.memberNumber;
  assert.equal((await last.del('/api/me', { password: 'motdepasse-solide' })).status, 200);
  const next = await member('Suivant', 'suivant');
  assert.equal(next.user.memberNumber, gone + 1);
});

test("pages de l'application et en-têtes de sécurité", async () => {
  for (const p of ['/', '/salon', '/@bob.durand', '/messages/bob.durand', '/cgv']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  }
  assert.equal((await fetch(`${base}/js/inexistant.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/inexistant`)).status, 404);
});
