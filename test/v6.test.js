'use strict';
// Version 6 : comptes automatiques (AURUM, Le Concierge), clairement signalés.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v6-'));
let server;
let base;
let ctx;

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v6.db')}`, authToken: '' },
    paidEntry: false,
    admissionDefault: 'open',
    bots: true,
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
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload });
    const m = /aurum_sid=([^;]+)/.exec(res.headers.get('set-cookie') || '');
    if (m) cookie = `aurum_sid=${m[1]}`;
    return { status: res.status, data: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), del: (u, b) => call('DELETE', u, b), cookie: () => cookie };
}
async function member(name, username) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.user = r.data.user;
  return c;
}


let admin;
let claire;

test('bienvenue : annonce publique d’AURUM et message du Concierge', async () => {
  admin = await member('Wissam Ait', 'wissam');
  claire = await member('Claire Delmas', 'claire');
  const feed = await claire.get('/api/feed');
  const welcome = feed.data.posts.find((p) => p.author.username === 'aurum' && p.body.includes('@claire'));
  assert.ok(welcome, 'annonce de bienvenue');
  assert.equal(welcome.author.bot, true);
  assert.equal(welcome.author.memberNumber, null);
  assert.match(welcome.body, /N° 0002 et Fondateur/);
  // Mention : Claire est prévenue
  const n = await claire.get('/api/notifications');
  assert.ok(n.data.notifications.some((x) => x.type === 'mention' && x.actor.username === 'aurum'));
  // Message d'accueil du Concierge
  const convs = await claire.get('/api/conversations');
  const c = convs.data.conversations.find((x) => x.user.username === 'le.concierge');
  assert.ok(c, 'message du Concierge');
  const thread = await claire.get('/api/conversations/le.concierge');
  assert.equal(thread.data.automatic, true);
  assert.match(thread.data.messages[0].body, /Bonjour Claire/);
  // On ne peut ni lui répondre, ni l'ajouter en ami
  assert.equal((await claire.post('/api/conversations/le.concierge', { body: 'Merci !' })).status, 400);
  assert.equal((await claire.post('/api/users/aurum/friend')).status, 400);
});

test('ni membres, ni Fondateurs : exclus des effectifs et des suggestions', async () => {
  const stats = await client().get('/api/public/stats');
  assert.equal(stats.data.members, 2);
  assert.equal(stats.data.founderSpotsLeft, 98);
  const overview = await admin.get('/api/admin/overview');
  assert.equal(overview.data.totals.members, 2);
  assert.ok(overview.data.recentMembers.every((m) => !m.bot));
  const sugg = await admin.get('/api/suggestions');
  assert.ok(sugg.data.users.every((u) => !u.bot));
  const members = await admin.get('/api/members');
  assert.ok(members.data.users.every((u) => !['aurum', 'le.concierge'].includes(u.username)));
  const profile = await admin.get('/api/users/aurum');
  assert.equal(profile.data.user.bot, true);
  // Connexion impossible
  assert.equal((await client().post('/api/auth/login', { login: 'aurum', password: 'compte-automatique' })).status, 401);
  // Nom réservé
  assert.equal((await client().post('/api/auth/signup', { displayName: 'Faux', username: 'le.concierge', email: 'x@aurum.test', password: 'motdepasse-solide' })).status, 409);
});

test('tâches régulières : Journal, question du jour, adresse de la semaine', async () => {
  const now = Date.now();
  await ctx.db.run(
    `INSERT INTO journal_items (kind, title, summary, url, image, site_name, published_at, created_at)
     VALUES ('article', 'Les plus belles villas', 'Une sélection', 'https://exemple.com/villas', 'https://exemple.com/v.jpg', 'Revue', ?, ?)`,
    now - 3600000, now,
  );
  const fd = new FormData();
  fd.append('name', 'Le Cinq');
  fd.append('category', 'restaurant');
  fd.append('city', 'Paris');
  fd.append('note', 'La plus belle salle de Paris, service impeccable.');
  const place = await fetch(`${base}/api/places`, { method: 'POST', headers: { 'x-aurum': '1', cookie: claire.cookie() }, body: fd });
  assert.equal(place.status, 201);

  // Un membre déclenche la tâche (« force » est réservé à la Direction : selon l'heure, rien ou une partie part)
  const first = await claire.post('/api/bots/tick', { force: true });
  assert.equal(first.status, 200);
  const r = await admin.post('/api/bots/tick', { force: true });
  const posted = new Set([...first.data.posted, ...r.data.posted]);
  assert.deepEqual([...posted].sort(), ['adresse', 'journal', 'question']);
  const feed = (await claire.get('/api/feed')).data.posts;
  const j = feed.find((p) => p.journal);
  assert.equal(j.journal.title, 'Les plus belles villas');
  assert.equal(j.author.username, 'aurum');
  assert.ok(feed.some((p) => p.body.startsWith('La question du jour')));
  const adr = feed.find((p) => p.author.username === 'le.concierge');
  assert.match(adr.body, /L’adresse de la semaine : Le Cinq, Paris/);
  // Pas de doublon : le même contenu n'est pas republié
  const again = await admin.post('/api/bots/tick', { force: true });
  assert.ok(!again.data.posted.includes('journal'));
  assert.ok(!again.data.posted.includes('adresse'));
});

test('horaires réels : sans forcer, les publications partent aux bonnes heures', async () => {
  const { tick, parisHour } = require('../src/bots');
  // Heure de Paris correctement lue (et non « 13 h »)
  assert.equal(parisHour(Date.UTC(2026, 10, 14, 12, 30)), 13);
  assert.equal(parisHour(Date.UTC(2026, 6, 14, 22, 0)), 0);
  await ctx.db.run("UPDATE settings SET value = '0' WHERE key IN ('bots_journal_at', 'bots_lock')");
  await ctx.db.run("UPDATE settings SET value = '' WHERE key = 'bots_question_day'");
  await ctx.db.run(
    `INSERT INTO journal_items (kind, title, url, image, site_name, published_at, created_at) VALUES ('podcast', 'Épisode du jour', 'https://exemple.com/ep', 'https://exemple.com/e.jpg', 'Podcast', ?, ?)`,
    Date.now() - 3600000, Date.now(),
  );
  // 6 h à Paris : trop tôt, rien ne part
  const early = await tick(ctx, { now: Date.UTC(2026, 10, 15, 5, 0) });
  assert.deepEqual(early.posted, []);
  // 14 h à Paris : le Journal et la question du jour partent
  const noon = await tick(ctx, { now: Date.UTC(2026, 10, 15, 13, 0) });
  assert.ok(noon.posted.includes('journal'), JSON.stringify(noon));
  assert.ok(noon.posted.includes('question'), JSON.stringify(noon));
  // Une heure plus tard : rien de nouveau (Journal toutes les 4 h, une question par jour)
  const later = await tick(ctx, { now: Date.UTC(2026, 10, 15, 14, 0) });
  assert.deepEqual(later.posted, []);
});

test('annonce des nouveaux événements et interrupteur de la Direction', async () => {
  const fd = new FormData();
  fd.append('title', 'Dîner au Plaza');
  fd.append('location', 'Paris');
  fd.append('startsAt', String(Date.now() + 5 * 86400000));
  const ev = await fetch(`${base}/api/events`, { method: 'POST', headers: { 'x-aurum': '1', cookie: claire.cookie() }, body: fd });
  assert.equal(ev.status, 201);
  const feed = (await admin.get('/api/feed')).data.posts;
  assert.ok(feed.some((p) => p.author.username === 'aurum' && p.body.includes('« Dîner au Plaza »') && p.body.includes('@claire')));

  assert.equal((await claire.post('/api/admin/bots', { enabled: false })).status, 403);
  assert.equal((await admin.post('/api/admin/bots', { enabled: false })).data.enabled, false);
  assert.equal((await admin.get('/api/admin/overview')).data.config.bots, false);
  const marc = await member('Marc Lefort', 'marc');
  const convs = await marc.get('/api/conversations');
  assert.equal(convs.data.conversations.length, 0); // plus de message d'accueil
  assert.deepEqual((await admin.post('/api/bots/tick', { force: true })).data.posted, []);
  await admin.post('/api/admin/bots', { enabled: true });
});
