// Lecteur de podcasts : une barre discrète en bas de l'écran, qui continue de jouer
// pendant que l'on navigue, avec les commandes de l'écran verrouillé (iPhone, Android).
import { h, icon } from '../dom.js';

let audio = null;
let bar = null;
let current = null;
let saveTimer = 0;
const listeners = new Set();

const KEY = (url) => `aurum:podcast:${url}`;
function savedPosition(url) {
  try {
    return Number(localStorage.getItem(KEY(url))) || 0;
  } catch {
    return 0;
  }
}
function savePosition() {
  if (!current || !audio) return;
  try {
    if (audio.duration && audio.currentTime > audio.duration - 30) localStorage.removeItem(KEY(current.audioUrl));
    else if (audio.currentTime > 20) localStorage.setItem(KEY(current.audioUrl), String(Math.floor(audio.currentTime)));
  } catch {
    /* stockage indisponible */
  }
}

export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
};

const notify = () => listeners.forEach((fn) => fn(state()));
export function onPlayer(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function state() {
  return { item: current, playing: Boolean(audio && !audio.paused), time: audio?.currentTime || 0, duration: audio?.duration || current?.duration || 0 };
}
export const isCurrent = (item) => Boolean(current && item && current.audioUrl === item.audioUrl);

function ensure() {
  if (audio) return;
  audio = new Audio();
  audio.preload = 'metadata';
  const art = h('span', { class: 'player-art' });
  const title = h('b');
  const sub = h('small');
  const progress = h('i');
  const timeEl = h('small', { class: 'player-time' });
  const playBtn = h('button', { class: 'player-btn player-main', 'aria-label': 'Lecture' });
  const back = h('button', { class: 'player-btn', 'aria-label': 'Reculer de 15 secondes', onclick: () => seekBy(-15) }, icon('rewind'));
  const fwd = h('button', { class: 'player-btn', 'aria-label': 'Avancer de 30 secondes', onclick: () => seekBy(30) }, icon('forward'));
  const close = h('button', { class: 'player-btn player-close', 'aria-label': 'Fermer le lecteur', onclick: stop }, icon('x'));
  const track = h('div', { class: 'player-progress', role: 'slider', 'aria-label': 'Position', tabindex: '0' }, progress);
  playBtn.addEventListener('click', toggle);
  track.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const r = track.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  bar = h(
    'div',
    { class: 'player', hidden: true, role: 'region', 'aria-label': 'Lecteur de podcast' },
    track,
    h('div', { class: 'player-row' }, art, h('div', { class: 'player-meta' }, title, h('span', { class: 'player-sub' }, sub, timeEl)), back, playBtn, fwd, close),
  );
  document.body.append(bar);

  const paint = () => {
    if (!current) return;
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    progress.style.width = `${pct}%`;
    timeEl.textContent = audio.duration ? ` · ${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}` : '';
    playBtn.replaceChildren(icon(audio.paused ? 'play' : 'pause'));
    playBtn.setAttribute('aria-label', audio.paused ? 'Lecture' : 'Pause');
  };
  bar.paintMeta = () => {
    art.replaceChildren(current.image ? h('img', { src: current.image, alt: '' }) : icon('headphones'));
    title.textContent = current.title;
    sub.textContent = current.siteName || '';
  };
  for (const ev of ['timeupdate', 'play', 'pause', 'loadedmetadata', 'ended']) {
    audio.addEventListener(ev, () => {
      paint();
      notify();
    });
  }
  audio.addEventListener('timeupdate', () => {
    const now = Date.now();
    if (now - saveTimer > 5000) {
      saveTimer = now;
      savePosition();
    }
  });
  audio.addEventListener('pause', savePosition);
  audio.addEventListener('ended', () => {
    try {
      localStorage.removeItem(KEY(current.audioUrl));
    } catch {
      /* stockage indisponible */
    }
  });
  audio.addEventListener('error', () => {
    sub.textContent = 'Lecture impossible : épisode indisponible.';
  });

  // Commandes de l'écran verrouillé
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('seekbackward', () => seekBy(-15));
    ms.setActionHandler('seekforward', () => seekBy(30));
    try {
      ms.setActionHandler('seekto', (d) => (audio.currentTime = d.seekTime));
    } catch {
      /* non pris en charge */
    }
  }
}

function seekBy(s) {
  if (!audio) return;
  audio.currentTime = Math.max(0, Math.min((audio.duration || Infinity) - 1, audio.currentTime + s));
}

// À appeler depuis un geste de l'utilisateur (obligatoire sur iPhone)
export function playItem(item) {
  ensure();
  if (isCurrent(item)) return toggle();
  savePosition();
  current = item;
  audio.src = item.audioUrl;
  const resume = savedPosition(item.audioUrl);
  if (resume) audio.addEventListener('loadedmetadata', () => (audio.currentTime = resume), { once: true });
  bar.paintMeta();
  bar.hidden = false;
  document.body.classList.add('has-player');
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.siteName || 'AURUM',
      album: 'Le Journal — AURUM',
      artwork: item.image ? [{ src: item.image, sizes: '512x512' }] : [{ src: '/img/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
  }
  audio.play().catch(() => {});
  notify();
}

export function toggle() {
  if (!audio || !current) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function stop() {
  if (!audio) return;
  savePosition();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  current = null;
  bar.hidden = true;
  document.body.classList.remove('has-player');
  notify();
}
