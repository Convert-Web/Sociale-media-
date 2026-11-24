// Fiche d'une actualité de l'Actu : image ou lecteur intégré, titre, court résumé fourni par le
// média, « Lire sur … » (l'article se lit chez le média), « Réagir en vidéo », partage, et les
// vidéos des membres qui y réagissent. L'administration peut la mettre « À la une » ou la retirer.
import { api } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, timeAgo, toast, confirmDialog, shareLink, spinner, emptyState, count } from '../dom.js';
import { openSheet, closeSheet } from './sheet.js';
import { needLogin } from './actions.js';
import { tile } from './grid.js';
import { openViewer } from './feed.js';
import { playItem, isCurrent, onPlayer, state as playerState, fmtTime } from './player.js';

export const TOPIC_LABELS = { une: 'À la une', monde: 'Monde', eco: 'Économie', tech: 'Tech', science: 'Sciences', culture: 'Culture', sport: 'Sport', planete: 'Planète' };

// Image d'un média : sans adresse d'origine transmise, et masquée si elle ne se charge pas
export function mediaImg(src, cls = '') {
  if (!src) return null;
  const img = h('img', { src, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', class: cls || null });
  img.addEventListener('error', () => img.closest('.actu-media, .actu-thumb, .actu-card-img, .actu-pod-art')?.classList.add('no-img'), { once: true });
  return img;
}

// « Le Monde · il y a 2 h »
export const sourceLine = (it) => `${it.siteName || 'Média'}${it.publishedAt ? ` · ${timeAgo(it.publishedAt)}` : ''}`;

// Bouton lecture d'un épisode : suit le lecteur (lecture / pause), où qu'on le touche
export function podcastButton(item, { label = false } = {}) {
  const btn = h('button', { type: 'button', class: label ? 'btn btn-primary' : 'actu-play', 'aria-label': 'Écouter l’épisode' });
  // Bouton retiré de la page : il cesse d'écouter le lecteur au prochain changement
  let seen = false;
  let off = () => {};
  const paint = () => {
    if (btn.isConnected) seen = true;
    else if (seen) return off();
    const s = playerState();
    const on = isCurrent(item) && s.playing;
    btn.replaceChildren(icon(on ? 'pause' : 'play', label ? 'icon-sm' : ''), label ? (on ? 'Pause' : isCurrent(item) ? 'Reprendre' : 'Écouter') : null);
    btn.setAttribute('aria-label', on ? 'Mettre en pause' : 'Écouter l’épisode');
  };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!item.audioUrl) return toast('Cet épisode s’écoute sur la plateforme du podcast.', 'error');
    playItem(item);
  });
  off = onPlayer(paint);
  paint();
  return btn;
}

// Lecteur intégré (YouTube sans cookie, Vimeo, Spotify…) : vignette d'abord, rien ne se charge
// chez la plateforme avant le toucher
function embedBox(it) {
  const box = h('div', { class: `actu-media embed${it.kind === 'podcast' ? ' audio' : ''}` });
  const start = () => {
    const src = `${it.embedUrl}${it.embedUrl.includes('?') ? '&' : '?'}autoplay=1&playsinline=1&rel=0`;
    box.replaceChildren(h('iframe', { src, title: it.title, allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy' }));
    document.dispatchEvent(new CustomEvent('vibz:sound'));
  };
  box.append(mediaImg(it.image), h('button', { type: 'button', class: 'actu-embed-play', 'aria-label': it.kind === 'video' ? 'Lire la vidéo' : 'Écouter', onclick: start }, icon('play')));
  return box;
}

function mediaBlock(it) {
  if (it.embedUrl) return embedBox(it);
  if (it.kind === 'podcast') {
    return h('div', { class: 'actu-media podcast' }, mediaImg(it.image), h('div', { class: 'actu-pod-play' }, podcastButton(it, { label: true }), it.duration ? h('small', null, fmtTime(it.duration)) : null));
  }
  return it.image ? h('div', { class: 'actu-media' }, mediaImg(it.image)) : null;
}

const readLabel = (it) => (it.kind === 'video' ? `Voir sur ${it.siteName || 'la plateforme'}` : it.kind === 'podcast' ? 'Page de l’épisode' : `Lire sur ${it.siteName || 'le site du média'}`);

export async function openActu(idOrItem, { onChange } = {}) {
  const known = typeof idOrItem === 'object' ? idOrItem : null;
  const id = known ? known.id : Number(idOrItem);
  const body = h('div', { class: 'actu-sheet' }, spinner());
  openSheet({ title: known?.siteName || 'Actu', body, tall: true });
  let d;
  try {
    d = await api.get(`/api/actu/${id}`);
  } catch (err) {
    body.replaceChildren(emptyState('newspaper', 'Actualité indisponible', err.message));
    return;
  }
  const it = d.item;
  const react = h('button', { type: 'button', class: 'btn btn-ghost actu-react-btn', onclick: () => {
    if (needLogin('Connecte-toi pour réagir en vidéo.')) return;
    closeSheet();
    navigate(`/creer?actu=${it.id}`);
  } }, icon('video', 'icon-sm'), 'Réagir en vidéo');
  const share = h('button', { type: 'button', class: 'icon-btn actu-share', 'aria-label': 'Partager cette actualité', onclick: () => shareLink(it.title, `/actu/${it.id}`) }, icon('share'));
  const read = h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer', class: 'btn btn-primary actu-read' }, readLabel(it), icon('external', 'icon-sm'));

  const reactions = h('section', { class: 'actu-reactions' },
    h('h3', { class: 'section-title' }, d.reactions.length ? `Ils réagissent en vidéo · ${d.reactions.length}` : 'Réactions en vidéo'),
    d.reactions.length
      ? h('div', { class: 'grid cols-3' }, d.reactions.map((p) => tile(p, { showAuthor: true, onOpen: (post) => { closeSheet(); openViewer(d.reactions, { startId: post.id }); } })))
      : h('p', { class: 'muted small' }, 'Personne n’a encore réagi. Donne ton avis en vidéo : il apparaîtra ici et dans les fils.'));

  const admin = it.canManage
    ? h('div', { class: 'actu-admin' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const r = await api.post(`/api/actu/${it.id}/feature`, { featured: !it.featured });
            it.featured = r.item.featured;
            btn.textContent = it.featured ? 'Retirer de la une' : 'Mettre à la une';
            toast(it.featured ? 'Mise à la une' : 'Retirée de la une');
            onChange?.();
          } catch (err) {
            toast(err.message, 'error');
          } finally {
            btn.disabled = false;
          }
        } }, it.featured ? 'Retirer de la une' : 'Mettre à la une'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm danger-text', onclick: async () => {
          if (!(await confirmDialog('Retirer cette actualité ?', 'Elle disparaît de l’Actu pour tout le monde. Les vidéos qui y réagissent restent publiées.', 'Retirer'))) return;
          try {
            await api.del(`/api/actu/${it.id}`);
            closeSheet();
            toast('Actualité retirée');
            onChange?.();
          } catch (err) {
            toast(err.message, 'error');
          }
        } }, 'Retirer de l’Actu'))
    : null;

  body.replaceChildren(
    mediaBlock(it),
    h('div', { class: 'actu-sheet-meta' },
      it.topic ? h('span', { class: 'actu-topic' }, TOPIC_LABELS[it.topic] || it.topic) : null,
      it.featured ? h('span', { class: 'actu-topic une' }, 'À la une') : null,
      h('small', null, sourceLine(it))),
    h('h2', { class: 'actu-sheet-title' }, it.title),
    it.summary ? h('p', { class: 'actu-sheet-summary' }, it.summary) : null,
    it.summary ? h('p', { class: 'actu-credit' }, `Résumé publié par ${it.siteName || 'le média'}. L’article complet se lit sur son site.`) : null,
    h('div', { class: 'actu-actions' }, read, react, share),
    it.reactions > d.reactions.length ? h('p', { class: 'muted small' }, count(it.reactions, 'réaction')) : null,
    reactions,
    admin,
  );
}
