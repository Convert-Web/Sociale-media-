// Montage dans le navigateur, sans serveur : les vidéos sont rejouées dans un canevas, image par
// image, et les sons mélangés par la carte audio ; l'enregistreur du navigateur en fait un nouveau
// fichier. Sert à ajouter un son à une vidéo importée, à monter un Duo (côte à côte) et un Stitch
// (un extrait de l'originale, puis la suite). Le montage dure le temps de la vidéo.
import { videoBlob, hiddenVideo, grabFrame, within } from './video.js';

const CHUNK = 1024 * 1024;

// Format d'enregistrement : MP4 (lu partout) si le navigateur sait le produire, sinon WebM
export function recorderMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return list.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
}
export const extFor = (mime) => (String(mime).includes('mp4') ? 'mp4' : 'webm');

// Fichier complet d'une vidéo publiée : déjà téléchargé, sinon assemblé morceau par morceau
export async function loadVideoBlob(video, onProgress) {
  const cached = videoBlob(video);
  if (cached) return cached;
  const n = Math.max(1, Math.ceil((video.size || 1) / CHUNK));
  const base = video.url.replace(/\.(mp4|webm)$/, '');
  const parts = [];
  for (let i = 0; i < n; i++) {
    const r = await fetch(`${base}/${i}.bin`);
    if (!r.ok) throw new Error('Téléchargement de la vidéo d’origine impossible.');
    parts.push(await r.blob());
    onProgress?.((i + 1) / n);
  }
  return new Blob(parts, { type: video.url.endsWith('.webm') ? 'video/webm' : 'video/mp4' });
}

// Lecteur pour le montage. Les vidéos sont posées dans la page (invisibles) : Safari (iPhone) ne
// décode pas une vidéo hors de la page. release() les retire une fois le montage fini.
export function mediaFor(src, { video = true } = {}) {
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  let el;
  if (video) {
    el = hiddenVideo(null);
    el.muted = false;
    el.defaultMuted = false;
    el.removeAttribute('muted');
  } else {
    el = document.createElement('audio');
    el.preload = 'auto';
  }
  el.crossOrigin = 'anonymous';
  el.src = url;
  return el;
}
// Le même lecteur, affiché à l'écran (Duo, Stitch) : il quitte son emplacement invisible
export function onScreen(el) {
  el.style.cssText = '';
  return el;
}
export function release(...els) {
  for (const el of els) {
    if (!el) continue;
    try {
      el.pause();
    } catch {
      /* déjà arrêté */
    }
    if (String(el.src).startsWith('blob:')) URL.revokeObjectURL(el.src);
    el.remove();
  }
}

// Prêt à être lu. Sur iPhone, le chargement ne démarre souvent qu'à la lecture : un début de
// lecture muette le déclenche. Jamais d'attente sans fin.
export const ready = (el, ms = 15000) =>
  new Promise((resolve, reject) => {
    if (el.readyState >= 2) return resolve();
    let kick = 0;
    let limit = 0;
    const ok = () => {
      cleanup();
      resolve();
    };
    const ko = (msg) => {
      cleanup();
      reject(new Error(typeof msg === 'string' ? msg : 'Média illisible sur cet appareil.'));
    };
    const cleanup = () => {
      clearTimeout(kick);
      clearTimeout(limit);
      el.removeEventListener('canplay', ok);
      el.removeEventListener('loadeddata', ok);
      el.removeEventListener('error', ko);
    };
    el.addEventListener('canplay', ok);
    el.addEventListener('loadeddata', ok);
    el.addEventListener('error', ko);
    kick = setTimeout(() => {
      const muted = el.muted;
      el.muted = true;
      el.play?.().then(() => {
        el.pause();
        el.muted = muted;
      }).catch(() => (el.muted = muted));
    }, 1200);
    limit = setTimeout(() => (el.readyState >= 1 ? ok() : ko('Ce média met trop de temps à s’ouvrir sur cet appareil.')), ms);
    if (el.readyState === 0 && el.networkState === 0) el.load?.();
  });

async function seek(el, t) {
  if (Math.abs(el.currentTime - t) < 0.05) return;
  await new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('seeked', done);
      resolve();
    };
    el.addEventListener('seeked', done);
    el.currentTime = t;
    setTimeout(done, 1500);
  });
}

// Dessine un média en remplissant la zone (recadré au centre, comme « cover »)
export function drawCover(g, el, x, y, w, hgt) {
  const vw = el.videoWidth || w;
  const vh = el.videoHeight || hgt;
  if (!vw || !vh) return;
  const s = Math.max(w / vw, hgt / vh);
  const sw = w / s;
  const sh = hgt / s;
  g.drawImage(el, (vw - sw) / 2, (vh - sh) / 2, sw, sh, x, y, w, hgt);
}
// … ou en l'affichant entier (bandes noires si besoin)
export function drawContain(g, el, x, y, w, hgt) {
  const vw = el.videoWidth || w;
  const vh = el.videoHeight || hgt;
  if (!vw || !vh) return;
  const s = Math.min(w / vw, hgt / vh);
  const dw = vw * s;
  const dh = vh * s;
  g.drawImage(el, x + (w - dw) / 2, y + (hgt - dh) / 2, dw, dh);
}

// scenes : [{ duration, media: [{ el, volume, from }], draw(g, t) }]
// ac : contexte audio créé pendant le toucher de l'utilisateur (obligatoire sur iPhone)
export async function render(opts) {
  try {
    return await renderScenes(opts);
  } finally {
    release(...new Set(opts.scenes.flatMap((s) => s.media.map((m) => m.el))));
  }
}
async function renderScenes({ width, height, scenes, ac, onProgress, bitrate = 6_000_000 }) {
  const mime = recorderMime();
  if (mime === null) throw new Error('Ce navigateur ne sait pas enregistrer de vidéo. Essaie avec Chrome, Edge, Firefox ou Safari récent.');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  if (!canvas.captureStream) throw new Error('Montage impossible sur ce navigateur.');
  const g = canvas.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, width, height);
  const dest = ac.createMediaStreamDestination();
  const wired = new Set();
  for (const s of scenes) {
    for (const m of s.media) {
      await ready(m.el);
      if (wired.has(m.el)) continue;
      wired.add(m.el);
      const gain = ac.createGain();
      gain.gain.value = m.volume ?? 1;
      ac.createMediaElementSource(m.el).connect(gain).connect(dest);
      m.el.muted = false;
    }
  }
  if (ac.state === 'suspended') await ac.resume().catch(() => {});
  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: bitrate, audioBitsPerSecond: 128000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  const total = scenes.reduce((n, s) => n + s.duration, 0) || 1;
  let elapsed = 0;
  for (const s of scenes) {
    for (const m of s.media) await seek(m.el, m.from || 0);
  }
  rec.start(1000);
  for (const s of scenes) {
    for (const m of s.media) await seek(m.el, m.from || 0);
    await Promise.all(s.media.map((m) => m.el.play().catch(() => {})));
    await new Promise((resolve) => {
      const t0 = performance.now();
      const frame = () => {
        const t = (performance.now() - t0) / 1000;
        s.draw(g, t);
        onProgress?.(Math.min(1, (elapsed + Math.min(t, s.duration)) / total));
        if (t >= s.duration) {
          for (const m of s.media) m.el.pause();
          resolve();
          return;
        }
        // Onglet en arrière-plan : les images continuent (plus lentement)
        if (document.hidden) setTimeout(frame, 33);
        else requestAnimationFrame(frame);
      };
      frame();
    });
    elapsed += s.duration;
  }
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
  return new File([new Blob(chunks, { type })], `vibz-${Date.now()}.${extFor(type)}`, { type });
}

const evenSize = (w, hgt, max = 1280) => {
  const s = Math.min(1, max / Math.max(w, hgt));
  return { width: Math.round((w * s) / 2) * 2, height: Math.round((hgt * s) / 2) * 2 };
};

// Une vidéo et un son ajouté (volumes réglables)
export async function mixSound({ file, soundUrl, duration, volumes = { original: 1, sound: 1 }, ac, onProgress }) {
  const v = mediaFor(file);
  const a = mediaFor(soundUrl, { video: false });
  await ready(v);
  const { width, height } = evenSize(v.videoWidth || 720, v.videoHeight || 1280);
  const d = Math.min(duration || v.duration, Number.isFinite(a.duration) && a.duration > 0 ? Math.max(duration || v.duration, 0) : 9999);
  return render({
    width,
    height,
    ac,
    onProgress,
    scenes: [{ duration: d, media: [{ el: v, volume: volumes.original }, { el: a, volume: volumes.sound }], draw: (g) => drawContain(g, v, 0, 0, width, height) }],
  });
}

// Duo : sa vidéo à gauche, l'originale à droite, sons mélangés
export async function duet({ camFile, originalBlob, duration, ac, onProgress }) {
  const cam = mediaFor(camFile);
  const orig = mediaFor(originalBlob);
  const width = 720;
  const height = 640;
  return render({
    width,
    height,
    ac,
    onProgress,
    scenes: [{
      duration,
      media: [{ el: cam, volume: 1 }, { el: orig, volume: 0.9 }],
      draw: (g) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, width, height);
        drawCover(g, cam, 0, 0, width / 2 - 1, height);
        drawCover(g, orig, width / 2 + 1, 0, width / 2 - 1, height);
      },
    }],
  });
}

// Stitch : un extrait de l'originale (5 s au plus), puis sa propre vidéo
export async function stitch({ originalBlob, from, length, camFile, camDuration, ac, onProgress }) {
  const orig = mediaFor(originalBlob);
  const cam = mediaFor(camFile);
  await ready(cam);
  const { width, height } = evenSize(cam.videoWidth || 720, cam.videoHeight || 1280);
  return render({
    width,
    height,
    ac,
    onProgress,
    scenes: [
      { duration: length, media: [{ el: orig, volume: 1, from }], draw: (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, width, height); drawContain(g, orig, 0, 0, width, height); } },
      { duration: camDuration, media: [{ el: cam, volume: 1 }], draw: (g) => drawContain(g, cam, 0, 0, width, height) },
    ],
  });
}

// Image d'une vidéo à un instant donné (couverture)
export async function frameAt(file, t, { maxDim = 1080 } = {}) {
  const v = hiddenVideo(URL.createObjectURL(file));
  try {
    await within(ready(v), 15000);
    const blob = await grabFrame(v, t, { maxDim, budget: 8000 });
    if (!blob) throw new Error('Image impossible à prendre sur cet appareil : la couverture reste celle du début.');
    return blob;
  } finally {
    release(v);
  }
}
