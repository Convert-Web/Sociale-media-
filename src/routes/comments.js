'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { fail, text, intParam } = require('../http');
const { throttle } = require('../antispam');
const { moderate, autoReport } = require('../contentFilter');
const { getPost, COMMENT_SELECT, serializeComment, notify, retractNotification, notifyMentions, isBlocked, areFriends } = require('../social');
const { deleteComment } = require('../accounts');
const { learn, SIGNALS } = require('../feed');

module.exports = function commentRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  const vid = (req) => req.user?.id || 0;

  async function loadPost(req, id = req.params.id) {
    const post = await getPost(ctx, intParam(id), req.user);
    if (!post) fail(404, 'Cette vidéo n’est pas disponible.');
    return post;
  }

  async function loadComment(req) {
    const id = intParam(req.params.id);
    const row = id && (await db.get(`${COMMENT_SELECT} WHERE c.id = ?`, vid(req), id));
    if (!row) fail(404, 'Ce commentaire n’existe plus.');
    await loadPost(req, row.post_id); // la vidéo doit rester visible pour ce compte
    return row;
  }

  // Commentaires d'une vidéo : épinglé d'abord, puis les plus appréciés (dont ceux aimés par le créateur)
  r.get('/posts/:id/comments', async (req, res) => {
    const post = await loadPost(req);
    const offset = Math.min(2000, intParam(req.query.cursor) || 0);
    const limit = 20;
    const me = vid(req);
    const rows = await db.all(
      `SELECT * FROM (${COMMENT_SELECT} WHERE c.post_id = ? AND c.parent_id IS NULL
         AND c.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = v.id UNION SELECT blocker_id FROM blocks WHERE blocked_id = v.id))
       ORDER BY (id = pinned_comment_id) DESC, (user_id = ? AND created_at > ?) DESC,
                (like_count + author_liked * 5 + reply_count * 2) DESC, id DESC
       LIMIT ? OFFSET ?`,
      me, post.id, me, Date.now() - 10 * 60 * 1000, limit, offset,
    );
    res.json({
      comments: rows.map((row) => serializeComment(ctx, row, req.user)),
      cursor: rows.length === limit ? offset + limit : null,
      count: post.commentCount,
      allowComments: post.allowComments,
    });
  });

  // Réponses d'un commentaire, dans l'ordre
  r.get('/comments/:id/replies', async (req, res) => {
    const parent = await loadComment(req);
    const after = intParam(req.query.cursor);
    const limit = 20;
    const rows = await db.all(
      `${COMMENT_SELECT} WHERE c.parent_id = ? AND (? IS NULL OR c.id > ?)
         AND c.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = v.id UNION SELECT blocker_id FROM blocks WHERE blocked_id = v.id)
       ORDER BY c.id ASC LIMIT ?`,
      vid(req), parent.id, after, after, limit,
    );
    res.json({ comments: rows.map((row) => serializeComment(ctx, row, req.user)), cursor: rows.length === limit ? rows[rows.length - 1].id : null });
  });

  r.post('/posts/:id/comments', requireAuth, async (req, res) => {
    const post = await loadPost(req);
    if (!post.allowComments && !post.mine) fail(403, 'Les commentaires sont désactivés pour cette vidéo.');
    if (await isBlocked(ctx, req.user.id, post.author.id)) fail(403, 'Tu ne peux pas commenter cette vidéo.');
    const body = text(req.body?.body, { field: 'Commentaire', max: 150, required: true });
    await throttle(ctx, req.user, 'comment');
    // Réponse : toujours rattachée au commentaire principal (un seul niveau, comme sur TikTok)
    let parent = null;
    if (req.body?.parentId) {
      parent = await db.get('SELECT id, parent_id, user_id, post_id FROM comments WHERE id = ?', intParam(req.body.parentId));
      if (!parent || parent.post_id !== post.id) fail(404, 'Le commentaire auquel tu réponds n’existe plus.');
    }
    const top = parent ? parent.parent_id || parent.id : null;
    const flagged = moderate(body);
    const { lastInsertRowid } = await db.run(
      'INSERT INTO comments (post_id, user_id, body, created_at, flagged, parent_id) VALUES (?, ?, ?, ?, ?, ?)',
      post.id, req.user.id, body, Date.now(), flagged, top,
    );
    await autoReport(ctx, 'comment', lastInsertRowid, flagged);
    const notified = [req.user.id];
    if (parent && parent.user_id !== req.user.id) {
      await notify(ctx, { userId: parent.user_id, actorId: req.user.id, type: 'reply', postId: post.id, commentId: lastInsertRowid, body });
      notified.push(parent.user_id);
    }
    if (!notified.includes(post.author.id)) {
      await notify(ctx, { userId: post.author.id, actorId: req.user.id, type: 'comment', postId: post.id, commentId: lastInsertRowid, body });
      notified.push(post.author.id);
    }
    await notifyMentions(ctx, body, req.user.id, { postId: post.id, commentId: lastInsertRowid, except: notified });
    await learn(ctx, req.user.id, post.id, SIGNALS.comment);
    const row = await db.get(`${COMMENT_SELECT} WHERE c.id = ?`, req.user.id, lastInsertRowid);
    const { n } = await db.get('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?', post.id);
    ctx.hub.send(post.author.id, 'comment', { postId: post.id, count: n });
    res.status(201).json({ comment: serializeComment(ctx, row, req.user), count: n });
  });

  r.delete('/comments/:id', requireAuth, async (req, res) => {
    const c = await loadComment(req);
    if (!serializeComment(ctx, c, req.user).canDelete) fail(403, 'Tu ne peux pas supprimer ce commentaire.');
    await deleteComment(ctx, c.id);
    const { n } = await db.get('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?', c.post_id);
    res.json({ ok: true, count: n });
  });

  r.post('/comments/:id/like', requireAuth, async (req, res) => {
    const c = await loadComment(req);
    const { changes } = await db.run('INSERT OR IGNORE INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)', c.id, req.user.id, Date.now());
    if (changes) await notify(ctx, { userId: c.user_id, actorId: req.user.id, type: 'comment_like', postId: c.post_id, commentId: c.id, body: c.body });
    const { n } = await db.get('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', c.id);
    res.json({ liked: true, likeCount: n });
  });

  r.delete('/comments/:id/like', requireAuth, async (req, res) => {
    const c = await loadComment(req);
    await db.run('DELETE FROM comment_likes WHERE comment_id = ? AND user_id = ?', c.id, req.user.id);
    await retractNotification(ctx, { userId: c.user_id, actorId: req.user.id, type: 'comment_like', postId: c.post_id, commentId: c.id });
    const { n } = await db.get('SELECT COUNT(*) AS n FROM comment_likes WHERE comment_id = ?', c.id);
    res.json({ liked: false, likeCount: n });
  });

  // Épingler un commentaire en tête (le créateur de la vidéo, un seul à la fois)
  r.post('/comments/:id/pin', requireAuth, async (req, res) => {
    const c = await loadComment(req);
    if (c.post_author_id !== req.user.id) fail(403, 'Seul le créateur de la vidéo peut épingler un commentaire.');
    if (c.parent_id) fail(400, 'Seul un commentaire principal peut être épinglé.');
    await db.run('UPDATE posts SET pinned_comment_id = ? WHERE id = ?', c.id, c.post_id);
    res.json({ pinned: true });
  });

  r.delete('/comments/:id/pin', requireAuth, async (req, res) => {
    const c = await loadComment(req);
    if (c.post_author_id !== req.user.id) fail(403, 'Action impossible.');
    await db.run('UPDATE posts SET pinned_comment_id = NULL WHERE id = ? AND pinned_comment_id = ?', c.post_id, c.id);
    res.json({ pinned: false });
  });

  return r;
};

module.exports.areFriends = areFriends;
