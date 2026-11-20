import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, memberChip, monthYear, richText, num, emptyState, modal, spinner, clear, toast, lightbox, popMenu, confirmDialog, verifiedMark, botChip, remaining } from '../dom.js';
import { openReels } from '../components/video.js';
import { postList, backHead } from './feed.js';
import { reportDialog } from '../components/report.js';
import { friendButton } from './friends.js';

export function userRow(u, { follow = true } = {}) {
  const btn = follow && !u.isMe ? followButton(u, 'btn-sm') : null;
  return h(
    'div',
    { class: 'user-row' },
    h('a', { href: `/@${u.username}` }, avatar(u)),
    h(
      'a',
      { href: `/@${u.username}`, class: 'meta' },
      h('span', { class: 'name-line' }, h('b', null, u.displayName), u.verified ? verifiedMark() : null, u.bot ? botChip() : null),
      h('small', null, memberChip(u), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, `@${u.username}${u.profession ? ` · ${u.profession}` : ''}`)),
      u.bio ? h('span', { class: 'bio' }, u.bio) : null,
    ),
    btn,
  );
}

export function followButton(u, size = '') {
  const btn = h('button', { class: `btn ${size}` });
  const paint = () => {
    btn.className = `btn ${size} ${u.isFollowing ? 'btn-ghost' : 'btn-secondary'}`;
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
  modal({ followers: 'Abonnés', following: 'Abonnements', friends: 'Amis' }[relation], body);
  api
    .get(`/api/users/${enc(username)}/${relation}`)
    .then(({ users }) => {
      clear(body);
      if (!users.length) body.append(emptyState('users', 'Personne pour l’instant', null));
      for (const u of users) body.append(userRow(u, { follow: relation !== 'friends' }));
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
  const friendsEl = h('b', null, num(user.stats.friends || 0));
  const moreBtn = h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Plus d’options', title: 'Options' }, icon('more'));
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = [{ icon: 'link', label: 'Copier le lien du profil', action: () => navigator.clipboard?.writeText(`${location.origin}/@${user.username}`).then(() => toast('Lien copié.'), () => {}) }];
    if (store.user.isAdmin) {
      items.push({
        icon: 'verified',
        label: user.verified ? 'Retirer le badge vérifié' : 'Certifier ce membre',
        action: async () => {
          try {
            await api.post(`/api/admin/users/${user.id}/verify`, { verified: !user.verified });
            toast(user.verified ? 'Badge retiré.' : `${user.displayName} est désormais « Membre vérifié ».`);
            navigate(`/@${user.username}`, { replace: true });
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      });
    }
    if (!user.isMe && !user.blocked) {
      items.unshift({
        icon: user.isFollowing ? 'x' : 'plus',
        label: user.isFollowing ? 'Ne plus suivre' : 'Suivre ses publications',
        action: async () => {
          const was = user.isFollowing;
          try {
            if (was) await api.del(`/api/users/${enc(user.username)}/follow`);
            else await api.post(`/api/users/${enc(user.username)}/follow`);
            user.isFollowing = !was;
            store.emit('follow:changed', { username: user.username, following: !was });
            toast(was ? 'Vous ne suivez plus ce membre.' : 'Vous suivez désormais ses publications.');
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      });
    }
    if (!user.isMe) {
      items.push({ icon: 'flag', label: 'Signaler ce membre', action: () => reportDialog('user', user.id, 'Signaler ce membre') });
      items.push(
        user.blocked
          ? { icon: 'ban', label: 'Débloquer', action: () => toggleBlock(false) }
          : { icon: 'ban', label: `Bloquer ${user.displayName.split(/\s+/)[0]}`, danger: true, action: () => toggleBlock(true) },
      );
    }
    popMenu(moreBtn, items);
  });

  async function toggleBlock(block) {
    if (block) {
      const ok = await confirmDialog(
        `Bloquer ${user.displayName} ?`,
        'Vous ne verrez plus ses publications et il ou elle ne pourra plus vous écrire ni voir votre profil. Vos abonnements mutuels seront retirés.',
        'Bloquer',
      );
      if (!ok) return;
    }
    try {
      if (block) await api.post(`/api/users/${enc(user.username)}/block`);
      else await api.del(`/api/users/${enc(user.username)}/block`);
      toast(block ? 'Membre bloqué.' : 'Membre débloqué.');
      navigate(`/@${user.username}`, { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const actions = user.isMe
    ? [
        store.user.isAdmin ? moreBtn : null,
        h('a', { href: '/reglages', class: 'btn btn-secondary' }, 'Modifier le profil'),
        h('a', { href: '/invitations', class: 'btn btn-secondary' }, 'Inviter'),
      ]
    : user.bot
      ? [moreBtn]
      : user.blocked
      ? [moreBtn, h('button', { class: 'btn btn-secondary', onclick: () => toggleBlock(false) }, 'Débloquer')]
      : [
          moreBtn,
          h('a', { href: `/messages/${user.username}`, class: 'btn btn-ghost btn-icon', 'aria-label': 'Envoyer un message', title: 'Message' }, icon('mail')),
          friendButton(user, {
            onChange: (s, prev) => {
              user.stats.friends = Math.max(0, (user.stats.friends || 0) + (s === 'friends') - (prev === 'friends'));
              friendsEl.textContent = num(user.stats.friends);
              if (s === 'friends' && !user.isFollowing) {
                user.isFollowing = true;
                store.emit('follow:changed', { username: user.username, following: true });
              }
            },
          }),
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
  if (user.invitedBy) meta.push(h('span', null, icon('ticket'), 'Invité par\u00a0', h('a', { href: `/@${user.invitedBy.username}` }, user.invitedBy.displayName)));
  if (user.invitedCount) meta.push(h('span', null, icon('users'), `A fait entrer ${user.invitedCount} membre${user.invitedCount > 1 ? 's' : ''}`));

  // Onglets : publications / vidéos / photos
  const content = h('div');
  const tabPosts = h('button', { class: 'tab active' }, icon('list', 'icon-sm'), 'Publications');
  const tabVideos = h('button', { class: 'tab' }, icon('video', 'icon-sm'), 'Vidéos');
  const tabPhotos = h('button', { class: 'tab' }, icon('grid', 'icon-sm'), 'Photos');
  const select = (tab) => {
    for (const t of [tabPosts, tabVideos, tabPhotos]) t.classList.toggle('active', t === tab);
  };
  let stopList = () => {};
  const showPosts = () => {
    select(tabPosts);
    stopList();
    const list = postList((before) => api.get(`/api/users/${enc(user.username)}/posts${before ? `?before=${before}` : ''}`), {
      empty: () =>
        emptyState('pen', user.isMe ? 'Votre première publication' : 'Aucune publication', user.isMe ? 'Présentez-vous au cercle : le Salon vous écoute.' : `${user.displayName} n'a encore rien publié.`, user.isMe ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => document.dispatchEvent(new CustomEvent('aurum:create')) }, 'Publier') : null),
    });
    content.replaceChildren(list.el);
    stopList = list.start();
  };
  // Vidéos en grille (aperçu et nombre de vues), comme sur TikTok ; un toucher ouvre le plein écran
  const showVideos = async () => {
    select(tabVideos);
    stopList();
    stopList = () => {};
    content.replaceChildren(spinner());
    try {
      const { posts } = await api.get(`/api/users/${enc(user.username)}/videos`);
      content.replaceChildren(
        posts.length
          ? h(
              'div',
              { class: 'video-grid' },
              posts.map((p) =>
                h(
                  'a',
                  {
                    href: `/videos?p=${p.id}`,
                    class: 'video-cell',
                    onclick: (e) => {
                      e.preventDefault();
                      openReels({ postId: p.id, video: p.video }); // dans le toucher : la vidéo démarre avec le son
                    },
                  },
                  p.video.poster ? h('img', { src: p.video.poster, alt: `Vidéo de ${user.displayName}`, loading: 'lazy', decoding: 'async' }) : null,
                  h('span', { class: 'video-cell-views' }, icon('play', 'icon-xs'), num(p.video.views || 0)),
                  p.video.expiresAt ? h('span', { class: 'video-cell-time' }, icon('clock', 'icon-xs'), remaining(p.video.expiresAt)) : null,
                ),
              ),
            )
          : emptyState('video', 'Aucune vidéo', user.isMe ? 'Vos vidéos (24 h) apparaîtront ici, avec leurs vues.' : 'Aucune vidéo en ce moment.'),
      );
    } catch (err) {
      content.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message));
    }
  };
  const showPhotos = async () => {
    select(tabPhotos);
    stopList();
    stopList = () => {};
    content.replaceChildren(spinner());
    try {
      const { photos } = await api.get(`/api/users/${enc(user.username)}/photos`);
      content.replaceChildren(
        photos.length
          ? h('div', { class: 'photo-grid' }, photos.map((ph) => h('a', { href: `/p/${ph.postId}`, class: 'photo-cell' }, h('img', { src: ph.url, alt: `Photo de ${user.displayName}`, loading: 'lazy', decoding: 'async' }))))
          : emptyState('image', 'Aucune photo', user.isMe ? 'Vos photos publiées apparaîtront ici.' : 'Aucune photo publiée pour le moment.'),
      );
    } catch (err) {
      content.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message));
    }
  };
  tabPosts.addEventListener('click', showPosts);
  tabVideos.addEventListener('click', showVideos);
  tabPhotos.addEventListener('click', showPhotos);
  ctx.onCleanup(() => stopList());
  if (user.blocked) {
    content.replaceChildren(emptyState('ban', 'Membre bloqué', 'Vous ne voyez plus ses publications. Débloquez ce membre pour les afficher à nouveau.'));
  } else {
    showPosts();
  }
  if (user.isMe) ctx.onCleanup(store.on('post:created', () => tabPosts.classList.contains('active') && showPosts()));

  const coverEl = h('div', { class: 'cover' }, user.cover ? h('img', { src: user.cover, alt: `Photo de couverture de ${user.displayName}`, style: { cursor: 'zoom-in' }, onclick: () => lightbox(user.cover) }) : null);
  const avatarEl = avatar(user, 'xl', { presence: !user.isMe });
  if (user.avatar) {
    avatarEl.style.cursor = 'zoom-in';
    avatarEl.addEventListener('click', () => lightbox(user.avatar));
  }

  // Chiffres façon Instagram : publications, abonnés, suivis
  const stat = (value, label, onclick) => h(onclick ? 'button' : 'div', { class: 'ig-stat', type: onclick ? 'button' : undefined, onclick }, value, h('small', null, label));
  const stats = h(
    'div',
    { class: 'ig-stats' },
    stat(h('b', null, num(user.stats.posts)), user.stats.posts > 1 ? 'publications' : 'publication'),
    stat(followersEl, user.stats.followers > 1 ? 'abonnés' : 'abonné', () => relationModal(user.username, 'followers')),
    stat(h('b', null, num(user.stats.following)), user.stats.following > 1 ? 'suivis' : 'suivi', () => relationModal(user.username, 'following')),
  );
  // Son propre profil : nom d'utilisateur et menu (≡), comme sur Instagram
  const head = user.isMe
    ? h(
        'header',
        { class: 'page-head' },
        h('div', { class: 'grow' }, h('h1', { class: 'me-handle' }, user.username)),
        h('button', { class: 'icon-btn', 'aria-label': 'Menu : amis, groupes, réglages', onclick: () => document.dispatchEvent(new CustomEvent('aurum:menu')) }, icon('menu')),
      )
    : backHead(user.displayName, `${num(user.stats.posts)} publication${user.stats.posts > 1 ? 's' : ''}`);

  return h(
    'div',
    null,
    head,
    coverEl,
    h(
      'section',
      { class: 'profile-top' },
      h('div', { class: 'profile-row' }, avatarEl, stats),
      h('div', { class: 'profile-name' }, h('h1', null, user.displayName), user.verified ? verifiedMark() : null),
      h(
        'div',
        { class: 'profile-handle' },
        h('span', null, `@${user.username}`),
        memberChip(user),
        user.friendStatus === 'friends' ? h('span', { class: 'tag tag-gold' }, 'Ami') : user.followsYou ? h('span', { class: 'tag' }, 'Vous suit') : null,
        user.blocked ? h('span', { class: 'tag' }, 'Bloqué') : null,
      ),
      user.bot ? h('p', { class: 'bot-notice' }, icon('info', 'icon-sm'), 'Compte automatique géré par AURUM : ses publications sont générées automatiquement, ce n’est pas un membre.') : null,
      user.bio ? h('p', { class: 'profile-bio' }, richText(user.bio)) : null,
      h('div', { class: 'profile-meta' }, meta),
      h(
        'div',
        { class: 'profile-stats' },
        h('button', { onclick: () => relationModal(user.username, 'friends') }, friendsEl, (user.stats.friends || 0) > 1 ? 'amis' : 'ami'),
        h('span', null, h('b', null, num(user.stats.likes)), user.stats.likes > 1 ? 'réactions reçues' : 'réaction reçue'),
      ),
      h('div', { class: 'profile-actions' }, actions),
    ),
    user.blocked ? null : h('div', { class: 'tabs profile-tabs' }, tabPosts, tabVideos, tabPhotos),
    content,
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
    let users;
    if (q) ({ users } = await api.get(`/api/search?q=${enc(q)}`));
    else {
      // Recherche vide : les membres que l'on suit, puis quelques suggestions
      const [mine, sugg] = await Promise.all([
        api.get(`/api/users/${enc(store.user.username)}/following`).catch(() => ({ users: [] })),
        api.get('/api/suggestions?limit=8').catch(() => ({ users: [] })),
      ]);
      const ids = new Set();
      users = [...mine.users, ...sugg.users].filter((u) => !ids.has(u.id) && ids.add(u.id));
    }
    if (q !== input.value.trim()) return; // une frappe plus récente a pris le relais
    clear(results);
    const list = users.filter((u) => !u.isMe);
    if (!list.length) results.append(h('p', { class: 'muted small', style: { padding: '12px' } }, q ? 'Aucun membre ne correspond à cette recherche.' : 'Suivez des membres pour leur écrire en un toucher.'));
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
