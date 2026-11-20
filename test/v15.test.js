'use strict';
// Version 15 (inspection complète en conditions réelles) : suggestions d'amis sans les amis ni les
// demandes en cours ; annonces automatiques retirées avec l'adresse ou l'événement qu'elles annonçaient.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v15-'));
let server;
let base;
let ctx;

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v15.db')}`, authToken: '' },
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

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const hd = { 'x-aurum': '1' };
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
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), del: (u, b) => call('DELETE', u, b) };
}
async function member(name, username) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return c;
}
// Une annonce comme celles d'AURUM ou du Concierge, qui se termine par le lien de la page annoncée
let botId;
async function announce(link) {
  if (!botId) {
    const r = await ctx.db.run("INSERT INTO users (username, email, password_hash, display_name, created_at, is_bot, paid_at) VALUES ('concierge', 'concierge@aurum.test', 'x', 'Le Concierge', ?, 1, ?)", Date.now(), Date.now());
    botId = Number(r.lastInsertRowid);
  }
  const r = await ctx.db.run('INSERT INTO posts (user_id, body, created_at) VALUES (?, ?, ?)', botId, `L’adresse de la semaine.\n${link}`, Date.now());
  return Number(r.lastInsertRowid);
}
const exists = async (postId) => Boolean(await ctx.db.get('SELECT id FROM posts WHERE id = ?', postId));

let admin;
let anna;
let hugo;
test('membres de départ', async () => {
  admin = await member('Victoire Delmas', 'victoire');
  anna = await member('Anna Weber', 'anna');
  hugo = await member('Hugo Lambert', 'hugo');
  await member('Zoé Martin', 'zoe');
});

test('Amis : « Vous connaissez peut-être » ne propose ni un ami, ni une demande en cours', async () => {
  const names = async (c, q = '') => (await c.get(`/api/suggestions?limit=10${q}`)).data.users.map((u) => u.username).sort();
  // Anna demande Hugo en ami : ni l'un ni l'autre ne se voit proposer l'autre sur la page Amis
  assert.equal((await anna.post('/api/users/hugo/friend')).status, 200);
  assert.ok(!(await names(hugo, '&exclude=friends')).includes('anna'));
  assert.ok(!(await names(anna, '&exclude=friends')).includes('hugo'));
  // Demande acceptée : toujours pas proposée
  assert.equal((await hugo.post('/api/users/anna/friend')).status, 200);
  assert.ok(!(await names(hugo, '&exclude=friends')).includes('anna'));
  // Les autres membres restent proposés
  assert.ok((await names(hugo, '&exclude=friends')).includes('zoe'));
  // Suggestions habituelles (abonnements) : inchangées — devenus amis, Hugo et Anna se suivent déjà
  assert.ok((await names(hugo)).includes('zoe'));
  assert.ok(!(await names(hugo)).includes('anna'));
});

test('Carnet : l’adresse retirée emporte son annonce automatique', async () => {
  const r = await anna.post('/api/places', { name: 'Le Comptoir des Halles', category: 'restaurant', city: 'Lyon', note: 'Les quenelles du jeudi, demander la table du fond.' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.place.id;
  const ann = await announce(`https://cercle.example/carnet/${id}`);
  const other = await announce(`https://cercle.example/carnet/${id}0`); // une autre adresse (id différent)
  assert.equal((await anna.del(`/api/places/${id}`)).status, 200);
  assert.equal(await exists(ann), false);
  assert.equal(await exists(other), true);
});

test('Agenda : l’événement annulé emporte son annonce automatique', async () => {
  const r = await admin.post('/api/events', { title: 'Dîner d’hiver', startsAt: Date.now() + 7 * 86400000, location: 'Megève' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.event.id;
  const ann = await announce(`Réservez votre place : https://cercle.example/agenda/${id}`);
  assert.equal((await admin.del(`/api/events/${id}`)).status, 200);
  assert.equal(await exists(ann), false);
});

test('Compte supprimé : les annonces de ses adresses et événements disparaissent aussi', async () => {
  const p = await hugo.post('/api/places', { name: 'Hôtel du Lac', category: 'hotel', city: 'Annecy', note: 'Demander une chambre côté lac, au dernier étage.' });
  const e = await hugo.post('/api/events', { title: 'Régates', startsAt: Date.now() + 9 * 86400000 });
  assert.equal(p.status, 201);
  assert.equal(e.status, 201);
  const a1 = await announce(`https://cercle.example/carnet/${p.data.place.id}`);
  const a2 = await announce(`https://cercle.example/agenda/${e.data.event.id}`);
  assert.equal((await hugo.del('/api/me', { password: 'motdepasse-solide' })).status, 200);
  assert.equal(await exists(a1), false);
  assert.equal(await exists(a2), false);
});
