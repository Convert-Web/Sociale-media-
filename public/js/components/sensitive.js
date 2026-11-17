import { h, icon, toast } from '../dom.js';

// Contenu repéré par le filtre automatique : flouté derrière un avertissement chez les autres
// membres (« Afficher » pour le lire). Son auteur le voit normalement, avec une mention discrète.
export function sensitive(content, labels, { mine = false, extra = null } = {}) {
  if (!labels || !content) return content;
  if (mine) {
    return h(
      'div',
      { class: 'sensitive-own' },
      content,
      h('p', { class: 'sensitive-note' }, icon('shield', 'icon-sm'), 'Masqué aux autres membres derrière un avertissement : transmis à la Direction.'),
    );
  }
  const wrap = h('div', { class: 'sensitive' });
  const show = h('button', { class: 'sensitive-show', type: 'button' }, 'Afficher');
  show.addEventListener('click', (e) => {
    e.stopPropagation();
    wrap.classList.add('revealed');
  });
  wrap.append(
    h('div', { class: 'sensitive-content', 'aria-hidden': 'true' }, content),
    h(
      'div',
      { class: 'sensitive-veil' },
      h('span', { class: 'sensitive-label' }, icon('shield', 'icon-sm'), 'Contenu potentiellement offensant'),
      h('small', null, labels.join(' · ')),
      h('div', { class: 'sensitive-actions' }, show, extra),
    ),
  );
  show.addEventListener('click', () => wrap.querySelector('.sensitive-content').removeAttribute('aria-hidden'));
  return wrap;
}

// Après un envoi : prévenir l'auteur que son texte est masqué et transmis à la Direction.
export function flaggedNotice(item) {
  if (item?.flagged) {
    toast('Envoyé, mais masqué derrière un avertissement : ces propos ont été transmis à la Direction.', 'error');
  }
}
