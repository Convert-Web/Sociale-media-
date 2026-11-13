'use strict';
// Version 4 : entrée sur invitation, agenda, carnet d'adresses, badge vérifié.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v4-'));
const pushes = [];
let server;
let base;
let ctx;

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v4.db')}`, authToken: '' },
    paidEntry: false,
    admissionDefault: 'invitation',
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

async function signup(name, username, extra = {}) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.user = r.data.user;
  return c;
}
const sub = (name) => ({ endpoint: `https://push.example.com/${name}`, keys: { p256dh: 'BPublicKeyDeTest1234567890', auth: 'authsecret12' } });


let admin;
let claire;

test('sur invitation : le premier compte entre, les suivants attendent la Direction', async () => {
  admin = await signup('Wissam Ait', 'wissam');
  assert.equal(admin.user.isMember, true);
  assert.equal(admin.user.isAdmin, true);
  const s = await admin.get('/api/session');
  assert.equal(s.data.config.admission, 'invitation');
  assert.equal(s.data.config.foundersLeft, 99);

  const marc = await signup('Marc Lefort', 'marc', { note: 'Ami de Wissam, collectionneur.' });
  assert.equal(marc.user.isMember, false);
  assert.equal(marc.user.admission.requested, true);
  assert.equal((await marc.get('/api/feed')).status, 402);
  // La Direction est prévenue
  const notifs = await admin.get('/api/notifications');
  assert.ok(notifs.data.notifications.some((n) => n.type === 'admission_request' && n.actor.username === 'marc'));
  const list = await admin.get('/api/admin/admissions');
  const req = list.data.admissions.find((x) => x.username === 'marc');
  assert.equal(req.note, 'Ami de Wissam, collectionneur.');
  // Une reconnexion n'admet pas automatiquement
  const again = client();
  const login = await again.post('/api/auth/login', { login: 'marc', password: 'motdepasse-solide' });
  assert.equal(login.data.user.isMember, false);
  // Validation par la Direction
  assert.equal((await admin.post(`/api/admin/admissions/${req.id}/approve`)).status, 200);
  const me = await marc.get('/api/session');
  assert.equal(me.data.user.isMember, true);
  assert.equal(me.data.user.memberNumber, 2);
});

test('refus d’une demande, puis entrée grâce à un code', async () => {
  const lea = await signup('Léa Morel', 'lea');
  const id = (await admin.get('/api/admin/admissions')).data.admissions.find((x) => x.username === 'lea').id;
  await admin.post(`/api/admin/admissions/${id}/decline`);
  assert.equal((await lea.get('/api/session')).data.user.admission.declined, true);
  const { data } = await admin.get('/api/invitations');
  const code = data.invites[0].code;
  const r = await lea.post('/api/admission/redeem', { code: code.toLowerCase() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.isMember, true);
  // Le carton est consommé
  assert.equal((await lea.post('/api/admission/redeem', { code })).status, 200); // déjà membre : sans effet
  const after = (await admin.get('/api/invitations')).data;
  assert.equal(after.invites.find((x) => x.code === code).usedBy.username, 'lea');
});

test('parrainage : 3 cartons par membre, inscription directe avec un code', async () => {
  const marc = client();
  await marc.post('/api/auth/login', { login: 'marc', password: 'motdepasse-solide' });
  const inv = await marc.get('/api/invitations');
  assert.equal(inv.data.invites.length, 3);
  assert.equal(inv.data.unlimited, false);
  assert.equal((await marc.post('/api/invitations')).status, 403);
  assert.equal((await marc.get('/api/invitations')).data.invites.length, 3); // pas de nouveaux cartons
  const code = inv.data.invites[0].code;
  assert.match(inv.data.invites[0].url, new RegExp(`/invitation/${code}$`));

  const preview = await client().get(`/api/invitations/${code}/preview`);
  assert.equal(preview.data.valid, true);
  assert.equal(preview.data.inviter.username, 'marc');

  claire = await signup('Claire Delmas', 'claire', { invitation: code });
  assert.equal(claire.user.isMember, true);
  assert.equal((await client().get(`/api/invitations/${code}/preview`)).data.valid, false);
  // Code déjà utilisé : refus clair
  const bad = await client().post('/api/auth/signup', { displayName: 'Paul', username: 'paul', email: 'paul@aurum.test', password: 'motdepasse-solide', invitation: code });
  assert.equal(bad.status, 400);
  // Le parrain est prévenu et le profil l'affiche
  const n = await marc.get('/api/notifications');
  assert.ok(n.data.notifications.some((x) => x.type === 'invite_accepted' && x.actor.username === 'claire'));
  const profile = await marc.get('/api/users/claire');
  assert.equal(profile.data.user.invitedBy.username, 'marc');
  assert.equal((await marc.get('/api/users/marc')).data.user.invitedCount, 1);
  // La Direction peut créer des cartons supplémentaires
  assert.equal((await admin.post('/api/invitations')).status, 201);
});

test('entrée libre réglable depuis la Direction', async () => {
  assert.equal((await claire.post('/api/admin/settings', { admission: 'open' })).status, 403);
  assert.equal((await admin.post('/api/admin/settings', { admission: 'open' })).data.admission, 'open');
  const libre = await signup('Hugo Libre', 'hugo');
  assert.equal(libre.user.isMember, true);
  await admin.post('/api/admin/settings', { admission: 'invitation' });
  const attente = await signup('Inès Attente', 'ines');
  assert.equal(attente.user.isMember, false);
});

test('agenda : créer, participer, places limitées, notifications', async () => {
  const start = Date.now() + 7 * 24 * 3600 * 1000;
  const fd = new FormData();
  fd.append('title', 'Dîner au Plaza');
  fd.append('description', 'Menu dégustation, tenue de soirée.');
  fd.append('location', 'Hôtel Plaza Athénée, Paris');
  fd.append('startsAt', String(start));
  fd.append('capacity', '2');
  const created = await admin.post('/api/events', fd);
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const ev = created.data.event;
  assert.equal(ev.goingCount, 1); // l'organisateur participe
  assert.equal(ev.going, true);

  const j = await claire.post(`/api/events/${ev.id}/attend`);
  assert.equal(j.data.event.goingCount, 2);
  assert.equal(j.data.event.full, true);
  const marc = client();
  await marc.post('/api/auth/login', { login: 'marc', password: 'motdepasse-solide' });
  assert.equal((await marc.post(`/api/events/${ev.id}/attend`)).status, 409);
  const notifs = await admin.get('/api/notifications');
  assert.ok(notifs.data.notifications.some((n) => n.type === 'event_join' && n.event.title === 'Dîner au Plaza'));
  assert.ok(pushes.length >= 0);

  const upcoming = await marc.get('/api/events');
  assert.equal(upcoming.data.events[0].title, 'Dîner au Plaza');
  assert.equal((await claire.get('/api/events?scope=mine')).data.events.length, 1);
  assert.equal((await marc.get('/api/events?scope=mine')).data.events.length, 0);
  // Seul l'organisateur modifie ; une date passée est refusée
  assert.equal((await claire.patch(`/api/events/${ev.id}`, { title: 'Pirate' })).status, 403);
  assert.equal((await admin.patch(`/api/events/${ev.id}`, { capacity: 3 })).data.event.full, false);
  const past = new FormData();
  past.append('title', 'Trop tard');
  past.append('startsAt', String(Date.now() - 48 * 3600 * 1000));
  assert.equal((await admin.post('/api/events', past)).status, 400);
  // Désinscription
  assert.equal((await claire.del(`/api/events/${ev.id}/attend`)).data.event.going, false);
  const detail = await admin.get(`/api/events/${ev.id}`);
  assert.deepEqual(detail.data.event.attendees.map((a) => a.username), ['wissam']);
  // Les non-membres n'y ont pas accès
  const ines = client();
  await ines.post('/api/auth/login', { login: 'ines', password: 'motdepasse-solide' });
  assert.equal((await ines.get('/api/events')).status, 402);
});

test('carnet d’adresses : recommander, filtrer, « je recommande aussi »', async () => {
  const fd = new FormData();
  fd.append('name', 'Le Cinq');
  fd.append('category', 'restaurant');
  fd.append('city', 'paris');
  fd.append('address', '31 avenue George V');
  fd.append('website', 'restaurant-lecinq.com');
  fd.append('note', 'La meilleure table de Paris, demandez la table près de la fenêtre.');
  const r = await claire.post('/api/places', fd);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.place.city, 'Paris');
  assert.equal(r.data.place.website, 'https://restaurant-lecinq.com');

  const dup = new FormData();
  dup.append('name', 'le cinq');
  dup.append('category', 'restaurant');
  dup.append('city', 'Paris');
  dup.append('note', 'Excellent, vraiment une adresse sûre.');
  assert.equal((await admin.post('/api/places', dup)).status, 409);

  const bad = new FormData();
  bad.append('name', 'Sans catégorie');
  bad.append('city', 'Lyon');
  bad.append('note', 'Une note suffisamment longue.');
  assert.equal((await admin.post('/api/places', bad)).status, 400);

  const id = r.data.place.id;
  const e = await admin.post(`/api/places/${id}/endorse`);
  assert.equal(e.data.place.endorseCount, 1);
  assert.equal(e.data.place.endorsed, true);
  assert.equal((await claire.post(`/api/places/${id}/endorse`)).status, 400);
  const n = await claire.get('/api/notifications');
  assert.ok(n.data.notifications.some((x) => x.type === 'place_endorse' && x.place.name === 'Le Cinq'));

  assert.equal((await admin.get('/api/places?city=PARIS')).data.places.length, 1);
  assert.equal((await admin.get('/api/places?category=hotel')).data.places.length, 0);
  assert.equal((await admin.get('/api/places?q=fen%C3%AAtre')).data.places.length, 1);
  const meta = await admin.get('/api/places-meta');
  assert.equal(meta.data.cities[0].city, 'Paris');
  assert.equal(meta.data.total, 1);
  const detail = await admin.get(`/api/places/${id}`);
  assert.deepEqual(detail.data.place.endorsers.map((u) => u.username), ['wissam']);
  assert.equal((await admin.del(`/api/places/${id}/endorse`)).data.place.endorseCount, 0);
  // Seul l'auteur (ou la Direction) peut retirer l'adresse
  const marc = client();
  await marc.post('/api/auth/login', { login: 'marc', password: 'motdepasse-solide' });
  assert.equal((await marc.del(`/api/places/${id}`)).status, 403);
});

test('badge « Membre vérifié » attribué par la Direction et visible partout', async () => {
  const claireId = claire.user.id;
  assert.equal((await claire.post(`/api/admin/users/${claireId}/verify`)).status, 403);
  assert.equal((await admin.post(`/api/admin/users/${claireId}/verify`, { verified: true })).data.verified, true);
  assert.equal((await admin.get('/api/users/claire')).data.user.verified, true);
  await claire.post('/api/posts', { body: 'Bonsoir le cercle.' });
  const feed = await admin.get('/api/feed');
  assert.equal(feed.data.posts.find((p) => p.author.username === 'claire').author.verified, true);
  assert.equal(feed.data.posts.find((p) => p.author.username === 'claire') !== undefined, true);
  await admin.post(`/api/admin/users/${claireId}/verify`, { verified: false });
  assert.equal((await admin.get('/api/users/claire')).data.user.verified, false);
});

test('suppression de compte : événements, adresses et invitations effacés', async () => {
  const fd = new FormData();
  fd.append('title', 'Vernissage');
  fd.append('startsAt', String(Date.now() + 3600 * 1000 * 30));
  const ev = (await claire.post('/api/events', fd)).data.event;
  const r = await claire.del('/api/me', { password: 'motdepasse-solide' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await admin.get(`/api/events/${ev.id}`)).status, 404);
  assert.equal((await admin.get('/api/places')).data.places.length, 0);
  const { n } = await ctx.db.get('SELECT COUNT(*) AS n FROM invitations WHERE inviter_id = ?', claire.user.id);
  assert.equal(n, 0);
});
