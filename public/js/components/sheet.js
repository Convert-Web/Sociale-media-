// Feuille qui monte du bas de l'écran (commentaires, choix…), comme sur iPhone :
// poignée, glisser vers le bas pour fermer, toucher le fond pour fermer, zone de saisie
// toujours au-dessus du clavier.
import { h, icon } from '../dom.js';

let current = null;

export function closeSheet() {
  current?.close();
}

export function openSheet({ title, body, footer = null, onClose, tall = false }) {
  closeSheet();
  const titleEl = h('b', null, title);
  const sheet = h(
    'div',
    { class: `sheet${tall ? ' tall' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': typeof title === 'string' ? title : '' },
    h('div', { class: 'sheet-grab' }, h('span', { class: 'sheet-handle' }), h('div', { class: 'sheet-head' }, titleEl, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => close() }, icon('x')))),
    h('div', { class: 'sheet-body' }, body),
    footer ? h('div', { class: 'sheet-foot' }, footer) : null,
  );
  const backdrop = h('div', { class: 'sheet-backdrop' }, sheet);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  // Clavier de l'iPhone : la feuille reste posée juste au-dessus
  const vv = window.visualViewport;
  const fitKeyboard = () => {
    if (!vv) return;
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
    if (e.target.closest('button')) return;
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
  function close() {
    if (closed) return;
    closed = true;
    current = null;
    vv?.removeEventListener('resize', fitKeyboard);
    vv?.removeEventListener('scroll', fitKeyboard);
    document.removeEventListener('keydown', onKey);
    backdrop.classList.add('out');
    sheet.style.transform = 'translateY(100%)';
    setTimeout(() => backdrop.remove(), 260);
    onClose?.();
  }

  document.body.append(backdrop);
  current = { close };
  fitKeyboard();
  return { close, setTitle: (t) => (titleEl.textContent = t), el: sheet };
}
