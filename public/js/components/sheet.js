// Feuille qui monte du bas de l'écran (commentaires, choix…), comme sur iPhone :
// poignée, glisser vers le bas pour fermer, toucher le fond pour fermer, zone de saisie
// toujours au-dessus du clavier.
import { h, icon } from '../dom.js';

let current = null;

export function closeSheet() {
  current?.close();
}
// Une feuille est-elle ouverte (commentaires, partage…) ?
export const sheetOpen = () => Boolean(current);
// Panneau latéral ouvert (commentaires sur grand écran) ?
export const sidePanelOpen = () => Boolean(current?.side);
// Sur grand écran, side: true ouvre un panneau à droite, à côté de la vidéo (qui reste visible)
const wide = () => matchMedia('(min-width: 1000px)').matches;

export function openSheet({ title, body, footer = null, onClose, tall = false, side = false }) {
  // Un panneau latéral remplacé par un autre (vidéo suivante) : sans animation
  const swap = side && current?.side && wide();
  if (swap) current.close({ instant: true });
  else closeSheet();
  side = side && wide();
  const titleEl = h('b', null, title);
  const sheet = h(
    'div',
    { class: `sheet${tall ? ' tall' : ''}${side ? ' side' : ''}${swap ? ' no-anim' : ''}`, role: 'dialog', 'aria-modal': side ? 'false' : 'true', 'aria-label': typeof title === 'string' ? title : '' },
    h('div', { class: 'sheet-grab' }, h('span', { class: 'sheet-handle' }), h('div', { class: 'sheet-head' }, titleEl, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => close() }, icon('x')))),
    h('div', { class: 'sheet-body' }, body),
    footer ? h('div', { class: 'sheet-foot' }, footer) : null,
  );
  const backdrop = h('div', { class: `sheet-backdrop${side ? ' side' : ''}${swap ? ' no-anim' : ''}` }, sheet);
  // Le clic qui suit le toucher ayant ouvert la feuille tombe sur le fond : ignoré un court instant
  const openedAt = Date.now();
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && Date.now() - openedAt > 400) close();
  });

  // Clavier de l'iPhone : la feuille reste posée juste au-dessus
  const vv = window.visualViewport;
  const fitKeyboard = () => {
    if (!vv || side) return;
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    sheet.style.bottom = `${hidden}px`;
    sheet.style.maxHeight = `${Math.max(240, vv.height - 24)}px`;
  };
  vv?.addEventListener('resize', fitKeyboard);
  vv?.addEventListener('scroll', fitKeyboard);

  // Glisser vers le bas (par la poignée ou le titre) pour fermer
  const grab = sheet.querySelector('.sheet-grab');
  let startY = null;
  let dy = 0;
  grab.addEventListener('pointerdown', (e) => {
    if (side || e.target.closest('button')) return;
    startY = e.clientY;
    dy = 0;
    grab.setPointerCapture(e.pointerId);
    sheet.style.transition = 'none';
  });
  grab.addEventListener('pointermove', (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (startY == null) return;
    startY = null;
    sheet.style.transition = '';
    if (dy > 110) close();
    else sheet.style.transform = '';
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);

  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);

  let closed = false;
  function close({ instant = false } = {}) {
    if (closed) return;
    closed = true;
    current = null;
    vv?.removeEventListener('resize', fitKeyboard);
    vv?.removeEventListener('scroll', fitKeyboard);
    document.removeEventListener('keydown', onKey);
    if (side && !instant) document.body.classList.remove('side-open');
    if (instant) {
      backdrop.remove();
    } else {
      backdrop.classList.add('out');
      sheet.style.transform = side ? 'translateX(100%)' : 'translateY(100%)';
      setTimeout(() => backdrop.remove(), 260);
    }
    onClose?.();
  }

  document.body.append(backdrop);
  if (side) document.body.classList.add('side-open');
  current = { close, side };
  if (!side) fitKeyboard();
  return { close, setTitle: (t) => (titleEl.textContent = t), el: sheet };
}
