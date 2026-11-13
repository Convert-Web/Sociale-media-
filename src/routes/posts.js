'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { fail, text, intParam } = require('../http');
const { single, saveImage, deleteUpload } = require('../uploads');
const {
  POST_SELECT,
  serializePost,
  getPost,
  COMMENT_SELECT,
  serializeComment,
  notify,
  retractNotification,
  notifyMentions,
  authorOf,
} = require('../social');

module.exports = function postRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;
  r.use(['/feed', '/posts', '/comments'], requireMember);

  const loadPost = (id) => {
    const postId = intParam(id);
    const post = postId && db.get('SELECT * FROM posts WHERE id = ?', postId);
    if (!post) fail(404, 'Publication introuvable.');
    return post;
  };

  r.get('/feed', (req, res) => {
    const before = intParam(req.query.before);
    const limit = Math.min(intParam(req.query.limit) || 15, 50);
    const scope = req.query.scope === 'following' ? 'following' : 'all';
    const me = req.user.id;
    const rows =
      scope === 'following'
        ? db.all(
            `${POST_SELECT}
             WHERE (? IS NULL OR p.id < ?)
               AND (p.user_id = ? OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))
             ORDER BY p.id DESC LIMIT ?`,
            me, before, before, me, me, limit,
          )
        : db.all(
            `${POST_SELECT}
             WHERE (? IS NULL OR p.id < ?) AND u.paid_at IS NOT NULL
             ORDER BY p.id DESC LIMIT ?`,
            me, before, before, limit,
          );
    res.json({
      posts: rows.map((row) => serializePost(ctx, row, req.user)),
      hasMore: rows.length === limit,
    });
  });

  r.post('/posts', single('image'), (req, res) => {
    const body = text(req.body?.body, { field: 'Publication', max: 2000 });
    if (!body && !req.file) fail(400, 'Votre publication est vide.');
    const image = saveImage(config.uploadsDir, req.file);
    const { lastInsertRowid } = db.run(
      'INSERT INTO posts (user_id, body, image, created_at) VALUES (?, ?, ?, ?)',
      req.user.id, body, image, Date.now(),
    );
    if (body) notifyMentions(ctx, body, req.user.id, lastInsertRowid);
    const post = getPost(ctx, lastInsertRowid, req.user);
    // Signale la nouveauté aux membres connectés (bandeau « nouvelles publications »)
    for (const userId of ctx.hub.clients.keys()) {
      if (userId !== req.user.id) {
        ctx.hub.send(userId, 'post', { id: post.id, author: post.author });
      }
    }
    res.status(201).json({ post });
  });

  r.get('/posts/:id', (req, res) => {
    const post = loadPost(req.params.id);
    res.json({ post: getPost(ctx, post.id, req.user) });
  });

  r.delete('/posts/:id', (req, res) => {
    const post = loadPost(req.params.id);
    if (post.user_id !== req.user.id && !req.user.is_admin) fail(403, 'Action non autorisée.');
    db.run('DELETE FROM posts WHERE id = ?', post.id);
    deleteUpload(config.uploadsDir, post.image);
    res.json({ ok: true });
  });

  r.post('/posts/:id/like', (req, res) => {
    const post = loadPost(req.params.id);
    const { changes } = db.run(
      'INSERT OR IGNORE INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)',
      req.user.id, post.id, Date.now(),
    );
    if (changes) notify(ctx, { userId: post.user_id, actorId: req.user.id, type: 'like', postId: post.id });
    const { c } = db.get('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?', post.id);
    res.json({ liked: true, likeCount: c });
  });

  r.delete('/posts/:id/like', (req, res) => {
    const post = loadPost(req.params.id);
    const { changes } = db.run('DELETE FROM likes WHERE user_id = ? AND post_id = ?', req.user.id, post.id);
    if (changes) retractNotification(ctx, { userId: post.user_id, actorId: req.user.id, type: 'like', postId: post.id });
    const { c } = db.get('SELECT COUNT(*) AS c FROM likes WHERE post_id = ?', post.id);
    res.json({ liked: false, likeCount: c });
  });

  r.get('/posts/:id/likes', (req, res) => {
    const post = loadPost(req.params.id);
    const rows = db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number
       FROM likes l JOIN users u ON u.id = l.user_id
       WHERE l.post_id = ? ORDER BY l.created_at DESC LIMIT 100`,
      post.id,
    );
    res.json({ users: rows.map((row) => authorOf(ctx, row)) });
  });

  r.get('/posts/:id/comments', (req, res) => {
    const post = loadPost(req.params.id);
    const rows = db.all(`${COMMENT_SELECT} WHERE c.post_id = ? ORDER BY c.id ASC LIMIT 500`, post.id);
    res.json({ comments: rows.map((row) => serializeComment(ctx, row, req.user)) });
  });

  r.post('/posts/:id/comments', (req, res) => {
    const post = loadPost(req.params.id);
    const body = text(req.body.body, { field: 'Commentaire', max: 1000, required: true });
    const { lastInsertRowid } = db.run(
      'INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
      post.id, req.user.id, body, Date.now(),
    );
    notify(ctx, { userId: post.user_id, actorId: req.user.id, type: 'comment', postId: post.id });
    notifyMentions(ctx, body, req.user.id, post.id);
    const row = db.get(`${COMMENT_SELECT} WHERE c.id = ?`, lastInsertRowid);
    res.status(201).json({ comment: serializeComment(ctx, row, req.user) });
  });

  r.delete('/comments/:id', (req, res) => {
    const id = intParam(req.params.id);
    const comment = id && db.get('SELECT * FROM comments WHERE id = ?', id);
    if (!comment) fail(404, 'Commentaire introuvable.');
    if (comment.user_id !== req.user.id && !req.user.is_admin) fail(403, 'Action non autorisée.');
    db.run('DELETE FROM comments WHERE id = ?', comment.id);
    res.json({ ok: true });
  });

  return r;
};
