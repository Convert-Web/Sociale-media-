'use strict';
// Le Carnet d'adresses : les recommandations des membres (restaurants, hôtels, artisans…)
const express = require('express');
const { requireMember } = require('../auth');
const { fail, text, intParam, cleanWebsite } = require('../http');
const { single, saveImage, deleteUpload } = require('../uploads');
const { authorOf, notify, retractNotification } = require('../social');

const CATEGORIES = ['restaurant', 'hotel', 'bar', 'boutique', 'artisan', 'bienetre', 'services', 'voyage'];

const PLACE_SELECT = `
  SELECT pl.*, u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at,
         (SELECT COUNT(*) FROM place_endorsements x WHERE x.place_id = pl.id) AS endorse_count,
         EXISTS(SELECT 1 FROM place_endorsements x WHERE x.place_id = pl.id AND x.user_id = v.id) AS me_endorsed
  FROM (SELECT ? AS id) v
  CROSS JOIN places pl
  JOIN users u ON u.id = pl.author_id`;

// Ville saisie librement : « paris » et « Paris » se regroupent
const cleanCity = (v) =>
  text(v, { field: 'Ville', min: 2, max: 60, required: true })
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s-])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase());

module.exports = function placeRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/places', requireMember);

  const serialize = (row, viewer) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    city: row.city,
    address: row.address,
    website: row.website,
    note: row.note,
    photo: row.photo || null,
    createdAt: row.created_at,
    author: authorOf(ctx, row),
    endorseCount: row.endorse_count,
    endorsed: Boolean(row.me_endorsed),
    mine: row.author_id === viewer.id,
    canDelete: row.author_id === viewer.id || Boolean(viewer.is_admin),
  });

  const load = async (id, viewer) => {
    const pid = intParam(id);
    const row = pid && (await db.get(`${PLACE_SELECT} WHERE pl.id = ?`, viewer.id, pid));
    if (!row) fail(404, 'Cette adresse est introuvable.');
    return row;
  };

  // Liste filtrable : catégorie, ville, recherche
  r.get('/places', async (req, res) => {
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const city = typeof req.query.city === 'string' && req.query.city.trim() ? req.query.city.trim().slice(0, 60) : null;
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    const before = intParam(req.query.before);
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const limit = 30;
    const rows = await db.all(
      `${PLACE_SELECT}
       WHERE (? IS NULL OR pl.category = ?) AND (? IS NULL OR pl.city = ? COLLATE NOCASE)
         AND (? = '' OR pl.name LIKE ? OR pl.note LIKE ? OR pl.address LIKE ?)
         AND (? IS NULL OR pl.id < ?)
       ORDER BY pl.id DESC LIMIT ?`,
      req.user.id, category, category, city, city, q, like, like, like, before, before, limit,
    );
    res.json({ places: rows.map((x) => serialize(x, req.user)), hasMore: rows.length === limit });
  });

  // Villes et catégories présentes (pour les filtres)
  r.get('/places-meta', requireMember, async (_req, res) => {
    const cities = await db.all('SELECT city, COUNT(*) AS n FROM places GROUP BY city COLLATE NOCASE ORDER BY n DESC, city ASC LIMIT 40');
    const categories = await db.all('SELECT category, COUNT(*) AS n FROM places GROUP BY category');
    res.json({ cities, categories, total: categories.reduce((s, c) => s + c.n, 0) });
  });

  r.post('/places', single('photo'), async (req, res) => {
    const b = req.body || {};
    const name = text(b.name, { field: 'Nom', min: 2, max: 80, required: true });
    if (!CATEGORIES.includes(b.category)) fail(400, 'Choisissez une catégorie.');
    const city = cleanCity(b.city);
    const address = text(b.address, { field: 'Adresse', max: 160 });
    const website = b.website ? cleanWebsite(b.website) : '';
    const note = text(b.note, { field: 'Votre recommandation', min: 10, max: 600, required: true });
    const duplicate = await db.get('SELECT id FROM places WHERE name = ? COLLATE NOCASE AND city = ? COLLATE NOCASE', name, city);
    if (duplicate) fail(409, 'Cette adresse figure déjà dans le carnet : ajoutez-y plutôt votre recommandation.');
    const photo = await saveImage(ctx, req.file);
    const { lastInsertRowid: id } = await db.run(
      `INSERT INTO places (name, category, city, address, website, note, photo, author_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      name, b.category, city, address, website, note, photo, req.user.id, Date.now(),
    );
    res.status(201).json({ place: serialize(await load(id, req.user), req.user) });
  });

  r.get('/places/:id', async (req, res) => {
    const row = await load(req.params.id, req.user);
    const endorsers = await db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at
       FROM place_endorsements x JOIN users u ON u.id = x.user_id WHERE x.place_id = ? ORDER BY x.created_at ASC LIMIT 200`,
      row.id,
    );
    res.json({ place: { ...serialize(row, req.user), endorsers: endorsers.map((x) => authorOf(ctx, x)) } });
  });

  r.delete('/places/:id', async (req, res) => {
    const row = await load(req.params.id, req.user);
    if (row.author_id !== req.user.id && !req.user.is_admin) fail(403, 'Seul l’auteur peut retirer cette adresse.');
    await db.run('DELETE FROM place_endorsements WHERE place_id = ?', row.id);
    await db.run('DELETE FROM notifications WHERE place_id = ?', row.id);
    await db.run('DELETE FROM places WHERE id = ?', row.id);
    if (row.photo) deleteUpload(ctx, row.photo);
    res.json({ ok: true });
  });

  // « Je recommande aussi »
  r.post('/places/:id/endorse', async (req, res) => {
    const row = await load(req.params.id, req.user);
    if (row.author_id === req.user.id) fail(400, 'C’est déjà votre recommandation.');
    await db.run('INSERT OR IGNORE INTO place_endorsements (place_id, user_id, created_at) VALUES (?, ?, ?)', row.id, req.user.id, Date.now());
    await notify(ctx, { userId: row.author_id, actorId: req.user.id, type: 'place_endorse', placeId: row.id });
    res.json({ place: serialize(await load(row.id, req.user), req.user) });
  });

  r.delete('/places/:id/endorse', async (req, res) => {
    const row = await load(req.params.id, req.user);
    await db.run('DELETE FROM place_endorsements WHERE place_id = ? AND user_id = ?', row.id, req.user.id);
    await retractNotification(ctx, { userId: row.author_id, actorId: req.user.id, type: 'place_endorse', placeId: row.id });
    res.json({ place: serialize(await load(row.id, req.user), req.user) });
  });

  return r;
};
