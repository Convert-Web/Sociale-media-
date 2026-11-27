'use strict';
// Le Sujet du jour : 19 h à Paris, choix automatique, réponses verrouillées, Or du jour, série, notification.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, signup } = require('./helpers');
const S = require('../src/subjects');

let srv;
let base;
const pushes = [];
before(async () => {
  srv = await startServer({ cronSecret: 'secret-cron' }, { pushSender: async (sub, body) => pushes.push({ endpoint: sub.endpoint, ...JSON.parse(body) }) });
  base = srv.base;
  await signup(base, 'sj_premier'); // le premier compte devient administrateur : les suivants sont des membres ordinaires
});
after(async () => srv.close());

test('heures de Paris : 19 h en hiver comme en été, jour du sujet avant et après 19 h', () => {
  assert.equal(S.parisTime('2026-11-26', 19), Date.UTC(2026, 10, 26, 18)); // hiver : UTC+1
  assert.equal(S.parisTime('2026-07-14', 19), Date.UTC(2026, 6, 14, 17)); // été : UTC+2
  assert.equal(S.parisTime('2026-03-29', 19), Date.UTC(2026, 2, 29, 17)); // jour du passage à l'heure d'été
  assert.equal(S.currentDay(Date.UTC(2026, 10, 26, 17, 59)), '2026-11-25'); // 18 h 59 à Paris
  assert.equal(S.currentDay(Date.UTC(2026, 10, 26, 18, 0)), '2026-11-26'); // 19 h pile
  assert.equal(S.currentDay(Date.UTC(2026, 10, 27, 3, 0)), '2026-11-26'); // la nuit : toujours le sujet de la veille
  assert.equal(S.shiftDay('2026-12-31', 1), '2027-01-01');
});

test('réserve : au moins 20 sujets par thème, aucun doublon, des textes courts, rien de sensible', () => {
  const keys = new Set();
  for (const [kind, list] of Object.entries(S.POOL)) {
    assert.ok(list.length >= 20, `${kind} : ${list.length}`);
    for (const t of list) {
      assert.ok(t.length <= 80, t);
      assert.ok(!keys.has(S.keyOf(t)), `doublon : ${t}`);
      keys.add(S.keyOf(t));
      assert.ok(!S.SENSITIVE.test(t), `sensible : ${t}`);
    }
  }
});

test('choix automatique : un sujet par jour, le thème du jour, jamais deux fois le même', async () => {
  const ctx = srv.ctx;
  const at = (day, h = 19, m = 30) => S.parisTime(day, h) + m * 60e3;
  // Lundi 23 novembre 2026 à 19 h 30 : débat ; le même sujet au deuxième passage
  const mon = await S.ensureCurrent(ctx, at('2026-11-23'));
  assert.equal(mon.day, '2026-11-23');
  assert.equal(mon.kind, 'debat');
  assert.ok(S.POOL.debat.includes(mon.title));
  assert.equal((await S.ensureCurrent(ctx, at('2026-11-23', 22))).id, mon.id);
  // Le lendemain à 18 h : toujours le sujet de lundi
  assert.equal((await S.ensureCurrent(ctx, at('2026-11-24', 18))).id, mon.id);
  // Mercredi sans actualité utilisable : un sujet « pour rire »
  assert.equal((await S.ensureCurrent(ctx, at('2026-11-25'))).kind, 'fun');
  // 60 jours de suite : aucun sujet de la réserve ne revient
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    const s = await S.ensureCurrent(ctx, at(S.shiftDay('2027-01-01', i)));
    if (s.pool_key) {
      assert.ok(!seen.has(s.pool_key), `répété : ${s.title}`);
      seen.add(s.pool_key);
    }
  }
});

test('mercredi : l’actualité du jour si elle s’y prête, jamais un sujet sensible', async () => {
  const { db } = srv.ctx;
  const day = '2027-06-02'; // un mercredi
  const now = S.parisTime(day, 19) + 60e3;
  await db.run("INSERT INTO journal_items (kind, title, url, published_at, created_at, topic) VALUES ('article', 'Un accident fait trois morts sur l’autoroute', 'https://exemple.fr/a', ?, ?, 'sport')", now - 3600e3, now);
  await db.run("INSERT INTO journal_items (kind, title, url, published_at, created_at, topic) VALUES ('article', 'Le Tour de France passera par Lyon', 'https://exemple.fr/b', ?, ?, 'sport')", now - 7200e3, now);
  const s = await S.ensureCurrent(srv.ctx, now);
  assert.equal(s.kind, 'actu');
  assert.equal(s.title, 'Le Tour de France passera par Lyon');
  assert.ok(s.journal_id);
});

test('répondre, réponses verrouillées tant qu’on n’a pas répondu, une seule réponse liée', async () => {
  const a = await signup(base, 'sj_alice');
  const b = await signup(base, 'sj_bruno');
  await a.post('/api/users/sj_bruno/follow');
  await b.post('/api/users/sj_alice/follow');
  const today = await a.get('/api/subjects/today');
  assert.equal(today.status, 200);
  const sid = today.data.subject.id;
  assert.equal(today.data.subject.open, true);
  assert.equal(today.data.me.locked, true);
  // Alice répond (texte sur fond coloré) : la publication est liée au sujet
  const r1 = await a.post('/api/posts', { body: 'Chocolatine, évidemment', bg: 'violet', subjectId: sid });
  assert.equal(r1.status, 201);
  assert.equal(r1.data.post.subject.id, sid);
  // Deuxième publication avec le même sujet : publiée, mais sans lien
  const r2 = await a.post('/api/posts', { body: 'Et une autre', bg: 'rose', subjectId: sid });
  assert.equal(r2.status, 201);
  assert.equal(r2.data.post.subject, null);
  // Bruno n'a pas répondu : verrouillé (page du sujet et « Pour toi »)
  const lockedB = await b.get(`/api/subjects/${sid}/answers?sort=recent`);
  assert.equal(lockedB.data.locked, true);
  assert.equal(lockedB.data.posts.length, 0);
  const fy = await b.get('/api/feed/foryou');
  assert.ok(!fy.data.posts.some((p) => p.id === r1.data.post.id), 'réponse visible dans « Pour toi » avant d’avoir répondu');
  const page = await b.get(`/api/subjects/${sid}`);
  assert.equal(page.data.answers, 1);
  assert.equal(page.data.friends.count, 1);
  assert.equal(page.data.friends.users[0].username, 'sj_alice');
  // Bruno répond : tout se débloque
  await b.post('/api/posts', { body: 'Pain au chocolat', bg: 'ocean', subjectId: sid });
  const open = await b.get(`/api/subjects/${sid}/answers?sort=friends`);
  assert.equal(open.data.locked, false);
  assert.deepEqual(open.data.posts.map((p) => p.author.username).sort(), ['sj_alice', 'sj_bruno']);
  const me = await b.get('/api/subjects/today');
  assert.equal(me.data.me.answered, true);
  assert.equal(me.data.me.streak, 1);
  // Un sujet qui n'existe pas
  assert.equal((await a.post('/api/posts', { body: 'x', bg: 'violet', subjectId: 999999 })).status, 400);
});

test('Or du jour : la réponse la plus aimée (sans compter son propre J’aime), son auteur est prévenu', async () => {
  const { db } = srv.ctx;
  const c1 = await signup(base, 'or_un');
  const c2 = await signup(base, 'or_deux');
  const c3 = await signup(base, 'or_trois');
  const now = Date.now();
  const { lastInsertRowid: sid } = await db.run(
    "INSERT INTO subjects (day, title, kind, opens_at, closes_at, created_at) VALUES ('2020-01-01', 'Ton talent caché', 'defi', ?, ?, ?)",
    now - 25 * 3600e3, now + 60e3, now - 25 * 3600e3,
  );
  const p1 = (await c1.post('/api/posts', { body: 'Mon talent', bg: 'violet', subjectId: sid })).data.post.id;
  const p2 = (await c2.post('/api/posts', { body: 'Le mien', bg: 'rose', subjectId: sid })).data.post.id;
  await c1.post(`/api/posts/${p1}/like`); // son propre J'aime ne compte pas
  await c3.post(`/api/posts/${p2}/like`);
  await db.run("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, 'https://push.exemple/or-deux', 'k', 'a', ?)", c2.user.id, now);
  await db.run('UPDATE subjects SET closes_at = ? WHERE id = ?', now - 1000, sid);
  pushes.length = 0;
  await S.settle(srv.ctx);
  const s = await db.get('SELECT * FROM subjects WHERE id = ?', sid);
  assert.equal(s.winner_post_id, p2);
  assert.ok(s.settled_at);
  assert.ok(pushes.some((p) => p.endpoint === 'https://push.exemple/or-deux' && p.kind === 'subject_gold'));
  // La réponse gagnante porte l'Or ; le profil compte l'Or du jour
  const post = await c3.get(`/api/posts/${p2}`);
  assert.equal(post.data.post.subject.gold, true);
  assert.equal(await S.goldsOf(db, c2.user.id), 1);
  // Sujet terminé : ses réponses se voient sans avoir répondu ; on ne peut plus y répondre
  assert.equal((await c3.get(`/api/subjects/${sid}/answers`)).data.locked, false);
  await db.run('UPDATE subjects SET closes_at = ? WHERE id = ?', now - 3600e3, sid);
  assert.equal((await c3.post('/api/posts', { body: 'Trop tard', bg: 'violet', subjectId: sid })).status, 400);
});

test('série : jours d’affilée avec une réponse', async () => {
  const { db } = srv.ctx;
  const u = await signup(base, 'serie_sujet');
  const now = Date.now();
  const today = S.currentDay(now);
  for (const back of [1, 2, 3]) {
    const day = S.shiftDay(today, -back - 400); // jours anciens : ne comptent pas pour aujourd'hui
    await db.run('INSERT OR IGNORE INTO subjects (day, title, kind, opens_at, closes_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', day, `Sujet ${day}`, 'fun', 1, 2, 1);
  }
  // Hier et avant-hier : deux jours de suite (aujourd'hui pas encore répondu : la série tient)
  for (const back of [1, 2]) {
    const day = S.shiftDay(today, -back);
    await db.run('INSERT OR IGNORE INTO subjects (day, title, kind, opens_at, closes_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', day, `Sujet ${day}`, 'fun', 1, 2, 1);
    const s = await db.get('SELECT id FROM subjects WHERE day = ?', day);
    await db.run("INSERT INTO posts (user_id, body, bg, created_at, subject_id) VALUES (?, 'réponse', 'violet', ?, ?)", u.user.id, now, s.id);
  }
  assert.equal(await S.streakOf(db, u.user.id, now), 2);
});

test('notification de 19 h : une seule fois, à ceux qui l’acceptent ; tâche planifiée protégée', async () => {
  const { db } = srv.ctx;
  const yes = await signup(base, 'notif_oui');
  const no = await signup(base, 'notif_non');
  await no.patch('/api/me/settings', { notify: { subject: false } });
  const now = Date.now();
  for (const [u, ep] of [[yes, 'https://push.exemple/oui'], [no, 'https://push.exemple/non']]) {
    await db.run('INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)', u.user.id, ep, 'k', 'a', now);
  }
  const s = await S.ensureCurrent(srv.ctx, now);
  await db.run('UPDATE subjects SET opens_at = ?, notified_at = NULL WHERE id = ?', now - 60e3, s.id);
  pushes.length = 0;
  const anon = client(base);
  assert.equal((await anon.get('/api/cron/subject')).status, 401);
  const run = await fetch(`${base}/api/cron/subject`, { headers: { authorization: 'Bearer secret-cron' } }).then((r) => r.json());
  assert.ok(run.sent >= 1);
  assert.ok(pushes.some((p) => p.endpoint === 'https://push.exemple/oui' && p.kind === 'subject' && p.url === '/sujet'));
  assert.ok(!pushes.some((p) => p.endpoint === 'https://push.exemple/non'));
  // Deuxième passage : personne n'est prévenu deux fois
  pushes.length = 0;
  const again = await fetch(`${base}/api/cron/subject`, { headers: { authorization: 'Bearer secret-cron' } }).then((r) => r.json());
  assert.equal(again.sent, 0);
  assert.equal(pushes.length, 0);
});

test('administration : programmer un sujet partenaire avec un lot, il passe avant le choix automatique', async () => {
  const { db } = srv.ctx;
  const admin = await signup(base, 'sj_admin');
  await db.run('UPDATE users SET is_admin = 1 WHERE id = ?', admin.user.id);
  const user = await signup(base, 'sj_simple');
  const day = S.shiftDay(S.currentDay(), 3);
  assert.equal((await user.post('/api/admin/subjects', { day, title: 'Ton sport improbable' })).status, 403);
  const r = await admin.post('/api/admin/subjects', { day, title: 'Ton sport improbable', sponsor: 'Une marque', prize: '3 vélos' });
  assert.equal(r.status, 201);
  assert.equal(r.data.subject.label, 'Sujet partenaire');
  const list = await admin.get('/api/admin/subjects');
  assert.equal(list.status, 200);
  assert.equal(list.data.upcoming.find((x) => x.day === day).planned.title, 'Ton sport improbable');
  // Le jour venu, c'est lui qui s'ouvre
  const s = await S.ensureCurrent(srv.ctx, S.parisTime(day, 19) + 60e3);
  assert.equal(s.title, 'Ton sport improbable');
  assert.equal(s.prize, '3 vélos');
  // Pas de date déjà commencée
  assert.equal((await admin.post('/api/admin/subjects', { day: S.currentDay(), title: 'Trop tard' })).status, 400);
});
