// L'Agenda du cercle : événements privés entre membres.
import { api } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon, avatar, nameLine, memberChip, toast, popMenu, confirmDialog, emptyState, spinner, num, modal, autosize, verifiedMark } from '../dom.js';
import { cropImage } from '../components/cropper.js';
import { backHead } from './feed.js';

const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const dayFmtShort = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const hourFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const monthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function dateTile(ts) {
  const d = new Date(ts);
  return h('span', { class: 'date-tile', 'aria-hidden': 'true' }, h('small', null, monthShort.format(d).replace('.', '')), h('b', null, String(d.getDate())));
}
const when = (e, long = false) => {
  const start = new Date(e.startsAt);
  const day = cap((long ? dayFmt : dayFmtShort).format(start));
  const end = e.endsAt ? ` – ${hourFmt.format(new Date(e.endsAt))}` : '';
  return `${day} · ${hourFmt.format(start)}${end}`;
};
const isApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
export const mapsUrl = (q) => (isApple() ? `https://maps.apple.com/?q=${encodeURIComponent(q)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`);

// Fichier .ics : « Ajouter au calendrier » (Calendrier d'Apple, Google, Outlook)
function downloadIcs(e) {
  const stamp = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AURUM//Agenda du cercle//FR',
    'BEGIN:VEVENT',
    `UID:aurum-event-${e.id}@${location.hostname}`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(e.startsAt)}`,
    `DTEND:${stamp(e.endsAt || e.startsAt + 2 * 3600 * 1000)}`,
    `SUMMARY:${esc(e.title)}`,
    e.location ? `LOCATION:${esc(e.location)}` : null,
    `DESCRIPTION:${esc(`${e.description ? `${e.description}\n\n` : ''}${location.origin}/agenda/${e.id}`)}`,
    `URL:${location.origin}/agenda/${e.id}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${e.title.replace(/[^\p{L}\p{N} -]/gu, '').trim() || 'evenement'}.ics` });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

const toLocalInput = (ts) => {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Fenêtre de création / modification
function eventDialog(existing = null) {
  let cover = null;
  const title = h('input', { class: 'input', maxlength: 80, required: true, placeholder: 'Ex. : Dîner au Plaza Athénée', value: existing?.title || '' });
  const starts = h('input', { class: 'input', type: 'datetime-local', required: true, value: toLocalInput(existing?.startsAt), min: toLocalInput(Date.now()) });
  const ends = h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(existing?.endsAt) });
  const place = h('input', { class: 'input', maxlength: 140, placeholder: 'Adresse ou nom du lieu', value: existing?.location || '' });
  const capacity = h('input', { class: 'input', type: 'number', min: 1, max: 10000, inputmode: 'numeric', placeholder: 'Illimité', value: existing?.capacity || '' });
  const description = h('textarea', { class: 'textarea', maxlength: 2000, rows: 4, placeholder: 'Programme, tenue, informations pratiques…' });
  description.value = existing?.description || '';
  const preview = h('div', { class: 'event-cover-pick' }, icon('image'), h('span', null, 'Ajouter une photo'));
  const picker = h('input', { type: 'file', accept: 'image/*', hidden: true });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, existing ? 'Enregistrer' : 'Publier l’événement');
  let m;
  const open = () => {
    m = modal(existing ? 'Modifier l’événement' : 'Nouvel événement', form);
    if (cover) preview.replaceChildren(h('img', { src: URL.createObjectURL(cover), alt: '' }));
    autosize(description);
  };
  picker.addEventListener('change', async () => {
    const f = picker.files[0];
    picker.value = '';
    if (!f) return;
    const cropped = await cropImage(f, { aspect: 16 / 9, outWidth: 1600, title: 'Photo de l’événement' });
    if (cropped) cover = cropped;
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
        const startsAt = new Date(starts.value).getTime();
        const endsAt = ends.value ? new Date(ends.value).getTime() : '';
        if (!Number.isFinite(startsAt)) return toast('Choisissez la date et l’heure.', 'error');
        submit.disabled = true;
        try {
          let event;
          if (existing) {
            ({ event } = await api.patch(`/api/events/${existing.id}`, {
              title: title.value,
              startsAt,
              endsAt,
              location: place.value,
              capacity: capacity.value ? Number(capacity.value) : '',
              description: description.value,
            }));
          } else {
            const fd = new FormData();
            fd.append('title', title.value);
            fd.append('startsAt', String(startsAt));
            if (endsAt) fd.append('endsAt', String(endsAt));
            fd.append('location', place.value);
            if (capacity.value) fd.append('capacity', capacity.value);
            fd.append('description', description.value);
            if (cover) fd.append('cover', cover, 'cover.jpg');
            ({ event } = await api.post('/api/events', fd));
          }
          m.close();
          toast(existing ? 'Événement modifié.' : 'Événement publié dans l’Agenda.');
          navigate(`/agenda/${event.id}`, { replace: Boolean(existing) });
        } catch (err) {
          submit.disabled = false;
          toast(err.message, 'error');
        }
      },
    },
    existing ? null : preview,
    picker,
    h('label', { class: 'field' }, h('span', null, 'Titre'), title),
    h('div', { class: 'grid-2' }, h('label', { class: 'field' }, h('span', null, 'Début'), starts), h('label', { class: 'field' }, h('span', null, 'Fin (facultatif)'), ends)),
    h('label', { class: 'field' }, h('span', null, 'Lieu'), place),
    h('label', { class: 'field' }, h('span', null, 'Nombre de places'), capacity),
    h('label', { class: 'field' }, h('span', null, 'Description'), description),
    submit,
  );
  open();
}

function eventCard(e) {
  const stack = e.attendees?.length ? h('span', { class: 'avatar-stack' }, e.attendees.slice(0, 4).map((u) => avatar(u, 'xs'))) : null;
  return h(
    'a',
    { href: `/agenda/${e.id}`, class: `event-card${e.past ? ' past' : ''}` },
    h('div', { class: 'event-cover' }, e.cover ? h('img', { src: e.cover, alt: '', loading: 'lazy' }) : h('span', { class: 'event-cover-icon' }, icon('calendar'))),
    h(
      'div',
      { class: 'event-body' },
      dateTile(e.startsAt),
      h(
        'div',
        { class: 'event-info' },
        h('b', null, e.title),
        h('small', null, when(e)),
        e.location ? h('small', { class: 'event-loc' }, icon('pin', 'icon-xs'), e.location) : null,
        h(
          'div',
          { class: 'event-going' },
          stack,
          h('span', null, `${num(e.goingCount)} participant${e.goingCount > 1 ? 's' : ''}`),
          e.going ? h('span', { class: 'tag tag-gold' }, icon('check', 'icon-xs'), 'J’y vais') : e.full ? h('span', { class: 'tag' }, 'Complet') : null,
        ),
      ),
    ),
  );
}

// Carte « Prochain événement » en tête du Salon
export function nextEventCard() {
  const host = h('div');
  api
    .get('/api/events?limit=1')
    .then(({ events }) => {
      const e = events[0];
      if (!e) return;
      host.replaceChildren(
        h(
          'a',
          { href: `/agenda/${e.id}`, class: 'next-event' },
          dateTile(e.startsAt),
          h('span', { class: 'grow' }, h('small', null, 'Prochain événement du cercle'), h('b', null, e.title), h('span', { class: 'muted' }, `${when(e)} · ${num(e.goingCount)} participant${e.goingCount > 1 ? 's' : ''}`)),
          icon('chevron', 'icon-sm'),
        ),
      );
    })
    .catch(() => {});
  return host;
}

// ---------------------------------------------------------------------------
// /agenda
// ---------------------------------------------------------------------------
export function agendaView(ctx) {
  const tabs = {
    upcoming: h('button', { class: 'tab' }, 'À venir'),
    mine: h('button', { class: 'tab' }, 'Mes événements'),
    past: h('button', { class: 'tab' }, 'Passés'),
  };
  const body = h('div');
  let scope = 'upcoming';
  async function load() {
    for (const [k, t] of Object.entries(tabs)) t.classList.toggle('active', k === scope);
    body.replaceChildren(spinner());
    try {
      const { events } = await api.get(`/api/events?scope=${scope}`);
      if (!events.length) {
        const empty = {
          upcoming: emptyState('calendar', 'Aucun événement à venir', 'Dîner, vernissage, dégustation, voyage : proposez le premier rendez-vous du cercle.', h('button', { class: 'btn btn-primary', onclick: () => eventDialog() }, 'Organiser un événement')),
          mine: emptyState('calendar', 'Rien de prévu', 'Les événements que vous organisez ou auxquels vous participez apparaîtront ici.'),
          past: emptyState('clock', 'Pas encore d’événement passé', null),
        }[scope];
        return body.replaceChildren(empty);
      }
      body.replaceChildren(h('div', { class: 'event-list' }, events.map(eventCard)));
    } catch (err) {
      body.replaceChildren(h('p', { class: 'muted', style: { padding: '20px' } }, err.message));
    }
  }
  for (const [k, t] of Object.entries(tabs)) {
    t.addEventListener('click', () => {
      scope = k;
      load();
    });
  }
  load();
  ctx.title = 'Agenda — AURUM';
  return h(
    'div',
    null,
    h(
      'header',
      { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', null, 'Agenda'), h('div', { class: 'sub' }, 'Les rendez-vous privés du cercle')),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => eventDialog() }, icon('plus', 'icon-sm'), 'Organiser'),
    ),
    h('div', { class: 'tabs' }, Object.values(tabs)),
    body,
  );
}

// ---------------------------------------------------------------------------
// /agenda/:id
// ---------------------------------------------------------------------------
export async function eventView(ctx) {
  let e;
  try {
    ({ event: e } = await api.get(`/api/events/${Number(ctx.params.id)}`));
  } catch (err) {
    return h('div', null, backHead('Événement'), emptyState('calendar', 'Événement introuvable', err.message, h('a', { href: '/agenda', class: 'btn btn-ghost' }, 'Voir l’Agenda')));
  }
  ctx.title = `${e.title} — AURUM`;
  const reload = () => navigate(`/agenda/${e.id}`, { replace: true });
  const isHost = e.host.username === store.user.username;

  const attend = async (going) => {
    try {
      if (going) await api.post(`/api/events/${e.id}/attend`);
      else await api.del(`/api/events/${e.id}/attend`);
      toast(going ? 'C’est noté : vous y allez.' : 'Participation annulée.');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  let main;
  if (e.past) main = h('button', { class: 'btn btn-secondary', disabled: true }, 'Événement terminé');
  else if (isHost) main = h('span', { class: 'tag tag-gold event-host-tag' }, icon('crown', 'icon-xs'), 'Vous organisez');
  else if (e.going) {
    main = h('button', { class: 'btn btn-secondary' }, icon('check', 'icon-sm'), 'J’y vais');
    main.addEventListener('click', (ev) => {
      ev.stopPropagation();
      popMenu(main, [{ icon: 'x', label: 'Je ne viens plus', danger: true, action: () => attend(false) }]);
    });
  } else if (e.full) main = h('button', { class: 'btn btn-secondary', disabled: true }, 'Complet');
  else main = h('button', { class: 'btn btn-primary', onclick: () => attend(true) }, 'Je viens');

  const coverPicker = h('input', { type: 'file', accept: 'image/*', hidden: true });
  coverPicker.addEventListener('change', async () => {
    const f = coverPicker.files[0];
    coverPicker.value = '';
    if (!f) return;
    const cropped = await cropImage(f, { aspect: 16 / 9, outWidth: 1600, title: 'Photo de l’événement' });
    if (!cropped) return;
    const fd = new FormData();
    fd.append('cover', cropped, 'cover.jpg');
    try {
      await api.post(`/api/events/${e.id}/cover`, fd);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  const more = h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Plus d’options' }, icon('more'));
  more.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const items = [{ icon: 'link', label: 'Copier le lien', action: () => navigator.clipboard?.writeText(`${location.origin}/agenda/${e.id}`).then(() => toast('Lien copié.'), () => {}) }];
    if (e.canEdit) {
      items.push({ icon: 'pen', label: 'Modifier', action: () => eventDialog(e) });
      items.push({ icon: 'image', label: 'Changer la photo', action: () => coverPicker.click() });
      items.push({
        icon: 'trash',
        label: 'Annuler l’événement',
        danger: true,
        action: async () => {
          if (!(await confirmDialog('Annuler l’événement ?', 'Il disparaîtra de l’Agenda pour tous les participants.', 'Annuler l’événement'))) return;
          try {
            await api.del(`/api/events/${e.id}`);
            toast('Événement annulé.');
            navigate('/agenda', { replace: true });
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      });
    }
    popMenu(more, items);
  });

  const places = e.capacity ? `${num(e.goingCount)} / ${num(e.capacity)} places` : `${num(e.goingCount)} participant${e.goingCount > 1 ? 's' : ''}`;
  return h(
    'div',
    null,
    backHead('Événement', when(e)),
    h('div', { class: 'cover event-hero' }, e.cover ? h('img', { src: e.cover, alt: '' }) : h('span', { class: 'event-cover-icon' }, icon('calendar'))),
    coverPicker,
    h(
      'section',
      { class: 'event-top' },
      h('div', { class: 'event-title' }, dateTile(e.startsAt), h('h1', null, e.title)),
      h(
        'ul',
        { class: 'event-facts' },
        h('li', null, icon('clock'), h('span', null, when(e, true))),
        e.location
          ? h('li', null, icon('pin'), h('span', { class: 'grow' }, e.location), h('a', { href: mapsUrl(e.location), target: '_blank', rel: 'noopener', class: 'btn btn-ghost btn-sm' }, icon('navigation', 'icon-sm'), 'Itinéraire'))
          : null,
        h('li', null, icon('users'), h('span', null, places)),
        h('li', null, avatar(e.host, 'xs'), h('span', null, 'Organisé par ', h('a', { href: `/@${e.host.username}` }, e.host.displayName), e.host.verified ? verifiedMark() : null)),
      ),
      e.description ? h('p', { class: 'event-desc' }, e.description) : null,
      h('div', { class: 'event-actions' }, main, e.past ? null : h('button', { class: 'btn btn-ghost', onclick: () => downloadIcs(e) }, icon('calendarPlus', 'icon-sm'), 'Calendrier'), more),
    ),
    h('div', { class: 'section-title' }, `Participants · ${num(e.goingCount)}`),
    h(
      'div',
      { class: 'explore-list' },
      e.attendees.map((u) =>
        h(
          'a',
          { href: `/@${u.username}`, class: 'user-row' },
          avatar(u),
          h('span', { class: 'meta' }, nameLine(u, { link: false }), h('small', null, memberChip(u), u.username === e.host.username ? h('span', null, 'Organisateur') : h('span', null, `@${u.username}`))),
        ),
      ),
    ),
  );
}
