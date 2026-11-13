'use strict';
const express = require('express');

module.exports = function publicRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  r.get('/public/stats', async (_req, res) => {
    const { members, lastNumber, cities } = await db.get(
      `SELECT (SELECT COUNT(*) FROM users WHERE paid_at IS NOT NULL) AS members,
              (SELECT COALESCE(MAX(number), 0) FROM member_numbers) AS lastNumber,
              (SELECT COUNT(DISTINCT LOWER(city)) FROM users WHERE paid_at IS NOT NULL AND city != '') AS cities`,
    );
    res.json({
      members,
      cities,
      founderSpotsLeft: Math.max(0, config.founderLimit - lastNumber),
      founderLimit: config.founderLimit,
      paidEntry: config.paidEntry,
      priceCents: config.priceCents,
      currency: config.currency,
    });
  });

  return r;
};
