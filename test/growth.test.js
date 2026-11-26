'use strict';
// Faire venir et faire rester : invitations (« X t'invite sur AURUM ») et séries de messages (🔥).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, signup } = require('./helpers');

let srv;
let base;
before(async () => {
  srv = await startServer();
  base = srv.base;
});
after(async () => srv.close());

test('invitation : le nouveau compte suit celui qui invite, qui est prévenu', async () => {
  const inviter = await signup(base, 'inv_camille', { displayName: 'Camille' });
  const fresh = client(base);
  const r = await fresh.post('/api/auth/signup', {
    username: 'inv_nouveau', displayName: 'Nouveau', email: 'inv_nouveau@exemple.fr', password: 'motdepasse1',
    birthdate: '2001-03-04', terms: true, ref: 'inv_camille', elapsed: 9000,
  });
  assert.equal(r.status, 201);
  // Le nouveau compte suit déjà celui qui l'a invité
  const prof = await fresh.get('/api/users/inv_camille');
  assert.equal(prof.data.user.isFollowing, true);
  // Celui qui invite est prévenu, avec de quoi suivre en retour
  const n = await inviter.get('/api/notifications');
  const joined = n.data.notifications.find((x) => x.type === 'invite_joined');
  assert.ok(joined, 'notification « a rejoint grâce à toi »');
  assert.equal(joined.actor.username, 'inv_nouveau');
  assert.equal(joined.followingBack, false);
  const followers = await inviter.get('/api/notifications?type=followers');
  assert.ok(followers.data.notifications.some((x) => x.type === 'invite_joined'));
  // Compteur des amis venus grâce à soi
  const inv = await inviter.get('/api/me/invites');
  assert.equal(inv.data.count, 1);
  assert.equal(inv.data.users[0].username, 'inv_nouveau');
  // Invitation inconnue : l'inscription se fait quand même, sans lien
  const other = client(base);
  const r2 = await other.post('/api/auth/signup', {
    username: 'inv_seul', displayName: 'Seul', email: 'inv_seul@exemple.fr', password: 'motdepasse1',
    birthdate: '2001-03-04', terms: true, ref: 'personne_inconnue', elapsed: 9000,
  });
  assert.equal(r2.status, 201);
  assert.equal((await inviter.get('/api/me/invites')).data.count, 1);
});

test('séries : jours d’affilée à s’écrire, en danger tant que l’un n’a pas écrit aujourd’hui', async () => {
  const a = await signup(base, 'serie_a');
  const b = await signup(base, 'serie_b');
  await a.post('/api/users/serie_b/follow');
  await b.post('/api/users/serie_a/follow');
  const { db } = srv.ctx;
  const ids = {
    a: (await db.get("SELECT id FROM users WHERE username = 'serie_a'")).id,
    b: (await db.get("SELECT id FROM users WHERE username = 'serie_b'")).id,
  };
  const day = 86400e3;
  const at = (daysAgo) => Date.now() - daysAgo * day;
  const put = (from, to, t) => db.run('INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)', ids[from], ids[to], 'coucou', t);
  // Avant-hier et hier : chacun a écrit à l'autre ; aujourd'hui : seulement A
  await put('a', 'b', at(2));
  await put('b', 'a', at(2));
  await put('a', 'b', at(1));
  await put('b', 'a', at(1));
  await put('a', 'b', at(0));
  const listA = await a.get('/api/conversations');
  const convA = listA.data.conversations.find((c) => c.user.username === 'serie_b');
  assert.deepEqual(convA.streak, { days: 2, atRisk: true, mine: true });
  const threadB = await b.get('/api/conversations/serie_a');
  assert.equal(threadB.data.streak.days, 2);
  assert.equal(threadB.data.streak.atRisk, true);
  assert.equal(threadB.data.streak.mine, false);
  // B répond aujourd'hui : 3 jours, plus en danger
  await b.post('/api/conversations/serie_a', { body: 'Coucou toi !' });
  const again = await a.get('/api/conversations');
  assert.deepEqual(again.data.conversations.find((c) => c.user.username === 'serie_b').streak, { days: 3, atRisk: false, mine: true });
  // Un seul jour : pas encore de série
  const c = await signup(base, 'serie_c');
  await c.post('/api/users/serie_a/follow');
  await a.post('/api/users/serie_c/follow');
  await c.post('/api/conversations/serie_a', { body: 'Salut' });
  await a.post('/api/conversations/serie_c', { body: 'Hello' });
  const list2 = await a.get('/api/conversations');
  assert.equal(list2.data.conversations.find((x) => x.user.username === 'serie_c').streak, null);
});
