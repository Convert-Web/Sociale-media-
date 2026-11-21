// Vidéos envoyées en arrière-plan : la fenêtre se ferme aussitôt, la préparation et l'envoi
// continuent pendant que l'on regarde des vidéos ou écrit des messages. Une pastille en haut de
// l'écran montre l'avancement ; un toucher ouvre la vidéo une fois publiée, ou relance l'envoi.
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
  if (j.state === 'error') return 'Envoi interrompu · Réessayer';
  if (j.step === 'publish') return 'Publication…';
  // Un seul pourcentage, de 0 à 100 : préparation (rapide), puis envoi
  const pct = Math.min(99, Math.round(overall(j) * 100));
  return j.step === 'prepare' ? `Préparation ${pct} %` : `Envoi ${pct} %`;
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
    run(j); // relancé dans le geste : le son de la vidéo est conservé
  } else {
    toast('Gardez simplement AURUM ouvert : la vidéo part pendant sa préparation.');
  }
}

function remove(j) {
  jobs.delete(j);
  if (j.poster) URL.revokeObjectURL(j.poster);
  paint();
}

function run(j) {
  j.state = 'running';
  j.step = 'prepare';
  j.p = 0;
  paint();
  j.memo = j.memo || {}; // vidéo déjà préparée : une reprise ne refait que l'envoi
  const p = uploadVideo(j.file, j.info, (step, ratio) => {
    j.step = step;
    j.p = ratio;
    paint();
  }, j.memo)
    .then(async (video) => {
      j.step = 'publish';
      paint();
      const res = await j.finish(video);
      j.state = 'done';
      j.href = res?.href || null;
      forgetReels(); // la nouvelle vidéo apparaît tout de suite dans le coin Vidéos
      paint();
      toast(res?.message || 'Votre vidéo est en ligne.');
      setTimeout(() => jobs.has(j) && j.state === 'done' && remove(j), 8000);
    })
    .catch((err) => {
      j.state = 'error';
      paint();
      toast(`${err.message || 'Envoi interrompu.'} Touchez la pastille pour réessayer.`, 'error');
    });
  return p;
}

// À appeler dans le geste de l'utilisateur (toucher « Publier »).
// finish(video) publie la vidéo une fois envoyée et renvoie { href, message }.
export function sendInBackground({ file, info, title, finish }) {
  const j = { file, info, title, finish, poster: info.poster ? URL.createObjectURL(info.poster) : null, state: 'running', step: 'prepare', p: 0 };
  jobs.add(j);
  run(j);
  return j;
}
