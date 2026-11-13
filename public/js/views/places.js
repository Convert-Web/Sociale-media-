// Le Carnet d'adresses : les recommandations des membres.
import { api } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, avatar, nameLine, toast, popMenu, confirmDialog, emptyState, spinner, num, modal, autosize, debounce, clear, monthYear } from '../dom.js';
import { cropImage } from '../components/cropper.js';
import { backHead } from './feed.js';
import { mapsUrl } from './events.js';

export const CATEGORIES = {
  restaurant: { one: 'Restaurant', many: 'Restaurants' },
  hotel: { one: 'Hôtel', many: 'Hôtels' },
  bar: { one: 'Bar & cave', many: 'Bars & caves' },
  boutique: { one: 'Boutique', many: 'Boutiques' },
  artisan: { one: 'Artisan', many: 'Artisans' },
  bienetre: { one: 'Bien-être', many: 'Bien-être' },
  services: { one: 'Services', many: 'Services' },
  voyage: { one: 'Voyage', many: 'Voyages' },
};

function placeDialog() {
  let photo = null;
  const name = h('input', { class: 'input', maxlength: 80, required: true, placeholder: 'Ex. : Le Cinq' });
  const category = h('select', { class: 'input', required: true }, h('option', { value: '' }, 'Choisir…'), Object.entries(CATEGORIES).map(([k, c]) => h('option', { value: k }, c.one)));
  const cityList = h('datalist', { id: 'carnet-villes' });
  const city = h('input', { class: 'input', maxlength: 60, required: true, placeholder: 'Paris', list: 'carnet-villes', autocapitalize: 'words' });
  const address = h('input', { class: 'input', maxlength: 160, placeholder: 'Rue, numéro (facultatif)' });
  const website = h('input', { class: 'input', maxlength: 200, inputmode: 'url', placeholder: 'site.com (facultatif)' });
  const note = h('textarea', { class: 'textarea', maxlength: 600, rows: 4, required: true, placeholder: 'Pourquoi cette adresse ? Ce qu’il faut commander, demander, savoir…' });
  const preview = h('div', { class: 'place-photo-pick' }, icon('camera'), h('span', null, 'Ajouter une photo'));
  const picker = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Ajouter au carnet');
  api
    .get('/api/places-meta')
    .then(({ cities }) => cityList.replaceChildren(...cities.map((c) => h('option', { value: c.city }))))
    .catch(() => {});
  let m;
  const open = () => {
    m = modal('Recommander une adresse', form);
    if (photo) preview.replaceChildren(h('img', { src: URL.createObjectURL(photo), alt: '' }));
    autosize(note);
  };
  picker.addEventListener('change', async () => {
    const f = picker.files[0];
    picker.value = '';
    if (!f) return;
    const cropped = await cropImage(f, { aspect: 4 / 3, outWidth: 1400, title: 'Photo de l’adresse' });
    if (cropped) photo = cropped;
    open();
  });
  preview.addEventListener('click', () => picker.click());
  const form = h(
    'form',
    {
      class: 'modal-body',
      style: { display: 'grid', gap: '14px' },
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          const fd = new FormData();
          fd.append('name', name.value);
          fd.append('category', category.value);
          fd.append('city', city.value);
          fd.append('address', address.value);
          fd.append('website', website.value);
          fd.append('note', note.value);
          if (photo) fd.append('photo', photo, 'photo.jpg');
          const { place } = await api.post('/api/places', fd);
          m.close();
          toast('Adresse ajoutée au carnet.');
          navigate(`/carnet/${place.id}`);
        } catch (err) {
          submit.disabled = false;
          toast(err.message, 'error');
        }
      },
    },
    preview,
    picker,
    h('label', { class: 'field' }, h('span', null, 'Nom'), name),
    h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', null, 'Catégorie'), category), h('label', { class: 'field' }, h('span', null, 'Ville'), city, cityList)),
    h('label', { class: 'field' }, h('span', null, 'Adresse'), address),
    h('label', { class: 'field' }, h('span', null, 'Site web'), website),
    h('label', { class: 'field' }, h('span', null, 'Votre recommandation'), note),
    submit,
  );
  open();
}

function placeCard(p) {
  const others = p.endorseCount;
  return h(
    'a',
    { href: `/carnet/${p.id}`, class: 'place-card' },
    h('div', { class: 'place-thumb' }, p.photo ? h('img', { src: p.photo, alt: '', loading: 'lazy' }) : icon('book')),
    h(
      'div',
      { class: 'place-info' },
      h('b', null, p.name),
      h('small', null, `${CATEGORIES[p.category]?.one || 'Adresse'} · ${p.city}`),
      h('p', { class: 'place-note' }, `« ${p.note} »`),
      h('span', { class: 'place-by' }, avatar(p.author, 'xs'), h('span', null, p.author.displayName.split(/\s+/)[0], others ? ` et ${num(others)} autre${others > 1 ? 's' : ''}` : '')),
    ),
  );
}

// ---------------------------------------------------------------------------
// /carnet
// ---------------------------------------------------------------------------
export function carnetView(ctx) {
  const state = { category: ctx.query.get('categorie') || '', city: ctx.query.get('ville') || '', q: '' };
  const list = h('div', { class: 'place-list' });
  const moreBtn = h('button', { class: 'btn btn-ghost btn-block', hidden: true }, 'Voir plus d’adresses');
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Nom, plat, quartier…', 'aria-label': 'Rechercher dans le carnet' });
  const catChips = h('div', { class: 'chips filter-chips' });
  const cityChips = h('div', { class: 'chips filter-chips' });
  let before = null;

  const chip = (label, active, onclick) => h('button', { class: `chip${active ? ' active' : ''}`, type: 'button', onclick }, label);
  function paintChips(meta) {
    catChips.replaceChildren(
      chip('Tout', !state.category, () => setFilter('category', '')),
      ...Object.entries(CATEGORIES).map(([k, c]) => chip(c.many, state.category === k, () => setFilter('category', k))),
    );
    if (meta) cityChips.cities = meta.cities;
    const cities = cityChips.cities || [];
    cityChips.hidden = cities.length < 2;
    cityChips.replaceChildren(
      chip('Toutes les villes', !state.city, () => setFilter('city', '')),
      ...cities.map((c) => chip(c.city, state.city.toLowerCase() === c.city.toLowerCase(), () => setFilter('city', c.city))),
    );
  }
  function setFilter(key, value) {
    state[key] = value;
    paintChips();
    load(true);
  }

  async function load(reset) {
    if (reset) {
      before = null;
      list.replaceChildren(spinner());
    }
    const qs = new URLSearchParams();
    if (state.category) qs.set('category', state.category);
    if (state.city) qs.set('city', state.city);
    if (state.q) qs.set('q', state.q);
    if (before) qs.set('before', String(before));
    try {
      const { places, hasMore } = await api.get(`/api/places?${qs}`);
      if (reset) clear(list);
      if (reset && !places.length) {
        const filtered = state.category || state.city || state.q;
        list.append(
          filtered
            ? emptyState('search', 'Aucune adresse ici', 'Essayez une autre catégorie ou une autre ville.')
            : emptyState('book', 'Le carnet est encore vierge', 'Partagez vos meilleures adresses : une table, un hôtel, un tailleur, un médecin de confiance…', h('button', { class: 'btn btn-primary', onclick: placeDialog }, 'Recommander une adresse')),
        );
      }
      for (const p of places) list.append(placeCard(p));
      if (places.length) before = places[places.length - 1].id;
      moreBtn.hidden = !hasMore;
    } catch (err) {
      list.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message));
    }
  }
  search.addEventListener(
    'input',
    debounce(() => {
      state.q = search.value.trim();
      load(true);
    }, 300),
  );
  moreBtn.addEventListener('click', () => load(false));

  paintChips();
  api.get('/api/places-meta').then(paintChips).catch(() => {});
  load(true);

  ctx.title = 'Carnet d’adresses — AURUM';
  return h(
    'div',
    null,
    h(
      'header',
      { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', null, 'Carnet'), h('div', { class: 'sub' }, 'Les adresses recommandées par les membres')),
      h('button', { class: 'btn btn-primary btn-sm', onclick: placeDialog }, icon('plus', 'icon-sm'), 'Recommander'),
    ),
    h('div', { class: 'explore-search' }, h('div', { class: 'search-box' }, icon('search'), search)),
    catChips,
    cityChips,
    list,
    h('div', { style: { padding: '8px 0 24px' } }, moreBtn),
  );
}

// ---------------------------------------------------------------------------
// /carnet/:id
// ---------------------------------------------------------------------------
export async function placeView(ctx) {
  let p;
  try {
    ({ place: p } = await api.get(`/api/places/${Number(ctx.params.id)}`));
  } catch (err) {
    return h('div', null, backHead('Adresse'), emptyState('book', 'Adresse introuvable', err.message, h('a', { href: '/carnet', class: 'btn btn-ghost' }, 'Voir le carnet')));
  }
  ctx.title = `${p.name} — Carnet AURUM`;
  const reload = () => navigate(`/carnet/${p.id}`, { replace: true });

  const toggle = async () => {
    try {
      if (p.endorsed) await api.del(`/api/places/${p.id}/endorse`);
      else await api.post(`/api/places/${p.id}/endorse`);
      toast(p.endorsed ? 'Recommandation retirée.' : 'Merci : votre recommandation compte.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  const more = h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Plus d’options' }, icon('more'));
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    const items = [{ icon: 'link', label: 'Copier le lien', action: () => navigator.clipboard?.writeText(`${location.origin}/carnet/${p.id}`).then(() => toast('Lien copié.'), () => {}) }];
    if (p.canDelete) {
      items.push({
        icon: 'trash',
        label: 'Retirer du carnet',
        danger: true,
        action: async () => {
          if (!(await confirmDialog('Retirer cette adresse ?', 'Elle disparaîtra du carnet, avec ses recommandations.', 'Retirer'))) return;
          try {
            await api.del(`/api/places/${p.id}`);
            toast('Adresse retirée.');
            navigate('/carnet', { replace: true });
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      });
    }
    popMenu(more, items);
  });

  const fullAddress = [p.address, p.city].filter(Boolean).join(', ');
  const action = p.mine
    ? h('span', { class: 'tag tag-gold' }, icon('check', 'icon-xs'), 'Votre recommandation')
    : h('button', { class: `btn ${p.endorsed ? 'btn-secondary' : 'btn-primary'}`, onclick: toggle }, icon(p.endorsed ? 'check' : 'heart', 'icon-sm'), p.endorsed ? 'Vous la recommandez' : 'Je recommande aussi');

  return h(
    'div',
    null,
    backHead(p.name, `${CATEGORIES[p.category]?.one || 'Adresse'} · ${p.city}`),
    p.photo ? h('div', { class: 'place-hero' }, h('img', { src: p.photo, alt: '' })) : null,
    h(
      'section',
      { class: 'event-top' },
      h('span', { class: 'eyebrow' }, `${CATEGORIES[p.category]?.one || 'Adresse'} · ${p.city}`),
      h('h1', { class: 'place-title' }, p.name),
      h(
        'ul',
        { class: 'event-facts' },
        h('li', null, icon('pin'), h('span', { class: 'grow' }, fullAddress), h('a', { href: mapsUrl(`${p.name}, ${fullAddress}`), target: '_blank', rel: 'noopener', class: 'btn btn-ghost btn-sm' }, icon('navigation', 'icon-sm'), 'Itinéraire')),
        p.website ? h('li', null, icon('globe'), h('a', { href: p.website, target: '_blank', rel: 'noopener noreferrer nofollow', class: 'grow' }, p.website.replace(/^https?:\/\/(www\.)?/, ''))) : null,
      ),
      h(
        'figure',
        { class: 'place-quote' },
        h('blockquote', null, p.note),
        h('figcaption', null, avatar(p.author, 'sm'), h('span', null, nameLine(p.author), h('small', null, `Recommandé en ${monthYear(p.createdAt)}`))),
      ),
      h('div', { class: 'event-actions' }, action, more),
    ),
    p.endorsers.length
      ? h(
          'div',
          null,
          h('div', { class: 'section-title' }, `Recommandé aussi par ${num(p.endorsers.length)} membre${p.endorsers.length > 1 ? 's' : ''}`),
          h('div', { class: 'explore-list' }, p.endorsers.map((u) => h('a', { href: `/@${u.username}`, class: 'user-row' }, avatar(u), h('span', { class: 'meta' }, nameLine(u, { link: false }), h('small', null, `@${u.username}`))))),
        )
      : null,
  );
}
