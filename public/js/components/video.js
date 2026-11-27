// Vidéos : envoi de la vidéo d'origine (qualité maximale), en morceaux, et lecteur du fil.
import { api, ApiError } from '../api.js';
import { store } from '../store.js';
import { warmPosts } from '../warm.js';
import { h, icon, onTaps } from '../dom.js';

// Durée maximale d'une vidéo, fixée par le serveur (VIDEO_MAX_SECONDS, 3 minutes par défaut)
export const maxSeconds = () => store.config?.videoMaxSeconds || 180;
const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp'];
// Poids maximal d'une vidéo, fixé par le serveur (VIDEO_MAX_MB, 250 Mo par défaut)
export const maxVideoBytes = () => store.config?.videoMaxBytes || 250 * 1024 * 1024;
const megas = (n) => Math.ceil(n / 1048576);
const tooBig = (size) =>
  `Vidéo trop lourde (${megas(size)} Mo) : ${megas(maxVideoBytes())} Mo au maximum. Raccourcis-la, ou filme en 1080p.`;

export const isVideoFile = (f) => Boolean(f && (VIDEO_TYPES.includes(f.type) || String(f.type || '').startsWith('video/') || /\.(mp4|mov|qt|m4v|webm|3gp)$/i.test(f.name || '')));
export const clockLabel = (s) => {
  const t = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

const once = (el, ev) => new Promise((resolve, reject) => {
  const ok = () => { el.removeEventListener('error', ko); resolve(); };
  const ko = () => { el.removeEventListener(ev, ok); reject(new Error('Vidéo illisible sur cet appareil.')); };
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', ko, { once: true });
});
// Format annoncé au serveur : WebM, QuickTime (iPhone) ou MP4 (tout le reste de la famille MP4)
const fileMime = (f) => {
  const t = String(f.type || '').toLowerCase();
  if (t === 'video/webm' || /\.webm$/i.test(f.name || '')) return 'video/webm';
  if (t === 'video/quicktime' || /\.(mov|qt)$/i.test(f.name || '')) return 'video/quicktime';
  return 'video/mp4';
};

// ---------------------------------------------------------------------------
// Lecture fiable d'une vidéo du téléphone (iPhone compris) : chaque attente est bornée dans le
// temps, rien ne peut rester bloqué
// ---------------------------------------------------------------------------
const TIMEOUT = 'Délai dépassé.';
export const within = (p, ms) => Promise.race([Promise.resolve(p), new Promise((_, reject) => setTimeout(() => reject(new Error(TIMEOUT)), ms))]);

// Lecteur posé dans la page, invisible : Safari (iPhone) ne charge pas une vidéo hors de la page
export function hiddenVideo(src) {
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('muted', '');
  v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
  document.body.append(v);
  if (src) v.src = src;
  return v;
}

// Image de la vidéo vers l'instant t (JPEG), ou null si l'appareil n'en livre pas à temps
export async function grabFrame(v, t, { maxDim = 1440, budget = 7000 } = {}) {
  const end = Date.now() + budget;
  const left = (cap) => Math.max(150, Math.min(cap, end - Date.now()));
  const shoot = async (at) => {
    // Safari ne décode une image qu'après un début de lecture (muette : toujours permise)
    await within(v.play(), left(2500)).catch(() => {});
    v.pause();
    const target = Math.max(0, Math.min(at, (Number.isFinite(v.duration) ? v.duration : at) - 0.05));
    if (Math.abs(v.currentTime - target) > 0.04) {
      const seeked = once(v, 'seeked');
      v.currentTime = target;
      await within(seeked, left(3000)).catch(() => {});
    }
    if (v.readyState < 2) await within(once(v, 'loadeddata'), left(2000)).catch(() => {});
    if (!v.videoWidth || !v.videoHeight || v.readyState < 2) return null;
    const s = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * s);
    c.height = Math.round(v.videoHeight * s);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    // Image toute noire : souvent rien de décodé encore (ou un fondu au noir)
    const tiny = document.createElement('canvas');
    tiny.width = 8;
    tiny.height = 8;
    const tg = tiny.getContext('2d');
    tg.drawImage(c, 0, 0, 8, 8);
    const px = tg.getImageData(0, 0, 8, 8).data;
    let max = 0;
    for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2]);
    return { c, dark: max < 8 };
  };
  try {
    if (v.readyState < 1) await within(once(v, 'loadedmetadata'), left(4000));
    let shot = await shoot(t);
    if (shot?.dark && Date.now() < end - 1000) shot = (await shoot(Math.min(2, (v.duration || 2) * 0.3))) || shot;
    if (!shot) return null;
    return await within(new Promise((r) => shot.c.toBlob(r, 'image/jpeg', 0.9)), left(3000)).catch(() => null);
  } catch {
    return null;
  }
}

// En-tête d'un fichier MP4 / MOV (boîtes « moov », « mvhd », « tkhd ») : durée et dimensions à
// l'affichage (rotation des vidéos filmées en hauteur comprise), sans dépendre du lecteur
export async function probeMp4(file) {
  const read = async (start, len) => new DataView(await file.slice(start, start + len).arrayBuffer());
  const tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  let pos = 0;
  let moov = null;
  for (let i = 0; i < 64 && pos + 8 <= file.size; i++) {
    const hd = await read(pos, 16);
    if (hd.byteLength < 8) break;
    let size = hd.getUint32(0);
    let head = 8;
    if (size === 1 && hd.byteLength >= 16) {
      size = Number(hd.getBigUint64(8));
      head = 16;
    } else if (size === 0) {
      size = file.size - pos;
    }
    if (size < head) break;
    if (tag(hd, 4) === 'moov') {
      moov = { start: pos + head, end: Math.min(file.size, pos + size) };
      break;
    }
    pos += size;
  }
  if (!moov || moov.end - moov.start > 64 * 1048576) return null;
  const dv = await read(moov.start, moov.end - moov.start);
  let duration = 0;
  let width = 0;
  let height = 0;
  let codec = null;
  const walk = (start, end) => {
    let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o);
      let head = 8;
      if (size === 1) {
        size = Number(dv.getBigUint64(o + 8));
        head = 16;
      } else if (size === 0) {
        size = end - o;
      }
      if (size < head || o + size > end) break;
      const type = tag(dv, o + 4);
      const body = o + head;
      if (type === 'mvhd') {
        const v1 = dv.getUint8(body) === 1;
        const scale = dv.getUint32(body + (v1 ? 20 : 12));
        const dur = v1 ? Number(dv.getBigUint64(body + 24)) : dv.getUint32(body + 16);
        if (scale) duration = dur / scale;
      } else if (type === 'tkhd' && !width) {
        const m = body + (dv.getUint8(body) === 1 ? 52 : 40);
        const w = dv.getUint32(m + 36) / 65536;
        const hgt = dv.getUint32(m + 40) / 65536;
        if (w > 0 && hgt > 0) {
          const a = dv.getInt32(m) / 65536;
          const b = dv.getInt32(m + 4) / 65536;
          const quarter = Math.abs(Math.round((Math.atan2(b, a) * 180) / Math.PI)) % 180 === 90;
          width = Math.round(quarter ? hgt : w);
          height = Math.round(quarter ? w : hgt);
        }
      } else if (type === 'stsd' && !codec) {
        const format = tag(dv, body + 12);
        if (/^(avc|hvc|hev|vp0|av01|mp4v|dvh|apc|ap4)/.test(format)) codec = format;
      } else if (['trak', 'mdia', 'minf', 'stbl'].includes(type)) {
        walk(body, o + size);
      }
      o += size;
    }
  };
  walk(0, dv.byteLength);
  return duration > 0 || width ? { duration, width, height, codec } : null;
}

// Durée, dimensions et image d'aperçu (prise vers 0,5 s). La vidéo elle-même n'est jamais modifiée :
// elle sera publiée telle qu'elle a été filmée. Sur iPhone, l'en-tête du fichier donne la durée et
// les dimensions même si Safari tarde à ouvrir la vidéo ; l'aperçu est facultatif.
export async function readVideoInfo(file, { knownDuration = 0 } = {}) {
  if (file.size > maxVideoBytes()) throw new Error(tooBig(file.size));
  const webm = fileMime(file) === 'video/webm';
  const probe = webm ? null : await within(probeMp4(file), 8000).catch(() => null);
  const url = URL.createObjectURL(file);
  const v = hiddenVideo(url);
  try {
    let opened = true;
    try {
      await within(once(v, 'loadedmetadata'), 12000);
    } catch (err) {
      opened = false;
      if (!probe?.duration && !knownDuration) {
        throw new Error(err.message === TIMEOUT ? 'Cette vidéo ne s’ouvre pas sur cet appareil. Essaie un autre fichier, ou filme-la directement dans AURUM.' : 'Format de vidéo illisible sur cet appareil. Essaie une vidéo MP4 ou MOV.');
      }
    }
    // Vidéo enregistrée par un navigateur (WebM) : la durée n'est connue qu'après un saut à la fin
    if (opened && (!Number.isFinite(v.duration) || v.duration <= 0) && !probe?.duration) {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 3000);
        v.addEventListener('durationchange', function f() {
          if (Number.isFinite(v.duration) && v.duration > 0) {
            clearTimeout(t);
            v.removeEventListener('durationchange', f);
            resolve();
          }
        });
        try {
          v.currentTime = 1e9;
        } catch {
          resolve();
        }
      });
      try {
        v.currentTime = 0;
      } catch {
        /* sans importance */
      }
    }
    const measured = opened && Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const duration = measured || probe?.duration || knownDuration || 0;
    if (!duration) throw new Error('Durée de la vidéo illisible.');
    const info = {
      duration,
      width: (opened && v.videoWidth) || probe?.width || 0,
      height: (opened && v.videoHeight) || probe?.height || 0,
      poster: null,
      url,
      codec: probe?.codec || null,
    };
    if (opened) info.poster = await grabFrame(v, Math.min(0.5, duration / 2));
    return info;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  } finally {
    v.removeAttribute('src');
    try {
      v.load();
    } catch {
      /* déjà libérée */
    }
    v.remove();
  }
}

// Envoi d'un morceau de 1 Mo, avec reprise : jusqu'à 8 essais (~25 s), et attente du retour du
// réseau. Échec réseau : erreur « connexion » (l'envoi reprendra là où il s'est arrêté)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backOnline = () => (navigator.onLine === false ? new Promise((r) => addEventListener('online', r, { once: true })) : null);
// Un morceau, avec l'avancement octet par octet (le pourcentage bouge même sur une connexion lente)
function sendPart(url, part, onBytes) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('x-vibz', '1');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onBytes?.(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* réponse sans détail */
      }
      reject(new ApiError(xhr.status, data?.error || 'Envoi de la vidéo interrompu.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Connexion perdue pendant l’envoi.'));
    xhr.ontimeout = xhr.onerror;
    xhr.send(part);
  });
}

async function putChunk(id, i, part, onBytes) {
  for (let tries = 1; ; tries++) {
    try {
      await backOnline();
      await sendPart(`/api/videos/${id}/chunks/${i}`, part, onBytes);
      return;
    } catch (err) {
      onBytes?.(0); // ce morceau repart de zéro
      if (tries >= 8 || (err.status < 500 && err.status !== 0 && err.status !== 429)) throw err;
      await sleep(Math.min(4000, 700 * tries));
    }
  }
}

// Morceaux envoyés quatre à la fois ; onSent(i, octets) dès que le serveur a reçu un morceau
async function sendChunks(id, list, onSent, onPartial) {
  let failed = null;
  let next = 0;
  const partial = new Map(); // morceau en cours → octets déjà partis
  const report = () => onPartial?.([...partial.values()].reduce((a, b) => a + b, 0));
  const worker = async () => {
    while (!failed && next < list.length) {
      const { i, part } = list[next++];
      try {
        await putChunk(id, i, part, (bytes) => {
          partial.set(i, bytes);
          report();
        });
        partial.delete(i);
        onSent(i, part.size);
      } catch (err) {
        failed = failed || err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
  if (failed) throw failed;
}

function openUpload({ mime, size, info }) {
  const fd = new FormData();
  fd.append('mime', mime);
  fd.append('size', String(size));
  fd.append('duration', String(info.duration));
  if (info.width) fd.append('width', String(info.width));
  if (info.height) fd.append('height', String(info.height));
  if (info.poster) fd.append('poster', info.poster, 'apercu.jpg');
  return api.post('/api/videos', fd);
}

// Publie la vidéo D'ORIGINE, octet pour octet : aucune recompression, donc la qualité exacte du
// tournage. Elle part en morceaux de 1 Mo, quatre à la fois. L'envoi est reprenable : memo garde
// l'envoi ouvert sur le serveur et les morceaux déjà reçus ; après une coupure, seuls les morceaux
// manquants repartent. Renvoie la vidéo à joindre à la publication.
export async function uploadVideo(file, info, onStep, memo = {}) {
  if (file.size > maxVideoBytes()) throw new Error(tooBig(file.size));
  const t0 = Date.now();
  const mime = fileMime(file);
  // Fiche technique (diagnostic de l'administration si une vidéo lit mal) : rien de personnel
  const meta = memo.meta || (memo.meta = {
    methode: 'originale',
    appareil: navigator.userAgent.slice(0, 180),
    source: { type: file.type || mime, mo: +(file.size / 1048576).toFixed(1), largeur: info.width, hauteur: info.height, duree: +(info.duration || 0).toFixed(1) },
  });
  for (let fresh = false; ; fresh = true) {
    if (!memo.upload) {
      onStep?.('prepare', 0);
      const { id, chunkSize, chunks } = await openUpload({ mime, size: file.size, info });
      memo.upload = { id, chunkSize, chunks, sent: new Set() };
    }
    const up = memo.upload;
    const left = [];
    let done = 0;
    for (let i = 0; i < up.chunks; i++) {
      const part = file.slice(i * up.chunkSize, Math.min(file.size, (i + 1) * up.chunkSize));
      if (up.sent.has(i)) done += part.size;
      else left.push({ i, part });
    }
    onStep?.('upload', done / file.size);
    try {
      let inFlight = 0;
      await sendChunks(up.id, left, (i, n) => {
        up.sent.add(i);
        done += n;
        onStep?.('upload', (done + inFlight) / file.size);
      }, (bytes) => {
        inFlight = bytes;
        onStep?.('upload', Math.min(0.98, (done + inFlight) / file.size));
      });
      meta.secondes = Math.round((Date.now() - t0) / 100) / 10;
      if (memo.resumed) meta.reprises = memo.resumed;
      const { video } = await api.post(`/api/videos/${up.id}/complete`, { meta });
      memo.upload = null;
      return video;
    } catch (err) {
      if (!fresh && err.status === 404) {
        memo.upload = null; // envoi effacé du serveur entre-temps (plus de 6 h) : on en ouvre un neuf
        continue;
      }
      if (!fresh && err.status === 409) {
        up.sent.clear(); // un morceau manque au serveur : tout est renvoyé dans le même envoi
        continue;
      }
      if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
        api.del(`/api/videos/${up.id}`).catch(() => {}); // refus définitif : la place est libérée
        memo.upload = null;
      } else {
        memo.resumed = (memo.resumed || 0) + 1; // coupure : la reprise n'enverra que la suite
      }
      throw err;
    }
  }
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
    return h('div', { class: 'vp vp-gone' }, icon('clock'), h('span', null, 'Vidéo disparue'));
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
  let checking = false;
  // Lecture progressive ; au moindre souci (erreur, aucune image), retour à la lecture en ligne
  const startProgressive = () => {
    let shown = false;
    const fallback = () => {
      if (el.dataset.mode !== 'progressive') return;
      reportVideoIssue('lecture progressive abandonnée (Salon)', v, { rs: el.readyState, err: el.error?.code || null });
      disableProgressive();
      setSource(el, v, v.url);
      if (wanted && !userPaused) el.play().catch(() => {});
    };
    playProgressive(el, v, { onFail: fallback });
    el.addEventListener('loadeddata', () => (shown = true), { once: true });
    el.addEventListener('error', fallback, { once: true });
    setTimeout(() => !shown && el.readyState < 2 && fallback(), 4500);
  };
  const paintSound = () => soundBtn.replaceChildren(icon(el.muted ? 'mute' : 'sound'));
  const player = {
    // À l'approche de l'écran : téléchargement complet, puis source locale (lecture immédiate)
    near() {
      // Lecture progressive possible : le début suffit (démarrage immédiat, moins de données)
      if (canProgressive()) return preloadStart(v, PRIO.later);
      const job = preloadVideo(v);
      if (!job) return;
      job.then((local) => {
        if (local && (!el.getAttribute('src') || (el.paused && el.currentTime === 0 && el.getAttribute('src') !== local))) setSource(el, v, local);
        if (local && wanted && el.paused) player.auto();
      });
    },
    auto() {
      if (userPaused) return;
      wanted = true;
      if (el.dataset.mode === 'progressive') resumePreload(v); // la suite de la vidéo reprend
      if (!el.getAttribute('src') && !localVideo(v) && canProgressive()) {
        // Lecture progressive (comme le plein écran) ; premier morceau absent : on l'attend un peu
        const ready = progressiveReady(v);
        if (ready === null) {
          if (checking) return;
          checking = true;
          progressiveCheck(v).then((ok) => {
            checking = false;
            if (!wanted || userPaused || el.getAttribute('src')) return;
            if (ok) startProgressive();
            else setSource(el, v, v.url);
            player.auto();
          });
          return;
        }
        if (ready) startProgressive();
      }
      if (!el.getAttribute('src')) {
        const local = localVideo(v);
        // Téléchargement presque fini : l'aperçu reste affiché, la vidéo part dès qu'elle est là
        // (sans la télécharger une seconde fois) ; sinon lecture en ligne tout de suite
        if (!local && preloadEta(v) < 2.5) {
          const job = preloadVideo(v, { prio: PRIO.next });
          if (job) {
            const go = (url) => {
              if (!wanted || userPaused || el.getAttribute('src')) return;
              if (!url) cancelPreload(v);
              setSource(el, v, url || v.url);
              player.auto();
            };
            job.then(go);
            setTimeout(() => go(null), 3000); // au pire, en ligne au bout de 3 s
            return;
          }
        }
        if (!local) cancelPreload(v); // lue en ligne : pas un second téléchargement en parallèle
        setSource(el, v, local || v.url);
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
      if (el.dataset.mode === 'progressive') relaxPreload(v); // hors de l'écran : la suite attend
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
  el.addEventListener('error', () => el.getAttribute('src') && reportVideoIssue('erreur de lecture (Salon)', v, { mode: el.dataset.mode, err: el.error?.code || null, msg: String(el.error?.message || '').slice(0, 120) }));
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
let opened = false; // la liste « À suivre » ne sert qu'à l'ouverture de l'application

// « À suivre » : les prochaines vidéos de « Pour toi » (pas encore vues) sont notées sur le
// téléphone pendant qu'on regarde, et leurs morceaux y restent gardés (sw.js). À la prochaine
// ouverture, le fil démarre aussitôt sur elles, sans attendre le serveur ni le réseau.
const UPCOMING = 'vibz:a-suivre';
const UPCOMING_MAX = 12;
const UPCOMING_TTL = 24 * 3600 * 1000;
const fresh = (p) => p?.id && !(p.video?.expiresAt && p.video.expiresAt <= Date.now() + 3600e3);
export function saveUpcoming(posts) {
  if (!store.user) return;
  try {
    const list = (posts || []).filter(fresh).slice(0, UPCOMING_MAX);
    if (!list.length) localStorage.removeItem(UPCOMING);
    else localStorage.setItem(UPCOMING, JSON.stringify({ owner: store.user.id, at: Date.now(), posts: list }));
  } catch {
    /* stockage plein ou navigation privée : le fil démarrera par le serveur */
  }
}
function loadUpcoming() {
  try {
    const d = JSON.parse(localStorage.getItem(UPCOMING) || 'null');
    if (!d || d.owner !== store.user?.id || Date.now() - d.at > UPCOMING_TTL) return [];
    return (d.posts || []).filter(fresh);
  } catch {
    return [];
  }
}
export function clearUpcoming() {
  try {
    localStorage.removeItem(UPCOMING);
  } catch {
    /* rien à effacer */
  }
}

// Premières vidéos de « Pour toi » : à l'ouverture, celles notées « À suivre » (déjà sur le
// téléphone) ; sinon demandées au serveur dès l'ouverture : le fil démarre sans attendre
export function prefetchReels() {
  if (reelsLoading) return reelsLoading;
  if (!opened) {
    opened = true;
    const saved = loadUpcoming();
    if (saved.filter((p) => p.video).length >= 2) {
      reelsCache = { posts: saved, hasMore: true, at: Date.now() };
      warmPosts(saved, { videos: 4 });
      return Promise.resolve(reelsCache);
    }
  }
  const gen = reelsGen;
  reelsLoading = api
    .get('/api/feed/foryou')
    .then((d) => {
      if (gen !== reelsGen) return reelsCache;
      reelsCache = { posts: d.posts, hasMore: d.hasMore, at: Date.now() };
      warmPosts(d.posts, { videos: 4 });
      return reelsCache;
    })
    .catch(() => null)
    .finally(() => {
      reelsLoading = null;
    });
  return reelsLoading;
}
// Liste gardée 2 minutes, utilisée une seule fois ; une liste vide n'est jamais réutilisée
export function takeReels() {
  const c = reelsCache?.posts.length && Date.now() - reelsCache.at < 2 * 60 * 1000 ? reelsCache : null;
  reelsCache = null;
  return c;
}
export const pendingReels = () => reelsLoading;
// Une vidéo vient d'être publiée : la liste gardée d'avance est oubliée
export function forgetReels() {
  reelsCache = null;
  reelsGen += 1;
  reelsLoading = null;
}

let shared = null;
export function reelsPlayer() {
  if (!shared) {
    shared = noSave(h('video', { class: 'reel-video', playsinline: true, 'webkit-playsinline': '', preload: 'auto', loop: true }));
    shared.playsInline = true;
  }
  return shared;
}

// À appeler dans le geste : le lecteur est déverrouillé (son compris) pour la suite de la visite
export function unlockPlayer() {
  const v = reelsPlayer();
  if (v.dataset.unlocked) return;
  v.dataset.unlocked = '1';
  v.muted = !soundOn;
  if (!v.getAttribute('src')) setSource(v, null, '/img/unlock.mp4');
  const p = v.play();
  if (p) p.then(() => v.getAttribute('src') === '/img/unlock.mp4' && v.pause()).catch(() => {});
}

// ---------------------------------------------------------------------------
// Téléchargement des vidéos, morceau par morceau (1 Mo, gardés par le réseau de Vercel) :
// - une seule file pour toute l'application, le morceau le plus urgent d'abord : la vidéo à
//   l'écran, puis le DÉBUT des suivantes (2 Mo ≈ 8 secondes), puis la fin de la suivante ;
// - lecture progressive (comme TikTok) : la vidéo démarre dès son premier morceau et la suite
//   arrive pendant qu'elle joue (MediaSource) ; sinon, la vidéo est lue une fois entière sur
//   le téléphone, ou en ligne ;
// - au plus 6 vidéos gardées en mémoire ; rien d'avance en mode économie de données ;
// - une vidéo lourde (publiée en qualité d'origine) n'est jamais téléchargée en entier d'avance :
//   seul son début l'est (et sa fin si sa description y est), la suite arrive pendant la lecture.
// ---------------------------------------------------------------------------
const CHUNK = 1024 * 1024;
const PREFIX = 2; // morceaux du début téléchargés d'avance
const MAX_KEPT = 8;
const FULL_MAX = 25 * CHUNK; // au-delà, pas de téléchargement complet d'avance (sauf « Garder »)
const KEPT_BYTES = 160 * CHUNK; // place prise en mémoire par les vidéos téléchargées
const small = (v) => v.size <= FULL_MAX;
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
    let i = 0;
    while (i < limit && (e.parts[i] || e.flying.has(i))) i++;
    if (i >= limit) {
      // Début déjà là : la fin aussi si la description de la vidéo s'y trouve (lecture immédiate)
      const t = e.n - 1;
      if (e.all || !e.info?.tail || t < limit || e.parts[t] || e.flying.has(t)) continue;
      i = t;
    }
    const key = rank(e, i === e.n - 1 && !e.all ? 0 : i) * 1e9 + e.seq * 1e3 + i;
    if (key < bestKey) {
      bestKey = key;
      best = [e, i];
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

// Mémoire du téléphone : au plus 6 vidéos, et 160 Mo de vidéos téléchargées
const heldBytes = () => [...entries.values()].reduce((n, e) => n + (e.all || e.blob ? e.size : 0), 0);
function trim(keep) {
  if (entries.size <= MAX_KEPT && heldBytes() <= KEPT_BYTES) return;
  const inUse = new Set([...document.querySelectorAll('video')].map((el) => el.dataset.v || el.getAttribute('src')));
  const old = [...entries.values()]
    .filter((e) => e.key !== keep && !e.keep && e.prio !== PRIO.now && !e.flying.size && !inUse.has(e.key) && !inUse.has(e.url))
    .sort((a, b) => a.at - b.at);
  while ((entries.size > MAX_KEPT || heldBytes() > KEPT_BYTES) && old.length) {
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
  if (all && !e.all) {
    e.all = true;
    trim(e.key);
  }
  e.at = Date.now();
  pump();
  return e;
}

// Téléchargement complet d'une vidéo (lecture depuis le téléphone, « Garder ») ; prio : PRIO.now … PRIO.warm
export function preloadVideo(v, { force = false, prio = PRIO.later, keep = false } = {}) {
  // force : demande explicite, même en mode économie de données ; keep : « Garder » (téléchargée
  // jusqu'au bout, même si l'on passe à une autre vidéo)
  if (!v?.url || !v.size || (!force && saveData())) return null;
  // Vidéo lourde : son début seulement (elle se lit en ligne, la suite arrive pendant la lecture)
  if (!keep && !small(v)) {
    want(v, force ? PRIO.now : prio, false);
    return null;
  }
  const e = want(v, force ? PRIO.now : prio, true);
  if (keep) e.keep = true;
  return e.promise;
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

// Vidéo quittée avant la fin de son téléchargement : seul son début reste voulu (données
// économisées) ; reprise complète si on y revient
export function relaxPreload(v) {
  const e = v?.url && entries.get(v.url);
  if (!e || e.keep || e.state === 'ready' || e.state === 'failed') return;
  e.all = false;
  if (e.prio === PRIO.now) e.prio = PRIO.later;
}
export function resumePreload(v) {
  if (v?.url && v.size) want(v, PRIO.now, true); // lecture progressive : la suite est nécessaire
}

// Octets déjà reçus pour une vidéo (pour savoir si son téléchargement avance encore)
export function downloadedBytes(v) {
  const e = v?.url && entries.get(v.url);
  return !e ? 0 : e.state === 'ready' ? e.size : e.got;
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

// Lecture en ligne : assemblée par le téléphone (sw.js) à partir des morceaux gardés par le réseau
// de Vercel. Si un appareil coince sur ce chemin, la vidéo repart aussitôt par le serveur
// (« ?direct=1 »), et ce téléphone garde ce choix trois jours.
const DIRECT = 'vibz:video-direct';
let direct = (() => {
  try {
    return Number(localStorage.getItem(DIRECT) || 0) > Date.now();
  } catch {
    return false;
  }
})();
function directFallback(ev) {
  const el = ev.currentTarget;
  const url = el.dataset.v;
  if (el.dataset.mode !== 'en-ligne' || !url || el.getAttribute('src') !== url || !navigator.serviceWorker?.controller) return;
  if (el.error?.code === 3) return; // image illisible par cet appareil : le chemin n'y est pour rien
  direct = true;
  try {
    localStorage.setItem(DIRECT, String(Date.now() + 3 * 24 * 3600 * 1000));
  } catch {
    /* pour cette visite seulement */
  }
  reportVideoIssue('lecture en ligne par le téléphone abandonnée', { url }, { err: el.error?.code || null });
  const at = el.currentTime;
  el.src = `${url}?direct=1`;
  if (at > 0.5) el.addEventListener('loadedmetadata', () => (el.currentTime = at), { once: true });
  el.play().catch(() => {});
}

// Source d'un lecteur : on note quelle vidéo il lit (quelle que soit la forme de l'adresse)
export function setSource(el, v, src) {
  el.dataset.v = v?.url || '';
  const online = Boolean(v) && src === v.url;
  // Mode de lecture (utile pour comprendre un souci) : téléphone, progressive ou en ligne
  el.dataset.mode = !v ? '' : online ? 'en-ligne' : src === localVideo(v) ? 'telephone' : 'progressive';
  if (!el.__direct) {
    el.__direct = true;
    el.addEventListener('error', directFallback);
  }
  el.src = online && direct ? `${src}?direct=1` : src;
}
// La même vidéo, qu'elle soit lue en ligne, depuis le téléphone ou progressivement ?
export const sameVideo = (el, v) => Boolean(el.getAttribute('src') && el.dataset.v && el.dataset.v === v?.url);

// ---------------------------------------------------------------------------
// Lecture progressive (MediaSource ; ManagedMediaSource sur iPhone, iOS 17.1 et plus).
// Possible pour les vidéos au format « fragmenté » (enregistrées par un navigateur). En cas de
// souci sur un téléphone, elle est coupée pour quelques jours et la lecture classique reprend.
// ---------------------------------------------------------------------------
const MS = typeof window !== 'undefined' ? window.ManagedMediaSource || window.MediaSource : null;
const MSE_OFF = 'vibz:mse-off';
let mseOff = (() => {
  try {
    return Number(localStorage.getItem(MSE_OFF) || 0) > Date.now();
  } catch {
    return false;
  }
})();
const reported = new Set();
export function reportVideoIssue(kind, v, detail = {}) {
  const key = `${kind}:${v?.url}`;
  if (reported.has(key) || reported.size > 20) return;
  reported.add(key);
  const id = idOf(v);
  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'x-vibz': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ message: `Vidéo : ${kind}`, stack: JSON.stringify({ video: id, ...detail }).slice(0, 900), path: '/videos' }),
    keepalive: true,
  }).catch(() => {});
}
const idOf = (v) => /\/media\/v\/([a-f0-9]{32})/.exec(v?.url || '')?.[1] || null;

// Import impossible : signalé à l'administration (format, poids, étape, message), sans le fichier
export function reportImportIssue(file, step, err) {
  const detail = {
    etape: step,
    type: file?.type || '(vide)',
    extension: /\.([a-z0-9]{1,5})$/i.exec(file?.name || '')?.[1]?.toLowerCase() || null,
    mo: file ? +(file.size / 1048576).toFixed(1) : null,
    erreur: String(err?.message || err || '').slice(0, 200),
  };
  fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'x-vibz': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ message: `Import vidéo : ${detail.erreur || step}`.slice(0, 300), stack: JSON.stringify(detail).slice(0, 900), path: '/creer', version: store.config?.version || '' }),
    keepalive: true,
  }).catch(() => {});
}

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
  // tail : description (« moov ») placée en fin de fichier, comme souvent dans une vidéo d'origine
  return ok ? { progressive: true, mime: `${type}; codecs="${codecs.join(',')}"` } : { progressive: false, tail: !moov };
}

// Appareils Apple (iPhone, iPad, Safari) : lecteur natif, le plus fiable chez eux. La lecture
// progressive (MediaSource) n'est utilisée que sur Android et ordinateur (Chrome, Edge, Firefox).
const appleDevice = typeof navigator !== 'undefined' && /^Apple/.test(navigator.vendor || '');
// Lecture progressive possible sur ce téléphone ? (selon la vidéo, voir progressiveReady)
export const canProgressive = () => Boolean(MS) && !mseOff && !appleDevice;

// La vidéo peut-elle démarrer progressivement ? (null : on ne sait pas encore, premier morceau absent)
export function progressiveReady(v) {
  if (!canProgressive()) return false;
  const e = v?.url && entries.get(v.url);
  if (!e?.info) return null;
  if (!e.info.progressive) return false;
  try {
    return MS.isTypeSupported(e.info.mime);
  } catch {
    return false;
  }
}

// Attend le premier morceau pour savoir si la lecture progressive est possible. Il est demandé en
// priorité absolue : l'attendre est bien plus rapide que de tout reprendre en ligne (au plus 8 s,
// par sécurité ; téléchargement impossible : lecture en ligne)
export async function progressiveCheck(v, ms = 8000) {
  if (!canProgressive() || !v?.url || !v.size) return false;
  const e = want(v, PRIO.now, small(v)); // vidéo lourde : rien de plus que son début pour l'instant
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
