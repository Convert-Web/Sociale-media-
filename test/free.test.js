'use strict';
// Mode par défaut : inscription gratuite, accès immédiat.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/db');
const { hashPassword } = require('../src/security');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-free-'));
let server;
let base;
let ctx;

before(async () => {
  const dbPath = path.join(tmp, 'free.db');
  // Un compte créé du temps où l'entrée était payante, jamais réglé
  const pre = openDatabase(dbPath);
  pre.run(
    'INSERT INTO users (username, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
    'ancien', 'ancien@aurum.test', await hashPassword('motdepasse-solide'), 'Ancien Inscrit', Date.now(),
  );
  pre.close();

  const cfg = {
    ...config,
    dataDir: tmp,
    databasePath: dbPath,
    uploadsDir: path.join(tmp, 'uploads'),
    paidEntry: false,
    demoPayments: false,
    rateLimit: false,
    adminEmails: [],
    stripe: { secretKey: '', webhookSecret: '' },
  };
  const created = createApp(cfg, { stripe: null, mailer: { send: async () => {} } });
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

async function call(method, url, body, cookie) {
  const headers = { 'x-aurum': '1' };
  if (cookie) headers.cookie = cookie;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  const sid = set && /aurum_sid=([^;]+)/.exec(set);
  return { status: res.status, data: await res.json(), cookie: sid ? `aurum_sid=${sid[1]}` : cookie };
}

test('la configuration publique annonce une entrée gratuite', async () => {
  const r = await call('GET', '/api/session');
  assert.equal(r.data.config.paidEntry, false);
});

test('inscription : accès immédiat, numéro attribué, premier compte administrateur', async () => {
  const r = await call('POST', '/api/auth/signup', { displayName: 'Wissam', username: 'wissam', email: 'w@aurum.test', password: 'motdepasse-solide' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.isMember, true);
  assert.equal(r.data.user.memberNumber, 1);
  assert.equal(r.data.user.isAdmin, true);
  const feed = await call('GET', '/api/feed', null, r.cookie);
  assert.equal(feed.status, 200);
  assert.equal(ctx.db.get('SELECT COUNT(*) AS c FROM payments').c, 0);

  const second = await call('POST', '/api/auth/signup', { displayName: 'Second', username: 'second', email: 's@aurum.test', password: 'motdepasse-solide' });
  assert.equal(second.data.user.memberNumber, 2);
  assert.equal(second.data.user.isAdmin, false);
});

test('un compte créé sous le régime payant est admis à sa connexion', async () => {
  const r = await call('POST', '/api/auth/login', { login: 'ancien', password: 'motdepasse-solide' });
  assert.equal(r.status, 200);
  const feed = await call('GET', '/api/feed', null, r.cookie);
  assert.equal(feed.status, 200);
  const me = await call('GET', '/api/session', null, r.cookie);
  assert.equal(me.data.user.isMember, true);
  assert.equal(me.data.user.memberNumber, 3);
});
