'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { fail } = require('../http');
const { vapidKeys, sendPush } = require('../push');

module.exports = function pushRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/push', requireAuth);

  r.get('/push/key', async (_req, res) => {
    res.json({ publicKey: (await vapidKeys(ctx)).publicKey });
  });

  // Enregistre l'abonnement de cet appareil (un appareil = un compte à la fois)
  r.post('/push/subscribe', async (req, res) => {
    const endpoint = req.body?.endpoint;
    const p256dh = req.body?.keys?.p256dh;
    const auth = req.body?.keys?.auth;
    const valid = (v, max) => typeof v === 'string' && v.length > 8 && v.length < max;
    if (!valid(endpoint, 2000) || !/^https:\/\//.test(endpoint) || !valid(p256dh, 300) || !valid(auth, 100)) {
      fail(400, 'Abonnement invalide.');
    }
    await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);
    await db.run(
      'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)',
      req.user.id, endpoint, p256dh, auth, Date.now(),
    );
    res.status(201).json({ ok: true });
  });

  r.post('/push/unsubscribe', async (req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint === 'string') {
      await db.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', endpoint, req.user.id);
    }
    res.json({ ok: true });
  });

  // Notification d'essai sur tous les appareils du compte
  r.post('/push/test', async (req, res) => {
    const delivered = await sendPush(ctx, req.user.id, {
      title: ctx.config.appName,
      body: 'Les notifications sont activées sur cet appareil.',
      url: '/reglages',
      tag: 'test',
    });
    res.json({ delivered });
  });

  return r;
};
