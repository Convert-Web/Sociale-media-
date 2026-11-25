// Profil : photo (anneau LIVE), compteurs, Suivre / Message, bio et lien, onglets Vidéos,
// Republications, Favoris (privés) et J'aime ; modification du profil ; listes d'abonnés.
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, short, toast, emptyState, modal, closeModal, verifiedMark, shareLink, confirmDialog, debounce, spinner, shrinkImage } from '../dom.js';
import { openSheet, closeSheet } from '../components/sheet.js';
import { videoGrid } from '../components/grid.js';
import { follow, needLogin } from '../components/actions.js';
import { followLabel, userRow } from '../components/userlist.js';
import { reportDialog } from '../components/report.js';
import { cropImage } from '../components/cropper.js';
import { logout } from './auth.js';
import { uploadList, tapUpload } from '../components/uploads.js';

const backBtn = () => h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/')) }, icon('back'));

export async function profileView(ctx) {
  const username = ctx.params.username;
  let user;
  try {
    ({ user } = await api.get(`/api/users/${enc(username)}`));
  } catch (err) {
    ctx.title = 'Compte introuvable — Vibz';
    return h('div', { class: 'page' }, h('header', { class: 'page-head' }, backBtn()), emptyState('user', 'Ce compte est introuvable', err.status === 404 ? 'Vérifie le nom d’utilisateur, ou ce compte a été supprimé.' : err.message));
  }
  // Adresse avec l'ancienne casse ou un ancien nom : la bonne adresse
  if (user.username !== username) history.replaceState(history.state, '', `/@${user.username}${location.search}`);
  ctx.title = `${user.displayName} (@${user.username}) — Vibz`;
  ctx.description = user.bio || `Les vidéos de ${user.displayName} sur Vibz.`;
  const me = user.me;
  const root = h('div', { class: 'page profile' });
  let grid = null;
  ctx.onCleanup(() => grid?.destroy());

  // En-tête
  const menuBtn = h('button', { type: 'button', class: 'icon-btn', 'aria-label': me ? 'Menu' : 'Options' }, icon(me ? 'menu' : 'moreH'));
  menuBtn.addEventListener('click', () => (me ? ownMenu() : otherMenu()));
  const buildHead = () => h('header', { class: 'page-head profile-top' }, me ? h('a', { href: '/amis', class: 'icon-btn', 'aria-label': 'Trouver des amis' }, icon('userPlus')) : backBtn(), h('b', { class: 'profile-handle' }, `@${user.username}`, user.private ? icon('lock', 'icon-xs') : null), menuBtn);

  // Photo, nom, compteurs (reconstruits à chaque changement : nouvelle photo, abonnement…)
  const buildPic = () => (user.live
    ? h('a', { href: `/live/${enc(user.username)}`, class: 'profile-pic is-live', 'aria-label': 'Regarder le LIVE' }, avatar(user, 'xxl', { live: true }))
    : h('span', { class: 'profile-pic' }, avatar(user, 'xxl')));
  const stat = (n, label, onclick) => h(onclick ? 'button' : 'span', { type: onclick ? 'button' : null, class: 'stat', onclick }, h('b', null, short(n)), h('small', null, label));
  const buildCounts = () => h(
    'div',
    { class: 'stats' },
    stat(user.counts.following, user.counts.following > 1 ? 'Abonnements' : 'Abonnement', user.locked ? null : () => followLists(user, 'following')),
    stat(user.counts.followers, user.counts.followers > 1 ? 'Abonnés' : 'Abonné', user.locked ? null : () => followLists(user, 'followers')),
    stat(user.counts.likes, 'J’aime'),
  );

  // Boutons
  const actions = h('div', { class: 'profile-actions' });
  const paintActions = () => {
    if (me) {
      actions.replaceChildren(
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => editProfile(user, (u) => { Object.assign(user, u); render(); }) }, 'Modifier le profil'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => shareLink(`${user.displayName} sur Vibz`, `/@${user.username}`) }, 'Partager le profil'),
        h('a', { href: '/studio', class: 'btn btn-ghost btn-icon', 'aria-label': 'Studio créateur' }, icon('creator')),
      );
      return;
    }
    if (user.blocked) {
      actions.replaceChildren(h('button', { type: 'button', class: 'btn btn-primary', onclick: () => toggleBlock(false) }, 'Débloquer'));
      return;
    }
    if (user.blockedBy) {
      actions.replaceChildren();
      return;
    }
    const on = user.isFollowing || user.requested;
    const fbtn = h('button', { type: 'button', class: `btn ${on ? 'btn-ghost' : 'btn-primary'} grow` }, on ? (user.friend ? 'Amis' : user.requested ? 'Demandé' : 'Abonné') : followLabel(user));
    fbtn.addEventListener('click', async () => {
      if (on && user.isFollowing && !(await confirmDialog(`Ne plus suivre ${user.displayName} ?`, user.private ? 'Ce compte est privé : tu devras redemander à le suivre.' : 'Ses vidéos n’apparaîtront plus dans «\u00a0Abonnements\u00a0».', 'Ne plus suivre'))) return;
      fbtn.disabled = true;
      const wasRequested = user.requested;
      const next = await follow(user.username, !on);
      fbtn.disabled = false;
      if (next) {
        if (wasRequested && !next.requested && !next.isFollowing) toast('Demande annulée');
        Object.assign(user, next);
        render();
      }
    });
    const msg = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => !needLogin('Connecte-toi pour envoyer un message.') && navigate(`/messages/${enc(user.username)}`) }, 'Message');
    const more = h('button', { type: 'button', class: `btn btn-ghost btn-icon similar-toggle${similar.hidden ? '' : ' on'}`, 'aria-label': 'Comptes suggérés', 'aria-expanded': String(!similar.hidden) }, icon('chevronDown'));
    more.addEventListener('click', () => {
      similar.hidden = !similar.hidden;
      more.classList.toggle('on', !similar.hidden);
      more.setAttribute('aria-expanded', String(!similar.hidden));
    });
    actions.replaceChildren(fbtn, msg, more);
  };
  const similar = h('div', { class: 'similar', hidden: true });
  if (!me) {
    api.get('/api/suggestions?limit=10').then(({ users }) => {
      const list = users.filter((u) => u.id !== user.id).slice(0, 8);
      if (list.length) similar.replaceChildren(h('h3', null, 'Comptes suggérés'), h('div', { class: 'similar-list' }, list.map((u) => h('a', { href: `/@${enc(u.username)}`, class: 'similar-card' }, avatar(u, 'lg'), h('b', null, u.displayName), h('small', null, u.reason)))));
    }).catch(() => {});
  }

  async function toggleBlock(on) {
    if (needLogin('Connecte-toi pour bloquer un compte.')) return;
    if (on && !(await confirmDialog(`Bloquer ${user.displayName} ?`, 'Ce compte ne pourra plus voir tes vidéos, te suivre, te commenter ni t’écrire. Cette personne ne sera pas prévenue.', 'Bloquer'))) return;
    try {
      const r = on ? await api.post(`/api/users/${enc(user.username)}/block`) : await api.del(`/api/users/${enc(user.username)}/block`);
      Object.assign(user, r.user);
      toast(on ? 'Compte bloqué' : 'Compte débloqué');
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function otherMenu() {
    const item = (ic, label, fn, danger) => h('button', { type: 'button', class: `opt-item${danger ? ' danger' : ''}`, onclick: () => { closeSheet(); fn(); } }, h('span', { class: 'opt-ic' }, icon(ic)), label);
    openSheet({
      title: `@${user.username}`,
      body: h(
        'div',
        { class: 'opt-list' },
        item('share', 'Partager le profil', () => shareLink(`${user.displayName} sur Vibz`, `/@${user.username}`)),
        item('send', 'Envoyer un message', () => !needLogin('Connecte-toi pour envoyer un message.') && navigate(`/messages/${enc(user.username)}`)),
        user.followsYou ? item('userMinus', 'Retirer cet abonné', async () => {
          if (!(await confirmDialog('Retirer cet abonné ?', `${user.displayName} ne te suivra plus. Cette personne ne sera pas prévenue.`, 'Retirer'))) return;
          try {
            const r = await api.del(`/api/users/${enc(user.username)}/follower`);
            Object.assign(user, r.user);
            render();
            toast('Abonné retiré');
          } catch (err) {
            toast(err.message, 'error');
          }
        }) : null,
        item('ban', user.blocked ? 'Débloquer' : 'Bloquer', () => toggleBlock(!user.blocked), true),
        item('flag', 'Signaler', () => !needLogin('Connecte-toi pour signaler.') && reportDialog('user', user.id, 'Signaler ce compte'), true),
      ),
    });
  }

  function ownMenu() {
    const item = (ic, label, href) => h('a', { href, class: 'opt-item', onclick: () => closeSheet() }, h('span', { class: 'opt-ic' }, icon(ic)), label);
    openSheet({
      title: user.displayName,
      body: h(
        'div',
        { class: 'opt-list' },
        item('creator', 'Studio créateur', '/studio'),
        item('wallet', 'Portefeuille', '/portefeuille'),
        item('settings', 'Réglages et confidentialité', '/reglages'),
        store.user?.isAdmin ? item('shield', 'Administration', '/admin') : null,
        item('help', 'Aide', '/aide'),
        h('button', { type: 'button', class: 'opt-item danger', onclick: () => { closeSheet(); logout(); } }, h('span', { class: 'opt-ic' }, icon('logout')), 'Se déconnecter'),
      ),
    });
  }

  // Onglets
  const TAB_DEFS = [
    { key: 'videos', ic: 'grid', label: 'Vidéos' },
    { key: 'reposts', ic: 'repost', label: 'Republications', short: 'Republiés' },
    me ? { key: 'favorites', ic: 'bookmark', label: 'Favoris', lock: true } : null,
    user.showLiked ? { key: 'liked', ic: 'heart', label: 'J’aime', lock: me && !store.user?.settings?.showLiked } : null,
  ].filter(Boolean);
  let current = TAB_DEFS.some((t) => t.key === ctx.query.get('onglet')) ? ctx.query.get('onglet') : 'videos';
  const tabs = h('nav', { class: 'profile-tabs', role: 'tablist' });
  const content = h('div', { class: 'profile-content' });
  function paintTabs() {
    tabs.replaceChildren(...TAB_DEFS.map((t) => h('button', { type: 'button', role: 'tab', class: `ptab${t.key === current ? ' on' : ''}`, 'aria-label': t.label, 'aria-selected': String(t.key === current), onclick: () => { current = t.key; history.replaceState(history.state, '', `/@${user.username}${t.key === 'videos' ? '' : `?onglet=${t.key}`}`); paintTabs(); mountGrid(); } }, icon(t.ic, 'icon-sm'), h('span', { class: 'ptab-label' }, t.short || t.label), t.lock ? icon('lock', 'icon-xs') : null)));
  }
  function mountGrid() {
    grid?.destroy();
    if (user.blocked) {
      content.replaceChildren(emptyState('ban', 'Tu as bloqué ce compte', 'Débloque-le pour voir ses vidéos.'));
      return;
    }
    if (user.blockedBy) {
      content.replaceChildren(emptyState('eyeOff', 'Ce compte n’est pas disponible', 'Tu ne peux pas voir son contenu.'));
      return;
    }
    if (user.locked) {
      content.replaceChildren(emptyState('lock', 'Ce compte est privé', user.requested ? 'Ta demande est en attente.' : 'Suis ce compte pour voir ses vidéos et ses J’aime.'));
      return;
    }
    const url = {
      videos: `/api/users/${enc(user.username)}/posts`,
      reposts: `/api/users/${enc(user.username)}/reposts`,
      favorites: '/api/me/favorites',
      liked: `/api/users/${enc(user.username)}/liked`,
    }[current];
    const empties = {
      videos: me ? emptyState('video', 'Publie ta première vidéo', 'Tes vidéos apparaîtront ici.', h('a', { href: '/creer', class: 'btn btn-primary' }, 'Créer')) : emptyState('video', 'Aucune vidéo', 'Ce compte n’a encore rien publié.'),
      reposts: emptyState('repost', 'Aucune republication', me ? 'Les vidéos que tu republies apparaîtront ici.' : 'Les vidéos republiées apparaîtront ici.'),
      favorites: emptyState('bookmark', 'Aucun favori', 'Garde des vidéos avec le signet : elles restent visibles de toi seul.'),
      liked: emptyState('heart', 'Aucune vidéo aimée', me ? 'Les vidéos que tu aimes apparaîtront ici (visibles de toi seul, sauf réglage contraire).' : null),
    };
    grid = videoGrid({ fetchPage: (cursor) => api.get(`${url}${cursor ? `?cursor=${cursor}` : ''}`), empty: empties[current], showLikes: current === 'liked', showPinned: current === 'videos' });
    content.replaceChildren(...(me && current === 'videos' ? [uploadsStrip] : []), grid.el);
    paintUploads();
  }

  // Ses vidéos en cours d'envoi, en tête de la grille ; elles prennent leur place une fois en ligne
  const uploadsStrip = h('div', { class: 'grid cols-3 upload-tiles', hidden: true });
  const uploadTiles = new Map();
  function paintUploads() {
    if (!me) return;
    const list = uploadList().filter((u) => u.state !== 'done');
    for (const [job, el] of uploadTiles) {
      if (list.some((u) => u.job === job)) continue;
      el.remove();
      uploadTiles.delete(job);
    }
    for (const u of list) {
      let el = uploadTiles.get(u.job);
      if (!el) {
        const ring = h('span', { class: 'upload-ring big' });
        const label = h('small');
        el = h('button', { type: 'button', class: 'tile upload-tile', onclick: () => tapUpload(u.job) }, u.poster ? h('img', { src: u.poster, alt: '' }) : null, h('span', { class: 'upload-tile-info' }, ring, label));
        el._parts = { ring, label };
        uploadTiles.set(u.job, el);
        uploadsStrip.append(el);
      }
      el.classList.toggle('error', u.state === 'error');
      el._parts.ring.style.setProperty('--p', u.p.toFixed(3));
      el._parts.label.textContent = u.state === 'error' ? 'Toucher pour réessayer' : u.label;
    }
    uploadsStrip.hidden = !list.length || current !== 'videos';
    // « Publie ta première vidéo » ne s'affiche pas sous une vidéo en cours d'envoi
    const empty = content.querySelector('.grid-empty');
    if (empty) empty.hidden = list.length > 0 && current === 'videos';
  }
  const onUploads = () => paintUploads();
  const onPublished = () => me && current === 'videos' && mountGrid();
  document.addEventListener('vibz:uploads', onUploads);
  document.addEventListener('vibz:published', onPublished);
  ctx.onCleanup(() => {
    document.removeEventListener('vibz:uploads', onUploads);
    document.removeEventListener('vibz:published', onPublished);
  });

  function render() {
    paintActions();
    const info = h(
      'div',
      { class: 'profile-info' },
      buildPic(),
      h('h1', { class: 'profile-name' }, h('span', { class: 'profile-name-text' }, user.displayName), user.verified ? verifiedMark() : null),
      h('span', { class: 'profile-sub' }, h('span', { class: 'profile-sub-handle' }, `@${user.username}`), user.demo ? h('span', { class: 'demo-chip' }, 'Compte de démonstration') : null),
      user.bio ? h('p', { class: 'profile-bio' }, user.bio) : me ? h('button', { type: 'button', class: 'link-btn', onclick: () => editProfile(user, (u) => { Object.assign(user, u); render(); }) }, '+ Ajouter une bio') : null,
      user.website ? h('a', { href: user.website, class: 'profile-link', target: '_blank', rel: 'noopener noreferrer nofollow', title: user.website }, icon('link', 'icon-xs'), h('span', null, user.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))) : null,
      buildCounts(),
      actions,
      similar,
    );
    paintTabs();
    tabs.hidden = Boolean(user.blockedBy);
    root.replaceChildren(buildHead(), info, tabs, content);
    mountGrid();
  }
  // Son propre profil : un abonnement changé ailleurs (liste, fil) met les compteurs à jour
  if (me) {
    const onFollow = async () => {
      const r = await api.get(`/api/users/${enc(user.username)}`).catch(() => null);
      if (!r || !root.isConnected) return;
      user.counts = r.user.counts;
      root.querySelector('.profile-info .stats')?.replaceWith(buildCounts());
    };
    document.addEventListener('vibz:follow', onFollow);
    ctx.onCleanup(() => document.removeEventListener('vibz:follow', onFollow));
  }
  render();
  return root;
}

// Listes : Abonnements / Abonnés / Amis
function followLists(user, start) {
  const tabsDef = [['following', 'Abonnements'], ['followers', 'Abonnés'], ...(user.me ? [['friends', 'Amis']] : [])];
  const list = h('div', { class: 'follow-list' });
  const tabs = h('nav', { class: 'tabs' });
  let kind = start;
  let cursor = null;
  let loading = false;
  const sentinel = h('div', { class: 'grid-sentinel' });
  const load = async (reset) => {
    if (loading || (!reset && cursor === false)) return;
    loading = true;
    if (reset) {
      cursor = null;
      list.replaceChildren(spinner());
    }
    try {
      const d = await api.get(`/api/users/${enc(user.username)}/${kind}${cursor ? `?cursor=${cursor}` : ''}`);
      if (reset) list.replaceChildren();
      for (const u of d.users) list.append(userRow(u));
      if (reset && !d.users.length) list.append(emptyState('friends', kind === 'followers' ? 'Aucun abonné pour l’instant' : kind === 'friends' ? 'Aucun ami pour l’instant' : 'Aucun abonnement', kind === 'friends' ? 'Vous devenez amis quand vous vous suivez mutuellement.' : null));
      cursor = d.cursor || false;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      loading = false;
    }
  };
  const paint = () => tabs.replaceChildren(...tabsDef.map(([k, label]) => h('button', { type: 'button', class: `tab-link${k === kind ? ' on' : ''}`, onclick: () => { kind = k; paint(); load(true); } }, label)));
  paint();
  load(true);
  const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && load(false));
  io.observe(sentinel);
  modal(`@${user.username}`, h('div', { class: 'modal-body follow-modal' }, tabs, list, sentinel), { onClose: () => io.disconnect() });
}

// Modifier le profil
function editProfile(user, onSaved) {
  const me = store.user;
  const pic = h('span', { class: 'edit-pic' }, avatar(me, 'xxl'));
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const name = h('input', { class: 'input', maxlength: 30, value: me.displayName, required: true });
  const username = h('input', { class: 'input', maxlength: 24, value: me.username, autocapitalize: 'none', spellcheck: 'false', required: true });
  const baseHint = `${location.host}/@${me.username} · modifiable une fois tous les 30 jours`;
  const userHint = h('small', { class: 'field-hint' }, baseHint);
  const bio = h('textarea', { class: 'textarea', rows: 3, maxlength: 80, placeholder: 'Présente-toi en quelques mots' }, me.bio);
  bio.value = me.bio || '';
  // Compté en caractères visibles (un émoji compte pour un)
  const chars = (v) => [...v].length;
  const bioCount = h('small', { class: 'field-hint right' }, `${chars(bio.value)}/80`);
  bio.addEventListener('input', () => (bioCount.textContent = `${chars(bio.value)}/80`));
  // « exemple.fr » suffit : le serveur ajoute https:// (personne ne le tape sur un téléphone)
  const website = h('input', { class: 'input', type: 'text', inputmode: 'url', autocapitalize: 'none', spellcheck: 'false', maxlength: 200, value: me.website || '', placeholder: 'exemple.fr' });
  const save = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, 'Enregistrer');
  username.addEventListener('input', debounce(async () => {
    const v = username.value.trim().replace(/^@/, '');
    if (v.toLowerCase() === me.username.toLowerCase()) {
      userHint.classList.remove('bad', 'ok');
      userHint.textContent = baseHint;
      return;
    }
    const r = await api.get(`/api/auth/username?u=${enc(v)}`).catch(() => null);
    if (!r) return;
    userHint.textContent = r.ok ? `@${v} est disponible` : r.reason;
    userHint.classList.toggle('bad', !r.ok);
    userHint.classList.toggle('ok', r.ok);
  }, 300));
  // Rangée de la photo : « Retirer » n'apparaît que s'il y a une photo
  const picRow = h('div', { class: 'edit-pic-row' });
  const paintPicRow = (u) => {
    pic.replaceChildren(avatar(u, 'xxl'));
    picRow.replaceChildren(pic, h('button', { type: 'button', class: 'link-btn', onclick: () => file.click() }, u.avatar ? 'Changer de photo' : 'Ajouter une photo'), u.avatar ? h('button', { type: 'button', class: 'link-btn muted', onclick: removePhoto }, 'Retirer') : null, file);
  };
  async function removePhoto() {
    try {
      const r = await api.del('/api/me/avatar');
      store.setUser(r.user);
      paintPicRow(r.user);
      onSaved?.(r.user);
      toast('Photo retirée');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  paintPicRow(me);
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f) return;
    try {
      const cropped = await cropImage(f, { aspect: 1, round: true, outWidth: 600, title: 'Photo de profil' });
      if (!cropped) return;
      const fd = new FormData();
      fd.append('image', await shrinkImage(cropped, 800, 0.88), 'avatar.jpg');
      const r = await api.post('/api/me/avatar', fd);
      store.setUser(r.user);
      paintPicRow(r.user);
      onSaved?.(r.user);
      toast('Photo mise à jour');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const m = modal(
    'Modifier le profil',
    h(
      'form',
      {
        class: 'modal-body form-stack edit-profile',
        onsubmit: async (e) => {
          e.preventDefault();
          save.disabled = true;
          try {
            const r = await api.patch('/api/me', { displayName: name.value, username: username.value.trim(), bio: bio.value, website: website.value });
            store.setUser(r.user);
            m.close();
            toast('Profil mis à jour');
            if (r.user.username !== user.username) navigate(`/@${r.user.username}`, { replace: true });
            else onSaved?.(r.user);
          } catch (err) {
            save.disabled = false;
            toast(err.message, 'error');
          }
        },
      },
      picRow,
      h('label', { class: 'field' }, h('span', null, 'Nom'), name),
      h('label', { class: 'field' }, h('span', null, 'Nom d’utilisateur'), username, userHint),
      h('label', { class: 'field' }, h('span', null, 'Bio'), bio, bioCount),
      h('label', { class: 'field' }, h('span', null, 'Lien'), website),
      save,
    ),
  );
  void closeModal;
}
