'use strict';
// Le Sujet du jour. Chaque jour à 19 h (heure de Paris), le même sujet pour tout le monde. On y répond
// en vidéo (15 secondes conseillées) ; on voit les réponses des autres une fois qu'on a répondu.
// Le lendemain à 19 h, la réponse la plus aimée gagne « l'Or du jour ».
// Tout est automatique :
// - le sujet se choisit tout seul : un thème par jour de la semaine, tiré d'une réserve où rien ne se
//   répète, et le mercredi l'actualité du jour (sujets sensibles écartés). Un sujet programmé par
//   l'administration (proposé par une marque, avec un lot) passe avant ;
// - il est créé au premier passage après 19 h : aucune tâche n'est nécessaire pour qu'il existe. La
//   tâche planifiée de 19 h (Vercel) prévient en plus tout le monde par notification ;
// - l'Or du jour est décerné dès que le sujet se termine.

const TZ = 'Europe/Paris';
const OPEN_HOUR = 19;
const ANSWER_GRACE = 30 * 60 * 1000; // une réponse filmée juste avant 19 h a le temps de finir de s'envoyer

// Thème de chaque jour de la semaine (0 : dimanche)
const RHYTHM = { 0: 'conseil', 1: 'debat', 2: 'defi', 3: 'actu', 4: 'souvenir', 5: 'fun', 6: 'montre' };
const LABELS = {
  debat: 'Débat',
  defi: 'Défi',
  actu: 'L’actu du jour',
  souvenir: 'Souvenir',
  fun: 'Pour rire',
  montre: 'Montre-nous',
  conseil: 'Conseil',
  marque: 'Sujet partenaire',
};

const POOL = {
  debat: [
    'Chocolatine ou pain au chocolat ?',
    'Douche le matin ou le soir ?',
    'Pizza à l’ananas : oui ou non ?',
    'Chaussettes avec des sandales : c’est permis ?',
    'Faut-il répondre aux messages tout de suite ?',
    'Ville ou campagne pour toute la vie ?',
    'Chat ou chien ?',
    'Plage ou montagne ?',
    'Les vocaux de 4 minutes : pour ou contre ?',
    'Faut-il interdire les trottinettes en ville ?',
    'Été ou hiver ?',
    'Se lever tôt ou se coucher tard ?',
    'Une série : tout d’un coup ou un épisode par jour ?',
    'Cinéma ou canapé ?',
    'Le meilleur fromage de France ?',
    'Au premier rendez-vous, on partage l’addition ?',
    'Café sucré ou sans sucre ?',
    'Ketchup ou mayo ?',
    'Le meilleur repas : petit-déj, midi ou soir ?',
    'Faut-il souhaiter son anniversaire à son ex ?',
    'Lire la fin d’un livre avant de le commencer : crime ou pas ?',
  ],
  defi: [
    'Imite le prof qui t’a le plus marqué',
    'Ton meilleur pas de danse, maintenant',
    'Chante le refrain que tu as dans la tête',
    'Présente ton assiette comme un grand chef',
    'Fais la pub d’un objet à côté de toi',
    'Rejoue une scène culte de film',
    'Commente ce que tu vois comme un match de foot',
    'Dis bonjour dans une langue que tu ne parles pas',
    'Montre ton talent caché',
    'Fais rire quelqu’un à côté de toi',
    'Raconte ta journée en trois mots',
    'Ton meilleur tour de magie (même raté)',
    'Imite un animal, on devine lequel',
    'Mime un film, on devine lequel',
    'Tiens sur un pied pendant 15 secondes',
    'Déclare ton amour à ton plat préféré',
    'Fais une météo de ta ville, façon présentateur',
    'Ta meilleure imitation d’un membre de ta famille',
    'Récite l’alphabet à l’envers',
    'Présente ton quartier comme un guide touristique',
  ],
  souvenir: [
    'Ton pire rendez-vous',
    'Le métier dont tu rêvais à 8 ans',
    'Ta plus grosse honte à l’école',
    'Ton plus beau voyage',
    'La fois où tu as eu le plus peur',
    'Ton premier concert',
    'Le cadeau le plus nul qu’on t’ait fait',
    'Ton plus gros fou rire',
    'La bêtise que tes parents ne connaissent toujours pas',
    'Ton tout premier téléphone',
    'Le plat de ta grand-mère que personne ne bat',
    'Ta pire coupe de cheveux',
    'Ton pire job',
    'La chanson de ton meilleur été',
    'Ta rencontre la plus improbable',
    'Le dessin animé de ton enfance',
    'Ton meilleur anniversaire',
    'Le jour où tout est parti de travers',
    'Le plus beau compliment qu’on t’ait fait',
    'La personne qui a changé ta vie',
  ],
  fun: [
    'Ta chanson honteuse préférée',
    'Ton talent complètement inutile',
    'Ce que tu ferais avec 1 000 € demain',
    'Invisible pendant une heure : tu fais quoi ?',
    'Le super-pouvoir que tu choisirais',
    'Ton plat de la flemme',
    'La phrase que ta mère répète tout le temps',
    'Ton surnom et son histoire',
    'Le film que tu peux revoir cent fois',
    'Ta peur la plus bizarre',
    'Trois choses pour une île déserte',
    'Le métier que tu ne ferais jamais',
    'Ta meilleure excuse pour être en retard',
    'Le truc que tout le monde aime sauf toi',
    'Ta réplique de film préférée',
    'Ce que tu manges à 2 h du matin',
    'Ta manie la plus bizarre',
    'Dîner avec n’importe qui : tu choisis qui ?',
    'Le dernier truc qui t’a fait rire aux larmes',
    'L’objet le plus inutile chez toi',
  ],
  montre: [
    'Montre la vue de ta fenêtre',
    'Montre ce qu’il y a dans ton frigo',
    'Montre ton coin préféré de ta ville',
    'Montre ta tenue du jour',
    'Montre ton animal (ou ta plante)',
    'Montre le ciel au-dessus de toi',
    'Montre ton endroit pour bosser',
    'Montre ton assiette de ce soir',
    'Montre l’objet auquel tu tiens le plus',
    'Montre tes chaussures préférées',
    'Montre ton trajet de tous les jours',
    'Montre le dernier truc que tu as acheté',
    'Montre ta collection, peu importe de quoi',
    'Montre ce que tu vois, là, tout de suite',
    'Montre ton petit-déj idéal',
    'Montre ta rue',
    'Montre ce qui te rend heureux en ce moment',
    'Montre ton spot pour réfléchir',
    'Montre ton dernier fond d’écran',
    'Montre ce que tu écoutes en ce moment',
  ],
  conseil: [
    'Ton meilleur conseil en 15 secondes',
    'Ce que tu dirais à toi d’il y a cinq ans',
    'Ton astuce pour bien dormir',
    'Comment tu te remotives quand ça ne va pas',
    'Ta recette la plus simple et la meilleure',
    'Ton astuce pour économiser',
    'Le meilleur bon plan gratuit de ta ville',
    'Comment tu te fais des amis',
    'Ta routine du dimanche',
    'Le film qui a changé ta façon de voir',
    'Un truc à essayer au moins une fois dans sa vie',
    'Ta technique anti-stress',
    'Ton conseil pour un premier rendez-vous',
    'Ce que tu aurais aimé savoir à 15 ans',
    'Ton meilleur conseil d’argent',
    'Comment tu dis non sans fâcher',
    'Ton astuce de cuisine qui change tout',
    'Ce qui te fait du bien en cinq minutes',
    'Comment tu gères un lundi difficile',
    'La meilleure appli gratuite que personne ne connaît',
  ],
};

// L'actualité du jour (le mercredi) : seulement des sujets dont on peut rire ou débattre sans blesser
const SAFE_TOPICS = new Set(['culture', 'sport', 'tech', 'science', 'planete']);
const SENSITIVE =
  /(mort|meurt|décè|décéd|tué|tuer|attentat|terror|guerre|bombard|frappe|missile|otage|viol|agress|meurtr|assassin|victime|drame|tragédi|accident|crash|incendi|suicid|deuil|obsèques|procès|condamn|prison|enquête|haine|racis|antisémit|harcèle|pédo|abus|blessé|fusillade|explosion|catastroph|séisme|inondation|épidémi|cancer|maladi|licenci|faillite|grève|manifestation|élection|gouvernement|ministre|président|politique|gaza|israël|ukraine|russie|iran)/i;

// ── Heures de Paris ──────────────────────────────────────────────────────
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function parts(ms) {
  const o = {};
  for (const p of FMT.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { day: `${o.year}-${o.month}-${o.day}`, y: Number(o.year), mo: Number(o.month), d: Number(o.day), h: Number(o.hour), mi: Number(o.minute), s: Number(o.second) };
}
// Instant d'une heure de Paris, un jour donné (« 2026-11-26 », 19 → 18 h UTC en hiver, 17 h en été)
function parisTime(day, hour) {
  const [y, m, d] = day.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, hour);
  let t = target;
  for (let i = 0; i < 2; i++) {
    const p = parts(t);
    t -= Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - target;
  }
  return t;
}
const shiftDay = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// Jour du sujet en cours : celui de 19 h aujourd'hui, ou celui d'hier avant 19 h
function currentDay(now = Date.now()) {
  const p = parts(now);
  return p.h >= OPEN_HOUR ? p.day : shiftDay(p.day, -1);
}
const weekday = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

// Petite empreinte stable d'un texte (sujet déjà posé) et tirage déterministe par jour
function hash(s) {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0;
  return x;
}
const keyOf = (title) => hash(title.toLowerCase()).toString(36);

// ── Choix automatique ────────────────────────────────────────────────────
async function fromPool(db, kind, day) {
  const list = POOL[kind] || POOL.fun;
  const used = new Set((await db.all('SELECT pool_key FROM subjects WHERE pool_key IS NOT NULL')).map((r) => r.pool_key));
  let fresh = list.filter((t) => !used.has(keyOf(t)));
  if (!fresh.length) {
    // Toute la réserve est passée : on recommence, sans reprendre ceux des deux derniers mois
    const recent = new Set((await db.all('SELECT pool_key FROM subjects WHERE pool_key IS NOT NULL AND day > ?', shiftDay(day, -60))).map((r) => r.pool_key));
    fresh = list.filter((t) => !recent.has(keyOf(t)));
    if (!fresh.length) fresh = list;
  }
  const title = fresh[hash(day) % fresh.length];
  return { title, kind, poolKey: keyOf(title), journalId: null };
}

async function fromActu(db, now) {
  const rows = await db.all(
    `SELECT j.id, j.title, j.featured_at, COALESCE(j.topic, s.topic) AS topic
     FROM journal_items j LEFT JOIN journal_sources s ON s.id = j.source_id
     WHERE j.kind = 'article' AND j.published_at > ?
     ORDER BY (j.featured_at IS NOT NULL) DESC, j.published_at DESC LIMIT 80`,
    now - 36 * 3600e3,
  );
  const ok = rows.find((r) => r.title && r.title.length <= 110 && (r.featured_at || SAFE_TOPICS.has(r.topic)) && !SENSITIVE.test(r.title));
  return ok ? { title: ok.title, kind: 'actu', poolKey: null, journalId: ok.id } : null;
}

async function pickFor(db, day, now) {
  const theme = RHYTHM[weekday(day)];
  if (theme === 'actu') return (await fromActu(db, now)) || fromPool(db, 'fun', day);
  return fromPool(db, theme, day);
}

// Le sujet en cours (créé au premier passage après 19 h, ou celui programmé pour ce jour-là)
async function ensureCurrent(ctx, now = Date.now()) {
  const { db } = ctx;
  const day = currentDay(now);
  const row = await db.get('SELECT * FROM subjects WHERE day = ?', day);
  if (row) return row;
  const pick = await pickFor(db, day, now);
  await db.run(
    `INSERT OR IGNORE INTO subjects (day, title, kind, pool_key, journal_id, opens_at, closes_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    day, pick.title, pick.kind, pick.poolKey, pick.journalId, parisTime(day, OPEN_HOUR), parisTime(shiftDay(day, 1), OPEN_HOUR), now,
  );
  return db.get('SELECT * FROM subjects WHERE day = ?', day);
}

// ── Or du jour : la réponse publique la plus aimée, dès que le sujet se termine ─────────
async function settle(ctx, now = Date.now()) {
  const { db } = ctx;
  const due = await db.all('SELECT * FROM subjects WHERE settled_at IS NULL AND closes_at <= ? ORDER BY closes_at LIMIT 5', now);
  for (const s of due) {
    const best = await db.get(
      `SELECT p.id, p.user_id,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.user_id != p.user_id) AS likes,
              (SELECT COALESCE(SUM(vv.plays), 0) FROM video_views vv WHERE vv.post_id = p.id) + p.guest_views AS views
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.subject_id = ? AND p.privacy = 'public' AND p.flagged IS NULL
         AND u.banned_at IS NULL AND u.is_bot = 0 AND u.private_account = 0
       ORDER BY likes DESC, views DESC, p.id ASC LIMIT 1`,
      s.id,
    );
    const winner = best && best.likes > 0 ? best : null;
    const { changes } = await db.run('UPDATE subjects SET settled_at = ?, winner_post_id = ? WHERE id = ? AND settled_at IS NULL', now, winner?.id || null, s.id);
    if (changes && winner) {
      const { sendPush } = require('./push');
      await sendPush(ctx, winner.user_id, {
        title: 'L’Or du jour est pour toi',
        body: `Ta réponse à « ${s.title} » est la plus aimée.`,
        url: `/sujet/${s.id}`,
        tag: `gold-${s.id}`,
        renotify: true,
        kind: 'subject_gold',
      });
    }
  }
}

// Notification « le sujet est tombé », une seule fois, dans les 3 heures qui suivent 19 h
async function announce(ctx, s, now = Date.now()) {
  if (!s || s.notified_at || now < s.opens_at || now > s.opens_at + 3 * 3600e3) return 0;
  const { changes } = await ctx.db.run('UPDATE subjects SET notified_at = ? WHERE id = ? AND notified_at IS NULL', now, s.id);
  if (!changes) return 0;
  const { sendPushToAll } = require('./push');
  return sendPushToAll(
    ctx,
    {
      title: s.sponsor ? `Le sujet du jour, avec ${s.sponsor}` : 'Le sujet du jour',
      body: `${s.title}${s.prize ? ` · À gagner : ${s.prize}` : ''}`,
      url: '/sujet',
      tag: `subject-${s.id}`,
      renotify: true,
      kind: 'subject',
    },
    { pref: 'subject' },
  );
}

// Tâche planifiée de 19 h : Or du jour d'hier, sujet du jour, notification
async function tick(ctx, now = Date.now()) {
  await settle(ctx, now);
  const s = await ensureCurrent(ctx, now);
  const sent = await announce(ctx, s, now);
  return { subject: s.id, day: s.day, title: s.title, sent };
}

// Jours d'affilée où ce compte a répondu (la série tient jusqu'à 19 h tant qu'on n'a pas répondu au nouveau)
async function streakOf(db, userId, now = Date.now()) {
  const rows = await db.all(
    'SELECT DISTINCT s.day FROM posts p JOIN subjects s ON s.id = p.subject_id WHERE p.user_id = ? ORDER BY s.day DESC LIMIT 400',
    userId,
  );
  const days = new Set(rows.map((r) => r.day));
  let d = currentDay(now);
  if (!days.has(d)) d = shiftDay(d, -1);
  let n = 0;
  while (days.has(d)) {
    n += 1;
    d = shiftDay(d, -1);
  }
  return n;
}

const goldsOf = async (db, userId) =>
  (await db.get('SELECT COUNT(*) AS n FROM subjects s JOIN posts p ON p.id = s.winner_post_id WHERE p.user_id = ?', userId)).n;

function serializeSubject(s, now = Date.now()) {
  return {
    id: s.id,
    day: s.day,
    title: s.title,
    kind: s.kind,
    label: s.sponsor ? LABELS.marque : LABELS[s.kind] || 'Sujet du jour',
    sponsor: s.sponsor || null,
    prize: s.prize || null,
    actuId: s.journal_id || null,
    opensAt: s.opens_at,
    closesAt: s.closes_at,
    open: now >= s.opens_at && now < s.closes_at,
    upcoming: now < s.opens_at,
    winnerPostId: s.winner_post_id || null,
    settled: Boolean(s.settled_at),
  };
}

// Réponse au sujet : il faut qu'il soit ouvert (petite marge pour une vidéo qui finit de s'envoyer)
function canAnswer(s, now = Date.now()) {
  return Boolean(s) && now >= s.opens_at && now < s.closes_at + ANSWER_GRACE;
}

module.exports = {
  OPEN_HOUR,
  POOL,
  RHYTHM,
  LABELS,
  SENSITIVE,
  parts,
  parisTime,
  shiftDay,
  currentDay,
  isDay,
  keyOf,
  pickFor,
  ensureCurrent,
  settle,
  announce,
  tick,
  streakOf,
  goldsOf,
  serializeSubject,
  canAnswer,
};
