// Point d'entrée : routage, coquille de l'application (barre du bas sur téléphone, barre latérale
// sur ordinateur), connexion à la demande, temps réel.
import { api, enc } from './api.js';
import { store, connectRealtime, disconnectRealtime } from './store.js';
import { navigate, setRenderer, compile } from './router.js';
import { h, icon, avatar, spinner, emptyState, closeModal, closeMenu, toast, popMenu, logoMark } from './dom.js';
import { openSheet, closeSheet } from './components/sheet.js';
import { installFormValidation } from './forms.js';
import { trackPage, cookieBanner } from './components/cookies.js';
import { prefetchReels, unlockPlayer } from './components/video.js';
import { startUpdateChecks } from './update.js';
import { registerServiceWorker, syncPush } from './push.js';
import { editPost } from './components/postedit.js';
import { homeView, videoView, friendsView } from './views/home.js';
import { exploreView } from './views/explore.js';
import { searchView } from './views/search.js';
import { profileView } from './views/profile.js';
import { tagView, soundView } from './views/collections.js';
import { inboxView, activityView } from './views/inbox.js';
import { messagesView } from './views/messages.js';
import { createView } from './views/create.js';
import { liveListView, liveRoomView } from './views/live.js';
import { walletView } from './views/wallet.js';
import { studioView } from './views/studio.js';
import { settingsView } from './views/settings.js';
import { adminView } from './views/admin.js';
import { loginView, signupView, forgotView, resetView, logout } from './views/auth.js';
import { welcomeView } from './views/onboarding.js';
import { legalView } from './views/legal.js';
import { helpView, rulesView } from './views/help.js';

// Pas de zoom (comme une application) : pincement et double toucher désactivés
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !e.target.closest?.('.crop-stage')) e.preventDefault();
}, { passive: false });

// layout : « feed » (plein écran sombre), « app » (page avec navigation), « bare » (sans navigation)
// access : « public » (tout le monde), « auth » (connecté), « guest » (non connecté), « admin »
const ROUTES = [
  { path: '/', view: homeView, layout: 'feed', nav: 'home' },
  { path: '/abonnements', view: homeView, layout: 'feed', nav: 'following' },
  { path: '/amis', view: friendsView, layout: 'feed', nav: 'friends' },
  { path: '/@:username/video/:id', view: videoView, layout: 'feed' },
  { path: '/p/:id', view: legacyPost, layout: 'bare' },
  { path: '/salon', view: () => navigate('/', { replace: true }), layout: 'bare' },
  { path: '/videos', view: () => navigate('/', { replace: true }), layout: 'bare' },
  { path: '/explorer', view: exploreView, layout: 'app', nav: 'explore' },
  { path: '/recherche', view: searchView, layout: 'app', nav: 'explore' },
  { path: '/tag/:tag', view: tagView, layout: 'app', nav: 'explore' },
  { path: '/son/:id', view: soundView, layout: 'app', nav: 'explore' },
  { path: '/live', view: liveListView, layout: 'app', nav: 'live' },
  { path: '/live/:username', view: liveRoomView, layout: 'bare' },
  { path: '/@:username', view: profileView, layout: 'app', nav: 'profile' },
  { path: '/boite', view: inboxView, layout: 'app', nav: 'inbox', access: 'auth' },
  { path: '/activite', view: activityView, layout: 'app', nav: 'inbox', access: 'auth' },
  { path: '/messages', view: messagesView, layout: 'app', nav: 'messages', access: 'auth', wide: true },
  { path: '/messages/:username', view: messagesView, layout: 'app', nav: 'messages', access: 'auth', wide: true },
  { path: '/creer', view: createView, layout: 'bare', access: 'auth' },
  { path: '/portefeuille', view: walletView, layout: 'app', nav: 'more', access: 'auth' },
  { path: '/studio', view: studioView, layout: 'app', nav: 'more', access: 'auth' },
  { path: '/reglages', view: settingsView, layout: 'app', nav: 'more', access: 'auth' },
  { path: '/reglages/:section', view: settingsView, layout: 'app', nav: 'more', access: 'auth' },
  { path: '/admin', view: adminView, layout: 'app', nav: 'more', access: 'admin', wide: true },
  { path: '/bienvenue', view: welcomeView, layout: 'bare', access: 'auth' },
  { path: '/connexion', view: loginView, layout: 'bare', access: 'guest' },
  { path: '/inscription', view: signupView, layout: 'bare', access: 'guest' },
  { path: '/mot-de-passe-oublie', view: forgotView, layout: 'bare', access: 'guest' },
  { path: '/reinitialiser', view: resetView, layout: 'bare' },
  { path: '/aide', view: helpView, layout: 'auto', nav: 'more' },
  { path: '/regles', view: rulesView, layout: 'auto', nav: 'more' },
  { path: '/cgu', view: legalView, layout: 'auto', page: 'cgu' },
  { path: '/cgv', view: legalView, layout: 'auto', page: 'cgv' },
  { path: '/rgpd', view: legalView, layout: 'auto', page: 'confidentialite' },
  { path: '/confidentialite', view: legalView, layout: 'auto', page: 'confidentialite' },
  { path: '/mentions-legales', view: legalView, layout: 'auto', page: 'mentions-legales' },
].map((r) => ({ access: 'public', ...r, ...compile(r.path) }));

// Ancien lien de publication (/p/123) : redirigé vers l'adresse de la vidéo
async function legacyPost(ctx) {
  try {
    const { post } = await api.get(`/api/posts/${Number(ctx.params.id)}`);
    navigate(`/@${post.author.username}/video/${post.id}`, { replace: true });
  } catch {
    navigate('/', { replace: true });
  }
  return h('div', { class: 'boot' }, spinner());
}

const appEl = document.getElementById('app');

// ---------------------------------------------------------------------------
// Titre de l'onglet (avec compteur de non-lus)
// ---------------------------------------------------------------------------
let baseTitle = 'Vibz';
function paintTitle() {
  const c = store.counters;
  const n = store.user ? (c.notifications || 0) + (c.messages || 0) + (c.requests || 0) : 0;
  document.title = n ? `(${n > 99 ? '99+' : n}) ${baseTitle}` : baseTitle;
}
store.on('counters', paintTitle);

// ---------------------------------------------------------------------------
// Connexion demandée pour une action (J'aime, commenter, suivre…)
// ---------------------------------------------------------------------------
function openLoginSheet(reason) {
  const here = location.pathname + location.search;
  const go = (path) => {
    closeSheet();
    closeModal();
    navigate(`${path}?suite=${enc(here)}`);
  };
  openSheet({
    title: 'Connecte-toi à Vibz',
    body: h(
      'div',
      { class: 'login-sheet' },
      h('div', { class: 'login-logo' }, logoMark()),
      h('p', null, reason || 'Connecte-toi pour continuer.'),
      h('p', { class: 'muted small' }, 'Suis des créateurs, aime des vidéos, commente et crée les tiennes.'),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg btn-block', onclick: () => go('/inscription') }, 'Créer un compte'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-lg btn-block', onclick: () => go('/connexion') }, 'J’ai déjà un compte'),
    ),
  });
}
document.addEventListener('vibz:login', (e) => openLoginSheet(e.detail?.reason));
document.addEventListener('vibz:edit-post', (e) => editPost(e.detail));

const wordmark = () => h('a', { href: '/', class: 'brand', 'aria-label': 'Vibz, accueil' }, logoMark(34), h('span', { class: 'brand-name' }, 'vibz'));

// ---------------------------------------------------------------------------
// Coquille
// ---------------------------------------------------------------------------
function buildShell() {
  const unsub = [];
  const navEls = new Map();
  const badges = { inbox: [], messages: [] };
  const register = (key, el) => {
    if (!navEls.has(key)) navEls.set(key, []);
    navEls.get(key).push(el);
    return el;
  };
  const badge = (kind) => {
    const b = h('span', { class: 'badge-count', hidden: true });
    badges[kind].push(b);
    return b;
  };
  const me = () => store.user;
  const profileHref = () => (me() ? `/@${me().username}` : '/connexion');
  const guard = (e, reason) => {
    if (me()) return false;
    e.preventDefault();
    openLoginSheet(reason);
    return true;
  };

  // Barre latérale (ordinateur)
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher', 'aria-label': 'Rechercher' });
  const searchForm = h('form', { class: 'side-search', onsubmit: (e) => { e.preventDefault(); const q = search.value.trim(); navigate(q ? `/recherche?q=${enc(q)}` : '/recherche'); search.value = ''; } }, icon('search'), search);
  const side = (key, href, ic, icOn, label, extra = {}) => register(key, h('a', { href, class: 'side-link', onclick: extra.onclick }, h('span', { class: 'side-ic' }, h('span', { class: 'ic-off' }, icon(ic)), h('span', { class: 'ic-on' }, icon(icOn || ic)), extra.badge || null), h('span', { class: 'side-label' }, label)));
  const sideAvatar = h('span', { class: 'side-ic side-avatar' });
  const profileLink = register('profile', h('a', { href: profileHref(), class: 'side-link' }, sideAvatar, h('span', { class: 'side-label' }, 'Profil')));
  const sideAccount = h('div', { class: 'side-account' });
  const moreBtn = h('button', { type: 'button', class: 'side-link' }, h('span', { class: 'side-ic' }, icon('moreH')), h('span', { class: 'side-label' }, 'Plus'));
  moreBtn.addEventListener('click', () => {
    const items = [
      me() && { icon: 'wallet', label: 'Portefeuille', action: () => navigate('/portefeuille') },
      me() && { icon: 'creator', label: 'Studio créateur', action: () => navigate('/studio') },
      me() && { icon: 'settings', label: 'Réglages et confidentialité', action: () => navigate('/reglages') },
      me()?.isAdmin && { icon: 'shield', label: 'Administration', action: () => navigate('/admin') },
      { icon: 'help', label: 'Aide', action: () => navigate('/aide') },
      { icon: 'moon', label: 'Apparence', action: () => navigate(me() ? '/reglages/apparence' : '/aide#apparence') },
      me() && { icon: 'logout', label: 'Se déconnecter', action: logout, danger: true },
    ].filter(Boolean);
    popMenu(moreBtn, items);
  });
  const sidebar = h(
    'nav',
    { class: 'sidebar', 'aria-label': 'Navigation principale' },
    wordmark(),
    searchForm,
    side('home', '/', 'home', 'homeFill', 'Pour toi'),
    side('explore', '/explorer', 'compass', 'compass', 'Explorer'),
    side('following', '/abonnements', 'userCheck', 'userCheck', 'Abonnements', { onclick: (e) => guard(e, 'Connecte-toi pour voir les vidéos des comptes que tu suis.') }),
    side('friends', '/amis', 'friends', 'friendsFill', 'Amis', { onclick: (e) => guard(e, 'Connecte-toi pour voir tes amis.') }),
    side('live', '/live', 'live', 'live', 'LIVE'),
    side('messages', '/messages', 'send', 'send', 'Messages', { badge: badge('messages'), onclick: (e) => guard(e, 'Connecte-toi pour envoyer des messages.') }),
    side('inbox', '/activite', 'bell', 'bellRing', 'Activité', { badge: badge('inbox'), onclick: (e) => guard(e, 'Connecte-toi pour voir ton activité.') }),
    side('create', '/creer', 'plus', 'plus', 'Créer', { onclick: (e) => guard(e, 'Connecte-toi pour publier une vidéo.') }),
    profileLink,
    moreBtn,
    sideAccount,
    h('footer', { class: 'side-foot' }, h('a', { href: '/aide' }, 'Aide'), h('a', { href: '/regles' }, 'Règles'), h('a', { href: '/cgu' }, 'CGU'), h('a', { href: '/confidentialite' }, 'Confidentialité'), h('a', { href: '/mentions-legales' }, 'Mentions légales'), h('span', null, `© ${new Date().getFullYear()} Vibz`)),
  );

  // Barre du bas (téléphone)
  const tabAvatar = h('span', { class: 'tab-ic tab-avatar' });
  const tab = (key, href, ic, icOn, label, extra = {}) =>
    register(key, h('a', { href, class: 'tab', onclick: extra.onclick }, h('span', { class: 'tab-ic' }, h('span', { class: 'ic-off' }, icon(ic)), h('span', { class: 'ic-on' }, icon(icOn)), extra.badge || null), h('span', { class: 'tab-label' }, label)));
  const tabbar = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Navigation' },
    tab('home', '/', 'home', 'homeFill', 'Accueil', { onclick: () => unlockPlayer() }),
    tab('friends', '/amis', 'friends', 'friendsFill', 'Amis'),
    h('a', { href: '/creer', class: 'tab tab-create', 'aria-label': 'Créer', onclick: (e) => guard(e, 'Connecte-toi pour publier une vidéo.') }, h('span', { class: 'create-btn' }, icon('plus'))),
    tab('inbox', '/boite', 'inbox', 'inboxFill', 'Boîte', { badge: badge('inbox'), onclick: (e) => guard(e, 'Connecte-toi pour voir tes messages et ton activité.') }),
    register('profile', h('a', { href: profileHref(), class: 'tab tab-profile', onclick: (e) => guard(e, 'Connecte-toi pour voir ton profil.') }, tabAvatar, h('span', { class: 'tab-label' }, 'Profil'))),
  );
  // Un toucher sur l'onglet « Profil » quand on a déjà un compte : son profil
  const paintMe = () => {
    const u = me();
    tabAvatar.replaceChildren(u ? avatar(u, 'xs') : icon('user'));
    sideAvatar.replaceChildren(u ? avatar(u, 'xs') : icon('user'));
    for (const el of navEls.get('profile')) el.setAttribute('href', profileHref());
    sideAccount.replaceChildren(
      u
        ? h('a', { href: `/@${u.username}`, class: 'side-me' }, avatar(u, 'sm'), h('span', null, h('b', null, u.displayName), h('small', null, `@${u.username}`)))
        : h('div', { class: 'side-login' }, h('p', null, 'Connecte-toi pour suivre des créateurs, aimer des vidéos et voir les commentaires.'), h('a', { href: '/connexion', class: 'btn btn-primary btn-block' }, 'Se connecter')),
    );
  };
  paintMe();
  unsub.push(store.on('user', paintMe));

  const main = h('main', { class: 'main', id: 'main' });
  const el = h('div', { class: 'shell' }, sidebar, main, tabbar);

  const paintBadges = (c) => {
    const values = { inbox: (c.notifications || 0) + (c.requests || 0) + (c.messages || 0), messages: c.messages || 0 };
    for (const kind of Object.keys(badges)) {
      for (const b of badges[kind]) {
        const v = values[kind] || 0;
        b.hidden = !v || !store.user;
        b.textContent = v > 99 ? '99+' : String(v);
      }
    }
  };
  paintBadges(store.counters);
  unsub.push(store.on('counters', paintBadges));

  return {
    el,
    main,
    setActive(key) {
      for (const [k, els] of navEls) for (const x of els) x.classList.toggle('active', k === key);
    },
    destroy() {
      unsub.forEach((fn) => fn());
    },
  };
}

// ---------------------------------------------------------------------------
// Rendu des routes
// ---------------------------------------------------------------------------
let shell = null;
let renderToken = 0;
let cleanups = [];
let lastLocation = '';
const scrollPos = new Map();
try {
  history.scrollRestoration = 'manual';
} catch {
  /* navigateur ancien */
}

function errorView(err) {
  return h('div', { class: 'page' }, emptyState('alert', 'Un contretemps', err?.message || 'Une erreur est survenue.', h('button', { class: 'btn btn-ghost', onclick: () => location.reload() }, 'Recharger')));
}

function notFoundView(ctx) {
  ctx.title = 'Page introuvable — Vibz';
  return h('section', { class: 'nf' }, h('div', { class: 'nf-code', 'aria-hidden': 'true' }, '404'), h('h1', null, 'Cette page n’existe pas.'), h('p', null, 'Le lien est peut-être incomplet, ou la page a été retirée.'), h('a', { href: '/', class: 'btn btn-primary btn-lg' }, 'Retour à l’accueil'));
}

function match(pathname) {
  for (const r of ROUTES) {
    const m = r.re.exec(pathname);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => {
        try {
          params[k] = decodeURIComponent(m[i + 1]);
        } catch {
          params[k] = m[i + 1];
        }
      });
      return { route: r, params };
    }
  }
  return { route: null, params: {} };
}

async function render(opts = {}) {
  const token = ++renderToken;
  closeModal();
  closeMenu();
  closeSheet();
  for (const fn of cleanups.splice(0)) {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  }

  const url = new URL(location.href);
  if (lastLocation && !opts.same) scrollPos.set(lastLocation, window.scrollY);
  if (scrollPos.size > 60) scrollPos.delete(scrollPos.keys().next().value);
  lastLocation = url.pathname + url.search;
  const { route, params } = match(url.pathname);
  const u = store.user;
  const here = url.pathname + url.search;

  if (route) {
    if (route.access === 'guest' && u) return navigate(url.searchParams.get('suite') || '/', { replace: true });
    if ((route.access === 'auth' || route.access === 'admin') && !u) return navigate(`/connexion?suite=${enc(here)}`, { replace: true });
    if (route.access === 'admin' && !u.isAdmin) return navigate('/', { replace: true });
  }

  const layout = !route ? 'app' : route.layout === 'auto' ? 'app' : route.layout;
  const mine = [];
  const ctx = { params, query: url.searchParams, route, title: null, description: null, onCleanup: (fn) => typeof fn === 'function' && mine.push(fn) };

  let container;
  if (layout === 'app' || layout === 'feed') {
    if (!shell) shell = buildShell();
    if (appEl.firstElementChild !== shell.el) appEl.replaceChildren(shell.el);
    const own = route?.nav === 'profile' && u && params.username?.toLowerCase() === u.username.toLowerCase();
    shell.setActive(route?.nav === 'profile' && !own ? null : route?.nav);
    shell.el.classList.toggle('is-feed', layout === 'feed');
    shell.el.classList.toggle('wide', Boolean(route?.wide));
    container = shell.main;
    if (!opts.same) container.replaceChildren(h('div', { class: 'page-loading' }, spinner()));
  } else {
    shell?.destroy();
    shell = null;
    container = appEl;
  }

  let el;
  try {
    el = route ? await route.view(ctx) : notFoundView(ctx);
  } catch (err) {
    console.error(err);
    el = errorView(err);
  }
  if (token !== renderToken) {
    mine.forEach((fn) => fn());
    return;
  }
  cleanups = mine;
  if (!el) return;
  const back = opts.pop ? scrollPos.get(lastLocation) : undefined;
  container.replaceChildren(el);
  if (back) requestAnimationFrame(() => window.scrollTo(0, back));
  else if (location.hash) setTimeout(() => document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView(), 50);
  else if (!opts.same) window.scrollTo(0, 0);
  baseTitle = ctx.title || 'Vibz';
  paintTitle();
  const desc = document.querySelector('meta[name="description"]');
  if (desc && ctx.description) desc.content = ctx.description;
  if (!opts.same) trackPage(route ? route.path : '404');
}

// ---------------------------------------------------------------------------
// Liens internes, historique, session
// ---------------------------------------------------------------------------
installFormValidation();

const offlineBar = h('div', { class: 'offline-bar', role: 'status', hidden: navigator.onLine !== false }, icon('wifiOff', 'icon-sm'), 'Hors connexion');
document.body.append(offlineBar);
addEventListener('offline', () => (offlineBar.hidden = false));
addEventListener('online', () => {
  if (offlineBar.hidden) return;
  offlineBar.hidden = true;
  toast('Connexion rétablie');
});

// Erreurs JavaScript : signalées à l'administration (anonymes : message, modèle de page, appareil)
{
  let sent = 0;
  const seen = new Set();
  const report = (message, stack) => {
    const msg = String(message || '').slice(0, 300);
    if (!msg || sent >= 5 || seen.has(msg)) return;
    seen.add(msg);
    sent++;
    const path = match(location.pathname).route?.path || '404';
    fetch('/api/client-errors', { method: 'POST', headers: { 'x-vibz': '1', 'content-type': 'application/json' }, body: JSON.stringify({ message: msg, stack: String(stack || '').slice(0, 900), path, version: store.config?.version || '' }), keepalive: true }).catch(() => {});
  };
  addEventListener('error', (e) => report(e.message, e.error?.stack));
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    if (r && typeof r === 'object' && 'status' in r) return;
    report(r?.message || String(r), r?.stack);
  });
}

document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  e.preventDefault();
  unlockPlayer(); // le lecteur vidéo garde le son pour la suite de la visite
  navigate(url.pathname + url.search + url.hash);
});

window.addEventListener('popstate', () => {
  if (location.pathname + location.search === lastLocation) return;
  render({ pop: true });
});

// Session expirée pendant la visite : on repasse en visiteur, et on propose de se reconnecter
window.addEventListener('vibz:auth', async (e) => {
  if (e.detail?.status !== 401) return;
  if (store.user) {
    disconnectRealtime();
    await store.refresh().catch(() => store.setUser(null));
    if (!store.user) {
      toast('Ta session a expiré. Reconnecte-toi.');
      render({ same: true });
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
    closeModal();
  }
});

// Après connexion ou déconnexion : temps réel, notifications, fil
store.on('user', (u) => {
  if (u) {
    connectRealtime();
    syncPush();
  } else {
    disconnectRealtime();
  }
});

setRenderer(render);

(async function boot() {
  try {
    await store.refresh();
  } catch (err) {
    appEl.replaceChildren(errorView(err));
    return;
  }
  if (store.user) {
    connectRealtime();
    syncPush();
  }
  // Les premières vidéos de « Pour toi » se préparent pendant le rendu
  if (location.pathname === '/') prefetchReels();
  registerServiceWorker();
  window.__vibzStarted = true;
  startUpdateChecks();
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && typeof e.data.url === 'string') {
      const url = new URL(e.data.url, location.origin);
      if (url.origin === location.origin) navigate(url.pathname + url.search);
    }
  });
  render();
  setTimeout(() => cookieBanner(), 2500);
})();
