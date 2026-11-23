'use strict';
// Tests d'intégration de l'API de Vibz : comptes, vidéos, fil « Pour toi », interactions,
// commentaires, abonnements (comptes privés), blocages, messages, recherche, sons, LIVE,
// portefeuille, administration, suppression de compte.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, client, signup, publishVideo } = require('./helpers');

let srv;
let base;
before(async () => {
  srv = await startServer();
  base = srv.base;
});
after(async () => srv.close());

test('session sans compte : configuration publique', async () => {
  const r = await client(base).get('/api/session');
  assert.equal(r.status, 200);
  assert.equal(r.data.user, null);
  assert.equal(r.data.config.appName, 'Vibz');
  assert.ok(r.data.config.categories.length > 5);
});

test('inscription : âge, mot de passe, conditions, nom pris ; le premier compte est administrateur', async () => {
  const c = client(base);
  const young = await c.post('/api/auth/signup', { username: 'petit', email: 'petit@exemple.fr', password: 'motdepasse1', birthdate: '2020-01-01', terms: true });
  assert.equal(young.status, 403);
  const weak = await c.post('/api/auth/signup', { username: 'faible', email: 'faible@exemple.fr', password: 'court', birthdate: '2000-01-01', terms: true });
  assert.equal(weak.status, 400);
  const noTerms = await c.post('/api/auth/signup', { username: 'sansc', email: 'sansc@exemple.fr', password: 'motdepasse1', birthdate: '2000-01-01' });
  assert.equal(noTerms.status, 400);
  const admin = await signup(base, 'chef');
  assert.equal(admin.user.isAdmin, true);
  const dup = await c.post('/api/auth/signup', { username: 'chef', email: 'autre@exemple.fr', password: 'motdepasse1', birthdate: '2000-01-01', terms: true });
  assert.equal(dup.status, 409);
  const avail = await c.get('/api/auth/username?u=chef');
  assert.equal(avail.data.ok, false);
  assert.equal((await c.get('/api/auth/username?u=libre_123')).data.ok, true);
  const second = await signup(base, 'second');
  assert.equal(second.user.isAdmin, false);
  assert.ok(srv.mails.some((m) => /Bienvenue/.test(m.subject)));
});

test('connexion, mauvais mot de passe, déconnexion', async () => {
  await signup(base, 'connecte');
  const c = client(base);
  assert.equal((await c.post('/api/auth/login', { login: 'connecte', password: 'mauvais' })).status, 401);
  const ok = await c.post('/api/auth/login', { login: 'connecte@exemple.fr', password: 'motdepasse1' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/session')).data.user.username, 'connecte');
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/session')).data.user, null);
  // Écriture sans en-tête anti-CSRF : refusée
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('publication vidéo, son original, hashtags, fil « Pour toi » sans compte', async () => {
  const alice = await signup(base, 'alice');
  const post = await publishVideo(base, alice, 'Première vidéo #Danse #fyp avec @second', { category: 'danse', fx: { filter: 'vif', overlays: [{ kind: 'text', text: 'Salut', x: 0.5, y: 0.3, color: '#ffffff' }] } });
  assert.equal(post.kind, 'video');
  assert.equal(post.sound.original, true);
  assert.match(post.sound.title, /son original/);
  assert.equal(post.fx.filter, 'vif');
  assert.equal(post.fx.overlays[0].text, 'Salut');
  const guest = client(base);
  const feed = await guest.get('/api/feed/foryou');
  assert.ok(feed.data.posts.some((p) => p.id === post.id));
  const tag = await guest.get('/api/tags/danse');
  assert.equal(tag.data.tag.posts, 1);
  const tagPosts = await guest.get('/api/tags/danse/posts');
  assert.equal(tagPosts.data.posts[0].id, post.id);
  // La personne mentionnée est prévenue
  const second = client(base);
  await second.post('/api/auth/login', { login: 'second', password: 'motdepasse1' });
  const notifs = await second.get('/api/notifications?type=mentions');
  assert.ok(notifs.data.notifications.some((n) => n.type === 'mention' && n.post.id === post.id));
});

test('confidentialité : « moi uniquement » et « amis »', async () => {
  const bob = await signup(base, 'bob');
  const priv = await publishVideo(base, bob, 'Secret', { privacy: 'private' });
  const friends = await publishVideo(base, bob, 'Pour les amis', { privacy: 'friends' });
  const guest = client(base);
  assert.equal((await guest.get(`/api/posts/${priv.id}`)).status, 404);
  assert.equal((await guest.get(`/api/posts/${friends.id}`)).status, 404);
  assert.equal((await bob.get(`/api/posts/${priv.id}`)).status, 200);
  const carl = await signup(base, 'carl');
  await carl.post('/api/users/bob/follow');
  assert.equal((await carl.get(`/api/posts/${friends.id}`)).status, 404); // abonnement simple : pas encore ami
  await bob.post('/api/users/carl/follow');
  assert.equal((await carl.get(`/api/posts/${friends.id}`)).status, 200); // abonnements réciproques = amis
  const profile = await guest.get('/api/users/bob/posts');
  assert.equal(profile.data.posts.length, 0);
});

test('J’aime, favoris, republication, partage, vues et temps regardé', async () => {
  const dan = await signup(base, 'dan');
  const eve = await signup(base, 'eve');
  const post = await publishVideo(base, dan, 'Like-moi #test');
  const like = await eve.post(`/api/posts/${post.id}/like`);
  assert.equal(like.data.likeCount, 1);
  assert.equal((await eve.post(`/api/posts/${post.id}/like`)).data.likeCount, 1); // pas de double J'aime
  assert.equal((await eve.post(`/api/posts/${post.id}/favorite`)).data.saveCount, 1);
  assert.equal((await dan.post(`/api/posts/${post.id}/repost`)).status, 400); // pas sa propre vidéo
  assert.equal((await eve.post(`/api/posts/${post.id}/repost`)).data.repostCount, 1);
  assert.equal((await client(base).post(`/api/posts/${post.id}/share`, { channel: 'copy' })).data.shareCount, 1);
  await client(base).post(`/api/posts/${post.id}/view`);
  const v = await eve.post(`/api/posts/${post.id}/view`);
  assert.equal(v.data.views, 2);
  assert.equal((await eve.post(`/api/posts/${post.id}/watch`, { ms: 8000, ratio: 1, loops: 1 })).status, 200);
  const notifs = await dan.get('/api/notifications');
  const types = notifs.data.notifications.map((n) => n.type);
  assert.ok(types.includes('like') && types.includes('favorite') && types.includes('repost'));
  // Centres d'intérêt appris (J'aime, favori, visionnage complet)
  const interests = await srv.ctx.db.all("SELECT * FROM interests WHERE user_id = ? AND kind = 'author'", eve.user.id);
  assert.ok(interests[0].score > 5);
  const reposts = await client(base).get('/api/users/eve/reposts');
  assert.equal(reposts.data.posts[0].id, post.id);
  await eve.del(`/api/posts/${post.id}/like`);
  assert.equal((await eve.get(`/api/posts/${post.id}`)).data.post.liked, false);
  // Favoris : visibles de soi seul
  const favs = await eve.get('/api/me/favorites');
  assert.equal(favs.data.posts[0].id, post.id);
});

test('fil « Abonnements » (avec republications) et « Amis »', async () => {
  const fan = await signup(base, 'fan');
  const star = await signup(base, 'star');
  const other = await signup(base, 'other');
  const p1 = await publishVideo(base, star, 'Vidéo de la star');
  const p2 = await publishVideo(base, other, 'Vidéo républiée');
  await star.post(`/api/posts/${p2.id}/repost`);
  await fan.post('/api/users/star/follow');
  const feed = await fan.get('/api/feed/following');
  const ids = feed.data.posts.map((p) => p.id);
  assert.ok(ids.includes(p1.id) && ids.includes(p2.id));
  assert.equal(feed.data.posts.find((p) => p.id === p2.id).repostedBy.username, 'star');
  assert.equal((await fan.get('/api/feed/friends')).data.posts.length, 0);
  await star.post('/api/users/fan/follow');
  assert.ok((await fan.get('/api/feed/friends')).data.posts.some((p) => p.id === p1.id));
  assert.equal((await client(base).get('/api/feed/following')).status, 401);
});

test('« Pas intéressé » et créateur masqué : retirés du fil', async () => {
  const viewer = await signup(base, 'viewer');
  const maker = await signup(base, 'maker');
  const a = await publishVideo(base, maker, 'A');
  await viewer.post(`/api/posts/${a.id}/not-interested`);
  let feed = await viewer.get('/api/feed/foryou');
  assert.ok(!feed.data.posts.some((p) => p.id === a.id));
  const b = await publishVideo(base, maker, 'B');
  await viewer.post(`/api/posts/${b.id}/not-interested`, { author: true });
  feed = await viewer.get('/api/feed/foryou');
  assert.ok(!feed.data.posts.some((p) => p.author.username === 'maker'));
});

test('commentaires : réponse à plat, J’aime, épinglage, suppression par le créateur', async () => {
  const owner = await signup(base, 'owner');
  const fan1 = await signup(base, 'fan1');
  const fan2 = await signup(base, 'fan2');
  const post = await publishVideo(base, owner, 'Commentez');
  const c1 = await fan1.post(`/api/posts/${post.id}/comments`, { body: 'Super vidéo' });
  assert.equal(c1.status, 201);
  const r1 = await fan2.post(`/api/posts/${post.id}/comments`, { body: '@fan1 d’accord', parentId: c1.data.comment.id });
  const r2 = await owner.post(`/api/posts/${post.id}/comments`, { body: 'Merci !', parentId: r1.data.comment.id });
  assert.equal(r2.data.comment.parentId, c1.data.comment.id); // rattachée au commentaire principal
  await owner.post(`/api/comments/${c1.data.comment.id}/like`);
  assert.equal((await fan2.post(`/api/comments/${c1.data.comment.id}/pin`)).status, 403);
  assert.equal((await owner.post(`/api/comments/${c1.data.comment.id}/pin`)).status, 200);
  const list = await client(base).get(`/api/posts/${post.id}/comments`);
  const top = list.data.comments[0];
  assert.equal(top.pinned, true);
  assert.equal(top.authorLiked, true);
  assert.equal(top.replyCount, 2);
  const replies = await client(base).get(`/api/comments/${c1.data.comment.id}/replies`);
  assert.equal(replies.data.comments.length, 2);
  assert.equal(replies.data.comments[1].byCreator, true);
  const fan1Notifs = await fan1.get('/api/notifications?type=comments');
  assert.ok(fan1Notifs.data.notifications.some((n) => n.type === 'reply'));
  const del = await owner.del(`/api/comments/${r1.data.comment.id}`);
  assert.equal(del.data.count, 2);
  // Commentaires désactivés
  await owner.patch(`/api/posts/${post.id}`, { allowComments: false });
  assert.equal((await fan1.post(`/api/posts/${post.id}/comments`, { body: 'Encore' })).status, 403);
});

test('compte privé : demande d’abonnement, acceptation, contenus réservés', async () => {
  const p = await signup(base, 'prive');
  await p.patch('/api/me/settings', { privateAccount: true });
  const post = await publishVideo(base, p, 'Réservé');
  const asker = await signup(base, 'asker');
  const follow = await asker.post('/api/users/prive/follow');
  assert.equal(follow.data.user.requested, true);
  assert.equal(follow.data.user.isFollowing, false);
  assert.equal((await asker.get(`/api/posts/${post.id}`)).status, 404);
  assert.equal((await asker.get('/api/users/prive/posts')).data.locked, true);
  const reqs = await p.get('/api/me/requests');
  assert.equal(reqs.data.users[0].username, 'asker');
  assert.equal((await p.get('/api/session')).data.counters.requests, 1);
  await p.post('/api/me/requests/asker/accept');
  assert.equal((await asker.get(`/api/posts/${post.id}`)).status, 200);
  assert.equal((await client(base).get(`/api/posts/${post.id}`)).status, 404);
});

test('blocage : plus de J’aime, de commentaires, de messages ni de profil', async () => {
  const x = await signup(base, 'xavier');
  const y = await signup(base, 'yvon');
  const post = await publishVideo(base, x, 'Ma vidéo');
  await x.post('/api/users/yvon/block');
  assert.equal((await y.get(`/api/posts/${post.id}`)).status, 404);
  assert.equal((await y.post(`/api/posts/${post.id}/like`)).status, 404);
  assert.equal((await y.post('/api/conversations/xavier', { body: 'Coucou' })).status, 403);
  assert.equal((await y.get('/api/users/xavier')).data.user.locked, true);
  assert.equal((await x.get('/api/me/blocked')).data.users[0].username, 'yvon');
  await x.del('/api/users/yvon/block');
  assert.equal((await y.get(`/api/posts/${post.id}`)).status, 200);
});

test('messages : texte, vidéo partagée, lu, réglage « amis seulement »', async () => {
  const m1 = await signup(base, 'msg1');
  const m2 = await signup(base, 'msg2');
  const post = await publishVideo(base, m1, 'À partager');
  const sent = await m1.post('/api/conversations/msg2', { body: 'Salut !' });
  assert.equal(sent.status, 201);
  const share = await m1.post('/api/share/dm', { postId: post.id, usernames: ['msg2'], body: 'Regarde ça' });
  assert.deepEqual(share.data.sent, ['msg2']);
  assert.equal((await m2.get('/api/session')).data.counters.messages, 2);
  const conv = await m2.get('/api/conversations/msg1');
  assert.equal(conv.data.messages.length, 2);
  assert.equal(conv.data.messages[1].post.id, post.id);
  // En tête de conversation : abonnés et relation
  assert.equal(conv.data.user.followers, 0);
  assert.equal(conv.data.user.isFollowing, false);
  await m2.post('/api/users/msg1/follow');
  const again = await m1.get('/api/conversations/msg2');
  assert.equal(again.data.user.followsMe, true);
  assert.equal(again.data.user.isFollowing, false);
  assert.equal((await m2.get('/api/conversations/msg1')).data.user.followers, 1);
  const list = await m1.get('/api/conversations');
  assert.equal(list.data.conversations[0].user.username, 'msg2');
  assert.equal(list.data.conversations[0].lastMessage.seen, true);
  // Réglage : messages des amis seulement
  const m3 = await signup(base, 'msg3');
  await m3.patch('/api/me/settings', { dmPolicy: 'friends' });
  assert.equal((await m1.post('/api/conversations/msg3', { body: 'Hello' })).status, 403);
  await m1.post('/api/users/msg3/follow');
  await m3.post('/api/users/msg1/follow');
  assert.equal((await m1.post('/api/conversations/msg3', { body: 'Hello' })).status, 201);
  const targets = await m1.get('/api/share/targets');
  assert.ok(targets.data.users.some((u) => u.username === 'msg2'));
});

test('recherche, suggestions, Explorer et hashtags tendance', async () => {
  const s = await signup(base, 'chanteuse', { displayName: 'Léa Chante' });
  await publishVideo(base, s, 'Ma reprise au piano #piano #musique', { category: 'musique' });
  const guest = client(base);
  const top = await guest.get('/api/search?q=piano');
  assert.ok(top.data.posts.length >= 1);
  assert.ok(top.data.tags.some((t) => t.tag === 'piano'));
  const users = await guest.get(`/api/search?q=${encodeURIComponent('Léa')}&type=users`);
  assert.equal(users.data.users[0].username, 'chanteuse');
  const sugg = await guest.get('/api/search/suggest?q=chan');
  assert.ok(sugg.data.users.some((u) => u.username === 'chanteuse'));
  const disc = await guest.get('/api/discover?category=musique');
  assert.ok(disc.data.posts.every((p) => p.category === 'musique'));
  assert.ok(disc.data.tags.length > 0);
  const viewer = await signup(base, 'curieux');
  const sug = await viewer.get('/api/suggestions');
  assert.ok(sug.data.users.length > 0);
  assert.ok(!sug.data.users.some((u) => u.username === 'curieux'));
});

test('sons : page du son, « Utiliser ce son », favoris, bibliothèque', async () => {
  const a = await signup(base, 'musicien');
  const b = await signup(base, 'danseur');
  const orig = await publishVideo(base, a, 'Mon son');
  const reuse = await publishVideo(base, b, 'Avec ton son', { soundId: orig.sound.id });
  assert.equal(reuse.sound.id, orig.sound.id);
  assert.equal(reuse.sound.original, false);
  const sound = await client(base).get(`/api/sounds/${orig.sound.id}`);
  assert.equal(sound.data.sound.uses, 2);
  assert.ok(sound.data.sound.url);
  const posts = await client(base).get(`/api/sounds/${orig.sound.id}/posts`);
  assert.equal(posts.data.posts[0].id, orig.id); // la vidéo d'origine en tête
  await b.post(`/api/sounds/${orig.sound.id}/favorite`);
  const favs = await b.get('/api/sounds?tab=favorites');
  assert.equal(favs.data.sounds[0].id, orig.sound.id);
  const lib = await client(base).get('/api/sounds');
  assert.ok(lib.data.sounds.some((x) => x.id === orig.sound.id));
  // Duo : autorisé par défaut, refusé si désactivé
  const duet = await publishVideo(base, b, 'Duo !', { duetOf: orig.id });
  assert.equal(duet.duetOf.username, 'musicien');
  await a.patch(`/api/posts/${orig.id}`, { allowDuet: false });
  await assert.rejects(publishVideo(base, b, 'Duo refusé', { duetOf: orig.id }));
});

test('profil : modification, épinglage, abonnés et abonnements', async () => {
  const u = await signup(base, 'profil1');
  const r = await u.patch('/api/me', { displayName: 'Nouveau Nom', bio: 'Ma bio', website: 'exemple.fr', username: 'profil.un' });
  assert.equal(r.data.user.username, 'profil.un');
  assert.equal(r.data.user.website, 'https://exemple.fr');
  assert.equal((await u.patch('/api/me', { username: 'profil.deux' })).status, 429); // une fois par mois
  const p1 = await publishVideo(base, u, 'Première');
  await publishVideo(base, u, 'Deuxième');
  await u.post(`/api/posts/${p1.id}/pin`);
  const grid = await client(base).get('/api/users/profil.un/posts');
  assert.equal(grid.data.posts[0].id, p1.id);
  assert.equal(grid.data.posts[0].pinned, true);
  const f = await signup(base, 'follower1');
  await f.post('/api/users/profil.un/follow');
  const prof = await client(base).get('/api/users/profil.un');
  assert.equal(prof.data.user.counts.followers, 1);
  assert.equal(prof.data.user.counts.posts, 2);
  const followers = await client(base).get('/api/users/profil.un/followers');
  assert.equal(followers.data.users[0].username, 'follower1');
  await u.del('/api/users/follower1/follower');
  assert.equal((await client(base).get('/api/users/profil.un')).data.user.counts.followers, 0);
});

test('LIVE : départ, spectateur sans compte, signalisation WebRTC, chat, cœurs, cadeaux, bilan', async () => {
  const host = await signup(base, 'streamer');
  const viewer = await signup(base, 'spectateur');
  await viewer.post('/api/users/streamer/follow');
  const start = await host.post('/api/live', { title: 'Mon premier LIVE' });
  assert.equal(start.status, 201);
  const id = start.data.live.id;
  assert.ok(Array.isArray(start.data.iceServers));
  // Les abonnés sont prévenus
  assert.ok((await viewer.get('/api/notifications')).data.notifications.some((n) => n.type === 'live'));
  const list = await client(base).get('/api/live');
  assert.equal(list.data.lives[0].id, id);
  assert.equal((await client(base).get('/api/live/user/streamer')).data.live.id, id);
  const guest = client(base);
  const join = await guest.post(`/api/live/${id}/join`);
  const peer = join.data.peer;
  assert.match(peer, /^[a-f0-9]{16}$/);
  await guest.post(`/api/live/${id}/offer`, { peer, sdp: 'v=0 offre' });
  const hostPoll = await host.get(`/api/live/${id}/host`);
  assert.equal(hostPoll.data.offers[0].peer, peer);
  assert.equal(hostPoll.data.viewers, 1);
  await host.post(`/api/live/${id}/answer`, { peer, sdp: 'v=0 réponse' });
  const poll = await guest.get(`/api/live/${id}/poll?peer=${peer}`);
  assert.equal(poll.data.answer, 'v=0 réponse');
  assert.equal((await guest.get(`/api/live/${id}/poll?peer=${peer}`)).data.answer, null); // donnée une seule fois
  await viewer.post(`/api/live/${id}/join`);
  await viewer.post(`/api/live/${id}/comment`, { body: 'Coucou !' });
  await guest.post(`/api/live/${id}/like`, { count: 7 });
  // Cadeau : sans pièces, refusé ; après une recharge (mode démo), accepté
  assert.equal((await viewer.post(`/api/live/${id}/gift`, { gift: 'rose', count: 3 })).status, 402);
  const top = await viewer.post('/api/wallet/checkout', { pack: 'p100', waiver: true });
  assert.equal(top.data.credited, 100);
  const gift = await viewer.post(`/api/live/${id}/gift`, { gift: 'couronne' });
  assert.equal(gift.status, 402); // 199 pièces
  const rose = await viewer.post(`/api/live/${id}/gift`, { gift: 'cafe', count: 2 });
  assert.equal(rose.data.coins, 80);
  const events = await host.get(`/api/live/${id}/host`);
  const types = events.data.events.map((e) => e.type);
  assert.ok(types.includes('join') && types.includes('comment') && types.includes('like') && types.includes('gift'));
  assert.equal(events.data.likes, 7);
  assert.equal(events.data.diamonds, 20);
  const wallet = await host.get('/api/wallet');
  assert.equal(wallet.data.diamonds, 20);
  const end = await host.post(`/api/live/${id}/end`);
  assert.equal(end.data.summary.likes, 7);
  assert.equal(end.data.summary.diamonds, 20);
  assert.equal((await guest.get(`/api/live/${id}/poll?peer=${peer}`)).data.ended, true);
  assert.equal((await guest.post(`/api/live/${id}/join`)).status, 410);
  const studio = await host.get('/api/studio?days=7');
  assert.equal(studio.data.lives[0].id, id);
});

test('portefeuille : historique et recharge invalide', async () => {
  const u = await signup(base, 'acheteur');
  assert.equal((await u.post('/api/wallet/checkout', { pack: 'inconnu', waiver: true })).status, 400);
  assert.equal((await u.post('/api/wallet/checkout', { pack: 'p350' })).status, 400); // sans renonciation
  await u.post('/api/wallet/checkout', { pack: 'p350', waiver: true });
  const w = await u.get('/api/wallet');
  assert.equal(w.data.coins, 350);
  assert.equal(w.data.history[0].kind, 'purchase');
  assert.ok(w.data.gifts.length >= 5);
});

test('statistiques du créateur', async () => {
  const c = await signup(base, 'createur');
  const v = await signup(base, 'regardeur');
  const p = await publishVideo(base, c, 'Stat');
  await v.post(`/api/posts/${p.id}/view`);
  await v.post(`/api/posts/${p.id}/like`);
  await v.post('/api/users/createur/follow');
  const s = await c.get('/api/studio?days=7');
  assert.equal(s.data.totals.views, 1);
  assert.equal(s.data.totals.likes, 1);
  assert.equal(s.data.totals.newFollowers, 1);
  assert.equal(s.data.series.length, 7);
  assert.equal(s.data.top[0].id, p.id);
});

test('signalement, file de modération, suspension de compte', async () => {
  const admin = client(base);
  await admin.post('/api/auth/login', { login: 'chef', password: 'motdepasse1' });
  const bad = await signup(base, 'mechant');
  const victim = await signup(base, 'victime');
  const post = await publishVideo(base, bad, 'Vidéo douteuse');
  assert.equal((await victim.post('/api/reports', { type: 'post', id: post.id, reason: 'spam' })).status, 201);
  const reports = await admin.get('/api/admin/reports');
  const rep = reports.data.reports.find((x) => x.target?.id === post.id);
  assert.ok(rep);
  await admin.post(`/api/admin/reports/${rep.id}/resolve`, { action: 'remove' });
  assert.equal((await client(base).get(`/api/posts/${post.id}`)).status, 404);
  const users = await admin.get('/api/admin/users?q=mechant');
  await admin.post(`/api/admin/users/${users.data.users[0].id}/ban`);
  assert.equal((await bad.get('/api/session')).data.user, null);
  const relog = await client(base).post('/api/auth/login', { login: 'mechant', password: 'motdepasse1' });
  assert.equal(relog.status, 403);
  assert.equal((await client(base).get('/api/users/mechant')).status, 404);
  const overview = await admin.get('/api/admin/overview');
  assert.ok(overview.data.totals.users > 10);
  assert.equal((await victim.get('/api/admin/overview')).status, 403);
});

test('suppression du compte et export des données', async () => {
  const u = await signup(base, 'partant');
  const other = await signup(base, 'restant');
  const p = await publishVideo(base, u, 'Bientôt effacée');
  await other.post(`/api/posts/${p.id}/like`);
  await u.post('/api/conversations/restant', { body: 'Au revoir' });
  const exp = await u.get('/api/me/export');
  assert.equal(exp.data.profile.username, 'partant');
  assert.equal(exp.data.posts.length, 1);
  assert.equal((await u.del('/api/me', { password: 'mauvais' })).status, 400);
  assert.equal((await u.del('/api/me', { password: 'motdepasse1' })).status, 200);
  assert.equal((await client(base).get('/api/users/partant')).status, 404);
  assert.equal((await client(base).get(`/api/posts/${p.id}`)).status, 404);
  assert.equal((await other.get('/api/conversations')).data.conversations.length, 0);
  const left = await srv.ctx.db.get('SELECT COUNT(*) AS n FROM videos WHERE owner_id = ?', u.user.id);
  assert.equal(left.n, 0);
});

test('mot de passe oublié puis réinitialisation', async () => {
  await signup(base, 'oublieux');
  const c = client(base);
  await c.post('/api/auth/forgot', { email: 'oublieux@exemple.fr' });
  const mail = srv.mails.findLast((m) => /mot de passe/i.test(m.subject));
  const token = /jeton=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
  assert.equal((await c.post('/api/auth/reset', { token, password: 'nouveau123' })).status, 200);
  assert.equal((await client(base).post('/api/auth/login', { login: 'oublieux', password: 'nouveau123' })).status, 200);
  assert.equal((await c.post('/api/auth/reset', { token, password: 'encore1234' })).status, 400); // lien déjà utilisé
});

test('contenu de démonstration : ajout et retrait depuis l’administration', async () => {
  const admin = client(base);
  await admin.post('/api/auth/login', { login: 'chef', password: 'motdepasse1' });
  const add = await admin.post('/api/admin/demo', { action: 'add' });
  assert.equal(add.data.added, true);
  assert.equal(add.data.posts, 14);
  const prof = await client(base).get('/api/users/synthwave.lab');
  assert.equal(prof.data.user.demo, true);
  const rm = await admin.post('/api/admin/demo', { action: 'remove' });
  assert.equal(rm.data.removed, 12);
  assert.equal((await client(base).get('/api/users/synthwave.lab')).status, 404);
});

test('pages de l’application, 404, robots et accord avec vercel.json', async () => {
  for (const p of ['/', '/explorer', '/@alice', '/@alice/video/1', '/tag/danse', '/son/1', '/live', '/messages/bob', '/reglages']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
  }
  assert.equal((await fetch(`${base}/nimporte/quoi`)).status, 404);
  assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Sitemap:/);
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const { PAGE_SOURCE } = require('../src/pages');
  assert.equal(vercel.rewrites[0].source, `/(${PAGE_SOURCE.replace('(?:|', '(?:')})?`);
});
