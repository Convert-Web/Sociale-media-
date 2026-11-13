import { api } from '../api.js';
import { h, modal, toast } from '../dom.js';

const REASONS = [
  ['spam', 'Spam ou publicité'],
  ['inappropriate', 'Contenu inapproprié'],
  ['harassment', 'Harcèlement ou propos haineux'],
  ['fake', 'Faux profil ou usurpation'],
  ['other', 'Autre'],
];

// Fenêtre de signalement d'une publication, d'un commentaire ou d'un membre.
export function reportDialog(type, id, title = 'Signaler') {
  let chosen = null;
  const details = h('textarea', { class: 'textarea', maxlength: 500, rows: 3, placeholder: 'Précisions (facultatif)' });
  const send = h('button', { class: 'btn btn-primary btn-block', type: 'submit', disabled: true }, 'Envoyer le signalement');
  const options = REASONS.map(([code, label]) =>
    h(
      'label',
      { class: 'choice' },
      h('input', {
        type: 'radio',
        name: 'reason',
        value: code,
        onchange: () => {
          chosen = code;
          send.disabled = false;
        },
      }),
      h('span', null, label),
    ),
  );
  const m = modal(
    title,
    h(
      'form',
      {
        class: 'modal-body',
        style: { display: 'grid', gap: '14px' },
        onsubmit: async (e) => {
          e.preventDefault();
          if (!chosen) return;
          send.disabled = true;
          try {
            await api.post('/api/reports', { type, id, reason: chosen, details: details.value });
            m.close();
            toast('Merci. La direction va examiner ce signalement.');
          } catch (err) {
            send.disabled = false;
            toast(err.message, 'error');
          }
        },
      },
      h('p', { class: 'muted small' }, 'Votre signalement est anonyme pour le membre concerné.'),
      h('div', { class: 'choices' }, options),
      details,
      send,
    ),
  );
}
