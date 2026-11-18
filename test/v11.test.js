'use strict';
// Version 11 : privilèges des Fondateurs — avant-premières de la Direction et Agenda en avance.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v11-'));
let server;
let base;
let ctx;
const pushes = [];

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v11.db')}`, authToken: '' },
    paidEntry: false,
    founderLimit: 2, // la Direction (N°1) et Anne (N°2) sont Fondateurs
    admissionDefault: 'open',
    bots: false,
    demoPayments: true,
    rateLimit: false,
    adminEmails: ['direction@aurum.test'],
    stripe: { secretKey: '', webhookSecret: '' },
  };
  const created = await createApp(cfg, {
    stripe: null,
    mailer: { send: async () => {}, sendBatch: async (l) => l.length },
    pushSender: async (sub, payload) => pushes.push({ sub, payload: JSON.parse(payload) }),
  });
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
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), del: (u) => call('DELETE', u) };
}

async function member(name, username, email = `${username}@aurum.test`) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email, password: 'motdepasse-solide' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  if (!r.data.user.isMember) {
    const p = await c.post('/api/billing/demo', { waiver: true });
    assert.equal(p.status, 200, JSON.stringify(p.data));
    r.data.user = p.data.user;
  }
  c.user = r.data.user;
  return c;
}

let admin;
let anne;
let hugo;

test('les Fondateurs : carte, sans couronne à côté du nom', async () => {
  admin = await member('La Direction', 'direction', 'direction@aurum.test');
  anne = await member('Anne Leroy', 'anne');
  hugo = await member('Hugo Lambert', 'hugo'); // N°3 : membre, pas Fondateur
  assert.equal(anne.user.founder, true);
  assert.equal(hugo.user.founder, false);
  assert.equal(hugo.user.memberNumber, 3);
  // Notifications sur le téléphone d'Anne, pour vérifier l'alerte d'avant-première
  await anne.post('/api/push/subscribe', { endpoint: 'https://push.example.com/anne', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } });
});

test('avant-première de la Direction : Fondateurs d’abord, puis tout le monde', async () => {
  // Réservé à la Direction
  const fdHugo = new FormData();
  fdHugo.append('body', 'Une annonce');
  assert.equal((await hugo.post('/api/previews', fdHugo)).status, 403);

  const fd = new FormData();
  fd.append('body', 'Le dîner d’hiver aura lieu à Gstaad, le 12 janvier.');
  fd.append('hours', '24');
  const created = await admin.post('/api/previews', fd);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.hours, 24);

  // Anne (Fondatrice) la voit et a été prévenue ; Hugo non
  const seen = await anne.get('/api/previews');
  assert.equal(seen.data.founder, true);
  assert.equal(seen.data.previews.length, 1);
  assert.match(seen.data.previews[0].body, /Gstaad/);
  const hidden = await hugo.get('/api/previews');
  assert.equal(hidden.data.founder, false);
  assert.equal(hidden.data.previews.length, 0);
  assert.ok(!(await hugo.get('/api/feed')).data.posts.some((p) => /Gstaad/.test(p.body)));
  const subs = await ctx.db.all('SELECT id FROM push_subscriptions WHERE user_id = ?', anne.user.id);
  assert.equal(subs.length, 1);
  assert.ok(pushes.some((p) => p.sub.endpoint.endsWith('/anne') && p.payload.title === 'Avant-première Fondateurs'));
  assert.ok(!pushes.some((p) => p.sub.endpoint.endsWith('/hugo')));

  // Échéance passée : l'annonce est publiée pour tous, en tête du fil
  await ctx.db.run('UPDATE previews SET release_at = ?', Date.now() - 1000);
  const feed = (await hugo.get('/api/feed')).data.posts;
  assert.match(feed[0].body, /Gstaad/);
  assert.equal(feed[0].preview, true);
  assert.equal(feed[0].author.username, 'direction');
  // Publiée une seule fois, et plus dans les avant-premières
  await anne.get('/api/feed');
  assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM posts WHERE body LIKE '%Gstaad%'")).n, 1);
  assert.equal((await anne.get('/api/previews')).data.previews.length, 0);

  // Retirer une avant-première avant sa publication
  const fd2 = new FormData();
  fd2.append('body', 'Annonce retirée');
  const second = await admin.post('/api/previews', fd2);
  assert.equal((await hugo.del(`/api/previews/${second.data.preview.id}`)).status, 403);
  assert.equal((await admin.del(`/api/previews/${second.data.preview.id}`)).status, 200);
  assert.equal((await anne.get('/api/previews')).data.previews.length, 0);
});

test('Agenda : événement de la Direction ouvert d’abord aux Fondateurs', async () => {
  const fd = new FormData();
  fd.append('title', 'Dîner des Fondateurs');
  fd.append('startsAt', String(Date.now() + 10 * 86400000));
  fd.append('capacity', '12');
  fd.append('early', '1');
  const created = await admin.post('/api/events', fd);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.event.id;
  assert.ok(created.data.event.earlyUntil > Date.now() + 47 * 3600000);

  // Anne le voit et s'inscrit ; Hugo ne le voit pas encore
  assert.ok((await anne.get('/api/events')).data.events.some((e) => e.id === id && e.earlyUntil));
  assert.equal((await anne.post(`/api/events/${id}/attend`)).status, 200);
  assert.ok(!(await hugo.get('/api/events')).data.events.some((e) => e.id === id));
  assert.equal((await hugo.get(`/api/events/${id}`)).status, 404);
  assert.equal((await hugo.post(`/api/events/${id}/attend`)).status, 404);

  // Un membre ne peut pas créer d'avant-première : son événement est ouvert à tous
  const fdHugo = new FormData();
  fdHugo.append('title', 'Vernissage');
  fdHugo.append('startsAt', String(Date.now() + 5 * 86400000));
  fdHugo.append('early', '1');
  const own = await hugo.post('/api/events', fdHugo);
  assert.equal(own.data.event.earlyUntil, null);

  // Fin de l'avant-première : ouvert à tous
  await ctx.db.run('UPDATE events SET early_until = ? WHERE id = ?', Date.now() - 1000, id);
  const list = (await hugo.get('/api/events')).data.events;
  const ev = list.find((e) => e.id === id);
  assert.ok(ev);
  assert.equal(ev.earlyUntil, null);
  assert.equal(ev.goingCount, 2);
  assert.equal((await hugo.post(`/api/events/${id}/attend`)).status, 200);
  assert.equal((await ctx.db.get('SELECT announce_pending FROM events WHERE id = ?', id)).announce_pending, 0);
});
