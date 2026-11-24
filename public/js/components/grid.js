// Grille de vidéos (profil, Explorer, hashtag, son, recherche) : vignette verticale, vues,
// « Épinglée », défilement infini ; un toucher ouvre la liste en plein écran à partir de la vidéo.
import { h, icon, short, avatar, infinite, spinner, emptyState, toast } from '../dom.js';
import { openViewer } from './feed.js';
import { warmImages } from '../warm.js';
import { filterCss } from './fx.js';

export function tile(post, { onOpen, showAuthor = false, showLikes = false, showPinned = false, badge = null } = {}) {
  const img = post.video?.poster || post.images?.[0] || null;
  const filter = filterCss(post.fx?.filter);
  const media = img
    ? h('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', style: filter ? { filter } : null })
    : h('div', { class: `tile-text bg-${post.bg || 'violet'}` }, h('span', null, post.body.slice(0, 80)));
  return h(
    'a',
    { href: `/@${post.author.username}/video/${post.id}`, class: 'tile', onclick: (e) => { e.preventDefault(); onOpen(post); } },
    media,
    badge ? h('span', { class: 'tile-pin' }, badge) : post.pinned && showPinned ? h('span', { class: 'tile-pin' }, 'Épinglée') : null,
    post.kind === 'photo' && post.images.length > 1 ? h('span', { class: 'tile-kind' }, icon('photo', 'icon-xs')) : null,
    post.privacy === 'private' ? h('span', { class: 'tile-kind' }, icon('lock', 'icon-xs')) : null,
    showAuthor ? h('span', { class: 'tile-author' }, avatar(post.author, 'xs'), h('span', null, post.author.displayName)) : null,
    h('span', { class: 'tile-views' }, icon(showLikes ? 'heart' : 'play', 'icon-xs'), short(showLikes ? post.likeCount : post.viewCount)),
    post.body && showAuthor ? h('span', { class: 'tile-caption' }, post.body.slice(0, 60)) : null,
  );
}

// fetchPage(cursor) → { posts, cursor }. initial : pages déjà chargées (retour en arrière, la
// position est retrouvée d'un coup) ; onPage : prévenu à chaque page (pour les garder en mémoire).
export function videoGrid({ fetchPage, empty = null, showAuthor = false, showLikes = false, showPinned = false, tileBadge = null, columns = 3, initial = null, onPage = null, skeletons = 9 } = {}) {
  const grid = h('div', { class: `grid cols-${columns}` });
  // Squelettes jusqu'à la première page (la grille garde sa place : rien ne saute)
  if (!initial?.posts?.length && skeletons) grid.append(...Array.from({ length: skeletons }, () => h('div', { class: 'tile sk', 'aria-hidden': 'true' })));
  const sentinel = h('div', { class: 'grid-sentinel' });
  const loader = h('div', { class: 'grid-loader' }, spinner());
  const root = h('div', { class: 'grid-wrap' }, grid, loader, sentinel);
  const posts = [];
  let cursor = null;
  let done = false;
  let loading = false;
  const open = (post) =>
    openViewer(posts, {
      startId: post.id,
      more: !done,
      load: async () => {
        const d = await load();
        return { posts: d, more: !done };
      },
    });
  async function load() {
    if (loading || done) return [];
    loading = true;
    try {
      const d = await fetchPage(cursor);
      grid.querySelectorAll(':scope > .sk').forEach((el) => el.remove());
      const fresh = d.posts.filter((p) => !posts.some((x) => x.id === p.id));
      posts.push(...fresh);
      for (const p of fresh) grid.append(tile(p, { onOpen: open, showAuthor, showLikes, showPinned, badge: tileBadge?.(p) }));
      warmImages(fresh.map((p) => p.video?.poster || p.images?.[0]).filter(Boolean));
      cursor = d.cursor;
      done = !d.cursor;
      onPage?.({ posts, cursor });
      if (!posts.length) {
        grid.replaceWith(h('div', { class: 'grid-empty' }, empty || emptyState('video', 'Aucune vidéo', null)));
      }
      return fresh;
    } catch (err) {
      toast(err.message, 'error');
      grid.querySelectorAll(':scope > .sk').forEach((el) => el.remove());
      done = true;
      return [];
    } finally {
      loading = false;
      loader.hidden = done;
    }
  }
  if (initial?.posts?.length) {
    posts.push(...initial.posts);
    for (const p of posts) grid.append(tile(p, { onOpen: open, showAuthor, showLikes, showPinned, badge: tileBadge?.(p) }));
    cursor = initial.cursor;
    done = !cursor;
    loader.hidden = done;
  }
  const stop = infinite(sentinel, load);
  if (!initial?.posts?.length) load();
  return { el: root, destroy: stop, get posts() { return posts; } };
}
