// Boîte de réception (nouveaux abonnés, activité, demandes, conversations) et page Activité (filtres).
import { api, enc } from '../api.js';
import { store, fastPoll } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, timeAgo, emptyState, spinner, toast, verifiedMark, scrollRoot } from '../dom.js';
import { followButton } from '../components/userlist.js';
import { pickUser } from './messages.js';

const TEXTS = {
  like: 'a aimé ta vidéo.',
  favorite: 'a ajouté ta vidéo à ses favoris.',
  comment_like: 'a aimé ton commentaire',
  comment: 'a commenté',
  reply: 'a répondu à ton commentaire',
  mention: 'parle de toi',
  follow: 'a commencé à te suivre.',
  follow_request: 'souhaite s’abonner à ton compte.',
  follow_accept: 'a accepté ta demande d’abonnement.',
  repost: 'a republié ta vidéo.',
  duet: 'a fait un Duo avec ta vidéo.',
  stitch: 'a fait un Stitch de ta vidéo.',
  live: 'est en LIVE',
  gift: 't’a envoyé un cadeau.',
};

// Regroupement : « Léa et 3 autres personnes ont aimé ta vidéo » (même vidéo, même commentaire,
// ou nouveaux abonnés du même jour)
const GROUP_TEXTS = {
  like: 'ont aimé ta vidéo.',
  favorite: 'ont ajouté ta vidéo à leurs favoris.',
  comment_like: 'ont aimé ton commentaire',
  repost: 'ont republié ta vidéo.',
  follow: 'ont commencé à te suivre.',
};
const dayOf = (ms) => new Date(ms).toDateString();
function groupKey(n) {
  if (!GROUP_TEXTS[n.type]) return null;
  if (n.type === 'follow') return `follow:${dayOf(n.createdAt)}`;
  if (n.type === 'comment_like') return n.commentId ? `cl:${n.commentId}` : null;
  return n.post ? `${n.type}:${n.post.id}` : null;
}
function groupNotifications(list) {
  const out = [];
  const index = new Map();
  for (const n of list) {
    const k = groupKey(n);
    const g = k ? index.get(k) : null;
    if (g && g[0].createdAt - n.createdAt < 7 * 86400e3) {
      if (!g.some((x) => x.actor.id === n.actor.id)) g.push(n);
      continue;
    }
    const fresh = [n];
    out.push(fresh);
    if (k) index.set(k, fresh);
  }
  return out;
}
function groupRow(items) {
  if (items.length === 1) return notifRow(items[0]);
  const [n, second] = items;
  const others = items.length - 1;
  const quote = n.type === 'comment_like' && n.body ? h('span', { class: 'n-quote' }, ` : ${n.body.slice(0, 90)}`) : null;
  const right = n.post?.image ? h('img', { class: 'n-thumb', src: n.post.image, alt: '' }) : null;
  return h(
    'a',
    { href: n.type === 'follow' ? '/activite?type=followers' : notifLink(n), class: `n-row${items.some((x) => !x.read) ? ' unread' : ''}` },
    h('span', { class: 'n-stack' }, avatar(second.actor, 'sm'), avatar(n.actor, 'sm')),
    h('span', { class: 'n-text' }, h('b', null, n.actor.displayName), n.actor.verified ? verifiedMark() : null, ` et ${others} autre${others > 1 ? 's' : ''} personne${others > 1 ? 's' : ''} ${GROUP_TEXTS[n.type]}`, quote, h('small', null, timeAgo(n.createdAt))),
    right,
  );
}

function notifLink(n) {
  if (['follow', 'follow_accept', 'follow_request'].includes(n.type)) return `/@${n.actor.username}`;
  if (n.type === 'live') return `/live/${n.actor.username}`;
  if (n.post) return `/@${store.user.username}/video/${n.post.id}${n.commentId ? `?commentaire=${n.commentId}` : ''}`;
  return `/@${n.actor.username}`;
}

function notifRow(n) {
  const text = TEXTS[n.type] || 'a interagi avec toi.';
  const quote = n.body && ['comment', 'reply', 'mention', 'comment_like', 'live'].includes(n.type) ? h('span', { class: 'n-quote' }, ` : ${n.body.slice(0, 90)}`) : null;
  let right = null;
  if (n.post?.image) right = h('img', { class: 'n-thumb', src: n.post.image, alt: '' });
  else if (n.type === 'follow' && !n.followingBack) right = followButton({ id: n.actor.id, username: n.actor.username, isFollowing: false, followsYou: true, requested: false });
  // Demande d'abonnement : accepter ou refuser sur place
  if (n.type === 'follow_request' && n.pendingRequest) {
    right = h('span', { class: 'n-req' });
    const act = async (a) => {
      try {
        await api.post(`/api/me/requests/${enc(n.actor.username)}/${a}`);
        right.replaceChildren(h('small', { class: 'muted' }, a === 'accept' ? 'Acceptée' : 'Refusée'));
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    right.append(h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: (e) => { e.preventDefault(); act('accept'); } }, 'Accepter'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => { e.preventDefault(); act('decline'); } }, 'Refuser'));
  }
  return h(
    'a',
    { href: notifLink(n), class: `n-row${n.read ? '' : ' unread'}` },
    avatar(n.actor, 'md'),
    h('span', { class: 'n-text' }, h('b', null, n.actor.displayName), n.actor.verified ? verifiedMark() : null, ` ${text}`, quote, h('small', null, timeAgo(n.createdAt))),
    right,
  );
}

export async function inboxView(ctx) {
  ctx.title = 'Boîte de réception — Vibz';
  const c = store.counters;
  const row = (href, ic, cls, title, sub, count) =>
    h('a', { href, class: 'inbox-row' }, h('span', { class: `inbox-ic ${cls}` }, icon(ic)), h('span', { class: 'inbox-text' }, h('b', null, title), h('small', null, sub)), count ? h('span', { class: 'badge-count' }, count > 99 ? '99+' : String(count)) : icon('chevron', 'icon-sm'));
  const convs = h('div', { class: 'conv-list' }, spinner());
  const newBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Nouveau message', onclick: () => pickUser('Nouveau message', (u) => navigate(`/messages/${enc(u.username)}`)) }, icon('pen'));
  const root = h(
    'div',
    { class: 'page inbox' },
    h('header', { class: 'page-head' }, h('span', { class: 'icon-btn' }), h('h1', null, 'Boîte de réception'), newBtn),
    row('/activite?type=followers', 'friends', 'blue', 'Nouveaux abonnés', 'Qui a commencé à te suivre', 0),
    row('/activite', 'bell', 'pink', 'Activité', 'J’aime, commentaires, mentions…', c.notifications),
    c.requests ? row('/activite?type=demandes', 'userPlus', 'violet', 'Demandes d’abonnement', `${c.requests} en attente`, c.requests) : null,
    h('h2', { class: 'section-title' }, 'Messages'),
    convs,
  );
  try {
    const { conversations } = await api.get('/api/conversations');
    convs.replaceChildren(...(conversations.length ? conversations.map(convRow) : [emptyState('send', 'Aucun message', 'Écris à tes amis ou partage-leur des vidéos.', h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => newBtn.click() }, 'Nouveau message'))]));
  } catch (err) {
    convs.replaceChildren(emptyState('alert', 'Messages indisponibles', err.message));
  }
  const off = store.on('rt:message', () => api.get('/api/conversations').then(({ conversations }) => conversations.length && convs.replaceChildren(...conversations.map(convRow))).catch(() => {}));
  // Pastilles « Activité » et « Demandes » tenues à jour
  const offCounters = store.on('counters', (n) => {
    const act = root.querySelector('a[href="/activite"]');
    if (act) act.replaceWith(row('/activite', 'bell', 'pink', 'Activité', 'J’aime, commentaires, mentions…', n.notifications));
    const req = root.querySelector('a[href="/activite?type=demandes"]');
    const fresh = n.requests ? row('/activite?type=demandes', 'userPlus', 'violet', 'Demandes d’abonnement', `${n.requests} en attente`, n.requests) : null;
    if (req && fresh) req.replaceWith(fresh);
    else if (req) req.remove();
    else if (fresh) root.querySelector('a[href="/activite"]')?.after(fresh);
  });
  ctx.onCleanup(off);
  ctx.onCleanup(offCounters);
  ctx.onCleanup(fastPoll());
  return root;
}

export function convRow(c, active = false) {
  const last = c.lastMessage;
  return h(
    'a',
    { href: `/messages/${enc(c.user.username)}`, class: `conv${c.unread ? ' unread' : ''}${active ? ' active' : ''}` },
    avatar(c.user, 'md', { presence: true }),
    h('span', { class: 'conv-text' }, h('b', null, c.user.displayName), h('small', null, `${last.fromMe ? (last.seen ? 'Vu · ' : 'Toi : ') : ''}${last.body}`)),
    h('span', { class: 'conv-meta' }, h('small', null, timeAgo(last.createdAt)), c.unread ? h('span', { class: 'dot' }) : null),
  );
}

const FILTERS = [
  ['', 'Toute l’activité'],
  ['likes', 'J’aime et favoris'],
  ['comments', 'Commentaires'],
  ['mentions', 'Mentions'],
  ['followers', 'Abonnés'],
  ['other', 'Duos, republications, LIVE'],
];

export async function activityView(ctx) {
  ctx.title = 'Activité — Vibz';
  const type = ctx.query.get('type') || '';
  const back = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/boite')) }, icon('back'));
  const chips = h('div', { class: 'chips' }, FILTERS.map(([k, label]) => h('a', { href: k ? `/activite?type=${k}` : '/activite', class: `chip${k === type ? ' on' : ''}` }, label)));
  const list = h('div', { class: 'n-list' }, spinner());
  const root = h('div', { class: 'page activity' }, h('header', { class: 'page-head' }, back, h('h1', null, 'Activité'), h('span', { class: 'icon-btn' })), chips);

  // Demandes d'abonnement (compte privé)
  if (type === 'demandes' || (!type && store.counters.requests)) {
    try {
      const { users } = await api.get('/api/me/requests');
      if (users.length) {
        root.append(h('section', { class: 'requests' }, h('h2', { class: 'section-title' }, 'Demandes d’abonnement'), users.map((u) => {
          const actions = h('span', { class: 'n-req' });
          const act = async (a) => {
            try {
              await api.post(`/api/me/requests/${enc(u.username)}/${a}`);
              actions.replaceChildren(h('small', { class: 'muted' }, a === 'accept' ? 'Acceptée' : 'Refusée'));
              store.setCounters({ requests: Math.max(0, store.counters.requests - 1) });
            } catch (err) {
              toast(err.message, 'error');
            }
          };
          actions.append(h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => act('accept') }, 'Accepter'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => act('decline') }, 'Refuser'));
          return h('div', { class: 'n-row' }, h('a', { href: `/@${enc(u.username)}` }, avatar(u, 'md')), h('span', { class: 'n-text' }, h('b', null, u.displayName), h('small', null, `@${u.username}`)), actions);
        })));
      } else if (type === 'demandes') {
        root.append(emptyState('userPlus', 'Aucune demande en attente', 'Les demandes d’abonnement à ton compte privé apparaîtront ici.'));
      }
    } catch {
      /* sans importance */
    }
  }
  if (type === 'demandes') return root;
  root.append(list);

  let before = null;
  let more = true;
  let loading = false;
  const sentinel = h('div', { class: 'grid-sentinel' });
  root.append(sentinel);
  const load = async () => {
    if (loading || !more) return;
    loading = true;
    try {
      const q = new URLSearchParams();
      if (type) q.set('type', type);
      if (before) q.set('before', before);
      const d = await api.get(`/api/notifications?${q}`);
      if (!before) list.replaceChildren();
      for (const g of groupNotifications(d.notifications)) list.append(groupRow(g));
      if (!before && !d.notifications.length) list.append(emptyState('bell', 'Rien de nouveau', 'Les J’aime, commentaires et nouveaux abonnés apparaîtront ici.'));
      more = d.hasMore;
      before = d.notifications[d.notifications.length - 1]?.id || null;
    } catch (err) {
      toast(err.message, 'error');
      more = false;
    } finally {
      loading = false;
    }
  };
  const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && load(), { root: scrollRoot(), rootMargin: '400px' });
  io.observe(sentinel);
  ctx.onCleanup(() => io.disconnect());
  await load();
  // Ouverte : tout est lu
  api.post('/api/notifications/read').then(() => store.setCounters({ notifications: 0 })).catch(() => {});
  const off = store.on('rt:notification', (n) => {
    if (n && !type) {
      list.querySelector(':scope > .empty')?.remove();
      list.prepend(notifRow(n));
    } else if (!n) {
      // Rafraîchissement régulier : la première page est relue
      before = null;
      more = true;
      load().then(() => api.post('/api/notifications/read').then(() => store.setCounters({ notifications: 0 })).catch(() => {}));
    }
  });
  ctx.onCleanup(off);
  ctx.onCleanup(fastPoll());
  return root;
}
