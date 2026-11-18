// Vidéos en plein écran : une vidéo par écran, glisser vers le haut pour la suivante.
// Un seul lecteur (déverrouillé par le toucher qui ouvre cet écran) passe d'une vidéo à
// l'autre : la lecture démarre aussitôt, avec le son ; la suivante se prépare en coulisse.
import { api, enc } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, avatar, richText, num, toast, emptyState, spinner, onTaps, heartBurst, shareLink, verifiedMark } from '../dom.js';
import { sound, reelsPlayer, cachedReels, rememberReels, preloadVideo, localVideo, sameVideo } from '../components/video.js';

function slide(post) {
  const v = post.video;
  const likeCount = h('small', null, post.likeCount ? num(post.likeCount) : '');
  const likeBtn = h('button', { class: `reel-act${post.liked ? ' liked' : ''}`, type: 'button', 'aria-label': 'J’aime' }, icon(post.liked ? 'heart-fill' : 'heart'), likeCount);
  const paintLike = () => {
    likeBtn.classList.toggle('liked', post.liked);
    likeBtn.replaceChildren(icon(post.liked ? 'heart-fill' : 'heart'), likeCount);
    likeCount.textContent = post.likeCount ? num(post.likeCount) : '';
  };
  const toggleLike = async (force) => {
    const was = post.liked;
    if (force && was) return;
    post.liked = !was;
    post.likeCount = Math.max(0, (post.likeCount || 0) + (was ? -1 : 1));
    paintLike();
    try {
      if (was) await api.del(`/api/posts/${post.id}/like`);
      else await api.post(`/api/posts/${post.id}/like`, { reaction: 'love' });
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  likeBtn.addEventListener('click', () => toggleLike());

  const box = h(
    'section',
    { class: 'reel', dataset: { id: post.id } },
    h('img', { class: 'reel-poster', src: v.poster || '', alt: `Vidéo de ${post.author.displayName}`, decoding: 'async' }),
    h('div', { class: 'reel-holder' }),
    h('div', { class: 'reel-shade' }),
    h('span', { class: 'reel-play', hidden: true }, icon('play')),
    h(
      'div',
      { class: 'reel-side' },
      likeBtn,
      h('a', { class: 'reel-act', href: `/p/${post.id}`, 'aria-label': 'Commentaires' }, icon('comment'), h('small', null, post.commentCount ? num(post.commentCount) : '')),
      h('button', { class: 'reel-act', type: 'button', 'aria-label': 'Partager', onclick: () => shareLink(`${post.author.displayName} sur AURUM`, `/p/${post.id}`) }, icon('send')),
    ),
    h(
      'div',
      { class: 'reel-info' },
      h('a', { href: `/@${enc(post.author.username)}`, class: 'reel-author' }, avatar(post.author, 'sm'), h('b', null, post.author.displayName), post.author.verified ? verifiedMark() : null),
      post.body ? h('div', { class: 'reel-text' }, richText(post.body)) : null,
    ),
    h('span', { class: 'reel-bar' }, h('i')),
  );
  box.__post = post;
  box.__like = () => toggleLike(true);
  return box;
}

export async function videosView(ctx) {
  // Haut de l'écran en noir (navigateur et application installée), rétabli en sortant
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
  const saved = metas.map((m) => m.content);
  metas.forEach((m) => (m.content = '#000000'));
  document.documentElement.classList.add('reels-mode');

  const player = reelsPlayer();
  const track = h('div', { class: 'reels-track' });
  const soundBtn = h('button', { type: 'button', 'aria-label': 'Son' });
  const hint = h('button', { class: 'reels-hint', type: 'button', hidden: true }, icon('sound', 'icon-sm'), 'Activer le son');
  const back = h('button', { type: 'button', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/salon')) }, icon('back'));
  const root = h('div', { class: 'reels' }, h('div', { class: 'reels-top' }, back, soundBtn), hint, track);

  let active = null;
  let userPaused = false;
  const paintSound = () => soundBtn.replaceChildren(icon(player.muted ? 'mute' : 'sound'));
  const unmute = () => {
    sound.set(true);
    player.muted = false;
    hint.hidden = true;
    paintSound();
    if (player.paused && !userPaused) player.play().catch(() => {});
  };
  soundBtn.addEventListener('click', () => {
    if (player.muted) return unmute();
    sound.set(false);
    player.muted = true;
    paintSound();
  });
  hint.addEventListener('click', unmute);

  const start = () => {
    player.muted = !sound.get();
    paintSound();
    const p = player.play();
    if (!p) return;
    p.then(() => {
      hint.hidden = !player.muted;
    }).catch(() => {
      // Son refusé sans toucher (adresse ouverte directement) : lecture muette, un toucher active le son
      player.muted = true;
      paintSound();
      hint.hidden = false;
      player.play().catch(() => {});
    });
  };

  function activate(box) {
    if (active === box) return;
    active?.classList.remove('is-active', 'is-ready');
    active = box;
    box.classList.add('is-active');
    userPaused = false;
    const v = box.__post.video;
    box.querySelector('.reel-holder').append(player);
    if (!sameVideo(player, v)) {
      box.classList.remove('is-ready');
      // Déjà téléchargée sur le téléphone : démarrage immédiat ; sinon lecture en ligne
      player.src = localVideo(v) || v.url;
    } else if (player.readyState >= 2) {
      box.classList.add('is-ready');
    }
    start();
    // Les deux suivantes se téléchargent en entier pendant qu'on regarde
    let next = box.nextElementSibling;
    for (let k = 0; k < 2 && next?.__post; k++, next = next.nextElementSibling) preloadVideo(next.__post.video);
    if (!box.nextElementSibling?.nextElementSibling) loadMore();
  }

  const onPlaying = () => active?.classList.add('is-ready');
  const onTime = () => {
    const bar = active?.querySelector('.reel-bar i');
    if (bar && player.duration) bar.style.transform = `scaleX(${player.currentTime / player.duration})`;
  };
  const onPause = () => active?.querySelector('.reel-play')?.toggleAttribute('hidden', !userPaused);
  player.addEventListener('playing', onPlaying);
  player.addEventListener('timeupdate', onTime);
  player.addEventListener('pause', onPause);
  player.addEventListener('play', onPause);

  // Toucher : pause / lecture (ou activer le son) ; double-toucher : j'aime
  onTaps(track, {
    single: (e) => {
      if (e.target.closest('a, button')) return;
      if (player.muted && !hint.hidden) return unmute();
      userPaused = !player.paused;
      if (player.paused) player.play().catch(() => {});
      else player.pause();
      onPause();
    },
    double: (e) => {
      if (e.target.closest('a, button') || !active) return;
      heartBurst(active, e);
      active.__like();
    },
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting && e.intersectionRatio >= 0.6) activate(e.target);
    },
    { root: track, threshold: [0.6] },
  );

  const seen = new Set();
  let before = null;
  let more = true;
  let loading = false;
  const all = [];
  const add = (posts) => {
    for (const p of posts) {
      if (!p.video || seen.has(p.id) || (p.video.expiresAt && p.video.expiresAt <= Date.now())) continue;
      seen.add(p.id);
      all.push(p);
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
      if (all.length <= 8) rememberReels(all.slice(), more);
    } catch (err) {
      toast(err.message, 'error');
    }
    loading = false;
  }

  ctx.onCleanup(() => {
    io.disconnect();
    player.pause();
    player.remove();
    player.removeEventListener('playing', onPlaying);
    player.removeEventListener('timeupdate', onTime);
    player.removeEventListener('pause', onPause);
    player.removeEventListener('play', onPause);
    metas.forEach((m, i) => (m.content = saved[i]));
    document.documentElement.classList.remove('reels-mode');
  });

  // Liste déjà chargée (instantané), sinon chargement
  const startId = Number(ctx.query.get('p')) || null;
  const cache = cachedReels();
  if (cache) {
    more = cache.hasMore;
    before = cache.posts.length ? cache.posts[cache.posts.length - 1].id : null;
    add(cache.posts);
  }
  if (startId && !seen.has(startId)) {
    try {
      const { post } = await api.get(`/api/posts/${startId}`);
      if (post.video) {
        add([post]);
        track.prepend(track.lastElementChild); // la vidéo touchée en premier
      }
    } catch {
      /* publication introuvable : on montre simplement les vidéos récentes */
    }
  }
  if (!cache) {
    track.append(h('div', { class: 'reels-loading' }, spinner()));
    await loadMore();
    track.querySelector('.reels-loading')?.remove();
  }
  if (!track.children.length) {
    track.append(h('div', { class: 'reels-empty' }, emptyState('video', 'Aucune vidéo pour l’instant', 'Publiez la première depuis le Salon : touchez + puis l’icône vidéo.')));
  } else if (startId) {
    const target = [...track.children].find((el) => el.__post?.id === startId);
    if (target) requestAnimationFrame(() => (track.scrollTop = target.offsetTop));
  }

  // Clavier (ordinateur) : flèches haut / bas, espace
  const onKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      track.scrollBy({ top: (e.key === 'ArrowDown' ? 1 : -1) * track.clientHeight, behavior: 'smooth' });
    } else if (e.key === 'Escape') {
      back.click();
    }
  };
  document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => document.removeEventListener('keydown', onKey));
  paintSound();
  ctx.title = 'Vidéos — AURUM';
  return root;
}
