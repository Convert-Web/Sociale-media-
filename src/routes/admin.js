'use strict';
const express = require('express');
const { requireAdmin } = require('../auth');
const { fail, intParam } = require('../http');
const { deleteUpload } = require('../uploads');
const { authorOf } = require('../social');
const { deleteUser, admitMember } = require('../membership');
const { admissionMode, setAdmissionMode, MODES, entryIsPaid, foundersLeft } = require('../admission');
const { botsEnabled } = require('../bots');
const { FIELDS, getLegal, saveLegal, missing } = require('../legal');
const analytics = require('../analytics');

module.exports = function adminRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;
  r.use('/admin', requireAdmin);

  r.get('/admin/overview', async (_req, res) => {
    const totals = await db.get(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE paid_at IS NOT NULL AND is_bot = 0) AS members,
         (SELECT COUNT(*) FROM users WHERE paid_at IS NULL) AS pending,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE status = 'paid' AND provider != 'demo') AS revenue,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE status = 'paid' AND provider = 'demo') AS demoRevenue,
         (SELECT COUNT(*) FROM posts) AS posts,
         (SELECT COUNT(*) FROM comments) AS comments,
         (SELECT COUNT(*) FROM messages) AS messages,
         (SELECT COUNT(*) FROM likes) AS likes,
         (SELECT COUNT(DISTINCT target_type || ':' || target_id) FROM reports WHERE resolved_at IS NULL) AS openReports,
         (SELECT COUNT(*) FROM users WHERE paid_at IS NULL AND admission_declined_at IS NULL AND admission_approved_at IS NULL) AS admissions,
         (SELECT COUNT(*) FROM users WHERE paid_at IS NULL AND admission_approved_at IS NOT NULL) AS awaitingPayment,
         (SELECT COUNT(*) FROM reports WHERE resolved_at IS NULL AND reporter_id = 0) AS autoReports,
         (SELECT COUNT(*) FROM videos WHERE complete = 1) AS videos,
         (SELECT COALESCE(SUM(size), 0) FROM videos) AS videoBytes`,
    );
    const dayMs = 24 * 3600 * 1000;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = start.getTime() - 13 * dayMs;
    const paidRows = await db.all('SELECT paid_at FROM users WHERE paid_at >= ?', from);
    const days = Array.from({ length: 14 }, (_, i) => ({ date: from + i * dayMs, count: 0 }));
    for (const { paid_at } of paidRows) {
      const idx = Math.floor((paid_at - from) / dayMs);
      if (days[idx]) days[idx].count++;
    }
    const recentMembers = (
      await db.all(
        `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at, u.is_bot, u.email, u.paid_at, u.created_at
         FROM users u WHERE u.is_bot = 0 ORDER BY u.created_at DESC LIMIT 25`,
      )
    ).map((row) => ({ ...authorOf(ctx, row), email: row.email, paidAt: row.paid_at, createdAt: row.created_at }));
    const recentPayments = await db.all(
      `SELECT p.provider, p.amount_cents, p.currency, p.status, p.created_at, u.username
       FROM payments p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 15`,
    );
    res.json({
      totals,
      signups: days,
      recentMembers,
      recentPayments,
      config: {
        stripeEnabled: Boolean(ctx.stripe),
        demoPayments: config.demoPayments,
        priceCents: config.priceCents,
        currency: config.currency,
        paidEntry: await entryIsPaid(ctx),
        founderLimit: config.founderLimit,
        foundersLeft: config.paidEntry ? 0 : await foundersLeft(ctx),
        admission: await admissionMode(ctx),
        bots: await botsEnabled(ctx),
        botsAvailable: Boolean(config.bots),
        videoStorageBytes: config.videoStorageBytes,
      },
    });
  });

  // Demandes d'admission (comptes non admis)
  r.get('/admin/admissions', async (_req, res) => {
    const rows = await db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at, u.is_bot, u.email, u.created_at,
              u.admission_note, u.admission_requested_at, u.admission_declined_at, u.admission_approved_at
       FROM users u WHERE u.paid_at IS NULL
       ORDER BY (u.admission_declined_at IS NOT NULL), (u.admission_approved_at IS NOT NULL), u.created_at DESC LIMIT 200`,
    );
    res.json({
      admissions: rows.map((x) => ({
        ...authorOf(ctx, x),
        email: x.email,
        note: x.admission_note || '',
        createdAt: x.created_at,
        declined: Boolean(x.admission_declined_at),
        // Admission acceptée, droit d'entrée pas encore réglé
        approved: Boolean(x.admission_approved_at),
      })),
    });
  });

  r.post('/admin/admissions/:id/:action', async (req, res) => {
    const id = intParam(req.params.id);
    const user = id && (await db.get('SELECT * FROM users WHERE id = ? AND paid_at IS NULL', id));
    if (!user) fail(404, 'Demande introuvable.');
    if (req.params.action === 'approve') {
      await db.run('UPDATE users SET admission_declined_at = NULL WHERE id = ?', id);
      // Courriel de bienvenue envoyé à l'admission ; phase payante : ticket et invitation à régler
      const admitted = await admitMember(ctx, id);
      if (admitted && !admitted.paid_at) {
        const { admissionApprovedEmail } = require('../emails');
        await ctx.mailer.send({ to: admitted.email, name: admitted.display_name, ...admissionApprovedEmail(config, admitted) }).catch((err) => console.warn('[courriel] admission :', err.message));
      }
      return res.json({ ok: true, member: Boolean(admitted?.paid_at) });
    }
    if (req.params.action === 'decline') {
      await db.run('UPDATE users SET admission_declined_at = ? WHERE id = ?', Date.now(), id);
      return res.json({ ok: true });
    }
    fail(404, 'Action inconnue.');
  });

  // Mode d'entrée : libre ou sur invitation
  // Erreurs survenues chez les visiteurs (24 dernières heures)
  r.get('/admin/errors', async (_req, res) => {
    const since = Date.now() - 86400e3;
    const { n } = await db.get('SELECT COUNT(*) AS n FROM client_errors WHERE at > ?', since);
    const top = await db.all(
      'SELECT message, path, device, COUNT(*) AS n, MAX(at) AS last FROM client_errors WHERE at > ? GROUP BY message, path ORDER BY n DESC, last DESC LIMIT 12',
      since,
    );
    res.json({ count: n, top });
  });

  // Dernières vidéos envoyées, avec leur fiche technique (diagnostic d'une vidéo qui lit mal)
  r.get('/admin/videos', async (_req, res) => {
    const rows = await db.all(
      `SELECT v.id, v.mime, v.size, v.duration, v.width, v.height, v.chunks, v.complete, v.created_at, v.meta,
              u.username, p.id AS post_id, s.id AS story_id
       FROM videos v JOIN users u ON u.id = v.owner_id
       LEFT JOIN posts p ON p.video_id = v.id LEFT JOIN stories s ON s.video_id = v.id
       ORDER BY v.created_at DESC LIMIT 12`,
    );
    const V = require('../videos');
    res.json({
      videos: rows.map((r) => ({
        id: r.id,
        url: V.videoUrl(r.id, V.TYPES[r.mime]),
        mime: r.mime,
        size: r.size,
        duration: r.duration,
        width: r.width,
        height: r.height,
        chunks: r.chunks,
        complete: Boolean(r.complete),
        createdAt: r.created_at,
        author: r.username,
        postId: r.post_id,
        storyId: r.story_id,
        meta: (() => {
          try {
            return r.meta ? JSON.parse(r.meta) : null;
          } catch {
            return null;
          }
        })(),
      })),
    });
  });

  // Mesure d'audience (30 derniers jours)
  r.get('/admin/analytics', async (_req, res) => {
    res.json(await analytics.summary(ctx, 30));
  });

  // Informations légales de l'éditeur (affichées dans les mentions légales, CGU, CGV et RGPD)
  r.get('/admin/legal', async (_req, res) => {
    const legal = await getLegal(ctx);
    const fields = Object.entries(FIELDS).map(([key, f]) => ({ key, label: f.label, required: Boolean(f.required), max: f.max }));
    res.json({ legal, fields, missing: missing(legal) });
  });
  r.put('/admin/legal', async (req, res) => {
    const legal = await saveLegal(ctx, req.body);
    res.json({ legal, missing: missing(legal) });
  });

  r.post('/admin/settings', async (req, res) => {
    if (req.body?.admission !== undefined) {
      if (!MODES.includes(req.body.admission)) fail(400, 'Mode d’entrée inconnu.');
      await setAdmissionMode(ctx, req.body.admission);
    }
    res.json({ admission: await admissionMode(ctx) });
  });

  // Badge « Membre vérifié »
  r.post('/admin/users/:id/verify', async (req, res) => {
    const id = intParam(req.params.id);
    const user = id && (await db.get('SELECT id FROM users WHERE id = ? AND paid_at IS NOT NULL', id));
    if (!user) fail(404, 'Membre introuvable.');
    const verified = req.body?.verified !== false;
    await db.run('UPDATE users SET verified_at = ? WHERE id = ?', verified ? Date.now() : null, id);
    res.json({ verified });
  });

  r.delete('/admin/users/:id', async (req, res) => {
    const id = intParam(req.params.id);
    const user = id && await db.get('SELECT * FROM users WHERE id = ?', id);
    if (!user) fail(404, 'Membre introuvable.');
    if (user.id === req.user.id) fail(400, 'Vous ne pouvez pas supprimer votre propre compte ici.');
    const images = await deleteUser(ctx, user.id);
    for (const img of images) deleteUpload(ctx, img);
    res.json({ ok: true });
  });

  return r;
};
