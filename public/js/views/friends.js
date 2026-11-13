import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, nameLine, memberChip, toast, popMenu, confirmDialog, emptyState, spinner, num } from '../dom.js';

async function refreshCounters() {
  try {
    store.setCounters(await api.get('/api/counters'));
  } catch {
    /* sans conséquence */
  }
}

// Bouton d'amitié : Ajouter → Demande envoyée → (chez l'autre) Répondre → Amis
export function friendButton(user, { size = '', onChange } = {}) {
  const btn = h('button', { type: 'button' });
  const set = (status) => {
    const prev = user.friendStatus;
    user.friendStatus = status;
    paint();
    onChange?.(status, prev);
  };
  const call = async (method, next, message) => {
    try {
      const res = method === 'post' ? await api.post(`/api/users/${enc(user.username)}/friend`) : await api.del(`/api/users/${enc(user.username)}/friend`);
      set(res.status || next);
      if (message) toast(message);
      refreshCounters();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  function paint() {
    const s = user.friendStatus;
    const label = { none: 'Ajouter', outgoing: 'Demande envoyée', incoming: 'Répondre', friends: 'Amis' }[s] || 'Ajouter';
    const ic = { none: 'userPlus', outgoing: 'clock', incoming: 'userPlus', friends: 'userCheck' }[s] || 'userPlus';
    btn.className = `btn ${size} ${s === 'none' || s === 'incoming' ? 'btn-primary' : 'btn-secondary'}`;
    btn.replaceChildren(icon(ic, 'icon-sm'), label);
  }
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const s = user.friendStatus;
    if (s === 'none') return call('post', 'outgoing', 'Demande envoyée.');
    if (s === 'incoming') {
      return popMenu(btn, [
        { icon: 'check', label: 'Accepter', action: () => call('post', 'friends', `Vous êtes maintenant amis avec ${user.displayName}.`) },
        { icon: 'x', label: 'Refuser', action: () => call('del', 'none') },
      ]);
    }
    if (s === 'outgoing') {
      return popMenu(btn, [{ icon: 'x', label: 'Annuler la demande', action: () => call('del', 'none') }]);
    }
    popMenu(btn, [
      { icon: 'mail', label: 'Envoyer un message', action: () => navigate(`/messages/${user.username}`) },
      {
        icon: 'x',
        label: 'Retirer des amis',
        danger: true,
        action: async () => {
          if (await confirmDialog(`Retirer ${user.displayName} de vos amis ?`, 'Vous resterez abonnés l’un à l’autre ; vous pourrez vous désabonner depuis le profil.', 'Retirer')) {
            call('del', 'none');
          }
        },
      },
    ]);
  });
  paint();
  return btn;
}

function personRow(u, actions) {
  return h(
    'div',
    { class: 'user-row' },
    h('a', { href: `/@${u.username}` }, avatar(u)),
    h(
      'a',
      { href: `/@${u.username}`, class: 'meta' },
      h('span', { class: 'name-line' }, h('b', null, u.displayName), u.founder ? icon('crown', 'crown') : null),
      h('small', null, memberChip(u), h('span', null, u.profession || `@${u.username}`)),
    ),
    h('div', { class: 'row-actions' }, actions),
  );
}

export function friendsView(ctx) {
  const tabs = {
    incoming: h('button', { class: 'tab' }, 'Demandes'),
    friends: h('button', { class: 'tab' }, 'Mes amis'),
    outgoing: h('button', { class: 'tab' }, 'Envoyées'),
  };
  const body = h('div', null, spinner());
  let data = null;
  let current = 'incoming';

  async function load() {
    data = await api.get('/api/friends');
    tabs.incoming.textContent = data.incoming.length ? `Demandes (${num(data.incoming.length)})` : 'Demandes';
    tabs.friends.textContent = data.friends.length ? `Mes amis (${num(data.friends.length)})` : 'Mes amis';
    if (current === 'incoming' && !data.incoming.length && data.friends.length) current = 'friends';
    paint();
  }

  const act = async (fn, okMessage) => {
    try {
      await fn();
      if (okMessage) toast(okMessage);
      await load();
      refreshCounters();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  function paint() {
    for (const [k, t] of Object.entries(tabs)) t.classList.toggle('active', k === current);
    const list = data[current];
    const rows = list.map((u) => {
      if (current === 'incoming') {
        return personRow(u, [
          h('button', { class: 'btn btn-primary btn-sm', onclick: () => act(() => api.post(`/api/users/${enc(u.username)}/friend`), `Vous êtes maintenant amis avec ${u.displayName}.`) }, 'Accepter'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act(() => api.del(`/api/users/${enc(u.username)}/friend`)) }, 'Refuser'),
        ]);
      }
      if (current === 'outgoing') {
        return personRow(u, [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act(() => api.del(`/api/users/${enc(u.username)}/friend`), 'Demande annulée.') }, 'Annuler')]);
      }
      return personRow(u, [h('a', { href: `/messages/${u.username}`, class: 'btn btn-secondary btn-sm btn-icon', 'aria-label': `Écrire à ${u.displayName}` }, icon('mail', 'icon-sm'))]);
    });
    const empty = {
      incoming: emptyState('userPlus', 'Aucune demande', 'Les demandes d’ami que vous recevez apparaîtront ici.'),
      friends: emptyState('users', 'Pas encore d’amis', 'Ajoutez des membres depuis leur profil ou les suggestions ci-dessous.'),
      outgoing: emptyState('clock', 'Aucune demande envoyée', null),
    }[current];
    body.replaceChildren(rows.length ? h('div', { class: 'explore-list' }, rows) : empty, suggestions);
  }

  // « Vous connaissez peut-être »
  const suggestions = h('div');
  api
    .get('/api/suggestions?limit=6')
    .then(({ users }) => {
      if (!users.length) return;
      suggestions.replaceChildren(
        h('div', { class: 'section-title' }, 'Vous connaissez peut-être'),
        h(
          'div',
          { class: 'explore-list' },
          users.map((u) => personRow(u, [friendButton({ ...u, friendStatus: 'none' }, { size: 'btn-sm', onChange: () => load() })])),
        ),
      );
    })
    .catch(() => {});

  for (const [k, t] of Object.entries(tabs)) {
    t.addEventListener('click', () => {
      current = k;
      paint();
    });
  }
  load().catch((err) => body.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message)));
  ctx.title = 'Amis — AURUM';
  return h(
    'div',
    null,
    h('header', { class: 'page-head' }, h('div', { class: 'grow' }, h('h1', null, 'Amis'), h('div', { class: 'sub' }, 'Vos relations au sein du cercle'))),
    h('div', { class: 'tabs' }, tabs.incoming, tabs.friends, tabs.outgoing),
    body,
  );
}
