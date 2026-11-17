'use strict';
// Version 10 : entrée gratuite pour les Fondateurs puis payante, et filtre automatique
// des propos haineux, menaçants ou injurieux (publications, commentaires, messages).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');
const { screen } = require('../src/contentFilter');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v10-'));
let server;
let base;
let ctx;
const sent = [];
const mailer = {
  enabled: true,
  provider: 'test',
  from: 'AURUM <club@exemple.fr>',
  send: async (m) => {
    sent.push(m);
  },
  sendBatch: async (list) => {
    sent.push(...list);
    return list.length;
  },
};

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v10.db')}`, authToken: '' },
    paidEntry: false,
    founderLimit: 3, // trois places gratuites pour le test
    admissionDefault: 'invitation',
    bots: false,
    demoPayments: true,
    rateLimit: false,
    adminEmails: ['direction@aurum.test'],
    stripe: { secretKey: '', webhookSecret: '' },
  };
  const created = await createApp(cfg, { stripe: null, mailer });
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
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), patch: (u, b = {}) => call('PATCH', u, b), del: (u, b) => call('DELETE', u, b) };
}

async function signup(name, username, extra = {}) {
  const c = client();
  const r = await c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  c.user = r.data.user;
  return c;
}

let admin;
let codes;
const people = {};

test('les places de Fondateur sont gratuites', async () => {
  admin = await signup('La Direction', 'direction', { email: 'direction@aurum.test' });
  assert.equal(admin.user.isMember, true);
  assert.equal(admin.user.memberNumber, 1);
  let s = await admin.get('/api/session');
  assert.equal(s.data.config.paidEntry, false);
  assert.equal(s.data.config.foundersLeft, 2);
  codes = (await admin.get('/api/invitations')).data.invites.map((i) => i.code);
  for (const [i, name] of ['anne', 'bruno'].entries()) {
    people[name] = await signup(name, name, { invitation: codes[i] });
    assert.equal(people[name].user.isMember, true);
    assert.equal(people[name].user.founder, true);
  }
  s = await admin.get('/api/session');
  assert.equal(s.data.config.paidEntry, true, 'entrée payante une fois les places attribuées');
  assert.equal(s.data.config.foundersLeft, 0);
  const pub = await client().get('/api/public/stats');
  assert.equal(pub.data.paidEntry, true);
});

test('ensuite : invitation ou accord de la Direction, puis droit d’entrée', async () => {
  // Avec une invitation : ticket, mais pas encore membre
  const chloe = await signup('Chloé Martin', 'chloe', { invitation: codes[2] });
  assert.equal(chloe.user.isMember, false);
  assert.equal(chloe.user.admission.approved, true);
  assert.equal((await chloe.get('/api/feed')).status, 402);
  // Le parrain n'est prévenu qu'à l'entrée effective
  let notifs = (await admin.get('/api/notifications')).data.notifications;
  assert.ok(!notifs.some((n) => n.type === 'invite_accepted' && n.actor.username === 'chloe'));

  // Sans invitation : demande à la Direction ; payer est impossible avant son accord
  const david = await signup('David Roux', 'david');
  assert.equal(david.user.admission.requested, true);
  assert.equal(david.user.admission.approved, false);
  const refused = await david.post('/api/billing/demo', { waiver: true });
  assert.equal(refused.status, 403);
  assert.equal(refused.data.code, 'ADMISSION_REQUIRED');
  assert.equal((await david.post('/api/billing/checkout', { waiver: true })).status, 403);

  // La Direction accepte : ticket et courriel pour régler le droit d'entrée
  const list = (await admin.get('/api/admin/admissions')).data.admissions;
  const req = list.find((a) => a.username === 'david');
  const ok = await admin.post(`/api/admin/admissions/${req.id}/approve`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.member, false);
  const mail = [...sent].reverse().find((m) => m.to === 'david@aurum.test');
  assert.match(mail.subject, /admission est acceptée/);
  assert.match(mail.text, /9,99 €/);
  assert.equal((await david.get('/api/session')).data.user.admission.approved, true);
  assert.equal((await admin.get('/api/admin/overview')).data.totals.awaitingPayment, 2);

  // Une deuxième invitation ne se consomme pas sur un compte qui a déjà son ticket
  const extra = (await admin.post('/api/invitations')).data.invite.code;
  await david.post('/api/admission/redeem', { code: extra });
  assert.equal((await ctx.db.get('SELECT used_by FROM invitations WHERE code = ?', extra)).used_by, null);

  // Paiement : numéro attribué, carte non Fondateur, courriel de bienvenue, parrain prévenu
  const paid = await chloe.post('/api/billing/demo', { waiver: true });
  assert.equal(paid.status, 200, JSON.stringify(paid.data));
  assert.equal(paid.data.user.isMember, true);
  assert.equal(paid.data.user.memberNumber, 4);
  assert.equal(paid.data.user.founder, false);
  assert.ok(sent.some((m) => m.to === 'chloe@aurum.test' && /Bienvenue/.test(m.subject)));
  notifs = (await admin.get('/api/notifications')).data.notifications;
  assert.ok(notifs.some((n) => n.type === 'invite_accepted' && n.actor.username === 'chloe'));
  const d2 = await david.post('/api/billing/demo', { waiver: true });
  assert.equal(d2.data.user.memberNumber, 5);
  people.chloe = chloe;
  people.david = david;
});

test('entrée libre pendant la phase payante : ticket automatique, puis paiement', async () => {
  await admin.post('/api/admin/settings', { admission: 'open' });
  const eva = await signup('Eva Blanc', 'eva');
  assert.equal(eva.user.isMember, false);
  assert.equal(eva.user.admission.approved, true);
  assert.equal((await eva.post('/api/billing/checkout', { waiver: true })).data.demo, true);
  assert.equal((await eva.post('/api/billing/demo', { waiver: true })).data.user.memberNumber, 6);
  await admin.post('/api/admin/settings', { admission: 'invitation' });
});

test('filtre : insultes signalées, haine et menaces refusées, sans faux positifs', () => {
  const cases = [
    ['Quel beau conseil, merci', 'ok'],
    ['Un café con leche à Madrid', 'ok'],
    ['Il s’est attardé au bar', 'ok'],
    ['Une tapette à mouches', 'ok'],
    ['On part au Niger cet été', 'ok'],
    ['Tu vas mourir de rire', 'ok'],
    ['Le linge est sale, noir de poussière', 'ok'],
    ['Espèce de connard', 'flag'],
    ['C0NNNNARD !', 'flag'],
    ['c o n n a r d', 'flag'],
    ['tu es un c*nnard', 'flag'],
    ['fuck you', 'flag'],
    ['Je vais te tuer si tu manges mon dessert', 'flag'],
    ['send nudes', 'flag'],
    ['Sale arabe', 'block'],
    ['Mort aux juifs', 'block'],
    ['Je vais te buter', 'block'],
    ['Kill yourself', 'block'],
    ['Ma carte 4111 1111 1111 1111', 'block'],
  ];
  for (const [text, level] of cases) assert.equal(screen(text).level, level, text);
});

test('publications, commentaires et messages : masqués, signalés ou refusés', async () => {
  const { anne, bruno } = people;
  // Refusé : rien n'est enregistré
  const blocked = await anne.post('/api/posts', { body: 'Mort aux juifs' });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.data.code, 'CONTENT_BLOCKED');
  assert.match(blocked.data.error, /reformuler/);
  assert.equal((await ctx.db.get('SELECT COUNT(*) AS n FROM posts')).n, 0);
  const card = await anne.post('/api/conversations/bruno', { body: 'Voici ma carte : 4111 1111 1111 1111' });
  assert.equal(card.status, 422);
  assert.match(card.data.error, /carte bancaire/);

  // Insulte : publiée, masquée, transmise à la Direction
  const post = await anne.post('/api/posts', { body: 'Bruno, espèce de connard.' });
  assert.equal(post.status, 201);
  assert.deepEqual(post.data.post.flagged, ['Insulte']);
  const seen = (await bruno.get(`/api/posts/${post.data.post.id}`)).data.post;
  assert.deepEqual(seen.flagged, ['Insulte']);
  let reports = (await admin.get('/api/admin/reports')).data.reports;
  const auto = reports.find((r) => r.type === 'post' && r.target.id === post.data.post.id);
  assert.equal(auto.automatic, true);
  assert.equal(auto.reason, 'Filtre automatique');
  assert.equal(auto.details, 'Insulte');
  assert.equal((await admin.get('/api/admin/overview')).data.totals.autoReports, 1);

  // Corrigée par son autrice : l'avertissement et le signalement automatique disparaissent
  const fixed = await anne.patch(`/api/posts/${post.data.post.id}`, { body: 'Bruno, à samedi !' });
  assert.equal(fixed.data.post.flagged, null);
  reports = (await admin.get('/api/admin/reports')).data.reports;
  assert.ok(!reports.some((r) => r.type === 'post' && r.target?.id === post.data.post.id));

  const comment = await bruno.post(`/api/posts/${post.data.post.id}/comments`, { body: 'Ta gueule' });
  assert.equal(comment.status, 201);
  assert.deepEqual(comment.data.comment.flagged, ['Insulte']);

  // Message privé : masqué chez le destinataire, aperçu masqué dans la liste
  const msg = await bruno.post('/api/conversations/anne', { body: 'Pauvre conne' });
  assert.equal(msg.status, 201);
  assert.deepEqual(msg.data.message.flagged, ['Insulte']);
  const conv = (await anne.get('/api/conversations')).data.conversations.find((c) => c.user.username === 'bruno');
  assert.equal(conv.lastMessage.flagged, true);
  assert.doesNotMatch(conv.lastMessage.body, /conne/);
  const thread = (await anne.get('/api/conversations/bruno')).data.messages;
  assert.deepEqual(thread.at(-1).flagged, ['Insulte']);

  // Signalement d'un message : par son destinataire seulement
  const clean = await bruno.post('/api/conversations/anne', { body: 'Tu viens samedi ?' });
  assert.equal((await bruno.post('/api/reports', { type: 'message', id: clean.data.message.id, reason: 'harassment' })).status, 404);
  assert.equal((await anne.post('/api/reports', { type: 'message', id: clean.data.message.id, reason: 'harassment' })).status, 201);
  assert.equal((await anne.post('/api/reports', { type: 'message', id: clean.data.message.id, reason: 'auto' })).status, 400);
  reports = (await admin.get('/api/admin/reports')).data.reports;
  const dm = reports.find((r) => r.type === 'message' && r.target.id === msg.data.message.id);
  assert.equal(dm.target.to, 'anne');
  assert.equal(dm.target.link, null);
  // La Direction supprime le message
  assert.equal((await admin.post(`/api/admin/reports/${dm.id}/resolve`, { action: 'remove' })).status, 200);
  assert.equal(await ctx.db.get('SELECT id FROM messages WHERE id = ?', msg.data.message.id), undefined);
});

test('noms, profils, groupes et événements : ni haine ni insultes', async () => {
  const { anne } = people;
  assert.equal((await anne.patch('/api/me', { bio: 'Collectionneuse, et connasse assumée' })).status, 422);
  assert.equal((await anne.patch('/api/me', { bio: 'Collectionneuse de livres anciens' })).status, 200);
  assert.equal((await anne.post('/api/groups', { name: 'Sale juif' })).status, 422);
  const r = await client().post('/api/auth/signup', { displayName: 'Test', username: 'sale.arabe', email: 'x@aurum.test', password: 'motdepasse-solide' });
  assert.equal(r.status, 422);
});
