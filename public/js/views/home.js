// Accueil : « Pour toi » (algorithme) et « Abonnements », en plein écran, avec accès au LIVE et à la recherche.
// Aussi utilisé pour une vidéo ouverte par son lien (/@nom/video/123) et pour l'onglet « Amis ».
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, emptyState, toast, syncThemeColor, logoMark, deName } from '../dom.js';
import { verticalFeed } from '../components/feed.js';
import { takeReels, pendingReels, prefetchReels, saveUpcoming } from '../components/video.js';
import { needLogin, follow } from '../components/actions.js';
import { openComments } from '../components/comments.js';
import { todaySubject, lastSubject, subjectCard, wantsCard } from './subject.js';

function darkTop(ctx) {
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const saved = metas.map((m) => m.content);
  metas.forEach((m) => (m.content = '#000000'));
  document.documentElement.classList.add('feed-mode');
  ctx.onCleanup(() => {
    metas.forEach((m, i) => (m.content = saved[i]));
    document.documentElement.classList.remove('feed-mode');
    syncThemeColor();
  });
}

// Fils gardés en mémoire : en revenant sur l'accueil (après un profil, les messages…), on retrouve
// la même vidéo, au même instant. Toucher l'onglet de l'écran ouvert charge de nouvelles vidéos.
const kept = new Map();
const KEEP_MS = 45 * 60 * 1000;
const owner = () => store.user?.id || 0;
function takeKept(key) {
  const k = kept.get(key);
  kept.delete(key);
  if (!k) return null;
  if (Date.now() - k.at > KEEP_MS || k.owner !== owner()) {
    k.holder.feed.destroy();
    return null;
  }
  return k;
}
// Autre compte (connexion, déconnexion) : les fils gardés ne sont plus les bons
let keptFor = owner();
store.on('user', () => {
  if (owner() === keptFor) return;
  keptFor = owner();
  for (const k of kept.values()) k.holder.feed.destroy();
  kept.clear();
});

// Écran de fil réutilisable : build(refresh) fabrique le fil ; il est gardé en quittant l'écran,
// reconstruit (nouvelles vidéos) quand on touche à nouveau l'onglet ou qu'on tire le fil vers le bas.
function keptScreen(ctx, key, top, build) {
  const k = takeKept(key);
  const holder = k?.holder || { feed: null };
  if (!k) {
    holder.refresh = () => {
      const old = holder.feed;
      holder.feed = build(holder.refresh);
      old.el.replaceWith(holder.feed.el);
      old.destroy();
    };
    holder.feed = build(holder.refresh);
  }
  const page = k?.el || h('div', { class: 'feed-page' }, top, holder.feed.el);
  if (k) requestAnimationFrame(() => holder.feed.wake());
  const again = (e) => {
    e.preventDefault();
    holder.refresh();
  };
  document.addEventListener('vibz:again', again);
  ctx.onCleanup(() => {
    document.removeEventListener('vibz:again', again);
    if (!page.isConnected) return holder.feed.destroy();
    holder.feed.suspend();
    kept.set(key, { el: page, holder, at: Date.now(), owner: owner() });
  });
  return page;
}

// Bandeau des LIVE en cours (en haut de « Pour toi »)
async function liveBadge(btn) {
  try {
    const { lives } = await api.get('/api/live');
    btn.classList.toggle('has-live', lives.length > 0);
  } catch {
    /* sans importance */
  }
}

// Haut des fils : LIVE, onglets « Pour toi · Abonnements · Amis » (commande segmentée), et la loupe
function feedTop(active) {
  const tab = (href, label, key) => h('a', { href, class: `top-tab${active === key ? ' on' : ''}`, 'aria-current': active === key ? 'page' : null }, label);
  return h(
    'header',
    { class: 'feed-top' },
    h('a', { href: '/live', class: 'top-icon live-link', 'aria-label': 'LIVE' }, icon('live')),
    h('nav', { class: 'top-tabs', 'aria-label': 'Fils' }, tab('/', 'Pour toi', 'foryou'), tab('/abonnements', 'Abonnements', 'following'), tab('/amis', 'Amis', 'friends')),
    h('a', { href: '/explorer', class: 'top-icon', 'aria-label': 'Explorer et rechercher' }, icon('search')),
  );
}

export async function homeView(ctx) {
  darkTop(ctx);
  const followingTab = ctx.route.path === '/abonnements';
  const top = feedTop(followingTab ? 'following' : 'foryou');

  ctx.title = followingTab ? 'Abonnements — AURUM' : 'AURUM — Pour toi';
  ctx.description = 'Regarde des vidéos courtes qui te ressemblent, crée les tiennes et partage-les avec tes amis.';
  if (followingTab) {
    if (!store.user) {
      setTimeout(() => needLogin('Connecte-toi pour voir les vidéos des comptes que tu suis.'), 50);
      return h('div', { class: 'feed-page' }, top, h('div', { class: 'feed-gate' }, emptyState('friends', 'Les vidéos de tes abonnements', 'Connecte-toi pour voir ici les vidéos des comptes que tu suis.', h('button', { class: 'btn btn-primary', onclick: () => needLogin('Connecte-toi pour continuer.') }, 'Se connecter'))));
    }
    return withLive(keptScreen(ctx, 'following', top, (refresh) => {
      let cursor = null;
      return verticalFeed({
        onRefresh: refresh,
        load: async () => {
          const d = await api.get(`/api/feed/following${cursor ? `?cursor=${cursor}` : ''}`);
          cursor = d.cursor;
          return { posts: d.posts, more: Boolean(d.cursor) };
        },
        emptyView: () => emptyState('friends', 'Aucune vidéo pour l’instant', 'Abonne-toi à des créateurs pour voir ici leurs vidéos.', h('a', { href: '/', class: 'btn btn-primary' }, 'Découvrir « Pour toi »')),
      });
    }));
  }
  // Liste préparée dès l'ouverture de l'application (démarrage instantané) : les vidéos « À
  // suivre » de la dernière visite, déjà sur le téléphone, sinon celles demandées au serveur
  let first = null;
  if (!kept.has('foryou')) {
    first = takeReels();
    if (!first) {
      await (pendingReels() || (store.user ? prefetchReels() : null));
      first = takeReels();
    }
  }
  // Le Sujet du jour, en tête du fil tant qu'on n'y a pas répondu (sans retarder l'ouverture)
  let subject = kept.has('foryou') ? null : await Promise.race([todaySubject(), new Promise((r) => setTimeout(() => r(null), 600))]);
  return withLive(keptScreen(ctx, 'foryou', top, (refresh) => {
    const d = subject || lastSubject();
    subject = null;
    const feed = verticalFeed({
      onRefresh: refresh,
      head: wantsCard(d) ? subjectCard(d) : null,
      initial: first?.posts || [],
      more: first ? first.hasMore : true,
      load: async (seen) => {
        const d = await api.get(`/api/feed/foryou?exclude=${seen.slice(-200).join(',')}`);
        return { posts: d.posts, more: d.hasMore };
      },
      onUpcoming: store.user ? saveUpcoming : null,
      emptyView: () => emptyState('video', 'Aucune vidéo pour l’instant', 'Sois la première personne à publier !', h('a', { href: '/creer', class: 'btn btn-primary' }, 'Créer une vidéo')),
    });
    first = null; // une liste préparée ne sert qu'une fois
    return feed;
  }));
}

// L'icône LIVE (en haut à gauche) s'allume quand quelqu'un est en direct
function withLive(page) {
  const btn = page.querySelector('.live-link');
  if (btn) liveBadge(btn);
  return page;
}

// Une vidéo ouverte par son lien : elle d'abord, puis la liste d'où l'on vient (profil, hashtag…)
// ou les autres vidéos du créateur
export async function videoView(ctx) {
  darkTop(ctx);
  const id = Number(ctx.params.id);
  let post;
  try {
    ({ post } = await api.get(`/api/posts/${id}`));
  } catch (err) {
    ctx.title = 'Vidéo indisponible — AURUM';
    return h('div', { class: 'feed-page' }, backBar(), h('div', { class: 'feed-gate' }, emptyState('eyeOff', 'Cette vidéo n’est pas disponible', err.status === 404 ? 'Elle a peut-être été supprimée, ou son créateur l’a rendue privée.' : err.message, h('a', { href: '/', class: 'btn btn-primary' }, 'Retour à l’accueil'))));
  }
  const viewer = ctx.query.get('suite') && window.__vibzViewer;
  let initial = [post];
  let load = null;
  let more = true;
  // Lien partagé ouvert sans compte : la vidéo se regarde, et « Rejoindre AURUM » remplace la
  // barre du bas (la suite de l'application est réservée aux comptes)
  if (!store.user) {
    more = false;
    load = async () => ({ posts: [], more: false });
    document.documentElement.classList.add('guest-video');
    ctx.onCleanup(() => document.documentElement.classList.remove('guest-video'));
  } else if (viewer && viewer.posts.some((p) => p.id === id)) {
    const i = viewer.posts.findIndex((p) => p.id === id);
    initial = viewer.posts.slice(i);
    initial[0] = post;
    load = viewer.load;
    more = viewer.more;
  } else {
    let cursor = null;
    load = async () => {
      const d = await api.get(`/api/users/${enc(post.author.username)}/posts${cursor ? `?cursor=${cursor}` : ''}`);
      cursor = d.cursor;
      return { posts: d.posts, more: Boolean(d.cursor) };
    };
  }
  const feed = verticalFeed({ initial, load, more });
  ctx.onCleanup(() => feed.destroy());
  ctx.title = `${post.author.displayName} sur AURUM${post.body ? ` : « ${post.body.slice(0, 60)} »` : ''}`;
  ctx.description = post.body?.slice(0, 160) || `Vidéo ${deName(post.author.displayName)} sur AURUM.`;
  // Lien vers un commentaire précis (notification) : la feuille des commentaires s'ouvre dessus
  const focus = Number(ctx.query.get('commentaire'));
  const focusParent = Number(ctx.query.get('fil')) || null;
  if (focus) setTimeout(() => openComments(post, { focusId: focus, focusParent }), 400);
  const here = `/@${enc(post.author.username)}/video/${post.id}`;
  const join = store.user
    ? null
    : h('div', { class: 'guest-join' },
      logoMark(36),
      h('span', { class: 'guest-join-text' }, h('b', null, 'Envie de voir la suite ?'), h('small', null, `Rejoins ${post.author.displayName} et la communauté AURUM`)),
      h('a', { href: `/inscription?suite=${enc(here)}`, class: 'btn btn-primary btn-sm' }, 'Rejoindre'),
      h('a', { href: `/connexion?suite=${enc(here)}`, class: 'guest-join-login' }, 'Se connecter'));
  return h('div', { class: 'feed-page' }, backBar(), feed.el, join);
}

function backBar() {
  return h('header', { class: 'feed-top single' }, h('button', { type: 'button', class: 'top-icon', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/')) }, icon('back')), h('span'), h('a', { href: '/recherche', class: 'top-icon', 'aria-label': 'Rechercher' }, icon('search')));
}

// Onglet « Amis » : vidéos des abonnements réciproques, et comptes à découvrir
export async function friendsView(ctx) {
  darkTop(ctx);
  const top = feedTop('friends');
  ctx.title = 'Amis — AURUM';
  if (!store.user) {
    setTimeout(() => needLogin('Connecte-toi pour voir les vidéos de tes amis.'), 50);
    return withLive(h('div', { class: 'feed-page' }, top, h('div', { class: 'feed-gate' }, emptyState('friends', 'Les vidéos de tes amis', 'Connecte-toi pour voir ici les vidéos des comptes avec qui vous vous suivez mutuellement.', h('button', { class: 'btn btn-primary', onclick: () => needLogin('Connecte-toi pour continuer.') }, 'Se connecter')))));
  }
  return withLive(keptScreen(ctx, 'friends', top, (refresh) => {
    let cursor = null;
    return verticalFeed({
      onRefresh: refresh,
      load: async () => {
        const d = await api.get(`/api/feed/friends${cursor ? `?cursor=${cursor}` : ''}`);
        cursor = d.cursor;
        return { posts: d.posts, more: Boolean(d.cursor) };
      },
      emptyView: () => suggestionsPanel(),
    });
  }));
}

// Comptes à suivre ; « Suivre » se défait d'un second toucher. Au premier lancement (welcome),
// les cartes ne mènent pas au profil : on reste dans le parcours.
export function suggestionsPanel({ welcome = false } = {}) {
  const list = h('div', { class: 'suggest-cards' });
  api.get('/api/suggestions?limit=12').then(({ users }) => {
    list.replaceChildren(
      ...users.map((u) => {
        const btn = h('button', { type: 'button', class: 'btn btn-primary btn-sm' }, u.followsYou ? 'Suivre en retour' : 'Suivre');
        let on = false;
        const paint = (r) => {
          on = Boolean(r && (r.isFollowing || r.requested));
          btn.textContent = on ? (r.requested ? 'Demandé' : r.friend ? 'Amis' : 'Abonné') : u.followsYou ? 'Suivre en retour' : 'Suivre';
          btn.classList.toggle('btn-primary', !on);
          btn.classList.toggle('btn-ghost', on);
          btn.setAttribute('aria-pressed', String(on));
        };
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const r = await follow(u.username, !on);
          btn.disabled = false;
          if (r) paint(r);
        });
        const who = [avatar(u, 'xl'), h('b', null, u.displayName), h('small', null, u.reason)];
        return h('div', { class: 'suggest-card' }, welcome ? h('div', { class: 'suggest-who' }, who) : h('a', { href: `/@${enc(u.username)}` }, who), btn);
      }),
    );
  }).catch(() => {});
  return h('div', { class: 'suggest' }, h('h3', null, 'Trouve tes amis'), h('p', null, 'Quand vous vous suivez mutuellement, vous devenez amis et vos vidéos apparaissent ici.'), list);
}
