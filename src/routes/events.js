'use strict';
// L'Agenda du cercle : événements privés entre membres (dîners, vernissages, voyages…)
const express = require('express');
const { requireMember } = require('../auth');
const { fail, text, intParam } = require('../http');
const { single, saveImage, deleteUpload } = require('../uploads');
const { authorOf, notify, retractNotification } = require('../social');
const { sendPush } = require('../push');

const SIX_HOURS = 6 * 3600 * 1000;

const EVENT_SELECT = `
  SELECT e.*, u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at,
         (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id = e.id) AS going_count,
         EXISTS(SELECT 1 FROM event_attendees a WHERE a.event_id = e.id AND a.user_id = v.id) AS me_going
  FROM (SELECT ? AS id) v
  CROSS JOIN events e
  JOIN users u ON u.id = e.owner_id`;

module.exports = function eventRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/events', requireMember);

  const attendeesPreview = (eventId, limit = 5) =>
    db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at
       FROM event_attendees a JOIN users u ON u.id = a.user_id
       WHERE a.event_id = ? ORDER BY a.created_at ASC LIMIT ?`,
      eventId, limit,
    );

  const serialize = async (row, viewer, { preview = true } = {}) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    cover: row.cover || null,
    startsAt: row.starts_at,
    endsAt: row.ends_at || null,
    capacity: row.capacity || null,
    goingCount: row.going_count,
    going: Boolean(row.me_going),
    full: Boolean(row.capacity && row.going_count >= row.capacity),
    past: row.starts_at < Date.now() - SIX_HOURS,
    host: authorOf(ctx, row),
    canEdit: row.owner_id === viewer.id || Boolean(viewer.is_admin),
    attendees: preview ? (await attendeesPreview(row.id)).map((x) => authorOf(ctx, x)) : undefined,
  });

  const load = async (id, viewer) => {
    const eid = intParam(id);
    const row = eid && (await db.get(`${EVENT_SELECT} WHERE e.id = ?`, viewer.id, eid));
    if (!row) fail(404, 'Cet événement est introuvable.');
    return row;
  };

  const readFields = (body, current = {}) => {
    const title = text(body.title ?? current.title, { field: 'Titre', min: 3, max: 80, required: true });
    const description = text(body.description ?? current.description, { field: 'Description', max: 2000 });
    const location = text(body.location ?? current.location, { field: 'Lieu', max: 140 });
    const startsAt = Number(body.startsAt ?? current.starts_at);
    if (!Number.isFinite(startsAt) || startsAt < Date.UTC(2020, 0, 1)) fail(400, 'Date de début invalide.');
    let endsAt = body.endsAt === undefined ? current.ends_at ?? null : body.endsAt === '' || body.endsAt === null ? null : Number(body.endsAt);
    if (endsAt !== null && (!Number.isFinite(endsAt) || endsAt <= startsAt)) fail(400, 'La fin doit être après le début.');
    let capacity = body.capacity === undefined ? current.capacity ?? null : body.capacity === '' || body.capacity === null ? null : Number(body.capacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000)) fail(400, 'Nombre de places invalide.');
    return { title, description, location, startsAt, endsAt, capacity };
  };

  // Liste : à venir, mes événements (j'organise ou je participe), passés
  r.get('/events', async (req, res) => {
    const scope = ['upcoming', 'mine', 'past'].includes(req.query.scope) ? req.query.scope : 'upcoming';
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const since = Date.now() - SIX_HOURS;
    let rows;
    if (scope === 'past') {
      rows = await db.all(`${EVENT_SELECT} WHERE e.starts_at < ? ORDER BY e.starts_at DESC LIMIT ?`, req.user.id, since, limit);
    } else if (scope === 'mine') {
      rows = await db.all(
        `${EVENT_SELECT} WHERE e.starts_at >= ? AND (e.owner_id = v.id OR EXISTS(SELECT 1 FROM event_attendees a WHERE a.event_id = e.id AND a.user_id = v.id))
         ORDER BY e.starts_at ASC LIMIT ?`,
        req.user.id, since, limit,
      );
    } else {
      rows = await db.all(`${EVENT_SELECT} WHERE e.starts_at >= ? ORDER BY e.starts_at ASC LIMIT ?`, req.user.id, since, limit);
    }
    res.json({ events: await Promise.all(rows.map((x) => serialize(x, req.user))) });
  });

  r.post('/events', single('cover'), async (req, res) => {
    const f = readFields(req.body || {});
    if (f.startsAt < Date.now() - 3600 * 1000) fail(400, 'La date choisie est déjà passée.');
    const cover = await saveImage(ctx, req.file);
    const now = Date.now();
    const { lastInsertRowid: id } = await db.run(
      `INSERT INTO events (title, description, location, cover, starts_at, ends_at, capacity, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      f.title, f.description, f.location, cover, f.startsAt, f.endsAt, f.capacity, req.user.id, now,
    );
    // L'organisateur participe d'office
    await db.run('INSERT INTO event_attendees (event_id, user_id, created_at) VALUES (?, ?, ?)', id, req.user.id, now);
    res.status(201).json({ event: await serialize(await load(id, req.user), req.user) });
  });

  r.get('/events/:id', async (req, res) => {
    const row = await load(req.params.id, req.user);
    const event = await serialize(row, req.user, { preview: false });
    event.attendees = (await attendeesPreview(row.id, 500)).map((x) => authorOf(ctx, x));
    res.json({ event });
  });

  r.patch('/events/:id', async (req, res) => {
    const row = await load(req.params.id, req.user);
    if (row.owner_id !== req.user.id && !req.user.is_admin) fail(403, 'Seul l’organisateur peut modifier cet événement.');
    const f = readFields(req.body || {}, row);
    await db.run(
      'UPDATE events SET title = ?, description = ?, location = ?, starts_at = ?, ends_at = ?, capacity = ? WHERE id = ?',
      f.title, f.description, f.location, f.startsAt, f.endsAt, f.capacity, row.id,
    );
    res.json({ event: await serialize(await load(row.id, req.user), req.user) });
  });

  r.post('/events/:id/cover', single('cover'), async (req, res) => {
    const row = await load(req.params.id, req.user);
    if (row.owner_id !== req.user.id && !req.user.is_admin) fail(403, 'Seul l’organisateur peut modifier cet événement.');
    if (!req.file) fail(400, 'Aucune image reçue.');
    const cover = await saveImage(ctx, req.file);
    await db.run('UPDATE events SET cover = ? WHERE id = ?', cover, row.id);
    if (row.cover) deleteUpload(ctx, row.cover);
    res.json({ cover });
  });

  r.delete('/events/:id', async (req, res) => {
    const row = await load(req.params.id, req.user);
    if (row.owner_id !== req.user.id && !req.user.is_admin) fail(403, 'Seul l’organisateur peut annuler cet événement.');
    await db.run('DELETE FROM event_attendees WHERE event_id = ?', row.id);
    await db.run('DELETE FROM notifications WHERE event_id = ?', row.id);
    await db.run('DELETE FROM events WHERE id = ?', row.id);
    if (row.cover) deleteUpload(ctx, row.cover);
    res.json({ ok: true });
  });

  // « Je viens » / « Je ne viens plus »
  r.post('/events/:id/attend', async (req, res) => {
    const row = await load(req.params.id, req.user);
    if (row.starts_at < Date.now() - SIX_HOURS) fail(400, 'Cet événement est terminé.');
    if (!row.me_going) {
      if (row.capacity && row.going_count >= row.capacity) fail(409, 'Cet événement est complet.');
      await db.run('INSERT OR IGNORE INTO event_attendees (event_id, user_id, created_at) VALUES (?, ?, ?)', row.id, req.user.id, Date.now());
      await notify(ctx, { userId: row.owner_id, actorId: req.user.id, type: 'event_join', eventId: row.id });
      if (row.owner_id !== req.user.id) {
        sendPush(ctx, row.owner_id, {
          title: row.title,
          body: `${req.user.display_name} participera à votre événement.`,
          url: `/agenda/${row.id}`,
          tag: `event-${row.id}`,
        }).catch(() => {});
      }
    }
    res.json({ event: await serialize(await load(row.id, req.user), req.user) });
  });

  r.delete('/events/:id/attend', async (req, res) => {
    const row = await load(req.params.id, req.user);
    if (row.owner_id === req.user.id) fail(400, 'L’organisateur ne peut pas se désinscrire : annulez l’événement si besoin.');
    await db.run('DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?', row.id, req.user.id);
    await retractNotification(ctx, { userId: row.owner_id, actorId: req.user.id, type: 'event_join', eventId: row.id });
    res.json({ event: await serialize(await load(row.id, req.user), req.user) });
  });

  return r;
};
