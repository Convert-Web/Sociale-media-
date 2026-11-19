// Préchargement : dès l'entrée dans l'application, les photos et les vidéos que l'on va voir
// se téléchargent en coulisse (priorité basse, sans gêner l'écran affiché). Les photos restent
// gardées par le téléphone (un an) ; les vidéos sont gardées en mémoire, prêtes à jouer.
// Rien n'est préchargé en mode « économie de données » ou sur une connexion très lente.
import { preloadVideo } from './components/video.js';

const thrifty = () => {
  const c = navigator.connection;
  return Boolean(c?.saveData) || /(^|-)2g$/.test(c?.effectiveType || '');
};

// Photos : quatre à la fois, chacune une seule fois
const seenImages = new Set();
const queue = [];
let active = 0;
function pump() {
  while (active < 4 && queue.length) {
    const url = queue.shift();
    active++;
    const img = new Image();
    img.decoding = 'async';
    try {
      img.fetchPriority = 'low';
    } catch {
      /* navigateur ancien */
    }
    const next = () => {
      active--;
      pump();
    };
    img.onload = next;
    img.onerror = next;
    img.src = url;
  }
}
export function warmImages(urls) {
  if (thrifty()) return;
  for (const u of urls) {
    if (!u || typeof u !== 'string' || seenImages.has(u)) continue;
    seenImages.add(u);
    queue.push(u);
  }
  pump();
}

// Vidéos : téléchargées en entier, une après l'autre (la première est prête en premier)
const seenVideos = new Set();
let chain = Promise.resolve();
export function warmVideos(videos, max = 6) {
  if (thrifty()) return;
  let n = 0;
  for (const v of videos) {
    if (n >= max) break;
    if (!v?.url || (v.expiresAt && v.expiresAt <= Date.now()) || seenVideos.has(v.url)) continue;
    seenVideos.add(v.url);
    n++;
    chain = chain.then(() => preloadVideo(v)).catch(() => {});
  }
}

// Publications : photos, aperçus des vidéos, photos de profil, images du Journal (+ vidéos si demandé)
export function warmPosts(posts, { videos = 0 } = {}) {
  const urls = [];
  for (const p of posts || []) {
    if (p.images) urls.push(...p.images);
    urls.push(p.video?.poster, p.author?.avatar, p.journal?.image);
  }
  warmImages(urls);
  if (videos) warmVideos((posts || []).map((p) => p.video).filter(Boolean), videos);
}
