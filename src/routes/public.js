'use strict';
const express = require('express');
const { getLegal } = require('../legal');
const analytics = require('../analytics');

module.exports = function publicRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  // Version de l'application (jamais mise en cache)
  r.get('/version', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ version: config.version });
  });

  // Informations légales de l'éditeur (pages publiques)
  r.get('/legal', async (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ legal: await getLegal(ctx), appName: config.appName, currency: config.currency });
  });

  // Mesure d'audience anonyme (sans cookie) : une page vue
  r.post('/a', async (req, res) => {
    await analytics.record(ctx, req).catch((err) => console.error('[audience]', err.message));
    res.status(204).end();
  });

  // Erreur JavaScript chez un visiteur : message court et page (modèle d'adresse), sans identité
  r.post('/client-errors', async (req, res) => {
    const b = req.body || {};
    const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const message = clip(b.message, 300).trim();
    const ua = req.get('user-agent') || '';
    if (message && !analytics.isBot(ua)) {
      const device = `${analytics.device(ua)} · ${/Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'autre'}`;
      await db.run('INSERT INTO client_errors (at, message, stack, path, device, version) VALUES (?, ?, ?, ?, ?, ?)', Date.now(), message, clip(b.stack, 900), clip(b.path, 60), device, clip(b.version, 60));
      // On garde les 500 dernières
      await db.run('DELETE FROM client_errors WHERE id <= (SELECT MAX(id) FROM client_errors) - 500');
    }
    res.status(204).end();
  });

  return r;
};
