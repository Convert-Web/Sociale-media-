'use strict';
// Courriels : désinscription de la Lettre, tâche planifiée du dimanche, réglages et outils de la Direction.
const express = require('express');
const { requireAuth, requireMember } = require('../auth');
const { fail, intParam } = require('../http');
const { selfUser } = require('../social');
const { testEmail, layout, esc } = require('../emails');
const { buildLettre, sendLettre, checkUnsubscribeToken, parisParts, setting } = require('../lettre');
const { lettreEmail } = require('../emails');

module.exports = function emailRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  const page = (title, text) =>
    layout({ baseUrl: config.baseUrl, body: `<h1 style="margin:0 0 14px;font:700 24px -apple-system,Helvetica,Arial,sans-serif">${esc(title)}</h1><p style="margin:0 0 18px">${text}</p><a href="${esc(config.baseUrl)}/reglages" style="color:#8a6d43;font-weight:600">Ouvrir les réglages</a>` });

  // Lien « Ne plus recevoir la Lettre » (sans connexion)
  r.get('/lettre/desabonner', async (req, res) => {
    const id = intParam(req.query.u);
    const ok = id && (await checkUnsubscribeToken(db, id, req.query.t));
    res.type('html');
    if (!ok) return res.status(400).send(page('Lien invalide', 'Ce lien de désinscription n’est pas valable. Vous pouvez gérer la Lettre depuis vos réglages.'));
    await db.run('UPDATE users SET email_digest = 0 WHERE id = ?', id);
    res.send(page('C’est noté.', 'Vous ne recevrez plus la Lettre du cercle. Vous pouvez la réactiver à tout moment dans vos réglages.'));
  });

  // Tâche planifiée de Vercel : chaque dimanche matin
  r.get('/cron/lettre', async (req, res) => {
    if (config.mail.cronSecret && req.get('authorization') !== `Bearer ${config.mail.cronSecret}`) fail(401, 'Accès refusé.');
    const { weekday, hour } = parisParts(Date.now());
    if (weekday !== 'dimanche' || hour < 7) return res.json({ sent: 0, skipped: 'La Lettre part le dimanche matin.' });
    res.json(await sendLettre(ctx));
  });

  // Réglage du membre : recevoir la Lettre ou non
  r.post('/me/emails', requireAuth, async (req, res) => {
    if (typeof req.body?.digest !== 'boolean') fail(400, 'Réglage invalide.');
    await db.run('UPDATE users SET email_digest = ? WHERE id = ?', req.body.digest ? 1 : 0, req.user.id);
    res.json({ user: selfUser(ctx, await db.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
  });

  // --- Direction -----------------------------------------------------------
  const admin = (req) => {
    if (!req.user?.is_admin) fail(403, 'Réservé à la Direction.');
  };
  r.get('/admin/emails', requireMember, async (req, res) => {
    admin(req);
    const { n } = await db.get('SELECT COUNT(*) AS n FROM users WHERE paid_at IS NOT NULL AND is_bot = 0 AND email_digest = 1');
    res.json({
      enabled: ctx.mailer.enabled,
      provider: ctx.mailer.provider,
      from: ctx.mailer.from,
      subscribers: n,
      lastSentAt: Number(await setting(db, 'lettre_sent_at')) || null,
      lastCount: Number(await setting(db, 'lettre_count')) || 0,
    });
  });

  r.post('/admin/emails/test', requireMember, async (req, res) => {
    admin(req);
    if (!ctx.mailer.enabled) fail(400, 'Les courriels ne sont pas encore configurés (clé Brevo manquante).');
    try {
      await ctx.mailer.send({ to: req.user.email, name: req.user.display_name, ...testEmail(config, req.user) });
    } catch (err) {
      fail(502, err.message);
    }
    res.json({ ok: true, to: req.user.email });
  });

  // Aperçu de la Lettre telle que vous la recevriez
  r.get('/admin/lettre/apercu', requireMember, async (req, res) => {
    admin(req);
    const data = await buildLettre(ctx);
    const { html } = lettreEmail(config, data, req.user, `${config.baseUrl}/reglages`);
    res.type('html').send(html);
  });

  // Envoi de la Lettre : à soi-même (essai) ou à tous (une fois par semaine)
  r.post('/admin/lettre/send', requireMember, async (req, res) => {
    admin(req);
    try {
      res.json(await sendLettre(ctx, { onlyTo: req.body?.test ? req.user : null }));
    } catch (err) {
      fail(502, err.message);
    }
  });

  return r;
};
