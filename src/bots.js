'use strict';
// Comptes automatiques, clairement signalés comme tels (« Automatique ») :
// - AURUM : le compte officiel. Publie dans le Salon les contenus du Journal, une
//   question du jour, les nouveaux événements de l'Agenda, et souhaite la bienvenue.
// - Le Concierge : écrit un message d'accueil à chaque nouveau membre et met en avant
//   l'adresse de la semaine du Carnet.
// Ils n'ont pas de numéro de membre, ne comptent pas dans les effectifs et ne peuvent
// pas se connecter. La Direction peut les désactiver.

const BOTS = {
  aurum: {
    username: 'aurum',
    name: 'AURUM',
    avatar: '/img/bot-aurum.png',
    bio: 'Compte officiel du cercle. Publications automatiques : le Journal, la question du jour, les événements de l’Agenda.',
  },
  concierge: {
    username: 'le.concierge',
    name: 'Le Concierge',
    avatar: '/img/bot-concierge.png',
    bio: 'Accueille les nouveaux membres et partage l’adresse de la semaine. Compte automatique : il ne lit pas les messages.',
  },
};

// Questions du jour : pour lancer la conversation
const QUESTIONS = [
  'Quelle est la table qui vous a le plus marqué cette année, et pourquoi ?',
  'Le voyage dont vous rêvez encore, mais que vous n’avez jamais osé organiser ?',
  'Quel livre offririez-vous à quelqu’un que vous admirez ?',
  'Votre adresse secrète à Paris, celle que vous ne donnez qu’aux amis ?',
  'Quelle décision professionnelle referiez-vous sans hésiter ?',
  'La montre de vos rêves : grande complication ou élégance discrète ?',
  'Quel hôtel vous a donné l’impression d’être enfin chez vous ?',
  'Le meilleur conseil que l’on vous ait donné à vos débuts ?',
  'Quelle œuvre d’art aimeriez-vous voir chaque matin en vous réveillant ?',
  'Montagne ou mer pour les prochaines vacances ? Où exactement ?',
  'Quel vin ouvririez-vous pour une occasion vraiment exceptionnelle ?',
  'Une ville que tout le monde devrait découvrir avant ses 40 ans ?',
  'Quel artisan ou quelle maison mériterait d’être mieux connu ?',
  'Le dernier achat qui vous a vraiment rendu heureux ?',
  'Quelle habitude a le plus changé votre vie ces dernières années ?',
  'Votre rituel du dimanche matin ?',
  'Le restaurant où vous emmèneriez un client à convaincre ?',
  'Quel podcast ou quelle émission écoutez-vous en ce moment ?',
  'Si vous pouviez dîner avec une personnalité, vivante ou non, qui choisiriez-vous ?',
  'Quelle expérience vaut vraiment son prix, selon vous ?',
  'Votre plus belle découverte de l’année : un lieu, un objet, une personne ?',
  'Quelle compétence aimeriez-vous apprendre l’an prochain ?',
  'Le plus bel endroit où vous ayez vu le soleil se lever ?',
  'Quel objet transmettriez-vous à vos enfants ?',
  'Une île, un seul livre, un seul disque : lesquels ?',
  'Quel investissement de passion ne regrettez-vous pas : art, vin, voitures, montres ?',
  'Le geste d’hospitalité qui vous a le plus touché ?',
  'Votre définition du vrai luxe aujourd’hui ?',
  'Quelle exposition ne faut-il pas manquer en ce moment ?',
  'La destination que vous recommandez pour une escapade de trois jours ?',
  'Quel sport ou quelle discipline vous aide à garder l’équilibre ?',
  'Le meilleur cadeau que vous ayez jamais reçu ?',
  'Quelle maison de famille, réelle ou rêvée, vous ressemble le plus ?',
  'Un film que vous revoyez toujours avec le même plaisir ?',
  'Votre tailleur, votre bottier, votre parfumeur : avez-vous un fidèle artisan ?',
  'Qu’est-ce qui rend une soirée réellement mémorable ?',
  'Quelle tradition familiale tenez-vous à perpétuer ?',
  'La rencontre qui a changé le cours de votre carrière ?',
  'Le lieu idéal pour réfléchir à une grande décision ?',
  'Quelle cause vous tient le plus à cœur, et pourquoi ?',
];

const PARIS = 'Europe/Paris';
// Heure de Paris (0 à 23). Attention : en français, l'heure seule s'écrit « 13 h », d'où formatToParts.
const parisHour = (ts) =>
  Number(new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', hourCycle: 'h23' }).formatToParts(ts).find((p) => p.type === 'hour').value);
const parisDay = (ts) => new Intl.DateTimeFormat('fr-CA', { timeZone: PARIS }).format(ts); // AAAA-MM-JJ
const fullDate = (ts) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(ts);

async function setting(db, key) {
  return (await db.get('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
}
function putSetting(db, key, value) {
  return db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

async function botsEnabled(ctx) {
  if (!ctx.config.bots) return false;
  return (await setting(ctx.db, 'bots')) !== 'off';
}

// Crée les comptes au besoin ; renvoie { aurum, concierge } (identifiants, ou null)
const ids = new WeakMap();
async function ensureBots(ctx) {
  const cached = ids.get(ctx.db);
  if (cached) return cached;
  const out = {};
  for (const [key, b] of Object.entries(BOTS)) {
    let row = await ctx.db.get('SELECT id, is_bot FROM users WHERE username = ?', b.username);
    if (!row) {
      const now = Date.now();
      await ctx.db.run(
        `INSERT OR IGNORE INTO users (username, email, password_hash, display_name, bio, avatar, is_bot, paid_at, created_at)
         VALUES (?, ?, 'compte-automatique', ?, ?, ?, 1, ?, ?)`,
        b.username, `${b.username}@automatique.invalid`, b.name, b.bio, b.avatar, now, now,
      );
      row = await ctx.db.get('SELECT id, is_bot FROM users WHERE username = ?', b.username);
    }
    out[key] = row && row.is_bot ? row.id : null; // nom déjà pris par un membre : compte ignoré
  }
  ids.set(ctx.db, out);
  return out;
}

async function postAs(ctx, botId, body, { journalId = null } = {}) {
  if (!botId) return null;
  const { lastInsertRowid } = await ctx.db.run('INSERT INTO posts (user_id, body, journal_id, created_at) VALUES (?, ?, ?, ?)', botId, body, journalId, Date.now());
  const { notifyMentions } = require('./social');
  await notifyMentions(ctx, body, botId, lastInsertRowid).catch(() => {});
  return lastInsertRowid;
}

// Contenu du Journal à publier : une du Journal, sinon on alterne actualités / podcasts / vidéos
async function pickJournalItem(db, lastKind) {
  const notPosted = 'j.id NOT IN (SELECT journal_id FROM posts WHERE journal_id IS NOT NULL)';
  const featured = await db.get(`SELECT * FROM journal_items j WHERE j.featured_at IS NOT NULL AND ${notPosted} ORDER BY j.featured_at DESC LIMIT 1`);
  if (featured) return featured;
  const order = ['article', 'podcast', 'video'];
  const start = (order.indexOf(lastKind) + 1) % order.length;
  const kinds = [...order.slice(start), ...order.slice(0, start)];
  for (const window of [48, 24 * 7]) {
    for (const kind of kinds) {
      const row = await db.get(
        `SELECT * FROM journal_items j WHERE j.kind = ? AND j.published_at > ? AND ${notPosted}
           AND (j.kind != 'article' OR j.image IS NOT NULL)
         ORDER BY j.published_at DESC LIMIT 1`,
        kind, Date.now() - window * 3600 * 1000,
      );
      if (row) return row;
    }
  }
  return null;
}

const JOURNAL_INTRO = {
  article: (it) => `À lire aujourd’hui, via ${it.site_name || 'le Journal'}.`,
  podcast: (it) => `À écouter : un nouvel épisode de ${it.site_name || 'nos podcasts'}.`,
  video: (it) => `À regarder : ${it.site_name || 'la sélection vidéo du Journal'}.`,
};

// Tâches régulières, déclenchées par l'ouverture du Salon (aucun serveur permanent n'est nécessaire)
async function tick(ctx, { force = false, now = Date.now() } = {}) {
  const { db } = ctx;
  if (!(await botsEnabled(ctx))) return { posted: [] };
  const lock = Number(await setting(db, 'bots_lock')) || 0;
  if (!force && now - lock < 60000) return { posted: [] };
  await putSetting(db, 'bots_lock', now);
  const bots = await ensureBots(ctx);
  const hour = parisHour(now);
  const posted = [];
  try {
    // 1. Le Journal : toutes les 4 heures, de 8 h à 23 h
    const lastJournal = Number(await setting(db, 'bots_journal_at')) || 0;
    if (force || (hour >= 8 && hour < 23 && now - lastJournal >= 4 * 3600 * 1000)) {
      const item = await pickJournalItem(db, await setting(db, 'bots_journal_kind'));
      if (item) {
        await postAs(ctx, bots.aurum, JOURNAL_INTRO[item.kind](item), { journalId: item.id });
        await putSetting(db, 'bots_journal_at', now);
        await putSetting(db, 'bots_journal_kind', item.kind);
        posted.push('journal');
      }
    }
    // 2. La question du jour, à partir de 10 h
    const today = parisDay(now);
    if (force || (hour >= 10 && (await setting(db, 'bots_question_day')) !== today)) {
      const n = Math.floor(now / 86400000) % QUESTIONS.length;
      await postAs(ctx, bots.aurum, `La question du jour : ${QUESTIONS[n]}\n\nRépondez en commentaire.`);
      await putSetting(db, 'bots_question_day', today);
      posted.push('question');
    }
    // 3. L'adresse de la semaine (Concierge), une fois par semaine à partir de 11 h
    const lastPlace = Number(await setting(db, 'bots_place_at')) || 0;
    if (force || (hour >= 11 && now - lastPlace >= 7 * 86400000)) {
      const shown = (await setting(db, 'bots_places_shown')) || '';
      const place = await db.get(
        `SELECT pl.*, u.display_name AS author_name,
                (SELECT COUNT(*) FROM place_endorsements x WHERE x.place_id = pl.id) AS endorsements
         FROM places pl JOIN users u ON u.id = pl.author_id
         WHERE (',' || ? || ',') NOT LIKE ('%,' || pl.id || ',%')
         ORDER BY endorsements DESC, pl.id DESC LIMIT 1`,
        shown,
      );
      if (place) {
        const quote = place.note.length > 220 ? `${place.note.slice(0, 217).replace(/\s+\S*$/, '')}…` : place.note;
        await postAs(
          ctx,
          bots.concierge,
          `L’adresse de la semaine : ${place.name}, ${place.city}.\n« ${quote} » — recommandé par ${place.author_name}${place.endorsements ? ` et ${place.endorsements} autre${place.endorsements > 1 ? 's' : ''}` : ''}.\n${ctx.config.baseUrl}/carnet/${place.id}`,
        );
        await putSetting(db, 'bots_places_shown', [shown, place.id].filter(Boolean).join(',').split(',').slice(-30).join(','));
        await putSetting(db, 'bots_place_at', now);
        posted.push('adresse');
      }
    }
  } finally {
    await putSetting(db, 'bots_lock', 0);
  }
  return { posted };
}

// Nouveau membre : bienvenue publique d'AURUM et message privé du Concierge
async function welcomeMember(ctx, user) {
  if (!user || user.is_bot || !(await botsEnabled(ctx))) return;
  const bots = await ensureBots(ctx);
  const first = (user.display_name || '').split(/\s+/)[0];
  const number = user.member_number ? ` N° ${String(user.member_number).padStart(4, '0')}` : '';
  const founder = user.member_number && user.member_number <= ctx.config.founderLimit;
  await postAs(ctx, bots.aurum, `Bienvenue à @${user.username}, membre${number}${founder ? ' et Fondateur' : ''}, qui rejoint le cercle aujourd’hui.`);
  if (bots.concierge) {
    const base = ctx.config.baseUrl;
    const body = [
      `Bonjour ${first}, et bienvenue au cercle.`,
      'Quelques repères pour bien commencer :',
      `• Complétez votre profil (photo, présentation) : ${base}/reglages`,
      `• Le Journal : actualités, podcasts et vidéos choisis pour vous : ${base}/journal`,
      `• L’Agenda : les rendez-vous privés entre membres : ${base}/agenda`,
      `• Le Carnet : les meilleures adresses recommandées par les membres : ${base}/carnet`,
      `• Vos 3 invitations, pour faire entrer vos proches : ${base}/invitations`,
      'Activez aussi les notifications sur votre téléphone dans les Réglages.',
      'Je suis un compte automatique et ne lis pas les réponses : pour toute question, écrivez directement à la Direction.',
    ].join('\n');
    await ctx.db.run('INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)', bots.concierge, user.id, body, Date.now());
  }
}

// Nouvel événement dans l'Agenda : annonce dans le Salon
async function announceEvent(ctx, event, host) {
  if (!(await botsEnabled(ctx))) return;
  const bots = await ensureBots(ctx);
  const where = event.location ? ` — ${event.location}` : '';
  await postAs(
    ctx,
    bots.aurum,
    `Nouvel événement proposé par @${host.username} : « ${event.title} », ${fullDate(event.starts_at)}${where}.\nRéservez votre place : ${ctx.config.baseUrl}/agenda/${event.id}`,
  );
}

module.exports = { parisHour, BOTS, QUESTIONS, ensureBots, botsEnabled, tick, welcomeMember, announceEvent };
