// Explorer : recherche, hashtags du moment, catégories, vidéos populaires.
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate, replaceUrl } from '../router.js';
import { h, icon, count, emptyState } from '../dom.js';
import { videoGrid } from '../components/grid.js';
import { openActu, sourceLine } from '../components/actusheet.js';

// Saisie nettoyée (espaces multiples) ; limite du serveur : 80 caractères
export const cleanQuery = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);

export function searchBar(value = '', { autofocus = false } = {}) {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Vidéos, comptes, #hashtags, sons', value, maxlength: 80, enterkeyhint: 'search', 'aria-label': 'Rechercher', autofocus });
  const form = h('form', { class: 'searchbar', role: 'search', onsubmit: (e) => { e.preventDefault(); const q = cleanQuery(input.value); if (q) navigate(`/recherche?q=${enc(q)}`); } }, icon('search'), input, h('button', { type: 'submit', class: 'searchbar-go' }, 'Rechercher'));
  form.input = input;
  return form;
}

// Ligne de rangée défilante : l'élément choisi bien visible (téléphone)
export function revealActive(row, selector = '.on') {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const on = row?.querySelector(selector);
      if (!on || !row.isConnected || row.scrollWidth <= row.clientWidth) return;
      row.scrollLeft = Math.max(0, on.offsetLeft - row.offsetLeft - (row.clientWidth - on.offsetWidth) / 2);
    }),
  );
}

// Dernière grille affichée : au retour d'une vidéo, elle revient telle quelle (position comprise)
let cache = null;
const CACHE_MS = 10 * 60e3;

export async function exploreView(ctx) {
  ctx.title = 'Explorer — Vibz';
  ctx.description = 'Les vidéos, hashtags et créateurs du moment sur Vibz.';
  const cats = store.config?.categories || [];
  let category = ctx.query.get('categorie') || '';
  if (category && !cats.some((c) => c.id === category)) category = '';
  const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Catégories' });
  const trends = h('section', { class: 'trends' });
  // L'actu du jour : trois titres, et l'Actu en un toucher
  const news = h('section', { class: 'explore-news', hidden: true });
  api.get('/api/actu/une').then((d) => {
    const items = [...d.lead, ...d.brief].slice(0, 3);
    if (!items.length || !news.isConnected) return;
    news.hidden = false;
    news.replaceChildren(
      h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, 'L’actu du jour'), h('a', { href: '/actu', class: 'link-btn' }, 'Toute l’Actu')),
      h('div', { class: 'explore-news-list' }, items.map((it) => h('a', { href: `/actu/${it.id}`, class: 'explore-news-item', onclick: (e) => { e.preventDefault(); openActu(it); } }, h('b', null, it.title), h('small', null, sourceLine(it))))),
    );
  }).catch(() => {});
  const gridHost = h('div');
  let grid = null;
  // Sur ordinateur, la recherche de la barre latérale ferait doublon
  document.body.classList.add('no-side-search');
  ctx.onCleanup(() => document.body.classList.remove('no-side-search'));

  const paintChips = () => {
    chips.replaceChildren(
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(!category), class: `chip${!category ? ' on' : ''}`, onclick: () => pick('') }, 'Tout'),
      ...cats.map((c) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(category === c.id), class: `chip${category === c.id ? ' on' : ''}`, onclick: () => pick(c.id) }, `${c.emoji} ${c.label}`)),
    );
    revealActive(chips);
  };
  function pick(id) {
    if (id === category) return;
    category = id;
    replaceUrl(id ? `/explorer?categorie=${id}` : '/explorer');
    paintChips();
    mount();
  }
  const label = () => cats.find((c) => c.id === category)?.label || '';
  function mount(initial = null) {
    grid?.destroy();
    if (!initial) paintTrends(null);
    const cat = category;
    grid = videoGrid({
      showAuthor: true,
      initial,
      fetchPage: async (cursor) => {
        const d = await api.get(`/api/discover?${new URLSearchParams({ ...(cat ? { category: cat } : {}), ...(cursor ? { cursor } : {}) })}`);
        if (!cursor && cat === category) {
          paintTrends(d.tags);
          cache = { category: cat, posts: [], cursor: null, tags: d.tags, at: Date.now() };
        }
        return { posts: d.posts, cursor: d.cursor };
      },
      onPage: ({ posts, cursor }) => {
        if (cache && cache.category === cat) Object.assign(cache, { posts: [...posts], cursor, at: Date.now() });
      },
      empty: cat
        ? emptyState('video', `Pas encore de vidéo « ${label()} »`, 'Reviens bientôt, ou publie la première.', h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => pick('') }, 'Voir toutes les vidéos'))
        : emptyState('video', 'Aucune vidéo pour l’instant', 'Les vidéos publiées apparaîtront ici.'),
      columns: 3,
    });
    gridHost.replaceChildren(grid.el);
  }
  // Tendances : place réservée pendant le chargement ; 5 sur téléphone (« Voir tout »), 10 ailleurs
  function paintTrends(tags) {
    if (tags === null) {
      trends.hidden = false;
      trends.replaceChildren(h('h2', { class: 'section-title' }, 'Tendances'), h('div', { class: 'trend-list', 'aria-hidden': 'true' }, Array.from({ length: 5 }, () => h('div', { class: 'trend sk-trend' }, h('i', { class: 'sk sk-round' }), h('span', { class: 'trend-main' }, h('i', { class: 'sk', style: { width: '40%' } }), h('i', { class: 'sk', style: { width: '62%' } }))))));
      return;
    }
    if (!tags?.length) {
      trends.hidden = true;
      return;
    }
    trends.hidden = false;
    trends.replaceChildren(
      h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, category ? `Tendances · ${label()}` : 'Tendances'), tags.length > 5 ? h('a', { href: '/recherche', class: 'link-btn trends-all' }, 'Voir tout') : null),
      h('div', { class: 'trend-list' }, tags.slice(0, 10).map((t, i) => h('a', { href: `/tag/${enc(t.tag)}`, class: 'trend' }, h('span', { class: 'trend-rank' }, String(i + 1)), h('span', { class: 'trend-hash' }, '#'), h('span', { class: 'trend-main' }, h('b', null, t.tag), h('small', null, `${count(t.posts, 'publication')} · ${count(t.views, 'vue')}`))))),
    );
  }
  paintChips();
  // Retour en arrière : la grille revient d'un coup, comme on l'avait laissée
  const fresh = ctx.pop && cache && cache.category === category && Date.now() - cache.at < CACHE_MS && cache.posts.length;
  if (fresh) {
    paintTrends(cache.tags);
    mount({ posts: cache.posts, cursor: cache.cursor });
  } else {
    mount();
  }
  ctx.onCleanup(() => grid?.destroy());
  return h('div', { class: 'page explore' }, h('header', { class: 'page-head sticky' }, searchBar()), chips, news, trends, h('h2', { class: 'section-title' }, 'Populaire'), gridHost);
}
