'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { intParam, idList } = require('../http');
const { forYou, followingFeed, friendsFeed } = require('../feed');
const V = require('../videos');

module.exports = function feedRoutes(ctx) {
  const r = express.Router();

  // « Pour toi » : ouvert à tous (sans compte, le fil n'est simplement pas personnalisé)
  r.get('/feed/foryou', async (req, res) => {
    await V.purgeExpired(ctx);
    const exclude = idList(req.query.exclude, 300);
    const { posts, hasMore } = await forYou(ctx, req.user, { exclude, limit: Math.min(12, intParam(req.query.limit) || 8) });
    res.json({ posts, hasMore });
  });

  r.get('/feed/following', requireAuth, async (req, res) => {
    const { posts, cursor } = await followingFeed(ctx, req.user, { before: intParam(req.query.cursor) });
    res.json({ posts, cursor });
  });

  r.get('/feed/friends', requireAuth, async (req, res) => {
    const { posts, cursor } = await friendsFeed(ctx, req.user, { before: intParam(req.query.cursor) });
    res.json({ posts, cursor });
  });

  return r;
};
