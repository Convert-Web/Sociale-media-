import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, nameLine, memberChip, toast, popMenu, confirmDialog, emptyState, spinner, num, modal, autosize } from '../dom.js';
import { composer } from '../components/post.js';
import { cropImage } from '../components/cropper.js';
import { postList, backHead } from './feed.js';
import { pickMember } from './profile.js';

const plural = (n, one, many) => `${num(n)} ${n > 1 ? many : one}`;

function coverThumb(g) {
  return h('span', { class: 'group-thumb' }, g.cover ? h('img', { src: g.cover, alt: '', loading: 'lazy' }) : icon('groups'));
}

function groupRow(g, actions = []) {
  return h(
    'div',
    { class: 'user-row group-row' },
    h('a', { href: `/groupes/${g.id}` }, coverThumb(g)),
    h(
      'a',
      { href: `/groupes/${g.id}`, class: 'meta' },
      h('b', null, g.name),
      h('small', null, icon('lock', 'icon-xs'), `Privé · ${plural(g.memberCount, 'membre', 'membres')}`),
      g.description ? h('span', { class: 'bio' }, g.description) : null,
    ),
    actions.length ? h('div', { class: 'row-actions' }, actions) : null,
  );
}

// Fenêtre de création d'un groupe
function createGroupDialog() {
  let cover = null;
  const name = h('input', { class: 'input', maxlength: 60, required: true, placeholder: 'Ex. : Cercle des collectionneurs' });
  const description = h('textarea', { class: 'textarea', maxlength: 500, rows: 3, placeholder: 'À quoi sert ce groupe ? (facultatif)' });
  const preview = h('div', { class: 'group-cover-pick' }, icon('image'), h('span', null, 'Ajouter une couverture'));
  const picker = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const create = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Créer le groupe');
  picker.addEventListener('change', async () => {
    const f = picker.files[0];
    picker.value = '';
    if (!f) return;
    const cropped = await cropImage(f, { aspect: 3, outWidth: 1500, title: 'Couverture du groupe' });
    if (!cropped) return m2();
    cover = cropped;
    m2();
  });
  preview.addEventListener('click', () => picker.click());
  let m;
  const m2 = () => {
    m = modal('Nouveau groupe privé', form);
    if (cover) preview.replaceChildren(h('img', { src: URL.createObjectURL(cover), alt: '' }));
  };
  const form = h(
    'form',
    {
      class: 'modal-body',
      style: { display: 'grid', gap: '14px' },
      onsubmit: async (e) => {
        e.preventDefault();
        create.disabled = true;
        try {
          const fd = new FormData();
          fd.append('name', name.value);
          fd.append('description', description.value);
          if (cover) fd.append('cover', cover, 'cover.jpg');
          const { group } = await api.post('/api/groups', fd);
          m.close();
          toast('Groupe créé.');
          navigate(`/groupes/${group.id}`);
        } catch (err) {
          create.disabled = false;
          toast(err.message, 'error');
        }
      },
    },
    preview,
    picker,
    h('label', { class: 'field' }, h('span', null, 'Nom du groupe'), name),
    h('label', { class: 'field' }, h('span', null, 'Description'), description),
    h('p', { class: 'muted small' }, 'Les publications d’un groupe privé ne sont visibles que par ses membres. Vous validez chaque demande d’adhésion.'),
    create,
  );
  m2();
}

// ---------------------------------------------------------------------------
// Annuaire des groupes
// ---------------------------------------------------------------------------
export function groupsView(ctx) {
  const body = h('div', null, spinner());
  const join = async (g) => {
    try {
      const res = await api.post(`/api/groups/${g.id}/join`);
      toast(res.status === 'member' ? 'Bienvenue dans le groupe.' : 'Demande envoyée aux administrateurs.');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const decline = async (g) => {
    await api.post(`/api/groups/${g.id}/leave`).catch(() => {});
    load();
  };
  async function load() {
    const d = await api.get('/api/groups');
    const parts = [];
    if (d.invitations.length) {
      parts.push(
        h('div', { class: 'section-title' }, 'Invitations'),
        h('div', { class: 'explore-list' }, d.invitations.map((g) => groupRow(g, [
          h('button', { class: 'btn btn-primary btn-sm', onclick: () => join(g) }, 'Rejoindre'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => decline(g) }, 'Refuser'),
        ]))),
      );
    }
    parts.push(h('div', { class: 'section-title' }, 'Vos groupes'));
    parts.push(
      d.mine.length
        ? h('div', { class: 'explore-list' }, d.mine.map((g) => groupRow(g, g.role !== 'member' ? [h('span', { class: 'tag' }, g.role === 'owner' ? 'Créateur' : 'Admin')] : [])))
        : emptyState('groups', 'Aucun groupe pour l’instant', 'Créez un groupe privé pour réunir vos proches, vos associés ou vos passions.', h('button', { class: 'btn btn-primary', onclick: createGroupDialog }, 'Créer un groupe')),
    );
    if (d.requested.length) {
      parts.push(
        h('div', { class: 'section-title' }, 'Demandes en attente'),
        h('div', { class: 'explore-list' }, d.requested.map((g) => groupRow(g, [h('button', { class: 'btn btn-ghost btn-sm', onclick: () => decline(g) }, 'Annuler')]))),
      );
    }
    if (d.discover.length) {
      parts.push(
        h('div', { class: 'section-title' }, 'À découvrir'),
        h('div', { class: 'explore-list' }, d.discover.map((g) => groupRow(g, [h('button', { class: 'btn btn-secondary btn-sm', onclick: () => join(g) }, 'Demander')]))),
      );
    }
    body.replaceChildren(...parts);
  }
  load().catch((err) => body.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message)));
  ctx.title = 'Groupes — AURUM';
  return h(
    'div',
    null,
    h(
      'header',
      { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', null, 'Groupes'), h('div', { class: 'sub' }, 'Privés, sur invitation ou validation')),
      h('button', { class: 'btn btn-primary btn-sm', onclick: createGroupDialog }, icon('plus', 'icon-sm'), 'Créer'),
    ),
    body,
  );
}

// ---------------------------------------------------------------------------
// Page d'un groupe
// ---------------------------------------------------------------------------
export async function groupView(ctx) {
  const id = Number(ctx.params.id);
  let g;
  try {
    ({ group: g } = await api.get(`/api/groups/${id}`));
  } catch (err) {
    return h('div', null, backHead('Groupe'), emptyState('groups', 'Groupe introuvable', err.message, h('a', { href: '/groupes', class: 'btn btn-ghost' }, 'Voir les groupes')));
  }
  ctx.title = `${g.name} — AURUM`;
  const reload = () => navigate(`/groupes/${g.id}`, { replace: true });
  const isMember = g.status === 'member';

  const run = async (fn, message) => {
    try {
      await fn();
      if (message) toast(message);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const invite = () =>
    pickMember('Inviter dans le groupe', (u) =>
      run(() => api.post(`/api/groups/${g.id}/invite`, { username: u.username }), `${u.displayName} est invité.`),
    );

  const editGroup = () => {
    const name = h('input', { class: 'input', maxlength: 60, value: g.name });
    const description = h('textarea', { class: 'textarea', maxlength: 500, rows: 4 });
    description.value = g.description || '';
    const save = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Enregistrer');
    const m = modal(
      'Modifier le groupe',
      h(
        'form',
        {
          class: 'modal-body',
          style: { display: 'grid', gap: '14px' },
          onsubmit: async (e) => {
            e.preventDefault();
            save.disabled = true;
            await run(() => api.patch(`/api/groups/${g.id}`, { name: name.value, description: description.value }), 'Groupe modifié.');
            m.close();
          },
        },
        h('label', { class: 'field' }, h('span', null, 'Nom'), name),
        h('label', { class: 'field' }, h('span', null, 'Description'), description),
        save,
      ),
    );
    autosize(description);
  };

  const coverPicker = h('input', { type: 'file', accept: 'image/*', hidden: true });
  coverPicker.addEventListener('change', async () => {
    const f = coverPicker.files[0];
    coverPicker.value = '';
    if (!f) return;
    const cropped = await cropImage(f, { aspect: 3, outWidth: 1500, title: 'Couverture du groupe' });
    if (!cropped) return;
    const fd = new FormData();
    fd.append('image', cropped, 'cover.jpg');
    run(() => api.post(`/api/groups/${g.id}/cover`, fd), 'Couverture mise à jour.');
  });

  const moreBtn = h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Options du groupe' }, icon('more'));
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = [];
    if (g.canManage) {
      items.push({ icon: 'pen', label: 'Modifier le groupe', action: editGroup });
      items.push({ icon: 'image', label: 'Changer la couverture', action: () => coverPicker.click() });
    }
    if (isMember && g.role !== 'owner') {
      items.push({ icon: 'logout', label: 'Quitter le groupe', danger: true, action: async () => {
        if (await confirmDialog('Quitter le groupe ?', 'Vous ne verrez plus ses publications.', 'Quitter')) run(() => api.post(`/api/groups/${g.id}/leave`), 'Vous avez quitté le groupe.');
      } });
    }
    if (g.role === 'owner' || store.user.isAdmin) {
      items.push({ icon: 'trash', label: 'Supprimer le groupe', danger: true, action: async () => {
        if (!(await confirmDialog('Supprimer le groupe ?', 'Toutes ses publications seront effacées définitivement.', 'Supprimer'))) return;
        try {
          await api.del(`/api/groups/${g.id}`);
          toast('Groupe supprimé.');
          navigate('/groupes', { replace: true });
        } catch (err) {
          toast(err.message, 'error');
        }
      } });
    }
    if (items.length) popMenu(moreBtn, items);
  });

  let actions;
  if (isMember) actions = [h('button', { class: 'btn btn-primary', onclick: invite }, icon('userPlus', 'icon-sm'), 'Inviter'), moreBtn];
  else if (g.status === 'invited') {
    actions = [
      h('button', { class: 'btn btn-primary', onclick: () => run(() => api.post(`/api/groups/${g.id}/join`), 'Bienvenue dans le groupe.') }, 'Accepter l’invitation'),
      h('button', { class: 'btn btn-ghost', onclick: () => run(() => api.post(`/api/groups/${g.id}/leave`)) }, 'Refuser'),
    ];
  } else if (g.status === 'requested') {
    actions = [h('button', { class: 'btn btn-secondary', onclick: () => run(() => api.post(`/api/groups/${g.id}/leave`), 'Demande annulée.') }, icon('clock', 'icon-sm'), 'Demande envoyée')];
  } else {
    actions = [h('button', { class: 'btn btn-primary', onclick: () => run(() => api.post(`/api/groups/${g.id}/join`), 'Demande envoyée aux administrateurs.') }, 'Demander à rejoindre')];
  }
  if (!isMember && store.user.isAdmin) actions.push(moreBtn);

  // Onglets réservés aux membres
  const content = h('div');
  const tabs = [];
  let stopList = () => {};
  ctx.onCleanup(() => stopList());
  const select = (key) => {
    for (const t of tabs) t.el.classList.toggle('active', t.key === key);
    stopList();
    stopList = () => {};
    tabs.find((t) => t.key === key)?.show();
  };
  const addTab = (key, label, show) => {
    const el = h('button', { class: 'tab', onclick: () => select(key) }, label);
    tabs.push({ key, el, show });
  };

  if (isMember || store.user.isAdmin) {
    addTab('posts', 'Discussion', () => {
      const list = postList((before) => api.get(`/api/groups/${g.id}/posts${before ? `?before=${before}` : ''}`), {
        empty: () => emptyState('comment', 'La discussion commence ici', 'Partagez la première publication du groupe.'),
      });
      const parts = [];
      if (isMember) parts.push(composer({ endpoint: `/api/groups/${g.id}/posts`, placeholder: 'Écrire dans le groupe…', onPosted: (p) => list.prepend(p) }));
      parts.push(list.el);
      content.replaceChildren(...parts);
      stopList = list.start();
    });
    addTab('members', `Membres · ${num(g.memberCount)}`, async () => {
      content.replaceChildren(spinner());
      try {
        const d = await api.get(`/api/groups/${g.id}/members`);
        const roleTag = (m) => (m.role === 'owner' ? h('span', { class: 'tag' }, 'Créateur') : m.role === 'admin' ? h('span', { class: 'tag' }, 'Admin') : null);
        const row = (m) => {
          const menu = [];
          if (g.role === 'owner' && m.role !== 'owner') {
            menu.push(m.role === 'admin'
              ? { icon: 'user', label: 'Retirer les droits d’admin', action: () => run(() => api.post(`/api/groups/${g.id}/members/${m.id}/role`, { role: 'member' })) }
              : { icon: 'shield', label: 'Nommer administrateur', action: () => run(() => api.post(`/api/groups/${g.id}/members/${m.id}/role`, { role: 'admin' }), `${m.displayName} est administrateur.`) });
          }
          if (g.canManage && m.role !== 'owner' && !m.isMe) {
            menu.push({ icon: 'x', label: 'Retirer du groupe', danger: true, action: async () => {
              if (await confirmDialog(`Retirer ${m.displayName} ?`, 'Il ou elle ne verra plus les publications du groupe.', 'Retirer')) run(() => api.post(`/api/groups/${g.id}/members/${m.id}/remove`), 'Membre retiré.');
            } });
          }
          const btn = menu.length ? h('button', { class: 'icon-btn', 'aria-label': 'Options', onclick: (e) => { e.stopPropagation(); popMenu(btn, menu); } }, icon('more')) : null;
          return h('div', { class: 'user-row' }, h('a', { href: `/@${m.username}` }, avatar(m)), h('a', { href: `/@${m.username}`, class: 'meta' }, h('span', { class: 'name-line' }, h('b', null, m.displayName), m.founder ? icon('crown', 'crown') : null), h('small', null, memberChip(m), h('span', null, m.profession || `@${m.username}`))), roleTag(m), btn);
        };
        content.replaceChildren(h('div', { class: 'explore-list', style: { marginTop: '12px' } }, d.members.map(row)));
      } catch (err) {
        content.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message));
      }
    });
    if (g.canManage) {
      addTab('requests', g.pendingRequests ? `Demandes · ${num(g.pendingRequests)}` : 'Demandes', async () => {
        content.replaceChildren(spinner());
        try {
          const d = await api.get(`/api/groups/${g.id}/members`);
          const parts = [];
          if (d.requests.length) {
            parts.push(h('div', { class: 'explore-list', style: { marginTop: '12px' } }, d.requests.map((m) => h('div', { class: 'user-row' },
              h('a', { href: `/@${m.username}` }, avatar(m)),
              h('a', { href: `/@${m.username}`, class: 'meta' }, nameLine(m, { link: false }), h('small', null, m.profession || `@${m.username}`)),
              h('div', { class: 'row-actions' },
                h('button', { class: 'btn btn-primary btn-sm', onclick: () => run(() => api.post(`/api/groups/${g.id}/requests/${m.id}/approve`), `${m.displayName} a rejoint le groupe.`) }, 'Accepter'),
                h('button', { class: 'btn btn-ghost btn-sm', onclick: () => run(() => api.post(`/api/groups/${g.id}/requests/${m.id}/decline`)) }, 'Refuser'),
              ),
            ))));
          } else {
            parts.push(emptyState('userPlus', 'Aucune demande', 'Les demandes d’adhésion à valider apparaîtront ici.'));
          }
          if (d.invited.length) {
            parts.push(h('div', { class: 'section-title' }, 'Invitations envoyées'), h('div', { class: 'explore-list' }, d.invited.map((m) => h('div', { class: 'user-row' }, avatar(m), h('span', { class: 'meta' }, nameLine(m, { link: false }), h('small', null, `@${m.username}`)), h('span', { class: 'tag' }, 'Invité')))));
          }
          content.replaceChildren(...parts);
        } catch (err) {
          content.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message));
        }
      });
    }
  }

  const stack = g.preview.length ? h('div', { class: 'avatar-stack' }, g.preview.slice(0, 6).map((u) => avatar(u, 'xs'))) : null;

  const page = h(
    'div',
    null,
    backHead(g.name, `Groupe privé · ${plural(g.memberCount, 'membre', 'membres')}`),
    h('div', { class: 'cover group-cover' }, g.cover ? h('img', { src: g.cover, alt: '' }) : h('span', { class: 'group-cover-icon' }, icon('groups'))),
    coverPicker,
    h(
      'section',
      { class: 'group-top' },
      h('h1', null, g.name),
      h('p', { class: 'group-meta' }, icon('lock', 'icon-sm'), `Groupe privé · ${plural(g.memberCount, 'membre', 'membres')}`),
      g.description ? h('p', { class: 'group-desc' }, g.description) : null,
      h('div', { class: 'group-people' }, stack, h('span', { class: 'muted small' }, `Créé par ${g.owner.displayName}`)),
      h('div', { class: 'group-actions' }, actions),
    ),
    tabs.length ? h('div', { class: 'tabs profile-tabs' }, tabs.map((t) => t.el)) : null,
    content,
  );

  if (tabs.length) select('posts');
  else content.replaceChildren(emptyState('lock', 'Groupe privé', 'Seuls les membres voient les publications et la liste des membres.'));
  return page;
}
