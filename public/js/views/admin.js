// Administration : vue d'ensemble, signalements, comptes, publications, audience, informations
// légales, contenu de démonstration, erreurs.
import { api, enc } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, avatar, short, num, money, timeAgo, toast, confirmDialog, emptyState, spinner, debounce, count, verifiedMark } from '../dom.js';
import { revealActive } from './explore.js';
import { store } from '../store.js';
import { fieldError } from '../forms.js';
import { tile } from '../components/grid.js';
import { openViewer } from '../components/feed.js';

const TABS = [
  ['apercu', 'Vue d’ensemble'],
  ['signalements', 'Signalements'],
  ['comptes', 'Comptes'],
  ['publications', 'Publications'],
  ['audience', 'Audience'],
  ['legal', 'Légal'],
  ['actu', 'Actu'],
  ['demo', 'Démo'],
  ['erreurs', 'Erreurs'],
];

const kpi = (label, value, sub = null) => h('div', { class: 'kpi' }, h('small', null, label), h('b', null, value), sub ? h('span', null, sub) : null);

// Petit graphique en barres : valeur au-dessus, date dessous (un jour sur deux), jours à zéro discrets
function bars(label, items) {
  const max = Math.max(1, ...items.map((x) => x.count));
  const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'numeric' });
  return h('div', { class: 'mini-bars', role: 'img', 'aria-label': label }, items.map((x, i) => {
    const d = new Date(`${String(x.day || x.date).slice(0, 10)}T12:00:00`);
    return h('span', { class: `mini-bar${x.count ? '' : ' zero'}`, title: `${fmt.format(d)} : ${x.count}`, style: { '--v': String(x.count / max) } },
      h('small', { class: 'mini-val' }, x.count ? String(x.count) : ''), h('i'), h('small', { class: 'mini-day' }, (items.length - 1 - i) % 2 ? '' : fmt.format(d)));
  }));
}

async function overview() {
  const d = await api.get('/api/admin/overview');
  const t = d.totals;
  const used = Math.round((d.storage.usedBytes / Math.max(1, d.storage.maxBytes)) * 100);
  return h(
    'div',
    null,
    d.legalMissing.length ? h('p', { class: 'notice warn' }, icon('alert', 'icon-sm'), `Informations légales à compléter : ${d.legalMissing.join(', ')}.`) : null,
    h('div', { class: 'kpis' },
      kpi('Comptes', short(t.users), `+${t.usersToday} en 24 h`),
      kpi('Vidéos', short(t.videos), `${short(t.posts)} publications`),
      kpi('Vues', short(t.views)),
      kpi('J’aime', short(t.likes), `${short(t.comments)} commentaires`),
      kpi('Messages', short(t.messages)),
      kpi('LIVE', String(t.livesNow), `${short(t.lives)} au total`),
      kpi('Signalements ouverts', String(t.openReports)),
      kpi('Ventes de pièces', money(t.revenue, 'eur'), `${short(t.coinsSold)} pièces · ${short(t.coinsSpent)} dépensées`),
      kpi('Espace vidéo', `${used} %`, `${Math.round(d.storage.usedBytes / 1048576)} / ${Math.round(d.storage.maxBytes / 1048576)} Mo`),
    ),
    h('h3', { class: 'section-title' }, 'Inscriptions (14 jours)'),
    bars('Inscriptions par jour', d.signups),
    h('div', { class: 'set-card' },
      h('div', { class: 'tx' }, h('span', { class: 'tx-text' }, 'Paiements', h('small', null, d.payments.stripe ? `Stripe actif${d.payments.webhook ? ' · webhook configuré' : ' · webhook absent'}` : d.payments.demo ? 'Mode démonstration (aucun encaissement)' : 'Désactivés (STRIPE_SECRET_KEY)'))),
      h('div', { class: 'tx' }, h('span', { class: 'tx-text' }, 'Courriels', h('small', null, d.mail.provider ? `Envoi par ${d.mail.provider}` : 'Affichés dans la console (BREVO_API_KEY ou SMTP_URL)')), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => { try { const r = await api.post('/api/admin/email-test'); toast(`Courriel d’essai envoyé (${r.provider})`); } catch (err) { toast(err.message, 'error'); } } }, 'M’envoyer un essai')),
    ),
  );
}

async function reports() {
  const { reports: list } = await api.get('/api/admin/reports');
  if (!list.length) return emptyState('shield', 'Aucun signalement ouvert', 'Tout est calme.');
  const KIND = { user: 'Compte', post: 'Publication', comment: 'Commentaire', live: 'LIVE', message: 'Message' };
  const REMOVE = {
    user: ['Suspendre ce compte ?', 'Le compte ne pourra plus se connecter et disparaîtra du site.', 'Suspendre', 'Compte suspendu'],
    live: ['Arrêter ce LIVE ?', 'Le direct sera coupé pour tous les spectateurs.', 'Arrêter', 'LIVE arrêté'],
    post: ['Supprimer cette publication ?', 'Elle sera supprimée définitivement, pour tout le monde.', 'Supprimer', 'Publication supprimée'],
    comment: ['Supprimer ce commentaire ?', 'Il sera supprimé définitivement.', 'Supprimer', 'Commentaire supprimé'],
    message: ['Supprimer ce message ?', 'Il disparaîtra de la conversation.', 'Supprimer', 'Message supprimé'],
  };
  const host = h('div', { class: 'reports' });
  const paintEmpty = () => !host.querySelector('.report') && host.replaceChildren(emptyState('shield', 'Aucun signalement ouvert', 'Tout est calme.'));
  host.append(...list.map((r) => {
    const who = r.automatic ? 'Signalé automatiquement' : r.reporters?.length > 1 ? `Signalé par @${r.reporters.slice(0, 3).join(', @')}${r.reporters.length > 3 ? '…' : ''}` : `Signalé par @${r.reporter || '?'}`;
    const t = r.target;
    const title = t ? `${KIND[r.type] || 'Contenu'} · ${t.authorName} (@${t.author})${r.type === 'message' && t.toName ? ` → ${t.toName} (@${t.to})` : ''}` : null;
    const box = h('div', { class: 'report', dataset: { target: `${r.type}:${t?.id ?? r.id}` } },
      h('div', { class: 'report-head' }, h('b', null, (r.reasons?.length ? r.reasons : [r.reason]).join(' · ')), h('small', null, `${who} · ${timeAgo(r.createdAt)}${r.total > 1 ? ` · ${r.total} signalements` : ''}`)),
      r.details ? h('p', { class: 'muted' }, r.details) : null,
      t ? h('div', { class: 'report-target' }, t.image ? h('img', { src: t.image, alt: '' }) : null, h('div', null, h('b', null, title), t.text ? h('p', null, t.text.slice(0, 300)) : null, t.link ? h('a', { href: t.link }, 'Ouvrir') : null)) : h('p', { class: 'muted' }, 'Contenu déjà supprimé.'),
      h('div', { class: 'row-end' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => resolve('dismiss') }, 'Classer'),
        t ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => resolve('remove') }, r.type === 'user' ? 'Suspendre le compte' : r.type === 'live' ? 'Arrêter le LIVE' : 'Supprimer') : null),
    );
    async function resolve(action) {
      const [q, text, ok, done] = REMOVE[r.type] || REMOVE.post;
      if (action === 'remove' && !(await confirmDialog(q, text, ok))) return;
      try {
        await api.post(`/api/admin/reports/${r.id}/resolve`, { action });
        // Tous les signalements de ce contenu sont traités ensemble
        host.querySelectorAll(`.report[data-target="${box.dataset.target}"]`).forEach((el) => el.remove());
        paintEmpty();
        toast(action === 'remove' ? done : 'Signalement classé');
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    return box;
  }));
  return host;
}

// Actions sur un compte : confirmation et message propres à chacune
const USER_ACTIONS = {
  verify: [null, 'Badge vérifié ajouté'],
  unverify: [null, 'Badge vérifié retiré'],
  ban: [(u) => [`Suspendre @${u.username} ?`, 'Le compte ne pourra plus se connecter et disparaîtra du site.', 'Suspendre'], 'Compte suspendu'],
  unban: [null, 'Compte rétabli'],
  promote: [(u) => [`Nommer @${u.username} administrateur ?`, 'Il pourra modérer, suspendre et supprimer des comptes.', 'Nommer'], 'Compte nommé administrateur'],
  demote: [(u) => [`Retirer les droits d’administration de @${u.username} ?`, 'Il redeviendra un membre ordinaire.', 'Retirer'], 'Droits d’administration retirés'],
  delete: [(u) => [`Supprimer @${u.username} ?`, 'Toutes ses données seront effacées définitivement.', 'Supprimer'], 'Compte supprimé'],
};
function users() {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Nom, @utilisateur ou e-mail', 'aria-label': 'Rechercher un compte' });
  const list = h('div', { class: 'admin-users' }, spinner());
  const moreBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-block', hidden: true }, 'Voir plus');
  let cursor = null;
  let seq = 0;
  const row = (u) => {
    const self = u.id === store.user?.id;
    const act = (a, label, cls = 'btn-ghost') => h('button', { type: 'button', class: `btn ${cls} btn-sm`, onclick: async () => {
      const [ask, done] = USER_ACTIONS[a];
      if (ask && !(await confirmDialog(...ask(u)))) return;
      try {
        if (a === 'delete') await api.del(`/api/admin/users/${u.id}`);
        else await api.post(`/api/admin/users/${u.id}/${a}`);
        toast(done);
        load();
      } catch (err) {
        toast(err.message, 'error');
      }
    } }, label);
    return h('div', { class: 'admin-user' },
      h('a', { href: `/@${enc(u.username)}`, class: 'user-row-main' }, avatar(u, 'sm'), h('span', { class: 'user-row-text' },
        h('b', null, u.displayName, u.verified ? verifiedMark() : null, u.isAdmin ? ' · admin' : '', u.banned ? ' · suspendu' : '', u.demo ? ' · démo' : '', self ? ' · toi' : ''),
        h('small', null, `@${u.username} · ${u.email}`),
        h('small', null, `${count(u.counts.followers, 'abonné')} · inscrit ${timeAgo(u.createdAt)}`))),
      // Son propre compte : pas de suspension ni de retrait de ses droits (le serveur les refuse)
      h('div', { class: 'admin-actions' }, u.verified ? act('unverify', 'Retirer le badge') : act('verify', 'Vérifier'), self ? null : u.banned ? act('unban', 'Rétablir') : act('ban', 'Suspendre'), self ? null : u.isAdmin ? act('demote', 'Retirer admin') : act('promote', 'Nommer admin'), self ? null : act('delete', 'Supprimer', 'btn-danger')));
  };
  const load = async (more = false) => {
    const mine = ++seq;
    const q = input.value.trim();
    try {
      const d = await api.get(`/api/admin/users?q=${enc(q)}${more && cursor ? `&cursor=${cursor}` : ''}`);
      if (mine !== seq) return;
      cursor = d.cursor;
      moreBtn.hidden = !cursor;
      if (!more) list.replaceChildren();
      list.append(...d.users.map(row));
      if (!list.children.length) list.append(emptyState('search', 'Aucun compte trouvé', q ? `Rien pour « ${q} ». Essaie un autre nom, @nom ou e-mail.` : null));
    } catch (err) {
      list.replaceChildren(emptyState('alert', 'Erreur', err.message));
    }
  };
  moreBtn.addEventListener('click', () => load(true));
  input.addEventListener('input', debounce(() => load(), 250));
  load();
  return h('div', null, input, list, moreBtn);
}

function posts() {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Texte, @auteur ou #hashtag', 'aria-label': 'Rechercher une publication' });
  let filter = '';
  const chips = h('div', { class: 'chips' });
  const paintChips = () => chips.replaceChildren(...[['', 'Toutes'], ['private', 'Non publiques'], ['flagged', 'Repérées par le filtre']].map(([k, label]) => h('button', { type: 'button', class: `chip${filter === k ? ' on' : ''}`, onclick: () => { filter = k; paintChips(); load(); } }, label)));
  paintChips();
  const grid = h('div', { class: 'grid cols-4' });
  const moreBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-block', hidden: true }, 'Voir plus');
  const list = [];
  let cursor = null;
  let seq = 0;
  const load = async (more = false) => {
    const mine = ++seq;
    const q = input.value.trim();
    try {
      const d = await api.get(`/api/admin/posts?${new URLSearchParams({ ...(q ? { q } : {}), ...(filter ? { filtre: filter } : {}), ...(more && cursor ? { cursor } : {}) })}`);
      if (mine !== seq) return;
      if (!more) {
        list.length = 0;
        grid.replaceChildren();
      }
      list.push(...d.posts);
      grid.append(...d.posts.map((p) => tile(p, { showAuthor: true, onOpen: (post) => openViewer(list, { startId: post.id }) })));
      if (!list.length) grid.append(emptyState('video', 'Aucune publication', q ? `Rien pour « ${q} ».` : null));
      cursor = d.cursor;
      moreBtn.hidden = !cursor;
    } catch (err) {
      grid.replaceChildren(emptyState('alert', 'Erreur', err.message));
    }
  };
  moreBtn.addEventListener('click', () => load(true));
  input.addEventListener('input', debounce(() => load(), 250));
  load();
  return h('div', { class: 'form-stack' }, input, chips, grid, moreBtn, h('p', { class: 'muted small' }, 'Pour supprimer une publication : ouvre-la, puis appui long (ou clic droit) → Supprimer.'));
}

// Pages de l'audience : libellés lisibles plutôt que les adresses techniques
const PAGE_NAMES = { '/reglages/:section': 'Réglages (rubriques)', '/admin': 'Administration', '/portefeuille': 'Portefeuille', '/studio': 'Studio créateur', '/bienvenue': 'Premier lancement', '/mot-de-passe-oublie': 'Mot de passe oublié', '/reinitialiser': 'Nouveau mot de passe', '/cgu': 'CGU', '/cgv': 'CGV', '/confidentialite': 'Confidentialité', '/mentions-legales': 'Mentions légales', '/regles': 'Règles', '/': 'Accueil (Pour toi)', '/@:username': 'Profils', '/@:username/video/:id': 'Vidéos', '/explorer': 'Explorer', '/recherche': 'Recherche', '/tag/:tag': 'Hashtags', '/son/:id': 'Sons', '/live': 'LIVE (liste)', '/live/:username': 'LIVE', '/messages': 'Messages', '/messages/:username': 'Discussions', '/boite': 'Boîte de réception', '/activite': 'Activité', '/creer': 'Créer', '/amis': 'Amis', '/abonnements': 'Abonnements', '/connexion': 'Connexion', '/inscription': 'Inscription', '/reglages': 'Réglages', '/aide': 'Aide' };

async function audience() {
  const a = await api.get('/api/admin/analytics');
  const row = (label, items, name = (k) => k) => h('section', { class: 'set-group' }, h('h3', null, label), h('div', { class: 'set-card' }, items.length ? items.map((x) => h('div', { class: 'tx' }, h('span', { class: 'tx-text' }, name(x.key)), h('b', null, num(x.n)))) : h('p', { class: 'muted small pad' }, 'Pas encore de données.')));
  return h('div', null,
    h('div', { class: 'kpis' }, kpi('Visites (30 j)', short(a.visits)), kpi('Pages vues (30 j)', short(a.views)), kpi('Aujourd’hui', short(a.today))),
    h('h3', { class: 'section-title' }, `Visites (${a.daily.length} derniers jours)`),
    bars('Visites par jour', a.daily),
    row('Pages', a.pages, (k) => PAGE_NAMES[k] || k), row('Provenance', a.sources), row('Campagnes', a.campaigns), row('Appareils', a.devices),
    h('p', { class: 'muted small' }, 'Mesure sans cookie ni identifiant : seuls des totaux par jour sont gardés.'));
}

async function legal() {
  const { legal: data, fields } = await api.get('/api/admin/legal');
  const inputs = {};
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Enregistrer');
  return h('form', {
    class: 'form-stack',
    onsubmit: async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await api.put('/api/admin/legal', Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value])));
        toast('Informations légales enregistrées');
      } catch (err) {
        // Le message du serveur nomme le champ : on le place dessous quand on le reconnaît
        const key = Object.keys(fields).find((k) => err.message.toLowerCase().includes(fields[k].label.toLowerCase()));
        if (key) fieldError(inputs[key], err.message);
        else toast(err.message, 'error');
      } finally {
        save.disabled = false;
      }
    },
  }, h('p', { class: 'muted small' }, 'Elles apparaissent dans les mentions légales, les CGU, les CGV et la politique de confidentialité. Elles restent dans la base, jamais dans le code. Les champs marqués d’un * sont obligatoires.'),
  Object.entries(fields).map(([k, f]) => {
    inputs[k] = h('input', { class: 'input', value: data[k] || '', maxlength: f.max, required: f.required, type: f.email ? 'email' : f.url ? 'url' : 'text', pattern: f.url ? 'https://.+' : null, 'data-hint': f.url ? 'L’adresse doit commencer par https://' : null, placeholder: f.url ? 'https://' : null });
    return h('label', { class: 'field' }, h('span', null, f.label, f.required ? ' *' : ''), inputs[k]);
  }), save);
}

async function demo() {
  const out = h('p', { class: 'muted small' });
  const state = h('p', { class: 'notice' });
  const actions = h('div', { class: 'row-end' });
  const paint = (n) => {
    state.replaceChildren(icon(n ? 'check' : 'info', 'icon-sm'), n ? `La démo est présente : ${count(n, 'compte')} de démonstration.` : 'La démo n’est pas installée.');
    actions.replaceChildren(n ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => run('remove') }, 'Retirer la démo') : h('button', { type: 'button', class: 'btn btn-primary', onclick: () => run('add') }, 'Ajouter la démo'));
  };
  const run = async (action) => {
    if (action === 'remove' && !(await confirmDialog('Retirer la démo ?', 'Les comptes de démonstration et leurs vidéos seront supprimés.', 'Retirer'))) return;
    out.textContent = 'En cours…';
    try {
      const r = await api.post('/api/admin/demo', { action });
      out.textContent = action === 'remove' ? `${count(r.removed, 'compte')} de démonstration retiré${r.removed > 1 ? 's' : ''}.` : r.added ? `${count(r.users, 'compte')} et ${count(r.posts, 'vidéo')} ajoutés.` : 'La démo est déjà présente.';
      const d = await api.get('/api/admin/overview').catch(() => null);
      paint(d?.totals?.demoUsers || (action === 'add' ? 12 : 0));
    } catch (err) {
      out.textContent = err.message;
    }
  };
  const d = await api.get('/api/admin/overview').catch(() => null);
  paint(d?.totals?.demoUsers || 0);
  return h('div', { class: 'form-stack' },
    h('p', null, 'Ajoute 12 comptes de démonstration (signalés comme tels sur leur profil) et 14 vidéos originales générées par calcul — visuels mathématiques, textes et musiques synthétisées — avec des sons réutilisés, des abonnements, des J’aime et des commentaires. Pratique pour présenter AURUM ; à retirer avant d’ouvrir au public.'),
    state, actions, out);
}

// Actu : sources suivies (médias, podcasts, chaînes vidéo), rubriques, relecture des flux
async function actuSources() {
  const KIND = { article: ['newspaper', 'Articles'], podcast: ['headphones', 'Podcast'], video: ['playBadge', 'Vidéos'] };
  const host = h('div', { class: 'form-stack' });
  const load = async () => {
    let d;
    try {
      d = await api.get('/api/actu/sources');
    } catch (err) {
      host.replaceChildren(emptyState('alert', 'Erreur', err.message));
      return;
    }
    const topicSelect = (value, onChange) => {
      const sel = h('select', { class: 'input input-sm', 'aria-label': 'Rubrique' }, h('option', { value: '' }, 'Sans rubrique'), d.topics.map((t) => h('option', { value: t.id, selected: value === t.id }, t.label)));
      sel.addEventListener('change', () => onChange(sel.value || null));
      return sel;
    };
    // Ajouter : flux RSS, site d'un média, chaîne YouTube, page Apple Podcasts
    const url = h('input', { class: 'input', type: 'url', required: true, placeholder: 'https://… (flux RSS, site, chaîne YouTube, podcast)', 'aria-label': 'Adresse de la source' });
    const name = h('input', { class: 'input', maxlength: 80, placeholder: 'Nom affiché (facultatif)', 'aria-label': 'Nom affiché' });
    let topic = null;
    const add = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Ajouter la source');
    const form = h('form', { class: 'form-stack set-card pad', onsubmit: async (e) => {
      e.preventDefault();
      add.disabled = true;
      add.textContent = 'Lecture du flux…';
      try {
        const r = await api.post('/api/actu/sources', { url: url.value.trim(), title: name.value.trim(), topic });
        toast(`${r.source.title} ajouté : ${count(r.source.items, 'élément')}`);
        load();
      } catch (err) {
        fieldError(url, err.message);
      } finally {
        add.disabled = false;
        add.textContent = 'Ajouter la source';
      }
    } }, h('h3', { class: 'section-title' }, 'Ajouter une source'), url, name, topicSelect(null, (v) => (topic = v)), add);
    // Trouver un podcast par son nom
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Nom d’un podcast', 'aria-label': 'Chercher un podcast' });
    const results = h('div', { class: 'admin-pods' });
    const search = h('form', { class: 'row-search', onsubmit: async (e) => {
      e.preventDefault();
      if (!q.value.trim()) return;
      results.replaceChildren(spinner());
      try {
        const r = await api.post('/api/actu/sources/search', { q: q.value.trim() });
        results.replaceChildren(...(r.results.length ? r.results.map((p) => h('div', { class: 'tx' }, p.image ? h('img', { class: 'admin-pod-img', src: p.image, alt: '', referrerpolicy: 'no-referrer' }) : null, h('span', { class: 'tx-text' }, p.title, h('small', null, p.author || '')), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { url.value = p.feedUrl; name.value = p.title; url.scrollIntoView({ block: 'center', behavior: 'smooth' }); } }, 'Choisir'))) : [h('p', { class: 'muted small pad' }, 'Aucun podcast trouvé.')]));
      } catch (err) {
        results.replaceChildren(h('p', { class: 'muted small pad' }, err.message));
      }
    } }, q, h('button', { type: 'submit', class: 'btn btn-ghost' }, 'Chercher'));
    const refresh = h('button', { type: 'button', class: 'btn btn-ghost', onclick: async () => {
      refresh.disabled = true;
      refresh.textContent = 'Lecture des flux…';
      try {
        const r = await api.post('/api/actu/refresh', { force: true });
        toast(r.skipped ? 'Une relecture est déjà en cours' : `${count(r.added, 'nouvel élément', 'nouveaux éléments')}`);
        load();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        refresh.disabled = false;
        refresh.textContent = 'Relire tous les flux';
      }
    } }, 'Relire tous les flux');
    const rows = d.sources.map((s) => h('div', { class: 'admin-source' },
      h('span', { class: 'admin-source-ic' }, icon(KIND[s.kind]?.[0] || 'rss', 'icon-sm')),
      h('span', { class: 'tx-text' }, s.title, h('small', null, `${KIND[s.kind]?.[1] || s.kind} · ${count(s.items, 'élément')}${s.lastFetchedAt ? ` · lu ${timeAgo(s.lastFetchedAt)}` : ''}`), s.error ? h('small', { class: 'danger-text' }, `Dernière lecture : ${s.error}`) : null),
      topicSelect(s.topic, async (v) => {
        try {
          await api.patch(`/api/actu/sources/${s.id}`, { topic: v });
          toast('Rubrique enregistrée');
        } catch (err) {
          toast(err.message, 'error');
        }
      }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Retirer ${s.title}`, onclick: async () => {
        if (!(await confirmDialog(`Retirer « ${s.title} » ?`, 'Ses éléments quittent l’Actu (sauf ceux auxquels des vidéos réagissent).', 'Retirer'))) return;
        try {
          await api.del(`/api/actu/sources/${s.id}`);
          toast('Source retirée');
          load();
        } catch (err) {
          toast(err.message, 'error');
        }
      } }, icon('trash', 'icon-sm'))));
    host.replaceChildren(
      h('p', { class: 'muted small' }, 'L’Actu montre le titre, le court résumé et l’image publiés par chaque média dans son flux, avec un lien vers l’article : rien n’est recopié. Les flux sont relus toutes les 20 minutes quand quelqu’un ouvre l’Actu.'),
      h('div', { class: 'row-end' }, h('small', { class: 'muted' }, d.refreshedAt ? `Dernière relecture ${timeAgo(d.refreshedAt)}` : 'Jamais relue'), refresh),
      h('section', null, h('h3', { class: 'section-title' }, `Sources suivies · ${d.sources.length}`), d.sources.length ? h('div', { class: 'set-card' }, rows) : h('p', { class: 'muted small pad' }, 'Aucune source pour l’instant.')),
      form,
      h('section', { class: 'set-card pad form-stack' }, h('h3', { class: 'section-title' }, 'Trouver un podcast'), search, results));
  };
  await load();
  return host;
}

async function errors() {
  const { errors: list } = await api.get('/api/admin/errors');
  if (!list.length) return emptyState('check', 'Aucune erreur', 'Les erreurs survenues dans les navigateurs apparaîtront ici.');
  const fmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'medium' });
  const item = (e) => h('details', { class: 'err-item' },
    h('summary', null, h('span', { class: 'tx-text' }, e.message, h('small', null, `${e.path} · ${e.device} · ${timeAgo(e.at)}${e.count > 1 ? ` · ×${e.count}` : ''}`))),
    h('div', { class: 'err-detail' }, h('p', null, `Dernière fois : ${fmt.format(new Date(e.at))}${e.version ? ` · version ${String(e.version).slice(0, 7)}` : ''}`), e.stack ? h('pre', null, String(e.stack).slice(0, 3000)) : h('p', { class: 'muted small' }, 'Pas de pile d’appels.')));
  const real = list.filter((e) => !e.refused);
  const refused = list.filter((e) => e.refused);
  return h('div', null,
    h('h3', { class: 'section-title' }, 'Erreurs de l’application'),
    real.length ? h('div', { class: 'set-card' }, real.map(item)) : h('p', { class: 'muted small pad' }, 'Aucune erreur de l’application.'),
    refused.length ? h('h3', { class: 'section-title' }, 'Imports refusés (expliqués à la personne)') : null,
    refused.length ? h('div', { class: 'set-card' }, refused.map(item)) : null);
}

export async function adminView(ctx) {
  ctx.title = 'Administration — AURUM';
  const tab = TABS.some(([k]) => k === ctx.query.get('onglet')) ? ctx.query.get('onglet') : 'apercu';
  const nav = h('nav', { class: 'tabs scroll-x' }, TABS.map(([k, label]) => h('a', { href: `/admin?onglet=${k}`, class: `tab-link${k === tab ? ' on' : ''}` }, label)));
  revealActive(nav);
  const body = h('div', { class: 'admin-body' }, spinner());
  const views = { apercu: overview, signalements: reports, comptes: users, publications: posts, audience, legal, actu: actuSources, demo, erreurs: errors };
  try {
    body.replaceChildren(await views[tab]());
  } catch (err) {
    body.replaceChildren(emptyState('alert', 'Erreur', err.message));
  }
  return h('div', { class: 'page admin' }, h('header', { class: 'page-head' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => navigate('/reglages') }, icon('back')), h('h1', null, 'Administration'), h('span', { class: 'icon-btn' })), nav, body);
}
