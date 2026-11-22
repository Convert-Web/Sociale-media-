// Recherche : suggestions pendant la saisie, historique, puis résultats en onglets
// (Top, Comptes, Vidéos, Sons, Hashtags, LIVE).
import { api, enc } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, short, count, debounce, emptyState, spinner, avatar, toast } from '../dom.js';
import { searchBar } from './explore.js';
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
const tagRow = (t) => h('a', { href: `/tag/${enc(t.tag)}`, class: 'tag-row' }, h('span', { class: 'tag-ic' }, '#'), h('span', { class: 'tag-text' }, h('b', null, t.tag), h('small', null, `${short(t.posts)} publication${t.posts > 1 ? 's' : ''}`)), icon('chevron', 'icon-sm'));
const liveRow = (l) => h('a', { href: `/live/${enc(l.host.username)}`, class: 'live-row' }, avatar({ ...l.host, live: l.id }, 'md', { live: true }), h('span', null, h('b', null, l.host.displayName), h('small', null, `${l.title || 'En LIVE'} · ${short(l.viewers)} spectateur${l.viewers > 1 ? 's' : ''}`)));

export async function searchView(ctx) {
  const q = (ctx.query.get('q') || '').trim();
  const type = TABS.some(([k]) => k === ctx.query.get('type')) ? ctx.query.get('type') : 'top';
  ctx.title = q ? `${q} — Recherche Vibz` : 'Recherche — Vibz';
  const bar = searchBar(q, { autofocus: !q });
  const back = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/explorer')) }, icon('back'));
  const head = h('header', { class: 'page-head sticky search-head' }, back, bar);
  const body = h('div', { class: 'search-body' });
  const cleanups = [];
  ctx.onCleanup(() => cleanups.forEach((fn) => fn()));

  // Suggestions pendant la saisie
  const suggest = h('div', { class: 'suggest-list', hidden: true });
  const showSuggest = debounce(async () => {
    const v = bar.input.value.trim();
    if (!v) {
      suggest.hidden = true;
      return;
    }
    try {
      const r = await api.get(`/api/search/suggest?q=${enc(v)}`);
      suggest.replaceChildren(
        h('a', { href: `/recherche?q=${enc(v)}`, class: 'suggest-q' }, icon('search', 'icon-sm'), v),
        ...r.tags.map((t) => h('a', { href: `/tag/${enc(t.tag)}`, class: 'suggest-q' }, h('span', { class: 'tag-ic small' }, '#'), t.tag, h('small', null, `${short(t.posts)}`))),
        ...r.users.map((u) => h('a', { href: `/@${enc(u.username)}`, class: 'suggest-user' }, avatar(u, 'sm'), h('span', null, h('b', null, u.displayName), h('small', null, `@${u.username}`)))),
      );
      suggest.hidden = false;
    } catch {
      suggest.hidden = true;
    }
  }, 180);
  bar.input.addEventListener('input', showSuggest);
  bar.addEventListener('submit', () => {
    const v = bar.input.value.trim();
    if (v) remember(v);
  });

  if (!q) {
    const hist = readHistory();
    const trending = h('div', { class: 'trend-list' }, spinner());
    api.get('/api/trending').then(({ tags }) => {
      trending.replaceChildren(...tags.slice(0, 12).map((t) => h('a', { href: `/tag/${enc(t.tag)}`, class: 'trend compact' }, h('span', { class: 'trend-hash' }, '#'), h('span', { class: 'trend-main' }, h('b', null, t.tag), h('small', null, count(t.views, 'vue'))))));
      if (!tags.length) trending.replaceChildren(h('p', { class: 'muted small' }, 'Pas encore de tendance.'));
    }).catch(() => trending.replaceChildren());
    body.append(
      hist.length
        ? h('section', { class: 'search-history' }, h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, 'Recherches récentes'), h('button', { type: 'button', class: 'link-btn', onclick: (e) => { saveHistory([]); e.currentTarget.closest('section').remove(); } }, 'Effacer')), hist.map((x) => h('a', { href: `/recherche?q=${enc(x)}`, class: 'history-item' }, icon('clock', 'icon-sm'), h('span', null, x))))
        : null,
      h('section', null, h('h2', { class: 'section-title' }, 'Tendances'), trending),
    );
    return h('div', { class: 'page search' }, head, suggest, body);
  }

  remember(q);
  const tabs = h('nav', { class: 'tabs scroll-x', role: 'tablist' }, TABS.map(([k, label]) => h('a', { href: `/recherche?q=${enc(q)}&type=${k}`, class: `tab-link${k === type ? ' on' : ''}`, role: 'tab', 'aria-selected': String(k === type) }, label)));
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
        ? h('section', { class: 'result-section' }, title ? h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, title), moreType ? h('a', { href: `/recherche?q=${enc(q)}&type=${moreType}`, class: 'link-btn' }, 'Voir plus') : null) : null, items)
        : null;
      if (d.users) parts.push(section(type === 'top' ? 'Comptes' : null, d.users.map((u) => userRow(u)), type === 'top' ? 'users' : null));
      if (d.lives) parts.push(section(type === 'top' ? 'LIVE' : null, d.lives.map(liveRow)));
      if (d.tags) parts.push(section(type === 'top' ? 'Hashtags' : null, d.tags.map(tagRow), type === 'top' ? 'tags' : null));
      if (d.sounds) parts.push(section(type === 'top' ? 'Sons' : null, d.sounds.map(soundRow), type === 'top' ? 'sounds' : null));
      if (d.posts?.length) {
        const posts = d.posts;
        const grid = h('div', { class: 'grid cols-3' }, posts.map((p) => tile(p, { showAuthor: true, onOpen: (post) => openViewer(posts, { startId: post.id }) })));
        parts.push(h('section', { class: 'result-section' }, h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, 'Vidéos'), h('a', { href: `/recherche?q=${enc(q)}&type=videos`, class: 'link-btn' }, 'Voir plus')), grid));
      }
      const filled = parts.filter(Boolean);
      results.replaceChildren(...(filled.length ? filled : [emptyState('search', 'Aucun résultat', `Rien ne correspond à « ${q} ». Essaie un autre mot ou un #hashtag.`)]));
    } catch (err) {
      toast(err.message, 'error');
      results.replaceChildren();
    }
  }
  body.append(tabs, results);
  return h('div', { class: 'page search' }, head, suggest, body);
}
