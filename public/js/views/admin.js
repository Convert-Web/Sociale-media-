import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon, avatar, nameLine, memberChip, money, num, timeAgo, toast, confirmDialog, emptyState } from '../dom.js';
import { backHead } from './feed.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const k of kids) el.append(k);
  return el;
}

function signupChart(days, label = 'Nouveaux membres sur 14 jours') {
  // Largeur proche de celle d'un téléphone : les chiffres restent lisibles une fois réduits
  const W = 400;
  const H = 170;
  const pad = { t: 16, b: 26, l: 4, r: 4 };
  const max = Math.max(1, ...days.map((d) => d.count));
  const bw = (W - pad.l - pad.r) / days.length;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label });
  root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, class: 'chart-axis' }));
  days.forEach((d, i) => {
    const hgt = ((H - pad.t - pad.b) * d.count) / max;
    const x = pad.l + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const y = H - pad.b - hgt;
    const g = svg('g', {});
    g.append(svg('title', {}, `${new Date(d.date).toLocaleDateString('fr-FR')} : ${d.count}`));
    g.append(svg('rect', { x, y: d.count ? y : H - pad.b - 2, width: w, height: d.count ? hgt : 2, rx: 4, class: d.count ? 'chart-bar' : 'chart-bar-empty' }));
    if (d.count) {
      const t = svg('text', { x: x + w / 2, y: y - 5, 'text-anchor': 'middle', class: 'chart-value', 'font-size': '13' });
      t.textContent = d.count;
      g.append(t);
    }
    if ((days.length - 1 - i) % 3 === 0) {
      const lbl = svg('text', { x: x + w / 2, y: H - 8, 'text-anchor': 'middle', class: 'chart-label', 'font-size': '12' });
      lbl.textContent = new Date(d.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      g.append(lbl);
    }
    root.append(g);
  });
  return root;
}

// File des signalements
async function reportsSection() {
  const host = h('div', { class: 'reports' });
  const { reports } = await api.get('/api/admin/reports');
  if (!reports.length) {
    host.append(h('div', { class: 'reports-empty' }, icon('shield', 'icon-sm'), 'Aucun signalement à traiter.'));
    return host;
  }
  const LABEL = { post: 'Publication', comment: 'Commentaire', user: 'Membre', message: 'Message privé' };
  const REMOVE = { post: 'Supprimer la publication', comment: 'Supprimer le commentaire', user: 'Exclure le membre', message: 'Supprimer le message' };
  for (const r of reports) {
    const resolve = async (action) => {
      if (action === 'remove' && !(await confirmDialog(`${REMOVE[r.type]} ?`, 'Cette action est définitive.', REMOVE[r.type]))) return;
      try {
        await api.post(`/api/admin/reports/${r.id}/resolve`, { action });
        card.remove();
        toast(action === 'remove' ? 'Contenu retiré.' : 'Signalement classé.');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const card = h(
      'article',
      { class: 'report-card' },
      h(
        'div',
        { class: 'report-head' },
        h('span', { class: 'tag' }, LABEL[r.type] || r.type),
        h('b', null, r.reason),
        r.total > 1 ? h('span', { class: 'report-count' }, `${r.total} signalements`) : null,
        h('span', { class: 'muted small' }, timeAgo(r.createdAt)),
      ),
      r.target
        ? h(
            r.target.link ? 'a' : 'div',
            { href: r.target.link || undefined, class: 'report-target' },
            h('small', null, `${r.target.authorName} · @${r.target.author}${r.target.to ? ` → @${r.target.to}` : ''}`),
            r.target.text ? h('p', null, r.target.text.slice(0, 220)) : null,
            r.target.image ? h('img', { src: r.target.image, alt: '' }) : null,
          )
        : h('p', { class: 'muted small' }, 'Le contenu a déjà été supprimé.'),
      r.details ? h('p', { class: 'report-details' }, r.automatic ? `Détecté : ${r.details}` : `« ${r.details} »`) : null,
      h('p', { class: 'muted small' }, r.automatic ? 'Détecté par le filtre automatique' : `Signalé par @${r.reporter || 'membre supprimé'}`),
      h(
        'div',
        { class: 'row-end' },
        h('button', { class: 'btn btn-ghost btn-sm', onclick: () => resolve('dismiss') }, 'Classer sans suite'),
        r.target ? h('button', { class: 'btn btn-danger btn-sm', onclick: () => resolve('remove') }, REMOVE[r.type]) : null,
      ),
    );
    host.append(card);
  }
  return host;
}

// Informations légales de l'éditeur : affichées dans les mentions légales, CGU, CGV et RGPD.
// Elles sont gardées dans la base (jamais dans le code publié).
async function legalSection() {
  const host = h('div', { class: 'card emails-card legal-card' });
  let d;
  try {
    d = await api.get('/api/admin/legal');
  } catch (err) {
    host.append(h('p', { class: 'muted' }, err.message));
    return host;
  }
  const status = h('div', { class: 'push-status' });
  const paint = (missing) => {
    status.className = `push-status${missing.length ? '' : ' on'}`;
    status.replaceChildren(h('span', { class: 'push-dot' }), missing.length ? `${missing.length} information${missing.length > 1 ? 's' : ''} obligatoire${missing.length > 1 ? 's' : ''} à compléter` : 'Pages légales complètes');
  };
  paint(d.missing);
  const inputs = {};
  const save = h('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, 'Enregistrer');
  const form = h(
    'form',
    {
      class: 'legal-form',
      onsubmit: async (e) => {
        e.preventDefault();
        save.disabled = true;
        try {
          const body = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
          const r = await api.put('/api/admin/legal', body);
          paint(r.missing);
          toast('Informations légales enregistrées.');
        } catch (err) {
          toast(err.message, 'error');
        }
        save.disabled = false;
      },
    },
    d.fields.map((f) => {
      const type = f.key === 'email' ? 'email' : f.key === 'mediatorUrl' ? 'url' : 'text';
      const el = h('input', { class: 'input', type, maxlength: f.max, value: d.legal[f.key] || '', placeholder: PLACEHOLDERS[f.key] || '', autocomplete: 'off' });
      inputs[f.key] = el;
      return h('label', { class: 'field' }, h('span', null, f.label, f.required ? null : h('small', { class: 'muted' }, ' — facultatif')), el);
    }),
    h('div', { class: 'legal-form-foot' }, h('a', { href: '/mentions-legales', target: '_blank', class: 'small' }, 'Voir les pages légales'), save),
  );
  host.append(status, h('p', { class: 'small muted' }, 'Ces informations apparaissent dans les mentions légales, les CGU, les CGV et la politique de confidentialité. Elles sont obligatoires pour un service payant.'), form);
  return host;
}
const PLACEHOLDERS = {
  editorName: 'Ex. : Prénom Nom, ou AURUM SAS',
  legalForm: 'Ex. : Entrepreneur individuel (micro-entreprise)',
  capital: 'Ex. : 1 000 € (sociétés uniquement)',
  address: 'Numéro, rue, code postal, ville',
  siren: '9 chiffres (SIREN) ou 14 (SIRET)',
  registry: 'Ex. : RCS Paris, ou Registre national des entreprises',
  vat: 'Ex. : TVA non applicable, art. 293 B du CGI',
  director: 'Prénom Nom',
  email: 'contact@…',
  phone: 'Facultatif',
  mediatorName: 'Ex. : CM2C, Medicys…',
  mediatorUrl: 'https://…',
};

const kpi = (label, value, gold, sub) => h('div', { class: `kpi${gold ? ' gold' : ''}` }, h('small', null, label), h('b', { class: gold ? 'accent' : '' }, value), sub ? h('span', { class: 'muted small' }, sub) : null);

// Audience : mesure anonyme, sans cookie, faite par AURUM
const PAGE_NAMES = {
  '/': 'Accueil', '/inscription': 'Inscription', '/connexion': 'Connexion', '/rejoindre': 'Droit d’entrée', '/bienvenue': 'Bienvenue',
  '/salon': 'Salon', '/videos': 'Vidéos', '/explorer': 'Explorer', '/journal': 'Journal', '/journal/:id': 'Articles du Journal',
  '/messages': 'Messages', '/messages/:username': 'Conversations', '/@:username': 'Profils', '/p/:id': 'Publications',
  '/notifications': 'Activité', '/agenda': 'Agenda', '/agenda/:id': 'Événements', '/carnet': 'Carnet', '/carnet/:id': 'Adresses',
  '/groupes': 'Groupes', '/groupes/:id': 'Groupe', '/amis': 'Amis', '/invitations': 'Invitations', '/invitation/:code': 'Liens d’invitation',
  '/reglages': 'Réglages', '/cgu': 'CGU', '/cgv': 'CGV', '/confidentialite': 'Confidentialité', '/rgpd': 'RGPD', '/mentions-legales': 'Mentions légales', '404': 'Page introuvable',
};
const DEVICE_NAMES = { mobile: 'Téléphone', ordinateur: 'Ordinateur', tablette: 'Tablette' };
async function audienceSection() {
  let a;
  try {
    a = await api.get('/api/admin/analytics');
  } catch (err) {
    return h('p', { class: 'muted', style: { margin: '0 var(--gutter)' } }, err.message);
  }
  const list = (title, rows, name = (k) => k, empty = 'Rien pour l’instant') =>
    h(
      'div',
      { class: 'card stat-list' },
      h('b', null, title),
      rows.length
        ? h('ol', null, rows.map((r) => h('li', null, h('span', null, name(r.key)), h('small', null, num(r.n)))))
        : h('p', { class: 'small muted' }, empty),
    );
  return h(
    'div',
    null,
    h('div', { class: 'kpis' }, kpi('Visites', num(a.visits), true, '30 derniers jours'), kpi('Pages vues', num(a.views), false, '30 derniers jours'), kpi('Aujourd’hui', num(a.today), false, 'visites')),
    h('div', { class: 'chart' }, signupChart(a.daily, 'Visites sur 14 jours')),
    h(
      'div',
      { class: 'stat-grid' },
      list('Provenance', a.sources, (k) => (k === 'direct' ? 'Accès direct ou application' : k)),
      list('Campagnes (utm_source)', a.campaigns, (k) => k, 'Ajoutez ?utm_source=tiktok à vos liens pour les suivre'),
      list('Pages les plus vues', a.pages, (k) => PAGE_NAMES[k] || k),
      list('Appareils', a.devices, (k) => DEVICE_NAMES[k] || k),
    ),
    h('p', { class: 'small muted', style: { margin: '10px var(--gutter-r) 0 var(--gutter)' } }, 'Mesure anonyme, sans cookie et sans service extérieur. Vos propres visites (Direction) ne sont pas comptées.'),
  );
}

// Erreurs survenues chez les visiteurs : rien à faire tant que tout va bien
async function errorsSection() {
  let d;
  try {
    d = await api.get('/api/admin/errors');
  } catch {
    return null;
  }
  const host = h('div', { class: 'card emails-card' });
  host.append(
    h('div', { class: `push-status${d.count ? '' : ' on'}` }, h('span', { class: 'push-dot' }), d.count ? `${num(d.count)} erreur${d.count > 1 ? 's' : ''} sur 24 h` : 'Aucune erreur sur 24 h'),
  );
  if (d.top.length) {
    host.append(
      h(
        'ol',
        { class: 'error-list' },
        d.top.map((e) => h('li', null, h('b', null, e.message), h('small', null, `${num(e.n)} fois · ${e.path} · ${e.device} · ${timeAgo(e.last)}`))),
      ),
    );
  }
  return host;
}

// Courriels : état de l'envoi, essais et Lettre du cercle
async function emailsSection() {
  const host = h('div', { class: 'card emails-card' });
  let d;
  try {
    d = await api.get('/api/admin/emails');
  } catch (err) {
    host.append(h('p', { class: 'muted' }, err.message));
    return host;
  }
  const status = d.enabled
    ? h('div', { class: 'push-status on' }, h('span', { class: 'push-dot' }), `Envoi actif${d.provider === 'brevo' ? ' via Brevo' : ''}${d.from ? ` — expéditeur : ${d.from}` : ''}`)
    : h('div', { class: 'push-status' }, h('span', { class: 'push-dot' }), 'Envoi non configuré');
  const action = (label, fn, cls = 'btn-secondary') => {
    const b = h('button', { class: `btn ${cls} btn-sm`, type: 'button' }, label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await fn();
      } catch (err) {
        toast(err.message, 'error');
      }
      b.disabled = false;
    });
    return b;
  };
  host.append(
    status,
    d.enabled
      ? null
      : h('p', { class: 'small muted' }, 'Ajoutez la clé Brevo (BREVO_API_KEY) et l’expéditeur (MAIL_FROM) dans les réglages Vercel du projet, puis redéployez : la marche à suivre est dans le README.'),
    h(
      'p',
      { class: 'small muted' },
      `La Lettre du cercle part chaque dimanche matin à ${d.subscribers} membre${d.subscribers > 1 ? 's' : ''} abonné${d.subscribers > 1 ? 's' : ''}.`,
      d.lastSentAt ? ` Dernier envoi : ${timeAgo(d.lastSentAt)} (${d.lastCount} destinataire${d.lastCount > 1 ? 's' : ''}).` : '',
    ),
    h(
      'div',
      { class: 'row-start' },
      h('a', { class: 'btn btn-ghost btn-sm', href: '/api/admin/lettre/apercu', target: '_blank', rel: 'noopener' }, 'Aperçu de la Lettre'),
      d.enabled ? action('M’envoyer un test', async () => toast(`Courriel de test envoyé à ${(await api.post('/api/admin/emails/test')).to}.`)) : null,
      d.enabled ? action('M’envoyer la Lettre', async () => (await api.post('/api/admin/lettre/send', { test: true }), toast('La Lettre vous a été envoyée.'))) : null,
      d.enabled
        ? action(
            'Envoyer la Lettre à tous',
            async () => {
              if (!(await confirmDialog('Envoyer la Lettre maintenant ?', `Elle partira à ${d.subscribers} membre${d.subscribers > 1 ? 's' : ''}. L’envoi automatique de dimanche sera alors sauté cette semaine.`, 'Envoyer', false))) return;
              const r = await api.post('/api/admin/lettre/send');
              toast(r.skipped || `Lettre envoyée à ${r.sent} membre${r.sent > 1 ? 's' : ''}.`, r.skipped ? 'error' : 'ok');
            },
            'btn-primary',
          )
        : null,
    ),
  );
  return host;
}

// Comptes automatiques (AURUM, Le Concierge)
let botsState = { enabled: false, available: false };
function botsSwitch() {
  const sw = h('input', { type: 'checkbox', class: 'switch', checked: botsState.enabled, disabled: !botsState.available, 'aria-label': 'Comptes automatiques' });
  const sub = h('small', { class: 'muted' });
  const paint = () => {
    sub.textContent = !botsState.available
      ? 'Désactivés par la configuration du serveur (BOTS=off).'
      : botsState.enabled
        ? 'AURUM et Le Concierge animent le Salon : Journal, question du jour, événements, bienvenue.'
        : 'Aucune publication automatique.';
  };
  paint();
  sw.addEventListener('change', async () => {
    try {
      const { enabled } = await api.post('/api/admin/bots', { enabled: sw.checked });
      botsState.enabled = enabled;
      paint();
      toast(enabled ? 'Comptes automatiques activés.' : 'Comptes automatiques désactivés.');
    } catch (err) {
      sw.checked = !sw.checked;
      toast(err.message, 'error');
    }
  });
  return h('label', { class: 'admission-mode' }, h('span', { class: 'grow' }, h('b', null, 'Comptes automatiques'), sub), sw);
}

// Demandes d'admission et mode d'entrée (libre / sur invitation)
async function admissionsSection(mode) {
  const host = h('div', { class: 'admissions' });
  const { admissions } = await api.get('/api/admin/admissions');
  let current = mode;
  const sw = h('input', { type: 'checkbox', class: 'switch', checked: current === 'invitation', 'aria-label': 'Entrée sur invitation' });
  const status = h('small', { class: 'muted' });
  const paintMode = () => {
    status.textContent =
      current === 'invitation'
        ? 'Sans invitation, chaque inscription arrive ici pour validation.'
        : 'Entrée libre : toute inscription devient membre immédiatement.';
  };
  paintMode();
  sw.addEventListener('change', async () => {
    try {
      ({ admission: current } = await api.post('/api/admin/settings', { admission: sw.checked ? 'invitation' : 'open' }));
      paintMode();
      toast(current === 'invitation' ? 'Entrée sur invitation activée.' : 'Entrée libre activée.');
    } catch (err) {
      sw.checked = !sw.checked;
      toast(err.message, 'error');
    }
  });
  host.append(h('label', { class: 'admission-mode' }, h('span', { class: 'grow' }, h('b', null, 'Entrée sur invitation'), status), sw));
  host.append(botsSwitch());

  const pending = admissions.filter((a) => !a.declined && !a.approved);
  const declined = admissions.filter((a) => a.declined);
  const awaiting = admissions.filter((a) => a.approved && !a.declined);
  const row = (a) => {
    const act = async (action) => {
      try {
        const res = await api.post(`/api/admin/admissions/${a.id}/${action}`);
        toast(
          action !== 'approve'
            ? 'Demande refusée.'
            : res.member
              ? `${a.displayName} est désormais membre.`
              : `Admission acceptée : ${a.displayName} a reçu le lien pour régler son droit d’entrée.`,
        );
        card.remove();
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const card = h(
      'div',
      { class: 'admission-card' },
      h('div', { class: 'admission-head' }, avatar(a, 'sm'), h('div', { class: 'grow' }, h('b', null, a.displayName), h('small', { class: 'muted' }, `@${a.username} · ${a.email} · ${timeAgo(a.createdAt)}`))),
      a.note ? h('p', { class: 'admission-text' }, `« ${a.note} »`) : h('p', { class: 'muted small' }, 'Aucune présentation.'),
      h(
        'div',
        { class: 'row-start' },
        a.approved && !a.declined
          ? h('span', { class: 'tag' }, 'Acceptée · droit d’entrée en attente')
          : h('button', { class: 'btn btn-primary btn-sm', onclick: () => act('approve') }, icon('check', 'icon-sm'), 'Admettre'),
        a.declined ? h('span', { class: 'tag' }, 'Refusée') : h('button', { class: 'btn btn-ghost btn-sm', onclick: () => act('decline') }, 'Refuser'),
      ),
    );
    return card;
  };
  if (!pending.length) host.append(h('div', { class: 'reports-empty' }, icon('ticket', 'icon-sm'), 'Aucune demande en attente.'));
  for (const a of pending) host.append(row(a));
  if (awaiting.length) {
    host.append(h('details', { class: 'admissions-declined' }, h('summary', null, `Acceptées, droit d’entrée en attente (${awaiting.length})`), awaiting.map(row)));
  }
  if (declined.length) {
    const more = h('details', { class: 'admissions-declined' }, h('summary', null, `Demandes refusées (${declined.length})`), declined.map(row));
    host.append(more);
  }
  return host;
}

export async function adminView(ctx) {
  const data = await api.get('/api/admin/overview');
  botsState = { enabled: Boolean(data.config.bots), available: Boolean(data.config.botsAvailable) };
  const admissions = await admissionsSection(data.config.admission);
  const [emails, legal, audience, errors] = await Promise.all([emailsSection(), legalSection(), audienceSection(), errorsSection()]);
  const reports = await reportsSection();
  const t = data.totals;
  const c = data.config;
  const price = money(c.priceCents, c.currency);
  // Entrée : gratuite pour les Fondateurs, puis droit d'entrée (Stripe)
  const entry = h(
    'div',
    { class: 'admissions' },
    h(
      'div',
      { class: 'admission-mode' },
      h(
        'span',
        { class: 'grow' },
        h('b', null, c.paidEntry ? `Entrée payante · ${price}` : `Entrée gratuite · ${num(c.foundersLeft)} place${c.foundersLeft > 1 ? 's' : ''} de Fondateur sur ${num(c.founderLimit)}`),
        h(
          'small',
          { class: 'muted' },
          c.paidEntry
            ? `Les ${num(c.founderLimit)} places gratuites sont attribuées. Après invitation ou votre accord, chaque nouveau membre règle un droit d’entrée unique.`
            : `Ensuite, l’entrée deviendra payante automatiquement : droit d’entrée unique de ${price}, après invitation ou votre accord.`,
        ),
      ),
    ),
    c.stripeEnabled
      ? h('div', { class: 'form-ok' }, 'Stripe est branché : les paiements arrivent directement sur votre compte Stripe.')
      : h(
          'div',
          { class: 'form-error' },
          c.paidEntry
            ? 'Stripe n’est pas encore branché : les nouveaux membres ne peuvent pas régler leur droit d’entrée. '
            : 'À brancher avant la dernière place de Fondateur : ',
          'créez un compte Stripe (gratuit, sans abonnement), puis ajoutez STRIPE_SECRET_KEY et STRIPE_WEBHOOK_SECRET dans les réglages Vercel.',
        ),
  );


  const memberRows = data.recentMembers.map((m) => {
    const row = h(
      'tr',
      null,
      h('td', null, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, avatar(m, 'xs'), h('div', null, nameLine(m), h('div', { class: 'muted small' }, m.email)))),
      h('td', null, m.memberNumber ? memberChip(m) : h('span', { class: 'tag' }, 'En attente')),
      h('td', { class: 'muted small' }, timeAgo(m.createdAt)),
      h(
        'td',
        { style: { textAlign: 'right' } },
        m.id === store.user.id
          ? h('span', { class: 'muted small' }, 'Vous')
          : h(
          'button',
          {
            class: 'btn btn-danger btn-sm',
            onclick: async () => {
              if (!(await confirmDialog(`Exclure ${m.displayName} ?`, 'Le compte et tout son contenu seront supprimés définitivement.', 'Exclure'))) return;
              try {
                await api.del(`/api/admin/users/${m.id}`);
                row.remove();
                toast('Membre exclu.');
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          'Exclure',
        ),
      ),
    );
    return row;
  });

  const paymentRows = data.recentPayments.map((p) =>
    h(
      'tr',
      null,
      h('td', null, p.username ? `@${p.username}` : h('span', { class: 'muted' }, 'compte supprimé')),
      h('td', null, money(p.amount_cents, p.currency)),
      h('td', null, h('span', { class: 'tag' }, p.provider === 'demo' ? 'Simulé' : 'Stripe')),
      h('td', { class: 'muted small' }, timeAgo(p.created_at)),
    ),
  );

  ctx.title = 'Direction — AURUM';
  return h(
    'div',
    null,
    backHead(
      'Direction du cercle',
      !c.paidEntry ? 'Entrée gratuite — Fondateurs' : c.stripeEnabled ? 'Entrée payante · Stripe actif' : 'Entrée payante · Stripe à brancher',
    ),
    h(
      'div',
      { class: 'kpis' },
      kpi('Membres', num(t.members), true),
      c.paidEntry
        ? kpi("Droits d'entrée encaissés", money(t.revenue), true, t.demoRevenue ? `+ ${money(t.demoRevenue)} simulés` : null)
        : kpi('Places de Fondateur', num(c.foundersLeft), true, `restantes sur ${num(c.founderLimit)}`),
      kpi('Signalements à traiter', num(t.openReports || 0), Boolean(t.openReports), t.autoReports ? `dont ${num(t.autoReports)} par le filtre automatique` : null),
      c.paidEntry ? kpi('En attente de paiement', num(t.awaitingPayment || 0)) : kpi('Réactions', num(t.likes)),
      kpi('Publications', num(t.posts)),
      kpi('Commentaires', num(t.comments)),
      kpi('Messages privés', num(t.messages)),
      kpi('Vidéos', num(t.videos || 0), false, `${num(Math.round((t.videoBytes || 0) / 1048576))} Mo sur ${num(Math.round(c.videoStorageBytes / 1048576))} Mo`),
    ),
    h('div', { class: 'section-title' }, 'Audience — 30 jours'),
    audience,
    h('div', { class: 'section-title' }, 'Entrée dans le cercle'),
    entry,
    errors ? h('div', { class: 'section-title' }, 'Santé de l’application') : null,
    errors ? h('div', { class: 'admissions' }, errors) : null,
    h('div', { class: 'section-title' }, 'Courriels'),
    h('div', { class: 'admissions' }, emails),
    h('div', { class: 'section-title' }, 'Informations légales'),
    h('div', { class: 'admissions' }, legal),
    admissions ? h('div', { class: 'section-title' }, `Demandes d’admission${data.totals.admissions ? ` · ${data.totals.admissions}` : ''}`) : null,
    admissions,
    h('div', { class: 'section-title' }, 'Signalements'),
    reports,
    h('div', { class: 'section-title' }, 'Nouveaux membres — 14 jours'),
    h('div', { class: 'chart' }, signupChart(data.signups)),
    h('div', { class: 'section-title' }, 'Derniers inscrits'),
    memberRows.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Membre'), h('th', null, 'Statut'), h('th', null, 'Inscription'), h('th'))), h('tbody', null, memberRows)))
      : emptyState('users', 'Aucun inscrit', null),
    h('div', { class: 'section-title' }, 'Derniers paiements'),
    paymentRows.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Membre'), h('th', null, 'Montant'), h('th', null, 'Moyen'), h('th', null, 'Date'))), h('tbody', null, paymentRows)))
      : emptyState('euro', 'Aucun paiement', null),
  );
}
