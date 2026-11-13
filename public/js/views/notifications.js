import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon, avatar, clear, spinner, emptyState, timeAgo, infinite } from '../dom.js';

const TYPES = {
  like: { icon: 'heart', text: 'a aimé votre publication' },
  comment: { icon: 'comment', text: 'a commenté votre publication' },
  follow: { icon: 'userPlus', text: 'a commencé à vous suivre' },
  mention: { icon: 'at', text: 'vous a mentionné' },
};

function notifEl(n) {
  const t = TYPES[n.type] || { icon: 'bell', text: 'a interagi avec vous' };
  const href = n.post ? `/p/${n.post.id}` : `/@${n.actor.username}`;
  return h(
    'a',
    { href, class: `notif${n.read ? '' : ' unread'}` },
    h('span', { class: 'notif-icon' }, icon(t.icon)),
    h(
      'div',
      { class: 'notif-main' },
      avatar(n.actor, 'sm'),
      h('div', { class: 'notif-text' }, h('b', null, n.actor.displayName), ` ${t.text}`, h('span', { class: 'muted' }, ` · ${timeAgo(n.createdAt)}`)),
      n.post && n.post.excerpt ? h('div', { class: 'notif-excerpt' }, n.post.excerpt) : null,
    ),
  );
}

export function notificationsView(ctx) {
  const list = h('div');
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
        if (!notifications.length) list.append(emptyState('bell', 'Tout est calme', 'Les mentions, réponses et nouveaux abonnés apparaîtront ici.'));
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

  ctx.title = 'Notifications — AURUM';
  return h(
    'div',
    null,
    h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, 'Notifications'), h('div', { class: 'sub' }, 'Ce qui se passe autour de vous'))),
    list,
    loader,
    sentinel,
  );
}
