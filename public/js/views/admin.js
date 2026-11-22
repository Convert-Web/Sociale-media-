// Administration : vue d'ensemble, signalements, comptes, publications, audience, informations
// légales, contenu de démonstration, erreurs.
import { api, enc } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, avatar, short, num, money, timeAgo, toast, confirmDialog, emptyState, spinner, debounce } from '../dom.js';
import { tile } from '../components/grid.js';
import { openViewer } from '../components/feed.js';

const TABS = [
  ['apercu', 'Vue d’ensemble'],
  ['signalements', 'Signalements'],
  ['comptes', 'Comptes'],
  ['publications', 'Publications'],
  ['audience', 'Audience'],
  ['legal', 'Légal'],
  ['demo', 'Démo'],
  ['erreurs', 'Erreurs'],
];

const kpi = (label, value, sub = null) => h('div', { class: 'kpi' }, h('small', null, label), h('b', null, value), sub ? h('span', null, sub) : null);

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
    h('div', { class: 'mini-bars', role: 'img', 'aria-label': 'Inscriptions par jour' }, d.signups.map((s) => {
      const max = Math.max(1, ...d.signups.map((x) => x.count));
      return h('span', { class: 'mini-bar', title: `${s.day} : ${s.count}`, style: { '--v': String(s.count / max) } }, h('i'), h('small', null, s.count ? String(s.count) : ''));
    })),
    h('div', { class: 'set-card' },
      h('div', { class: 'tx' }, h('span', { class: 'tx-text' }, 'Paiements', h('small', null, d.payments.stripe ? `Stripe actif${d.payments.webhook ? ' · webhook configuré' : ' · webhook absent'}` : d.payments.demo ? 'Mode démonstration (aucun encaissement)' : 'Désactivés (STRIPE_SECRET_KEY)'))),
      h('div', { class: 'tx' }, h('span', { class: 'tx-text' }, 'Courriels', h('small', null, d.mail.provider ? `Envoi par ${d.mail.provider}` : 'Affichés dans la console (BREVO_API_KEY ou SMTP_URL)')), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: async () => { try { const r = await api.post('/api/admin/email-test'); toast(`Courriel d’essai envoyé (${r.provider})`); } catch (err) { toast(err.message, 'error'); } } }, 'M’envoyer un essai')),
    ),
  );
}

async function reports() {
  const { reports: list } = await api.get('/api/admin/reports');
  if (!list.length) return emptyState('shield', 'Aucun signalement ouvert', 'Tout est calme.');
  return h('div', { class: 'reports' }, list.map((r) => {
    const box = h('div', { class: 'report' },
      h('div', { class: 'report-head' }, h('b', null, r.reason), h('small', null, `${r.automatic ? 'Filtre automatique' : `par @${r.reporter || '?'}`} · ${timeAgo(r.createdAt)}${r.total > 1 ? ` · ${r.total} signalements` : ''}`)),
      r.details ? h('p', { class: 'muted' }, r.details) : null,
      r.target ? h('div', { class: 'report-target' }, r.target.image ? h('img', { src: r.target.image, alt: '' }) : null, h('div', null, h('b', null, `${r.type === 'user' ? 'Compte' : r.type === 'post' ? 'Publication' : r.type === 'comment' ? 'Commentaire' : r.type === 'live' ? 'LIVE' : 'Message'} de ${r.target.authorName} (@${r.target.author})`), r.target.text ? h('p', null, r.target.text.slice(0, 300)) : null, r.target.link ? h('a', { href: r.target.link }, 'Ouvrir') : null)) : h('p', { class: 'muted' }, 'Contenu déjà supprimé.'),
      h('div', { class: 'row-end' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => resolve('dismiss') }, 'Classer'),
        h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => resolve('remove') }, r.type === 'user' ? 'Suspendre le compte' : r.type === 'live' ? 'Arrêter le LIVE' : 'Supprimer')),
    );
    async function resolve(action) {
      if (action === 'remove' && !(await confirmDialog('Confirmer ?', r.type === 'user' ? 'Le compte ne pourra plus se connecter et disparaîtra du site.' : 'Le contenu sera supprimé définitivement.', 'Confirmer'))) return;
      try {
        await api.post(`/api/admin/reports/${r.id}/resolve`, { action });
        box.remove();
        toast(action === 'remove' ? 'Fait' : 'Signalement classé');
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    return box;
  }));
}

function users() {
  const input = h('input', { class: 'input', type: 'search', placeholder: 'Nom, @utilisateur ou e-mail' });
  const list = h('div', { class: 'admin-users' }, spinner());
  const load = async () => {
    try {
      const { users: rows } = await api.get(`/api/admin/users?q=${enc(input.value.trim())}`);
      list.replaceChildren(...rows.map((u) => {
        const act = (a, label, cls = 'btn-ghost') => h('button', { type: 'button', class: `btn ${cls} btn-sm`, onclick: async () => {
          if ((a === 'ban' || a === 'delete') && !(await confirmDialog(a === 'ban' ? `Suspendre @${u.username} ?` : `Supprimer @${u.username} ?`, a === 'ban' ? 'Le compte ne pourra plus se connecter.' : 'Toutes ses données seront effacées définitivement.', 'Confirmer'))) return;
          try {
            if (a === 'delete') await api.del(`/api/admin/users/${u.id}`);
            else await api.post(`/api/admin/users/${u.id}/${a}`);
            toast('Fait');
            load();
          } catch (err) {
            toast(err.message, 'error');
          }
        } }, label);
        return h('div', { class: 'admin-user' },
          h('a', { href: `/@${enc(u.username)}`, class: 'user-row-main' }, avatar(u, 'sm'), h('span', { class: 'user-row-text' }, h('b', null, u.displayName, u.isAdmin ? ' · admin' : '', u.banned ? ' · suspendu' : '', u.demo ? ' · démo' : ''), h('small', null, `@${u.username} · ${u.email} · ${short(u.counts.followers)} abonnés · ${timeAgo(u.createdAt)}`))),
          h('div', { class: 'admin-actions' }, u.verified ? act('unverify', 'Retirer le badge') : act('verify', 'Vérifier'), u.banned ? act('unban', 'Rétablir') : act('ban', 'Suspendre'), u.isAdmin ? act('demote', 'Retirer admin') : act('promote', 'Admin'), act('delete', 'Supprimer', 'btn-danger')));
      }));
    } catch (err) {
      list.replaceChildren(emptyState('alert', 'Erreur', err.message));
    }
  };
  input.addEventListener('input', debounce(load, 250));
  load();
  return h('div', null, input, list);
}

async function posts() {
  const { posts: list } = await api.get('/api/admin/posts');
  if (!list.length) return emptyState('video', 'Aucune publication', null);
  return h('div', { class: 'grid cols-4' }, list.map((p) => tile(p, { showAuthor: true, onOpen: (post) => openViewer(list, { startId: post.id }) })));
}

async function audience() {
  const a = await api.get('/api/admin/analytics');
  const row = (label, items) => h('section', { class: 'set-group' }, h('h3', null, label), h('div', { class: 'set-card' }, items.length ? items.map((x) => h('div', { class: 'tx' }, h('span', { class: 'tx-text' }, x.key), h('b', null, num(x.n)))) : h('p', { class: 'muted small pad' }, 'Pas encore de données.')));
  return h('div', null,
    h('div', { class: 'kpis' }, kpi('Visites (30 j)', short(a.visits)), kpi('Pages vues', short(a.views)), kpi('Aujourd’hui', short(a.today))),
    h('div', { class: 'mini-bars', role: 'img', 'aria-label': 'Visites par jour' }, a.daily.map((d) => {
      const max = Math.max(1, ...a.daily.map((x) => x.count));
      return h('span', { class: 'mini-bar', title: `${d.date.slice(0, 10)} : ${d.count}`, style: { '--v': String(d.count / max) } }, h('i'), h('small', null, d.count ? String(d.count) : ''));
    })),
    row('Pages', a.pages), row('Provenance', a.sources), row('Campagnes', a.campaigns), row('Appareils', a.devices),
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
        toast(err.message, 'error');
      } finally {
        save.disabled = false;
      }
    },
  }, h('p', { class: 'muted small' }, 'Elles apparaissent dans les mentions légales, les CGU, les CGV et la politique de confidentialité. Elles restent dans la base, jamais dans le code.'),
  Object.entries(fields).map(([k, f]) => {
    inputs[k] = h('input', { class: 'input', value: data[k] || '', maxlength: f.max, required: f.required, type: f.email ? 'email' : f.url ? 'url' : 'text' });
    return h('label', { class: 'field' }, h('span', null, f.label, f.required ? ' *' : ''), inputs[k]);
  }), save);
}

function demo() {
  const out = h('p', { class: 'muted small' });
  const run = async (action) => {
    if (action === 'remove' && !(await confirmDialog('Retirer la démo ?', 'Les comptes de démonstration et leurs vidéos seront supprimés.', 'Retirer'))) return;
    out.textContent = 'En cours…';
    try {
      const r = await api.post('/api/admin/demo', { action });
      out.textContent = action === 'remove' ? `${r.removed} comptes de démonstration retirés.` : r.added ? `${r.users} comptes et ${r.posts} vidéos ajoutés.` : 'La démo est déjà présente.';
    } catch (err) {
      out.textContent = err.message;
    }
  };
  return h('div', { class: 'form-stack' },
    h('p', null, 'Ajoute 12 comptes de démonstration (signalés comme tels sur leur profil) et 14 vidéos originales générées par calcul — visuels mathématiques, textes et musiques synthétisées — avec des sons réutilisés, des abonnements, des J’aime et des commentaires. Pratique pour présenter Vibz ; à retirer avant d’ouvrir au public.'),
    h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => run('remove') }, 'Retirer la démo'), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => run('add') }, 'Ajouter la démo')),
    out);
}

async function errors() {
  const { errors: list } = await api.get('/api/admin/errors');
  if (!list.length) return emptyState('check', 'Aucune erreur', 'Les erreurs survenues dans les navigateurs apparaîtront ici.');
  return h('div', { class: 'set-card' }, list.map((e) => h('div', { class: 'tx' }, h('span', { class: 'tx-text' }, e.message, h('small', null, `${e.path} · ${e.device} · ${timeAgo(e.at)}`)))));
}

export async function adminView(ctx) {
  ctx.title = 'Administration — Vibz';
  const tab = TABS.some(([k]) => k === ctx.query.get('onglet')) ? ctx.query.get('onglet') : 'apercu';
  const nav = h('nav', { class: 'tabs scroll-x' }, TABS.map(([k, label]) => h('a', { href: `/admin?onglet=${k}`, class: `tab-link${k === tab ? ' on' : ''}` }, label)));
  const body = h('div', { class: 'admin-body' }, spinner());
  const views = { apercu: overview, signalements: reports, comptes: users, publications: posts, audience, legal, demo, erreurs: errors };
  try {
    body.replaceChildren(await views[tab]());
  } catch (err) {
    body.replaceChildren(emptyState('alert', 'Erreur', err.message));
  }
  return h('div', { class: 'page admin' }, h('header', { class: 'page-head' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => navigate('/reglages') }, icon('back')), h('h1', null, 'Administration'), h('span', { class: 'icon-btn' })), nav, body);
}
