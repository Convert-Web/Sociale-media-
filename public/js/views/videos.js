// Vidéos en plein écran : une vidéo par écran, glisser vers le haut pour la suivante.
// Un seul lecteur (déverrouillé par le toucher qui ouvre cet écran) passe d'une vidéo à
// l'autre : la lecture démarre aussitôt, avec le son ; la suivante se prépare en coulisse.
import { api, enc } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, avatar, richText, num, toast, emptyState, spinner, onTaps, heartBurst, shareLink, verifiedMark } from '../dom.js';
import { sound, reelsPlayer, cachedReels, rememberReels, preloadVideo, preloadStart, localVideo, sameVideo, setSource, PRIO, preloadEta, cancelPreload, holdPreloads, releasePreloads, clockLabel, countView, canProgressive, progressiveReady, progressiveCheck, playProgressive, disableProgressive, downloadedBytes, relaxPreload, reportVideoIssue } from '../components/video.js';
import { reportDialog } from '../components/report.js';
import { commentsSection } from '../components/post.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { toggleSaved } from '../saved.js';

// Une vidéo plein écran : J'aime, commentaires (feuille par-dessus la vidéo), partage,
// auteur avec « Suivre », description dépliable.
function slide(post) {
  const v = post.video;
  const likeCount = h('small', null, post.likeCount ? num(post.likeCount) : 'J’aime');
  const likeBtn = h('button', { class: `reel-act${post.liked ? ' liked' : ''}`, type: 'button', 'aria-label': 'J’aime', 'aria-pressed': String(post.liked) }, icon(post.liked ? 'heart-fill' : 'heart'), likeCount);
  const paintLike = (pop) => {
    likeBtn.classList.toggle('liked', post.liked);
    likeBtn.setAttribute('aria-pressed', String(post.liked));
    likeBtn.firstChild.replaceWith(icon(post.liked ? 'heart-fill' : 'heart'));
    likeCount.textContent = post.likeCount ? num(post.likeCount) : 'J’aime';
    if (pop) {
      likeBtn.classList.remove('pop');
      void likeBtn.offsetWidth;
      likeBtn.classList.add('pop');
    }
  };
  const toggleLike = async (force) => {
    const was = post.liked;
    if (force && was) return;
    post.liked = !was;
    post.likeCount = Math.max(0, (post.likeCount || 0) + (was ? -1 : 1));
    paintLike(!was);
    try {
      if (was) await api.del(`/api/posts/${post.id}/like`);
      else await api.post(`/api/posts/${post.id}/like`, { reaction: 'love' });
    } catch (err) {
      post.liked = was;
      post.likeCount = Math.max(0, (post.likeCount || 0) + (was ? 1 : -1));
      paintLike(false);
      toast(err.message, 'error');
    }
  };
  likeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLike();
  });

  // Commentaires : une feuille monte par-dessus la vidéo, qui continue de jouer
  const commentCount = h('small', null, post.commentCount ? num(post.commentCount) : 'Commenter');
  const commentBtn = h('button', { class: 'reel-act', type: 'button', 'aria-label': 'Commentaires' }, icon('comment'), commentCount);
  const label = (n) => (n ? `${num(n)} commentaire${n > 1 ? 's' : ''}` : 'Commentaires');
  commentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    let sheet = null;
    const section = commentsSection(post, (n) => {
      post.commentCount = n;
      commentCount.textContent = n ? num(n) : 'Commenter';
      sheet?.setTitle(label(n));
    });
    sheet = openSheet({ title: label(post.commentCount), body: section.list, footer: section.form, tall: true });
  });

  const shareBtn = h('button', { class: 'reel-act', type: 'button', 'aria-label': 'Partager', onclick: (e) => (e.stopPropagation(), shareLink(`${post.author.displayName} sur AURUM`, `/p/${post.id}`)) }, icon('send'), h('small', null, 'Partager'));

  // Enregistrer : la vidéo est gardée en entier sur le téléphone, dans « Enregistrés » (lisible sans connexion)
  const saveLabel = h('small', null, post.saved ? 'Gardée' : 'Garder');
  const saveBtn = h('button', { class: `reel-act${post.saved ? ' saved' : ''}`, type: 'button', 'aria-label': 'Enregistrer sur le téléphone', 'aria-pressed': String(post.saved) }, icon('bookmark'), saveLabel);
  const paintSave = (on) => {
    saveBtn.classList.toggle('saved', on);
    saveBtn.setAttribute('aria-pressed', String(on));
    saveLabel.textContent = on ? 'Gardée' : 'Garder';
  };
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSaved(post, { onChange: paintSave });
  });

  // Auteur : « Suivre » d'un toucher, sans quitter la vidéo
  let followBtn = null;
  if (!post.mine && !post.followsAuthor && !post.author.bot) {
    followBtn = h('button', { class: 'reel-follow', type: 'button' }, icon('plus', 'icon-xs'), 'Suivre');
    followBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      followBtn.disabled = true;
      try {
        await api.post(`/api/users/${enc(post.author.username)}/follow`);
        post.followsAuthor = true;
        followBtn.classList.add('done');
        followBtn.replaceChildren(icon('check', 'icon-xs'), 'Abonné');
        setTimeout(() => followBtn.classList.add('gone'), 1400);
      } catch (err) {
        followBtn.disabled = false;
        toast(err.message, 'error');
      }
    });
  }

  // Description : deux lignes, « plus » pour tout lire
  let text = null;
  if (post.body) {
    text = h('div', { class: 'reel-text' }, richText(post.body));
    text.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      e.stopPropagation();
      text.classList.toggle('open');
    });
  }

  // Son de la vidéo (toujours le son d'origine : pas de musique ajoutée, pas de droits d'auteur)
  const soundLine = h(
    'div',
    { class: 'reel-sound' },
    icon('music', 'icon-xs'),
    h('span', { class: 'reel-sound-run' }, h('span', null, `Son original — ${post.author.displayName}`)),
  );
  // Disque qui tourne pendant la lecture (photo de l'auteur), comme sur TikTok
  const disc = h('a', { class: 'reel-disc', href: `/@${enc(post.author.username)}`, 'aria-label': `Profil de ${post.author.displayName}` }, avatar(post.author, 'sm'));
  // Vues : visibles par l'auteur sur ses propres vidéos
  const views = post.mine ? h('span', { class: 'reel-views' }, icon('play', 'icon-xs'), viewsLabel(v.views || 0)) : null;

  const box = h(
    'section',
    { class: 'reel', dataset: { id: post.id } },
    h('img', { class: 'reel-poster', src: v.poster || '', alt: `Vidéo de ${post.author.displayName}`, decoding: 'async' }),
    h('div', { class: 'reel-holder' }),
    h('div', { class: 'reel-shade' }),
    h('span', { class: 'reel-play', hidden: true }, icon('playBadge')),
    h('div', { class: 'reel-side' }, likeBtn, commentBtn, saveBtn, shareBtn, disc),
    h(
      'div',
      { class: 'reel-info' },
      views,
      h('div', { class: 'reel-who' }, h('a', { href: `/@${enc(post.author.username)}`, class: 'reel-author' }, avatar(post.author, 'sm'), h('b', null, post.author.displayName), post.author.verified ? verifiedMark() : null), followBtn),
      text,
      soundLine,
    ),
  );
  box.__post = post;
  box.__like = () => toggleLike(true);
  box.__save = () => toggleSaved(post, { onChange: paintSave });
  box.__views = (n) => {
    v.views = n;
    if (views) views.lastChild.textContent = viewsLabel(n);
  };
  return box;
}

const viewsLabel = (n) => `${num(n)} vue${n > 1 ? 's' : ''}`;

// Préférences locales : vidéos écartées (« Pas intéressé ») et auteurs masqués
const LOCAL = { skip: 'aurum:reels-skip', authors: 'aurum:reels-hidden' };
function readList(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function addToList(key, value, max = 300) {
  const list = readList(key).filter((x) => x !== value);
  list.push(value);
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-max)));
  } catch {
    /* stockage plein ou bloqué : valable pour cette visite seulement */
  }
}

let speed = 1; // vitesse de lecture choisie (pour toute la visite)

// Astuce au premier passage : glisser vers le haut, toucher deux fois pour aimer, appui long
function gestureTip(root) {
  try {
    if (localStorage.getItem('aurum:tip-reels2') === '1') return;
    localStorage.setItem('aurum:tip-reels2', '1');
  } catch {
    return;
  }
  const tip = h(
    'div',
    { class: 'reels-tip', role: 'status' },
    h('div', { class: 'reels-tip-row' }, h('span', { class: 'reels-tip-swipe' }, icon('chevronUp')), h('span', null, 'Glissez vers le haut pour la vidéo suivante')),
    h('div', { class: 'reels-tip-row' }, h('span', { class: 'reels-tip-heart' }, icon('heart-fill')), h('span', null, 'Touchez deux fois pour aimer')),
    h('div', { class: 'reels-tip-row' }, h('span', null, icon('gauge')), h('span', null, 'Restez appuyé : vitesse et options')),
  );
  const hide = () => {
    tip.classList.add('out');
    setTimeout(() => tip.remove(), 400);
  };
  root.append(tip);
  setTimeout(hide, 5200);
  root.addEventListener('pointerdown', hide, { once: true });
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

  // Onglets : « Pour toi » (tout le cercle, nouveautés d'abord) et « Abonnements »
  let scope = ctx.query.get('scope') === 'following' ? 'following' : 'all';
  const tabBtn = (key, label) => h('button', { type: 'button', class: 'reels-tab', role: 'tab', dataset: { scope: key }, onclick: () => switchScope(key) }, label);
  const tabs = h('div', { class: 'reels-tabs', role: 'tablist' }, tabBtn('following', 'Abonnements'), tabBtn('all', 'Pour toi'));
  const paintTabs = () => {
    for (const b of tabs.children) {
      const on = b.dataset.scope === scope;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
  };

  // Barre de lecture : un toucher ou un glissement avance / recule dans la vidéo
  const fill = h('i');
  const knob = h('b');
  const bar = h('div', { class: 'reels-bar' }, fill, knob);
  const scrub = h('div', { class: 'reels-scrub no-taps', role: 'slider', 'aria-label': 'Position dans la vidéo', tabindex: '0' }, bar);
  const timeLabel = h('div', { class: 'reels-time', 'aria-hidden': 'true' });
  const root = h('div', { class: 'reels' }, h('div', { class: 'reels-top' }, back, tabs, soundBtn), hint, track, timeLabel, scrub);

  let active = null;
  let userPaused = false;
  let actToken = 0;
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
  // qu'elle ait assez d'avance, pour qu'elle démarre vite
  const stream = (v) => {
    cancelPreload(v);
    holdPreloads(6000);
    setSource(player, v, v.url);
  };
  const WAIT_FOR_BLOB = 2.5; // secondes : en deçà, attendre la vidéo téléchargée est plus rapide
  let progressive = null; // lecture progressive en cours
  let watchdog = 0;
  const stopProgressive = () => {
    progressive?.stop();
    progressive = null;
    clearTimeout(watchdog);
  };

  // Lecture classique : depuis le téléphone (téléchargée), en l'attendant si elle est presque là,
  // sinon en ligne
  function classic(v, token) {
    stopProgressive();
    const local = localVideo(v);
    const eta = preloadEta(v);
    if (local) {
      setSource(player, v, local);
      start();
    } else if (eta < WAIT_FOR_BLOB) {
      // Téléchargement bien avancé : on l'attend. Reprendre en ligne recommencerait à zéro
      // (plus lent en 4G, et les mêmes octets téléchargés deux fois)
      player.pause();
      let done = false; // la première issue l'emporte : vidéo téléchargée, ou lecture en ligne
      const go = (url) => {
        if (done || token !== actToken) return;
        done = true;
        if (url) setSource(player, v, url);
        else stream(v);
        start();
      };
      // force : c'est la vidéo regardée, téléchargée même en mode économie de données
      const job = preloadVideo(v, { prio: PRIO.now, force: true });
      if (!job) {
        stream(v);
        start();
        return;
      }
      job.then(go);
      setTimeout(() => go(null), Math.min(4000, eta * 1300 + 700));
    } else {
      stream(v); // lecture en ligne immédiate, le réseau lui est réservé
      start();
    }
  }

  // Lecture progressive (comme TikTok) : démarre dès le premier morceau ; au moindre souci,
  // retour à la lecture classique (et lecture progressive coupée quelques jours sur ce téléphone)
  function playFromStart(v, token) {
    stopProgressive();
    let shown = false; // une première image est arrivée : la lecture progressive marche ici
    const fallback = () => {
      if (token !== actToken) return;
      const at = player.currentTime;
      reportVideoIssue('lecture progressive abandonnée', v, { rs: player.readyState, err: player.error?.code || null, shown });
      disableProgressive();
      classic(v, token);
      if (at > 0.5) pendingSeek = at; // reprise au même endroit
    };
    progressive = playProgressive(player, v, { onFail: fallback });
    player.addEventListener('loadeddata', () => (shown = true), { once: true });
    start();
    // Aucune image au bout de 4,5 s alors que le début est là : ce téléphone ne s'en sort pas
    watchdog = setTimeout(() => {
      if (token === actToken && progressive && !shown && player.readyState < 2) fallback();
    }, 4500);
  }

  function activate(box) {
    if (active === box || !box?.__post) return;
    // Vidéo quittée : seul son début reste voulu (la suite n'est plus téléchargée pour rien)
    if (active?.__post && active.__post.video.url !== box.__post.video.url) relaxPreload(active.__post.video);
    active?.classList.remove('is-active', 'is-ready');
    active = box;
    const token = ++actToken;
    box.classList.add('is-active');
    userPaused = false;
    pendingSeek = null;
    const v = box.__post.video;
    box.querySelector('.reel-holder').append(player);
    paintTime();
    if (!sameVideo(player, v)) {
      box.classList.remove('is-ready');
      const ready = localVideo(v) ? false : progressiveReady(v);
      if (localVideo(v)) {
        classic(v, token); // déjà sur le téléphone : démarrage immédiat
      } else if (ready === true) {
        playFromStart(v, token);
      } else if (ready === null && canProgressive()) {
        // Premier morceau pas encore là : on le demande en priorité, puis on choisit
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
      // Déjà lancée en ligne (toucher d'ouverture) : pas de second téléchargement de la même vidéo
      if (player.getAttribute('src') === v.url) {
        cancelPreload(v);
        holdPreloads(6000);
      }
      if (player.readyState >= 2) box.classList.add('is-ready');
      start();
    }
    // Les suivantes : la prochaine en entier (son début d'abord), le début de celle d'après
    const n1 = box.nextElementSibling;
    const n2 = n1?.nextElementSibling;
    if (n1?.__post) preloadVideo(n1.__post.video, { prio: PRIO.next });
    if (n2?.__post) {
      if (canProgressive()) preloadStart(n2.__post.video, PRIO.later);
      else preloadVideo(n2.__post.video, { prio: PRIO.later });
    }
    if (!n2?.nextElementSibling) loadMore();
  }

  // Durée connue même pour une vidéo dont le fichier ne l'indique pas (enregistrée par le téléphone)
  const duration = () => (Number.isFinite(player.duration) && player.duration > 0 ? player.duration : active?.__post.video.duration || 0);
  let scrubbing = false;
  let pendingSeek = null; // position demandée avant que la vidéo soit prête (barre touchée pendant le chargement)
  function paintTime() {
    const d = duration();
    const on = active && sameVideo(player, active.__post.video);
    const t = Math.min(d, pendingSeek ?? (on ? player.currentTime || 0 : 0));
    const r = d && (on || pendingSeek != null) ? t / d : 0;
    fill.style.transform = `scaleX(${r})`;
    knob.style.transform = `translateX(${r * bar.clientWidth}px)`;
    scrub.setAttribute('aria-valuenow', String(Math.round(t)));
    scrub.setAttribute('aria-valuemax', String(Math.round(d)));
    if (scrubbing) timeLabel.replaceChildren(h('b', null, clockLabel(t)), h('span', null, ` / ${clockLabel(d)}`));
  }

  // La vidéo à l'écran joue (et pas l'extrait muet qui déverrouille le lecteur) : elle s'affiche
  const onPlaying = () => {
    if (!active || !sameVideo(player, active.__post.video)) return;
    active.classList.add('is-ready');
    releasePreloads(); // la vidéo joue : les suivantes peuvent se télécharger
  };
  const applySeek = () => {
    if (pendingSeek == null || !active || !sameVideo(player, active.__post.video)) return;
    try {
      player.currentTime = pendingSeek;
      pendingSeek = null;
    } catch {
      /* réessayé à l'événement suivant */
    }
  };
  player.addEventListener('loadedmetadata', applySeek);
  player.addEventListener('canplay', applySeek);
  const onTime = () => {
    if (!scrubbing) paintTime();
    // Vue comptée après 2 secondes de lecture (une fois par vidéo et par visite)
    const post = active?.__post;
    if (!post || !sameVideo(player, post.video)) return;
    if (player.currentTime >= Math.min(2, duration() * 0.6)) {
      const box = active;
      countView(post.id)?.then((r) => r && box.__views?.(r.views));
    }
  };
  const onPause = () => active?.querySelector('.reel-play')?.toggleAttribute('hidden', !userPaused || scrubbing);
  const onReady = () => releasePreloads();
  // Erreur pendant une lecture progressive : retour à la lecture classique
  const onError = () => {
    if (active) reportVideoIssue('erreur de lecture', active.__post.video, { mode: player.dataset.mode, err: player.error?.code || null, msg: String(player.error?.message || '').slice(0, 120) });
    if (!progressive || !active) return;
    const at = player.currentTime;
    disableProgressive();
    classic(active.__post.video, actToken);
    if (at > 0.5) pendingSeek = at;
  };
  player.addEventListener('error', onError);
  // Lecture progressive bloquée plus de 6 secondes : reprise en lecture classique, au même endroit
  let stallTimer = 0;
  // (une attente pendant que les morceaux continuent d'arriver — saut loin en avant — n'est pas un blocage)
  const onWaiting = () => {
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
      pendingSeek = at; // reprise au même endroit
    };
    stallTimer = setTimeout(check, 6000);
  };
  const onFlowing = () => clearTimeout(stallTimer);
  player.addEventListener('waiting', onWaiting);
  player.addEventListener('playing', onFlowing);
  player.addEventListener('playing', onPlaying);
  player.addEventListener('timeupdate', onTime);
  player.addEventListener('pause', onPause);
  player.addEventListener('play', onPause);
  player.addEventListener('canplaythrough', onReady);

  // Glisser sur la barre : la vidéo suit le doigt, le temps s'affiche en grand
  let wasPlaying = false;
  let seekFrame = 0;
  const onActiveVideo = () => Boolean(active && sameVideo(player, active.__post.video));
  const seekTo = (clientX) => {
    const rect = bar.getBoundingClientRect();
    const r = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const d = duration();
    if (!d) return;
    cancelAnimationFrame(seekFrame);
    if (!onActiveVideo()) {
      pendingSeek = r * d; // vidéo pas encore branchée : appliqué dès qu'elle l'est
    } else {
      seekFrame = requestAnimationFrame(() => {
        try {
          player.currentTime = r * d;
        } catch {
          pendingSeek = r * d; // pas encore prête : appliqué dès qu'elle l'est
        }
      });
    }
    fill.style.transform = `scaleX(${r})`;
    knob.style.transform = `translateX(${r * rect.width}px)`;
    timeLabel.replaceChildren(h('b', null, clockLabel(r * d)), h('span', null, ` / ${clockLabel(d)}`));
  };
  scrub.addEventListener('pointerdown', (e) => {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    scrubbing = true;
    scrub.setPointerCapture?.(e.pointerId);
    root.classList.add('scrubbing');
    if (onActiveVideo()) {
      wasPlaying = !player.paused;
      player.pause();
    } else {
      wasPlaying = false; // la vidéo démarrera d'elle-même, à la position choisie
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

  // Appui long sur la vidéo : vitesse, pas intéressé, masquer l'auteur, garder, lien, signaler
  let pressTimer = 0;
  let pressAt = null;
  let longPressed = false;
  track.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button, .no-taps') || !active) return;
    pressAt = { x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      navigator.vibrate?.(12);
      openMenu(active);
    }, 480);
  });
  track.addEventListener('pointermove', (e) => {
    if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) clearTimeout(pressTimer);
  });
  // Le doigt qui se lève après un appui long ne doit ni mettre en pause ni refermer le menu
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
  document.addEventListener('click', swallow, true);
  ctx.onCleanup(() => document.removeEventListener('click', swallow, true));
  track.addEventListener('contextmenu', (e) => e.preventDefault());

  function removeSlides(test) {
    for (const el of [...track.querySelectorAll('.reel')]) {
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
    if (!track.querySelector('.reel')) showEmpty();
  }

  function openMenu(box) {
    const post = box.__post;
    const speeds = [0.5, 1, 1.5, 2];
    const speedRow = h(
      'div',
      { class: 'reel-speeds', role: 'radiogroup', 'aria-label': 'Vitesse de lecture' },
      speeds.map((x) =>
        h('button', {
          type: 'button',
          class: x === speed ? 'on' : '',
          role: 'radio',
          'aria-checked': String(x === speed),
          onclick: (e) => {
            speed = x;
            player.defaultPlaybackRate = x;
            player.playbackRate = x;
            for (const b of e.currentTarget.parentNode.children) {
              const on = b === e.currentTarget;
              b.classList.toggle('on', on);
              b.setAttribute('aria-checked', String(on));
            }
            toast(x === 1 ? 'Vitesse normale' : `Vitesse ×${String(x).replace('.', ',')}`);
          },
        }, `${String(x).replace('.', ',')}×`),
      ),
    );
    const item = (ic, label, action, danger = false) =>
      h('button', { type: 'button', class: `reel-menu-item${danger ? ' danger' : ''}`, onclick: () => (closeSheet(), action()) }, icon(ic), h('span', null, label));
    const items = [
      !post.mine && item('eyeOff', 'Pas intéressé', () => {
        addToList(LOCAL.skip, post.id);
        removeSlides((p) => p.id === post.id);
        toast('Vous verrez moins de vidéos comme celle-ci.');
      }),
      !post.mine && item('ban', `Masquer les vidéos de ${post.author.displayName}`, () => {
        addToList(LOCAL.authors, post.author.id);
        removeSlides((p) => p.author.id === post.author.id);
        toast(`Les vidéos de ${post.author.displayName} sont masquées.`);
      }),
      item('bookmark', post.saved ? 'Retirer des vidéos gardées' : 'Garder sur le téléphone', () => box.__save()),
      item('link', 'Copier le lien', async () => {
        try {
          await navigator.clipboard.writeText(`${location.origin}/p/${post.id}`);
          toast('Lien copié.');
        } catch {
          shareLink(`${post.author.displayName} sur AURUM`, `/p/${post.id}`);
        }
      }),
      !post.mine && item('flag', 'Signaler', () => reportDialog('post', post.id, 'Signaler la vidéo'), true),
    ].filter(Boolean);
    const stats = post.mine ? h('p', { class: 'reel-menu-stats' }, icon('play', 'icon-xs'), viewsLabel(post.video.views || 0), ' · ', `${num(post.likeCount || 0)} J’aime`) : null;
    openSheet({ title: 'Options de la vidéo', body: h('div', { class: 'reel-menu' }, stats, h('p', { class: 'reel-menu-label' }, 'Vitesse'), speedRow, ...items) });
  }

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
  let cursor = null;
  let more = true;
  let loading = false;
  let gen = 0; // un changement d'onglet ignore les réponses de l'onglet précédent
  const all = [];
  // force : vidéo ouverte exprès (lien, profil) — montrée même si elle avait été écartée
  const add = (posts, { force = false } = {}) => {
    const skip = new Set(readList(LOCAL.skip));
    const authors = new Set(readList(LOCAL.authors));
    for (const p of posts) {
      if (!p.video || seen.has(p.id) || (p.video.expiresAt && p.video.expiresAt <= Date.now())) continue;
      if (!force && (skip.has(p.id) || authors.has(p.author.id))) continue;
      seen.add(p.id);
      all.push(p);
      const s = slide(p);
      track.append(s);
      io.observe(s);
    }
  };
  const feedUrl = () => {
    const q = new URLSearchParams();
    if (scope === 'following') q.set('scope', 'following');
    if (cursor) q.set('cursor', cursor);
    const qs = q.toString();
    return `/api/videos/feed${qs ? `?${qs}` : ''}`;
  };
  // Page suivante. Une page peut n'apporter aucune nouvelle vidéo (déjà affichées, écartées,
  // auteurs masqués) : on enchaîne alors avec la suivante, pour ne jamais rester bloqué au bout
  async function loadMore() {
    if (loading || !more) return;
    loading = true;
    const g = gen;
    try {
      for (let pages = 0; pages < 6 && more; pages++) {
        const d = await api.get(feedUrl());
        if (g !== gen) return;
        more = d.hasMore && Boolean(d.cursor);
        cursor = d.cursor || null;
        const before = all.length;
        add(d.posts);
        if (all.length > before) break;
      }
      if (scope === 'all' && all.length <= 8) rememberReels(all.slice(), more, cursor);
    } catch (err) {
      if (g === gen) toast(err.message, 'error');
    } finally {
      if (g === gen) loading = false;
    }
  }

  function showEmpty() {
    track.querySelector('.reels-empty')?.remove();
    const following = scope === 'following';
    track.append(
      h(
        'div',
        { class: 'reels-empty' },
        following
          ? emptyState('video', 'Rien de neuf chez vos abonnements', 'Les vidéos des membres que vous suivez apparaîtront ici.', h('button', { type: 'button', class: 'btn btn-primary', onclick: () => switchScope('all') }, 'Voir « Pour toi »'))
          : emptyState('video', 'Aucune vidéo pour l’instant', 'Une minute au plus, en 1080p. Lancez le coin Vidéos !', h('button', { type: 'button', class: 'btn btn-primary', onclick: () => document.dispatchEvent(new CustomEvent('aurum:create')) }, 'Publier une vidéo')),
      ),
    );
  }

  async function switchScope(next) {
    if (next === scope && track.querySelector('.reel')) return;
    scope = next;
    paintTabs();
    history.replaceState(history.state, '', next === 'following' ? '/videos?scope=following' : '/videos');
    gen += 1;
    loading = false;
    more = true;
    cursor = null;
    seen.clear();
    all.length = 0;
    io.disconnect();
    active = null;
    actToken += 1;
    stopProgressive();
    player.pause();
    player.remove();
    track.replaceChildren(h('div', { class: 'reels-loading' }, spinner()));
    track.scrollTop = 0;
    const cache = next === 'all' ? cachedReels() : null;
    if (cache) {
      more = cache.hasMore;
      cursor = cache.cursor || null;
      add(cache.posts);
    } else {
      await loadMore();
    }
    track.querySelector('.reels-loading')?.remove();
    if (!track.querySelector('.reel')) showEmpty();
  }

  ctx.onCleanup(() => {
    closeSheet();
    io.disconnect();
    clearTimeout(pressTimer);
    player.pause();
    player.remove();
    player.removeEventListener('playing', onPlaying);
    player.removeEventListener('timeupdate', onTime);
    player.removeEventListener('pause', onPause);
    player.removeEventListener('play', onPause);
    player.removeEventListener('canplaythrough', onReady);
    player.removeEventListener('error', onError);
    player.removeEventListener('waiting', onWaiting);
    player.removeEventListener('loadedmetadata', applySeek);
    player.removeEventListener('canplay', applySeek);
    player.removeEventListener('playing', onFlowing);
    clearTimeout(stallTimer);
    stopProgressive();
    releasePreloads();
    metas.forEach((m, i) => (m.content = saved[i]));
    document.documentElement.classList.remove('reels-mode');
  });

  // Liste déjà chargée (instantané), sinon chargement
  paintTabs();
  const startId = Number(ctx.query.get('p')) || null;
  const cache = scope === 'all' ? cachedReels() : null;
  if (cache) {
    more = cache.hasMore;
    cursor = cache.cursor || null;
    add(cache.posts);
  }
  if (startId && !seen.has(startId)) {
    try {
      const { post } = await api.get(`/api/posts/${startId}`);
      if (post.video) {
        add([post], { force: true });
        const el = [...track.children].find((x) => x.__post?.id === post.id);
        if (el) track.prepend(el); // la vidéo touchée en premier
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
  if (!track.querySelector('.reel')) {
    showEmpty();
  } else if (startId) {
    const target = [...track.children].find((el) => el.__post?.id === startId);
    if (target) requestAnimationFrame(() => (track.scrollTop = target.offsetTop));
  }

  // Clavier (ordinateur) : flèches haut / bas, espace
  const onKey = (e) => {
    if (document.querySelector('.sheet-backdrop') || e.target.closest?.('input, textarea')) return;
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
  if (track.querySelector('.reel')) gestureTip(root);
  ctx.title = 'Vidéos — AURUM';
  return root;
}
