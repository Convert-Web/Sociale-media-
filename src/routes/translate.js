'use strict';
const express = require('express');
const { requireAuth, requireMember } = require('../auth');
const { fail } = require('../http');
const { selfUser } = require('../social');
const { LANGS, translateTexts } = require('../translate');

// Garde-fou : au plus 120 demandes de traduction par membre et par heure (par serveur)
const usage = new Map();
function allow(userId) {
  const hour = Math.floor(Date.now() / 3600000);
  const k = `${userId}:${hour}`;
  const n = (usage.get(k) || 0) + 1;
  if (usage.size > 10000) usage.clear();
  usage.set(k, n);
  return n <= 120;
}

module.exports = function translateRoutes(ctx) {
  const r = express.Router();

  // Traduire un ou plusieurs textes dans la langue du membre
  r.post('/translate', requireMember, async (req, res) => {
    const texts = req.body?.texts;
    const to = req.body?.to;
    if (!Array.isArray(texts) || !texts.length || texts.length > 10 || texts.some((t) => typeof t !== 'string' || !t.trim())) fail(400, 'Textes à traduire invalides.');
    if (texts.reduce((n, t) => n + t.length, 0) > 5000) fail(400, 'Texte trop long pour être traduit.');
    if (!LANGS.includes(to)) fail(400, 'Langue non prise en charge.');
    if (!allow(req.user.id)) fail(429, 'Beaucoup de traductions en peu de temps : réessayez dans un moment.');
    try {
      res.json({ translations: await translateTexts(ctx, texts, to) });
    } catch (err) {
      fail(err.status || 502, err.message);
    }
  });

  // Langue dans laquelle traduire les contenus
  r.post('/me/lang', requireAuth, async (req, res) => {
    const lang = req.body?.lang;
    if (lang !== null && !LANGS.includes(lang)) fail(400, 'Langue non prise en charge.');
    await ctx.db.run('UPDATE users SET lang = ? WHERE id = ?', lang, req.user.id);
    res.json({ user: selfUser(ctx, await ctx.db.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
  });

  return r;
};
