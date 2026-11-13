import { api, enc } from '../api.js';
import { store } from '../store.js';
import { h, icon, avatar, memberChip, clear, spinner, emptyState, debounce, num } from '../dom.js';
import { postCard } from '../components/post.js';
import { userRow, followButton } from './profile.js';

function memberCardSmall(u) {
  return h(
    'div',
    { class: 'member-card' },
    h('a', { href: `/@${u.username}` }, avatar(u, 'lg')),
    h(
      'a',
      { href: `/@${u.username}`, class: 'meta' },
      h('span', { class: 'name-line' }, h('b', null, u.displayName), u.founder ? icon('crown', 'crown') : null),
      h('small', null, u.profession || `@${u.username}`),
      memberChip(u),
    ),
    u.isMe ? null : followButton(u, 'btn-sm'),
  );
}

export function exploreView(ctx) {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Membres, métiers, villes, #sujets…', value: ctx.query.get('q') || '', 'aria-label': 'Rechercher' });
  const results = h('div');

  async function showDefault() {
    clear(results).append(spinner());
    const [{ tags }, { users: newest }, { users: suggested }] = await Promise.all([
      api.get('/api/trending'),
      api.get('/api/members'),
      api.get('/api/suggestions?limit=6'),
    ]);
    clear(results);
    if (tags.length) {
      results.append(
        h('div', { class: 'section-title' }, 'Tendances du cercle'),
        h(
          'div',
          { class: 'chips' },
          tags.map((t) => h('a', { class: 'chip', href: `/explorer?q=${enc(`#${t.tag}`)}` }, `#${t.tag}`, h('small', null, num(t.count)))),
        ),
      );
    }
    if (suggested.length) {
      results.append(h('div', { class: 'section-title' }, 'À découvrir'), h('div', { class: 'explore-list' }, suggested.map((u) => userRow(u))));
    }
    results.append(h('div', { class: 'section-title' }, 'Derniers arrivés'), h('div', { class: 'member-grid' }, newest.map(memberCardSmall)));
  }

  async function search(q) {
    clear(results).append(spinner());
    const { users, posts } = await api.get(`/api/search?q=${enc(q)}`);
    if (input.value.trim() !== q) return;
    clear(results);
    if (!users.length && !posts.length) {
      results.append(emptyState('search', 'Aucun résultat', `Rien ne correspond à « ${q} » pour le moment.`));
      return;
    }
    if (users.length) results.append(h('div', { class: 'section-title' }, 'Membres'), h('div', { class: 'explore-list' }, users.map((u) => userRow(u))));
    if (posts.length) results.append(h('div', { class: 'section-title' }, 'Publications'), posts.map((p) => postCard(p)));
  }

  const run = () => {
    const q = input.value.trim();
    const url = q ? `/explorer?q=${enc(q)}` : '/explorer';
    history.replaceState(null, '', url);
    (q ? search(q) : showDefault()).catch((err) => {
      clear(results).append(h('p', { class: 'muted', style: { padding: '20px' } }, err.message));
    });
  };
  input.addEventListener('input', debounce(run, 300));
  run();

  // Raccourcis (indispensables sur téléphone, où la barre d'onglets est limitée à 5 entrées)
  const reqBadge = h('span', { class: 'badge-count', hidden: true });
  const paintReq = (c) => {
    reqBadge.hidden = !c.requests;
    reqBadge.textContent = c.requests > 99 ? '99+' : String(c.requests || '');
  };
  paintReq(store.counters || {});
  ctx.onCleanup(store.on('counters', paintReq));
  const shortcut = (href, ic, label, sub, extra) => h('a', { href, class: 'shortcut' }, h('span', { class: 'shortcut-icon' }, icon(ic), extra || null), h('b', null, label), h('small', null, sub));
  const shortcuts = h(
    'div',
    { class: 'shortcuts' },
    shortcut('/amis', 'users', 'Amis', 'Vos relations', reqBadge),
    shortcut('/groupes', 'groups', 'Groupes', 'Cercles privés'),
    shortcut('/enregistres', 'bookmark', 'Enregistrés', 'Vos favoris'),
  );

  ctx.title = 'Explorer — AURUM';
  return h(
    'div',
    null,
    h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, 'Explorer'), h('div', { class: 'sub' }, 'Les membres et les sujets du cercle'))),
    h('div', { class: 'explore-search' }, h('div', { class: 'search-box' }, icon('search'), input)),
    shortcuts,
    results,
  );
}
