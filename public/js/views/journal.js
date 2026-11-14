// Le Journal : actualités, podcasts et vidéos choisis pour le cercle.
import { api } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, nameLine, toast, popMenu, confirmDialog, emptyState, spinner, modal, timeAgo, debounce, skeletonPosts } from '../dom.js';
import { backHead } from './feed.js';
import { playItem, isCurrent, onPlayer, state as playerState, fmtTime } from '../components/player.js';

const KIND_LABEL = { article: 'Actualité', podcast: 'Podcast', video: 'Vidéo' };
const KIND_ICON = { article: 'newspaper', podcast: 'headphones', video: 'video' };
const minutes = (s) => (s ? (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}` : `${Math.max(1, Math.round(s / 60))} min`) : '');
const meta = (it) => [it.siteName, timeAgo(it.publishedAt), it.kind === 'podcast' ? minutes(it.duration) : ''].filter(Boolean).join(' · ');

// Image d'un site extérieur : chargement différé, sans transmettre l'adresse d'AURUM,
// et remplacée par une icône si elle ne se charge pas (plus de case grise vide).
function extImg(src, fallback = 'newspaper', { lazy = true } = {}) {
  const img = h('img', { src, alt: '', loading: lazy ? 'lazy' : 'eager', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => {
    const box = img.parentElement;
    img.remove();
    if (box && !box.querySelector('.icon')) box.prepend(icon(fallback));
    box?.classList.add('img-failed');
  });
  return img;
}

// Relecture des flux en arrière-plan quand le Journal date de plus de 20 minutes
let refreshing = null;
export function refreshJournal() {
  if (!refreshing) {
    refreshing = api
      .post('/api/journal/refresh')
      .catch(() => ({ added: 0 }))
      .finally(() => setTimeout(() => (refreshing = null), 60000));
  }
  return refreshing;
}

function itemMenu(item, btn, onChange) {
  const items = [
    { icon: 'link', label: 'Copier le lien', action: () => navigator.clipboard?.writeText(item.url).then(() => toast('Lien copié.'), () => {}) },
  ];
  if (item.kind !== 'article') items.unshift({ icon: 'external', label: `Ouvrir sur ${item.siteName || 'le site'}`, action: () => window.open(item.url, '_blank', 'noopener') });
  if (store.user.isAdmin) {
    items.push({
      icon: 'star',
      label: item.featured ? 'Retirer de la une' : 'Mettre à la une',
      action: async () => {
        try {
          await api.post(`/api/journal/${item.id}/feature`, { featured: !item.featured });
          toast(item.featured ? 'Retiré de la une.' : 'Mis à la une du Journal.');
          onChange?.();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    });
  }
  if (item.canDelete) {
    items.push({
      icon: 'trash',
      label: 'Retirer du Journal',
      danger: true,
      action: async () => {
        if (!(await confirmDialog('Retirer ce contenu ?', 'Il disparaîtra du Journal pour tous les membres.', 'Retirer'))) return;
        try {
          await api.del(`/api/journal/${item.id}`);
          toast('Contenu retiré.');
          onChange?.();
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    });
  }
  popMenu(btn, items);
}

function moreButton(item, onChange) {
  const btn = h('button', { class: 'icon-btn journal-more', 'aria-label': 'Options', type: 'button' }, icon('more'));
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    itemMenu(item, btn, onChange);
  });
  return btn;
}

function sharedNote(item) {
  if (!item.sharedBy) return null;
  return h('span', { class: 'journal-shared' }, avatar(item.sharedBy, 'xs'), h('span', null, item.note ? `« ${item.note} »` : `Partagé par ${item.sharedBy.displayName.split(/\s+/)[0]}`));
}

// Lien d'un élément : article → site d'origine ; vidéo et podcast → page du Journal
const hrefOf = (it) => (it.kind === 'article' ? { href: it.url, target: '_blank', rel: 'noopener noreferrer' } : { href: `/journal/${it.id}` });

function playButton(it) {
  const btn = h('button', { class: 'journal-play', type: 'button', 'aria-label': `Écouter ${it.title}` });
  const paint = () => {
    const s = playerState();
    const on = isCurrent(it) && s.playing;
    btn.replaceChildren(icon(on ? 'pause' : 'play'));
    btn.classList.toggle('on', isCurrent(it));
  };
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (it.audioUrl) playItem(it);
    else navigate(`/journal/${it.id}`);
  });
  paint();
  // L'abonnement s'arrête de lui-même quand la carte a quitté la page
  const off = onPlayer(() => (btn.isConnected ? paint() : off()));
  return btn;
}

export function journalCard(it, { onChange, variant } = {}) {
  if (variant === 'hero') {
    return h(
      'a',
      { ...hrefOf(it), class: 'journal-hero' },
      it.image ? extImg(it.image, 'newspaper', { lazy: false }) : null,
      h(
        'span',
        { class: 'journal-hero-text' },
        h('small', null, it.featured ? 'À la une' : KIND_LABEL[it.kind], ' · ', it.siteName),
        h('b', null, it.title),
        it.summary ? h('span', null, it.summary) : null,
      ),
      it.kind === 'video' ? h('span', { class: 'journal-video-badge' }, icon('play')) : null,
      moreButton(it, onChange),
    );
  }
  if (it.kind === 'video') {
    return h(
      'a',
      { ...hrefOf(it), class: 'journal-video' },
      h('span', { class: 'journal-thumb' }, it.image ? extImg(it.image, 'video') : icon('video'), h('span', { class: 'journal-video-badge' }, icon('play'))),
      h('span', { class: 'journal-text' }, h('small', null, meta(it)), h('b', null, it.title), sharedNote(it)),
      moreButton(it, onChange),
    );
  }
  if (it.kind === 'podcast') {
    return h(
      'a',
      { ...hrefOf(it), class: 'journal-podcast' },
      h('span', { class: 'journal-art' }, it.image ? extImg(it.image, 'headphones') : icon('headphones')),
      h('span', { class: 'journal-text' }, h('small', null, it.siteName), h('b', null, it.title), h('span', { class: 'journal-when' }, [minutes(it.duration), timeAgo(it.publishedAt)].filter(Boolean).join(' · ')), sharedNote(it)),
      playButton(it),
      moreButton(it, onChange),
    );
  }
  return h(
    'a',
    { ...hrefOf(it), class: 'journal-article' },
    h('span', { class: 'journal-text' }, h('small', null, meta(it)), h('b', null, it.title), it.summary ? h('span', { class: 'journal-summary' }, it.summary) : null, sharedNote(it)),
    it.image ? h('span', { class: 'journal-art' }, extImg(it.image, 'newspaper')) : null,
    moreButton(it, onChange),
  );
}

// ---------------------------------------------------------------------------
// Partager un lien (tous les membres)
// ---------------------------------------------------------------------------
function shareDialog(onDone) {
  const url = h('input', { class: 'input', type: 'url', inputmode: 'url', required: true, placeholder: 'https://…', autocomplete: 'off' });
  const previewBox = h('div', { class: 'journal-preview' }, h('p', { class: 'muted small' }, 'Collez le lien d’un article, d’une vidéo (YouTube, Vimeo…) ou d’un podcast (Spotify, Apple Podcasts…).'));
  const note = h('textarea', { class: 'textarea', rows: 2, maxlength: 500, placeholder: 'Pourquoi le recommandez-vous ? (facultatif)' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit', disabled: true }, 'Publier dans le Journal');
  let last = '';
  const preview = async () => {
    const v = url.value.trim();
    if (!/^https?:\/\/\S+\.\S+/.test(v) || v === last) return;
    last = v;
    previewBox.replaceChildren(spinner());
    submit.disabled = true;
    try {
      const { preview: p } = await api.post('/api/journal/preview', { url: v });
      previewBox.replaceChildren(
        h(
          'div',
          { class: 'journal-preview-card' },
          p.image ? h('img', { src: p.image, alt: '' }) : h('span', { class: 'journal-preview-icon' }, icon(KIND_ICON[p.kind])),
          h('span', null, h('small', null, `${KIND_LABEL[p.kind]} · ${p.siteName}`), h('b', null, p.title)),
        ),
      );
      submit.disabled = false;
    } catch (err) {
      previewBox.replaceChildren(h('p', { class: 'form-error' }, err.message));
    }
  };
  url.addEventListener('input', debounce(preview, 500));
  url.addEventListener('paste', () => setTimeout(preview, 50));
  const m = modal(
    'Partager dans le Journal',
    h(
      'form',
      {
        class: 'modal-body',
        style: { display: 'grid', gap: '14px' },
        onsubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          try {
            await api.post('/api/journal', { url: url.value.trim(), note: note.value });
            m.close();
            toast('Partagé dans le Journal.');
            onDone?.();
          } catch (err) {
            submit.disabled = false;
            toast(err.message, 'error');
          }
        },
      },
      h('label', { class: 'field' }, h('span', null, 'Lien'), url),
      previewBox,
      h('label', { class: 'field' }, h('span', null, 'Votre mot'), note),
      submit,
    ),
  );
}

// ---------------------------------------------------------------------------
// Sources (Direction)
// ---------------------------------------------------------------------------
function sourcesDialog(onChange) {
  const list = h('div', { class: 'sources-list' }, spinner());
  const addInput = h('input', { class: 'input', type: 'url', inputmode: 'url', placeholder: 'Site, flux RSS, chaîne YouTube, podcast Apple…' });
  const addBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Ajouter');
  const searchInput = h('input', { class: 'input', type: 'search', placeholder: 'Nom d’un podcast…' });
  const results = h('div', { class: 'sources-results' });
  const refreshBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, icon('rss', 'icon-sm'), 'Actualiser maintenant');

  async function load() {
    try {
      const { sources } = await api.get('/api/journal/sources');
      const groups = ['article', 'podcast', 'video'].map((k) => [k, sources.filter((s) => s.kind === k)]).filter(([, l]) => l.length);
      list.replaceChildren(
        ...(sources.length
          ? groups.flatMap(([k, l]) => [
              h('div', { class: 'sources-title' }, { article: 'Actualités', podcast: 'Podcasts', video: 'Vidéos' }[k]),
              ...l.map((s) =>
                h(
                  'div',
                  { class: 'source-row' },
                  h('span', { class: 'source-icon' }, s.image ? h('img', { src: s.image, alt: '' }) : icon(KIND_ICON[s.kind])),
                  h(
                    'span',
                    { class: 'grow' },
                    h('b', null, s.title),
                    s.error
                      ? h('small', { class: 'source-error' }, `Indisponible : ${s.error}`)
                      : h('small', null, s.lastFetchedAt ? `${s.items} élément${s.items > 1 ? 's' : ''} · lu ${timeAgo(s.lastFetchedAt)}` : 'En attente de la première lecture'),
                  ),
                  h('button', {
                    class: 'icon-btn',
                    type: 'button',
                    'aria-label': `Retirer ${s.title}`,
                    onclick: async () => {
                      if (!(await confirmDialog(`Retirer « ${s.title} » ?`, 'Ses contenus disparaîtront du Journal.', 'Retirer'))) return sourcesDialog(onChange);
                      try {
                        await api.del(`/api/journal/sources/${s.id}`);
                        toast('Source retirée.');
                        onChange?.();
                      } catch (err) {
                        toast(err.message, 'error');
                      }
                      sourcesDialog(onChange);
                    },
                  }, icon('x')),
                ),
              ),
            ])
          : [h('p', { class: 'muted small' }, 'Aucune source pour le moment.')]),
      );
    } catch (err) {
      list.replaceChildren(h('p', { class: 'form-error' }, err.message));
    }
  }

  const add = async (value, btn) => {
    if (!value) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Lecture…';
    try {
      const { source } = await api.post('/api/journal/sources', { url: value });
      toast(`« ${source.title} » ajouté (${source.items} élément${source.items > 1 ? 's' : ''}).`);
      addInput.value = '';
      onChange?.();
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = label;
  };

  searchInput.addEventListener(
    'input',
    debounce(async () => {
      const q = searchInput.value.trim();
      if (q.length < 2) return results.replaceChildren();
      results.replaceChildren(spinner());
      try {
        const { results: found } = await api.post('/api/journal/sources/search', { q });
        results.replaceChildren(
          ...(found.length
            ? found.map((p) => {
                const b = h('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, 'Ajouter');
                b.addEventListener('click', () => add(p.feedUrl, b));
                return h('div', { class: 'source-row' }, h('span', { class: 'source-icon' }, p.image ? h('img', { src: p.image, alt: '' }) : icon('headphones')), h('span', { class: 'grow' }, h('b', null, p.title), h('small', null, p.author)), b);
              })
            : [h('p', { class: 'muted small' }, 'Aucun podcast trouvé.')]),
        );
      } catch (err) {
        results.replaceChildren(h('p', { class: 'form-error' }, err.message));
      }
    }, 400),
  );

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      const r = await api.post('/api/journal/refresh', { force: true });
      toast(r.skipped ? 'Une lecture est déjà en cours.' : r.added ? `${r.added} nouveau${r.added > 1 ? 'x' : ''} contenu${r.added > 1 ? 's' : ''}.` : 'Le Journal est à jour.');
      onChange?.();
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
    refreshBtn.disabled = false;
  });

  modal(
    'Sources du Journal',
    h(
      'div',
      { class: 'modal-body', style: { display: 'grid', gap: '16px' } },
      h('form', { class: 'admission-code', onsubmit: (e) => (e.preventDefault(), add(addInput.value.trim(), addBtn)) }, addInput, addBtn),
      h('label', { class: 'field' }, h('span', null, 'Ou cherchez un podcast'), searchInput),
      results,
      h('div', { class: 'row-between' }, h('b', null, 'Sources suivies'), refreshBtn),
      list,
      h('p', { class: 'muted small' }, 'Les sources sont relues automatiquement toutes les 20 minutes. Certains journaux refusent la lecture automatique de leurs flux : ils apparaissent alors comme « indisponibles ».'),
    ),
  );
  load();
}

// ---------------------------------------------------------------------------
// /journal
// ---------------------------------------------------------------------------
export function journalView(ctx) {
  const TABS = [
    ['', 'À la une'],
    ['article', 'Actualités'],
    ['podcast', 'Podcasts'],
    ['video', 'Vidéos'],
  ];
  let kind = TABS.some(([k]) => k === ctx.query.get('type')) ? ctx.query.get('type') : '';
  const tabs = TABS.map(([k, label]) => {
    const b = h('button', { class: 'tab' }, label);
    b.addEventListener('click', () => {
      kind = k;
      history.replaceState(null, '', k ? `/journal?type=${k}` : '/journal');
      load(true);
    });
    return { k, b };
  });
  const list = h('div', { class: 'journal-list' });
  const more = h('button', { class: 'btn btn-ghost btn-block', hidden: true }, 'Voir plus');
  const pill = h('div', { class: 'new-posts', hidden: true });
  let before = null;

  async function load(reset) {
    for (const t of tabs) t.b.classList.toggle('active', t.k === kind);
    if (reset) {
      before = null;
      pill.hidden = true;
      list.replaceChildren(skeletonPosts(3));
    }
    try {
      if (!kind) return await loadFront();
      const d = await api.get(`/api/journal?kind=${kind}&${before ? `before=${before}&` : ''}limit=20`);
      if (reset) list.replaceChildren();
      let items = d.items;
      if (reset && !items.length && !d.featured.length) {
        list.append(
          d.stale
            ? h('div', { class: 'journal-loading' }, spinner(), h('p', { class: 'muted' }, 'Le Journal se prépare : lecture des sources…'))
            : emptyState(KIND_ICON[kind] || 'newspaper', 'Rien pour le moment', 'Partagez un article, une vidéo ou un podcast avec le cercle.'),
        );
      }
      // En tête : la une choisie par la Direction, sinon le contenu illustré le plus récent
      if (reset && !kind) {
        const hero = d.featured[0] || items.find((i) => i.image);
        if (hero) {
          list.append(journalCard(hero, { variant: 'hero', onChange: () => load(true) }));
          items = items.filter((i) => i.id !== hero.id);
        }
      }
      for (const it of items) list.append(journalCard(it, { onChange: () => load(true) }));
      if (d.items.length) before = d.items[d.items.length - 1].publishedAt;
      more.hidden = !d.hasMore;
      if (reset && d.stale) {
        refreshJournal().then((r) => {
          if (!r?.added || !list.isConnected) return;
          if (!d.items.length) return load(true);
          pill.replaceChildren(h('button', { class: 'btn btn-primary btn-sm', onclick: () => load(true) }, icon('sparkles'), `${r.added} nouveau${r.added > 1 ? 'x' : ''} contenu${r.added > 1 ? 's' : ''}`));
          pill.hidden = false;
        });
      }
    } catch (err) {
      list.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message));
    }
  }
  // « À la une » : une mise en page de magazine (la une, les actualités, à écouter, à regarder)
  const section = (title, k) =>
    h(
      'div',
      { class: 'journal-section' },
      h('b', null, title),
      h('button', { class: 'link-btn', onclick: () => tabs.find((t) => t.k === k).b.click() }, 'Tout voir', icon('chevron', 'icon-xs')),
    );
  async function loadFront() {
    const [all, arts, pods, vids] = await Promise.all([
      api.get('/api/journal?limit=1'),
      api.get('/api/journal?kind=article&limit=12'),
      api.get('/api/journal?kind=podcast&limit=3'),
      api.get('/api/journal?kind=video&limit=3'),
    ]);
    list.replaceChildren();
    more.hidden = true;
    const card = (it) => journalCard(it, { onChange: () => load(true) });
    const total = arts.items.length + pods.items.length + vids.items.length;
    if (!total && !all.featured.length) {
      list.append(
        all.stale
          ? h('div', { class: 'journal-loading' }, spinner(), h('p', { class: 'muted' }, 'Le Journal se prépare : lecture des sources…'))
          : emptyState('newspaper', 'Rien pour le moment', 'Partagez un article, une vidéo ou un podcast avec le cercle.'),
      );
    }
    const hero = all.featured[0] || arts.items.find((i) => i.image) || vids.items[0];
    if (hero) list.append(journalCard(hero, { variant: 'hero', onChange: () => load(true) }));
    const articles = arts.items.filter((i) => i.id !== hero?.id);
    articles.slice(0, 4).forEach((it) => list.append(card(it)));
    const podcasts = pods.items.filter((i) => i.id !== hero?.id);
    if (podcasts.length) list.append(section('À écouter', 'podcast'), ...podcasts.map(card));
    const videos = vids.items.filter((i) => i.id !== hero?.id);
    if (videos.length) list.append(section('À regarder', 'video'), ...videos.slice(0, 2).map(card));
    if (articles.length > 4) list.append(section('Actualités', 'article'), ...articles.slice(4, 10).map(card));
    if (all.stale) {
      refreshJournal().then((r) => {
        if (!r?.added || !list.isConnected || kind) return;
        if (!total) return load(true);
        pill.replaceChildren(h('button', { class: 'btn btn-primary btn-sm', onclick: () => load(true) }, icon('sparkles'), `${r.added} nouveau${r.added > 1 ? 'x' : ''} contenu${r.added > 1 ? 's' : ''}`));
        pill.hidden = false;
      });
    }
  }

  more.addEventListener('click', () => load(false));
  load(true);

  ctx.title = 'Journal — AURUM';
  return h(
    'div',
    null,
    h(
      'header',
      { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', null, 'Journal'), h('div', { class: 'sub' }, 'Actualités, podcasts et vidéos')),
      store.user.isAdmin ? h('button', { class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Sources du Journal', title: 'Sources', onclick: () => sourcesDialog(() => load(true)) }, icon('rss', 'icon-sm')) : null,
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => shareDialog(() => load(true)) }, icon('plus', 'icon-sm'), 'Partager'),
    ),
    h('div', { class: 'tabs' }, tabs.map((t) => t.b)),
    pill,
    list,
    h('div', { style: { padding: '8px 0 28px' } }, more),
  );
}

// ---------------------------------------------------------------------------
// /journal/:id — lecteur vidéo / podcast, ou fiche d'article
// ---------------------------------------------------------------------------
export async function journalItemView(ctx) {
  let it;
  try {
    ({ item: it } = await api.get(`/api/journal/${Number(ctx.params.id)}`));
  } catch (err) {
    return h('div', null, backHead('Journal'), emptyState('newspaper', 'Contenu introuvable', err.message, h('a', { href: '/journal', class: 'btn btn-ghost' }, 'Retour au Journal')));
  }
  ctx.title = `${it.title} — Journal AURUM`;
  let player = null;
  if (it.embedUrl) {
    const isVideo = it.kind === 'video';
    const src = /youtube-nocookie/.test(it.embedUrl) ? `${it.embedUrl}?rel=0&playsinline=1&modestbranding=1` : it.embedUrl;
    const tall = /spotify\.com\/embed\/(show|playlist|album)|embed\.podcasts\.apple\.com\/[^?]*\/id\d+$/.test(it.embedUrl);
    player = h(
      'div',
      { class: isVideo ? 'journal-frame video' : `journal-frame audio${tall ? ' tall' : ''}` },
      h('iframe', { src, title: it.title, loading: 'lazy', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin' }),
    );
  } else if (it.audioUrl) {
    const listen = h('button', { class: 'btn btn-primary btn-lg' });
    const paint = () => {
      const s = playerState();
      const on = isCurrent(it) && s.playing;
      listen.replaceChildren(icon(on ? 'pause' : 'play', 'icon-sm'), on ? 'Pause' : isCurrent(it) ? 'Reprendre' : 'Écouter', it.duration ? ` · ${minutes(it.duration)}` : null);
    };
    listen.addEventListener('click', () => playItem(it));
    paint();
    ctx.onCleanup(onPlayer(paint));
    player = h('div', { class: 'journal-listen' }, h('span', { class: 'journal-art big' }, it.image ? extImg(it.image, 'headphones', { lazy: false }) : icon('headphones')), listen);
  } else if (it.image) {
    player = h('div', { class: 'cover journal-cover' }, extImg(it.image, 'newspaper', { lazy: false }));
  }

  const moreBtn = h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Options' }, icon('more'));
  moreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    itemMenu(it, moreBtn, () => navigate('/journal', { replace: true }));
  });

  return h(
    'div',
    null,
    backHead(it.siteName || 'Journal', KIND_LABEL[it.kind]),
    player,
    h(
      'section',
      { class: 'event-top' },
      h('span', { class: 'eyebrow' }, [KIND_LABEL[it.kind], it.siteName, timeAgo(it.publishedAt)].filter(Boolean).join(' · ')),
      h('h1', { class: 'place-title' }, it.title),
      it.summary ? h('p', { class: 'event-desc' }, it.summary) : null,
      it.sharedBy
        ? h('figure', { class: 'place-quote' }, it.note ? h('blockquote', null, it.note) : null, h('figcaption', null, avatar(it.sharedBy, 'sm'), h('span', null, nameLine(it.sharedBy), h('small', null, 'a partagé ce contenu avec le cercle'))))
        : null,
      h(
        'div',
        { class: 'event-actions' },
        h('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer', class: `btn ${it.kind === 'article' ? 'btn-primary' : 'btn-secondary'}` }, icon('external', 'icon-sm'), it.kind === 'article' ? `Lire sur ${it.siteName || 'le site'}` : `Ouvrir sur ${it.siteName || 'le site'}`),
        moreBtn,
      ),
    ),
  );
}

// Bandeau « Le Journal » en tête du Salon
export function journalStrip() {
  const host = h('div');
  const paint = (items) => {
    if (!items.length) return host.replaceChildren();
    host.replaceChildren(
      h(
        'section',
        { class: 'journal-strip' },
        h('div', { class: 'strip-head' }, h('b', null, 'Le Journal'), h('a', { href: '/journal' }, 'Tout voir', icon('chevron', 'icon-xs'))),
        h(
          'div',
          { class: 'strip-row' },
          items.map((it) =>
            h(
              'a',
              { ...hrefOf(it), class: 'strip-card' },
              h('span', { class: 'strip-img' }, it.image ? extImg(it.image, KIND_ICON[it.kind]) : icon(KIND_ICON[it.kind]), it.kind !== 'article' ? h('span', { class: 'strip-kind' }, icon(it.kind === 'video' ? 'play' : 'headphones')) : null),
              h('small', null, it.siteName),
              h('b', null, it.title),
            ),
          ),
        ),
      ),
    );
  };
  api
    .get('/api/journal?limit=8')
    .then((d) => {
      paint([...d.featured, ...d.items.filter((i) => !d.featured.some((f) => f.id === i.id))].slice(0, 8));
      if (d.stale) refreshJournal().then((r) => r?.added && api.get('/api/journal?limit=8').then((x) => paint([...x.featured, ...x.items].slice(0, 8))));
    })
    .catch(() => {});
  return host;
}
