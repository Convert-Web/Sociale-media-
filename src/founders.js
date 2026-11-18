'use strict';
// Privilèges des Fondateurs (les 100 premiers numéros) : avant-premières.
// - Annonces de la Direction : visibles d'abord par les seuls Fondateurs, puis publiées
//   dans le Salon pour tous à l'heure prévue.
// - Événements de la Direction : visibles et ouverts aux inscriptions d'abord pour les
//   Fondateurs (avantage réel quand les places sont limitées).
const { isFounder } = require('./social');

const EARLY_HOURS = [24, 48, 168];
const HOUR = 3600 * 1000;

// Le lecteur voit-il les avant-premières ? (Fondateur ou Direction)
const seesEarly = (ctx, user) => Boolean(user && (user.is_admin || isFounder(ctx, user.member_number)));

const earlyHours = (value) => (EARLY_HOURS.includes(Number(value)) ? Number(value) : 48);

// Prévient les Fondateurs sur leur téléphone (sauf l'auteur)
async function notifyFounders(ctx, payload, exceptId) {
  const { sendPush } = require('./push');
  const rows = await ctx.db.all(
    'SELECT id FROM users WHERE paid_at IS NOT NULL AND is_bot = 0 AND member_number IS NOT NULL AND member_number <= ? AND id != ?',
    ctx.config.founderLimit, exceptId || 0,
  );
  for (const r of rows) await sendPush(ctx, r.id, payload).catch(() => {});
}

// Fin d'avant-première : l'annonce devient une publication du Salon (en tête du fil, pour
// tous), l'événement est annoncé dans le Salon. Appelé à l'ouverture du Salon et de l'Agenda.
async function releaseDue(ctx) {
  const now = Date.now();
  const due = await ctx.db.get(
    `SELECT (SELECT COUNT(*) FROM previews WHERE post_id IS NULL AND release_at <= ?) AS previews,
            (SELECT COUNT(*) FROM events WHERE announce_pending = 1 AND early_until <= ?) AS events`,
    now, now,
  );
  if (due.previews) {
    for (const p of await ctx.db.all('SELECT * FROM previews WHERE post_id IS NULL AND release_at <= ? ORDER BY release_at LIMIT 10', now)) {
      // Transaction : une annonce ne peut être publiée qu'une fois, même avec deux visites simultanées
      await ctx.db.transaction(async (t) => {
        const fresh = await t.get('SELECT post_id FROM previews WHERE id = ?', p.id);
        if (!fresh || fresh.post_id) return;
        const images = JSON.parse(p.images || '[]');
        const { lastInsertRowid } = await t.run(
          'INSERT INTO posts (user_id, body, image, preview_at, created_at) VALUES (?, ?, ?, ?, ?)',
          p.author_id, p.body, images[0] || null, p.created_at, Date.now(),
        );
        for (const [i, url] of images.slice(1).entries()) {
          await t.run('INSERT INTO post_media (post_id, url, position) VALUES (?, ?, ?)', lastInsertRowid, url, i + 1);
        }
        await t.run('UPDATE previews SET post_id = ? WHERE id = ?', lastInsertRowid, p.id);
      });
    }
  }
  if (due.events) {
    const { announceEvent } = require('./bots');
    const rows = await ctx.db.all(
      'SELECT e.*, u.username FROM events e JOIN users u ON u.id = e.owner_id WHERE e.announce_pending = 1 AND e.early_until <= ? LIMIT 10',
      now,
    );
    for (const e of rows) {
      const { changes } = await ctx.db.run('UPDATE events SET announce_pending = 0 WHERE id = ? AND announce_pending = 1', e.id);
      if (changes) await announceEvent(ctx, e, { username: e.username }).catch((err) => console.warn('[avant-première] annonce :', err.message));
    }
  }
}

module.exports = { EARLY_HOURS, HOUR, seesEarly, earlyHours, notifyFounders, releaseDue };
