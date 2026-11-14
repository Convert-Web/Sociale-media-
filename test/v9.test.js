'use strict';
// Version 9 : traduction automatique des contenus entre membres.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');
const { detectLang, chunks } = require('../src/translate');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v9-'));
let server;
let base;
let ctx;
const calls = [];
// Faux traducteur : préfixe la langue cible, et compte les appels
const translator = async (texts, to) => {
  calls.push(...texts);
  return texts.map((t) => ({ text: `[${to}] ${t}`, source: detectLang(t) }));
};

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v9.db')}`, authToken: '' },
    paidEntry: false,
    admissionDefault: 'open',
    bots: false,
    demoPayments: false,
    rateLimit: false,
    adminEmails: [],
    stripe: { secretKey: '', webhookSecret: '' },
  };
  const created = await createApp(cfg, { stripe: null, mailer: { send: async () => {} }, translator });
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




test('détection de la langue des contenus', () => {
  assert.equal(detectLang('Trois jours hors du temps à Gstaad, la neige et le silence.'), 'fr');
  assert.equal(detectLang('The view from the terrace is breathtaking at sunset.'), 'en');
  assert.equal(detectLang('Tres días fuera del tiempo en Gstaad, la nieve y el silencio.'), 'es');
  assert.equal(detectLang('Merci !'), null); // trop court pour être fiable
  assert.equal(detectLang('https://exemple.com @claire #art'), null);
  // Découpage des longs textes (500 caractères au plus par requête gratuite)
  const long = 'Une phrase assez longue pour le test. '.repeat(40);
  assert.ok(chunks(long).every((c) => c.length <= 450));
  assert.equal(chunks(long).join(''), long);
});

test('publications, commentaires et messages portent leur langue ; traduction gardée en mémoire', async () => {
  const anna = await member('Anna Weber', 'anna');
  const wissam = await member('Wissam Ait', 'wissam');
  await anna.post('/api/posts', { body: 'The view from the terrace is breathtaking at sunset.' });
  const feed = await wissam.get('/api/feed');
  const post = feed.data.posts[0];
  assert.equal(post.lang, 'en');
  await wissam.post(`/api/posts/${post.id}/comments`, { body: 'Magnifique, où se trouve cette terrasse exactement ?' });
  const comments = await anna.get(`/api/posts/${post.id}/comments`);
  assert.equal(comments.data.comments[0].lang, 'fr');
  await anna.post('/api/conversations/wissam', { body: 'Thank you so much, it is in Capri, near the Faraglioni.' });
  const thread = await wissam.get('/api/conversations/anna');
  assert.equal(thread.data.messages[0].lang, 'en');

  const t1 = await wissam.post('/api/translate', { texts: [post.body], to: 'fr' });
  assert.equal(t1.status, 200);
  assert.equal(t1.data.translations[0].text, `[fr] ${post.body}`);
  assert.equal(t1.data.translations[0].source, 'en');
  const t2 = await anna.post('/api/translate', { texts: [post.body], to: 'fr' });
  assert.equal(t2.data.translations[0].text, `[fr] ${post.body}`);
  assert.equal(calls.filter((c) => c === post.body).length, 1); // traduit une seule fois

  assert.equal((await wissam.post('/api/translate', { texts: [post.body], to: 'xx' })).status, 400);
  assert.equal((await wissam.post('/api/translate', { texts: [] , to: 'fr' })).status, 400);
  assert.equal((await wissam.post('/api/translate', { texts: ['a'.repeat(6000)], to: 'fr' })).status, 400);
  assert.equal((await client().post('/api/translate', { texts: ['Hello there my friend'], to: 'fr' })).status, 401);

  // Langue préférée du membre
  const pref = await anna.post('/api/me/lang', { lang: 'en' });
  assert.equal(pref.data.user.lang, 'en');
  assert.equal((await anna.post('/api/me/lang', { lang: 'klingon' })).status, 400);
});
