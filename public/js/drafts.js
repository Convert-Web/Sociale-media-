// Brouillons : une création (vidéo, photos ou texte, avec ses effets et réglages) est gardée sur cet
// appareil, dans sa base de données, pour être publiée plus tard. Rien n'est envoyé au serveur avant
// la publication. Chaque compte ne voit que ses propres brouillons.
import { store } from './store.js';

const DB = 'vibz-brouillons';
const STORE = 'drafts';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('Brouillons impossibles sur ce navigateur.'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
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
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error || new Error('Stockage du téléphone indisponible.'));
    t.onabort = () => reject(t.error?.name === 'QuotaExceededError' ? new Error('Plus assez de place sur le téléphone pour ce brouillon.') : t.error || new Error('Brouillon non enregistré.'));
  });
};
const owner = () => store.user?.id || 0;

// Enregistre (ou met à jour, si id est donné) un brouillon ; renvoie son identifiant
export async function saveDraft({ id = null, body = '', photos = [], video = null, meta = null }) {
  const record = {
    owner: owner(),
    body,
    photos: photos.map((f) => ({ blob: f, name: f.name || 'photo.jpg', type: f.type || 'image/jpeg' })),
    video: video ? { blob: video.file, name: video.file.name || 'video.mp4', type: video.file.type || 'video/mp4', poster: video.info?.poster || null, duration: video.info?.duration || 0 } : null,
    meta,
    updatedAt: Date.now(),
  };
  if (id) record.id = id;
  try {
    await navigator.storage?.persist?.(); // demande au téléphone de ne pas effacer cet espace
  } catch {
    /* facultatif */
  }
  return tx('readwrite', (s) => s.put(record));
}

// Brouillons du compte, les plus récents d'abord
export async function listDrafts() {
  try {
    const all = await tx('readonly', (s) => s.index('owner').getAll(owner()));
    return (all || []).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function countDrafts() {
  try {
    return (await tx('readonly', (s) => s.index('owner').count(owner()))) || 0;
  } catch {
    return 0;
  }
}

export async function getDraft(id) {
  const d = await tx('readonly', (s) => s.get(id));
  return d && d.owner === owner() ? d : null;
}

export async function deleteDraft(id) {
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    /* déjà retiré */
  }
}

// Fichiers du brouillon, prêts pour la fenêtre de publication
export const draftFiles = (d) => ({
  photos: (d.photos || []).map((p) => new File([p.blob], p.name, { type: p.type })),
  video: d.video ? new File([d.video.blob], d.video.name, { type: d.video.type }) : null,
});
