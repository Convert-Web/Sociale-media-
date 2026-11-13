// Point d'entrée : routage, coquille de l'application et temps réel.
import { api, enc } from './api.js';
import { store, connectRealtime, disconnectRealtime } from './store.js';
import { navigate, setRenderer, compile } from './router.js';
import { h, icon, avatar, memberCard, cardSince, spinner, emptyState, closeModal, closeMenu, modal, num, clear } from './dom.js';
import { composer } from './components/post.js';
import { landingView } from './views/landing.js';
import { loginView, signupView, forgotView, resetView } from './views/auth.js';
import { joinView, welcomeView, logout } from './views/join.js';
import { feedView, postView, savedView } from './views/feed.js';
import { profileView, userRow } from './views/profile.js';
import { exploreView } from './views/explore.js';
import { messagesView } from './views/messages.js';
import { notificationsView } from './views/notifications.js';
import { settingsView } from './views/settings.js';
import { adminView } from './views/admin.js';
import { legalView } from './views/legal.js';
import { friendsView } from './views/friends.js';
import { groupsView, groupView } from './views/groups.js';
import { invitationLanding, invitationsView } from './views/invite.js';
import { agendaView, eventView } from './views/events.js';
import { carnetView, placeView } from './views/places.js';
import { journalView, journalItemView } from './views/journal.js';
import { stop as stopPlayer } from './components/player.js';
import { registerServiceWorker, syncPush } from './push.js';
document.addEventListener('aurum:logout', () => stopPlayer());

const ROUTES = [
  { path: '/', view: landingView, access: 'public', home: true },
  { path: '/connexion', view: loginView, access: 'guest' },
  { path: '/inscription', view: signupView, access: 'guest' },
  { path: '/mot-de-passe-oublie', view: forgotView, access: 'guest' },
  { path: '/reinitialiser', view: resetView, access: 'public' },
  { path: '/rejoindre', view: joinView, access: 'auth' },
  { path: '/bienvenue', view: welcomeView, access: 'member' },
  { path: '/salon', view: feedView, access: 'member', layout: 'app', nav: 'salon' },
  { path: '/explorer', view: exploreView, access: 'member', layout: 'app', nav: 'explorer' },
  { path: '/notifications', view: notificationsView, access: 'member', layout: 'app', nav: 'notifications' },
  { path: '/messages', view: messagesView, access: 'member', layout: 'app', nav: 'messages', wide: true },
  { path: '/messages/:username', view: messagesView, access: 'member', layout: 'app', nav: 'messages', wide: true },
  { path: '/p/:id', view: postView, access: 'member', layout: 'app' },
  { path: '/@:username', view: profileView, access: 'member', layout: 'app', nav: 'profil' },
  { path: '/reglages', view: settingsView, access: 'member', layout: 'app', nav: 'reglages' },
  { path: '/enregistres', view: savedView, access: 'member', layout: 'app', nav: 'enregistres' },
  { path: '/amis', view: friendsView, access: 'member', layout: 'app', nav: 'amis' },
  { path: '/groupes', view: groupsView, access: 'member', layout: 'app', nav: 'groupes' },
  { path: '/groupes/:id', view: groupView, access: 'member', layout: 'app', nav: 'groupes' },
  { path: '/journal', view: journalView, access: 'member', layout: 'app', nav: 'journal' },
  { path: '/journal/:id', view: journalItemView, access: 'member', layout: 'app', nav: 'journal' },
  { path: '/agenda', view: agendaView, access: 'member', layout: 'app', nav: 'agenda' },
  { path: '/agenda/:id', view: eventView, access: 'member', layout: 'app', nav: 'agenda' },
  { path: '/carnet', view: carnetView, access: 'member', layout: 'app', nav: 'carnet' },
  { path: '/carnet/:id', view: placeView, access: 'member', layout: 'app', nav: 'carnet' },
  { path: '/invitations', view: invitationsView, access: 'member', layout: 'app', nav: 'invitations' },
  { path: '/invitation/:code', view: invitationLanding, access: 'public' },
  { path: '/admin', view: adminView, access: 'admin', layout: 'app', nav: 'admin' },
  { path: '/cgv', view: legalView, access: 'public', layout: 'auto', page: 'cgv' },
  { path: '/confidentialite', view: legalView, access: 'public', layout: 'auto', page: 'confidentialite' },
  { path: '/mentions-legales', view: legalView, access: 'public', layout: 'auto', page: 'mentions-legales' },
].map((r) => ({ ...r, ...compile(r.path) }));

const appEl = document.getElementById('app');

// ---------------------------------------------------------------------------
// Titre de l'onglet (avec compteur de non-lus)
// ---------------------------------------------------------------------------
let baseTitle = 'AURUM';
function paintTitle() {
  const c = store.counters;
  const n = store.user?.isMember ? (c.notifications || 0) + (c.messages || 0) + (c.requests || 0) : 0;
  document.title = n ? `(${n}) ${baseTitle}` : baseTitle;
}
store.on('counters', paintTitle);

// ---------------------------------------------------------------------------
// Coquille (navigation latérale, colonne de droite, barre d'onglets mobile)
// ---------------------------------------------------------------------------
function openComposer() {
  modal('Nouvelle publication', composer({ onPosted: () => closeModal() }));
}

// Menu « moi » sur téléphone : profil, amis, groupes, réglages… (la barre d'onglets n'a que cinq places)
function openMeMenu() {
  const me = store.user;
  const c = store.counters || {};
  const go = () => closeModal();
  const item = (href, ic, label, count) =>
    h('a', { href, class: 'me-item', onclick: go }, h('span', { class: 'me-item-icon' }, icon(ic)), h('span', { class: 'grow' }, label), count ? h('span', { class: 'badge-dot' }, count > 99 ? '99+' : String(count)) : null, icon('chevron', 'icon-sm'));
  const items = [
    item('/journal', 'newspaper', 'Journal'),
    item('/amis', 'users', 'Amis', c.requests),
    item('/groupes', 'groups', 'Groupes'),
    item('/agenda', 'calendar', 'Agenda'),
    item('/carnet', 'book', 'Carnet d’adresses'),
    item('/invitations', 'ticket', 'Inviter un proche'),
    item('/enregistres', 'bookmark', 'Enregistrés'),
    item('/reglages', 'settings', 'Réglages'),
  ];
  if (me.isAdmin) items.push(item('/admin', 'chart', 'Direction'));
  modal(
    'Menu',
    h(
      'div',
      { class: 'modal-body me-menu' },
      h('a', { href: `/@${me.username}`, class: 'me-profile', onclick: go }, avatar(me, 'lg'), h('span', { class: 'grow' }, h('b', null, me.displayName), h('small', null, 'Voir mon profil')), icon('chevron', 'icon-sm')),
      h('nav', { class: 'me-list' }, items),
      h('div', { class: 'me-list' }, h('button', { class: 'me-item danger', onclick: () => (closeModal(), logout()) }, h('span', { class: 'me-item-icon' }, icon('logout')), h('span', { class: 'grow' }, 'Se déconnecter'))),
    ),
  );
}

function buildShell() {
  const u = store.user;
  const unsub = [];
  const navEls = new Map();
  const badges = { notifications: [], messages: [], requests: [], activity: [] };

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

  const links = [
    { key: 'salon', href: '/salon', icon: 'home', label: 'Salon' },
    { key: 'explorer', href: '/explorer', icon: 'compass', label: 'Explorer' },
    { key: 'journal', href: '/journal', icon: 'newspaper', label: 'Journal' },
    { key: 'notifications', href: '/notifications', icon: 'bell', label: 'Activité', badge: 'notifications' },
    { key: 'messages', href: '/messages', icon: 'mail', label: 'Messages', badge: 'messages' },
    { key: 'profil', href: `/@${u.username}`, icon: 'user', label: 'Profil' },
    { key: 'amis', href: '/amis', icon: 'users', label: 'Amis', badge: 'requests' },
    { key: 'groupes', href: '/groupes', icon: 'groups', label: 'Groupes' },
    { key: 'agenda', href: '/agenda', icon: 'calendar', label: 'Agenda' },
    { key: 'carnet', href: '/carnet', icon: 'book', label: 'Carnet' },
    { key: 'invitations', href: '/invitations', icon: 'ticket', label: 'Invitations' },
    { key: 'enregistres', href: '/enregistres', icon: 'bookmark', label: 'Enregistrés' },
    { key: 'reglages', href: '/reglages', icon: 'settings', label: 'Réglages' },
  ];
  if (u.isAdmin) links.push({ key: 'admin', href: '/admin', icon: 'chart', label: 'Direction' });

  const meCard = h('div', { class: 'me-card' });
  const paintMe = () => {
    const me = store.user;
    if (!me) return;
    meCard.replaceChildren(
      h('a', { href: `/@${me.username}` }, avatar(me, 'sm'), h('span', { class: 'meta' }, h('b', null, me.displayName), h('small', null, `@${me.username}`))),
      h('button', { class: 'icon-btn', title: 'Se déconnecter', 'aria-label': 'Se déconnecter', onclick: logout }, icon('logout')),
    );
  };
  paintMe();
  unsub.push(store.on('user', paintMe));

  // Bouton avatar placé en haut à droite des pages principales, sur téléphone
  const meAvatar = h('span');
  const meBtn = h('button', { class: 'me-btn mobile-only', type: 'button', 'aria-label': 'Menu : profil, amis, groupes, réglages', onclick: openMeMenu }, meAvatar, badge('requests'));
  const paintMeBtn = () => store.user && meAvatar.replaceChildren(avatar(store.user, 'sm'));
  paintMeBtn();
  unsub.push(store.on('user', paintMeBtn));

  const sidenav = h(
    'nav',
    { class: 'sidenav', 'aria-label': 'Navigation principale' },
    h('a', { href: '/salon', class: 'logo' }, 'AURUM'),
    links.map((l) =>
      register(
        l.key,
        h('a', { href: l.href, class: 'nav-link' }, h('span', { class: 'icon-wrap' }, icon(l.icon), l.badge ? badge(l.badge) : null), h('span', { class: 'label' }, l.label)),
      ),
    ),
    h('button', { class: 'btn btn-primary', onclick: openComposer, title: 'Publier' }, icon('pen'), h('span', { class: 'label' }, 'Publier')),
    meCard,
  );

  // Colonne de droite
  const searchInput = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher au cercle', 'aria-label': 'Rechercher' });
  const search = h(
    'form',
    {
      class: 'search-box',
      onsubmit: (e) => {
        e.preventDefault();
        const q = searchInput.value.trim();
        navigate(q ? `/explorer?q=${enc(q)}` : '/explorer');
        searchInput.value = '';
      },
    },
    icon('search'),
    searchInput,
  );
  const cardHost = h('div');
  const paintCard = () => {
    const me = store.user;
    if (!me) return;
    cardHost.replaceChildren(memberCard({ name: me.displayName, number: me.memberNumber, since: cardSince(me.joinedAt), founder: me.founder }));
  };
  paintCard();
  unsub.push(store.on('user', paintCard));

  const suggestBody = h('div', { class: 'panel-body' }, spinner());
  const trendBody = h('div', { class: 'panel-body' }, spinner());
  const trendPanel = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, 'Tendances'), trendBody);
  api
    .get('/api/suggestions?limit=4')
    .then(({ users }) => {
      clear(suggestBody);
      if (!users.length) suggestBody.append(h('p', { class: 'muted small', style: { padding: '8px 10px' } }, 'Vous suivez déjà tout le cercle.'));
      for (const x of users) suggestBody.append(userRow({ ...x, bio: '' }));
    })
    .catch(() => clear(suggestBody));
  api
    .get('/api/trending')
    .then(({ tags }) => {
      clear(trendBody);
      if (!tags.length) return trendPanel.remove();
      for (const t of tags.slice(0, 5)) {
        trendBody.append(h('a', { class: 'trend', href: `/explorer?q=${enc(`#${t.tag}`)}` }, h('b', null, `#${t.tag}`), h('small', null, `${num(t.count)} publication${t.count > 1 ? 's' : ''}`)));
      }
    })
    .catch(() => trendPanel.remove());

  const rail = h(
    'aside',
    { class: 'rail', 'aria-label': 'Compléments' },
    search,
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, 'Votre carte', h('a', { href: '/reglages' }, 'Gérer')), h('div', { class: 'mcard-wrap', style: { padding: '14px 16px 18px' } }, cardHost)),
    h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, 'À découvrir', h('a', { href: '/explorer' }, 'Voir plus')), suggestBody),
    trendPanel,
    h(
      'footer',
      { class: 'rail-footer' },
      h('a', { href: '/cgv' }, 'CGV'),
      h('a', { href: '/confidentialite' }, 'Confidentialité'),
      h('a', { href: '/mentions-legales' }, 'Mentions légales'),
      h('span', null, `© ${new Date().getFullYear()} AURUM`),
    ),
  );

  const tabbar = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Navigation' },
    register('salon', h('a', { href: '/salon' }, icon('home'), 'Salon')),
    register('explorer', h('a', { href: '/explorer' }, icon('compass'), 'Explorer')),
    h('a', { href: '#', 'aria-label': 'Publier', onclick: (e) => (e.preventDefault(), openComposer()) }, h('span', { class: 'plus' }, icon('plus'))),
    register('notifications', h('a', { href: '/notifications' }, h('span', { class: 'tab-icon' }, icon('bell'), badge('activity')), 'Activité')),
    register('messages', h('a', { href: '/messages' }, h('span', { class: 'tab-icon' }, icon('mail'), badge('messages')), 'Messages')),
  );

  const main = h('main', { class: 'main', id: 'main' });
  const el = h('div', { class: 'shell' }, sidenav, main, rail, tabbar);

  const paintBadges = (c) => {
    const values = { ...c, activity: (c.notifications || 0) + (c.requests || 0) };
    for (const kind of Object.keys(badges)) {
      const v = values[kind] || 0;
      for (const b of badges[kind]) {
        b.hidden = !v;
        b.textContent = v > 99 ? '99+' : String(v);
      }
    }
  };
  paintBadges(store.counters);
  unsub.push(store.on('counters', paintBadges));

  return {
    el,
    main,
    meBtn,
    userId: u.id,
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

function errorView(err) {
  return h(
    'div',
    { class: 'container' },
    emptyState('alert', 'Un contretemps', err?.message || 'Une erreur est survenue.', h('button', { class: 'btn btn-ghost', onclick: () => location.reload() }, 'Recharger')),
  );
}

function notFoundView() {
  return emptyState('compass', 'Page introuvable', "Cette page n'existe pas, ou plus.", h('a', { href: '/', class: 'btn btn-primary' }, "Retour à l'accueil"));
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
  for (const fn of cleanups.splice(0)) {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  }

  const url = new URL(location.href);
  lastLocation = url.pathname + url.search;
  const { route, params } = match(url.pathname);
  const u = store.user;
  const here = url.pathname + url.search;

  if (route) {
    if (route.access === 'guest' && u) return navigate(u.isMember ? '/salon' : '/rejoindre', { replace: true });
    if (route.home && u?.isMember) return navigate('/salon', { replace: true });
    const needsAuth = ['auth', 'member', 'admin'].includes(route.access);
    if (needsAuth && !u) return navigate(`/connexion?suite=${enc(here)}`, { replace: true });
    if ((route.access === 'member' || route.access === 'admin') && !u.isMember) return navigate('/rejoindre', { replace: true });
    if (route.access === 'admin' && !u.isAdmin) return navigate('/salon', { replace: true });
  }

  const layout = !route ? (u?.isMember ? 'app' : 'bare') : route.layout === 'auto' ? (u?.isMember ? 'app' : 'bare') : route.layout || 'bare';
  const mine = [];
  const ctx = {
    params,
    query: url.searchParams,
    route,
    title: null,
    onCleanup: (fn) => {
      if (typeof fn === 'function') mine.push(fn);
    },
  };

  let container;
  if (layout === 'app') {
    if (!shell || shell.userId !== u.id) {
      shell?.destroy();
      shell = buildShell();
    }
    if (appEl.firstElementChild !== shell.el) appEl.replaceChildren(shell.el);
    const nav = route?.nav === 'profil' && params.username?.toLowerCase() !== u.username.toLowerCase() ? null : route?.nav;
    shell.setActive(nav);
    shell.el.classList.toggle('wide', Boolean(route?.wide));
    container = shell.main;
    if (!opts.same) container.replaceChildren(spinner());
  } else {
    shell?.destroy();
    shell = null;
    container = appEl;
  }

  let el;
  try {
    el = route ? await route.view(ctx) : notFoundView();
  } catch (err) {
    console.error(err);
    el = errorView(err);
  }
  if (token !== renderToken) {
    mine.forEach((fn) => fn());
    return;
  }
  cleanups = mine;
  if (layout === 'app' && shell) {
    const head = el.querySelector?.('.page-head');
    if (head && !head.querySelector('[aria-label="Retour"]')) head.append(shell.meBtn);
  }
  const swap = () => container.replaceChildren(el);
  const smooth = !opts.same && layout === 'app' && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (smooth) document.startViewTransition(swap);
  else swap();
  baseTitle = ctx.title || 'AURUM';
  paintTitle();
  if (!location.hash) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Liens internes, historique, session
// ---------------------------------------------------------------------------
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return; // ancre dans la page
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});

window.addEventListener('popstate', () => {
  if (location.pathname + location.search === lastLocation) return; // simple changement d'ancre
  render();
});

window.addEventListener('aurum:auth', async (e) => {
  const { status } = e.detail;
  if (status === 401 && store.user) {
    disconnectRealtime();
    store.setUser(null);
    navigate('/connexion', { replace: true });
  } else if (status === 402 && store.user?.isMember) {
    disconnectRealtime();
    await store.refresh().catch(() => {});
    navigate('/rejoindre', { replace: true });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenu();
    document.querySelector('.lightbox')?.remove();
    closeModal();
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
  if (store.isMember) {
    connectRealtime();
    syncPush();
  }
  registerServiceWorker();
  // Toucher une notification ouvre la bonne page
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && typeof e.data.url === 'string') {
      const url = new URL(e.data.url, location.origin);
      if (url.origin === location.origin) navigate(url.pathname + url.search);
    }
  });
  render();
})();

