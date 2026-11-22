// Pages d'un hashtag et d'un son : en-tête, compteurs, vidéos populaires ;
// pour un son : écoute, favoris et « Utiliser ce son ».
import { api, enc } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, short, count, emptyState, toast, avatar, duration } from '../dom.js';
import { videoGrid } from '../components/grid.js';
import { needLogin } from '../components/actions.js';
import { shareLink } from '../dom.js';

const backBtn = () => h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/explorer')) }, icon('back'));

export async function tagView(ctx) {
  const name = ctx.params.tag.replace(/^#/, '');
  ctx.title = `#${name} — Vibz`;
  ctx.description = `Les vidéos #${name} sur Vibz.`;
  let info = { tag: name, posts: 0, views: 0 };
  try {
    info = (await api.get(`/api/tags/${enc(name)}`)).tag;
  } catch (err) {
    return h('div', { class: 'page' }, h('header', { class: 'page-head' }, backBtn(), h('h1', null, `#${name}`)), emptyState('hashtag', 'Hashtag introuvable', err.message));
  }
  const grid = videoGrid({ fetchPage: async (cursor) => api.get(`/api/tags/${enc(info.tag)}/posts${cursor ? `?cursor=${cursor}` : ''}`), empty: emptyState('hashtag', 'Aucune vidéo', `Sois la première personne à publier avec #${info.tag}.`) });
  ctx.onCleanup(grid.destroy);
  return h(
    'div',
    { class: 'page collection' },
    h('header', { class: 'page-head' }, backBtn(), h('span', { class: 'grow' }), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Partager', onclick: () => shareLink(`#${info.tag} sur Vibz`, `/tag/${enc(info.tag)}`) }, icon('share'))),
    h('div', { class: 'collection-head' }, h('span', { class: 'collection-cover tag' }, '#'), h('div', null, h('h1', null, `#${info.tag}`), h('p', null, `${count(info.views, 'vue')} · ${count(info.posts, 'publication')}`))),
    h('a', { href: `/creer?tag=${enc(info.tag)}`, class: 'btn btn-primary btn-block collection-cta', onclick: (e) => needLogin('Connecte-toi pour publier une vidéo.') && e.preventDefault() }, icon('video', 'icon-sm'), `Publier avec #${info.tag}`),
    grid.el,
  );
}

export async function soundView(ctx) {
  const id = Number(ctx.params.id);
  let sound;
  try {
    ({ sound } = await api.get(`/api/sounds/${id}`));
  } catch (err) {
    return h('div', { class: 'page' }, h('header', { class: 'page-head' }, backBtn(), h('h1', null, 'Son')), emptyState('music', 'Son introuvable', err.message));
  }
  ctx.title = `${sound.title} — Vibz`;
  // Écoute du son (le fichier de la vidéo d'origine)
  const audio = sound.url ? h('audio', { src: sound.url, preload: 'none' }) : null;
  const playBtn = h('button', { type: 'button', class: 'sound-play', 'aria-label': 'Écouter', disabled: !audio }, icon('play'));
  audio?.addEventListener('play', () => playBtn.replaceChildren(icon('pause')));
  audio?.addEventListener('pause', () => playBtn.replaceChildren(icon('play')));
  audio?.addEventListener('ended', () => playBtn.replaceChildren(icon('play')));
  playBtn.addEventListener('click', () => (audio.paused ? audio.play().catch((e) => toast(e.message, 'error')) : audio.pause()));
  ctx.onCleanup(() => audio?.pause());

  const favBtn = h('button', { type: 'button', class: `btn btn-ghost${sound.favorite ? ' on' : ''}` }, icon(sound.favorite ? 'bookmarkFill' : 'bookmark', 'icon-sm'), sound.favorite ? 'Dans tes favoris' : 'Ajouter aux favoris');
  favBtn.addEventListener('click', async () => {
    if (needLogin('Connecte-toi pour garder ce son.')) return;
    try {
      sound.favorite = sound.favorite ? (await api.del(`/api/sounds/${id}/favorite`)).favorite : (await api.post(`/api/sounds/${id}/favorite`)).favorite;
      favBtn.replaceChildren(icon(sound.favorite ? 'bookmarkFill' : 'bookmark', 'icon-sm'), sound.favorite ? 'Dans tes favoris' : 'Ajouter aux favoris');
      toast(sound.favorite ? 'Son ajouté à tes favoris' : 'Son retiré de tes favoris');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const grid = videoGrid({ fetchPage: async (cursor) => api.get(`/api/sounds/${id}/posts${cursor ? `?cursor=${cursor}` : ''}`), empty: emptyState('music', 'Aucune vidéo avec ce son', 'Sois la première personne à l’utiliser.') });
  ctx.onCleanup(grid.destroy);
  return h(
    'div',
    { class: 'page collection' },
    h('header', { class: 'page-head' }, backBtn(), h('span', { class: 'grow' }), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Partager', onclick: () => shareLink(`${sound.title} sur Vibz`, `/son/${id}`) }, icon('share'))),
    h(
      'div',
      { class: 'collection-head' },
      h('span', { class: 'collection-cover' }, sound.cover ? h('img', { src: sound.cover, alt: '' }) : icon('music'), playBtn, audio),
      h('div', null, h('h1', null, sound.title), sound.author ? h('a', { href: `/@${enc(sound.author.username)}`, class: 'collection-author' }, avatar(sound.author, 'xs'), sound.author.displayName) : null, h('p', null, `${short(sound.uses)} vidéo${sound.uses > 1 ? 's' : ''}${sound.duration ? ` · ${duration(sound.duration)}` : ''}`)),
    ),
    h('div', { class: 'collection-actions' }, favBtn),
    sound.url
      ? h('a', { href: `/creer?son=${id}`, class: 'btn btn-primary btn-block collection-cta', onclick: (e) => needLogin('Connecte-toi pour utiliser ce son.') && e.preventDefault() }, icon('video', 'icon-sm'), 'Utiliser ce son')
      : h('p', { class: 'muted small collection-cta' }, 'Ce son n’est plus disponible : la vidéo d’origine a été supprimée.'),
    grid.el,
  );
}
