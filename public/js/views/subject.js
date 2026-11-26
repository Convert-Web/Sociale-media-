// Le Sujet du jour : chaque jour à 19 h, le même sujet pour tout le monde. On répond en vidéo
// (15 secondes), on voit les réponses des autres une fois qu'on a répondu, et la réponse la plus
// aimée gagne l'Or du jour. Page du sujet (/sujet, /sujet/:id) et carte en tête du fil « Pour toi ».
import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon, avatar, emptyState, spinner, short } from '../dom.js';
import { videoGrid } from '../components/grid.js';
import { uploading } from '../components/uploads.js';

// ── Sujet en cours, gardé une minute (le fil et la page le demandent tous les deux) ──────────
let cache = null;
export function todaySubject({ fresh = false } = {}) {
  if (!store.user) return Promise.resolve(null);
  if (!fresh && cache && Date.now() - cache.at < 60 * 1000) return cache.p;
  const p = api.get('/api/subjects/today').catch(() => null);
  const entry = { at: Date.now(), p, done: null };
  cache = entry;
  p.then((d) => (entry.done = d));
  return p;
}
export const lastSubject = () => cache?.done || null;
// Réponse envoyée : la page et la carte du fil se mettent à jour
export function subjectAnswered() {
  cache = null;
  try {
    sessionStorage.removeItem(SENDING);
  } catch {
    /* rien */
  }
  window.dispatchEvent(new CustomEvent('vibz:subject'));
}
// Réponse vidéo qui s'envoie encore (envoi en arrière-plan)
const SENDING = 'vibz:subject-sending';
export function markSending(id) {
  try {
    sessionStorage.setItem(SENDING, String(id));
  } catch {
    /* rien */
  }
}
const sendingFor = (id) => {
  try {
    return uploading() && sessionStorage.getItem(SENDING) === String(id);
  } catch {
    return false;
  }
};

// « Encore 4 h 12 pour répondre »
function left(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${hh} h ${String(mm).padStart(2, '0')}` : `${hh} h`;
}
const timeLine = (s) => (s.open ? `Encore ${left(s.closesAt - Date.now())} pour répondre` : s.upcoming ? 'Ouverture à 19 h' : 'Terminé');
const dayName = (day) => {
  const t = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date(`${day}T12:00:00Z`));
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const kindTag = (s) => h('span', { class: 'subject-kind' }, h('i', { class: 'subject-dot', 'aria-hidden': 'true' }), s.label);
const answerHref = (s) => `/creer?sujet=${s.id}`;

// Amis qui ont répondu : « Léa, Sam et 3 autres »
function friendsLine(d) {
  const users = d.friends.users;
  if (!d.friends.count) return d.answers ? `${short(d.answers)} ${d.answers > 1 ? 'réponses' : 'réponse'}` : 'Sois le premier à répondre';
  const names = users.slice(0, 2).map((u) => u.displayName.split(' ')[0]);
  const rest = d.friends.count - names.length;
  const who = rest > 0 ? `${names.join(', ')} et ${rest} ${rest > 1 ? 'autres' : 'autre'}` : names.join(' et ');
  return `${who} ${d.friends.count > 1 ? 'ont' : 'a'} répondu`;
}
const faces = (users) => (users.length ? h('span', { class: 'subject-faces' }, users.slice(0, 4).map((u) => avatar(u, 'xs'))) : null);

// ── Carte en tête du fil « Pour toi » (tant qu'on n'a pas répondu) ─────────────────────────
export function subjectCard(d) {
  const el = h('section', { class: 'feed-head subject-card', 'aria-label': 'Le sujet du jour' });
  const paint = (data) => {
    const s = data.subject;
    const answered = data.me.answered || sendingFor(s.id);
    el.replaceChildren(
      h('div', { class: 'subject-card-in' },
        h('p', { class: 'subject-card-top' }, h('i', { class: 'subject-dot', 'aria-hidden': 'true' }), 'Le sujet du jour', h('span', null, ` · ${s.label}`)),
        h('h2', { class: 'subject-card-title' }, s.title),
        s.sponsor ? h('p', { class: 'subject-sponsor' }, `Proposé par ${s.sponsor}${s.prize ? ` · À gagner : ${s.prize}` : ''}`) : null,
        h('p', { class: 'subject-card-time' }, answered ? 'Tu as répondu' : timeLine(s)),
        h('p', { class: 'subject-card-friends' }, faces(data.friends.users), h('span', null, friendsLine(data))),
        h('div', { class: 'subject-card-actions' },
          answered
            ? h('a', { href: `/sujet/${s.id}`, class: 'btn btn-gold btn-lg' }, 'Voir les réponses')
            : h('a', { href: answerHref(s), class: 'btn btn-gold btn-lg' }, icon('camera', 'icon-sm'), 'Répondre en 15 s'),
          answered ? null : h('a', { href: `/sujet/${s.id}`, class: 'subject-card-more' }, 'Comment ça marche'))),
      h('span', { class: 'subject-card-hint' }, icon('chevronUp', 'icon-sm'), 'Glisse pour voir le fil'),
    );
  };
  paint(d);
  const refresh = async () => {
    const fresh = await todaySubject({ fresh: true });
    if (fresh && el.isConnected) paint(fresh);
  };
  window.addEventListener('vibz:subject', refresh);
  el.__dispose = () => window.removeEventListener('vibz:subject', refresh);
  return el;
}
// Le fil affiche la carte quand un sujet est ouvert et qu'on n'y a pas encore répondu
export const wantsCard = (d) => Boolean(d?.subject?.open && !d.me.answered && !sendingFor(d.subject.id));

// ── Page du sujet ─────────────────────────────────────────────────────────────────────────
export async function subjectView(ctx) {
  const id = Number(ctx.params.id) || null;
  ctx.title = 'Le sujet du jour — AURUM';
  ctx.description = 'Chaque jour à 19 h, un sujet pour tout le monde : réponds en vidéo, découvre les réponses de tes amis et l’Or du jour.';
  const page = h('div', { class: 'page subject-page' });
  const head = h('header', { class: 'page-head' }, h('span', { class: 'icon-btn' }), h('h1', null, 'Sujet du jour'), h('span', { class: 'icon-btn' }));
  const body = h('div', { class: 'subject-body' }, h('div', { class: 'subject-loading' }, spinner()));
  page.append(head, body);
  let grid = null;
  let sort = 'best';

  const render = (d) => {
    const s = d.subject;
    const sending = sendingFor(s.id);
    const me = d.me;
    ctx.title = `${s.title} — Le sujet du jour sur AURUM`;
    const cta = s.open
      ? me.answered
        ? h('div', { class: 'subject-done' }, h('span', { class: 'subject-check' }, icon('check', 'icon-sm')), h('span', null, 'Tu as répondu'), h('a', { href: `/sujet/${s.id}#reponses`, class: 'subject-done-link', onclick: (e) => { e.preventDefault(); body.querySelector('.subject-answers')?.scrollIntoView({ behavior: 'smooth' }); } }, 'Voir les réponses'))
        : sending
          ? h('div', { class: 'subject-done' }, spinner(), h('span', null, 'Ta réponse s’envoie…'))
          : h('a', { href: answerHref(s), class: 'btn btn-gold btn-lg btn-block' }, icon('camera', 'icon-sm'), 'Répondre en 15 secondes')
      : null;
    const stats = h('div', { class: 'subject-stats' },
      h('span', null, h('b', null, short(d.answers)), d.answers > 1 ? ' réponses' : ' réponse'),
      store.user && me.streak ? h('span', null, h('b', null, String(me.streak)), me.streak > 1 ? ' jours de suite' : ' jour de suite') : null,
      store.user && me.golds ? h('span', { class: 'subject-golds' }, h('i', { class: 'subject-dot', 'aria-hidden': 'true' }), h('b', null, String(me.golds)), me.golds > 1 ? ' Ors du jour' : ' Or du jour') : null);
    const hero = h('section', { class: 'subject-hero' },
      h('p', { class: 'subject-date' }, dayName(s.day)),
      kindTag(s),
      h('h2', { class: 'subject-title' }, s.title),
      s.sponsor ? h('p', { class: 'subject-sponsor' }, `Proposé par ${s.sponsor}${s.prize ? ` · À gagner : ${s.prize}` : ''}`) : null,
      s.actuId ? h('a', { href: `/actu/${s.actuId}`, class: 'subject-actu' }, icon('newspaper', 'icon-xs'), 'Lire l’article') : null,
      h('p', { class: 'subject-time' }, icon('clock', 'icon-xs'), timeLine(s)),
      cta,
      stats);

    // L'Or du jour de ce sujet (terminé), ou celui d'hier
    const goldBlock = (title, post, subject) => post
      ? h('section', { class: 'subject-gold' },
        h('h3', { class: 'section-title' }, title),
        h('a', { href: `/@${post.author.username}/video/${post.id}`, class: 'subject-gold-card' },
          h('span', { class: 'subject-gold-media' }, post.video?.poster || post.images?.[0] ? h('img', { src: post.video?.poster || post.images[0], alt: '', loading: 'lazy' }) : h('span', { class: `tile-text bg-${post.bg || 'violet'}` }, post.body.slice(0, 60))),
          h('span', { class: 'subject-gold-info' },
            h('span', { class: 'subject-gold-badge' }, h('i', { class: 'subject-dot', 'aria-hidden': 'true' }), 'Or du jour'),
            h('b', null, subject.title),
            h('span', { class: 'subject-gold-who' }, avatar(post.author, 'xs'), post.author.displayName),
            h('small', null, `${short(post.likeCount)} J’aime`))))
      : null;

    // Réponses : verrouillées tant qu'on n'a pas répondu (sujet en cours)
    const answers = h('section', { class: 'subject-answers', id: 'reponses' });
    if (me.locked && s.open) {
      answers.append(
        h('h3', { class: 'section-title' }, 'Les réponses'),
        h('div', { class: 'subject-lock' },
          h('span', { class: 'subject-lock-ic' }, icon('lock')),
          h('b', null, d.answers ? `Réponds pour voir ${d.answers > 1 ? `les ${short(d.answers)} réponses` : 'la réponse'}` : 'Sois le premier à répondre'),
          d.friends.count ? h('p', null, faces(d.friends.users), h('span', null, friendsLine(d))) : h('p', null, 'Les réponses de tes amis apparaissent ici dès que tu as répondu.'),
          store.user ? null : h('a', { href: '/connexion?suite=/sujet', class: 'btn btn-primary' }, 'Se connecter')));
    } else {
      const tabs = h('div', { class: 'chips subject-tabs', role: 'tablist' });
      const holder = h('div');
      const paintTabs = () => tabs.replaceChildren(...[['best', 'Les plus aimées'], ['friends', 'Amis'], ['recent', 'Récentes']].map(([k, label]) =>
        h('button', { type: 'button', role: 'tab', class: `chip${sort === k ? ' on' : ''}`, 'aria-selected': String(sort === k), onclick: () => { if (sort === k) return; sort = k; paintTabs(); loadGrid(); } }, label)));
      const loadGrid = () => {
        grid?.destroy?.();
        grid = videoGrid({
          fetchPage: async (cursor) => {
            const r = await api.get(`/api/subjects/${s.id}/answers?sort=${sort}&page=${cursor || 0}`);
            return { posts: r.posts, cursor: r.hasMore ? (cursor || 0) + 1 : null };
          },
          showAuthor: true,
          showLikes: true,
          tileBadge: (p) => (p.subject?.gold ? 'Or du jour' : null),
          empty: emptyState('video', sort === 'friends' ? 'Aucun ami n’a encore répondu' : 'Pas encore de réponse', sort === 'friends' ? 'Invite-les : le sujet est le même pour tout le monde.' : 'Les réponses arrivent au fil de la soirée.'),
        });
        holder.replaceChildren(grid.el);
      };
      paintTabs();
      loadGrid();
      answers.append(h('h3', { class: 'section-title' }, s.open ? 'Les réponses' : 'Toutes les réponses'), tabs, holder);
    }

    const prev = d.previous?.winner && !s.winnerPostId ? goldBlock('L’Or d’hier', d.previous.winner, d.previous.subject) : null;
    body.replaceChildren(
      hero,
      s.winnerPostId && d.gold ? goldBlock('L’Or du jour', d.gold, s) : null,
      answers,
      prev,
      h('p', { class: 'subject-how' }, 'Un nouveau sujet chaque jour à 19 h. Tu as 24 h pour répondre en vidéo. Le lendemain, la réponse la plus aimée gagne l’Or du jour.'));
  };

  const loadAll = async (fresh = false) => {
    try {
      const d = id ? await api.get(`/api/subjects/${id}`) : await todaySubject({ fresh: true });
      if (!d) throw new Error('Connecte-toi pour voir le sujet du jour.');
      if (!id) cache = { at: Date.now(), p: Promise.resolve(d), done: d };
      render(d);
      void fresh;
    } catch (err) {
      body.replaceChildren(emptyState('alert', 'Sujet indisponible', err.message, h('a', { href: '/', class: 'btn btn-primary' }, 'Retour au fil')));
    }
  };
  const onAnswered = () => loadAll(true);
  window.addEventListener('vibz:subject', onAnswered);
  // Compte à rebours qui avance tant que la page est ouverte
  const tick = setInterval(() => {
    const t = body.querySelector('.subject-time');
    const d = cache?.done;
    if (t && d?.subject && (!id || d.subject.id === id)) t.lastChild.textContent = timeLine(d.subject);
  }, 30 * 1000);
  ctx.onCleanup(() => {
    window.removeEventListener('vibz:subject', onAnswered);
    clearInterval(tick);
    grid?.destroy?.();
  });
  loadAll();
  return page;
}
