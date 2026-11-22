// Grille de vidéos (profil, Explorer, hashtag, son, recherche) : vignette verticale, vues,
// « Épinglée », défilement infini ; un toucher ouvre la liste en plein écran à partir de la vidéo.
import { h, icon, short, avatar, infinite, spinner, emptyState, toast } from '../dom.js';
import { openViewer } from './feed.js';
import { warmImages } from '../warm.js';
import { filterCss } from './fx.js';

export function tile(post, { onOpen, showAuthor = false, showLikes = false } = {}) {
  const img = post.video?.poster || post.images?.[0] || null;
  const filter = filterCss(post.fx?.filter);
  const media = img
    ? h('img', { src: img, alt: '', loading: 'lazy', decoding: 'async', style: filter ? { filter } : null })
    : h('div', { class: `tile-text bg-${post.bg || 'violet'}` }, h('span', null, post.body.slice(0, 80)));
  return h(
    'a',
    { href: `/@${post.author.username}/video/${post.id}`, class: 'tile', onclick: (e) => { e.preventDefault(); onOpen(post); } },
    media,
    post.pinned ? h('span', { class: 'tile-pin' }, 'Épinglée') : null,
    post.kind === 'photo' && post.images.length > 1 ? h('span', { class: 'tile-kind' }, icon('photo', 'icon-xs')) : null,
    post.privacy === 'private' ? h('span', { class: 'tile-kind' }, icon('lock', 'icon-xs')) : null,
    showAuthor ? h('span', { class: 'tile-author' }, avatar(post.author, 'xs'), post.author.displayName) : null,
    h('span', { class: 'tile-views' }, icon(showLikes ? 'heart' : 'play', 'icon-xs'), short(showLikes ? post.likeCount : post.viewCount)),
    post.body && showAuthor ? h('span', { class: 'tile-caption' }, post.body.slice(0, 60)) : null,
  );
}

// fetchPage(cursor) → { posts, cursor }
export function videoGrid({ fetchPage, empty = null, showAuthor = false, showLikes = false, columns = 3 } = {}) {
  const grid = h('div', { class: `grid cols-${columns}` });
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
      const fresh = d.posts.filter((p) => !posts.some((x) => x.id === p.id));
      posts.push(...fresh);
      for (const p of fresh) grid.append(tile(p, { onOpen: open, showAuthor, showLikes }));
      warmImages(fresh.map((p) => p.video?.poster || p.images?.[0]).filter(Boolean));
      cursor = d.cursor;
      done = !d.cursor;
      if (!posts.length) {
        grid.replaceWith(h('div', { class: 'grid-empty' }, empty || emptyState('video', 'Aucune vidéo', null)));
      }
      return fresh;
    } catch (err) {
      toast(err.message, 'error');
      done = true;
      return [];
    } finally {
      loading = false;
      loader.hidden = done;
    }
  }
  const stop = infinite(sentinel, load);
  load();
  return { el: root, destroy: stop, get posts() { return posts; } };
}
