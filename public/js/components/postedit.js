// Modifier une publication : description, qui peut la voir, commentaires, Duo, Stitch, téléchargement.
import { api } from '../api.js';
import { h, modal, toast } from '../dom.js';
import { attachMentions } from './mentions.js';

export const PRIVACY = [
  ['public', 'Tout le monde'],
  ['friends', 'Amis'],
  ['private', 'Moi uniquement'],
];

export function toggle(label, checked, hint = '') {
  const input = h('input', { type: 'checkbox', checked, class: 'switch-input' });
  return { input, el: h('label', { class: 'switch-row' }, h('span', null, label, hint ? h('small', null, hint) : null), input, h('span', { class: 'switch', 'aria-hidden': 'true' })) };
}

export function editPost(post) {
  const body = h('textarea', { class: 'textarea', rows: 4, maxlength: 2200 }, post.body);
  body.value = post.body;
  const privacy = h('select', { class: 'input' }, PRIVACY.map(([v, l]) => h('option', { value: v, selected: post.privacy === v }, l)));
  const comments = toggle('Autoriser les commentaires', post.allowComments);
  const duet = toggle('Autoriser les Duos', post.allowDuet);
  const stitch = toggle('Autoriser les Stitchs', post.allowStitch);
  const dl = toggle('Autoriser le téléchargement', post.allowDownload);
  const save = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Enregistrer');
  const m = modal(
    'Modifier la publication',
    h(
      'form',
      {
        class: 'modal-body form-stack',
        onsubmit: async (e) => {
          e.preventDefault();
          save.disabled = true;
          try {
            const r = await api.patch(`/api/posts/${post.id}`, {
              body: body.value,
              privacy: privacy.value,
              allowComments: comments.input.checked,
              allowDuet: duet.input.checked,
              allowStitch: stitch.input.checked,
              allowDownload: dl.input.checked,
            });
            Object.assign(post, r.post);
            document.dispatchEvent(new CustomEvent('vibz:post', { detail: post }));
            m.close();
            toast('Publication modifiée');
          } catch (err) {
            save.disabled = false;
            toast(err.message, 'error');
          }
        },
      },
      h('label', { class: 'field' }, h('span', null, 'Description'), h('div', null, body)),
      h('label', { class: 'field' }, h('span', null, 'Qui peut voir cette publication'), privacy),
      comments.el,
      post.kind === 'video' ? duet.el : null,
      post.kind === 'video' ? stitch.el : null,
      dl.el,
      save,
    ),
  );
  attachMentions(body, { placement: 'inline' });
}
