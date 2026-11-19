import { api } from '../api.js';
import { store, isPolling } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, clear, spinner, emptyState, infinite, skeletonPosts, avatar, nameLine, richText, remaining, timeAgo, confirmDialog, toast } from '../dom.js';
import { postCard } from '../components/post.js';
import { storiesBar } from '../components/stories.js';
import { nextEventCard } from './events.js';
import { journalStrip } from './journal.js';
import { stepSheet } from './welcome.js';
import { coach } from '../components/tips.js';

// Avant-premières : annonces de la Direction réservées aux Fondateurs, en tête du Salon
function previewsSection(ctx) {
  const host = h('div', { class: 'previews' });
  const card = (p) => {
    const el = h(
      'article',
      { class: 'preview-card' },
      h(
        'div',
        { class: 'preview-head' },
        h('span', { class: 'preview-label' }, icon('sparkles', 'icon-xs'), 'Avant-première'),
        h('small', null, `Fondateurs · pour tous dans ${remaining(p.releaseAt)}`),
        p.canDelete
          ? h('button', {
              class: 'icon-btn preview-del',
              type: 'button',
              'aria-label': 'Retirer l’avant-première',
              onclick: async () => {
                if (!(await confirmDialog('Retirer cette avant-première ?', 'Elle ne sera pas publiée pour les autres membres.', 'Retirer'))) return;
                try {
                  await api.del(`/api/previews/${p.id}`);
                  el.remove();
                } catch (err) {
                  toast(err.message, 'error');
                }
              },
            }, icon('x'))
          : null,
      ),
      h('div', { class: 'preview-author' }, avatar(p.author, 'xs'), nameLine(p.author), h('span', { class: 'muted small' }, timeAgo(p.createdAt))),
      p.body ? h('div', { class: 'preview-body' }, richText(p.body)) : null,
      p.images.length ? h('div', { class: 'preview-images', dataset: { count: String(Math.min(p.images.length, 2)) } }, p.images.slice(0, 2).map((src) => h('img', { src, alt: '', loading: 'lazy' }))) : null,
    );
    return el;
  };
  const load = async () => {
    try {
      const { previews } = await api.get('/api/previews');
      host.replaceChildren(...previews.map(card));
    } catch {
      /* la section reste vide */
    }
  };
  load();
  ctx.onCleanup(store.on('preview:created', load));
  return host;
}

// Carte « Bien démarrer » : cinq étapes, chacune faisable d'un toucher, sans quitter le Salon.
function onboardingCard() {
  const host = h('div');
  let hidden = false;
  try {
    hidden = localStorage.getItem('aurum:onboarding-done') === '1';
  } catch {
    /* stockage indisponible */
  }
  if (hidden) return host;
  const dismiss = () => {
    try {
      localStorage.setItem('aurum:onboarding-done', '1');
    } catch {
      /* stockage indisponible */
    }
    host.replaceChildren();
  };
  const load = () =>
    api
      .get('/api/me/progress')
      .then((p) => {
        const steps = [
          { done: p.avatar, label: 'Ajouter une photo de profil', action: 'Ajouter', run: () => stepSheet('photo', load) },
          { done: p.following >= 3, label: `Suivre 3 membres${p.following ? ` (${Math.min(p.following, 3)}/3)` : ''}`, action: 'Choisir', run: () => stepSheet('follow', load) },
          { done: p.posts > 0, label: 'Publier pour la première fois', action: 'Publier', run: () => document.dispatchEvent(new CustomEvent('aurum:create')) },
          { done: p.bio, label: 'Vous présenter en une phrase', action: 'Écrire', run: () => navigate('/reglages') },
          { done: p.invites > 0, label: 'Inviter un proche', action: 'Inviter', run: () => navigate('/invitations') },
        ];
        const count = steps.filter((x) => x.done).length;
        if (count === steps.length) {
          // Bravo, puis la carte disparaît
          host.replaceChildren(h('section', { class: 'onboarding onboarding-done' }, h('span', { class: 'check-dot' }, icon('check')), h('div', null, h('b', null, 'Bravo, vous êtes prêt.'), h('p', { class: 'muted small' }, 'Votre profil est complet.'))));
          setTimeout(dismiss, 4000);
          return;
        }
        host.replaceChildren(
          h(
            'section',
            { class: 'onboarding' },
            h(
              'div',
              { class: 'onboarding-head' },
              h('div', null, h('h2', null, 'Bien démarrer'), h('p', { class: 'muted small' }, `${count} sur ${steps.length} · environ 2 minutes`)),
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
                  h('span', { class: 'grow' }, step.label),
                  step.done ? null : h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: step.run }, step.action),
                ),
              ),
            ),
          ),
        );
      })
      .catch(() => {});
  load();
  // Une publication vient d'être faite : la carte se met à jour
  const onPosted = () => (host.isConnected ? load() : document.removeEventListener('aurum:posted', onPosted));
  document.addEventListener('aurum:posted', onPosted);
  return host;
}

// Liste paginée de publications (fil, profil…)
export function postList(fetchPage, { empty, insertAfter = null } = {}) {
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
      for (const p of posts) {
        list.append(postCard(p));
        // Un bloc glissé dans le fil (le Journal), comme les suggestions d'Instagram
        if (insertAfter && !insertAfter.done && list.querySelectorAll(':scope > .post').length === insertAfter.index) {
          list.append(insertAfter.el);
          insertAfter.done = true;
        }
      }
      if (insertAfter && !insertAfter.done && done === false && !hasMore) {
        list.append(insertAfter.el);
        insertAfter.done = true;
      }
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
      insertAfter: { index: 2, el: journalStrip() },
      empty: () =>
        scope === 'following'
          ? emptyState('users', 'Votre fil est encore calme', 'Suivez quelques membres : leurs publications apparaîtront ici, dans l’ordre.', h('button', { type: 'button', class: 'btn btn-primary', onclick: () => stepSheet('follow', () => load()) }, 'Choisir des membres à suivre'))
          : emptyState('sparkles', 'Le Salon vous attend', 'Soyez le premier à prendre la parole. Les premiers mots donnent le ton.', h('button', { type: 'button', class: 'btn btn-primary', onclick: () => document.dispatchEvent(new CustomEvent('aurum:create')) }, 'Publier')),
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

  // Pastilles de l'en-tête (Activité, Messages), mises à jour en direct
  function headBadge(kind) {
    const b = h('span', { class: 'badge-count', hidden: true });
    const paint = (c = {}) => {
      const v = kind === 'activity' ? (c.notifications || 0) + (c.requests || 0) : c[kind] || 0;
      b.hidden = !v;
      b.textContent = v > 99 ? '99+' : String(v);
    };
    paint(store.counters);
    ctx.onCleanup(store.on('counters', paint));
    return b;
  }

  load();
  // Comptes automatiques : publient ce qui est dû (Journal, question du jour…) à l'ouverture du Salon
  api
    .post('/api/bots/tick')
    .then((r) => {
      if (!r?.posted?.length || !host.isConnected) return;
      if (window.scrollY < 80) load();
      else {
        pending += r.posted.length;
        showPill();
      }
    })
    .catch(() => {});
  const stories = storiesBar();
  // Astuces au premier passage (une à la fois, une seule fois par appareil)
  setTimeout(() => {
    if (!host.isConnected) return;
    coach('reagir', host.querySelector('.post .react-btn'), 'Réagir', 'Touchez pour aimer. Gardez le doigt appuyé pour choisir une autre réaction.');
    coach('story', stories.el.querySelector('.story-item'), 'Votre story', 'Une photo ou une vidéo, visible 24 h par le cercle. Touchez le +.', { delay: 1400 });
  }, 2200);
  ctx.title = 'Le Salon — AURUM';
  return h(
    'div',
    null,
    // En-tête façon Instagram : le logo, l'Activité et les Messages
    h(
      'header',
      { class: 'page-head salon-head' },
      h('a', { href: '/salon', class: 'wordmark', 'aria-label': 'AURUM, le Salon' }, 'AURUM'),
      h('span', { class: 'grow' }),
      h('a', { href: '/explorer', class: 'head-icon', 'aria-label': 'Explorer' }, icon('search')),
      h('a', { href: '/notifications', class: 'head-icon', 'aria-label': 'Activité' }, icon('heart'), headBadge('activity')),
      h('a', { href: '/messages', class: 'head-icon', 'aria-label': 'Messages' }, icon('send'), headBadge('messages')),
    ),
    stories.el,
    h(
      'button',
      { class: 'compose-row', type: 'button', onclick: () => document.dispatchEvent(new CustomEvent('aurum:compose')) },
      avatar(store.user, 'sm'),
      h('span', { class: 'grow' }, 'Que souhaitez-vous partager ?'),
      h('span', { class: 'compose-photo' }, icon('image')),
    ),
    previewsSection(ctx),
    onboardingCard(),
    nextEventCard(),
    h('div', { class: 'tabs feed-tabs' }, tabAll, tabFollow),
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
