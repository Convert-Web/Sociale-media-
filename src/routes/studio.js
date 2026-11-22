'use strict';
// Statistiques du créateur : vues, temps regardé, J'aime, commentaires, nouveaux abonnés, jour par jour.
const express = require('express');
const { requireAuth } = require('../auth');
const { POST_SELECT, serializePost } = require('../social');
const { dayOf } = require('../analytics');

module.exports = function studioRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;

  r.get('/studio', requireAuth, async (req, res) => {
    const days = [7, 28, 60].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const me = req.user.id;
    const now = Date.now();
    const since = now - days * 86400e3;
    const firstDay = dayOf(since + 86400e3);
    const list = [];
    for (let i = days - 1; i >= 0; i--) list.push(dayOf(now - i * 86400e3));

    const views = await db.all(
      'SELECT d.day, SUM(d.plays) AS plays, SUM(d.watch_ms) AS watch FROM view_days d JOIN posts p ON p.id = d.post_id WHERE p.user_id = ? AND d.day >= ? GROUP BY d.day',
      me, firstDay,
    );
    const perDay = async (sql) => {
      const rows = await db.all(sql, me, since);
      const m = new Map();
      for (const row of rows) {
        const d = dayOf(row.t);
        m.set(d, (m.get(d) || 0) + 1);
      }
      return m;
    };
    const likes = await perDay('SELECT l.created_at AS t FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ? AND l.created_at > ?');
    const comments = await perDay('SELECT c.created_at AS t FROM comments c JOIN posts p ON p.id = c.post_id WHERE p.user_id = ? AND c.created_at > ?');
    const followers = await perDay('SELECT created_at AS t FROM follows WHERE followee_id = ? AND created_at > ?');
    const vmap = new Map(views.map((v) => [v.day, v]));
    const series = list.map((d) => ({
      day: d,
      views: vmap.get(d)?.plays || 0,
      watchMs: vmap.get(d)?.watch || 0,
      likes: likes.get(d) || 0,
      comments: comments.get(d) || 0,
      followers: followers.get(d) || 0,
    }));
    const sum = (k) => series.reduce((a, x) => a + x[k], 0);
    const top = await db.all(
      `${POST_SELECT} WHERE p.user_id = ? ORDER BY (SELECT COALESCE(SUM(plays), 0) FROM view_days d WHERE d.post_id = p.id AND d.day >= ?) DESC, p.id DESC LIMIT 6`,
      me, me, firstDay,
    );
    const totals = await db.get(
      `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers,
              (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts,
              (SELECT COALESCE(SUM(vv.plays), 0) FROM video_views vv JOIN posts p ON p.id = vv.post_id WHERE p.user_id = ?)
                + (SELECT COALESCE(SUM(guest_views), 0) FROM posts WHERE user_id = ?) AS allViews,
              (SELECT diamonds FROM users WHERE id = ?) AS diamonds`,
      me, me, me, me, me,
    );
    const lives = await db.all('SELECT id, title, started_at, ended_at, peak_viewers, viewers_total, likes, diamonds FROM lives WHERE user_id = ? ORDER BY id DESC LIMIT 5', me);
    res.json({
      days,
      series,
      totals: {
        views: sum('views'),
        watchMs: sum('watchMs'),
        likes: sum('likes'),
        comments: sum('comments'),
        newFollowers: sum('followers'),
        followers: totals.followers,
        posts: totals.posts,
        allViews: totals.allViews,
        diamonds: totals.diamonds,
      },
      top: top.map((row) => serializePost(ctx, row, req.user)),
      lives: lives.map((l) => ({ id: l.id, title: l.title, startedAt: l.started_at, endedAt: l.ended_at, peakViewers: l.peak_viewers, viewersTotal: l.viewers_total, likes: l.likes, diamonds: l.diamonds })),
    });
  });

  return r;
};
