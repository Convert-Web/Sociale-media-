import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, memberChip, founderBadge, monthYear, richText, num, emptyState, modal, spinner, clear, toast, lightbox } from '../dom.js';
import { postList, backHead } from './feed.js';

export function userRow(u, { follow = true } = {}) {
  const btn = follow && !u.isMe ? followButton(u, 'btn-sm') : null;
  return h(
    'div',
    { class: 'user-row' },
    h('a', { href: `/@${u.username}` }, avatar(u)),
    h(
      'a',
      { href: `/@${u.username}`, class: 'meta' },
      h('span', { class: 'name-line' }, h('b', null, u.displayName), u.founder ? icon('crown', 'crown') : null),
      h('small', null, memberChip(u), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, `@${u.username}${u.profession ? ` · ${u.profession}` : ''}`)),
      u.bio ? h('span', { class: 'bio' }, u.bio) : null,
    ),
    btn,
  );
}

export function followButton(u, size = '') {
  const btn = h('button', { class: `btn ${size}` });
  const paint = () => {
    btn.className = `btn ${size} ${u.isFollowing ? 'btn-ghost' : 'btn-outline-gold'}`;
    btn.textContent = u.isFollowing ? 'Suivi' : 'Suivre';
  };
  btn.addEventListener('mouseenter', () => {
    if (u.isFollowing) btn.textContent = 'Ne plus suivre';
  });
  btn.addEventListener('mouseleave', paint);
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const was = u.isFollowing;
    u.isFollowing = !was;
    paint();
    try {
      if (was) await api.del(`/api/users/${enc(u.username)}/follow`);
      else await api.post(`/api/users/${enc(u.username)}/follow`);
      store.emit('follow:changed', { username: u.username, following: !was });
    } catch (err) {
      u.isFollowing = was;
      paint();
      toast(err.message, 'error');
    }
  });
  paint();
  return btn;
}

function relationModal(username, relation) {
  const body = h('div', { class: 'modal-body', style: { padding: '8px' } }, spinner());
  modal(relation === 'followers' ? 'Abonnés' : 'Abonnements', body);
  api
    .get(`/api/users/${enc(username)}/${relation}`)
    .then(({ users }) => {
      clear(body);
      if (!users.length) body.append(emptyState('users', 'Personne pour l’instant', null));
      for (const u of users) body.append(userRow(u));
    })
    .catch((err) => {
      clear(body);
      body.append(h('p', { class: 'muted', style: { padding: '16px' } }, err.message));
    });
}

export async function profileView(ctx) {
  const username = ctx.params.username;
  let user;
  try {
    ({ user } = await api.get(`/api/users/${enc(username)}`));
  } catch (err) {
    return h('div', null, backHead('Profil'), emptyState('user', 'Membre introuvable', err.message, h('a', { href: '/explorer', class: 'btn btn-ghost' }, 'Explorer le cercle')));
  }
  ctx.title = `${user.displayName} (@${user.username}) — AURUM`;

  const followersEl = h('b', null, num(user.stats.followers));
  const actions = user.isMe
    ? [h('a', { href: '/reglages', class: 'btn btn-ghost' }, 'Modifier le profil')]
    : [
        h('a', { href: `/messages/${user.username}`, class: 'btn btn-ghost btn-icon', 'aria-label': 'Envoyer un message', title: 'Message' }, icon('mail')),
        followButton(user),
      ];
  ctx.onCleanup(
    store.on('follow:changed', ({ username: un, following }) => {
      if (un.toLowerCase() !== user.username.toLowerCase()) return;
      user.stats.followers += following ? 1 : -1;
      followersEl.textContent = num(user.stats.followers);
    }),
  );

  const meta = [];
  if (user.profession) meta.push(h('span', null, icon('briefcase'), user.profession));
  if (user.city) meta.push(h('span', null, icon('pin'), user.city));
  if (user.website) {
    meta.push(h('a', { href: user.website, target: '_blank', rel: 'noopener noreferrer nofollow' }, icon('link'), user.website.replace(/^https?:\/\/(www\.)?/, '')));
  }
  meta.push(h('span', null, icon('calendar'), `Membre depuis ${monthYear(user.joinedAt)}`));

  const list = postList((before) => api.get(`/api/users/${enc(user.username)}/posts${before ? `?before=${before}` : ''}`), {
    empty: () =>
      emptyState('pen', user.isMe ? 'Votre première publication' : 'Aucune publication', user.isMe ? 'Présentez-vous au cercle : le Salon vous écoute.' : `${user.displayName} n'a encore rien publié.`),
  });
  ctx.onCleanup(list.start());
  if (user.isMe) ctx.onCleanup(store.on('post:created', (p) => list.prepend(p)));

  const coverEl = h('div', { class: 'cover' }, user.cover ? h('img', { src: user.cover, alt: '', style: { cursor: 'zoom-in' }, onclick: () => lightbox(user.cover) }) : null);
  const avatarEl = avatar(user, 'xl', { presence: !user.isMe });
  if (user.avatar) {
    avatarEl.style.cursor = 'zoom-in';
    avatarEl.addEventListener('click', () => lightbox(user.avatar));
  }

  return h(
    'div',
    null,
    backHead(user.displayName, `${num(user.stats.posts)} publication${user.stats.posts > 1 ? 's' : ''}`),
    coverEl,
    h(
      'section',
      { class: 'profile-top' },
      h('div', { class: 'profile-row' }, avatarEl, h('div', { class: 'profile-actions' }, actions)),
      h('div', { class: 'profile-name' }, h('h1', null, user.displayName), user.founder ? founderBadge() : null),
      h(
        'div',
        { class: 'profile-handle' },
        h('span', null, `@${user.username}`),
        memberChip(user),
        user.followsYou ? h('span', { class: 'tag' }, 'Vous suit') : null,
      ),
      user.bio ? h('p', { class: 'profile-bio' }, richText(user.bio)) : null,
      h('div', { class: 'profile-meta' }, meta),
      h(
        'div',
        { class: 'profile-stats' },
        h('button', { onclick: () => relationModal(user.username, 'following') }, h('b', null, num(user.stats.following)), 'abonnements'),
        h('button', { onclick: () => relationModal(user.username, 'followers') }, followersEl, user.stats.followers > 1 ? 'abonnés' : 'abonné'),
        h('span', null, h('b', null, num(user.stats.likes)), "j'aime reçus"),
      ),
    ),
    list.el,
  );
}

// Utilisé par la messagerie pour démarrer une conversation
export function pickMember(title, onPick) {
  const input = h('input', { class: 'input', placeholder: 'Rechercher un membre…', autocomplete: 'off' });
  const results = h('div', { style: { marginTop: '8px' } });
  const m = modal(title, h('div', { class: 'modal-body' }, input, results));
  let t;
  const search = async () => {
    const q = input.value.trim();
    const { users } = q ? await api.get(`/api/search?q=${enc(q)}`) : await api.get('/api/suggestions?limit=8');
    clear(results);
    const list = users.filter((u) => !u.isMe);
    if (!list.length) results.append(h('p', { class: 'muted small', style: { padding: '12px' } }, 'Aucun membre trouvé.'));
    for (const u of list) {
      const row = userRow(u, { follow: false });
      row.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          m.close();
          onPick(u);
        },
        true,
      );
      row.style.cursor = 'pointer';
      results.append(row);
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(search, 250);
  });
  search().catch(() => {});
}

export function goToConversation(u) {
  navigate(`/messages/${u.username}`);
}
