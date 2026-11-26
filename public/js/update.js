// Mises à jour automatiques, sans bouton. Les fichiers de l'application sont gardés sur le téléphone
// (ouverture instantanée) ; l'application cherche sans cesse une nouvelle version : au démarrage,
// toutes les minutes tant qu'elle est ouverte, à chaque retour, au retour du réseau, et aussitôt
// qu'une réponse du serveur annonce une autre version.
// Une nouvelle version est d'abord téléchargée en arrière-plan par le service worker (l'écran ouvert
// continue avec l'ancienne), puis elle prend sa place d'un bloc, jamais un mélange des deux, à un
// moment où l'on ne s'en aperçoit pas :
// - quand l'application passe en arrière-plan (autre application, téléphone verrouillé) ;
// - à l'ouverture ou au retour, tant qu'on n'a encore rien touché ;
// - au prochain changement d'écran : l'écran demandé s'ouvre directement dans la nouvelle version.
// Jamais pendant l'envoi d'une vidéo, à la caméra ou au montage, dans un LIVE, ni pendant qu'on écrit.
import { store } from './store.js';
import { uploading } from './components/uploads.js';

const CACHE = 'vibz-app'; // même nom que dans sw.js
const EVERY = 60 * 1000;
const FRESH = 8000; // ouverture ou retour : la mise à jour se fait d'elle-même tant qu'on n'a rien touché
const TRIES = 'vibz:update-try';

let started = false;
let startVersion = null; // version servie au chargement (sans service worker)
let pending = null; // nouvelle version repérée
let ready = false; // la nouvelle version peut prendre la place (téléchargée d'avance, ou rechargement direct)
let direct = false; // pas de téléchargement d'avance possible : les fichiers gardés partent, la relance charge tout
let preparingFor = null;
let applying = false;
let lastCheck = 0;
let checking = false;
let freshUntil = 0;

const controlled = () => Boolean(navigator.serviceWorker?.controller) && 'caches' in window;

async function serverVersion() {
  const res = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
  if (!res.ok) return null;
  const { version } = await res.json();
  return typeof version === 'string' && version ? version : null;
}

// Version des fichiers gardés sur le téléphone (notée par l'application ou le service worker)
async function keptVersion(current) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match('/__version');
  if (hit) return hit.text();
  // Rien de noté : les fichiers viennent d'être chargés depuis le serveur, ils sont à jour
  await cache.put('/__version', new Response(current));
  return current;
}

export async function checkForUpdate() {
  if (checking || applying || navigator.onLine === false) return false;
  checking = true;
  lastCheck = Date.now();
  try {
    const latest = await serverVersion();
    if (!latest) return false;
    const mine = controlled() ? await keptVersion(latest) : startVersion;
    if (mine && mine !== latest) {
      if (pending !== latest) {
        pending = latest;
        ready = false;
        direct = false;
      }
      prepare(latest);
    }
    return Boolean(pending);
  } catch {
    return false;
  } finally {
    checking = false;
  }
}

// Téléchargement de la nouvelle version par le service worker, à part : « started » arrive tout de
// suite, puis le résultat. Un ancien service worker ne répond pas : on se passe de lui.
function prepareInWorker(version) {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.resolve('direct');
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    let acked = false;
    const noAck = setTimeout(() => !acked && resolve('direct'), 4000);
    const tooLong = setTimeout(() => resolve('failed'), 2 * 60 * 1000);
    ch.port1.onmessage = (e) => {
      if (e.data?.state === 'started') {
        acked = true;
        return;
      }
      clearTimeout(noAck);
      clearTimeout(tooLong);
      resolve(e.data?.ok ? 'ready' : 'failed');
    };
    sw.postMessage({ type: 'prepare-update', version }, [ch.port2]);
  });
}

async function prepare(version) {
  if (preparingFor === version || (ready && pending === version)) return;
  preparingFor = version;
  const result = controlled() ? await prepareInWorker(version) : 'direct';
  if (pending !== version) return;
  preparingFor = null;
  if (result === 'failed') return; // nouvel essai à la prochaine vérification
  ready = true;
  direct = result === 'direct';
  moment(document.visibilityState === 'hidden' ? 'hidden' : 'fresh');
}

// Rien en cours qu'un rechargement ferait perdre
function writing() {
  const a = document.activeElement;
  if (a && (a.isContentEditable || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|file|color)$/.test(a.type)))) return true;
  return [...document.querySelectorAll('textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"]')]
    .some((el) => (el.value ?? el.textContent ?? '').trim() && el.getClientRects().length > 0);
}
function isSafe() {
  if (uploading()) return false; // envoi d'une vidéo en cours
  if (/^\/(creer|live\/[^/]+)/.test(location.pathname)) return false; // caméra, montage, LIVE
  if (writing()) return false;
  if (navigator.onLine === false && !(ready && !direct)) return false; // sans réseau : seulement si tout est déjà là
  return true;
}

// Garde-fou : deux essais au plus par version et par visite (jamais de relances en boucle)
function tries(version) {
  try {
    const [v, n] = (sessionStorage.getItem(TRIES) || '').split('|');
    return v === version ? Number(n) || 0 : 0;
  } catch {
    return 0;
  }
}

function moment(kind) {
  if (!pending || applying || tries(pending) >= 2 || !isSafe()) return false;
  if (kind !== 'hidden') {
    if (!ready) return false;
    if (kind === 'fresh' && Date.now() > freshUntil) return false;
  }
  apply();
  return true;
}

// Au changement d'écran (appelé par app.js) : vrai si la nouvelle version se charge à la place
export const updateOnNavigation = () => moment('navigate');

async function apply() {
  if (applying) return;
  applying = true;
  const n = tries(pending);
  try {
    sessionStorage.setItem(TRIES, `${pending}|${n + 1}`);
  } catch {
    /* navigation privée */
  }
  try {
    // Version téléchargée d'avance : le service worker la met en place au rechargement. Sinon (ou au
    // second essai), les fichiers gardés partent d'un bloc et le rechargement charge tout du serveur.
    if (controlled() && (!ready || direct || n > 0)) await caches.delete(CACHE);
  } catch {
    /* le rechargement suffit */
  }
  location.reload();
}

// Le service worker vérifie aussi sa propre nouvelle version (au plus toutes les 5 minutes)
let swCheckedAt = 0;
function refreshServiceWorker() {
  if (Date.now() - swCheckedAt < 5 * 60 * 1000) return;
  swCheckedAt = Date.now();
  navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});
}

const markFresh = () => {
  freshUntil = Date.now() + FRESH;
};

// Démarrage : appelé une fois l'application lancée
export function startUpdateChecks() {
  if (started) return;
  started = true;
  startVersion = store.config?.version || null;
  markFresh();
  const check = (guard = 10 * 1000) => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < guard) return;
    checkForUpdate();
    refreshServiceWorker();
  };
  setTimeout(() => checkForUpdate(), 1200);
  setInterval(() => check(0), EVERY);
  // Arrière-plan : le bon moment ; retour (iPhone : l'application reste en mémoire) : on vérifie
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      moment('hidden');
      return;
    }
    markFresh();
    check();
    moment('fresh');
  });
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    markFresh();
    check();
  });
  addEventListener('focus', () => check());
  addEventListener('online', () => setTimeout(() => checkForUpdate(), 1500));
  // Le serveur annonce une autre version dans une réponse ordinaire : on vérifie tout de suite
  addEventListener('vibz:version', () => {
    lastCheck = 0;
    checkForUpdate();
    swCheckedAt = 0;
    refreshServiceWorker();
  });
  // Le moindre geste met fin au moment « on vient d'ouvrir »
  for (const ev of ['pointerdown', 'touchstart', 'keydown', 'wheel']) {
    addEventListener(ev, () => (freshUntil = 0), { capture: true, passive: true });
  }
}
