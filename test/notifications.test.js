'use strict';
// Notifications : contenu des notifications du téléphone (nom et photo de la personne, J'aime
// regroupés par publication, messages par personne, total pour la pastille de l'icône) et
// nouveautés renvoyées avec les compteurs (bannière et son dans l'application).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, signup, publishVideo } = require('./helpers');

let srv;
let base;
const pushes = [];
before(async () => {
  srv = await startServer({ realtime: 'poll' }, { pushSender: async (_sub, body) => pushes.push(JSON.parse(body)) });
  base = srv.base;
});
after(async () => srv.close());

const last = () => pushes[pushes.length - 1];

test('notifications du téléphone : titre, texte, regroupement, pastille', async () => {
  const lea = await signup(base, 'notif_lea', { displayName: 'Léa' });
  const nora = await signup(base, 'notif_nora', { displayName: 'Nora' });
  const sub = await lea.post('/api/push/subscribe', { endpoint: 'https://push.exemple.fr/abonnement-lea', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } });
  assert.equal(sub.status, 201);

  await nora.post('/api/users/notif_lea/follow');
  assert.equal(last().title, 'Nora');
  assert.equal(last().body, 'a commencé à te suivre.');
  assert.equal(last().kind, 'follow');
  assert.equal(typeof last().nid, 'number');
  assert.equal(last().count, 1);

  const post = await publishVideo(base, lea, 'Coucher de soleil');
  await nora.post(`/api/posts/${post.id}/like`);
  assert.equal(last().kind, 'like');
  assert.equal(last().body, 'a aimé ta vidéo.');
  assert.equal(last().tag, `like-${post.id}`);
  assert.equal(last().renotify, false); // un J'aime de plus met à jour la notification sans resonner
  assert.equal(last().what, 'ta vidéo');

  await nora.post('/api/conversations/notif_lea', { body: 'Tu viens ce soir ?' });
  assert.equal(last().kind, 'dm');
  assert.equal(last().title, 'Nora');
  assert.equal(last().body, 'Tu viens ce soir ?');
  assert.match(last().tag, /^dm-\d+$/);
  assert.equal(typeof last().mid, 'number');
  assert.equal(last().count, 3); // 2 notifications + 1 message

  // Réglage « J'aime et cadeaux » coupé : plus de notification pour les J'aime
  await lea.patch('/api/me/settings', { notify: { likes: false } });
  const before2 = pushes.length;
  const post2 = await publishVideo(base, lea, 'Deuxième');
  await nora.post(`/api/posts/${post2.id}/like`);
  assert.equal(pushes.length, before2);
});

test('compteurs : ce qui vient d’arriver depuis les derniers éléments vus', async () => {
  const sam = await signup(base, 'notif_sam', { displayName: 'Sam' });
  const ines = await signup(base, 'notif_ines', { displayName: 'Inès' });
  // Sans repères : les compteurs seuls
  const plain = await sam.get('/api/counters');
  assert.equal(plain.data.fresh, undefined);
  // Premier passage : les repères, sans rien annoncer
  const first = await sam.get('/api/counters?n=&m=');
  assert.equal(first.data.fresh.notification, null);
  assert.equal(first.data.fresh.message, null);
  const { n, m } = first.data.fresh.top;

  await ines.post('/api/users/notif_sam/follow');
  await ines.post('/api/conversations/notif_sam', { body: 'Coucou Sam !' });
  const next = await sam.get(`/api/counters?n=${n}&m=${m}`);
  assert.equal(next.data.notifications, 1);
  assert.equal(next.data.messages, 1);
  assert.equal(next.data.fresh.notification.type, 'follow');
  assert.equal(next.data.fresh.notification.actor.displayName, 'Inès');
  assert.equal(next.data.fresh.message.body, 'Coucou Sam !');
  assert.equal(next.data.fresh.message.from.username, 'notif_ines');
  assert.ok(next.data.fresh.top.n > n && next.data.fresh.top.m > m);

  // Repères à jour : plus rien de nouveau
  const after2 = await sam.get(`/api/counters?n=${next.data.fresh.top.n}&m=${next.data.fresh.top.m}`);
  assert.equal(after2.data.fresh.notification, null);
  assert.equal(after2.data.fresh.message, null);

  // Message lu : il n'est plus annoncé
  await sam.post('/api/conversations/notif_ines/read');
  const read = await sam.get(`/api/counters?n=${n}&m=${m}`);
  assert.equal(read.data.fresh.message, null);
});
