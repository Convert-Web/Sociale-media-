// Recherche : suggestions pendant la saisie, historique, puis résultats en onglets
// (Top, Comptes, Vidéos, Sons, Hashtags, LIVE).
import { api, enc } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, short, count, debounce, emptyState, spinner, avatar, toast } from '../dom.js';
import { searchBar, cleanQuery, revealActive } from './explore.js';
import { videoGrid, tile } from '../components/grid.js';
import { userRow } from '../components/userlist.js';
import { openViewer } from '../components/feed.js';

const HISTORY = 'vibz:recherches';
const readHistory = () => {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const saveHistory = (list) => {
  try {
    localStorage.setItem(HISTORY, JSON.stringify(list.slice(0, 12)));
  } catch {
    /* stockage indisponible */
  }
};
const remember = (q) => saveHistory([q, ...readHistory().filter((x) => x !== q)]);

const TABS = [
  ['top', 'Top'],
  ['users', 'Comptes'],
  ['videos', 'Vidéos'],
  ['sounds', 'Sons'],
  ['tags', 'Hashtags'],
  ['live', 'LIVE'],
];

export function soundRow(s) {
  return h('a', { href: `/son/${s.id}`, class: 'sound-row' }, h('span', { class: 'sound-cover' }, s.cover ? h('img', { src: s.cover, alt: '' }) : icon('music')), h('span', { class: 'sound-text' }, h('b', null, s.title), h('small', null, `${s.author?.displayName || 'Son'} · ${short(s.uses)} vidéo${s.uses > 1 ? 's' : ''}`)), icon('chevron', 'icon-sm'));
}
const tagRow = (t) => h('a', { href: `/tag/${enc(t.tag)}`, class: 'tag-row' }, h('span', { class: 'tag-ic' }, '#'), h('span', { class: 'tag-text' }, h('b', null, t.tag), h('small', null, count(t.posts, 'publication'))), icon('chevron', 'icon-sm'));
// États vides propres à chaque onglet
const EMPTY = {
  top: (q) => ['Aucun résultat', `Rien ne correspond à « ${q} ». Essaie un autre mot ou un #hashtag.`],
  users: (q) => ['Aucun compte trouvé', `Aucun compte ne correspond à « ${q} ».`],
  sounds: (q) => ['Aucun son trouvé', `Aucun son ne correspond à « ${q} ».`],
  tags: (q) => ['Aucun hashtag trouvé', `Aucun hashtag ne commence par « ${q.replace(/^#+/, '')} ».`],
  live: (q) => ['Aucun LIVE en cours', `Personne n’est en LIVE pour « ${q} » en ce moment.`],
};
// Taille d'une section du « Top » : « Voir plus » seulement si elle est pleine
const TOP_SIZE = { users: 4, tags: 4, sounds: 3, videos: 12 };
const liveRow = (l) => h('a', { href: `/live/${enc(l.host.username)}`, class: 'live-row' }, avatar({ ...l.host, live: l.id }, 'md', { live: true }), h('span', null, h('b', null, l.host.displayName), h('small', null, `${l.title || 'En LIVE'} · ${short(l.viewers)} spectateur${l.viewers > 1 ? 's' : ''}`)));

export async function searchView(ctx) {
  const q = cleanQuery(ctx.query.get('q'));
  const type = TABS.some(([k]) => k === ctx.query.get('type')) ? ctx.query.get('type') : 'top';
  ctx.title = q ? `${q} — Recherche AURUM` : 'Recherche — AURUM';
  const bar = searchBar(q, { autofocus: !q });
  const back = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/explorer')) }, icon('back'));
  const head = h('header', { class: 'page-head sticky search-head' }, back, bar);
  const body = h('div', { class: 'search-body' });
  const cleanups = [];
  ctx.onCleanup(() => cleanups.forEach((fn) => fn()));
  document.body.classList.add('no-side-search');
  cleanups.push(() => document.body.classList.remove('no-side-search'));

  // Suggestions pendant la saisie
  const suggest = h('div', { class: 'suggest-list', hidden: true });
  const showSuggest = debounce(async () => {
    const v = cleanQuery(bar.input.value);
    if (!v) {
      suggest.hidden = true;
      return;
    }
    try {
      const r = await api.get(`/api/search/suggest?q=${enc(v)}`);
      // Réponse arrivée trop tard : la saisie a changé depuis
      if (v !== cleanQuery(bar.input.value) || document.activeElement !== bar.input) return;
      suggest.replaceChildren(
        h('a', { href: `/recherche?q=${enc(v)}`, class: 'suggest-q' }, icon('search', 'icon-sm'), h('span', { class: 'suggest-text' }, v)),
        ...r.tags.map((t) => h('a', { href: `/tag/${enc(t.tag)}`, class: 'suggest-q' }, h('span', { class: 'tag-ic small' }, '#'), h('span', { class: 'suggest-text' }, t.tag), h('small', null, count(t.posts, 'publication')))),
        ...r.users.map((u) => h('a', { href: `/@${enc(u.username)}`, class: 'suggest-user' }, avatar(u, 'sm'), h('span', null, h('b', null, u.displayName), h('small', null, `@${u.username}`)))),
      );
      suggest.hidden = false;
    } catch {
      suggest.hidden = true;
    }
  }, 180);
  bar.input.addEventListener('input', showSuggest);
  bar.input.addEventListener('focus', () => cleanQuery(bar.input.value) && cleanQuery(bar.input.value) !== q && showSuggest());
  bar.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') suggest.hidden = true;
  });
  // Un toucher ailleurs ferme les suggestions
  const outside = (e) => {
    if (!suggest.hidden && !suggest.contains(e.target) && !bar.contains(e.target)) suggest.hidden = true;
  };
  document.addEventListener('pointerdown', outside, true);
  cleanups.push(() => document.removeEventListener('pointerdown', outside, true));
  bar.addEventListener('submit', () => {
    const v = cleanQuery(bar.input.value);
    suggest.hidden = true;
    if (v) remember(v);
  });

  if (!q) {
    const hist = readHistory();
    const trending = h('div', { class: 'trend-list' }, spinner());
    api.get('/api/trending').then(({ tags }) => {
      trending.replaceChildren(...tags.slice(0, 12).map((t) => h('a', { href: `/tag/${enc(t.tag)}`, class: 'trend compact' }, h('span', { class: 'trend-hash' }, '#'), h('span', { class: 'trend-main' }, h('b', null, t.tag), h('small', null, `${count(t.posts, 'publication')} · ${count(t.views, 'vue')}`)))));
      if (!tags.length) trending.replaceChildren(h('p', { class: 'muted small' }, 'Pas encore de tendance.'));
    }).catch(() => trending.replaceChildren());
    body.append(
      hist.length
        ? h('section', { class: 'search-history' }, h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, 'Recherches récentes'), h('button', { type: 'button', class: 'link-btn', onclick: (e) => { saveHistory([]); e.currentTarget.closest('section').remove(); } }, 'Tout effacer')), hist.map((x) => h('div', { class: 'history-row' }, h('a', { href: `/recherche?q=${enc(x)}`, class: 'history-item' }, icon('clock', 'icon-sm'), h('span', null, x)), h('button', { type: 'button', class: 'history-del', 'aria-label': `Retirer « ${x} » des recherches récentes`, onclick: (e) => { saveHistory(readHistory().filter((y) => y !== x)); const sec = e.currentTarget.closest('section'); e.currentTarget.closest('.history-row').remove(); if (!sec.querySelector('.history-row')) sec.remove(); } }, icon('x', 'icon-sm')))))
        : null,
      h('section', null, h('h2', { class: 'section-title' }, 'Tendances'), trending),
    );
    return h('div', { class: 'page search' }, head, suggest, body);
  }

  remember(q);
  // Changer d'onglet ne s'empile pas dans l'historique : « Retour » ramène avant la recherche
  const tabs = h('nav', { class: 'tabs scroll-x search-tabs', role: 'tablist' }, TABS.map(([k, label]) => h('a', { href: `/recherche?q=${enc(q)}&type=${k}`, class: `tab-link${k === type ? ' on' : ''}`, role: 'tab', 'aria-selected': String(k === type), onclick: (e) => { e.preventDefault(); if (k !== type) navigate(`/recherche?q=${enc(q)}&type=${k}`, { replace: true }); } }, label)));
  revealActive(tabs);
  const results = h('div', { class: 'search-results' }, spinner());

  if (type === 'videos') {
    const g = videoGrid({ showAuthor: true, fetchPage: async (cursor) => api.get(`/api/search?q=${enc(q)}&type=videos${cursor ? `&cursor=${cursor}` : ''}`).then((d) => ({ posts: d.posts, cursor: d.cursor })), empty: emptyState('search', 'Aucune vidéo trouvée', `Rien pour « ${q} » pour l’instant.`) });
    cleanups.push(g.destroy);
    results.replaceChildren(g.el);
  } else {
    try {
      const d = await api.get(`/api/search?q=${enc(q)}&type=${type}`);
      const parts = [];
      const section = (title, items, moreType) => items?.length
        ? h('section', { class: 'result-section' }, title ? h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, title), moreType && items.length >= TOP_SIZE[moreType] ? h('a', { href: `/recherche?q=${enc(q)}&type=${moreType}`, class: 'link-btn', onclick: (e) => { e.preventDefault(); navigate(`/recherche?q=${enc(q)}&type=${moreType}`, { replace: true }); } }, 'Voir plus') : null) : null, items)
        : null;
      if (d.users) parts.push(section(type === 'top' ? 'Comptes' : null, d.users.map((u) => userRow(u)), type === 'top' ? 'users' : null));
      if (d.lives) parts.push(section(type === 'top' ? 'LIVE' : null, d.lives.map(liveRow)));
      if (d.tags) parts.push(section(type === 'top' ? 'Hashtags' : null, d.tags.map(tagRow), type === 'top' ? 'tags' : null));
      if (d.sounds) parts.push(section(type === 'top' ? 'Sons' : null, d.sounds.map(soundRow), type === 'top' ? 'sounds' : null));
      if (d.posts?.length) {
        const posts = d.posts;
        const grid = h('div', { class: 'grid cols-3' }, posts.map((p) => tile(p, { showAuthor: true, onOpen: (post) => openViewer(posts, { startId: post.id }) })));
        parts.push(h('section', { class: 'result-section' }, h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, 'Vidéos'), posts.length >= TOP_SIZE.videos ? h('a', { href: `/recherche?q=${enc(q)}&type=videos`, class: 'link-btn', onclick: (e) => { e.preventDefault(); navigate(`/recherche?q=${enc(q)}&type=videos`, { replace: true }); } }, 'Voir plus') : null), grid));
      }
      const filled = parts.filter(Boolean);
      results.replaceChildren(...(filled.length ? filled : [emptyState('search', ...(EMPTY[type] || EMPTY.top)(q))]));
    } catch (err) {
      toast(err.message, 'error');
      results.replaceChildren();
    }
  }
  body.append(tabs, results);
  return h('div', { class: 'page search' }, head, suggest, body);
}
