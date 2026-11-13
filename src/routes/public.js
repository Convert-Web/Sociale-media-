'use strict';
const express = require('express');

module.exports = function publicRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  r.get('/public/stats', (_req, res) => {
    const { members } = db.get('SELECT COUNT(*) AS members FROM users WHERE paid_at IS NOT NULL');
    const { lastNumber } = db.get('SELECT COALESCE(MAX(number), 0) AS lastNumber FROM member_numbers');
    const { cities } = db.get("SELECT COUNT(DISTINCT LOWER(city)) AS cities FROM users WHERE paid_at IS NOT NULL AND city != ''");
    res.json({
      members,
      cities,
      founderSpotsLeft: Math.max(0, config.founderLimit - lastNumber),
      founderLimit: config.founderLimit,
      priceCents: config.priceCents,
      currency: config.currency,
    });
  });

  return r;
};
