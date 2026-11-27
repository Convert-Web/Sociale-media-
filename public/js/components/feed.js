// Fil vertical plein écran : une publication par écran, glisser vers le haut pour la suivante.
// Un seul lecteur vidéo (déverrouillé par le premier toucher) passe d'une vidéo à l'autre : la
// lecture démarre aussitôt, avec le son ; les suivantes se préparent en coulisse (téléchargement
// par morceaux, lecture progressive). Toucher : pause ; double toucher : J'aime ; appui long :
// options. Barre de lecture déplaçable. Le temps regardé nourrit l'algorithme « Pour toi ».
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, richText, short, count, toast, emptyState, spinner, onTaps, heartBurst, verifiedMark, timeAgo, confirmDialog, deName } from '../dom.js';
import {
  sound, reelsPlayer, preloadVideo, preloadStart, localVideo, sameVideo, setSource, PRIO, preloadEta, cancelPreload, holdPreloads, releasePreloads,
  clockLabel, canProgressive, progressiveReady, progressiveCheck, playProgressive, disableProgressive, downloadedBytes, relaxPreload, reportVideoIssue, videoBlob,
} from './video.js';
import { fxLayer, filterCss } from './fx.js';
import { toggleLike, toggleSave, needLogin, follow, postPath } from './actions.js';
import { openComments } from './comments.js';
import { openShare, downloadPost } from './share.js';
import { openSheet, closeSheet, sidePanelOpen } from './sheet.js';
import { reportDialog } from './report.js';
import { translateLink, myLang } from './translate.js';
import { openActu } from './actusheet.js';

let speed = 1; // vitesse de lecture choisie (pour toute la visite)
const BG = { violet: 'bg-violet', rose: 'bg-rose', ocean: 'bg-ocean', soleil: 'bg-soleil', menthe: 'bg-menthe', nuit: 'bg-nuit', feu: 'bg-feu', ciel: 'bg-ciel' };

// Temps regardé, envoyé en quittant une vidéo (même si l'onglet se ferme : keepalive)
function sendWatch(w) {
  if (!w || w.sent || w.ms < 300) return;
  w.sent = true;
  const d = w.duration || 0;
  const body = JSON.stringify({ ms: Math.round(w.ms), ratio: d ? Math.min(1, w.max / d) : 0, loops: w.loops });
  fetch(`/api/posts/${w.id}/watch`, { method: 'POST', headers: { 'x-vibz': '1', 'content-type': 'application/json' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => {});
}
const viewed = new Map(); // publication → dernière vue comptée (une vue par passage)
function countPlay(post, box) {
  const last = viewed.get(post.id) || 0;
  if (Date.now() - last < 4000) return;
  viewed.set(post.id, Date.now());
  api.post(`/api/posts/${post.id}/view`).then((r) => {
    if (r?.views) {
      post.viewCount = r.views;
      box.__paintViews?.();
    }
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Une diapositive
// ---------------------------------------------------------------------------
// Bouton de la barre d'actions (en bas de la carte) : icône et nombre côte à côte
function actButton(ic, label, count, cls = '') {
  const small = h('small', null, count);
  const b = h('button', { class: `act ${cls}`, type: 'button', 'aria-label': label }, h('span', { class: 'act-ic' }, icon(ic)), small);
  b.__count = small;
  return b;
}

function slide(post) {
  const box = h('section', { class: `slide kind-${post.kind}`, dataset: { id: post.id } });
  box.__post = post;
  const v = post.video;
  const ar = v?.width && v?.height ? v.width / v.height : 9 / 16;
  if (post.kind === 'video') box.style.setProperty('--ar', String(ar));

  // Média : vidéo (lecteur partagé), photos (carrousel) ou texte sur fond coloré. Vidéos et
  // photos remplissent toujours tout l'écran, cadrées de la même façon (le surplus est coupé).
  let media;
  if (post.kind === 'video') {
    const filter = filterCss(post.fx?.filter);
    media = h(
      'div',
      { class: 'slide-media', style: { '--ar': String(ar) } },
      h('img', { class: 'slide-poster', src: v.poster || '', alt: '', decoding: 'async', draggable: 'false', style: filter ? { filter } : null }),
      h('div', { class: 'slide-holder' }),
      fxLayer(post.fx, { ar, fit: 'cover' }),
    );
  } else if (post.kind === 'photo') {
    const dots = h('div', { class: 'carousel-dots' }, post.images.map((_, i) => h('i', { class: i ? '' : 'on' })));
    const strip = h('div', { class: 'carousel' }, post.images.map((src) => h('div', { class: 'carousel-item' }, h('img', { src, alt: '', decoding: 'async', loading: 'lazy', draggable: 'false' }))));
    strip.addEventListener('scroll', () => {
      const i = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
      [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
    }, { passive: true });
    media = h('div', { class: 'slide-media photos' }, strip, post.images.length > 1 ? dots : null);
  } else {
    media = h('div', { class: `slide-media text-card ${BG[post.bg] || 'bg-violet'}` }, h('p', null, post.body));
  }

  // Barre d'actions
  const likeBtn = actButton(post.liked ? 'heart-fill' : 'heart', 'J’aime', short(post.likeCount), `like${post.liked ? ' on' : ''}`);
  const paintLike = (pop) => {
    likeBtn.classList.toggle('on', post.liked);
    likeBtn.querySelector('.act-ic').replaceChildren(icon(post.liked ? 'heart-fill' : 'heart'));
    likeBtn.__count.textContent = short(post.likeCount);
    likeBtn.setAttribute('aria-pressed', String(post.liked));
    if (pop) {
      likeBtn.classList.remove('pop');
      void likeBtn.offsetWidth;
      likeBtn.classList.add('pop');
    }
  };
  const like = (force) => {
    const was = post.liked;
    const r = toggleLike(post, () => paintLike(!was && post.liked), { force });
    return r;
  };
  likeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    like(false);
  });

  const commentBtn = actButton('comment', 'Commentaires', short(post.commentCount), 'comment');
  commentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openComments(post, { onCount: (n) => (commentBtn.__count.textContent = short(n)) });
  });

  const saveBtn = actButton(post.saved ? 'bookmarkFill' : 'bookmark', 'Favoris', short(post.saveCount), `save${post.saved ? ' on' : ''}`);
  const paintSave = () => {
    saveBtn.classList.toggle('on', post.saved);
    saveBtn.querySelector('.act-ic').replaceChildren(icon(post.saved ? 'bookmarkFill' : 'bookmark'));
    saveBtn.__count.textContent = short(post.saveCount);
  };
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSave(post, paintSave);
  });

  const shareBtn = actButton('share', 'Partager', short(post.shareCount), 'share');
  shareBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openShare(post, { onShared: () => (shareBtn.__count.textContent = short(post.shareCount)), onOptions: () => box.__options?.(), onNotInterested: () => box.__notInterested?.() });
  });

  // « Suivre » à côté du nom : on s'abonne sans quitter la vidéo
  const followBtn = !post.mine && !post.followsAuthor
    ? h('button', { class: `info-follow${post.requestedAuthor ? ' done' : ''}`, type: 'button', 'aria-label': `Suivre ${post.author.displayName}` }, post.requestedAuthor ? 'Demandé' : 'Suivre')
    : null;
  followBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (post.requestedAuthor) return;
    followBtn.disabled = true;
    const u = await follow(post.author.username, true);
    followBtn.disabled = false;
    if (!u) return;
    post.followsAuthor = u.isFollowing;
    post.requestedAuthor = u.requested;
    followBtn.classList.add('done');
    followBtn.replaceChildren(icon('check', 'icon-xs'), u.isFollowing ? 'Abonné' : 'Demandé');
    setTimeout(() => u.isFollowing && followBtn.remove(), 1200);
  });

  const actions = h('div', { class: 'actions' }, likeBtn, commentBtn, saveBtn, shareBtn);

  // Informations en bas : auteur, date, description dépliable, Duo/Stitch, son
  // (reconstruites quand la publication est modifiée : description, confidentialité, épinglage)
  const views = h('span', { class: 'info-views' });
  box.__paintViews = () => {
    views.textContent = post.kind === 'video' && (post.mine || post.viewCount > 0) ? ` · ${count(post.viewCount, 'vue')}` : '';
  };
  box.__paintViews();
  const buildInfo = () => {
    let text = null;
    if (post.body && post.kind !== 'text') {
      const inner = h('span', { class: 'info-text-inner' }, richText(post.body));
      const tr = post.lang && post.lang !== myLang() && store.user
        ? translateLink([post.body], post.lang, { small: true, show: ([t]) => inner.replaceChildren(richText(t)), hide: () => inner.replaceChildren(richText(post.body)) })
        : null;
      // Deux lignes, puis « plus » si la description est plus longue (comme dans le fil d'origine)
      const moreBtn = h('button', { type: 'button', class: 'info-more', hidden: true }, 'plus');
      const textBox = h('div', { class: 'info-text' }, inner);
      const toggleOpen = () => {
        const open = textBox.classList.toggle('open');
        moreBtn.textContent = open ? 'moins' : 'plus';
      };
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleOpen();
      });
      textBox.addEventListener('click', (e) => {
        if (e.target.closest('a, button')) return;
        e.stopPropagation();
        if (!moreBtn.hidden || textBox.classList.contains('open')) toggleOpen();
      });
      // La place réelle n'est connue qu'une fois la vidéo à l'écran
      const measure = () => {
        if (!textBox.isConnected || textBox.classList.contains('open')) return;
        moreBtn.hidden = inner.scrollHeight <= inner.clientHeight + 2;
      };
      if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(inner);
      text = h('div', { class: 'info-desc' }, textBox, h('div', { class: 'info-desc-actions' }, moreBtn, tr));
    }
    const chips = [];
    // Vidéo qui réagit à une actualité : l'article s'ouvre par-dessus la vidéo
    if (post.actu) {
      chips.push(h('a', { class: 'info-chip actu-chip', href: `/actu/${post.actu.id}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); openActu(post.actu.id); } },
        icon('newspaper', 'icon-xs'), h('span', null, `Réagit à : ${post.actu.title}`)));
    }
    if (post.subject) {
      chips.push(h('a', { class: `info-chip subject-chip${post.subject.gold ? ' gold' : ''}`, href: `/sujet/${post.subject.id}` },
        h('i', { class: 'subject-dot', 'aria-hidden': 'true' }), h('span', null, `${post.subject.gold ? 'Or du jour' : 'Sujet du jour'} : ${post.subject.title}`)));
    }
    if (post.duetOf) chips.push(h('a', { class: 'info-chip', href: `/@${enc(post.duetOf.username)}/video/${post.duetOf.id}` }, icon('duet', 'icon-xs'), `Duo avec @${post.duetOf.username}`));
    if (post.stitchOf) chips.push(h('a', { class: 'info-chip', href: `/@${enc(post.stitchOf.username)}/video/${post.stitchOf.id}` }, icon('scissors', 'icon-xs'), `Stitch avec @${post.stitchOf.username}`));
    if (post.privacy !== 'public') chips.push(h('span', { class: 'info-chip' }, icon(post.privacy === 'private' ? 'lock' : 'friends', 'icon-xs'), post.privacy === 'private' ? 'Moi uniquement' : 'Amis'));
    const soundLine = post.sound
      ? h('a', { class: 'info-sound', href: `/son/${post.sound.id}` }, icon('music', 'icon-xs'), h('span', null, post.sound.title))
      : null;
    return h(
      'div',
      { class: 'info' },
      post.repostedBy ? h('a', { class: 'info-repost', href: `/@${enc(post.repostedBy.username)}` }, icon('repost', 'icon-xs'), `${post.repostedBy.displayName} a republié`) : null,
      h('div', { class: 'info-who' },
        h('a', { href: `/@${enc(post.author.username)}`, class: 'info-avatar', 'aria-label': `Profil de ${post.author.displayName}` }, avatar(post.author, 'sm', { live: true })),
        h('span', { class: 'info-id' },
          h('a', { href: `/@${enc(post.author.username)}`, class: 'info-user' }, h('b', null, post.author.displayName), post.author.verified ? verifiedMark() : null),
          h('span', { class: 'info-meta' }, h('span', { class: 'info-date' }, timeAgo(post.createdAt)), views)),
        followBtn),
      text,
      chips.length ? h('div', { class: 'info-chips' }, chips) : null,
      soundLine,
    );
  };
  let info = buildInfo();
  box.__paintInfo = () => {
    const next = buildInfo();
    info.replaceWith(next);
    info = next;
    if (post.kind === 'text') media.querySelector('p').textContent = post.body;
    commentBtn.__count.textContent = short(post.commentCount);
    shareBtn.__count.textContent = short(post.shareCount);
  };

  const progress = post.kind === 'video' ? null : h('div', { class: 'slide-progress' });
  box.append(...[media, h('span', { class: 'slide-play', hidden: true }, icon('play')), info, actions, progress].filter(Boolean));
  box.__like = () => like(true);
  box.__paintLike = paintLike;
  box.__paintSave = paintSave;
  return box;
}

// ---------------------------------------------------------------------------
// Le fil
// load(seenIds) → { posts, more } : page suivante
// ---------------------------------------------------------------------------
// Bonne connexion (ou inconnue, comme sur iPhone) : les vidéos suivantes se téléchargent en entier
const fastNet = () => {
  const c = navigator.connection;
  if (!c) return true;
  if (c.saveData) return false;
  return !/(^|-)(2g|3g)$/.test(c.effectiveType || '') && !(c.downlink && c.downlink < 3);
};

export function verticalFeed({ load, initial = [], more: initialMore = true, startId = null, emptyView = null, onActive = null, onRefresh = null, onUpcoming = null, head = null }) {
  const player = reelsPlayer();
  const track = h('div', { class: 'feed-track' });
  const hint = h('button', { class: 'feed-unmute', type: 'button', hidden: true }, icon('mute', 'icon-sm'), 'Activer le son');
  const soundBtn = h('button', { class: 'feed-sound', type: 'button', 'aria-label': 'Son' });
  const upBtn = h('button', { class: 'feed-nav up', type: 'button', 'aria-label': 'Vidéo précédente', onclick: () => step(-1) }, icon('arrowUp'));
  const downBtn = h('button', { class: 'feed-nav down', type: 'button', 'aria-label': 'Vidéo suivante', onclick: () => step(1) }, icon('arrowDown'));

  // Barre de lecture : un toucher ou un glissement avance / recule dans la vidéo
  const fill = h('i');
  const knob = h('b');
  const bar = h('div', { class: 'scrub-bar' }, fill, knob);
  const scrub = h('div', { class: 'scrub no-taps', role: 'slider', 'aria-label': 'Position dans la vidéo', tabindex: '0' }, bar);
  const timeLabel = h('div', { class: 'scrub-time', 'aria-hidden': 'true' });
  // Tirer vers le bas, tout en haut du fil : nouvelles vidéos (téléphone)
  const ptr = h('div', { class: 'feed-ptr', 'aria-hidden': 'true' }, icon('refresh', 'icon-sm'), h('span', null, 'Tirer pour actualiser'));
  const root = h('div', { class: 'feed' }, track, ptr, hint, soundBtn, upBtn, downBtn, timeLabel, scrub);
  if (onRefresh) {
    let pull = null;
    const PULL = 72;
    const resetPtr = () => {
      ptr.style.transform = '';
      ptr.style.opacity = '';
      ptr.classList.remove('ready', 'pulling');
    };
    track.addEventListener('touchstart', (e) => {
      pull = track.scrollTop <= 0 && e.touches.length === 1 ? { y: e.touches[0].clientY, x: e.touches[0].clientX, d: 0 } : null;
    }, { passive: true });
    track.addEventListener('touchmove', (e) => {
      if (!pull) return;
      const dy = e.touches[0].clientY - pull.y;
      const dx = Math.abs(e.touches[0].clientX - pull.x);
      // Le doigt remonte, part de côté, ou le fil défile : ce n'est pas un « tirer pour actualiser »
      if (dy < -8 || dx > Math.max(24, dy) || track.scrollTop > 0) {
        pull = null;
        return resetPtr();
      }
      if (dy <= 0) return;
      pull.d = Math.min(130, dy * 0.55);
      ptr.classList.add('pulling');
      ptr.classList.toggle('ready', pull.d >= PULL);
      ptr.lastChild.textContent = pull.d >= PULL ? 'Relâcher pour actualiser' : 'Tirer pour actualiser';
      ptr.style.transform = `translate(-50%, ${pull.d}px)`;
      ptr.style.opacity = String(Math.min(1, pull.d / PULL));
    }, { passive: true });
    const endPull = () => {
      const go = pull && pull.d >= PULL;
      pull = null;
      if (!go) return resetPtr();
      ptr.lastChild.textContent = 'Actualisation…';
      ptr.classList.add('loading');
      navigator.vibrate?.(10);
      setTimeout(() => onRefresh(), 250);
    };
    track.addEventListener('touchend', endPull);
    track.addEventListener('touchcancel', () => {
      pull = null;
      resetPtr();
    });
  }

  let active = null;
  let userPaused = false;
  let actToken = 0;
  let watch = null;
  let destroyed = false;
  let sleeping = null;
  const paintSound = () => soundBtn.replaceChildren(icon(player.muted ? 'mute' : 'sound'));
  const unmute = () => {
    sound.set(true);
    player.muted = false;
    hint.hidden = true;
    paintSound();
    if (player.paused && !userPaused && active?.__post.kind === 'video') player.play().catch(() => {});
  };
  soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (player.muted) return unmute();
    sound.set(false);
    player.muted = true;
    paintSound();
  });
  hint.addEventListener('click', (e) => {
    e.stopPropagation();
    unmute();
  });
  // Un son à la fois : la vidéo qui joue avec le son met en pause l'épisode de podcast en cours
  const claimSound = () => !player.muted && !player.paused && document.dispatchEvent(new CustomEvent('vibz:sound'));
  player.addEventListener('playing', claimSound);
  player.addEventListener('volumechange', claimSound);

  const start = () => {
    player.muted = !sound.get();
    paintSound();
    player.defaultPlaybackRate = speed;
    player.playbackRate = speed;
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

  // Lecture en ligne (vidéo pas encore téléchargée) : les téléchargements d'avance attendent
  const stream = (v) => {
    cancelPreload(v);
    holdPreloads(6000);
    setSource(player, v, v.url);
  };
  const WAIT_FOR_BLOB = 2.5;
  let progressive = null;
  let watchdog = 0;
  const stopProgressive = () => {
    progressive?.stop();
    progressive = null;
    clearTimeout(watchdog);
  };

  function classic(v, token) {
    stopProgressive();
    const local = localVideo(v);
    const eta = preloadEta(v);
    if (local) {
      setSource(player, v, local);
      start();
    } else if (eta < WAIT_FOR_BLOB) {
      player.pause();
      let done = false;
      const go = (url) => {
        if (done || token !== actToken) return;
        done = true;
        if (url) setSource(player, v, url);
        else stream(v);
        start();
      };
      const job = preloadVideo(v, { prio: PRIO.now, force: true });
      if (!job) {
        stream(v);
        start();
        return;
      }
      job.then(go);
      setTimeout(() => go(null), Math.min(4000, eta * 1300 + 700));
    } else {
      stream(v);
      start();
    }
  }

  // Lecture progressive : démarre dès le premier morceau ; au moindre souci, lecture classique
  function playFromStart(v, token) {
    stopProgressive();
    let shown = false;
    const fallback = () => {
      if (token !== actToken) return;
      const at = player.currentTime;
      reportVideoIssue('lecture progressive abandonnée', v, { rs: player.readyState, err: player.error?.code || null, shown });
      disableProgressive();
      classic(v, token);
      if (at > 0.5) pendingSeek = at;
    };
    progressive = playProgressive(player, v, { onFail: fallback });
    player.addEventListener('loadeddata', () => (shown = true), { once: true });
    start();
    watchdog = setTimeout(() => {
      if (token === actToken && progressive && !shown && player.readyState < 2) fallback();
    }, 4500);
  }

  function endWatch() {
    if (watch) {
      if (watch.playing) watch.ms += performance.now() - watch.since;
      sendWatch(watch);
    }
    watch = null;
  }

  // Mémoire du téléphone : les images des publications loin de l'écran sont libérées pendant
  // une longue session, puis rechargées quand on y revient
  const withImages = new Set();
  const releaseImages = (box) => {
    for (const img of box.querySelectorAll('img.slide-poster, .carousel-item img')) {
      const src = img.getAttribute('src');
      if (!src) continue;
      img.dataset.src = src;
      img.removeAttribute('src');
    }
    withImages.delete(box);
  };
  const restoreImages = (box) => {
    for (const img of box.querySelectorAll('img[data-src]')) {
      img.src = img.dataset.src;
      delete img.dataset.src;
    }
    withImages.add(box);
  };
  function keepNear(box) {
    const near = new Set([box]);
    let el = box.previousElementSibling;
    for (let i = 0; i < 3 && el; i++, el = el.previousElementSibling) if (el.__post) near.add(el);
    el = box.nextElementSibling;
    for (let i = 0; i < 6 && el; i++, el = el.nextElementSibling) if (el.__post) near.add(el);
    for (const x of near) if (!withImages.has(x)) restoreImages(x);
    for (const x of [...withImages]) if (!near.has(x)) releaseImages(x);
  }

  function leaveForEnd() {
    // Carte de fin ou du Sujet du jour : pas de vidéo, donc ni barre de lecture ni bouton du son
    root.classList.add('no-scrub');
    if (!active) return;
    endWatch();
    setBuffering(false);
    stopProgressive();
    player.pause();
    active.classList.remove('is-active', 'is-ready', 'paused');
    active = null;
    actToken++;
  }

  function activate(box) {
    if (active === box || !box?.__post || destroyed) return;
    keepNear(box);
    if (active?.__post?.video && box.__post.video && active.__post.video.url !== box.__post.video.url) relaxPreload(active.__post.video);
    active?.classList.remove('is-active', 'is-ready');
    endWatch();
    active = box;
    const token = ++actToken;
    box.classList.add('is-active');
    root.style.setProperty('--ar', box.style.getPropertyValue('--ar') || '0.5625');
    userPaused = false;
    pendingSeek = null;
    setBuffering(box.__post.kind === 'video');
    const post = box.__post;
    onActive?.(post);
    // Panneau des commentaires ouvert (grand écran) : il suit la vidéo à l'écran
    if (sidePanelOpen()) openComments(post);
    // Photos et textes : pas de lecteur
    if (post.kind !== 'video') {
      stopProgressive();
      player.pause();
      player.remove();
      root.classList.add('no-scrub');
      const t0 = Date.now();
      setTimeout(() => token === actToken && Date.now() - t0 >= 1400 && countPlay(post, box), 1500);
    } else {
      root.classList.remove('no-scrub');
      const v = post.video;
      watch = { id: post.id, ms: 0, max: 0, loops: 0, last: 0, duration: v.duration || 0, playing: false, since: 0, viewed: false };
      player.style.filter = filterCss(post.fx?.filter);
      box.querySelector('.slide-holder').append(player);
      paintTime();
      if (!sameVideo(player, v)) {
        box.classList.remove('is-ready');
        const ready = localVideo(v) ? false : progressiveReady(v);
        if (localVideo(v)) {
          classic(v, token);
        } else if (ready === true) {
          playFromStart(v, token);
        } else if (ready === null && canProgressive()) {
          player.pause();
          stopProgressive();
          progressiveCheck(v).then((ok) => {
            if (token !== actToken) return;
            if (ok) playFromStart(v, token);
            else classic(v, token);
          });
        } else {
          classic(v, token);
        }
      } else {
        if (player.dataset.mode === 'en-ligne') {
          cancelPreload(v);
          holdPreloads(6000);
        }
        try {
          player.currentTime = 0;
        } catch {
          /* pas encore prête */
        }
        if (player.readyState >= 2) box.classList.add('is-ready');
        start();
      }
    }
    // Les suivantes se préparent pendant qu'on regarde : la prochaine en entier (son début
    // d'abord), celle d'après aussi sur une bonne connexion (sinon son début), et le début des
    // deux suivantes : on peut enchaîner vite sans jamais attendre
    const ahead = [];
    for (let el = box.nextElementSibling; el && ahead.length < 12; el = el.nextElementSibling) if (el.__post) ahead.push(el);
    const [n1, n2, n3, n4] = ahead;
    if (n1?.__post.video) preloadVideo(n1.__post.video, { prio: PRIO.next });
    if (n2?.__post.video) {
      if (canProgressive() && !fastNet()) preloadStart(n2.__post.video, PRIO.later);
      else preloadVideo(n2.__post.video, { prio: PRIO.later });
    }
    if (fastNet()) for (const n of [n3, n4]) if (n?.__post.video) preloadStart(n.__post.video, PRIO.warm);
    for (const img of [n1, n2, n3].flatMap((x) => (x ? [...x.querySelectorAll('img[loading="lazy"]')] : []))) img.loading = 'eager';
    if (ahead.length < 4) loadMore();
    // Les vidéos pas encore vues : notées pour la prochaine ouverture de l'application
    onUpcoming?.(ahead.map((x) => x.__post));
    upBtn.disabled = !box.previousElementSibling?.__post;
  }

  const duration = () => (Number.isFinite(player.duration) && player.duration > 0 ? player.duration : active?.__post.video?.duration || 0);
  let scrubbing = false;
  let pendingSeek = null;
  function paintTime() {
    const d = duration();
    const on = active?.__post.video && sameVideo(player, active.__post.video);
    const t = Math.min(d, pendingSeek ?? (on ? player.currentTime || 0 : 0));
    const r = d && (on || pendingSeek != null) ? t / d : 0;
    fill.style.transform = `scaleX(${r})`;
    knob.style.transform = `translateX(${r * bar.clientWidth}px)`;
    scrub.setAttribute('aria-valuenow', String(Math.round(t)));
    scrub.setAttribute('aria-valuemax', String(Math.round(d)));
    if (scrubbing) timeLabel.replaceChildren(h('b', null, clockLabel(t)), h('span', null, ` / ${clockLabel(d)}`));
  }

  const onPlaying = () => {
    if (!active?.__post.video || !sameVideo(player, active.__post.video)) return;
    active.classList.add('is-ready');
    // Le son joue mais aucune image n'est décodée (format non pris en charge par l'appareil)
    const shown = active;
    const tok = actToken;
    setTimeout(() => {
      if (tok === actToken && shown === active && !player.paused && player.readyState >= 2 && player.videoWidth === 0) shown.classList.add('is-broken');
    }, 1500);
    if (watch && !watch.playing) {
      watch.playing = true;
      watch.since = performance.now();
    }
    releasePreloads();
  };
  const onPaused = () => {
    if (player.paused) setBuffering(false);
    if (watch?.playing) {
      watch.ms += performance.now() - watch.since;
      watch.playing = false;
    }
    active?.querySelector('.slide-play')?.toggleAttribute('hidden', !userPaused || scrubbing);
    active?.classList.toggle('paused', player.paused);
  };
  const applySeek = () => {
    if (pendingSeek == null || !active?.__post.video || !sameVideo(player, active.__post.video)) return;
    try {
      player.currentTime = pendingSeek;
      pendingSeek = null;
    } catch {
      /* réessayé à l'événement suivant */
    }
  };
  const onTime = () => {
    if (!scrubbing) paintTime();
    const post = active?.__post;
    if (!post?.video || !sameVideo(player, post.video) || !watch) return;
    const t = player.currentTime;
    const d = duration();
    if (d) watch.duration = d;
    // Boucle : la vidéo est repartie du début après avoir été vue presque en entier
    if (t + 0.6 < watch.last && watch.last > d * 0.75) {
      watch.loops += 1;
      watch.max = d;
      countPlay(post, active);
    }
    watch.last = t;
    if (t > watch.max) watch.max = t;
    // Vue comptée après une seconde de lecture
    if (!watch.viewed && t >= Math.min(1, d * 0.5)) {
      watch.viewed = true;
      countPlay(post, active);
    }
  };
  const onReady = () => releasePreloads();
  // Vidéo vraiment illisible sur cet appareil (format non pris en charge…) : un message plutôt
  // qu'un écran noir, s'il n'y a toujours rien après quelques secondes
  let brokenTimer = 0;
  const onError = () => {
    if (active?.__post.video) reportVideoIssue('erreur de lecture', active.__post.video, { mode: player.dataset.mode, err: player.error?.code || null, msg: String(player.error?.message || '').slice(0, 120) });
    if (!progressive && active) {
      const box = active;
      const token = actToken;
      clearTimeout(brokenTimer);
      brokenTimer = setTimeout(() => {
        if (token === actToken && box === active && (player.error || player.readyState < 2)) box.classList.add('is-broken');
      }, 4000);
    }
    if (!progressive || !active) return;
    const at = player.currentTime;
    disableProgressive();
    classic(active.__post.video, actToken);
    if (at > 0.5) pendingSeek = at;
  };
  // Indicateur d'attente : seulement si l'attente dure (pas de clignotement)
  let bufferTimer = 0;
  const setBuffering = (on) => {
    clearTimeout(bufferTimer);
    if (!on) return root.classList.remove('is-buffering');
    bufferTimer = setTimeout(() => {
      if (active?.__post.kind === 'video' && !player.paused && player.readyState < 3) root.classList.add('is-buffering');
    }, 450);
  };
  let stallTimer = 0;
  const onWaiting = () => {
    setBuffering(true);
    clearTimeout(stallTimer);
    if (!progressive || !active) return;
    const token = actToken;
    const v = active.__post.video;
    let bytes = downloadedBytes(v);
    const check = () => {
      if (token !== actToken || !progressive || player.readyState >= 3) return;
      const now = downloadedBytes(v);
      if (now > bytes) {
        bytes = now;
        stallTimer = setTimeout(check, 6000);
        return;
      }
      const at = player.currentTime;
      reportVideoIssue('lecture bloquée', v, { mode: player.dataset.mode, t: Math.round(at) });
      disableProgressive();
      classic(v, token);
      pendingSeek = at;
    };
    stallTimer = setTimeout(check, 6000);
  };
  const onFlowing = () => {
    clearTimeout(stallTimer);
    clearTimeout(brokenTimer);
    active?.classList.remove('is-broken');
    setBuffering(false);
  };
  // Le lecteur est partagé entre les fils : seul le fil à l'écran l'écoute
  const PLAYER_EVENTS = [
    ['loadedmetadata', applySeek],
    ['canplay', applySeek],
    ['error', onError],
    ['waiting', onWaiting],
    ['playing', onFlowing],
    ['playing', onPlaying],
    ['timeupdate', onTime],
    ['pause', onPaused],
    ['play', onPaused],
    ['canplaythrough', onReady],
  ];
  const bindPlayer = (on) => {
    for (const [ev, fn] of PLAYER_EVENTS) player[on ? 'addEventListener' : 'removeEventListener'](ev, fn);
  };
  bindPlayer(true);

  // Glisser sur la barre : la vidéo suit le doigt, le temps s'affiche en grand
  let wasPlaying = false;
  let seekFrame = 0;
  const onActiveVideo = () => Boolean(active?.__post.video && sameVideo(player, active.__post.video));
  const seekTo = (clientX) => {
    const rect = bar.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const d = duration();
    if (!d) return;
    cancelAnimationFrame(seekFrame);
    if (!onActiveVideo()) {
      pendingSeek = r * d;
    } else {
      seekFrame = requestAnimationFrame(() => {
        try {
          player.currentTime = r * d;
          if (watch) watch.last = r * d;
        } catch {
          pendingSeek = r * d;
        }
      });
    }
    fill.style.transform = `scaleX(${r})`;
    knob.style.transform = `translateX(${r * rect.width}px)`;
    timeLabel.replaceChildren(h('b', null, clockLabel(r * d)), h('span', null, ` / ${clockLabel(d)}`));
  };
  scrub.addEventListener('pointerdown', (e) => {
    if (!active?.__post.video) return;
    e.preventDefault();
    e.stopPropagation();
    scrubbing = true;
    scrub.setPointerCapture?.(e.pointerId);
    root.classList.add('scrubbing');
    if (onActiveVideo()) {
      wasPlaying = !player.paused;
      player.pause();
    } else {
      wasPlaying = false;
    }
    seekTo(e.clientX);
  });
  scrub.addEventListener('pointermove', (e) => scrubbing && seekTo(e.clientX));
  const endScrub = () => {
    if (!scrubbing) return;
    scrubbing = false;
    root.classList.remove('scrubbing');
    if (onActiveVideo() && (wasPlaying || !userPaused)) player.play().catch(() => {});
    paintTime();
  };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('click', (e) => e.stopPropagation());
  scrub.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    player.currentTime = Math.max(0, Math.min(duration(), player.currentTime + (e.key === 'ArrowRight' ? 5 : -5)));
  });

  // Appui long : options (vitesse, pas intéressé, télécharger, signaler…)
  let pressTimer = 0;
  let pressAt = null;
  let longPressed = false;
  track.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button, .no-taps, .carousel') || !active) return;
    pressAt = { x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      navigator.vibrate?.(12);
      openOptions(active);
    }, 480);
  });
  track.addEventListener('pointermove', (e) => {
    if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) clearTimeout(pressTimer);
  });
  let swallowUntil = 0;
  const release = () => {
    clearTimeout(pressTimer);
    if (longPressed) swallowUntil = Date.now() + 700;
    longPressed = false;
  };
  for (const ev of ['pointerup', 'pointercancel']) track.addEventListener(ev, release);
  track.addEventListener('pointerleave', () => !longPressed && clearTimeout(pressTimer));
  track.addEventListener('scroll', () => clearTimeout(pressTimer), { passive: true });
  const swallow = (e) => {
    if (!longPressed && Date.now() > swallowUntil) return;
    swallowUntil = 0;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  // Clic droit (ordinateur) : les mêmes options que l'appui long
  track.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.slide-media') || e.target.closest('a, button')) return;
    e.preventDefault();
    if (e.pointerType === 'touch' || longPressed || Date.now() < swallowUntil) return;
    const slide = e.target.closest('.slide');
    if (slide?.__post) openOptions(slide);
  });

  function removeSlides(test) {
    for (const el of [...track.querySelectorAll('.slide')]) {
      if (!test(el.__post)) continue;
      if (el === active) {
        const next = el.nextElementSibling?.__post ? el.nextElementSibling : el.previousElementSibling;
        el.remove();
        active = null;
        if (next?.__post) {
          track.scrollTop = next.offsetTop;
          activate(next);
        } else {
          player.pause();
        }
      } else {
        el.remove();
      }
    }
    if (!track.querySelector('.slide')) showEmpty();
  }

  function openOptions(box) {
    const post = box.__post;
    const item = (ic, label, action, danger = false) =>
      h('button', { type: 'button', class: `opt-item${danger ? ' danger' : ''}`, onclick: () => (closeSheet(), action()) }, h('span', { class: 'opt-ic' }, icon(ic)), h('span', null, label));
    const speeds = post.kind === 'video'
      ? h(
          'div',
          { class: 'opt-speeds', role: 'radiogroup', 'aria-label': 'Vitesse de lecture' },
          [0.5, 1, 1.5, 2].map((x) =>
            h('button', {
              type: 'button',
              class: x === speed ? 'on' : '',
              role: 'radio',
              'aria-checked': String(x === speed),
              onclick: (e) => {
                speed = x;
                player.defaultPlaybackRate = x;
                player.playbackRate = x;
                for (const b of e.currentTarget.parentNode.children) b.classList.toggle('on', b === e.currentTarget);
                toast(x === 1 ? 'Vitesse normale' : `Vitesse ×${String(x).replace('.', ',')}`);
              },
            }, `${String(x).replace('.', ',')}×`),
          ),
        )
      : null;
    const items = [
      post.mine && item(post.pinned ? 'pushpin' : 'pushpin', post.pinned ? 'Désépingler du profil' : 'Épingler sur mon profil', async () => {
        try {
          if (post.pinned) await api.del(`/api/posts/${post.id}/pin`);
          else await api.post(`/api/posts/${post.id}/pin`);
          post.pinned = !post.pinned;
          document.dispatchEvent(new CustomEvent('vibz:post', { detail: post }));
          toast(post.pinned ? 'Épinglée en haut de ton profil' : 'Désépinglée');
        } catch (err) {
          toast(err.message, 'error');
        }
      }),
      post.mine && item('pen', 'Modifier la publication', () => document.dispatchEvent(new CustomEvent('vibz:edit-post', { detail: post }))),
      !post.mine && item('eyeOff', 'Pas intéressé', async () => {
        if (needLogin('Connecte-toi pour personnaliser ton fil.')) return;
        await api.post(`/api/posts/${post.id}/not-interested`).catch(() => {});
        removeSlides((p) => p.id === post.id);
        toast('Tu verras moins de vidéos comme celle-ci');
      }),
      !post.mine && item('ban', `Masquer les vidéos ${deName(post.author.displayName)}`, async () => {
        if (needLogin('Connecte-toi pour personnaliser ton fil.')) return;
        await api.post(`/api/posts/${post.id}/not-interested`, { author: true }).catch(() => {});
        removeSlides((p) => p.author.id === post.author.id);
        toast(`Les vidéos ${deName(post.author.displayName)} sont masquées`);
      }),
      (post.allowDownload || post.mine) && post.kind !== 'text' && item('download', 'Enregistrer la vidéo', () => downloadPost(post)),
      item(post.saved ? 'bookmarkFill' : 'bookmark', post.saved ? 'Retirer des favoris' : 'Ajouter aux favoris', () => toggleSave(post, box.__paintSave)),
      item('link', 'Copier le lien', async () => {
        try {
          await navigator.clipboard.writeText(`${location.origin}${postPath(post)}`);
          toast('Lien copié');
        } catch {
          toast(`${location.origin}${postPath(post)}`);
        }
      }),
      !post.mine && item('flag', 'Signaler', () => !needLogin('Connecte-toi pour signaler.') && reportDialog('post', post.id, 'Signaler la vidéo'), true),
      post.canDelete && item('trash', 'Supprimer', async () => {
        if (!(await confirmDialog('Supprimer cette publication ?', post.mine ? 'Elle disparaîtra de ton profil et de tous les fils. C’est définitif.' : `Elle disparaîtra du profil de @${post.author.username} et de tous les fils. C’est définitif.`, 'Supprimer'))) return;
        try {
          await api.del(`/api/posts/${post.id}`);
          removeSlides((p) => p.id === post.id);
          toast('Publication supprimée');
        } catch (err) {
          toast(err.message, 'error');
        }
      }, true),
    ].filter(Boolean);
    const stats = post.mine ? h('p', { class: 'opt-stats' }, `${count(post.viewCount, 'vue')} · ${short(post.likeCount)} J’aime · ${count(post.shareCount, 'partage')}`) : null;
    openSheet({ title: 'Options', body: h('div', { class: 'opt-list' }, stats, speeds ? h('p', { class: 'opt-label' }, 'Vitesse de lecture') : null, speeds, ...items) });
  }

  // Toucher : pause / lecture (ou activer le son) ; double toucher : J'aime
  onTaps(track, {
    single: (e) => {
      if (e.target.closest('a, button, .info-text')) return;
      if (!active || active.__post.kind !== 'video') return;
      if (player.muted && !hint.hidden) return unmute();
      userPaused = !player.paused;
      if (player.paused) player.play().catch(() => {});
      else player.pause();
      onPaused();
    },
    double: (e) => {
      if (e.target.closest('a, button') || !active) return;
      if (needLogin('Connecte-toi pour aimer cette vidéo.')) return;
      heartBurst(active, e);
      active.__like();
    },
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || e.intersectionRatio < 0.6) continue;
        if (e.target.__end) leaveForEnd();
        else activate(e.target);
      }
    },
    { root: track, threshold: [0.6] },
  );

  // Carte en tête du fil (le Sujet du jour) : un écran à part entière, la vidéo ne joue pas dessus
  if (head) {
    head.__end = true;
    track.append(head);
    io.observe(head);
  }

  const seen = new Set();
  const all = [];
  let more = initialMore;
  let loading = false;
  const add = (posts) => {
    for (const p of posts) {
      if (seen.has(p.id) || (p.video?.expiresAt && p.video.expiresAt <= Date.now())) continue;
      seen.add(p.id);
      all.push(p);
      const s = slide(p);
      s.__options = () => openOptions(s);
      s.__notInterested = () => removeSlides((x) => x.id === s.__post.id);
      withImages.add(s);
      track.append(s);
      io.observe(s);
    }
    track.querySelector('.feed-empty')?.remove();
  };

  async function loadMore() {
    if (loading || !more || !load) return;
    loading = true;
    try {
      for (let pages = 0; pages < 5 && more; pages++) {
        const before = all.length;
        const d = await load([...seen]);
        if (destroyed) return;
        more = Boolean(d.more);
        add(d.posts || []);
        if (all.length > before) break;
      }
    } catch (err) {
      if (!destroyed) toast(err.message, 'error');
    } finally {
      loading = false;
      if (!destroyed && !track.querySelector('.slide')) showEmpty();
      else if (!destroyed && !more) showEnd();
    }
  }

  // Tout a été vu : une dernière page, plutôt qu'un fil qui s'arrête sans rien dire
  function showEnd() {
    if (track.querySelector('.feed-end')) return;
    const again = onRefresh
      ? h('button', { type: 'button', class: 'btn btn-primary', onclick: () => onRefresh() }, icon('refresh', 'icon-sm'), 'Voir d’autres vidéos')
      : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => track.scrollTo({ top: 0, behavior: 'smooth' }) }, icon('arrowUp', 'icon-sm'), 'Revenir au début');
    const end = h('section', { class: 'feed-end' }, h('div', { class: 'feed-end-card' },
      h('span', { class: 'feed-end-ic' }, icon('check')),
      h('h3', null, 'Tu es à jour'),
      h('p', null, onRefresh ? 'Tu as vu les nouveautés du moment. Reviens bientôt, ou revois des vidéos.' : 'Tu as tout vu.'),
      again,
      h('a', { href: '/explorer', class: 'btn btn-ghost' }, icon('compass', 'icon-sm'), 'Explorer')));
    end.__end = true;
    track.append(end);
    io.observe(end);
  }

  function showEmpty() {
    if (track.querySelector('.feed-empty')) return;
    track.append(h('div', { class: 'feed-empty' }, emptyView ? emptyView() : emptyState('video', 'Aucune vidéo pour l’instant', 'Reviens un peu plus tard.')));
  }

  function step(dir) {
    const cur = active || track.querySelector('.slide');
    const target = dir > 0 ? cur?.nextElementSibling : cur?.previousElementSibling;
    if (target?.__post || target?.__end) track.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
  }

  // Clavier (ordinateur) : flèches haut / bas, espace, M pour le son, L pour aimer
  const onKey = (e) => {
    if (document.querySelector('.sheet-backdrop:not(.side), .modal-backdrop') || e.target.closest?.('input, textarea, [contenteditable]')) return;
    if (!root.isConnected) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === ' ' && active?.__post.kind === 'video') {
      e.preventDefault();
      userPaused = !player.paused;
      if (player.paused) player.play().catch(() => {});
      else player.pause();
    } else if (e.key === 'm' || e.key === 'M') {
      soundBtn.click();
    } else if ((e.key === 'l' || e.key === 'L') && active) {
      active.__like();
    }
  };

  // Onglet masqué : pause ; de retour : reprise
  const onVisibility = () => {
    if (document.hidden) {
      endWatch();
      if (!player.paused) player.pause();
    } else if (active?.__post.kind === 'video' && !userPaused && root.isConnected) {
      const post = active.__post;
      watch = { id: post.id, ms: 0, max: 0, loops: 0, last: player.currentTime || 0, duration: duration(), playing: false, since: 0, viewed: true };
      player.play().catch(() => {});
    }
  };
  const onPageHide = () => endWatch();

  // Une publication modifiée ailleurs (feuille de partage, commentaires…) : mise à jour de l'écran
  const onPostChange = (e) => {
    for (const el of track.querySelectorAll('.slide')) {
      if (el.__post?.id !== e.detail.id) continue;
      if (el.__post !== e.detail) Object.assign(el.__post, e.detail);
      el.__paintLike?.(false);
      el.__paintSave?.();
      el.__paintInfo?.();
    }
  };
  document.addEventListener('vibz:post', onPostChange);
  // L'image reste en place : pas de zoom à deux doigts sur iPhone, tant que le fil est à l'écran
  // (Safari ignore l'interdiction de zoomer de la page ; ses gestes « pincer » s'annulent ici)
  const noPinch = (e) => e.preventDefault();
  const bindGlobal = (on) => {
    const m = on ? 'addEventListener' : 'removeEventListener';
    document[m]('gesturestart', noPinch, { passive: false });
    document[m]('gesturechange', noPinch, { passive: false });
    document[m]('click', swallow, true);
    document[m]('keydown', onKey);
    document[m]('visibilitychange', onVisibility);
    window[m]('pagehide', onPageHide);
  };
  bindGlobal(true);

  // Premières publications
  add(initial);
  if (startId) {
    const el = [...track.children].find((x) => x.__post?.id === startId);
    if (el) requestAnimationFrame(() => (track.scrollTop = el.offsetTop));
  }
  if (!initial.length) {
    track.append(h('div', { class: 'feed-loading' }, spinner()));
    loadMore().finally(() => track.querySelector('.feed-loading')?.remove());
  }
  paintSound();

  return {
    el: root,
    get active() {
      return active?.__post || null;
    },
    // On quitte l'écran sans détruire le fil : il garde sa place, sa vidéo et l'instant atteint
    suspend() {
      if (destroyed || sleeping) return;
      const v = active?.__post.video;
      const at = v && sameVideo(player, v) ? player.currentTime || 0 : 0;
      sleeping = { box: active, at };
      endWatch();
      setBuffering(false);
      clearTimeout(pressTimer);
      clearTimeout(stallTimer);
      // Lecture progressive : sa source ne survit pas à la pause, elle sera rechargée au retour
      if (progressive) {
        stopProgressive();
        player.dataset.v = '';
      }
      player.pause();
      player.remove();
      player.style.filter = '';
      releasePreloads();
      bindPlayer(false);
      bindGlobal(false);
      active?.classList.remove('is-active', 'is-ready', 'paused');
      active = null;
      actToken++;
    },
    // Retour sur l'écran : même vidéo, au même instant
    wake() {
      if (destroyed || !sleeping) return;
      const { box, at } = sleeping;
      sleeping = null;
      bindPlayer(true);
      bindGlobal(true);
      if (!box?.isConnected) return;
      track.scrollTop = box.offsetTop;
      activate(box);
      const v = box.__post.video;
      if (v && at > 0.3) {
        if (sameVideo(player, v) && player.readyState >= 1) {
          try {
            player.currentTime = at;
          } catch {
            pendingSeek = at;
          }
        } else {
          pendingSeek = at;
        }
      }
    },
    // Fil en veille (gardé en mémoire, hors de l'écran) ?
    get sleeping() {
      return Boolean(sleeping);
    },
    prepend(post) {
      if (seen.has(post.id)) return;
      seen.add(post.id);
      all.unshift(post);
      const s = slide(post);
      s.__options = () => openOptions(s);
      s.__notInterested = () => removeSlides((x) => x.id === s.__post.id);
      withImages.add(s);
      track.prepend(s);
      io.observe(s);
      track.scrollTop = 0;
    },
    destroy() {
      const wasSleeping = Boolean(sleeping);
      destroyed = true;
      sleeping = null;
      io.disconnect();
      head?.__dispose?.();
      clearTimeout(bufferTimer);
      clearTimeout(pressTimer);
      clearTimeout(stallTimer);
      document.removeEventListener('vibz:post', onPostChange);
      // En veille, le lecteur et l'écran appartiennent déjà à un autre fil : on n'y touche pas
      if (wasSleeping) return;
      endWatch();
      closeSheet();
      stopProgressive();
      player.pause();
      player.remove();
      player.style.filter = '';
      bindPlayer(false);
      bindGlobal(false);
      releasePreloads();
    },
  };
}

// Vidéo déjà téléchargée (enregistrement immédiat), sinon null
export const downloadedBlob = (post) => (post.video ? videoBlob(post.video) : null);

// Ouvrir une liste de publications en plein écran (profil, hashtag, son, recherche…)
export function openViewer(posts, { startId = null, load = null, more = false, title = '' } = {}) {
  const state = { posts, startId, load, more, title };
  sessionStorage.setItem('vibz:viewer', JSON.stringify({ ids: posts.map((p) => p.id), at: Date.now() }));
  window.__vibzViewer = state;
  const p = posts.find((x) => x.id === startId) || posts[0];
  navigate(p ? `/@${p.author.username}/video/${p.id}?suite=1` : '/');
}
