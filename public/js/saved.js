// Vidéos enregistrées sur le téléphone : une copie complète (vidéo, aperçu, auteur, texte) est
// gardée dans l'application (base de données de l'appareil). Elle reste dans « Enregistrés »
// même après l'effacement de la vidéo du cercle, 24 heures après sa publication.
// La copie ne quitte pas l'application : elle n'est visible que par la personne qui l'a enregistrée.
import { store } from './store.js';
import { preloadVideo, videoBlob } from './components/video.js';

const DB = 'aurum-enregistres';
const STORE = 'videos';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Enregistrement impossible sur ce navigateur.'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'key' });
      s.createIndex('owner', 'owner');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Stockage du téléphone indisponible.'));
  }).catch((err) => {
    dbp = null;
    throw err;
  });
  return dbp;
}

const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error || new Error('Stockage du téléphone indisponible.'));
    t.onabort = () => reject(t.error || new Error('Espace insuffisant sur le téléphone.'));
  });
};
const keyOf = (postId) => `${store.user?.id || 0}:${postId}`;

// Les vidéos enregistrées de ce membre (les plus récentes d'abord)
export async function savedVideos() {
  try {
    const all = await tx('readonly', (s) => s.index('owner').getAll(store.user?.id || 0));
    return (all || []).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function isSavedLocally(postId) {
  try {
    return Boolean(await tx('readonly', (s) => s.getKey(keyOf(postId))));
  } catch {
    return false;
  }
}

export async function removeSavedVideo(postId) {
  try {
    await tx('readwrite', (s) => s.delete(keyOf(postId)));
  } catch {
    /* rien à retirer */
  }
}

const asBlob = async (url) => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Téléchargement de la vidéo impossible.');
  return res.blob();
};

// Garde une copie complète de la vidéo d'une publication sur le téléphone
export async function saveVideoLocally(post) {
  const v = post.video;
  if (!v?.url) return false;
  // Le téléphone l'a peut-être déjà (préchargement) ; sinon on la télécharge en entier
  let video = videoBlob(v);
  if (!video) {
    await preloadVideo(v, { force: true });
    video = videoBlob(v);
  }
  if (!video) throw new Error('Téléchargement de la vidéo impossible. Vérifiez votre connexion.');
  const poster = v.poster ? await asBlob(v.poster).catch(() => null) : null;
  try {
    await navigator.storage?.persist?.(); // demande au téléphone de ne pas effacer cet espace
  } catch {
    /* facultatif */
  }
  await tx('readwrite', (s) =>
    s.put({
      key: keyOf(post.id),
      owner: store.user?.id || 0,
      postId: post.id,
      savedAt: Date.now(),
      video,
      poster,
      meta: {
        body: post.body || '',
        createdAt: post.createdAt,
        width: v.width || null,
        height: v.height || null,
        duration: v.duration || null,
        author: { displayName: post.author.displayName, username: post.author.username, avatar: post.author.avatar || null, verified: Boolean(post.author.verified) },
      },
    }),
  );
  return true;
}

// Enregistrer / retirer une publication (Salon, coin Vidéos). Une vidéo est aussi gardée en
// entier sur le téléphone ; la retirer supprime cette copie.
export async function toggleSaved(post, { onChange } = {}) {
  const { api } = await import('./api.js');
  const { toast } = await import('./dom.js');
  const was = post.saved;
  post.saved = !was;
  onChange?.(post.saved);
  try {
    if (was) {
      await api.del(`/api/posts/${post.id}/save`).catch((err) => {
        if (err.status !== 404) throw err; // publication déjà effacée : on retire juste la copie
      });
      if (post.video) await removeSavedVideo(post.id);
      toast(post.video ? 'Vidéo retirée de votre téléphone.' : 'Retiré de vos enregistrements.');
    } else {
      await api.post(`/api/posts/${post.id}/save`);
      if (post.video) {
        // Message d'attente seulement si le téléchargement dure un peu
        const wait = setTimeout(() => toast('Enregistrement de la vidéo sur votre téléphone…'), 700);
        try {
          await saveVideoLocally(post);
        } finally {
          clearTimeout(wait);
        }
        toast('Vidéo gardée sur votre téléphone : retrouvez-la dans Enregistrés, même après 24 h.');
      } else toast('Enregistré.');
    }
    store.emit('saved:changed', { id: post.id, saved: post.saved });
  } catch (err) {
    // Copie impossible (espace du téléphone…) : on n'enregistre pas à moitié
    if (!was) await api.del(`/api/posts/${post.id}/save`).catch(() => {});
    post.saved = was;
    onChange?.(was);
    toast(err.message || 'Enregistrement impossible.', 'error');
  }
}
