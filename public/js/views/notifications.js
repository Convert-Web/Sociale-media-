import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon, avatar, clear, spinner, emptyState, timeAgo, infinite } from '../dom.js';

const TYPES = {
  like: { icon: 'heart', text: 'a réagi à votre publication' },
  comment: { icon: 'comment', text: 'a commenté votre publication' },
  follow: { icon: 'userPlus', text: 'a commencé à vous suivre' },
  mention: { icon: 'at', text: 'vous a mentionné' },
  friend_request: { icon: 'userPlus', text: 'vous a envoyé une demande d’ami' },
  friend_accept: { icon: 'userCheck', text: 'a accepté votre demande d’ami' },
  group_invite: { icon: 'groups', text: (n) => `vous invite à rejoindre « ${n.group?.name || 'un groupe'} »` },
  group_request: { icon: 'groups', text: (n) => `souhaite rejoindre « ${n.group?.name || 'votre groupe'} »` },
  group_accept: { icon: 'groups', text: (n) => `vous a accueilli dans « ${n.group?.name || 'le groupe'} »` },
  event_join: { icon: 'calendar', text: (n) => `participera à « ${n.event?.title || 'votre événement'} »` },
  place_endorse: { icon: 'book', text: (n) => `recommande aussi « ${n.place?.name || 'votre adresse'} »` },
  invite_accepted: { icon: 'ticket', text: 'a accepté votre invitation et rejoint le cercle' },
  admission_request: { icon: 'ticket', text: 'demande à rejoindre le cercle' },
};

function notifEl(n) {
  const t = TYPES[n.type] || { icon: 'bell', text: 'a interagi avec vous' };
  const text = typeof t.text === 'function' ? t.text(n) : t.text;
  const href = n.post
    ? `/p/${n.post.id}`
    : n.type === 'friend_request'
      ? '/amis'
      : n.type === 'admission_request'
        ? '/admin'
        : n.event
          ? `/agenda/${n.event.id}`
          : n.place
            ? `/carnet/${n.place.id}`
            : n.group
              ? `/groupes/${n.group.id}`
              : `/@${n.actor.username}`;
  return h(
    'a',
    { href, class: `notif${n.read ? '' : ' unread'}` },
    h('span', { class: 'notif-icon' }, icon(t.icon)),
    h(
      'div',
      { class: 'notif-main' },
      avatar(n.actor, 'sm'),
      h('div', { class: 'notif-text' }, h('b', null, n.actor.displayName), ` ${text}`, h('span', { class: 'muted' }, ` · ${timeAgo(n.createdAt)}`)),
      n.post && n.post.excerpt ? h('div', { class: 'notif-excerpt' }, n.post.excerpt) : null,
    ),
  );
}

export function notificationsView(ctx) {
  const list = h('div', { class: 'notif-list' });
  const sentinel = h('div', { style: { height: '1px' } });
  const loader = spinner();
  let before = null;
  let done = false;
  let loading = false;
  let stop = () => {};
  let first = true;

  async function more() {
    if (loading || done) return;
    loading = true;
    try {
      const { notifications, hasMore } = await api.get(`/api/notifications${before ? `?before=${before}` : ''}`);
      for (const n of notifications) list.append(notifEl(n));
      if (notifications.length) before = notifications[notifications.length - 1].id;
      done = !hasMore;
      if (done) {
        loader.remove();
        stop();
      }
      if (first) {
        first = false;
        if (!notifications.length) list.replaceWith(emptyState('bell', 'Tout est calme', 'Les mentions, réponses et nouveaux abonnés apparaîtront ici.'));
        if (notifications.some((n) => !n.read)) {
          await api.post('/api/notifications/read');
          store.setCounters({ notifications: 0 });
        }
      }
    } catch (err) {
      clear(loader).append(h('p', { class: 'muted small' }, err.message));
      done = true;
    } finally {
      loading = false;
    }
  }

  ctx.onCleanup(
    store.on('rt:notification', (n) => {
      list.querySelector('.empty')?.remove();
      list.prepend(notifEl(n));
      api.post('/api/notifications/read').catch(() => {});
    }),
  );
  stop = infinite(sentinel, more);
  ctx.onCleanup(() => stop());
  more();

  // Bandeau « Demandes d'ami » façon Facebook
  const banner = h('div');
  const paintBanner = (n) => {
    banner.replaceChildren(
      n
        ? h('a', { href: '/amis', class: 'requests-banner' }, h('span', { class: 'requests-icon' }, icon('userPlus')), h('span', { class: 'grow' }, h('b', null, 'Demandes d’ami'), h('small', null, n > 1 ? `${n} personnes souhaitent vous ajouter` : 'Une personne souhaite vous ajouter')), h('span', { class: 'badge-dot' }, String(n)), icon('chevron', 'icon-sm'))
        : '',
    );
  };
  paintBanner(store.counters?.requests || 0);
  ctx.onCleanup(store.on('counters', (c) => paintBanner(c.requests || 0)));

  ctx.title = 'Notifications — AURUM';
  return h(
    'div',
    null,
    h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, 'Activité'), h('div', { class: 'sub' }, 'Ce qui se passe autour de vous'))),
    banner,
    list,
    loader,
    sentinel,
  );
}
