'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { friendStatus } = require('./friends');
const { fail, intParam } = require('../http');
const { POST_SELECT, NOT_BLOCKED, PUBLIC_POST, serializePost, publicUser, authorOf, notify, retractNotification, isBlocked } = require('../social');

// Le premier paramètre de chaque requête USER_LIST est l'identifiant du membre qui consulte.
const USER_LIST = `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at, u.bio, u.profession, u.city,
  EXISTS(SELECT 1 FROM follows fx WHERE fx.follower_id = ? AND fx.followee_id = u.id) AS is_following`;
// Exclut les membres bloqués (dans un sens ou dans l'autre) : deux paramètres, l'identifiant du lecteur.
const USER_NOT_BLOCKED = `u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)`;

module.exports = function userRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use(['/users', '/search', '/suggestions', '/trending', '/members', '/me/progress'], requireMember);

  const listUser = (row, viewer) => ({
    ...authorOf(ctx, row),
    bio: row.bio,
    profession: row.profession,
    city: row.city,
    isFollowing: Boolean(row.is_following),
    isMe: row.user_id === viewer.id,
  });

  const findMember = async (username) => {
    const u = typeof username === 'string' && (await db.get('SELECT * FROM users WHERE username = ? AND paid_at IS NOT NULL', username));
    if (!u) fail(404, 'Ce membre est introuvable.');
    return u;
  };

  // Profil visible : introuvable pour qui a été bloqué par ce membre.
  const findVisible = async (username, viewer) => {
    const u = await findMember(username);
    if (u.id !== viewer.id && (await db.get('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?', u.id, viewer.id))) {
      fail(404, 'Ce membre est introuvable.');
    }
    return u;
  };

  r.get('/users/:username', async (req, res) => {
    const u = await findVisible(req.params.username, req.user);
    const me = req.user.id;
    const row = await db.get(
      `SELECT
         (SELECT COUNT(*) FROM posts WHERE user_id = ? AND groupe_id IS NULL) AS posts,
         (SELECT COUNT(*) FROM follows f JOIN users x ON x.id = f.follower_id WHERE f.followee_id = ?) AS followers,
         (SELECT COUNT(*) FROM follows f JOIN users x ON x.id = f.followee_id WHERE f.follower_id = ?) AS following,
         (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?) AS likes,
         (SELECT COUNT(*) FROM posts p WHERE p.user_id = ? AND p.image IS NOT NULL AND p.groupe_id IS NULL) AS photos,
         EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS is_following,
         EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS follows_you,
         EXISTS(SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?) AS blocked,
         (SELECT COUNT(*) FROM friend_requests WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted') AS friends`,
      u.id, u.id, u.id, u.id, u.id, me, u.id, u.id, me, me, u.id, u.id, u.id,
    );
    res.json({
      user: {
        ...publicUser(ctx, u),
        stats: { posts: row.posts, followers: row.followers, following: row.following, likes: row.likes, photos: row.photos, friends: row.friends },
        friendStatus: u.id === me ? 'self' : await friendStatus(ctx, me, u.id),
        isMe: u.id === me,
        isFollowing: Boolean(row.is_following),
        followsYou: Boolean(row.follows_you),
        blocked: Boolean(row.blocked),
        invitedBy: u.invited_by
          ? await db.get('SELECT username, display_name AS displayName FROM users WHERE id = ? AND paid_at IS NOT NULL', u.invited_by).then((x) => x || null)
          : null,
        invitedCount: (await db.get('SELECT COUNT(*) AS n FROM users WHERE invited_by = ? AND paid_at IS NOT NULL', u.id)).n,
      },
    });
  });

  r.get('/users/:username/posts', async (req, res) => {
    const u = await findVisible(req.params.username, req.user);
    const before = intParam(req.query.before);
    const limit = 15;
    const rows = await db.all(
      `${POST_SELECT} WHERE p.user_id = ? AND (? IS NULL OR p.id < ?) AND ${NOT_BLOCKED} AND ${PUBLIC_POST} ORDER BY p.id DESC LIMIT ?`,
      req.user.id, u.id, before, before, limit,
    );
    res.json({ posts: rows.map((row) => serializePost(ctx, row, req.user)), hasMore: rows.length === limit });
  });

  // Toutes les photos publiées par un membre (grille du profil)
  r.get('/users/:username/photos', async (req, res) => {
    const u = await findVisible(req.params.username, req.user);
    if (u.id !== req.user.id && (await isBlocked(ctx, req.user.id, u.id))) return res.json({ photos: [] });
    const rows = await db.all(
      `SELECT post_id, url FROM (
         SELECT p.id AS post_id, p.image AS url, p.id * 100 AS k FROM posts p WHERE p.user_id = ? AND p.image IS NOT NULL AND p.groupe_id IS NULL
         UNION ALL
         SELECT pm.post_id, pm.url, pm.post_id * 100 + pm.position FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE p.user_id = ? AND p.groupe_id IS NULL
       ) ORDER BY k DESC LIMIT 90`,
      u.id, u.id,
    );
    res.json({ photos: rows.map((row) => ({ postId: row.post_id, url: row.url })) });
  });

  r.get('/users/:username/:relation', async (req, res) => {
    const { relation } = req.params;
    if (relation !== 'followers' && relation !== 'following') fail(404, 'Introuvable.');
    const u = await findVisible(req.params.username, req.user);
    const me = req.user.id;
    const rows =
      relation === 'followers'
        ? await db.all(`${USER_LIST} FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? AND ${USER_NOT_BLOCKED} ORDER BY f.created_at DESC LIMIT 200`, me, u.id, me, me)
        : await db.all(`${USER_LIST} FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? AND ${USER_NOT_BLOCKED} ORDER BY f.created_at DESC LIMIT 200`, me, u.id, me, me);
    res.json({ users: rows.map((row) => listUser(row, req.user)) });
  });

  r.post('/users/:username/follow', async (req, res) => {
    const u = await findVisible(req.params.username, req.user);
    if (u.id === req.user.id) fail(400, 'Vous ne pouvez pas vous suivre vous-même.');
    if (await isBlocked(ctx, req.user.id, u.id)) fail(403, 'Débloquez ce membre pour le suivre.');
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

  // Bloquer : plus d'abonnement dans un sens ni dans l'autre, contenus masqués, messages impossibles.
  r.post('/users/:username/block', async (req, res) => {
    const u = await findMember(req.params.username);
    if (u.id === req.user.id) fail(400, 'Vous ne pouvez pas vous bloquer vous-même.');
    const me = req.user.id;
    await db.transaction(async (t) => {
      await t.run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', me, u.id, Date.now());
      await t.run('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)', me, u.id, u.id, me);
      await t.run('DELETE FROM notifications WHERE (user_id = ? AND actor_id = ?) OR (user_id = ? AND actor_id = ?)', me, u.id, u.id, me);
      await t.run('DELETE FROM friend_requests WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)', me, u.id, u.id, me);
    });
    res.json({ blocked: true });
  });

  r.delete('/users/:username/block', async (req, res) => {
    const u = await findMember(req.params.username);
    await db.run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, u.id);
    res.json({ blocked: false });
  });

  // Membres bloqués (réglages)
  r.get('/me/blocked', requireMember, async (req, res) => {
    const rows = await db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at
       FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ? ORDER BY b.created_at DESC`,
      req.user.id,
    );
    res.json({ users: rows.map((row) => authorOf(ctx, row)) });
  });

  // Étapes d'accueil des nouveaux membres
  r.get('/me/progress', async (req, res) => {
    const me = req.user.id;
    const row = await db.get(
      `SELECT (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
              (SELECT COUNT(*) FROM posts WHERE user_id = ? AND groupe_id IS NULL) AS posts`,
      me, me,
    );
    res.json({
      avatar: Boolean(req.user.avatar),
      bio: Boolean(req.user.bio),
      following: row.following,
      posts: row.posts,
    });
  });

  r.get('/search', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    if (!q) return res.json({ users: [], posts: [] });
    const me = req.user.id;
    const like = `%${q.replace(/^[@#]/, '').replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const users = q.startsWith('#')
      ? []
      : await db.all(
          `${USER_LIST} FROM users u
           WHERE u.paid_at IS NOT NULL AND ${USER_NOT_BLOCKED}
             AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\'
                  OR u.profession LIKE ? ESCAPE '\\' OR u.city LIKE ? ESCAPE '\\')
           ORDER BY u.member_number ASC LIMIT 20`,
          me, me, me, like, like, like, like,
        );
    if (req.query.only === 'users') return res.json({ users: users.map((row) => listUser(row, req.user)), posts: [] });
    const postLike = q.startsWith('#') ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : like;
    const posts = await db.all(
      `${POST_SELECT} WHERE p.body LIKE ? ESCAPE '\\' AND ${NOT_BLOCKED} AND ${PUBLIC_POST} ORDER BY p.id DESC LIMIT 30`,
      me, postLike,
    );
    res.json({
      users: users.map((row) => listUser(row, req.user)),
      posts: posts.map((row) => serializePost(ctx, row, req.user)),
    });
  });

  r.get('/suggestions', async (req, res) => {
    const limit = Math.min(intParam(req.query.limit) || 5, 30);
    const me = req.user.id;
    const rows = await db.all(
      `${USER_LIST},
         (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
       FROM users u
       WHERE u.paid_at IS NOT NULL AND u.id != ? AND ${USER_NOT_BLOCKED}
         AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
       ORDER BY followers DESC, RANDOM() LIMIT ?`,
      me, me, me, me, me, limit,
    );
    res.json({ users: rows.map((row) => listUser(row, req.user)) });
  });

  r.get('/members', async (req, res) => {
    const me = req.user.id;
    const rows = await db.all(
      `${USER_LIST} FROM users u WHERE u.paid_at IS NOT NULL AND ${USER_NOT_BLOCKED} ORDER BY u.paid_at DESC LIMIT 30`,
      me, me, me,
    );
    res.json({ users: rows.map((row) => listUser(row, req.user)) });
  });

  r.get('/trending', async (req, res) => {
    const since = Date.now() - 14 * 24 * 3600 * 1000;
    const rows = await db.all("SELECT body FROM posts WHERE created_at > ? AND groupe_id IS NULL AND body LIKE '%#%' ORDER BY id DESC LIMIT 1000", since);
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
