'use strict';
// Version 14 (lancement grand public) : « Suivre » sur les publications, erreurs remontées à la
// Direction, page Aide, progression « Bien démarrer », index du fil vidéo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v14-'));
let server;
let base;
let ctx;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v14.db')}`, authToken: '' },
    baseUrl: 'https://cercle.example',
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

function client(ua = UA) {
  let cookie = '';
  const call = async (method, url, body) => {
    const hd = { 'x-aurum': '1', 'user-agent': ua };
    if (cookie) hd.cookie = cookie;
    let payload;
    if (body !== undefined) {
      hd['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers: hd, body: payload });
    const m = /aurum_sid=([^;]+)/.exec(res.headers.get('set-cookie') || '');
    if (m) cookie = `aurum_sid=${m[1]}`;
    const isJson = res.headers.get('content-type')?.includes('json');
    return { status: res.status, data: isJson ? await res.json() : await res.text() };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), del: (u) => call('DELETE', u) };
}
async function member(name, username) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return c;
}

let admin;
let anna;
let hugo;
test('membres de départ', async () => {
  admin = await member('Victoire Delmas', 'victoire');
  anna = await member('Anna Weber', 'anna');
  hugo = await member('Hugo Lambert', 'hugo');
});

test('« Suivre » : chaque publication dit si l’on suit déjà son auteur', async () => {
  const { data } = await anna.post('/api/posts', { body: 'Bonjour le cercle' });
  const id = data.post.id;
  let p = (await hugo.get(`/api/posts/${id}`)).data.post;
  assert.equal(p.followsAuthor, false);
  assert.equal((await hugo.post('/api/users/anna/follow')).status, 200);
  p = (await hugo.get(`/api/posts/${id}`)).data.post;
  assert.equal(p.followsAuthor, true);
  const feed = (await hugo.get('/api/feed?scope=all')).data.posts;
  assert.equal(feed.find((x) => x.id === id).followsAuthor, true);
  // Sa propre publication : jamais de bouton « Suivre »
  assert.equal((await anna.get(`/api/posts/${id}`)).data.post.mine, true);
});

test('Bien démarrer : la progression compte aussi les invitations', async () => {
  const p = (await hugo.get('/api/me/progress')).data;
  assert.equal(p.following, 1);
  assert.equal(p.invites, 0);
});

test('Bien démarrer : « Suivre » s’adapte au nombre de membres (cercle encore petit)', async () => {
  // Trois membres : chacun peut en suivre deux autres, pas trois
  assert.equal((await hugo.get('/api/me/progress')).data.members, 2);
  // Un membre bloqué ne compte plus parmi ceux que l'on peut suivre
  assert.equal((await hugo.post('/api/users/victoire/block')).status, 200);
  assert.equal((await hugo.get('/api/me/progress')).data.members, 1);
  assert.equal((await admin.get('/api/me/progress')).data.members, 1);
  await hugo.del('/api/users/victoire/block');
  assert.equal((await hugo.get('/api/me/progress')).data.members, 2);
});

test('erreurs des visiteurs : enregistrées sans identité, lues par la Direction seule', async () => {
  const visiteur = client();
  assert.equal((await visiteur.post('/api/client-errors', { message: 'TypeError: x is undefined', stack: 'at render (app.js:1:2)', path: '/salon', version: 'abc' })).status, 204);
  await visiteur.post('/api/client-errors', { message: 'TypeError: x is undefined', path: '/salon' });
  await client('curl/8.0').post('/api/client-errors', { message: 'ignorée (robot)' });
  await visiteur.post('/api/client-errors', { message: '' });
  const r = await admin.get('/api/admin/errors');
  assert.equal(r.status, 200);
  assert.equal(r.data.count, 2);
  assert.equal(r.data.top[0].message, 'TypeError: x is undefined');
  assert.equal(r.data.top[0].n, 2);
  assert.match(r.data.top[0].device, /mobile · Safari/);
  assert.equal((await anna.get('/api/admin/errors')).status, 403);
  const cols = (await ctx.db.all('SELECT name FROM pragma_table_info(?)', 'client_errors')).map((c) => c.name);
  assert.ok(!cols.some((c) => /user|ip|email/.test(c)), 'aucune donnée personnelle');
});

test('page Aide : servie par le serveur et proposée aux moteurs de recherche', async () => {
  const page = await client().get('/aide');
  assert.equal(page.status, 200);
  assert.match(page.data, /<div id="app">/);
  assert.match((await client().get('/sitemap.xml')).data, /<loc>https:\/\/cercle\.example\/aide<\/loc>/);
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.match(v.rewrites[0].source, /\|aide\|/);
});

test('fil vidéo : servi par un index (rapide même avec beaucoup de publications)', async () => {
  const plan = await ctx.db.all('EXPLAIN QUERY PLAN SELECT id FROM posts p WHERE p.video_id IS NOT NULL ORDER BY p.id DESC LIMIT 8');
  assert.ok(plan.some((r) => /idx_posts_video/.test(r.detail)), JSON.stringify(plan));
  const plan2 = await ctx.db.all('EXPLAIN QUERY PLAN SELECT COUNT(*) FROM comments WHERE user_id = 1 AND created_at > 0');
  assert.ok(plan2.some((r) => /idx_comments_user/.test(r.detail)), JSON.stringify(plan2));
});
