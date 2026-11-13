'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { intParam } = require('../http');
const { NOTIF_SELECT, serializeNotification, pushCounters } = require('../social');

module.exports = function notificationRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/notifications', requireMember);

  r.get('/notifications', async (req, res) => {
    const before = intParam(req.query.before);
    const limit = 30;
    const rows = await db.all(
      `${NOTIF_SELECT} WHERE n.user_id = ? AND (? IS NULL OR n.id < ?) ORDER BY n.id DESC LIMIT ?`,
      req.user.id, before, before, limit,
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
