// Astuces : une bulle discrète près d'un élément, montrée une seule fois par appareil.
// Une seule astuce à la fois ; un toucher n'importe où la ferme.
import { h } from '../dom.js';

let showing = false;
const seen = (key) => {
  try {
    return localStorage.getItem(`aurum:tip:${key}`) === '1';
  } catch {
    return true; // stockage indisponible : on ne dérange pas
  }
};
const markSeen = (key) => {
  try {
    localStorage.setItem(`aurum:tip:${key}`, '1');
  } catch {
    /* stockage indisponible */
  }
};

export function coach(key, target, title, text, { delay = 900, duration = 7000 } = {}) {
  if (!target || seen(key)) return;
  // Montrée quand l'élément arrive bien à l'écran (pendant le défilement s'il le faut)
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      setTimeout(() => show(key, target, title, text, duration), delay);
    },
    { threshold: 0.9, rootMargin: '-60px 0px -90px 0px' },
  );
  io.observe(target);
}

function show(key, target, title, text, duration) {
  {
    if (showing || seen(key) || !target.isConnected || document.querySelector('.modal-backdrop, .sheet-backdrop')) return;
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.bottom < 60 || r.top > innerHeight - 80) return; // plus à l'écran : une autre fois
    showing = true;
    markSeen(key);
    const below = r.top < innerHeight / 2;
    const bubble = h('div', { class: `coach ${below ? 'below' : 'above'}`, role: 'status' }, h('b', null, title), text);
    document.body.append(bubble);
    const w = bubble.offsetWidth;
    const left = Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    bubble.style.left = `${left}px`;
    bubble.style.top = below ? `${r.bottom + scrollY + 12}px` : `${r.top + scrollY - bubble.offsetHeight - 12}px`;
    bubble.style.setProperty('--ax', `${Math.max(16, Math.min(w - 30, r.left + r.width / 2 - left - 7))}px`);
    const close = () => {
      document.removeEventListener('pointerdown', close, true);
      bubble.classList.add('out');
      setTimeout(() => {
        bubble.remove();
        showing = false;
      }, 260);
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 50);
    setTimeout(close, duration);
  }
}
