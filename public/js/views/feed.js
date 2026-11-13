import { api } from '../api.js';
import { store, isPolling } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, clear, spinner, emptyState, infinite, skeletonPosts } from '../dom.js';
import { postCard, composer } from '../components/post.js';
import { storiesBar } from '../components/stories.js';

// Carte d'accueil des nouveaux membres : 4 étapes, masquable.
function onboardingCard() {
  const host = h('div');
  let hidden = false;
  try {
    hidden = localStorage.getItem('aurum:onboarding-done') === '1';
  } catch {
    /* stockage indisponible */
  }
  if (hidden) return host;
  api
    .get('/api/me/progress')
    .then((p) => {
      const steps = [
        { done: p.avatar, label: 'Ajoutez une photo de profil', href: '/reglages' },
        { done: p.bio, label: 'Présentez-vous en une phrase', href: '/reglages' },
        { done: p.following > 0, label: 'Suivez au moins un membre', href: '/explorer' },
        { done: p.posts > 0, label: 'Publiez votre premier message', href: null },
      ];
      const count = steps.filter((x) => x.done).length;
      if (count === steps.length) return;
      const dismiss = () => {
        try {
          localStorage.setItem('aurum:onboarding-done', '1');
        } catch {
          /* stockage indisponible */
        }
        host.replaceChildren();
      };
      host.replaceChildren(
        h(
          'section',
          { class: 'onboarding' },
          h(
            'div',
            { class: 'onboarding-head' },
            h('div', null, h('h2', null, 'Bienvenue au cercle'), h('p', { class: 'muted small' }, `${count} sur ${steps.length} étapes`)),
            h('button', { class: 'icon-btn', 'aria-label': 'Masquer', onclick: dismiss }, icon('x')),
          ),
          h('div', { class: 'onboarding-bar' }, h('i', { style: { width: `${(count / steps.length) * 100}%` } })),
          h(
            'ul',
            null,
            steps.map((step) =>
              h(
                'li',
                { class: step.done ? 'done' : '' },
                h('span', { class: 'check-dot' }, step.done ? icon('check') : null),
                step.href && !step.done ? h('a', { href: step.href }, step.label) : h('span', null, step.label),
              ),
            ),
          ),
        ),
      );
    })
    .catch(() => {});
  return host;
}

// Liste paginée de publications (fil, profil…)
export function postList(fetchPage, { empty } = {}) {
  const list = h('div');
  const sentinel = h('div', { style: { height: '1px' } });
  const loader = spinner();
  const skel = skeletonPosts();
  loader.hidden = true;
  const root = h('div', null, skel, list, loader, sentinel);
  let before = null;
  let done = false;
  let loading = false;
  let stop = () => {};

  async function more() {
    if (loading || done) return;
    loading = true;
    try {
      const { posts, hasMore } = await fetchPage(before);
      for (const p of posts) list.append(postCard(p));
      if (posts.length) before = posts[posts.length - 1].id;
      done = !hasMore;
      if (done) {
        loader.remove();
        stop();
        if (!list.children.length && empty) list.append(empty());
      }
    } catch (err) {
      loader.replaceChildren(h('p', { class: 'muted small' }, err.message));
      done = true;
    } finally {
      loading = false;
      skel.remove();
      loader.hidden = false;
    }
  }

  return {
    el: root,
    start() {
      stop = infinite(sentinel, more);
      more();
      return () => stop();
    },
    prepend(post) {
      list.querySelector('.empty')?.remove();
      list.prepend(postCard(post));
    },
  };
}

export function feedView(ctx) {
  let scope = 'all';
  try {
    scope = localStorage.getItem('aurum:feed') === 'following' ? 'following' : 'all';
  } catch {
    /* stockage indisponible */
  }
  const host = h('div');
  let stopList = () => {};
  let current = null;

  const tabAll = h('button', { class: 'tab' }, 'Tout le cercle');
  const tabFollow = h('button', { class: 'tab' }, 'Mes abonnements');
  const pill = h('div', { class: 'new-posts', hidden: true });
  let pending = 0;

  function load() {
    stopList();
    clear(host);
    pending = 0;
    pill.hidden = true;
    tabAll.classList.toggle('active', scope === 'all');
    tabFollow.classList.toggle('active', scope === 'following');
    current = postList((before) => api.get(`/api/feed?scope=${scope}${before ? `&before=${before}` : ''}`), {
      empty: () =>
        scope === 'following'
          ? emptyState('users', 'Votre fil est encore calme', 'Suivez quelques membres pour voir leurs publications ici.', h('a', { href: '/explorer', class: 'btn btn-primary' }, 'Découvrir des membres'))
          : emptyState('sparkles', 'Le Salon vous attend', 'Soyez le premier à prendre la parole. Les premiers mots donnent le ton.'),
    });
    host.append(current.el);
    stopList = current.start();
  }
  const setScope = (s) => {
    scope = s;
    try {
      localStorage.setItem('aurum:feed', s);
    } catch {
      /* stockage indisponible */
    }
    load();
  };
  tabAll.addEventListener('click', () => setScope('all'));
  tabFollow.addEventListener('click', () => setScope('following'));

  ctx.onCleanup(() => stopList());
  ctx.onCleanup(store.on('post:created', (post) => !post.groupId && current?.prepend(post)));
  const showPill = () => {
    clear(pill);
    pill.append(
      h(
        'button',
        {
          class: 'btn btn-primary btn-sm',
          onclick: () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            load();
          },
        },
        icon('sparkles'),
        pending > 1 ? `${pending} nouvelles publications` : 'Nouvelle publication',
      ),
    );
    pill.hidden = false;
  };
  // Rafraîchissement régulier : on vérifie s'il y a des publications plus récentes
  if (isPolling()) {
    ctx.onCleanup(
      store.on('rt:tick', async () => {
        const top = Number(host.querySelector('.post')?.dataset.id || 0);
        try {
          const { posts } = await api.get(`/api/feed?scope=${scope}&limit=20`);
          const fresh = posts.filter((p) => p.id > top && !p.mine).length;
          if (fresh) {
            pending = fresh;
            showPill();
          }
        } catch {
          /* nouvel essai au prochain tour */
        }
      }),
    );
  }
  ctx.onCleanup(
    store.on('rt:post', () => {
      pending++;
      clear(pill);
      pill.append(
        h(
          'button',
          {
            class: 'btn btn-primary btn-sm',
            onclick: () => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              load();
            },
          },
          icon('sparkles'),
          pending > 1 ? `${pending} nouvelles publications` : 'Nouvelle publication',
        ),
      );
      pill.hidden = false;
    }),
  );

  load();
  const stories = storiesBar();
  ctx.title = 'Le Salon — AURUM';
  return h(
    'div',
    null,
    h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, 'Le Salon'), h('div', { class: 'sub' }, 'Le fil du cercle, sans algorithme ni publicité'))),
    stories.el,
    h('div', { class: 'tabs' }, tabAll, tabFollow),
    onboardingCard(),
    composer(),
    pill,
    host,
  );
}

export async function postView(ctx) {
  const id = Number(ctx.params.id);
  let post;
  try {
    ({ post } = await api.get(`/api/posts/${id}`));
  } catch (err) {
    return h('div', null, backHead('Publication'), emptyState('alert', 'Publication introuvable', err.message, h('a', { href: '/salon', class: 'btn btn-ghost' }, 'Retour au Salon')));
  }
  ctx.title = `${post.author.displayName} sur AURUM`;
  return h('div', null, backHead('Publication'), postCard(post, { expanded: true }));
}

export function backHead(title, sub, extra) {
  return h(
    'header',
    { class: 'page-head' },
    h(
      'button',
      {
        class: 'icon-btn',
        'aria-label': 'Retour',
        onclick: () => (history.length > 1 ? history.back() : navigate('/salon')),
      },
      icon('back'),
    ),
    h('div', { class: 'grow' }, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null),
    extra || null,
  );
}

// Publications enregistrées
export function savedView(ctx) {
  const list = postList((before) => api.get(`/api/saved${before ? `?before=${before}` : ''}`), {
    empty: () => emptyState('bookmark', 'Rien d’enregistré', 'Touchez le signet sous une publication pour la retrouver ici.'),
  });
  ctx.onCleanup(list.start());
  ctx.title = 'Enregistrés — AURUM';
  return h('div', null, backHead('Enregistrés', 'Visibles par vous seul'), list.el);
}
