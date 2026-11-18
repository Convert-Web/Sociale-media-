'use strict';
const express = require('express');

module.exports = function publicRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  // Version de l'application (jamais mise en cache)
  r.get('/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ version: config.version });
  });

  r.get('/public/stats', async (_req, res) => {
    const { members, lastNumber, cities } = await db.get(
      `SELECT (SELECT COUNT(*) FROM users WHERE paid_at IS NOT NULL AND is_bot = 0) AS members,
              (SELECT COALESCE(MAX(number), 0) FROM member_numbers) AS lastNumber,
              (SELECT COUNT(DISTINCT LOWER(city)) FROM users WHERE paid_at IS NOT NULL AND is_bot = 0 AND city != '') AS cities`,
    );
    res.json({
      members,
      cities,
      founderSpotsLeft: config.paidEntry ? 0 : Math.max(0, config.founderLimit - lastNumber),
      founderLimit: config.founderLimit,
      // Gratuit pour les Fondateurs, payant ensuite
      paidEntry: config.paidEntry || lastNumber >= config.founderLimit,
      priceCents: config.priceCents,
      currency: config.currency,
    });
  });

  return r;
};
