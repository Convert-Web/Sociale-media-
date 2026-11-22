'use strict';
const express = require('express');
const { requireAdmin } = require('../auth');
const { fail, intParam } = require('../http');
const { deleteUploads } = require('../uploads');
const { USER_SELECT, serializeUser, POST_SELECT, serializePost } = require('../social');
const { deleteUser } = require('../accounts');
const { FIELDS, getLegal, saveLegal, missing } = require('../legal');
const analytics = require('../analytics');
const V = require('../videos');

module.exports = function adminRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;
  r.use('/admin', requireAdmin);

  r.get('/admin/overview', async (_req, res) => {
    const now = Date.now();
    const totals = await db.get(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE is_bot = 0) AS users,
         (SELECT COUNT(*) FROM users WHERE is_bot = 0 AND created_at > ?) AS usersToday,
         (SELECT COUNT(*) FROM users WHERE banned_at IS NOT NULL) AS banned,
         (SELECT COUNT(*) FROM posts) AS posts,
         (SELECT COUNT(*) FROM posts WHERE video_id IS NOT NULL) AS videos,
         (SELECT COALESCE(SUM(plays), 0) FROM video_views) + (SELECT COALESCE(SUM(guest_views), 0) FROM posts) AS views,
         (SELECT COUNT(*) FROM comments) AS comments,
         (SELECT COUNT(*) FROM likes) AS likes,
         (SELECT COUNT(*) FROM messages) AS messages,
         (SELECT COUNT(*) FROM lives WHERE ended_at IS NULL AND last_beat > ?) AS livesNow,
         (SELECT COUNT(*) FROM lives) AS lives,
         (SELECT COUNT(DISTINCT target_type || ':' || target_id) FROM reports WHERE resolved_at IS NULL) AS openReports,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM payments WHERE status = 'paid' AND provider = 'stripe') AS revenue,
         (SELECT COALESCE(SUM(coins), 0) FROM payments WHERE status = 'paid') AS coinsSold,
         (SELECT COALESCE(SUM(-coins), 0) FROM wallet_tx WHERE kind = 'gift_sent') AS coinsSpent,
         (SELECT COUNT(*) FROM users WHERE is_demo = 1) AS demoUsers`,
      now - 86400e3, now - 45e3,
    );
    const signups = [];
    const rows = await db.all('SELECT created_at FROM users WHERE created_at > ? AND is_bot = 0', now - 14 * 86400e3);
    for (let i = 13; i >= 0; i--) {
      const d = analytics.dayOf(now - i * 86400e3);
      signups.push({ day: d, count: rows.filter((x) => analytics.dayOf(x.created_at) === d).length });
    }
    res.json({
      totals,
      signups,
      storage: { usedBytes: await V.storageUsed(ctx), maxBytes: config.videoStorageBytes },
      payments: { stripe: Boolean(ctx.stripe), demo: config.demoPayments, webhook: Boolean(config.stripe.webhookSecret) },
      mail: { provider: ctx.mailer.provider || null },
      legalMissing: missing(await getLegal(ctx)),
    });
  });

  // Comptes : recherche, badge vérifié, suspension, administration
  r.get('/admin/users', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const before = intParam(req.query.cursor);
    const limit = 40;
    const rows = await db.all(
      `${USER_SELECT} WHERE u.is_bot = 0 AND (? = '' OR u.username LIKE ? OR u.display_name LIKE ? OR u.email LIKE ?) AND (? IS NULL OR u.id < ?)
       ORDER BY u.id DESC LIMIT ?`,
      req.user.id, q, `%${q}%`, `%${q}%`, `%${q}%`, before, before, limit,
    );
    res.json({
      users: rows.map((row) => ({ ...serializeUser(ctx, row, req.user), email: row.email, isAdmin: Boolean(row.is_admin), banned: Boolean(row.banned_at), createdAt: row.created_at })),
      cursor: rows.length === limit ? rows[rows.length - 1].id : null,
    });
  });

  r.post('/admin/users/:id/:action', async (req, res) => {
    const id = intParam(req.params.id);
    const u = id && (await db.get('SELECT * FROM users WHERE id = ?', id));
    if (!u) fail(404, 'Compte introuvable.');
    const now = Date.now();
    const actions = {
      verify: ['UPDATE users SET verified_at = ? WHERE id = ?', now],
      unverify: ['UPDATE users SET verified_at = NULL WHERE id = ?'],
      ban: ['UPDATE users SET banned_at = ? WHERE id = ?', now],
      unban: ['UPDATE users SET banned_at = NULL WHERE id = ?'],
      promote: ['UPDATE users SET is_admin = 1 WHERE id = ?'],
      demote: ['UPDATE users SET is_admin = 0 WHERE id = ?'],
    };
    const a = actions[req.params.action];
    if (!a) fail(400, 'Action inconnue.');
    if (u.id === req.user.id && ['ban', 'demote'].includes(req.params.action)) fail(400, 'Tu ne peux pas faire cela sur ton propre compte.');
    await db.run(a[0], ...a.slice(1), u.id);
    if (req.params.action === 'ban') {
      await db.run('DELETE FROM sessions WHERE user_id = ?', u.id);
      await db.run('UPDATE lives SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL', now, u.id);
    }
    res.json({ ok: true });
  });

  r.delete('/admin/users/:id', async (req, res) => {
    const id = intParam(req.params.id);
    if (id === req.user.id) fail(400, 'Supprime ton propre compte depuis les Réglages.');
    if (!(await db.get('SELECT 1 FROM users WHERE id = ?', id))) fail(404, 'Compte introuvable.');
    await deleteUploads(ctx, await deleteUser(ctx, id));
    res.json({ ok: true });
  });

  // Dernières publications (toutes, même privées : modération)
  r.get('/admin/posts', async (req, res) => {
    const before = intParam(req.query.cursor);
    const limit = 30;
    const rows = await db.all(`${POST_SELECT} WHERE (? IS NULL OR p.id < ?) ORDER BY p.id DESC LIMIT ?`, req.user.id, before, before, limit);
    res.json({ posts: rows.map((row) => serializePost(ctx, row, req.user)), cursor: rows.length === limit ? rows[rows.length - 1].id : null });
  });

  r.get('/admin/errors', async (_req, res) => {
    const rows = await db.all('SELECT * FROM client_errors ORDER BY id DESC LIMIT 100');
    res.json({ errors: rows });
  });

  r.get('/admin/analytics', async (_req, res) => {
    await analytics.purgeOld(ctx);
    res.json(await analytics.summary(ctx, 30));
  });

  r.get('/admin/legal', async (_req, res) => {
    res.json({ legal: await getLegal(ctx), fields: FIELDS });
  });

  r.put('/admin/legal', async (req, res) => {
    res.json({ legal: await saveLegal(ctx, req.body) });
  });

  // Contenu de démonstration : comptes « Démo » clairement signalés, ajoutés ou retirés d'un geste
  r.post('/admin/demo', async (req, res) => {
    const demo = require('../demo');
    if (req.body?.action === 'remove') return res.json(await demo.removeDemo(ctx));
    res.json(await demo.addDemo(ctx, { origin: config.baseUrl }));
  });

  r.post('/admin/email-test', async (req, res) => {
    const { testEmail } = require('../emails');
    await ctx.mailer.send({ to: req.user.email, name: req.user.display_name, ...testEmail(config, req.user) });
    res.json({ ok: true, provider: ctx.mailer.provider || 'console' });
  });

  return r;
};
