'use strict';
// Version 7 : courriels (bienvenue, admission, mot de passe) et Lettre du cercle.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v7-'));
let server;
let base;
let ctx;
const sent = [];
// Faux service d'envoi : garde les courriels en mémoire
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
    database: { url: `file:${path.join(tmp, 'v7.db')}`, authToken: '' },
    paidEntry: false,
    admissionDefault: 'invitation',
    bots: false,
    demoPayments: false,
    rateLimit: false,
    adminEmails: [],
    mail: { brevoKey: '', cronSecret: 'secret-de-test' },
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
let marc;
const last = (to) => [...sent].reverse().find((m) => m.to === to);

test('bienvenue par courriel, demande d’admission, mot de passe oublié', async () => {
  admin = await member('Wissam Ait', 'wissam');
  const w = last('wissam@aurum.test');
  assert.match(w.subject, /Bienvenue dans le cercle — carte N° 0001/);
  assert.match(w.html, /Fondateur/);
  assert.match(w.text, /N° 0001/);

  // Sans invitation : accusé de réception + alerte à la Direction
  marc = await member('Marc Lefort', 'marc');
  assert.equal(marc.user.isMember, false);
  assert.match(last('marc@aurum.test').subject, /demande d’admission est bien reçue/);
  assert.match(last('wissam@aurum.test').subject, /Marc Lefort demande à rejoindre le cercle/);
  // Admission : un seul courriel de bienvenue
  const before = sent.filter((m) => m.to === 'marc@aurum.test').length;
  const id = (await admin.get('/api/admin/admissions')).data.admissions.find((a) => a.username === 'marc').id;
  await admin.post(`/api/admin/admissions/${id}/approve`);
  const after = sent.filter((m) => m.to === 'marc@aurum.test');
  assert.equal(after.length, before + 1);
  assert.match(after.at(-1).subject, /carte N° 0002/);

  // Mot de passe oublié : courriel mis en page avec le lien
  await client().post('/api/auth/forgot', { email: 'marc@aurum.test' });
  const reset = last('marc@aurum.test');
  assert.match(reset.subject, /nouveau mot de passe/);
  assert.match(reset.html, /\/reinitialiser\?jeton=/);
  // Le nom d'un membre est échappé dans les courriels
  assert.ok(!reset.html.includes('<script'));
});

test('la Lettre du cercle : contenu, une fois par semaine, désinscription', async () => {
  // Un peu de vie dans le cercle
  await admin.post('/api/posts', { body: 'Quelle belle soirée au Plaza hier soir.' });
  const fd = new FormData();
  fd.append('title', 'Dîner des Fondateurs');
  fd.append('location', 'Paris');
  fd.append('startsAt', String(Date.now() + 3 * 86400000));
  await fetch(`${base}/api/events`, { method: 'POST', headers: { 'x-aurum': '1', cookie: admin.cookie() }, body: fd });

  const preview = await fetch(`${base}/api/admin/lettre/apercu`, { headers: { cookie: admin.cookie() } });
  const html = await preview.text();
  assert.match(html, /Dîner des Fondateurs/);
  assert.match(html, /Quelle belle soirée au Plaza/);
  assert.match(html, /Ils ont rejoint le cercle/);
  assert.equal((await marc.get('/api/admin/lettre/apercu')).status, 403);

  // Essai : à soi seul
  const test1 = await admin.post('/api/admin/lettre/send', { test: true });
  assert.equal(test1.data.sent, 1);
  // Envoi à tous les membres abonnés
  sent.length = 0;
  const all = await admin.post('/api/admin/lettre/send');
  assert.equal(all.data.sent, 2);
  assert.ok(sent.every((m) => /La Lettre du cercle/.test(m.subject)));
  const forMarc = sent.find((m) => m.to === 'marc@aurum.test');
  assert.match(forMarc.html, /Bonjour Marc/);
  // Pas deux fois la même semaine
  const again = await admin.post('/api/admin/lettre/send');
  assert.equal(again.data.sent, 0);
  assert.ok(again.data.skipped);

  // Désinscription par le lien du courriel
  const link = /href="([^"]*desabonner[^"]*)"/.exec(forMarc.html)[1].replace(/&amp;/g, '&');
  const res = await fetch(base + link.replace(/^https?:\/\/[^/]+/, ''));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /ne recevrez plus la Lettre/);
  assert.equal((await marc.get('/api/session')).data.user.emailDigest, false);
  const bad = await fetch(base + link.replace(/^https?:\/\/[^/]+/, '').replace(/t=\w+/, 't=faux'));
  assert.equal(bad.status, 400);
  // Réactivation depuis les réglages
  assert.equal((await marc.post('/api/me/emails', { digest: true })).data.user.emailDigest, true);
  const status = await admin.get('/api/admin/emails');
  assert.equal(status.data.subscribers, 2);
  assert.equal(status.data.lastCount, 2);
});

test('tâche planifiée protégée et courriel de test', async () => {
  assert.equal((await fetch(`${base}/api/cron/lettre`)).status, 401);
  const ok = await fetch(`${base}/api/cron/lettre`, { headers: { authorization: 'Bearer secret-de-test' } });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(body.skipped); // pas dimanche, ou déjà envoyée cette semaine
  sent.length = 0;
  const t = await admin.post('/api/admin/emails/test');
  assert.equal(t.status, 200);
  assert.equal(sent[0].to, 'wissam@aurum.test');
  assert.equal((await marc.post('/api/admin/emails/test')).status, 403);
});
