// Vidéos envoyées en arrière-plan, en qualité d'origine : la fenêtre se ferme aussitôt, l'envoi
// continue pendant que l'on regarde des vidéos ou écrit des messages. Une pastille en haut de
// l'écran montre l'avancement ; un toucher ouvre la vidéo une fois publiée, ou relance l'envoi.
// Après une coupure (réseau, application mise en arrière-plan), l'envoi reprend de lui-même là
// où il s'était arrêté.
import { h, icon, toast } from '../dom.js';
import { navigate } from '../router.js';
import { uploadVideo, forgetReels } from './video.js';

const jobs = new Set();
let dock = null;

function ensureDock() {
  if (dock?.isConnected) return dock;
  dock = h('div', { class: 'upload-dock', role: 'status', 'aria-live': 'polite' });
  document.body.append(dock);
  return dock;
}

const busy = () => [...jobs].some((j) => j.state === 'running');
// Un envoi est-il en cours ? (la mise à jour de l'application attend la fin de l'envoi)
export const uploading = () => busy();
// Quitter la page pendant un envoi : le navigateur demande confirmation
addEventListener('beforeunload', (e) => {
  if (!busy()) return;
  e.preventDefault();
  e.returnValue = '';
});

function label(j) {
  if (j.state === 'done') return 'Vidéo en ligne · Voir';
  if (j.state === 'error') return j.auto ? 'Connexion perdue · reprise automatique' : 'Envoi interrompu · Réessayer';
  if (j.step === 'publish') return 'Publication…';
  if (j.step === 'prepare') return 'Démarrage de l’envoi…';
  return `Envoi ${Math.min(99, Math.round(overall(j) * 100))} %`;
}
function overall(j) {
  if (j.state === 'done') return 1;
  if (j.step === 'publish') return 0.99;
  return Math.min(0.98, j.p || 0);
}

// Chaque pastille est créée une fois (avec son apparition), puis seulement mise à jour :
// la recréer à chaque pourcent relançait l'animation et la rendait presque invisible.
const pills = new Map();
function pillFor(j) {
  let el = pills.get(j);
  if (el) return el;
  const small = h('small');
  const end = h('span', { class: 'upload-end' });
  const bar = h('i', { class: 'upload-bar' });
  el = h(
    'button',
    { type: 'button', class: 'upload-pill', onclick: () => tap(j) },
    j.poster ? h('img', { src: j.poster, alt: '' }) : h('span', { class: 'upload-ph' }, icon('video', 'icon-sm')),
    h('span', { class: 'upload-text' }, h('b', null, j.title), small),
    end,
    bar,
  );
  el._parts = { small, end, bar, endState: null };
  pills.set(j, el);
  return el;
}

function paint() {
  const d = ensureDock();
  for (const [j, el] of pills) {
    if (jobs.has(j)) continue;
    el.remove();
    pills.delete(j);
  }
  for (const j of jobs) {
    const el = pillFor(j);
    if (el.parentNode !== d) d.append(el);
    const { small, end, bar } = el._parts;
    el.className = `upload-pill ${j.state}`;
    small.textContent = label(j);
    const p = overall(j);
    bar.style.transform = `scaleX(${p.toFixed(3)})`;
    const endState = j.state === 'running' ? 'ring' : j.state;
    if (el._parts.endState !== endState) {
      el._parts.endState = endState;
      end.replaceChildren(endState === 'done' ? icon('chevron', 'icon-sm') : endState === 'error' ? icon('refresh', 'icon-sm') : h('span', { class: 'upload-ring' }));
    }
    end.firstChild?.style?.setProperty?.('--p', p.toFixed(3));
  }
  d.hidden = jobs.size === 0;
}

function tap(j) {
  if (j.state === 'done') {
    remove(j);
    if (j.href) navigate(j.href);
  } else if (j.state === 'error') {
    run(j); // reprise là où l'envoi s'était arrêté
  } else {
    toast('Garde Vibz ouvert : la vidéo part en qualité d’origine. En cas de coupure, l’envoi reprend là où il s’était arrêté.');
  }
}

function remove(j) {
  clearTimeout(j.timer);
  jobs.delete(j);
  if (j.poster) URL.revokeObjectURL(j.poster);
  paint();
}

// Coupure réseau (ou serveur momentanément indisponible) : reprise automatique. Un refus (vidéo
// trop lourde, espace plein, trop de vidéos aujourd'hui…) attend un toucher.
const resumable = (err) => typeof err?.status === 'number' && (err.status === 0 || err.status >= 500 || err.status === 408);
function resumeLater(j) {
  clearTimeout(j.timer);
  j.timer = setTimeout(() => j.state === 'error' && j.auto && document.visibilityState === 'visible' && run(j), Math.min(60000, 5000 * j.tries));
}
const resumeAll = () => {
  for (const j of jobs) if (j.state === 'error' && j.auto) run(j);
};
addEventListener('online', resumeAll);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resumeAll());

function run(j) {
  clearTimeout(j.timer);
  j.state = 'running';
  j.step = j.memo?.upload ? 'upload' : 'prepare';
  paint();
  j.memo = j.memo || {}; // envoi déjà commencé : une reprise n'envoie que les morceaux manquants
  // Vidéo déjà reçue par le serveur (seule la publication avait échoué) : elle n'est pas renvoyée
  const sent = j.video ? Promise.resolve(j.video) : uploadVideo(j.file, j.info, (step, ratio) => {
    j.step = step;
    j.p = ratio;
    paint();
  }, j.memo);
  const p = sent
    .then(async (video) => {
      j.video = video;
      j.step = 'publish';
      paint();
      const res = await j.finish(video);
      j.state = 'done';
      j.href = res?.href || null;
      forgetReels(); // la liste « Pour toi » gardée d'avance est rechargée
      paint();
      toast(res?.message || 'Ta vidéo est en ligne !');
      setTimeout(() => jobs.has(j) && j.state === 'done' && remove(j), 8000);
    })
    .catch((err) => {
      j.state = 'error';
      j.tries = (j.tries || 0) + 1;
      j.auto = resumable(err) && j.tries <= 12; // au-delà, la reprise se fait d'un toucher
      paint();
      if (j.auto) {
        resumeLater(j);
        if (j.tries === 1) toast('Connexion perdue : l’envoi reprendra tout seul, là où il s’est arrêté.');
      } else {
        toast(`${err.message || 'Envoi interrompu.'} Touche la pastille pour réessayer.`, 'error');
      }
    });
  return p;
}

// À appeler dans le geste de l'utilisateur (toucher « Publier »).
// finish(video) publie la vidéo une fois envoyée et renvoie { href, message }.
export function sendInBackground({ file, info, title, finish }) {
  const j = { file, info, title, finish, poster: info.poster ? URL.createObjectURL(info.poster) : null, state: 'running', step: 'prepare', p: 0, tries: 0 };
  jobs.add(j);
  run(j);
  return j;
}
