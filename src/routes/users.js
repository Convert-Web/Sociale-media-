'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { fail, intParam } = require('../http');
const { POST_SELECT, serializePost, publicUser, authorOf, notify, retractNotification } = require('../social');

// Le premier paramètre de chaque requête USER_LIST est l'identifiant du membre qui consulte.
const USER_LIST = `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.bio, u.profession, u.city,
  EXISTS(SELECT 1 FROM follows fx WHERE fx.follower_id = ? AND fx.followee_id = u.id) AS is_following`;

module.exports = function userRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use(['/users', '/search', '/suggestions', '/trending', '/members'], requireMember);

  const listUser = (row, viewer) => ({
    ...authorOf(ctx, row),
    bio: row.bio,
    profession: row.profession,
    city: row.city,
    isFollowing: Boolean(row.is_following),
    isMe: row.user_id === viewer.id,
  });

  const findMember = async (username) => {
    const u = typeof username === 'string' && await db.get('SELECT * FROM users WHERE username = ? AND paid_at IS NOT NULL', username);
    if (!u) fail(404, 'Ce membre est introuvable.');
    return u;
  };

  r.get('/users/:username', async (req, res) => {
    const u = await findMember(req.params.username);
    const me = req.user.id;
    const row = await db.get(
      `SELECT
         (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts,
         (SELECT COUNT(*) FROM follows f JOIN users x ON x.id = f.follower_id WHERE f.followee_id = ?) AS followers,
         (SELECT COUNT(*) FROM follows f JOIN users x ON x.id = f.followee_id WHERE f.follower_id = ?) AS following,
         (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?) AS likes,
         EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS is_following,
         EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS follows_you`,
      u.id, u.id, u.id, u.id, me, u.id, u.id, me,
    );
    const { is_following: isFollowing, follows_you: followsYou, ...stats } = row;
    res.json({
      user: {
        ...publicUser(ctx, u),
        stats: { posts: stats.posts, followers: stats.followers, following: stats.following, likes: stats.likes },
        isMe: u.id === me,
        isFollowing: Boolean(isFollowing),
        followsYou: Boolean(followsYou),
      },
    });
  });

  r.get('/users/:username/posts', async (req, res) => {
    const u = await findMember(req.params.username);
    const before = intParam(req.query.before);
    const limit = 15;
    const rows = await db.all(
      `${POST_SELECT} WHERE p.user_id = ? AND (? IS NULL OR p.id < ?) ORDER BY p.id DESC LIMIT ?`,
      req.user.id, u.id, before, before, limit,
    );
    res.json({ posts: rows.map((row) => serializePost(ctx, row, req.user)), hasMore: rows.length === limit });
  });

  r.get('/users/:username/:relation', async (req, res) => {
    const { relation } = req.params;
    if (relation !== 'followers' && relation !== 'following') fail(404, 'Introuvable.');
    const u = await findMember(req.params.username);
    const rows =
      relation === 'followers'
        ? await db.all(`${USER_LIST} FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? ORDER BY f.created_at DESC LIMIT 200`, req.user.id, u.id)
        : await db.all(`${USER_LIST} FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 200`, req.user.id, u.id);
    res.json({ users: rows.map((row) => listUser(row, req.user)) });
  });

  r.post('/users/:username/follow', async (req, res) => {
    const u = await findMember(req.params.username);
    if (u.id === req.user.id) fail(400, 'Vous ne pouvez pas vous suivre vous-même.');
    const { changes } = await db.run(
      'INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)',
      req.user.id, u.id, Date.now(),
    );
    if (changes) await notify(ctx, { userId: u.id, actorId: req.user.id, type: 'follow' });
    res.json({ following: true });
  });

  r.delete('/users/:username/follow', async (req, res) => {
    const u = await findMember(req.params.username);
    const { changes } = await db.run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', req.user.id, u.id);
    if (changes) await retractNotification(ctx, { userId: u.id, actorId: req.user.id, type: 'follow' });
    res.json({ following: false });
  });

  r.get('/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    if (!q) return res.json({ users: [], posts: [] });
    const like = `%${q.replace(/^[@#]/, '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const users = q.startsWith('#')
      ? []
      : await db.all(
          `${USER_LIST} FROM users u
           WHERE u.paid_at IS NOT NULL AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'
                 OR u.profession LIKE ? ESCAPE '\\' OR u.city LIKE ? ESCAPE '\\')
           ORDER BY u.member_number ASC LIMIT 20`,
          req.user.id, like, like, like, like,
        );
    const postLike = q.startsWith('#') ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : like;
    const posts = await db.all(
      `${POST_SELECT} WHERE p.body LIKE ? ESCAPE '\\' ORDER BY p.id DESC LIMIT 30`,
      req.user.id, postLike,
    );
    res.json({
      users: users.map((row) => listUser(row, req.user)),
      posts: posts.map((row) => serializePost(ctx, row, req.user)),
    });
  });

  r.get('/suggestions', async (req, res) => {
    const limit = Math.min(intParam(req.query.limit) || 5, 30);
    const rows = await db.all(
      `${USER_LIST},
         (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
       FROM users u
       WHERE u.paid_at IS NOT NULL AND u.id != ?
         AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
       ORDER BY followers DESC, RANDOM() LIMIT ?`,
      req.user.id, req.user.id, req.user.id, limit,
    );
    res.json({ users: rows.map((row) => listUser(row, req.user)) });
  });

  r.get('/members', async (req, res) => {
    const rows = await db.all(
      `${USER_LIST} FROM users u WHERE u.paid_at IS NOT NULL ORDER BY u.paid_at DESC LIMIT 30`,
      req.user.id,
    );
    res.json({ users: rows.map((row) => listUser(row, req.user)) });
  });

  r.get('/trending', async (req, res) => {
    const since = Date.now() - 14 * 24 * 3600 * 1000;
    const rows = await db.all("SELECT body FROM posts WHERE created_at > ? AND body LIKE '%#%' ORDER BY id DESC LIMIT 1000", since);
    const counts = new Map();
    for (const { body } of rows) {
      const tags = new Set();
      for (const m of body.matchAll(/(^|\s)#([\p{L}\p{N}_]{2,40})/gu)) tags.add(m[2].toLowerCase());
      for (const tag of tags) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const tags = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));
    res.json({ tags });
  });

  return r;
};
