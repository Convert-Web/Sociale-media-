'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { intParam } = require('../http');
const { NOTIF_SELECT, serializeNotification, pushCounters } = require('../social');

// Filtres de la page Activité
const FILTERS = {
  likes: ['like', 'favorite', 'comment_like'],
  comments: ['comment', 'reply'],
  mentions: ['mention'],
  followers: ['follow', 'follow_accept', 'follow_request'],
  other: ['repost', 'duet', 'stitch', 'live', 'gift'],
};

module.exports = function notificationRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/notifications', requireAuth);

  r.get('/notifications', async (req, res) => {
    const before = intParam(req.query.before);
    const types = FILTERS[req.query.type] || null;
    const limit = 30;
    const rows = await db.all(
      `${NOTIF_SELECT}
       WHERE n.user_id = ? AND (? IS NULL OR n.id < ?)
         ${types ? `AND n.type IN (${types.map(() => '?').join(',')})` : ''}
         AND n.actor_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
       ORDER BY n.id DESC LIMIT ?`,
      req.user.id, before, before, ...(types || []), req.user.id, limit,
    );
    res.json({ notifications: rows.map((row) => serializeNotification(ctx, row)), hasMore: rows.length === limit });
  });

  r.post('/notifications/read', async (req, res) => {
    await db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', Date.now(), req.user.id);
    await pushCounters(ctx, req.user.id);
    res.json({ ok: true });
  });

  return r;
};

module.exports.FILTERS = FILTERS;
