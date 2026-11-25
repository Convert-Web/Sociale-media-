// L'Actu : l'actualité du jour en un coup d'œil — la une, le brief, les podcasts à écouter, les
// vidéos des médias, et l'actualité qui fait réagir la communauté en vidéo. Les articles se lisent
// chez les médias ; « Réagir en vidéo » relie une création d’AURUM à l'actualité.
import { api } from '../api.js';
import { store } from '../store.js';
import { replaceUrl } from '../router.js';
import { h, icon, toast, spinner, emptyState, count, infinite, timeAgo } from '../dom.js';
import { openActu, mediaImg, sourceLine, podcastButton, TOPIC_LABELS } from '../components/actusheet.js';
import { fmtTime } from '../components/player.js';
import { revealActive } from './explore.js';

// Rubriques et formats proposés en haut de page
const FILTERS = [
  ['', 'L’essentiel'],
  ...Object.entries(TOPIC_LABELS).filter(([k]) => k !== 'une'),
  ['podcasts', 'Podcasts'],
  ['videos', 'Vidéos'],
];

const open = (it, reload) => (e) => {
  e.preventDefault();
  openActu(it, { onChange: reload });
};

// Une ligne : source et heure, titre, réactions ; image à droite
function row(it, reload) {
  return h('a', { href: `/actu/${it.id}`, class: 'actu-row', onclick: open(it, reload) },
    h('span', { class: 'actu-row-text' },
      h('small', { class: 'actu-src' }, it.kind === 'podcast' ? icon('headphones', 'icon-xs') : it.kind === 'video' ? icon('playBadge', 'icon-xs') : null, sourceLine(it)),
      h('b', null, it.title),
      it.reactions ? h('small', { class: 'actu-react' }, icon('video', 'icon-xs'), count(it.reactions, 'réaction')) : null),
    it.image ? h('span', { class: `actu-thumb${it.kind === 'video' ? ' is-video' : ''}` }, mediaImg(it.image), it.kind === 'video' ? h('span', { class: 'actu-thumb-play' }, icon('play', 'icon-xs')) : null) : null);
}

// La une : grande image, titre, chapeau
function leadCard(it, reload, small = false) {
  return h('a', { href: `/actu/${it.id}`, class: `actu-lead${small ? ' small' : ''}`, onclick: open(it, reload) },
    it.image ? h('span', { class: 'actu-card-img' }, mediaImg(it.image)) : null,
    h('span', { class: 'actu-lead-text' },
      h('small', { class: 'actu-kicker' }, it.featured ? 'À la une' : it.topic ? TOPIC_LABELS[it.topic] : 'À la une', ' · ', sourceLine(it)),
      h('b', null, it.title),
      !small && it.summary ? h('span', { class: 'actu-lead-sum' }, it.summary) : null,
      it.reactions ? h('small', { class: 'actu-react' }, icon('video', 'icon-xs'), count(it.reactions, 'réaction')) : null));
}

// Carte d'épisode (à écouter) et carte vidéo (à regarder), en rangées défilantes
function podCard(it, reload) {
  return h('div', { class: 'actu-pod' },
    h('a', { href: `/actu/${it.id}`, class: 'actu-pod-art', onclick: open(it, reload) }, mediaImg(it.image)),
    h('div', { class: 'actu-pod-text' }, h('a', { href: `/actu/${it.id}`, onclick: open(it, reload) }, h('b', null, it.title)), h('small', null, `${it.siteName}${it.duration ? ` · ${fmtTime(it.duration)}` : ''}`)),
    podcastButton(it));
}
function videoCard(it, reload) {
  return h('a', { href: `/actu/${it.id}`, class: 'actu-vid', onclick: open(it, reload) },
    h('span', { class: 'actu-card-img' }, mediaImg(it.image), h('span', { class: 'actu-thumb-play' }, icon('play'))),
    h('b', null, it.title), h('small', null, sourceLine(it)));
}
function reactedCard(it, reload) {
  return h('a', { href: `/actu/${it.id}`, class: 'actu-reacted', onclick: open(it, reload) },
    h('span', { class: 'actu-card-img' }, mediaImg(it.image), h('span', { class: 'actu-reacted-count' }, icon('video', 'icon-xs'), String(it.reactions))),
    h('b', null, it.title), h('small', null, it.siteName));
}

const section = (title, sub, content, more = null) => h('section', { class: 'actu-section' }, h('div', { class: 'section-row' }, h('h2', { class: 'section-title' }, title, sub ? h('small', null, sub) : null), more), content);

const today = () => {
  const s = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export async function actuView(ctx) {
  ctx.title = 'Actu — AURUM';
  ctx.description = 'L’actualité du jour en un coup d’œil : articles, podcasts et vidéos des médias, et les réactions en vidéo de la communauté AURUM.';
  let filter = FILTERS.some(([k]) => k === ctx.query.get('rubrique')) ? ctx.query.get('rubrique') : '';
  const chips = h('div', { class: 'chips actu-chips', role: 'tablist', 'aria-label': 'Rubriques' });
  const content = h('div', { class: 'actu-content' });
  const updated = h('small', { class: 'actu-updated' });
  const fresh = h('button', { type: 'button', class: 'actu-fresh', hidden: true, onclick: () => { fresh.hidden = true; render(); content.scrollIntoView({ block: 'start' }); } }, icon('arrowUp', 'icon-xs'), 'Nouveautés');
  let stopList = () => {};
  ctx.onCleanup(() => stopList());

  const paintChips = () => {
    chips.replaceChildren(...FILTERS.map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === filter), class: `chip${k === filter ? ' on' : ''}`, onclick: () => pick(k) }, label)));
    revealActive(chips);
  };
  const pick = (k) => {
    if (k === filter) return;
    filter = k;
    replaceUrl(k ? `/actu?rubrique=${k}` : '/actu');
    paintChips();
    render();
  };

  // Liste infinie (rubrique, format, ou « Les dernières » sous l'essentiel)
  function list(params, empty) {
    const host = h('div', { class: params.kind === 'video' ? 'actu-vid-grid' : 'actu-list' });
    const sentinel = h('div', { class: 'grid-sentinel' });
    let before = null;
    let done = false;
    let busy = false;
    const load = async () => {
      if (busy || done) return;
      busy = true;
      try {
        const q = new URLSearchParams({ ...params, ...(before ? { before } : {}) });
        const d = await api.get(`/api/actu?${q}`);
        for (const it of d.items) host.append(params.kind === 'video' ? videoCard(it, render) : params.kind === 'podcast' ? podCard(it, render) : row(it, render));
        if (!before && !d.items.length) host.append(empty);
        before = d.items[d.items.length - 1]?.publishedAt || before;
        done = !d.hasMore;
      } catch (err) {
        toast(err.message, 'error');
        done = true;
      } finally {
        busy = false;
      }
    };
    stopList();
    stopList = infinite(sentinel, load);
    load();
    return h('div', null, host, sentinel);
  }

  async function home() {
    const d = await api.get('/api/actu/une');
    const empty = !d.lead.length && !d.brief.length && !d.podcasts.length && !d.videos.length;
    paintUpdated(d.refreshedAt);
    if (empty) return { empty: true, stale: d.stale };
    const [lead, ...others] = d.lead;
    return {
      stale: d.stale,
      el: h('div', null,
        lead ? leadCard(lead, render) : null,
        others.length ? h('div', { class: 'actu-lead-more' }, others.map((x) => leadCard(x, render, true))) : null,
        d.brief.length ? section('Le brief', 'Les titres du moment', h('ol', { class: 'actu-brief' }, d.brief.map((it) => h('li', null, h('a', { href: `/actu/${it.id}`, onclick: open(it, render) }, h('b', null, it.title), h('small', null, sourceLine(it))))))) : null,
        d.reacted.length ? section('Ça fait réagir', 'L’actualité commentée en vidéo par la communauté', h('div', { class: 'actu-rail' }, d.reacted.map((it) => reactedCard(it, render)))) : null,
        d.podcasts.length ? section('À écouter', 'Les derniers épisodes', h('div', { class: 'actu-rail' }, d.podcasts.map((it) => podCard(it, render))), h('button', { type: 'button', class: 'link-btn', onclick: () => pick('podcasts') }, 'Tout voir')) : null,
        d.videos.length ? section('À regarder', 'Les vidéos des médias', h('div', { class: 'actu-rail' }, d.videos.map((it) => videoCard(it, render))), h('button', { type: 'button', class: 'link-btn', onclick: () => pick('videos') }, 'Tout voir')) : null,
        section('Les dernières', null, list({ kind: 'article' }, emptyState('newspaper', 'Pas encore d’article', null))),
      ),
    };
  }

  function paintUpdated(at) {
    updated.textContent = at ? `${today()} · mise à jour ${timeAgo(at)}` : today();
  }

  // Flux relus en arrière-plan quand l'Actu date un peu ; les nouveautés s'affichent sur demande
  let refreshing = false;
  async function refreshInBackground({ show = false } = {}) {
    if (refreshing) return;
    refreshing = true;
    try {
      const r = await api.post('/api/actu/refresh');
      if (!r.skipped && r.added && content.isConnected) {
        if (show) render();
        else fresh.hidden = false;
      }
    } catch {
      /* nouvel essai à la prochaine visite */
    } finally {
      refreshing = false;
    }
  }

  let token = 0;
  async function render() {
    const mine = ++token;
    content.replaceChildren(h('div', { class: 'actu-loading' }, spinner()));
    try {
      if (!filter) {
        const r = await home();
        if (mine !== token) return;
        if (r.empty) {
          // Toute première visite : les flux sont lus maintenant (quelques secondes)
          content.replaceChildren(h('div', { class: 'actu-first' }, spinner(), h('p', null, 'On rassemble l’actualité du jour…')));
          if (r.stale) {
            await refreshInBackground({ show: false });
            if (mine !== token) return;
            const again = await home();
            if (mine !== token) return;
            if (!again.empty) return content.replaceChildren(again.el);
          }
          return content.replaceChildren(emptyState('newspaper', 'Pas encore d’actualité', store.user?.isAdmin ? 'Ajoute des sources dans Administration → Actu.' : 'Reviens dans un instant.'));
        }
        content.replaceChildren(r.el);
        if (r.stale) refreshInBackground();
        return;
      }
      const params = filter === 'podcasts' ? { kind: 'podcast' } : filter === 'videos' ? { kind: 'video' } : { topic: filter };
      const label = FILTERS.find(([k]) => k === filter)?.[1] || '';
      content.replaceChildren(list(params, emptyState(filter === 'podcasts' ? 'headphones' : filter === 'videos' ? 'playBadge' : 'newspaper', `Rien en « ${label} » pour l’instant`, 'Les nouveautés arrivent au fil de la journée.')));
    } catch (err) {
      if (mine === token) content.replaceChildren(emptyState('alert', 'Actu indisponible', err.message, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: render }, 'Réessayer')));
    }
  }

  paintChips();
  paintUpdated(null);
  render();
  // Lien partagé vers une actualité : elle s'ouvre par-dessus l'Actu
  if (ctx.params.id) setTimeout(() => openActu(Number(ctx.params.id), { onChange: render }), 200);

  const adminBtn = store.user?.isAdmin ? h('a', { href: '/admin?onglet=actu', class: 'icon-btn', 'aria-label': 'Gérer les sources de l’Actu' }, icon('settings')) : h('span', { class: 'icon-btn' });
  return h('div', { class: 'page actu' },
    h('header', { class: 'page-head actu-head' }, h('span', { class: 'icon-btn' }), h('h1', null, 'Actu'), adminBtn),
    updated, chips, fresh, content);
}
