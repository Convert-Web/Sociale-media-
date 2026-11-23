// Explorer : recherche, hashtags du moment, catégories, vidéos populaires.
import { api, enc } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, count, skeletonGrid } from '../dom.js';
import { videoGrid } from '../components/grid.js';

export function searchBar(value = '', { autofocus = false } = {}) {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher', value, enterkeyhint: 'search', 'aria-label': 'Rechercher', autofocus });
  const form = h('form', { class: 'searchbar', role: 'search', onsubmit: (e) => { e.preventDefault(); const q = input.value.trim(); if (q) navigate(`/recherche?q=${enc(q)}`); } }, icon('search'), input, h('button', { type: 'submit', class: 'searchbar-go' }, 'Rechercher'));
  form.input = input;
  return form;
}

export async function exploreView(ctx) {
  ctx.title = 'Explorer — Vibz';
  ctx.description = 'Les vidéos, hashtags et créateurs du moment sur Vibz.';
  const cats = store.config?.categories || [];
  let category = ctx.query.get('categorie') || '';
  const chips = h('div', { class: 'chips', role: 'tablist' });
  const trends = h('div', { class: 'trends' });
  const gridHost = h('div', null, skeletonGrid(9));
  let grid = null;
  const paintChips = () => {
    chips.replaceChildren(
      h('button', { type: 'button', class: `chip${!category ? ' on' : ''}`, onclick: () => pick('') }, 'Tout'),
      ...cats.map((c) => h('button', { type: 'button', class: `chip${category === c.id ? ' on' : ''}`, onclick: () => pick(c.id) }, `${c.emoji} ${c.label}`)),
    );
  };
  function pick(id) {
    category = id;
    history.replaceState(history.state, '', id ? `/explorer?categorie=${id}` : '/explorer');
    paintChips();
    mount();
  }
  function mount() {
    grid?.destroy();
    grid = videoGrid({
      showAuthor: true,
      fetchPage: async (cursor) => {
        const d = await api.get(`/api/discover?${new URLSearchParams({ ...(category ? { category } : {}), ...(cursor ? { cursor } : {}) })}`);
        if (!cursor) paintTrends(d.tags);
        return { posts: d.posts, cursor: d.cursor };
      },
      columns: 3,
    });
    gridHost.replaceChildren(grid.el);
  }
  function paintTrends(tags) {
    if (!tags?.length) return;
    trends.replaceChildren(
      h('h2', { class: 'section-title' }, 'Tendances'),
      h('div', { class: 'trend-list' }, tags.slice(0, 10).map((t, i) => h('a', { href: `/tag/${enc(t.tag)}`, class: 'trend' }, h('span', { class: 'trend-rank' }, String(i + 1)), h('span', { class: 'trend-hash' }, '#'), h('span', { class: 'trend-main' }, h('b', null, t.tag), h('small', null, `${count(t.posts, 'publication')} · ${count(t.views, 'vue')}`))))),
    );
  }
  paintChips();
  mount();
  ctx.onCleanup(() => grid?.destroy());
  return h('div', { class: 'page explore' }, h('header', { class: 'page-head sticky' }, searchBar()), chips, trends, h('h2', { class: 'section-title' }, 'Populaire'), gridHost);
}
