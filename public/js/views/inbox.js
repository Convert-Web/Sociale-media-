// Boîte de réception (nouveaux abonnés, activité, demandes, conversations) et page Activité (filtres).
import { api, enc } from '../api.js';
import { store, fastPoll } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, timeAgo, emptyState, spinner, toast, verifiedMark, scrollRoot } from '../dom.js';
import { followButton } from '../components/userlist.js';
import { pickUser } from './messages.js';
import { inviteFriends } from '../components/invite.js';

// « ta vidéo », « ta photo », « tes photos », « ta publication » selon la publication
const what = (n) => ({ photo: 'ta photo', photos: 'tes photos', text: 'ta publication' })[n.post?.kind] || 'ta vidéo';
const TEXTS = {
  like: (n) => `a aimé ${what(n)}.`,
  favorite: (n) => `a ajouté ${what(n)} à ses favoris.`,
  comment_like: 'a aimé ton commentaire',
  comment: 'a commenté',
  reply: 'a répondu à ton commentaire',
  mention: 'parle de toi',
  follow: 'a commencé à te suivre.',
  follow_request: 'souhaite s’abonner à ton compte.',
  follow_accept: 'a accepté ta demande d’abonnement.',
  invite_joined: 'a rejoint AURUM grâce à ton invitation 🎉',
  repost: (n) => `a republié ${what(n)}.`,
  duet: 'a fait un Duo avec ta vidéo.',
  stitch: 'a fait un Stitch de ta vidéo.',
  live: 'est en LIVE',
  gift: 't’a envoyé un cadeau.',
};

// Regroupement : « Léa et 3 autres personnes ont aimé ta vidéo » (même publication, même
// commentaire, ou nouveaux abonnés du même jour)
const GROUP_TEXTS = {
  like: (n) => `ont aimé ${what(n)}.`,
  favorite: (n) => `ont ajouté ${what(n)} à leurs favoris.`,
  comment_like: 'ont aimé ton commentaire',
  repost: (n) => `ont republié ${what(n)}.`,
  follow: 'ont commencé à te suivre.',
};
const say = (t, n) => (typeof t === 'function' ? t(n) : t);
const dayOf = (ms) => new Date(ms).toDateString();
function groupKey(n) {
  if (!GROUP_TEXTS[n.type]) return null;
  if (n.type === 'follow') return `follow:${dayOf(n.createdAt)}`;
  if (n.type === 'comment_like') return n.commentId ? `cl:${n.commentId}` : null;
  return n.post ? `${n.type}:${n.post.id}` : null;
}
function groupNotifications(list, { followers = false } = {}) {
  const out = [];
  const index = new Map();
  for (const n of list) {
    const k = followers && n.type === 'follow' ? null : groupKey(n);
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
    h('span', { class: 'n-text' }, h('b', null, n.actor.displayName), n.actor.verified ? verifiedMark() : null, ` et ${others} autre${others > 1 ? 's' : ''} personne${others > 1 ? 's' : ''} ${say(GROUP_TEXTS[n.type], n)}`, quote, h('small', null, timeAgo(n.createdAt))),
    right,
  );
}

export function notifLink(n) {
  if (['follow', 'follow_accept', 'follow_request', 'invite_joined'].includes(n.type)) return `/@${n.actor.username}`;
  if (n.type === 'live') return `/live/${n.actor.username}`;
  if (n.post) return `/@${enc(n.post.author || store.user.username)}/video/${n.post.id}${n.commentId ? `?commentaire=${n.commentId}${n.commentParentId ? `&fil=${n.commentParentId}` : ''}` : ''}`;
  return `/@${n.actor.username}`;
}

// Texte court d'une notification (bannière dans l'application) : « a aimé ta vidéo. », « a commenté : … »
export function notifSummary(n) {
  const text = say(TEXTS[n.type], n) || 'a interagi avec toi.';
  const quoted = n.body && ['comment', 'reply', 'mention', 'live'].includes(n.type);
  return quoted ? `${text.replace(/\.$/, '')} : ${n.body.slice(0, 120)}` : text;
}

function notifRow(n) {
  const text = say(TEXTS[n.type], n) || 'a interagi avec toi.';
  const quote = n.body && ['comment', 'reply', 'mention', 'comment_like', 'live'].includes(n.type) ? h('span', { class: 'n-quote' }, ` : ${n.body.slice(0, 90)}`) : null;
  let right = null;
  if (n.post?.image) right = h('img', { class: 'n-thumb', src: n.post.image, alt: '' });
  else if ((n.type === 'follow' || n.type === 'invite_joined') && !n.followingBack) right = followButton({ id: n.actor.id, username: n.actor.username, isFollowing: false, followsYou: true, requested: false });
  // Demande d'abonnement : accepter ou refuser sur place
  if (n.type === 'follow_request' && n.pendingRequest) {
    right = h('span', { class: 'n-req' });
    const act = async (a) => {
      try {
        await api.post(`/api/me/requests/${enc(n.actor.username)}/${a}`);
        right.replaceChildren(h('small', { class: 'muted' }, a === 'accept' ? 'Acceptée' : 'Refusée'));
        store.setCounters({ requests: Math.max(0, (store.counters.requests || 0) - 1) });
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
  ctx.title = 'Boîte de réception — AURUM';
  const c = store.counters;
  const row = (href, ic, cls, title, sub, count) =>
    h('a', { href, class: 'inbox-row' }, h('span', { class: `inbox-ic ${cls}` }, icon(ic)), h('span', { class: 'inbox-text' }, h('b', null, title), h('small', null, sub)), count ? h('span', { class: 'badge-count' }, count > 99 ? '99+' : String(count)) : icon('chevron', 'icon-sm'));
  const convs = h('div', { class: 'conv-list' }, spinner());
  const newBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Nouveau message', onclick: () => pickUser('Nouveau message', (u) => navigate(`/messages/${enc(u.username)}`)) }, icon('pen'));
  const root = h(
    'div',
    { class: 'page inbox' },
    h('header', { class: 'page-head' }, h('span', { class: 'icon-btn' }), h('h1', null, 'Boîte de réception'), newBtn),
    // Inviter des amis : en tête de la boîte, un toucher ouvre l'invitation à son nom
    h('button', { type: 'button', class: 'inbox-row invite-row', onclick: () => inviteFriends() }, h('span', { class: 'inbox-ic grad' }, icon('userPlus')), h('span', { class: 'inbox-text' }, h('b', null, 'Invite tes amis'), h('small', null, 'Plus on est, plus c’est fun : envoie ton lien')), icon('chevron', 'icon-sm')),
    row('/activite?type=followers', 'friends', 'blue', 'Nouveaux abonnés', 'Qui a commencé à te suivre', 0),
    row('/activite', 'bell', 'pink', 'Activité', 'J’aime, commentaires, mentions…', c.notifications),
    c.requests ? row('/activite?type=demandes', 'userPlus', 'violet', 'Demandes d’abonnement', `${c.requests} en attente`, c.requests) : null,
    h('h2', { class: 'section-title' }, 'Messages'),
    convs,
  );
  try {
    const { conversations } = await api.get('/api/conversations');
    convs.replaceChildren(...(conversations.length ? conversations.map((c) => convRow(c)) : [emptyState('send', 'Aucun message', 'Écris à tes amis ou partage-leur des vidéos.', h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => newBtn.click() }, 'Nouveau message'))]));
  } catch (err) {
    convs.replaceChildren(emptyState('alert', 'Messages indisponibles', err.message));
  }
  const off = store.on('rt:message', () => api.get('/api/conversations').then(({ conversations }) => conversations.length && convs.replaceChildren(...conversations.map((c) => convRow(c)))).catch(() => {}));
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

function preview(c) {
  const last = c.lastMessage;
  // Non lus derrière son propre dernier message : on annonce les nouveaux messages
  if (c.unread && last.fromMe) return `${c.unread > 9 ? '9+' : c.unread} nouveau${c.unread > 1 ? 'x' : ''} message${c.unread > 1 ? 's' : ''}`;
  if (!last.body && last.post) return last.fromMe ? 'Tu as partagé une publication' : 'A partagé une publication';
  return `${last.fromMe ? (last.seen ? 'Vu · ' : 'Toi : ') : ''}${last.body}`;
}

// Série (🔥 jours d'affilée à s'écrire) ; ⏳ : elle s'arrête ce soir si personne n'écrit
export function streakChip(st) {
  if (!st?.days) return null;
  return h('span', { class: `streak${st.atRisk ? ' risk' : ''}`, title: st.atRisk ? `Série de ${st.days} jours : écrivez-vous aujourd’hui pour la garder` : `Série de ${st.days} jours d’affilée` }, `🔥 ${st.days >= 120 ? '120+' : st.days}`, st.atRisk ? ' ⏳' : null);
}

export function convRow(c, active = false) {
  const last = c.lastMessage;
  return h(
    'a',
    { href: `/messages/${enc(c.user.username)}`, class: `conv${c.unread ? ' unread' : ''}${active === true ? ' active' : ''}` },
    avatar(c.user, 'md', { presence: true }),
    h('span', { class: 'conv-text' }, h('b', null, h('span', { class: 'conv-name' }, c.user.displayName), streakChip(c.streak)), h('small', null, preview(c))),
    h('span', { class: 'conv-meta' }, h('small', null, timeAgo(last.createdAt)), c.unread ? h('span', { class: 'dot' }) : null),
  );
}

// Types de notification de chaque filtre (comme le serveur)
const FILTER_TYPES = {
  likes: ['like', 'favorite', 'comment_like'],
  comments: ['comment', 'reply'],
  mentions: ['mention'],
  followers: ['follow', 'follow_accept', 'follow_request', 'invite_joined'],
  other: ['repost', 'duet', 'stitch', 'live', 'gift'],
};
const EMPTY = {
  '': ['Rien de nouveau', 'Les J’aime, commentaires et nouveaux abonnés apparaîtront ici.'],
  likes: ['Aucun J’aime pour l’instant', 'Les J’aime et favoris sur tes publications apparaîtront ici.'],
  comments: ['Aucun commentaire pour l’instant', 'Les commentaires et réponses apparaîtront ici.'],
  mentions: ['Aucune mention', 'Quand quelqu’un écrit @' + 'ton nom, tu le verras ici.'],
  followers: ['Aucun nouvel abonné', 'Les personnes qui commencent à te suivre apparaîtront ici.'],
  other: ['Rien pour l’instant', 'Duos, Stitchs, republications, LIVE et cadeaux apparaîtront ici.'],
};
const FILTERS = [
  ['', 'Toute l’activité'],
  ['likes', 'J’aime et favoris'],
  ['comments', 'Commentaires'],
  ['mentions', 'Mentions'],
  ['followers', 'Abonnés'],
  ['other', 'Duos, republications, LIVE'],
];

export async function activityView(ctx) {
  const type = ctx.query.get('type') || '';
  const requestsOnly = type === 'demandes';
  ctx.title = requestsOnly ? 'Demandes d’abonnement — AURUM' : 'Activité — AURUM';
  const back = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/boite')) }, icon('back'));
  const chips = requestsOnly ? null : h('div', { class: 'chips' }, FILTERS.map(([k, label]) => h('a', { href: k ? `/activite?type=${k}` : '/activite', class: `chip${k === type ? ' on' : ''}` }, label)));
  const list = h('div', { class: 'n-list' }, spinner());
  const root = h('div', { class: 'page activity' }, h('header', { class: 'page-head' }, back, h('h1', null, requestsOnly ? 'Demandes d’abonnement' : 'Activité'), h('span', { class: 'icon-btn' })), chips);
  // Filtre choisi visible dans la rangée (téléphone)
  if (chips) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const on = chips.querySelector('.on');
      if (on && chips.isConnected) chips.scrollLeft = Math.max(0, on.offsetLeft - (chips.clientWidth - on.offsetWidth) / 2);
    }));
  }
  let requestsShown = false;

  // Demandes d'abonnement (compte privé)
  if (type === 'demandes' || (!type && store.counters.requests)) {
    try {
      const { users } = await api.get('/api/me/requests');
      if (users.length) {
        requestsShown = true;
        root.append(h('section', { class: 'requests' }, requestsOnly ? null : h('h2', { class: 'section-title' }, 'Demandes d’abonnement'), users.map((u) => {
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
          return h('div', { class: 'n-row' }, h('a', { href: `/@${enc(u.username)}`, 'aria-label': u.displayName }, avatar(u, 'md')), h('a', { class: 'n-text', href: `/@${enc(u.username)}` }, h('b', null, u.displayName), h('small', null, `@${u.username}`)), actions);
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
      // Demandes déjà proposées en haut (Accepter / Refuser) : pas une seconde fois dans la liste
      const shown = d.notifications.filter((n) => !(requestsShown && n.type === 'follow_request' && n.pendingRequest));
      for (const g of groupNotifications(shown, { followers: type === 'followers' })) list.append(groupRow(g));
      if (!before && !shown.length) list.append(emptyState('bell', ...(EMPTY[type] || EMPTY[''])));
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
  // Ouverte : ce qui est affiché est lu (seulement le filtre choisi)
  const markRead = () =>
    api.post(`/api/notifications/read${type ? `?type=${enc(type)}` : ''}`)
      .then(() => (type ? api.get('/api/counters').then((c) => store.setCounters(c)) : store.setCounters({ notifications: 0 })))
      .catch(() => {});
  markRead();
  let readTimer = 0;
  const off = store.on('rt:notification', (n) => {
    if (n && (!type || FILTER_TYPES[type]?.includes(n.type))) {
      list.querySelector(':scope > .empty')?.remove();
      list.prepend(notifRow(n));
      // Vue à l'écran : lue (après un court instant, plusieurs arrivées = un seul appel)
      clearTimeout(readTimer);
      readTimer = setTimeout(() => !document.hidden && markRead(), 1500);
    } else if (!n) {
      // Rafraîchissement régulier : la première page est relue
      before = null;
      more = true;
      load().then(markRead);
    }
  });
  ctx.onCleanup(() => clearTimeout(readTimer));
  ctx.onCleanup(off);
  ctx.onCleanup(fastPoll());
  return root;
}
