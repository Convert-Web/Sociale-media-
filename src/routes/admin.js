'use strict';
const express = require('express');
const { requireAdmin } = require('../auth');
const { fail, intParam } = require('../http');
const { deleteUpload } = require('../uploads');
const { authorOf } = require('../social');
const { deleteUser } = require('../membership');

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
         (SELECT COUNT(*) FROM likes) AS likes`,
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
        `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.email, u.paid_at, u.created_at
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
      config: { stripeEnabled: Boolean(ctx.stripe), demoPayments: config.demoPayments, priceCents: config.priceCents },
    });
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
