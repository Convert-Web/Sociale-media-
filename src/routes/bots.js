'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { fail } = require('../http');
const { tick, botsEnabled } = require('../bots');

module.exports = function botRoutes(ctx) {
  const r = express.Router();

  // Déclenché par l'application à l'ouverture du Salon : publie ce qui est dû
  r.post('/bots/tick', requireMember, async (req, res) => {
    const force = Boolean(req.body?.force) && Boolean(req.user.is_admin);
    res.json(await tick(ctx, { force }));
  });

  // Interrupteur de la Direction
  r.post('/admin/bots', requireMember, async (req, res) => {
    if (!req.user.is_admin) fail(403, 'Réservé à la Direction.');
    if (typeof req.body?.enabled !== 'boolean') fail(400, 'Réglage invalide.');
    await ctx.db.run(
      "INSERT INTO settings (key, value) VALUES ('bots', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      req.body.enabled ? 'on' : 'off',
    );
    res.json({ enabled: await botsEnabled(ctx) });
  });

  return r;
};
