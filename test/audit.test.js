'use strict';
// Tests des corrections de l'audit : recherche sans accents, confidentialité des suggestions,
// compteurs et blocages, anciens noms d'utilisateur, lecture des notifications par filtre,
// présence et « écrit… » sans connexion permanente.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, client, signup } = require('./helpers');

let srv;
let base;
before(async () => {
  srv = await startServer();
  base = srv.base;
  await signup(base, 'admin_audit'); // le premier compte est administrateur
});
after(async () => srv.close());

const textPost = async (c, body, extra = {}) => {
  const r = await c.post('/api/posts', { body, bg: 'ocean', privacy: 'public', allowComments: true, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.post;
};

test('recherche : accents et majuscules ignorés, espaces multiples, « @ » seul', async () => {
  const chef = await signup(base, 'chef_pates', { displayName: 'Élodie Pâtissière' });
  const post = await textPost(chef, 'Pâtes citron et basilic #Défi');
  for (const q of ['pates', 'PÂTES', 'Pates citron', 'pates   citron', 'défi', 'DEFI']) {
    const r = await client(base).get(`/api/search?q=${encodeURIComponent(q)}&type=videos`);
    assert.ok(r.data.posts.some((p) => p.id === post.id), `« ${q} » doit trouver la publication`);
  }
  const users = await client(base).get(`/api/search?q=${encodeURIComponent('elodie')}&type=users`);
  assert.ok(users.data.users.some((u) => u.username === 'chef_pates'));
  // « défi » et « defi » : le même hashtag, compté comme la grille
  const tag = await client(base).get('/api/tags/defi');
  assert.equal(tag.data.tag.posts, 1);
  const grid = await client(base).get('/api/tags/defi/posts');
  assert.ok(grid.data.posts.some((p) => p.id === post.id));
  const sugg = await client(base).get(`/api/search/suggest?q=${encodeURIComponent('#DEF')}`);
  assert.ok(sugg.data.tags.some((t) => t.tag === 'défi'));
  // « @ » ou « # » seuls : rien
  for (const q of ['@', '#', '@@ ']) {
    const r = await client(base).get(`/api/search?q=${encodeURIComponent(q)}`);
    assert.equal(r.data.posts.length + r.data.users.length, 0);
    const s = await client(base).get(`/api/search/suggest?q=${encodeURIComponent(q)}`);
    assert.equal(s.data.users.length + s.data.tags.length, 0);
  }
});

test('suggestions : les hashtags des publications privées ou des comptes privés restent cachés', async () => {
  const a = await signup(base, 'secret_auteur');
  await textPost(a, 'Rien que pour moi #moncoinsecret', { privacy: 'private' });
  await textPost(a, 'Pour mes amis #moncoinamis', { privacy: 'friends' });
  const s = await client(base).get('/api/search/suggest?q=%23moncoin');
  assert.deepEqual(s.data.tags, []);
  const priv = await signup(base, 'compte_prive');
  await textPost(priv, 'Publication publique d’un compte privé #moncoinprive');
  await priv.patch('/api/me/settings', { privateAccount: true });
  const t = await client(base).get('/api/tags/moncoinprive');
  assert.equal(t.data.tag.posts, 0);
});

test('compteurs : les messages d’un compte bloqué ne laissent pas de pastille', async () => {
  const lea = await signup(base, 'lea_bloquee');
  const max = await signup(base, 'max_bloque');
  await lea.post('/api/conversations/max_bloque', { body: 'Salut' });
  await lea.post('/api/conversations/max_bloque', { body: 'Tu es là ?' });
  assert.equal((await max.get('/api/counters')).data.messages, 2);
  await max.post('/api/users/lea_bloquee/block');
  assert.equal((await max.get('/api/counters')).data.messages, 0);
  // Vu par la personne bloquée : aucun « Débloquer » possible
  const conv = await lea.get('/api/conversations/max_bloque');
  assert.equal(conv.data.blockedMe, true);
  assert.equal(conv.data.blockedByMe, false);
  const mine = await max.get('/api/conversations/lea_bloquee');
  assert.equal(mine.data.blockedByMe, true);
});

test('ancien nom d’utilisateur : l’ancienne adresse mène encore au compte', async () => {
  const c = await signup(base, 'ancien_nom');
  const r = await c.patch('/api/me', { username: 'nouveau_nom' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const old = await client(base).get('/api/users/ancien_nom');
  assert.equal(old.status, 200);
  assert.equal(old.data.user.username, 'nouveau_nom');
});

test('activité : ouvrir un filtre ne marque lu que ce filtre', async () => {
  const star = await signup(base, 'star_filtre');
  const fan = await signup(base, 'fan_filtre');
  const post = await textPost(star, 'Une pensée');
  await fan.post('/api/users/star_filtre/follow');
  await fan.post(`/api/posts/${post.id}/like`);
  assert.equal((await star.get('/api/counters')).data.notifications, 2);
  await star.post('/api/notifications/read?type=followers');
  assert.equal((await star.get('/api/counters')).data.notifications, 1);
  const n = await star.get('/api/notifications?type=likes');
  assert.equal(n.data.notifications[0].post.kind, 'text');
  assert.equal(n.data.notifications[0].post.author, 'star_filtre');
  await star.post('/api/notifications/read');
  assert.equal((await star.get('/api/counters')).data.notifications, 0);
});

test('sans connexion permanente : « En ligne » et « écrit… » passent par la relecture', async () => {
  const poll = await startServer({ realtime: 'poll' });
  try {
    await signup(poll.base, 'poll_admin');
    const zoe = await signup(poll.base, 'zoe_poll');
    const noe = await signup(poll.base, 'noe_poll');
    await zoe.post('/api/conversations/noe_poll', { body: 'Coucou' });
    let conv = await noe.get('/api/conversations/zoe_poll');
    assert.equal(conv.data.user.online, false);
    assert.equal(conv.data.typing, false);
    await zoe.get('/api/counters'); // l'application de Zoé relit régulièrement ses compteurs
    await zoe.post('/api/conversations/noe_poll/typing');
    conv = await noe.get('/api/conversations/zoe_poll?after=999999');
    assert.equal(conv.data.user.online, true);
    assert.equal(conv.data.typing, true);
  } finally {
    await poll.close();
  }
});
