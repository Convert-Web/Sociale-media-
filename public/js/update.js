// Mises à jour de l'application. Les fichiers de l'application sont gardés sur le téléphone (ouverture
// instantanée) : quand une nouvelle version est en ligne, un bouton bleu clair « Mettre à jour »
// apparaît. Un toucher remplace les fichiers gardés par ceux de la nouvelle version et relance
// l'application, à l'endroit où l'on était.
// Vérification : au démarrage, à chaque retour dans l'application, au retour du réseau, toutes les
// 2 minutes tant qu'elle est ouverte, et aussitôt qu'une réponse du serveur annonce une autre version.
import { h, icon, toast } from './dom.js';
import { store } from './store.js';
import { uploading } from './components/uploads.js';

const CACHE = 'vibz-app'; // même nom que dans sw.js
const EVERY = 2 * 60 * 1000;
const AGAIN_AFTER = 30 * 60 * 1000; // « Plus tard » : le bouton revient au bout de 30 minutes

let started = false;
let startVersion = null; // version servie au chargement (page non gardée sur le téléphone)
let available = false;
let hiddenAt = 0;
let lastCheck = 0;
let checking = false;
let busy = false;
let pill = null;
let label = null;

const controlled = () => Boolean(navigator.serviceWorker?.controller) && 'caches' in window;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (checking || busy || navigator.onLine === false) return false;
  checking = true;
  lastCheck = Date.now();
  try {
    const latest = await serverVersion();
    if (!latest) return false;
    const mine = controlled() ? await keptVersion(latest) : startVersion;
    if (mine && mine !== latest) {
      available = true;
      if (!hiddenAt || Date.now() - hiddenAt > AGAIN_AFTER) showButton();
    }
    return available;
  } catch {
    return false;
  } finally {
    checking = false;
  }
}

function showButton() {
  hiddenAt = 0;
  if (!pill) {
    label = h('span', null, 'Mettre à jour');
    pill = h(
      'div',
      { class: 'update-pill', role: 'status', 'aria-live': 'polite' },
      h('button', { type: 'button', class: 'update-go', onclick: applyUpdate, title: 'Une nouvelle version de Vibz est prête' }, icon('refresh', 'icon-sm'), label),
      h('button', { type: 'button', class: 'update-later', 'aria-label': 'Plus tard', onclick: later }, icon('x', 'icon-xs')),
    );
  }
  if (!pill.isConnected) document.body.append(pill);
  document.documentElement.classList.add('has-update');
}

function later() {
  hiddenAt = Date.now();
  pill?.remove();
  document.documentElement.classList.remove('has-update');
}

export async function applyUpdate() {
  if (busy) return;
  if (uploading()) {
    toast('Une vidéo est en cours d’envoi : touchez « Mettre à jour » dès qu’elle est publiée.');
    return;
  }
  if (navigator.onLine === false) {
    toast('Pas de connexion : réessayez dès le retour du réseau.', 'error');
    return;
  }
  busy = true;
  pill?.classList.add('busy');
  if (label) label.textContent = 'Mise à jour…';
  try {
    // Les fichiers gardés sont retirés d'un bloc : la relance charge la nouvelle version complète
    if ('caches' in window) await caches.delete(CACHE);
    // Le service worker vérifie aussi sa propre nouvelle version (quelques secondes au plus)
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await Promise.race([reg.update().catch(() => {}), sleep(3000)]);
  } catch {
    /* la relance suffit */
  }
  location.reload();
}

// Le service worker vérifie aussi sa propre nouvelle version (au plus toutes les 10 minutes)
let swCheckedAt = 0;
function refreshServiceWorker() {
  if (Date.now() - swCheckedAt < 10 * 60 * 1000) return;
  swCheckedAt = Date.now();
  navigator.serviceWorker?.getRegistration().then((reg) => reg?.update()).catch(() => {});
}

// Démarrage : appelé une fois l'application lancée
export function startUpdateChecks() {
  if (started) return;
  started = true;
  startVersion = store.config?.version || null;
  const soon = (guard = 15 * 1000) => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < guard) return;
    checkForUpdate();
    refreshServiceWorker();
  };
  setTimeout(() => checkForUpdate(), 2500);
  setInterval(() => soon(0), EVERY);
  // Retour dans l'application (iPhone : l'application reste en mémoire, elle n'est pas relancée)
  document.addEventListener('visibilitychange', () => soon());
  addEventListener('pageshow', () => soon());
  addEventListener('focus', () => soon());
  addEventListener('online', () => setTimeout(() => checkForUpdate(), 1500));
  // Le serveur annonce une autre version dans une réponse ordinaire : on vérifie tout de suite
  addEventListener('vibz:version', () => {
    lastCheck = 0;
    checkForUpdate();
    swCheckedAt = 0;
    refreshServiceWorker();
  });
}
