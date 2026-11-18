// Vidéos : préparation sur le téléphone, envoi en morceaux, lecteur du fil.
import { api, ApiError } from '../api.js';
import { h, icon, remaining, onTaps } from '../dom.js';
import { navigate } from '../router.js';

export const MAX_SECONDS = 60;
export const MAX_BYTES = 40 * 1024 * 1024;
const KEEP_AS_IS = 8 * 1024 * 1024; // une petite vidéo MP4 part telle quelle (plus rapide)
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

export const isVideoFile = (f) => Boolean(f && (VIDEO_TYPES.includes(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name || '')));
export const clockLabel = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const once = (el, ev) => new Promise((resolve, reject) => {
  const ok = () => { el.removeEventListener('error', ko); resolve(); };
  const ko = () => { el.removeEventListener(ev, ok); reject(new Error('Vidéo illisible sur cet appareil.')); };
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', ko, { once: true });
});
const fileMime = (f) => (VIDEO_TYPES.includes(f.type) ? f.type : /\.webm$/i.test(f.name) ? 'video/webm' : /\.mov$/i.test(f.name) ? 'video/quicktime' : 'video/mp4');

// Durée, dimensions et image d'aperçu (prise à 0,5 s)
export async function readVideoInfo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.src = url;
  try {
    await once(v, 'loadedmetadata');
    const info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight, poster: null, url };
    try {
      // iOS ne décode une image qu'après un début de lecture (muette : autorisée)
      await v.play().catch(() => {});
      v.pause();
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
      await once(v, 'seeked');
      const scale = Math.min(1, 1080 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      info.poster = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
    } catch {
      /* sans aperçu : la vidéo reste publiable */
    }
    return info;
  } finally {
    v.removeAttribute('src');
    v.load();
  }
}

function recorderType() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

// Compression (720p, ~1,4 Mbit/s) : la vidéo est rejouée en temps réel dans une toile et
// réenregistrée. À lancer depuis un geste (toucher « Publier ») pour que le son soit capté.
function compress(file, info, onProgress) {
  const type = recorderType();
  if (!type) return null;
  // Seul un MP4 est lu partout : on ne convertit en WebM que si le fichier est trop lourd
  if (!type.startsWith('video/mp4') && file.size <= MAX_BYTES && fileMime(file) === 'video/mp4') return null;
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.src = url;
  Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
  document.body.append(v);
  // Son : capté par Web Audio, sans sortir des haut-parleurs
  let audio = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const node = ac.createMediaElementSource(v);
    const dest = ac.createMediaStreamDestination();
    node.connect(dest);
    ac.resume?.();
    audio = { ac, dest };
  } catch {
    v.muted = true;
  }
  const started = v.play(); // dans le geste de l'utilisateur
  return new Promise((resolve, reject) => {
    let rec = null;
    let raf = 0;
    const done = (err, blob) => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      v.pause();
      v.remove();
      URL.revokeObjectURL(url);
      audio?.ac.close().catch(() => {});
      if (err) reject(err);
      else resolve(blob);
    };
    const timer = setTimeout(() => done(new Error('Préparation de la vidéo trop longue.')), (info.duration * 3 + 30) * 1000);
    (async () => {
      await started.catch(() => {});
      v.pause();
      v.currentTime = 0;
      await once(v, 'seeked').catch(() => {});
      const scale = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement('canvas');
      c.width = Math.round((v.videoWidth * scale) / 2) * 2;
      c.height = Math.round((v.videoHeight * scale) / 2) * 2;
      const g = c.getContext('2d');
      g.drawImage(v, 0, 0, c.width, c.height);
      const stream = c.captureStream(30);
      if (audio) for (const t of audio.dest.stream.getAudioTracks()) stream.addTrack(t);
      rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_400_000, audioBitsPerSecond: 96_000 });
      const parts = [];
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = () => done(null, new Blob(parts, { type: type.split(';')[0] }));
      rec.onerror = () => done(new Error('Préparation de la vidéo impossible.'));
      const draw = () => {
        g.drawImage(v, 0, 0, c.width, c.height);
        onProgress?.(Math.min(1, v.currentTime / info.duration));
        if (!v.ended) raf = requestAnimationFrame(draw);
      };
      v.addEventListener('ended', () => {
        g.drawImage(v, 0, 0, c.width, c.height);
        setTimeout(() => rec.state !== 'inactive' && rec.stop(), 150);
      }, { once: true });
      // Application mise en arrière-plan : la lecture reprend au retour
      v.addEventListener('pause', () => !v.ended && document.visibilityState === 'visible' && v.play().catch(() => {}));
      rec.start(1000);
      await v.play();
      draw();
    })().catch((err) => done(err));
  });
}

// Prépare (compresse si besoin) puis envoie la vidéo en morceaux de 1 Mo.
// Renvoie l'identifiant à joindre à la publication.
export async function uploadVideo(file, info, onStep) {
  let blob = file;
  let mime = fileMime(file);
  const heavy = file.size > KEEP_AS_IS || mime !== 'video/mp4';
  const job = heavy ? compress(file, info, (p) => onStep?.('prepare', p)) : null;
  if (job) {
    try {
      const out = await job;
      if (out && out.size > 1000 && (out.size < file.size || mime !== 'video/mp4')) {
        blob = out;
        mime = out.type || 'video/mp4';
      }
    } catch {
      /* compression impossible : on envoie l'original s'il n'est pas trop lourd */
    }
  }
  if (blob.size > MAX_BYTES) throw new Error('Vidéo trop lourde : 40 Mo maximum. Raccourcissez-la un peu.');
  const fd = new FormData();
  fd.append('mime', mime);
  fd.append('size', String(blob.size));
  fd.append('duration', String(info.duration));
  if (info.width) fd.append('width', String(info.width));
  if (info.height) fd.append('height', String(info.height));
  if (info.poster) fd.append('poster', info.poster, 'apercu.jpg');
  const { id, chunkSize, chunks } = await api.post('/api/videos', fd);
  for (let i = 0; i < chunks; i++) {
    const part = blob.slice(i * chunkSize, Math.min(blob.size, (i + 1) * chunkSize));
    let tries = 0;
    for (;;) {
      try {
        const res = await fetch(`/api/videos/${id}/chunks/${i}`, { method: 'PUT', headers: { 'x-aurum': '1', 'content-type': 'application/octet-stream' }, credentials: 'same-origin', body: part });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new ApiError(res.status, data?.error || 'Envoi de la vidéo interrompu.');
        }
        break;
      } catch (err) {
        if (++tries >= 3 || (err instanceof ApiError && err.status < 500 && err.status !== 0)) throw err;
        await new Promise((r) => setTimeout(r, 800 * tries));
      }
    }
    onStep?.('upload', (i + 1) / chunks);
  }
  const { video } = await api.post(`/api/videos/${id}/complete`);
  return video;
}

// ---------------------------------------------------------------------------
// Lecteur du fil : lecture automatique (muette) dès que la vidéo est à l'écran,
// son au toucher du haut-parleur, pause au toucher de l'image.
// ---------------------------------------------------------------------------
let soundOn = true; // son activé par défaut ; le choix vaut pour toutes les vidéos de la session
let soundBlocked = false; // son refusé par le navigateur faute de toucher
export const sound = { get: () => soundOn, set: (v) => (soundOn = Boolean(v)) };
const players = new Set();
const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const p = e.target.__player;
        if (!p) continue;
        if (e.isIntersecting && e.intersectionRatio >= 0.6) p.auto();
        else p.stop();
      }
    }, { threshold: [0, 0.6, 1] })
  : null;

// Pas d'enregistrement depuis le lecteur : ni bouton de téléchargement, ni menu, ni image incrustée
export function noSave(el) {
  el.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback');
  el.disablePictureInPicture = true;
  el.setAttribute('disablepictureinpicture', '');
  el.disableRemotePlayback = true;
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

// Badge « éphémère » : temps restant avant l'effacement
export const ephemeralBadge = (v, cls = 'vp-ephemeral') => (v.expiresAt ? h('span', { class: cls, title: 'Vidéo éphémère : effacée après ce délai' }, icon('clock', 'icon-xs'), remaining(v.expiresAt)) : null);

// Préchargement : les vidéos du fil commencent à se télécharger un écran et demi avant d'apparaître
const nearIo = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.__player?.near(); nearIo.unobserve(e.target); }
    }, { rootMargin: '150% 0px' })
  : null;

export function videoPlayer(v, { onOpen, onDouble } = {}) {
  if (v.expiresAt && v.expiresAt <= Date.now()) {
    return h('div', { class: 'vp vp-gone' }, icon('clock'), h('span', null, 'Vidéo éphémère disparue'));
  }
  // Pas de source tant que la vidéo n'approche pas de l'écran : elle se télécharge alors en entier
  const el = noSave(h('video', { class: 'vp-video', poster: v.poster || undefined, preload: 'auto', loop: true, playsinline: true, 'webkit-playsinline': '' }));
  el.muted = !soundOn;
  el.playsInline = true;
  const soundBtn = h('button', { class: 'vp-sound', type: 'button', 'aria-label': 'Son' }, icon(soundOn ? 'sound' : 'mute'));
  const playMark = h('span', { class: 'vp-play', hidden: true }, icon('play'));
  const bar = h('span', { class: 'vp-bar' }, h('i'));
  // Format exact de la vidéo (verticale, carrée ou horizontale) : jamais recadrée
  const ratio = v.width && v.height ? v.width / v.height : null;
  // Cadre pleine largeur sur fond noir : une vidéo verticale s'y affiche entière (bandes noires
  // sur les côtés) sans transformer le fil en colonne étroite ni dépasser l'écran
  const fit = (r) => ({ aspectRatio: String(Math.max(r, 4 / 5)) });
  const wrap = h('div', { class: 'vp', style: fit(ratio || 9 / 16) }, el, playMark, bar, soundBtn,
    onOpen ? h('button', { class: 'vp-open', type: 'button', 'aria-label': 'Plein écran', onclick: (e) => { e.stopPropagation(); onOpen(); } }, icon('expand')) : null,
  );
  let userPaused = false;
  const paintSound = () => soundBtn.replaceChildren(icon(el.muted ? 'mute' : 'sound'));
  const player = {
    // À l'approche de l'écran : téléchargement complet, puis source locale (lecture immédiate)
    near() {
      const job = preloadVideo(v);
      if (!job) return;
      job.then((local) => {
        if (local && (!el.getAttribute('src') || (el.paused && el.currentTime === 0 && el.getAttribute('src') !== local))) el.src = local;
      });
    },
    auto() {
      if (userPaused) return;
      if (!el.getAttribute('src')) el.src = localVideo(v) || v.url; // pas encore téléchargée : lecture en ligne
      // Son seulement si le navigateur l'autorise (après un premier toucher) ; sinon lecture muette
      // directe, sans tentative ratée qui ferait hoqueter la vidéo
      el.muted = !(soundOn && !soundBlocked && navigator.userActivation?.hasBeenActive);
      paintSound();
      el.play().catch(() => {
        if (el.muted) return;
        soundBlocked = true; // refusé une fois : on ne réessaie plus pendant cette visite
        el.muted = true;
        paintSound();
        el.play().catch(() => {});
      });
    },
    stop() {
      el.pause();
    },
  };
  wrap.__player = player;
  if (!ratio) el.addEventListener('loadedmetadata', () => el.videoWidth && Object.assign(wrap.style, fit(el.videoWidth / el.videoHeight)), { once: true });
  players.add(player);
  soundBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = el.muted;
    el.muted = !soundOn;
    if (soundOn) soundBlocked = false; // le toucher autorise le son
    paintSound();
    if (el.paused) el.play().catch(() => {});
  });
  onTaps(el, {
    single: () => {
      if (el.paused) {
        userPaused = false;
        el.play().catch(() => {});
      } else {
        userPaused = true;
        el.pause();
      }
    },
    double: onDouble ? (e) => onDouble(wrap, e) : null,
  });
  el.addEventListener('play', () => (playMark.hidden = true));
  el.addEventListener('pause', () => (playMark.hidden = !userPaused));
  el.addEventListener('timeupdate', () => {
    if (el.duration) bar.firstChild.style.transform = `scaleX(${el.currentTime / el.duration})`;
  });
  io?.observe(wrap);
  nearIo?.observe(wrap);
  return wrap;
}

// ---------------------------------------------------------------------------
// Plein écran : un seul lecteur, « déverrouillé » par le toucher qui ouvre les vidéos.
// Les téléphones n'autorisent le son que si la lecture démarre pendant ce toucher :
// la vidéo démarre donc tout de suite, avec le son, puis le même lecteur passe d'une
// vidéo à l'autre. La liste est chargée d'avance pour que rien n'attende le réseau.
// ---------------------------------------------------------------------------
let reelsCache = null;
let reelsLoading = null;
export function prefetchReels() {
  if (reelsLoading) return reelsLoading;
  reelsLoading = api
    .get('/api/videos/feed')
    .then((d) => {
      reelsCache = { posts: d.posts, hasMore: d.hasMore, at: Date.now() };
      const first = d.posts.find((p) => p.video);
      if (first) preloadVideo(first.video);
      return reelsCache;
    })
    .catch(() => null)
    .finally(() => {
      reelsLoading = null;
    });
  return reelsLoading;
}
export const cachedReels = () => (reelsCache && Date.now() - reelsCache.at < 3 * 60 * 1000 ? reelsCache : null);
export const rememberReels = (posts, hasMore) => {
  reelsCache = { posts, hasMore, at: Date.now() };
};

let shared = null;
export function reelsPlayer() {
  if (!shared) {
    shared = noSave(h('video', { class: 'reel-video', playsinline: true, 'webkit-playsinline': '', preload: 'auto', loop: true }));
    shared.playsInline = true;
  }
  return shared;
}

// À appeler dans le geste : la première vidéo démarre aussitôt, son compris
function primeReels(url) {
  const v = reelsPlayer();
  v.muted = !soundOn;
  const src = url || '/img/unlock.mp4';
  if (v.getAttribute('src') !== src) v.src = src;
  const p = v.play();
  if (p) p.catch(() => {});
  if (!url && p) p.then(() => v.pause()).catch(() => {});
}

export function openReels({ postId = null, url = null, video = null } = {}) {
  const v = video || (!url ? cachedReels()?.posts.find((p) => p.video)?.video : null);
  const first = (v && localVideo(v)) || url || v?.url || null;
  primeReels(first);
  navigate(postId ? `/videos?p=${postId}` : '/videos');
}

// ---------------------------------------------------------------------------
// Vidéos téléchargées d'avance, en entier : elles démarrent sans attendre le réseau.
// Les morceaux de 1 Mo arrivent en parallèle (6 à la fois) ; au plus 5 vidéos gardées
// en mémoire. Rien n'est téléchargé d'avance si le téléphone économise ses données.
// ---------------------------------------------------------------------------
const CHUNK = 1024 * 1024;
const MAX_KEPT = 5;
const blobs = new Map(); // adresse de la vidéo → { promise, url, at }
const saveData = () => Boolean(navigator.connection?.saveData);

async function fetchAll(urls, limit = 6) {
  const out = new Array(urls.length);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const res = await fetch(urls[i]);
      if (!res.ok) throw new Error('morceau indisponible');
      out[i] = await res.arrayBuffer();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, worker));
  return out;
}

function trimBlobs(keep) {
  if (blobs.size <= MAX_KEPT) return;
  const inUse = new Set([...document.querySelectorAll('video')].map((v) => v.getAttribute('src')));
  const old = [...blobs.entries()].filter(([k, e]) => k !== keep && e.url && !inUse.has(e.url)).sort((a, b) => a[1].at - b[1].at);
  while (blobs.size > MAX_KEPT && old.length) {
    const [k, e] = old.shift();
    URL.revokeObjectURL(e.url);
    blobs.delete(k);
  }
}

// Lance (ou retrouve) le téléchargement complet d'une vidéo
export function preloadVideo(v) {
  if (!v?.url || !v.size || saveData()) return null;
  let e = blobs.get(v.url);
  if (!e) {
    const base = v.url.replace(/\.(mp4|webm)$/, '');
    const type = v.url.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    const n = Math.ceil(v.size / CHUNK);
    e = { url: null, at: Date.now() };
    e.promise = fetchAll(Array.from({ length: n }, (_, i) => `${base}/${i}.bin`))
      .then((parts) => {
        e.url = URL.createObjectURL(new Blob(parts, { type }));
        return e.url;
      })
      .catch(() => {
        blobs.delete(v.url);
        return null;
      });
    blobs.set(v.url, e);
    trimBlobs(v.url);
  }
  e.at = Date.now();
  return e.promise;
}

// Adresse locale si la vidéo est déjà téléchargée, sinon null
export const localVideo = (v) => (v?.url && blobs.get(v.url)?.url) || null;
// La même vidéo, qu'elle soit lue en ligne ou depuis le téléphone ?
export const sameVideo = (el, v) => {
  const src = el.getAttribute('src');
  return Boolean(src && (src === v.url || src === localVideo(v)));
};
