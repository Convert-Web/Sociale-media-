'use strict';
// La Lettre du cercle : l'essentiel de la semaine, envoyé chaque dimanche matin.
const crypto = require('node:crypto');
const { lettreEmail } = require('./emails');

const PARIS = 'Europe/Paris';
const DAY = 86400000;
const parisParts = (ts) => {
  const f = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', hour: '2-digit', hour12: false }).formatToParts(ts);
  return { weekday: f.find((x) => x.type === 'weekday')?.value, hour: Number(f.find((x) => x.type === 'hour')?.value) };
};
const parisDay = (ts) => new Intl.DateTimeFormat('fr-CA', { timeZone: PARIS }).format(ts);
const longDate = (ts, withTime = false) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'long', day: 'numeric', month: 'long', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(ts);
const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

async function setting(db, key) {
  return (await db.get('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
}
function putSetting(db, key, value) {
  return db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

// Lien de désinscription signé (sans connexion)
async function mailSecret(db) {
  let s = await setting(db, 'mail_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    await putSetting(db, 'mail_secret', s);
  }
  return s;
}
async function unsubscribeToken(db, userId) {
  return crypto.createHmac('sha256', await mailSecret(db)).update(`lettre:${userId}`).digest('hex').slice(0, 32);
}
async function checkUnsubscribeToken(db, userId, token) {
  const expected = await unsubscribeToken(db, userId);
  return typeof token === 'string' && token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

async function buildLettre(ctx) {
  const { db, config } = ctx;
  const now = Date.now();
  const abs = (u) => (u && u.startsWith('/') ? `${config.baseUrl}${u}` : u);

  const events = (
    await db.all(
      `SELECT e.*, (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id = e.id) AS going
       FROM events e WHERE e.starts_at > ? AND e.starts_at < ? ORDER BY e.starts_at ASC LIMIT 3`,
      now, now + 21 * DAY,
    )
  ).map((e) => ({ title: e.title, when: longDate(e.starts_at, true), location: e.location, going: e.going, capacity: e.capacity, cover: abs(e.cover), url: `${config.baseUrl}/agenda/${e.id}` }));

  const posts = (
    await db.all(
      `SELECT p.id, p.body, p.image, u.display_name,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS reactions,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments
       FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.groupe_id IS NULL AND u.is_bot = 0 AND p.created_at > ?
       ORDER BY (reactions * 2 + comments * 3) DESC, p.id DESC LIMIT 3`,
      now - 7 * DAY,
    )
  ).map((x) => ({
    excerpt: x.body ? cut(x.body.replace(/\s+/g, ' ').trim(), 120) : `Une photo de ${x.display_name.split(/\s+/)[0]}`,
    author: x.display_name,
    reactions: x.reactions,
    comments: x.comments,
    image: abs(x.image),
    url: `${config.baseUrl}/p/${x.id}`,
  }));

  const journal = [];
  // Un même sujet n'apparaît qu'une fois (article et vidéo d'une même rédaction, par exemple)
  const key = (t) => t.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
  const seen = new Set();
  for (const [kind, label] of [['article', 'Actualité'], ['podcast', 'Podcast'], ['video', 'Vidéo']]) {
    const rows = await db.all(
      `SELECT j.*, s.title AS source_title FROM journal_items j LEFT JOIN journal_sources s ON s.id = j.source_id
       WHERE j.kind = ? AND j.published_at > ? AND (j.kind != 'article' OR j.image IS NOT NULL)
       ORDER BY (j.featured_at IS NOT NULL) DESC, j.published_at DESC LIMIT 5`,
      kind, now - 7 * DAY,
    );
    const j = rows.find((x) => !seen.has(key(x.title)));
    if (j) seen.add(key(j.title));
    if (j) journal.push({ title: j.title, label, site: j.source_title || j.site_name || '', image: j.image, url: kind === 'article' ? j.url : `${config.baseUrl}/journal/${j.id}` });
  }

  const p = await db.get(
    `SELECT pl.*, u.display_name AS author, (SELECT COUNT(*) FROM place_endorsements x WHERE x.place_id = pl.id) AS endorsements
     FROM places pl JOIN users u ON u.id = pl.author_id
     ORDER BY (pl.created_at > ?) DESC, endorsements DESC, pl.id DESC LIMIT 1`,
    now - 30 * DAY,
  );
  const place = p ? { name: p.name, city: p.city, author: p.author, note: cut(p.note, 200), photo: abs(p.photo), url: `${config.baseUrl}/carnet/${p.id}` } : null;

  const fresh = await db.all('SELECT display_name FROM users WHERE paid_at > ? AND is_bot = 0 ORDER BY paid_at ASC LIMIT 9', now - 7 * DAY);
  const newMembers = fresh.slice(0, 8).map((u) => u.display_name);
  if (fresh.length > 8) newMembers.push('et d’autres encore');

  const n = fresh.length;
  const intro = `Voici l’essentiel de la semaine au sein du cercle${n ? `, qui accueille ${n > 8 ? 'plusieurs' : n} nouveau${n > 1 ? 'x' : ''} membre${n > 1 ? 's' : ''}` : ''}.`;
  const preheader = events[0] ? `À l’Agenda : ${events[0].title}` : posts[0] ? posts[0].excerpt : journal[0] ? journal[0].title : 'L’essentiel de la semaine au sein du cercle.';
  return { subject: `La Lettre du cercle — ${longDate(now)}`, intro, preheader, events, posts, journal, place, newMembers };
}

// Envoi : une fois par semaine (sauf envoi de test à une seule personne)
async function sendLettre(ctx, { onlyTo = null } = {}) {
  const { db, config, mailer } = ctx;
  if (!mailer.enabled && !onlyTo) return { sent: 0, skipped: 'Les courriels ne sont pas encore configurés.' };
  const week = parisDay(Date.now()); // jour d'envoi
  if (!onlyTo && (await setting(db, 'lettre_day')) === week) return { sent: 0, skipped: 'La Lettre de cette semaine a déjà été envoyée.' };
  if (!onlyTo) {
    // Réservation immédiate : deux déclenchements simultanés n'envoient pas deux fois
    const last = Number(await setting(db, 'lettre_sent_at')) || 0;
    if (Date.now() - last < 6 * DAY) return { sent: 0, skipped: 'La Lettre a été envoyée il y a moins de 6 jours.' };
    await putSetting(db, 'lettre_day', week);
    await putSetting(db, 'lettre_sent_at', Date.now());
  }
  const data = await buildLettre(ctx);
  const recipients = onlyTo
    ? [onlyTo]
    : await db.all('SELECT id, email, display_name FROM users WHERE paid_at IS NOT NULL AND is_bot = 0 AND email_digest = 1');
  const messages = [];
  for (const r of recipients) {
    const url = `${config.baseUrl}/api/lettre/desabonner?u=${r.id}&t=${await unsubscribeToken(db, r.id)}`;
    messages.push({ to: r.email, name: r.display_name, ...lettreEmail(config, data, r, url) });
  }
  let sent = 0;
  try {
    sent = mailer.sendBatch ? await mailer.sendBatch(messages) : (await Promise.all(messages.map((m) => mailer.send(m)))).length;
  } catch (err) {
    if (!onlyTo) await putSetting(db, 'lettre_day', ''); // échec : nouvel essai possible
    if (!onlyTo) await putSetting(db, 'lettre_sent_at', 0);
    throw err;
  }
  if (!onlyTo) await putSetting(db, 'lettre_count', sent);
  return { sent };
}

module.exports = { buildLettre, sendLettre, unsubscribeToken, checkUnsubscribeToken, parisParts, setting };
