// Feuille de partage : envoyer en message à ses amis, copier le lien, applications, republier,
// Duo, Stitch, enregistrer la vidéo, pas intéressé, signaler.
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, toast, debounce } from '../dom.js';
import { openSheet, closeSheet } from './sheet.js';
import { needLogin, toggleRepost, postPath } from './actions.js';
import { reportDialog } from './report.js';
import { videoBlob } from './video.js';

const CHUNK = 1024 * 1024;

// Compte un partage (une fois par geste)
function counted(post, channel, onShared) {
  post.shareCount = (post.shareCount || 0) + 1;
  onShared?.(post);
  api.post(`/api/posts/${post.id}/share`, { channel }).catch(() => {});
}

// Enregistrer la vidéo sur l'appareil : déjà téléchargée, ou assemblée morceau par morceau
export async function downloadPost(post) {
  const name = `vibz-${post.author.username}-${post.id}`;
  const save = (blob, ext) => {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `${name}.${ext}` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  try {
    if (post.video) {
      const v = post.video;
      const ext = v.url.endsWith('.webm') ? 'webm' : 'mp4';
      let blob = videoBlob(v);
      if (!blob) {
        const n = Math.max(1, Math.ceil((v.size || 1) / CHUNK));
        const base = v.url.replace(/\.(mp4|webm)$/, '');
        const parts = [];
        toast('Enregistrement de la vidéo…');
        for (let i = 0; i < n; i++) {
          const r = await fetch(`${base}/${i}.bin`);
          if (!r.ok) throw new Error('Téléchargement interrompu.');
          parts.push(await r.blob());
        }
        blob = new Blob(parts, { type: ext === 'webm' ? 'video/webm' : 'video/mp4' });
      }
      save(blob, ext);
      toast('Vidéo enregistrée');
    } else if (post.images?.length) {
      for (const [i, src] of post.images.entries()) {
        const r = await fetch(src);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: `${name}-${i + 1}.${(blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      toast(post.images.length > 1 ? 'Photos enregistrées' : 'Photo enregistrée');
    }
  } catch (err) {
    toast(err.message || 'Enregistrement impossible.', 'error');
  }
}

export function openShare(post, { onShared } = {}) {
  const url = `${location.origin}${postPath(post)}`;
  const title = `${post.author.displayName} sur Vibz`;
  const text = post.body ? post.body.slice(0, 120) : title;

  // 1. Envoyer en message
  const picked = new Set();
  const people = h('div', { class: 'share-people' });
  const msg = h('input', { class: 'input', type: 'text', maxlength: 500, placeholder: 'Ajoute un message…' });
  const sendBtn = h('button', { type: 'button', class: 'btn btn-primary', disabled: true }, 'Envoyer');
  const sendRow = h('div', { class: 'share-send', hidden: true }, msg, sendBtn);
  const paintPick = () => {
    for (const el of people.children) el.classList.toggle('on', picked.has(el.dataset.u));
    sendRow.hidden = !picked.size;
    sendBtn.disabled = !picked.size;
    sendBtn.textContent = picked.size > 1 ? `Envoyer (${picked.size})` : 'Envoyer';
  };
  const person = (u) =>
    h('button', { type: 'button', class: 'share-person', dataset: { u: u.username }, onclick: () => { if (picked.has(u.username)) picked.delete(u.username); else picked.add(u.username); paintPick(); } },
      h('span', { class: 'share-avatar' }, avatar(u, 'lg'), h('span', { class: 'share-check' }, icon('check', 'icon-xs'))), h('small', null, u.displayName));
  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    try {
      const r = await api.post('/api/share/dm', { postId: post.id, usernames: [...picked], body: msg.value.trim() });
      if (r.sent.length) {
        post.shareCount = (post.shareCount || 0) + r.sent.length;
        onShared?.(post);
        toast(r.sent.length > 1 ? `Envoyée à ${r.sent.length} personnes` : 'Envoyée');
      }
      if (r.errors.length) toast(r.errors[0].error, 'error');
      closeSheet();
    } catch (err) {
      sendBtn.disabled = false;
      toast(err.message, 'error');
    }
  });
  const search = h('input', { class: 'input share-search', type: 'search', placeholder: 'Rechercher', 'aria-label': 'Rechercher une personne' });
  search.addEventListener('input', debounce(async () => {
    const q = search.value.trim();
    if (!q) return loadTargets();
    try {
      const r = await api.get(`/api/search/suggest?q=${enc(q)}`);
      people.replaceChildren(...r.users.filter((u) => !u.me).map(person));
      paintPick();
    } catch {
      /* recherche indisponible */
    }
  }, 220));
  async function loadTargets() {
    try {
      const r = await api.get('/api/share/targets');
      people.replaceChildren(...r.users.map(person));
      if (!r.users.length) people.append(h('p', { class: 'muted small' }, 'Abonne-toi à des comptes qui te suivent pour leur envoyer des vidéos.'));
      paintPick();
    } catch {
      people.replaceChildren();
    }
  }
  const dmSection = store.user
    ? h('section', { class: 'share-section' }, h('h4', null, 'Envoyer à'), search, people, sendRow)
    : null;
  if (store.user) loadTargets();

  // 2. Partager ailleurs
  const app = (ic, label, fn, cls = '') => h('button', { type: 'button', class: `share-app ${cls}`, onclick: fn }, h('span', { class: 'share-app-ic' }, icon(ic)), h('small', null, label));
  const openOut = (href, channel) => {
    counted(post, channel, onShared);
    window.open(href, '_blank', 'noopener,noreferrer');
  };
  const apps = h(
    'div',
    { class: 'share-apps' },
    app('link', 'Copier le lien', async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Lien copié');
      } catch {
        toast(url);
      }
      counted(post, 'copy', onShared);
    }, 'c-link'),
    navigator.share ? app('share', 'Plus…', async () => {
      try {
        await navigator.share({ title, text, url });
        counted(post, 'native', onShared);
      } catch {
        /* partage annulé */
      }
    }, 'c-more') : null,
    app('whatsapp', 'WhatsApp', () => openOut(`https://wa.me/?text=${enc(`${text} ${url}`)}`, 'whatsapp'), 'c-wa'),
    app('facebook', 'Facebook', () => openOut(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, 'facebook'), 'c-fb'),
    app('xshare', 'X', () => openOut(`https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(text)}`, 'x'), 'c-x'),
    app('mail', 'E-mail', () => openOut(`mailto:?subject=${enc(title)}&body=${enc(`${text}\n\n${url}`)}`, 'email'), 'c-mail'),
    app('sms', 'SMS', () => openOut(`sms:?&body=${enc(`${text} ${url}`)}`, 'sms'), 'c-sms'),
  );

  // 3. Actions
  const action = (ic, label, fn, cls = '') => h('button', { type: 'button', class: `share-act ${cls}`, onclick: () => { closeSheet(); fn(); } }, h('span', { class: 'share-act-ic' }, icon(ic)), h('small', null, label));
  const acts = [
    !post.mine && post.privacy === 'public' && !post.author.private
      ? action('repost', post.reposted ? 'Annuler la republication' : 'Republier', () => toggleRepost(post))
      : null,
    post.allowDuet ? action('duet', 'Duo', () => !needLogin('Connecte-toi pour faire un Duo.') && navigate(`/creer?duo=${post.id}`)) : null,
    post.allowStitch ? action('scissors', 'Stitch', () => !needLogin('Connecte-toi pour faire un Stitch.') && navigate(`/creer?stitch=${post.id}`)) : null,
    post.sound?.url ? action('music', 'Utiliser ce son', () => !needLogin('Connecte-toi pour utiliser ce son.') && navigate(`/creer?son=${post.sound.id}`)) : null,
    (post.allowDownload || post.mine) && post.kind !== 'text' ? action('download', 'Enregistrer', () => downloadPost(post)) : null,
    !post.mine ? action('eyeOff', 'Pas intéressé', async () => {
      if (needLogin('Connecte-toi pour personnaliser ton fil.')) return;
      await api.post(`/api/posts/${post.id}/not-interested`).catch(() => {});
      toast('Tu verras moins de vidéos comme celle-ci');
    }) : null,
    !post.mine ? action('flag', 'Signaler', () => !needLogin('Connecte-toi pour signaler.') && reportDialog('post', post.id, 'Signaler la vidéo'), 'danger') : null,
  ].filter(Boolean);

  openSheet({
    title: 'Partager',
    body: h('div', { class: 'share' }, dmSection, h('section', { class: 'share-section' }, h('h4', null, 'Partager sur'), apps), acts.length ? h('section', { class: 'share-section' }, h('div', { class: 'share-acts' }, acts)) : null),
  });
}
