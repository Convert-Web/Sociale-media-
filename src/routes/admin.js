'use strict';
const express = require('express');
const { requireAdmin } = require('../auth');
const { fail, intParam } = require('../http');
const { deleteUpload } = require('../uploads');
const { authorOf } = require('../social');
const { deleteUser, admitMember } = require('../membership');
const { admissionMode, setAdmissionMode, MODES } = require('../admission');

module.exports = function adminRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;
  r.use('/admin', requireAdmin);

  r.get('/admin/overview', async (_req, res) => {
    const totals = await db.get(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE paid_at IS NOT NULL) AS members,
         (SELECT COUNT(*) FROM users WHERE paid_at IS NULL) AS pending,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE status = 'paid' AND provider != 'demo') AS revenue,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE status = 'paid' AND provider = 'demo') AS demoRevenue,
         (SELECT COUNT(*) FROM posts) AS posts,
         (SELECT COUNT(*) FROM comments) AS comments,
         (SELECT COUNT(*) FROM messages) AS messages,
         (SELECT COUNT(*) FROM likes) AS likes,
         (SELECT COUNT(DISTINCT target_type || ':' || target_id) FROM reports WHERE resolved_at IS NULL) AS openReports,
         (SELECT COUNT(*) FROM users WHERE paid_at IS NULL AND admission_declined_at IS NULL) AS admissions`,
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
        `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at, u.email, u.paid_at, u.created_at
         FROM users u ORDER BY u.created_at DESC LIMIT 25`,
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
      config: { stripeEnabled: Boolean(ctx.stripe), demoPayments: config.demoPayments, priceCents: config.priceCents, paidEntry: config.paidEntry, admission: await admissionMode(ctx) },
    });
  });

  // Demandes d'admission (comptes non admis)
  r.get('/admin/admissions', async (_req, res) => {
    const rows = await db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at, u.email, u.created_at,
              u.admission_note, u.admission_requested_at, u.admission_declined_at
       FROM users u WHERE u.paid_at IS NULL ORDER BY (u.admission_declined_at IS NOT NULL), u.created_at DESC LIMIT 200`,
    );
    res.json({
      admissions: rows.map((x) => ({
        ...authorOf(ctx, x),
        email: x.email,
        note: x.admission_note || '',
        createdAt: x.created_at,
        declined: Boolean(x.admission_declined_at),
      })),
    });
  });

  r.post('/admin/admissions/:id/:action', async (req, res) => {
    const id = intParam(req.params.id);
    const user = id && (await db.get('SELECT * FROM users WHERE id = ? AND paid_at IS NULL', id));
    if (!user) fail(404, 'Demande introuvable.');
    if (req.params.action === 'approve') {
      await db.run('UPDATE users SET admission_declined_at = NULL WHERE id = ?', id);
      const admitted = await admitMember(ctx, id);
      ctx.mailer
        .send({
          to: admitted.email,
          subject: `${config.appName} — Bienvenue dans le cercle`,
          text: `Bonjour ${admitted.display_name},\n\nVotre demande d'admission a été acceptée. Votre carte de membre N° ${String(admitted.member_number).padStart(4, '0')} vous attend :\n${config.baseUrl}/connexion\n\n— ${config.appName}`,
        })
        .catch(() => {});
      return res.json({ ok: true });
    }
    if (req.params.action === 'decline') {
      await db.run('UPDATE users SET admission_declined_at = ? WHERE id = ?', Date.now(), id);
      return res.json({ ok: true });
    }
    fail(404, 'Action inconnue.');
  });

  // Mode d'entrée : libre ou sur invitation
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
