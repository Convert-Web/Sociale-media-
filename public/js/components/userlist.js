// Lignes de comptes (abonnés, recherche, suggestions) avec bouton « Suivre » qui suit l'état réel.
import { enc } from '../api.js';
import { store } from '../store.js';
import { h, avatar, short, verifiedMark } from '../dom.js';
import { follow } from './actions.js';

export function followLabel(u) {
  if (u.friend) return 'Amis';
  if (u.isFollowing) return 'Abonné·e';
  if (u.requested) return 'Demandé';
  return u.followsYou ? 'Suivre en retour' : 'Suivre';
}

export function followButton(u, { small = true, onChange } = {}) {
  if (store.user?.id === u.id) return null;
  const btn = h('button', { type: 'button', class: `btn ${small ? 'btn-sm' : ''}` });
  const paint = () => {
    const on = u.isFollowing || u.requested;
    btn.textContent = followLabel(u);
    btn.classList.toggle('btn-primary', !on);
    btn.classList.toggle('btn-ghost', on);
  };
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.disabled = true;
    const next = await follow(u.username, !(u.isFollowing || u.requested));
    btn.disabled = false;
    if (!next) return;
    Object.assign(u, next);
    paint();
    onChange?.(u);
  });
  paint();
  return btn;
}

export function userRow(u, { sub = null, action = undefined } = {}) {
  return h(
    'div',
    { class: 'user-row' },
    h('a', { href: `/@${enc(u.username)}`, class: 'user-row-main' }, avatar(u, 'md', { live: true }), h('span', { class: 'user-row-text' }, h('b', null, u.displayName, u.verified ? verifiedMark() : null), h('small', null, sub ?? `@${u.username}${u.counts ? ` · ${short(u.counts.followers)} abonné${u.counts.followers > 1 ? 's' : ''}` : ''}`))),
    action === undefined ? followButton(u) : action,
  );
}
