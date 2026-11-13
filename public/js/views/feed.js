import { api } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, clear, spinner, emptyState, infinite } from '../dom.js';
import { postCard, composer } from '../components/post.js';

// Liste paginée de publications (fil, profil…)
export function postList(fetchPage, { empty } = {}) {
  const list = h('div');
  const sentinel = h('div', { style: { height: '1px' } });
  const loader = spinner();
  const root = h('div', null, list, loader, sentinel);
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
          ? emptyState('users', 'Votre fil est encore calme', 'Suivez quelques membres pour voir leurs publications ici.', h('a', { href: '/explorer', class: 'btn btn-gold' }, 'Découvrir des membres'))
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
  ctx.onCleanup(store.on('post:created', (post) => current?.prepend(post)));
  ctx.onCleanup(
    store.on('rt:post', () => {
      pending++;
      clear(pill);
      pill.append(
        h(
          'button',
          {
            class: 'btn btn-gold btn-sm',
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
  ctx.title = 'Le Salon — AURUM';
  return h(
    'div',
    null,
    h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, 'Le Salon'), h('div', { class: 'sub' }, 'Le fil du cercle, sans algorithme ni publicité'))),
    h('div', { class: 'tabs' }, tabAll, tabFollow),
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
