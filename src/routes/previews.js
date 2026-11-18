'use strict';
// Avant-premières de la Direction, réservées aux Fondateurs avant d'être publiées pour tous.
const express = require('express');
const { requireMember } = require('../auth');
const { fail, text, intParam } = require('../http');
const { photos, saveImage, deleteUpload } = require('../uploads');
const { authorOf } = require('../social');
const { seesEarly, earlyHours, notifyFounders, releaseDue, HOUR } = require('../founders');

module.exports = function previewRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/previews', requireMember);

  const serialize = (p, viewer) => ({
    id: p.id,
    body: p.body,
    images: JSON.parse(p.images || '[]'),
    createdAt: p.created_at,
    releaseAt: p.release_at,
    author: authorOf(ctx, p),
    canDelete: Boolean(viewer.is_admin),
  });

  // Avant-premières en cours (vide pour les membres qui ne sont pas Fondateurs)
  r.get('/previews', async (req, res) => {
    await releaseDue(ctx);
    const founder = seesEarly(ctx, req.user);
    const rows = founder
      ? await db.all(
          `SELECT p.*, u.username, u.display_name, u.avatar, u.member_number, u.verified_at, u.is_bot
           FROM previews p JOIN users u ON u.id = p.author_id
           WHERE p.post_id IS NULL AND p.release_at > ? ORDER BY p.id DESC LIMIT 10`,
          Date.now(),
        )
      : [];
    res.json({ founder, previews: rows.map((p) => serialize(p, req.user)) });
  });

  // Nouvelle avant-première (Direction) : 24 h, 48 h ou 7 jours avant tout le monde
  r.post('/previews', photos(), async (req, res) => {
    if (!req.user.is_admin) fail(403, 'Les avant-premières sont réservées à la Direction.');
    const body = text(req.body?.body, { field: 'Annonce', max: 2000 });
    const files = [...(req.files?.image || []), ...(req.files?.images || [])].slice(0, 6);
    if (!body && !files.length) fail(400, 'Votre annonce est vide.');
    const hours = earlyHours(req.body?.hours);
    const images = [];
    for (const f of files) images.push(await saveImage(ctx, f));
    const now = Date.now();
    const { lastInsertRowid } = await db.run(
      'INSERT INTO previews (author_id, body, images, created_at, release_at) VALUES (?, ?, ?, ?, ?)',
      req.user.id, body, JSON.stringify(images), now, now + hours * HOUR,
    );
    await notifyFounders(ctx, {
      title: 'Avant-première Fondateurs',
      body: body ? (body.length > 120 ? `${body.slice(0, 117)}…` : body) : 'Une nouvelle annonce vous attend, avant tout le monde.',
      url: '/salon',
      tag: `preview-${lastInsertRowid}`,
    }, req.user.id);
    const row = await db.get(
      `SELECT p.*, u.username, u.display_name, u.avatar, u.member_number, u.verified_at, u.is_bot
       FROM previews p JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
      lastInsertRowid,
    );
    res.status(201).json({ preview: serialize(row, req.user), hours });
  });

  // Retirer une avant-première avant sa publication (Direction)
  r.delete('/previews/:id', async (req, res) => {
    if (!req.user.is_admin) fail(403, 'Réservé à la Direction.');
    const id = intParam(req.params.id);
    const row = id && (await db.get('SELECT * FROM previews WHERE id = ? AND post_id IS NULL', id));
    if (!row) fail(404, 'Avant-première introuvable ou déjà publiée.');
    await db.run('DELETE FROM previews WHERE id = ?', id);
    for (const url of JSON.parse(row.images || '[]')) deleteUpload(ctx, url);
    res.json({ ok: true });
  });

  return r;
};
