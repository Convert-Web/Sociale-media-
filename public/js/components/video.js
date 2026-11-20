// Vidéos : préparation sur le téléphone, envoi en morceaux, lecteur du fil.
import { api, ApiError } from '../api.js';
import { warmPosts } from '../warm.js';
import { h, icon, remaining, onTaps } from '../dom.js';
import { navigate } from '../router.js';

export const MAX_SECONDS = 60;
export const MAX_BYTES = 40 * 1024 * 1024;
const KEEP_AS_IS = 8 * 1024 * 1024; // une petite vidéo MP4 part telle quelle (plus rapide)
const CHUNK_UP = 1024 * 1024; // morceaux envoyés (même taille que sur le serveur)
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
// Bande-son décodée dès le choix de la vidéo (pendant que l'on écrit son texte) : si c'est prêt
// au moment de publier, la préparation se fait en silence ; sinon on capte le son de la vidéo
// elle-même (méthode éprouvée). Dans les deux cas, le son est conservé.
const decodeWith = (ac, buf) =>
  new Promise((resolve, reject) => {
    const p = ac.decodeAudioData(buf, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve, reject);
  });
function predecode(file) {
  const state = { state: 'pending', buffer: null };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || file.size > 80 * 1024 * 1024) {
    state.state = 'failed';
    return state;
  }
  let ac = null;
  file
    .arrayBuffer()
    .then((buf) => {
      ac = new AC();
      return decodeWith(ac, buf);
    })
    .then((buffer) => {
      state.buffer = buffer;
      state.state = buffer && buffer.duration > 0 ? 'ok' : 'failed';
    })
    .catch(() => (state.state = 'failed'))
    .finally(() => ac?.close?.().catch(() => {}));
  return state;
}

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
    const info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight, poster: null, url, audio: predecode(file) };
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
  // H.264 d'abord (lu partout, iPhone compris), dans un profil qui accepte le 1080p
  const list = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4;codecs=avc1.4d0028,mp4a.40.2',
    'video/mp4;codecs=avc1.42E028,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

// Qualité : 1080p (côté le plus long 1920 px), jamais agrandie. Débit selon le nombre de pixels :
// ~2,1 Mbit/s en 1080p, 1,2 Mbit/s au minimum (720p et moins) : la netteté du 1080p, avec des
// fichiers assez légers pour démarrer vite en 4G.
const MAX_SIDE = 1920;
export function encodeSize(w, h) {
  const scale = Math.min(1, MAX_SIDE / Math.max(w || 1, h || 1));
  const W = Math.max(2, Math.round(((w || 720) * scale) / 2) * 2);
  const H = Math.max(2, Math.round(((h || 1280) * scale) / 2) * 2);
  const bps = Math.min(2_400_000, Math.max(1_200_000, Math.round(W * H * 30 * 0.034)));
  return { width: W, height: H, bps };
}

// Compression (1080p, ~2,1 Mbit/s) : la vidéo est rejouée en temps réel dans une toile et
// réenregistrée, avec son son. Chaque seconde enregistrée est remise à onData : l'envoi
// commence pendant la préparation (la vidéo est en ligne quelques secondes après la fin). Deux façons de garder le son :
// - bande-son déjà décodée (cas habituel) : la vidéo est rejouée en MUET et le son est mêlé à
//   part — on peut regarder d'autres vidéos avec le son pendant la préparation ;
// - sinon : le son de la vidéo est capté directement (Web Audio), sans sortir des haut-parleurs.
// À lancer depuis un geste (toucher « Publier ») : nécessaire sur iPhone.
function encodePlan(file) {
  const type = recorderType();
  if (!type) return null;
  // Seul un MP4 est lu partout : on ne convertit en WebM que si le fichier est trop lourd
  if (!type.startsWith('video/mp4') && file.size <= MAX_BYTES && fileMime(file) === 'video/mp4') return null;
  return { type, mime: type.split(';')[0] };
}

function compress(file, info, plan, onProgress, onData) {
  const { type } = plan;
  const pre = info.audio?.state === 'ok' ? info.audio.buffer : null;
  window.__aurumSoundMethod = pre ? 'decodee' : 'captee';
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.muted = Boolean(pre);
  v.src = url;
  Object.assign(v.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
  document.body.append(v);
  // Contexte audio créé et relancé dans le geste (sinon il reste suspendu sur iPhone)
  let ac = null;
  let dest = null;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC();
    dest = ac.createMediaStreamDestination();
    if (!pre) ac.createMediaElementSource(v).connect(dest); // son capté depuis la vidéo
    ac.resume?.().catch(() => {});
  } catch {
    ac = null;
    dest = null;
    v.muted = true;
  }
  const started = v.play(); // dans le geste de l'utilisateur
  let cancel = null;
  const job = new Promise((resolve, reject) => {
    let rec = null;
    let raf = 0;
    let source = null;
    let retry = 0;
    let finished = false;
    const done = (err, blob) => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      clearTimeout(retry);
      v.pause();
      v.remove();
      URL.revokeObjectURL(url);
      try {
        source?.stop();
      } catch {
        /* déjà arrêtée */
      }
      ac?.close().catch(() => {});
      if (err) reject(err);
      else resolve(blob);
    };
    const timer = setTimeout(() => done(new Error('Préparation de la vidéo trop longue.')), (info.duration * 4 + 60) * 1000);
    cancel = (err) => {
      try {
        if (rec && rec.state !== 'inactive') {
          rec.ondataavailable = null;
          rec.onstop = null;
          rec.stop();
        }
      } catch {
        /* déjà arrêté */
      }
      done(err || new Error('Préparation annulée.'));
    };
    // Une autre vidéo joue avec le son (méthode « son capté ») : on attend qu'elle s'arrête
    const otherAudible = () => [...document.querySelectorAll('video, audio')].some((m) => m !== v && !m.paused && !m.muted);
    const resume = () => {
      clearTimeout(retry);
      if (finished || v.ended || document.visibilityState !== 'visible') return;
      if (!pre && otherAudible()) {
        retry = setTimeout(resume, 1000);
        return;
      }
      v.play().catch(() => (retry = setTimeout(resume, 1000)));
    };
    (async () => {
      await started.catch(() => {});
      v.pause();
      v.currentTime = 0;
      await once(v, 'seeked').catch(() => {});
      const size = encodeSize(v.videoWidth, v.videoHeight);
      const c = document.createElement('canvas');
      c.width = size.width;
      c.height = size.height;
      const g = c.getContext('2d', { alpha: false });
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.drawImage(v, 0, 0, c.width, c.height);
      const stream = c.captureStream(30);
      if (dest) for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      const opts = { mimeType: type, videoBitsPerSecond: size.bps, ...(dest ? { audioBitsPerSecond: 128_000 } : {}) };
      try {
        rec = new MediaRecorder(stream, opts);
      } catch {
        rec = new MediaRecorder(stream, { ...opts, mimeType: plan.mime }); // profil refusé : format simple
      }
      const parts = [];
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        parts.push(e.data);
        onData?.(e.data);
      };
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
      // Interruption (application en arrière-plan, autre vidéo sonore) : tout se met en pause,
      // son compris, puis reprend au même endroit
      v.addEventListener('pause', () => {
        if (finished || v.ended) return;
        if (pre) ac?.suspend().catch(() => {});
        if (rec?.state === 'recording') rec.pause();
        retry = setTimeout(resume, 400);
      });
      v.addEventListener('playing', () => {
        ac?.resume().catch(() => {});
        if (rec?.state === 'paused') rec.resume();
      });
      const onVisible = () => document.visibilityState === 'visible' && v.paused && !v.ended && resume();
      document.addEventListener('visibilitychange', onVisible);
      v.addEventListener('ended', () => document.removeEventListener('visibilitychange', onVisible), { once: true });
      rec.start(1000);
      await v.play();
      if (pre && ac && dest) {
        source = ac.createBufferSource();
        source.buffer = pre;
        source.connect(dest);
        source.start(0, Math.min(v.currentTime, pre.duration));
      }
      draw();
    })().catch((err) => done(err));
  });
  job.cancel = (err) => cancel?.(err);
  return job;
}

// Envoi d'un morceau de 1 Mo, avec reprise : jusqu'à 6 essais, et attente du retour du réseau
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backOnline = () => (navigator.onLine === false ? new Promise((r) => addEventListener('online', r, { once: true })) : null);
async function putChunk(id, i, part) {
  for (let tries = 1; ; tries++) {
    try {
      await backOnline();
      const res = await fetch(`/api/videos/${id}/chunks/${i}`, { method: 'PUT', headers: { 'x-aurum': '1', 'content-type': 'application/octet-stream' }, credentials: 'same-origin', body: part });
      if (res.ok) return;
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, data?.error || 'Envoi de la vidéo interrompu.');
    } catch (err) {
      if (tries >= 6 || (err instanceof ApiError && err.status < 500 && err.status !== 0 && err.status !== 429)) throw err;
      await sleep(700 * tries);
    }
  }
}

// Morceaux envoyés trois à la fois, au fur et à mesure qu'ils sont prêts
function chunkSender(opened, onSent) {
  const queue = [];
  const flying = new Set();
  let failed = null;
  let sent = 0;
  const pump = () => {
    while (!failed && flying.size < 3 && queue.length) {
      const { i, part } = queue.shift();
      const p = opened
        .then(({ id }) => putChunk(id, i, part))
        .then(() => {
          sent += part.size;
          onSent?.(sent);
        })
        .catch((err) => (failed = failed || err))
        .finally(() => {
          flying.delete(p);
          pump();
        });
      flying.add(p);
    }
  };
  return {
    add(i, part) {
      queue.push({ i, part });
      pump();
    },
    get failed() {
      return failed;
    },
    async drain() {
      while ((queue.length || flying.size) && !failed) await Promise.race(flying);
      if (failed) throw failed;
    },
  };
}

function openUpload({ mime, size, info, streaming = false, estimate = 0 }) {
  const fd = new FormData();
  fd.append('mime', mime);
  if (streaming) {
    fd.append('streaming', '1');
    fd.append('estimate', String(Math.max(1000, Math.round(estimate))));
  } else {
    fd.append('size', String(size));
  }
  fd.append('duration', String(info.duration));
  if (info.width) fd.append('width', String(info.width));
  if (info.height) fd.append('height', String(info.height));
  if (info.poster) fd.append('poster', info.poster, 'apercu.jpg');
  return api.post('/api/videos', fd);
}

// Fichier déjà prêt : envoyé en morceaux de 1 Mo, trois à la fois
async function sendBlob(blob, mime, info, onStep) {
  if (blob.size > MAX_BYTES) throw new Error('Vidéo trop lourde : 40 Mo maximum. Raccourcissez-la un peu.');
  const opened = openUpload({ mime, size: blob.size, info });
  const { id, chunkSize, chunks } = await opened;
  const sender = chunkSender(opened, (n) => onStep?.('upload', n / blob.size));
  for (let i = 0; i < chunks; i++) sender.add(i, blob.slice(i * chunkSize, Math.min(blob.size, (i + 1) * chunkSize)));
  await sender.drain();
  const { video } = await api.post(`/api/videos/${id}/complete`);
  return video;
}

// Prépare la vidéo (1080p) et l'envoie EN MÊME TEMPS : chaque mégaoctet enregistré part aussitôt.
// memo garde la vidéo préparée : si le réseau coupe, « Réessayer » renvoie sans tout refaire.
// Renvoie la vidéo à joindre à la publication.
export async function uploadVideo(file, info, onStep, memo = {}) {
  if (memo.blob) return sendBlob(memo.blob, memo.mime, info, onStep);
  const mime = fileMime(file);
  const heavy = file.size > KEEP_AS_IS || mime !== 'video/mp4';
  const plan = heavy ? encodePlan(file) : null;
  if (!plan) return sendBlob(file, mime, info, onStep);

  const target = encodeSize(info.width, info.height);
  const estimate = Math.min(MAX_BYTES, ((target.bps + 128_000) * (info.duration || 30)) / 8 * 1.25);
  const opened = openUpload({ mime: plan.mime, info, streaming: true, estimate });
  let recorded = 0; // octets enregistrés
  let recDone = false;
  // Avancement : l'enregistrement (0 à 90 %), puis les derniers morceaux (90 à 100 %)
  const sender = chunkSender(opened, (sentBytes) => recDone && onStep?.('upload', 0.9 + 0.1 * Math.min(1, sentBytes / recorded)));
  let pending = [];
  let pendingSize = 0;
  let index = 0;
  const cut = (final) => {
    while (pendingSize >= CHUNK_UP || (final && pendingSize > 0)) {
      const all = new Blob(pending);
      const part = all.slice(0, CHUNK_UP);
      sender.add(index++, part);
      const rest = all.slice(part.size);
      pending = rest.size ? [rest] : [];
      pendingSize = rest.size;
    }
  };
  const job = compress(file, info, plan, (p) => onStep?.('stream', Math.min(p, 1) * 0.9), (data) => {
    recorded += data.size;
    if (recorded > MAX_BYTES) return job?.cancel(new Error('Vidéo trop lourde : 40 Mo maximum. Raccourcissez-la un peu.'));
    pending.push(data);
    pendingSize += data.size;
    cut(false);
  });
  // Envoi refusé d'entrée (espace plein, trop de vidéos…) : la préparation s'arrête aussitôt
  opened.catch((err) => job.cancel(err));
  let out;
  try {
    out = await job;
    if (sender.failed) throw sender.failed;
  } catch (err) {
    opened.then(({ id }) => api.del(`/api/videos/${id}`)).catch(() => {});
    if (err instanceof ApiError) throw err; // refus du serveur ou réseau coupé : message clair
    // Préparation impossible sur ce téléphone : la vidéo d'origine part telle quelle
    return sendBlob(file, mime, info, onStep);
  }
  memo.blob = out;
  memo.mime = out.type || plan.mime;
  recDone = true;
  cut(true);
  onStep?.('upload', 0.9);
  await sender.drain();
  const { id } = await opened;
  const { video } = await api.post(`/api/videos/${id}/complete`, { size: out.size });
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

// Vues : une fois par vidéo et par visite (le serveur ne compte qu'une vue par membre)
const viewsSent = new Set();
export function countView(postId) {
  if (!postId || viewsSent.has(postId)) return null;
  viewsSent.add(postId);
  return api.post(`/api/posts/${postId}/view`).catch(() => {
    viewsSent.delete(postId);
    return null;
  });
}

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

// Préchargement : une vidéo du fil se télécharge quand elle approche de l'écran (un écran avant)
// et que l'on ralentit dessus — pas quand on la survole en défilant vite (bande passante économisée)
const nearTimers = new WeakMap();
const nearIo = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        clearTimeout(nearTimers.get(e.target));
        if (!e.isIntersecting) continue;
        nearTimers.set(e.target, setTimeout(() => {
          e.target.__player?.near();
          nearIo.unobserve(e.target);
        }, 350));
      }
    }, { rootMargin: '100% 0px' })
  : null;

export function videoPlayer(v, { onOpen, onDouble, postId = null } = {}) {
  if (v.expiresAt && v.expiresAt <= Date.now()) {
    return h('div', { class: 'vp vp-gone' }, icon('clock'), h('span', null, 'Vidéo éphémère disparue'));
  }
  // Pas de source tant que la vidéo n'approche pas de l'écran : elle se télécharge alors en entier
  const el = noSave(h('video', { class: 'vp-video', poster: v.poster || undefined, preload: 'auto', loop: true, playsinline: true, 'webkit-playsinline': '' }));
  el.muted = !soundOn;
  el.playsInline = true;
  const soundBtn = h('button', { class: 'vp-sound', type: 'button', 'aria-label': 'Son' }, icon(soundOn ? 'sound' : 'mute'));
  const playMark = h('span', { class: 'vp-play', hidden: true }, icon('playBadge'));
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
  let wanted = false; // à l'écran : doit jouer dès que possible
  const paintSound = () => soundBtn.replaceChildren(icon(el.muted ? 'mute' : 'sound'));
  const player = {
    // À l'approche de l'écran : téléchargement complet, puis source locale (lecture immédiate)
    near() {
      const job = preloadVideo(v);
      if (!job) return;
      job.then((local) => {
        if (local && (!el.getAttribute('src') || (el.paused && el.currentTime === 0 && el.getAttribute('src') !== local))) el.src = local;
        if (local && wanted && el.paused) player.auto();
      });
    },
    auto() {
      if (userPaused) return;
      wanted = true;
      if (!el.getAttribute('src')) {
        const local = localVideo(v);
        // Téléchargement en cours : l'aperçu reste affiché, la vidéo part dès qu'elle est là
        // (sans la télécharger une seconde fois en ligne) ; sinon lecture en ligne
        const job = local ? null : preloadVideo(v, { prio: PRIO.next });
        if (job) {
          job.then((url) => {
            if (!wanted || userPaused) return;
            if (!el.getAttribute('src')) el.src = url || v.url;
            if (el.paused) player.auto();
          });
          return;
        }
        el.src = local || v.url;
      }
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
      wanted = false;
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
      // Vidéo muette qui joue : le premier toucher active le son (comme sur Instagram)
      if (el.muted && !el.paused) {
        soundOn = true;
        soundBlocked = false;
        el.muted = false;
        paintSound();
        el.play().catch(() => {});
        return;
      }
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
    const d = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : v.duration;
    if (d) bar.firstChild.style.transform = `scaleX(${Math.min(1, el.currentTime / d)})`;
    // Vue comptée après 2 secondes de lecture, comme dans le plein écran
    if (postId && el.currentTime >= Math.min(2, (d || 4) * 0.6)) countView(postId);
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
let reelsGen = 0; // un chargement lancé avant une publication ne remplace pas la liste plus récente
export function prefetchReels() {
  if (reelsLoading) return reelsLoading;
  const gen = reelsGen;
  reelsLoading = api
    .get('/api/videos/feed')
    .then((d) => {
      if (gen !== reelsGen) return reelsCache;
      reelsCache = { posts: d.posts, hasMore: d.hasMore, cursor: d.cursor || null, at: Date.now() };
      // Dès l'entrée dans l'application : les premières vidéos en entier, une à une
      warmPosts(d.posts, { videos: 3 });
      return reelsCache;
    })
    .catch(() => null)
    .finally(() => {
      reelsLoading = null;
    });
  return reelsLoading;
}
// Liste gardée 2 minutes ; une liste vide n'est jamais réutilisée (une vidéo vient peut-être d'arriver)
export const cachedReels = () => (reelsCache?.posts.length && Date.now() - reelsCache.at < 2 * 60 * 1000 ? reelsCache : null);
// Une vidéo vient d'être publiée : la liste est rechargée pour l'inclure
export function forgetReels() {
  reelsCache = null;
  reelsGen += 1;
  reelsLoading = null;
  prefetchReels();
}
export const rememberReels = (posts, hasMore, cursor = null) => {
  reelsCache = { posts, hasMore, cursor, at: Date.now() };
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
function primeReels(url, video = null) {
  const v = reelsPlayer();
  v.muted = !soundOn;
  const src = url || '/img/unlock.mp4';
  if (v.getAttribute('src') !== src) setSource(v, url ? video : null, src);
  const p = v.play();
  if (p) p.catch(() => {});
  if (!url && p) p.then(() => v.pause()).catch(() => {});
}

export function openReels({ postId = null, url = null, video = null } = {}) {
  const v = video || (!url ? cachedReels()?.posts.find((p) => p.video)?.video : null);
  const local = v && localVideo(v);
  // Lecture progressive, ou téléchargement presque fini : le lecteur est seulement déverrouillé
  // (son compris) et la vidéo démarre dès que possible ; sinon elle démarre en ligne, tout de suite
  const later = v && !local && (canProgressive() || preloadEta(v) < 2.5);
  const first = local || (later ? null : url || v?.url || null);
  primeReels(first, v || (url ? { url } : null));
  navigate(postId ? `/videos?p=${postId}` : '/videos');
}

// ---------------------------------------------------------------------------
// Téléchargement des vidéos, morceau par morceau (1 Mo, gardés par le réseau de Vercel) :
// - une seule file pour toute l'application, le morceau le plus urgent d'abord : la vidéo à
//   l'écran, puis le DÉBUT des suivantes (2 Mo ≈ 8 secondes), puis la fin de la suivante ;
// - lecture progressive (comme TikTok) : la vidéo démarre dès son premier morceau et la suite
//   arrive pendant qu'elle joue (MediaSource) ; sinon, la vidéo est lue une fois entière sur
//   le téléphone, ou en ligne ;
// - au plus 6 vidéos gardées en mémoire ; rien d'avance en mode économie de données.
// ---------------------------------------------------------------------------
const CHUNK = 1024 * 1024;
const PREFIX = 2; // morceaux du début téléchargés d'avance
const MAX_KEPT = 6;
const PARALLEL = 4; // morceaux en cours en même temps (2 au plus par vidéo)
const PER_VIDEO = 2;
export const PRIO = { now: 0, next: 1, later: 2, warm: 3 };
const entries = new Map(); // adresse de la vidéo → téléchargement
let flying = 0;
let seq = 0;
let holdUntil = 0; // pause des téléchargements d'avance (la vidéo à l'écran se lit en ligne)
const saveData = () => Boolean(navigator.connection?.saveData);

function entryFor(v) {
  let e = entries.get(v.url);
  if (e) return e;
  const n = Math.max(1, Math.ceil(v.size / CHUNK));
  e = {
    key: v.url,
    base: v.url.replace(/\.(mp4|webm)$/, ''),
    type: v.url.endsWith('.webm') ? 'video/webm' : 'video/mp4',
    size: v.size,
    duration: v.duration || 0,
    n,
    parts: new Array(n),
    flying: new Map(), // morceau en cours → contrôle d'abandon
    waiters: new Map(), // morceau → fonctions à prévenir
    got: 0,
    have: 0, // morceaux reçus
    prio: PRIO.warm,
    all: false, // tous les morceaux voulus (sinon seulement le début)
    seq: seq++,
    state: 'waiting', // waiting | loading | ready | failed
    errors: 0,
    info: null, // format lu dans le premier morceau
    blob: null,
    url: null,
    at: Date.now(),
  };
  e.promise = new Promise((r) => (e.resolve = r));
  entries.set(v.url, e);
  trim(v.url);
  return e;
}

// Rang d'un morceau (plus petit = plus urgent) : le début de la vidéo à l'écran, puis le début
// de la suivante, puis la suite de la vidéo à l'écran (elle a déjà ~8 s d'avance), etc.
function rank(e, i) {
  const head = i < PREFIX;
  if (e.prio === PRIO.now) return head ? 0 : 2;
  if (e.prio === PRIO.next) return head ? 1 : 4;
  if (e.prio === PRIO.later) return head ? 3 : 5;
  return head ? 6 : 7;
}

function nextChunk(urgent) {
  let best = null;
  let bestKey = Infinity;
  const held = holdUntil > Date.now();
  for (const e of entries.values()) {
    if (urgent && e !== urgent) continue;
    // Premier morceau seul d'abord (tout le réseau pour lui : première image plus tôt)
    if (e.state === 'ready' || e.state === 'failed' || e.flying.size >= (e.have ? PER_VIDEO : 1)) continue;
    if (held && e.prio !== PRIO.now) continue;
    const limit = e.all ? e.n : Math.min(e.n, PREFIX);
    for (let i = 0; i < limit; i++) {
      if (e.parts[i] || e.flying.has(i)) continue;
      const key = rank(e, i) * 1e9 + e.seq * 1e3 + i;
      if (key < bestKey) {
        bestKey = key;
        best = [e, i];
      }
      break;
    }
  }
  return best;
}

// Vidéo à l'écran dont le début (2 Mo ≈ 8 secondes) n'est pas encore là : elle a tout le réseau,
// les téléchargements d'avance s'interrompent (leur morceau sera repris plus tard)
const URGENT = PREFIX;
function urgentEntry() {
  for (const e of entries.values()) {
    if (e.prio === PRIO.now && (e.state === 'waiting' || e.state === 'loading') && e.have < Math.min(e.n, URGENT)) return e;
  }
  return null;
}
function preempt(urgent) {
  if (!urgent) return;
  for (const e of entries.values()) {
    if (e === urgent) continue;
    for (const ctl of e.flying.values()) ctl.abort();
  }
}

function pump() {
  const urgent = urgentEntry();
  preempt(urgent);
  while (flying < PARALLEL) {
    const job = nextChunk(urgent);
    if (!job) break;
    const [e, i] = job;
    const ctl = new AbortController();
    e.flying.set(i, ctl);
    flying++;
    if (e.state === 'waiting') {
      e.state = 'loading';
      e.startedAt = performance.now();
    }
    fetch(`${e.base}/${i}.bin`, { signal: ctl.signal })
      .then((res) => {
        if (!res.ok) throw new Error('morceau indisponible');
        return res.arrayBuffer();
      })
      .then((buf) => {
        if (e.state === 'failed') return;
        if (e.parts[i]) return;
        e.parts[i] = buf;
        e.have += 1;
        e.got += buf.byteLength;
        if (i === 0) e.info = sniff(buf, e.type);
        const list = e.waiters.get(i);
        e.waiters.delete(i);
        list?.forEach((fn) => fn(buf));
        if (e.have === e.n) complete(e); // (every() sauterait les morceaux absents)
      })
      .catch(() => {
        if (e.state === 'failed' || ctl.signal.aborted) return; // abandon volontaire : repris plus tard
        if (++e.errors >= 4) fail(e);
      })
      .finally(() => {
        e.flying.delete(i);
        flying--;
        pump();
      });
  }
  // Pause en cours : reprise à son terme
  if (holdUntil > Date.now()) {
    clearTimeout(pump.t);
    pump.t = setTimeout(pump, holdUntil - Date.now() + 10);
  }
}

function complete(e) {
  e.blob = new Blob(e.parts, { type: e.type });
  e.url = URL.createObjectURL(e.blob);
  e.parts = null; // la mémoire n'est occupée qu'une fois
  e.state = 'ready';
  e.resolve(e.url);
}

function fail(e) {
  e.state = 'failed';
  for (const ctl of e.flying.values()) ctl.abort();
  if (entries.get(e.key) === e) entries.delete(e.key);
  for (const list of e.waiters.values()) list.forEach((fn) => fn(null));
  e.waiters.clear();
  e.resolve(null);
}

// Un morceau, dès qu'il est là (null si la vidéo est indisponible)
function part(e, i) {
  if (e.state === 'failed') return Promise.resolve(null);
  if (e.blob) return e.blob.slice(i * CHUNK, Math.min(e.size, (i + 1) * CHUNK)).arrayBuffer();
  if (e.parts?.[i]) return Promise.resolve(e.parts[i]);
  return new Promise((resolve) => {
    const list = e.waiters.get(i) || [];
    list.push(resolve);
    e.waiters.set(i, list);
    pump();
  });
}

function trim(keep) {
  if (entries.size <= MAX_KEPT) return;
  const inUse = new Set([...document.querySelectorAll('video')].map((el) => el.dataset.v || el.getAttribute('src')));
  const old = [...entries.values()]
    .filter((e) => e.key !== keep && e.prio !== PRIO.now && !e.flying.size && !inUse.has(e.key) && !inUse.has(e.url))
    .sort((a, b) => a.at - b.at);
  while (entries.size > MAX_KEPT && old.length) {
    const e = old.shift();
    if (e.url) URL.revokeObjectURL(e.url);
    fail(e); // prévient aussi ceux qui attendaient un morceau (rien ne reste suspendu)
  }
}

// Pause des téléchargements d'avance pendant ms (la vidéo à l'écran a tout le réseau)
export function holdPreloads(ms) {
  holdUntil = Math.max(holdUntil, Date.now() + ms);
}
export function releasePreloads() {
  holdUntil = 0;
  pump();
}

function want(v, prio, all) {
  const e = entryFor(v);
  // Une seule vidéo « à l'écran » : celle d'avant repasse derrière les suivantes
  if (prio === PRIO.now) for (const o of entries.values()) if (o !== e && o.prio === PRIO.now) o.prio = PRIO.later;
  if (prio < e.prio) e.prio = prio;
  if (all) e.all = true;
  e.at = Date.now();
  pump();
  return e;
}

// Téléchargement complet d'une vidéo (lecture depuis le téléphone, « Garder ») ; prio : PRIO.now … PRIO.warm
export function preloadVideo(v, { force = false, prio = PRIO.later } = {}) {
  // force : demande explicite (« Garder »), même en mode économie de données
  if (!v?.url || !v.size || (!force && saveData())) return null;
  return want(v, force ? PRIO.now : prio, true).promise;
}

// Début seulement (2 Mo) : de quoi démarrer aussitôt en lecture progressive
export function preloadStart(v, prio = PRIO.later) {
  if (!v?.url || !v.size || saveData()) return;
  want(v, prio, false);
}

// Secondes avant la fin du téléchargement complet (0 : prête ; Infinity : pas commencé)
export function preloadEta(v) {
  const e = v?.url && entries.get(v.url);
  if (!e || e.state === 'waiting' || e.state === 'failed' || !e.all) return e?.state === 'ready' ? 0 : Infinity;
  if (e.state === 'ready') return 0;
  const elapsed = (performance.now() - e.startedAt) / 1000;
  // Débit mesuré ; au tout début, celui annoncé par le téléphone (sinon ~10 Mbit/s)
  const rate = elapsed > 0.4 && e.got > 0 ? e.got / elapsed : (navigator.connection?.downlink || 10) * 125000;
  return (e.size - e.got) / rate;
}

// Abandon d'un téléchargement (la vidéo se lit en ligne : pas deux fois les mêmes octets)
export function cancelPreload(v) {
  const e = v?.url && entries.get(v.url);
  if (!e || e.state === 'ready') return;
  fail(e);
}

// La vidéo téléchargée elle-même (pour la garder sur le téléphone), sinon null
export const videoBlob = (v) => (v?.url && entries.get(v.url)?.blob) || null;

// Adresse locale si la vidéo est déjà téléchargée, sinon null
export const localVideo = (v) => (v?.url && entries.get(v.url)?.url) || null;

// Source d'un lecteur : on note quelle vidéo il lit (quelle que soit la forme de l'adresse)
export function setSource(el, v, src) {
  el.dataset.v = v?.url || '';
  // Mode de lecture (utile pour comprendre un souci) : téléphone, progressive ou en ligne
  el.dataset.mode = !v ? '' : src === v.url ? 'en-ligne' : src === localVideo(v) ? 'telephone' : 'progressive';
  el.src = src;
}
// La même vidéo, qu'elle soit lue en ligne, depuis le téléphone ou progressivement ?
export const sameVideo = (el, v) => Boolean(el.getAttribute('src') && el.dataset.v && el.dataset.v === v?.url);

// ---------------------------------------------------------------------------
// Lecture progressive (MediaSource ; ManagedMediaSource sur iPhone, iOS 17.1 et plus).
// Possible pour les vidéos préparées par l'application (format « fragmenté »). En cas de
// souci sur un téléphone, elle est coupée pour quelques jours et la lecture classique reprend.
// ---------------------------------------------------------------------------
const MS = typeof window !== 'undefined' ? window.ManagedMediaSource || window.MediaSource : null;
const MSE_OFF = 'aurum:mse-off';
let mseOff = (() => {
  try {
    return Number(localStorage.getItem(MSE_OFF) || 0) > Date.now();
  } catch {
    return false;
  }
})();
export function disableProgressive() {
  mseOff = true;
  try {
    localStorage.setItem(MSE_OFF, String(Date.now() + 3 * 24 * 3600 * 1000));
  } catch {
    /* pour cette visite seulement */
  }
}

// Format d'une vidéo, lu dans son premier morceau : conteneur, codecs, fragmentée ou non
function sniff(buf, type) {
  try {
    const b = new Uint8Array(buf);
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
      // WebM (enregistré par le téléphone : toujours lisible progressivement)
      const head = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 65536)));
      const v = head.includes('V_VP9') ? 'vp9' : head.includes('V_VP8') ? 'vp8' : null;
      const a = head.includes('A_OPUS') ? 'opus' : head.includes('A_VORBIS') ? 'vorbis' : null;
      if (!v) return { progressive: false };
      return { progressive: true, mime: `video/webm; codecs="${[v, a].filter(Boolean).join(',')}"` };
    }
    return mp4Info(b, type);
  } catch {
    return { progressive: false };
  }
}

function mp4Info(b, type) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const str = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const hex = (n) => n.toString(16).padStart(2, '0');
  const codecs = [];
  let fragmented = false;
  let moov = false;
  // Parcourt les boîtes [from, to) ; descend dans celles qui contiennent les pistes
  const walk = (from, to, depth) => {
    let o = from;
    while (o + 8 <= to) {
      let size = dv.getUint32(o);
      const name = str(o + 4);
      let head = 8;
      if (size === 1) {
        size = Number(dv.getBigUint64(o + 8));
        head = 16;
      } else if (size === 0) {
        size = to - o;
      }
      if (size < head || o + size > to) {
        if (name === 'moov') throw new Error('incomplet');
        return;
      }
      const body = o + head;
      if (name === 'moov') moov = true;
      if (name === 'moof' || name === 'mvex') fragmented = true;
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(name)) walk(body, o + size, depth + 1);
      else if (name === 'stsd') walk(body + 8, o + size, depth + 1); // version, drapeaux, nombre
      else if (name === 'avc1' || name === 'avc3') {
        const c = findBox(body + 78, o + size, 'avcC');
        if (c >= 0) codecs.push(`${name}.${hex(b[c + 1])}${hex(b[c + 2])}${hex(b[c + 3])}`);
      } else if (name === 'vp09') {
        const c = findBox(body + 78, o + size, 'vpcC');
        // Niveau absent (0) dans les fichiers enregistrés par Chrome : 4.1 (jusqu'au 1080p)
        if (c >= 0) codecs.push(`vp09.${String(b[c + 4]).padStart(2, '0')}.${String(b[c + 5] || 41).padStart(2, '0')}.${String(b[c + 6] >> 4 || 8).padStart(2, '0')}`);
      } else if (name === 'mp4a') {
        codecs.push('mp4a.40.2');
      } else if (name === 'Opus') {
        codecs.push('opus');
      } else if (depth >= 5 && /^(hvc1|hev1|av01)$/.test(name)) {
        codecs.push(name); // pas de lecture progressive pour ces formats
      }
      o += size;
    }
  };
  const findBox = (from, to, want) => {
    let o = from;
    while (o + 8 <= to) {
      const size = dv.getUint32(o);
      if (size < 8) return -1;
      if (str(o + 4) === want) return o + 8;
      o += size;
    }
    return -1;
  };
  walk(0, b.length, 0);
  const ok = moov && fragmented && codecs.length && codecs.every((c) => /^(avc[13]\.|vp09\.|mp4a\.|opus$)/.test(c));
  return ok ? { progressive: true, mime: `${type}; codecs="${codecs.join(',')}"` } : { progressive: false };
}

// Lecture progressive possible sur ce téléphone ? (selon la vidéo, voir progressiveReady)
export const canProgressive = () => Boolean(MS) && !mseOff;

// La vidéo peut-elle démarrer progressivement ? (null : on ne sait pas encore, premier morceau absent)
export function progressiveReady(v) {
  if (!MS || mseOff) return false;
  const e = v?.url && entries.get(v.url);
  if (!e?.info) return null;
  if (!e.info.progressive) return false;
  try {
    return MS.isTypeSupported(e.info.mime);
  } catch {
    return false;
  }
}

// Attend le premier morceau (au plus ms) pour savoir si la lecture progressive est possible
export async function progressiveCheck(v, ms = 1500) {
  if (!MS || mseOff || !v?.url || !v.size) return false;
  const e = want(v, PRIO.now, true);
  if (!e.info) await Promise.race([part(e, 0), sleep(ms)]);
  return progressiveReady(v) === true;
}

// Branche la vidéo sur le lecteur, morceau après morceau ; onFail si quelque chose coince
export function playProgressive(el, v, { onFail } = {}) {
  const e = want(v, PRIO.now, true);
  const ms = new MS();
  let stopped = false;
  el.disableRemotePlayback = true; // exigé sur iPhone pour la lecture progressive
  setSource(el, v, URL.createObjectURL(ms));
  const failNow = (err) => {
    if (stopped) return;
    stopped = true;
    onFail?.(err);
  };
  ms.addEventListener(
    'sourceopen',
    async () => {
      try {
        const sb = ms.addSourceBuffer(e.info.mime);
        if (e.duration) ms.duration = e.duration;
        for (let i = 0; i < e.n; i++) {
          const buf = await part(e, i);
          if (stopped || ms.readyState !== 'open') return;
          if (!buf) throw new Error('morceau indisponible');
          await new Promise((resolve, reject) => {
            const ok = () => (sb.removeEventListener('error', ko), resolve());
            const ko = () => (sb.removeEventListener('updateend', ok), reject(new Error('lecture progressive refusée')));
            sb.addEventListener('updateend', ok, { once: true });
            sb.addEventListener('error', ko, { once: true });
            sb.appendBuffer(buf);
          });
        }
        if (!stopped && ms.readyState === 'open') ms.endOfStream();
      } catch (err) {
        failNow(err);
      }
    },
    { once: true },
  );
  return {
    stop() {
      stopped = true;
    },
  };
}
