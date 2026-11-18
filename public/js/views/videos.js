// Vidéos en plein écran : une vidéo par écran, glisser vers le haut pour la suivante.
// La vidéo visible démarre aussitôt ; la suivante est déjà chargée.
import { api, enc } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, avatar, nameLine, richText, num, toast, emptyState, spinner } from '../dom.js';
import { sound } from '../components/video.js';

function slide(post) {
  const v = post.video;
  const landscape = v.width && v.height && v.width > v.height;
  const el = h('video', { class: `reel-video${landscape ? ' contain' : ''}`, src: v.url, poster: v.poster || undefined, preload: 'metadata', loop: true, playsinline: true, 'webkit-playsinline': '' });
  el.muted = !sound.get();
  el.playsInline = true;
  const playMark = h('span', { class: 'reel-play', hidden: true }, icon('play'));
  const bar = h('span', { class: 'reel-bar' }, h('i'));
  const soundBtn = h('button', { class: 'reel-btn', type: 'button', 'aria-label': 'Son' }, icon(el.muted ? 'mute' : 'sound'));
  const likeCount = h('small', null, num(post.likeCount || 0));
  const likeBtn = h('button', { class: `reel-btn${post.liked ? ' liked' : ''}`, type: 'button', 'aria-label': 'J’aime' }, icon(post.liked ? 'heart-fill' : 'heart'), likeCount);
  const paintSound = () => soundBtn.replaceChildren(icon(el.muted ? 'mute' : 'sound'));
  let userPaused = false;

  soundBtn.addEventListener('click', () => {
    sound.set(el.muted);
    el.muted = !sound.get();
    paintSound();
    if (el.paused) el.play().catch(() => {});
  });
  el.addEventListener('click', () => {
    userPaused = !el.paused;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  });
  el.addEventListener('play', () => (playMark.hidden = true));
  el.addEventListener('pause', () => (playMark.hidden = !userPaused));
  el.addEventListener('timeupdate', () => el.duration && (bar.firstChild.style.transform = `scaleX(${el.currentTime / el.duration})`));
  likeBtn.addEventListener('click', async () => {
    const was = post.liked;
    post.liked = !was;
    post.likeCount = (post.likeCount || 0) + (was ? -1 : 1);
    likeBtn.classList.toggle('liked', post.liked);
    likeBtn.replaceChildren(icon(post.liked ? 'heart-fill' : 'heart'), likeCount);
    likeCount.textContent = num(post.likeCount);
    try {
      if (was) await api.del(`/api/posts/${post.id}/like`);
      else await api.post(`/api/posts/${post.id}/like`, { reaction: 'love' });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const box = h(
    'section',
    { class: 'reel', dataset: { id: post.id } },
    el,
    playMark,
    h(
      'div',
      { class: 'reel-side' },
      likeBtn,
      h('a', { class: 'reel-btn', href: `/p/${post.id}`, 'aria-label': 'Commentaires' }, icon('comment'), h('small', null, num(post.commentCount || 0))),
      soundBtn,
    ),
    h(
      'div',
      { class: 'reel-info' },
      h('a', { href: `/@${enc(post.author.username)}`, class: 'reel-author' }, avatar(post.author, 'sm'), nameLine(post.author, { link: false })),
      post.body ? h('div', { class: 'reel-text' }, richText(post.body)) : null,
    ),
    bar,
  );
  box.__play = () => {
    if (userPaused) return;
    el.muted = !sound.get();
    paintSound();
    el.play().catch(() => {
      el.muted = true;
      paintSound();
      el.play().catch(() => {});
    });
  };
  box.__stop = () => el.pause();
  box.__preload = () => (el.preload = 'auto');
  return box;
}

export async function videosView(ctx) {
  const start = Number(ctx.query.get('p')) || null;
  const track = h('div', { class: 'reels-track' });
  const close = h('button', { class: 'reels-close', type: 'button', 'aria-label': 'Fermer', onclick: () => (history.length > 1 ? history.back() : navigate('/salon')) }, icon('back'));
  const root = h('div', { class: 'reels' }, close, h('span', { class: 'reels-title' }, 'Vidéos'), track);
  const seen = new Set();
  let before = null;
  let more = true;
  let loading = false;

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting && e.intersectionRatio >= 0.7) {
          e.target.__play();
          e.target.nextElementSibling?.__preload?.(); // la suivante est déjà prête
          if (!e.target.nextElementSibling?.nextElementSibling) loadMore();
        } else {
          e.target.__stop();
        }
      }
    },
    { root: track, threshold: [0, 0.7] },
  );
  ctx.onCleanup(() => io.disconnect());

  const add = (posts) => {
    for (const p of posts) {
      if (!p.video || seen.has(p.id)) continue;
      seen.add(p.id);
      const s = slide(p);
      track.append(s);
      io.observe(s);
    }
  };
  async function loadMore() {
    if (loading || !more) return;
    loading = true;
    try {
      const d = await api.get(`/api/videos/feed${before ? `?before=${before}` : ''}`);
      more = d.hasMore;
      if (d.posts.length) before = d.posts[d.posts.length - 1].id;
      add(d.posts);
    } catch (err) {
      toast(err.message, 'error');
    }
    loading = false;
  }

  if (start) {
    try {
      const { post } = await api.get(`/api/posts/${start}`);
      add([post]);
    } catch {
      /* publication introuvable : on montre simplement les vidéos récentes */
    }
  }
  track.append(h('div', { class: 'reels-loading' }, spinner()));
  await loadMore();
  track.querySelector('.reels-loading')?.remove();
  if (!track.children.length) {
    track.append(h('div', { class: 'reels-empty' }, emptyState('video', 'Aucune vidéo pour l’instant', 'Publiez la première depuis le Salon : touchez + puis l’icône vidéo.')));
  }
  // Clavier (ordinateur) : flèches haut / bas
  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      track.scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * track.clientHeight, behavior: 'smooth' });
    }
  };
  document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => document.removeEventListener('keydown', onKey));
  ctx.title = 'Vidéos — AURUM';
  return root;
}
