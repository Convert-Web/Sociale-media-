'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { deletePost } = require('../membership');
const { fail, text, intParam } = require('../http');
const { photos, saveImage, deleteUpload } = require('../uploads');
const {
  POST_SELECT,
  NOT_BLOCKED,
  PUBLIC_POST,
  VISIBLE_POST,
  REACTIONS,
  serializePost,
  getPost,
  COMMENT_SELECT,
  serializeComment,
  notify,
  retractNotification,
  notifyMentions,
  authorOf,
  reactionSummary,
  isBlocked,
} = require('../social');

module.exports = function postRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use(['/feed', '/posts', '/comments', '/saved'], requireMember);

  // Publication accessible au lecteur : pas de blocage, et membre du groupe s'il s'agit d'un groupe privé.
  const loadPost = async (id, viewer) => {
    const postId = intParam(id);
    const post = postId && (await db.get('SELECT * FROM posts WHERE id = ?', postId));
    if (!post) fail(404, 'Publication introuvable.');
    if (viewer && post.user_id !== viewer.id && (await isBlocked(ctx, viewer.id, post.user_id))) fail(404, 'Publication introuvable.');
    if (viewer && post.groupe_id && !viewer.is_admin) {
      const member = await db.get(
        "SELECT 1 FROM groupe_members WHERE groupe_id = ? AND user_id = ? AND status = 'member'",
        post.groupe_id, viewer.id,
      );
      if (!member) fail(404, 'Publication introuvable.');
    }
    return post;
  };

  const page = (rows, viewer, limit) => ({
    posts: rows.map((row) => serializePost(ctx, row, viewer)),
    hasMore: rows.length === limit,
  });

  r.get('/feed', async (req, res) => {
    const before = intParam(req.query.before);
    const limit = Math.min(intParam(req.query.limit) || 15, 50);
    const scope = req.query.scope === 'following' ? 'following' : 'all';
    const me = req.user.id;
    const rows =
      scope === 'following'
        ? await db.all(
            `${POST_SELECT}
             WHERE (? IS NULL OR p.id < ?) AND ${NOT_BLOCKED} AND ${PUBLIC_POST}
               AND (p.user_id = v.id OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = v.id))
             ORDER BY p.id DESC LIMIT ?`,
            me, before, before, limit,
          )
        : await db.all(
            `${POST_SELECT}
             WHERE (? IS NULL OR p.id < ?) AND u.paid_at IS NOT NULL AND ${NOT_BLOCKED} AND ${PUBLIC_POST}
             ORDER BY p.id DESC LIMIT ?`,
            me, before, before, limit,
          );
    res.json(page(rows, req.user, limit));
  });

  // Publications enregistrées par le membre
  r.get('/saved', async (req, res) => {
    const before = intParam(req.query.before);
    const limit = 15;
    const rows = await db.all(
      `${POST_SELECT}
       JOIN bookmarks bk ON bk.post_id = p.id AND bk.user_id = v.id
       WHERE (? IS NULL OR p.id < ?) AND ${NOT_BLOCKED} AND ${VISIBLE_POST}
       ORDER BY p.id DESC LIMIT ?`,
      req.user.id, before, before, limit,
    );
    res.json(page(rows, req.user, limit));
  });

  r.post('/posts', photos(), async (req, res) => {
    const body = text(req.body?.body, { field: 'Publication', max: 2000 });
    const files = [...(req.files?.image || []), ...(req.files?.images || [])].slice(0, 6);
    if (!body && !files.length) fail(400, 'Votre publication est vide.');
    const urls = [];
    for (const f of files) urls.push(await saveImage(ctx, f));
    // La première photo reste dans posts.image (compatibilité), les suivantes dans post_media.
    const { lastInsertRowid } = await db.run(
      'INSERT INTO posts (user_id, body, image, created_at) VALUES (?, ?, ?, ?)',
      req.user.id, body, urls[0] || null, Date.now(),
    );
    for (const [i, url] of urls.slice(1).entries()) {
      await db.run('INSERT INTO post_media (post_id, url, position) VALUES (?, ?, ?)', lastInsertRowid, url, i + 1);
    }
    if (body) await notifyMentions(ctx, body, req.user.id, lastInsertRowid);
    const post = await getPost(ctx, lastInsertRowid, req.user);
    // Signale la nouveauté aux membres connectés (bandeau « nouvelles publications »)
    for (const userId of ctx.hub.clients.keys()) {
      if (userId !== req.user.id) ctx.hub.send(userId, 'post', { id: post.id, author: post.author });
    }
    res.status(201).json({ post });
  });

  r.get('/posts/:id', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    res.json({ post: await getPost(ctx, post.id, req.user) });
  });

  // Modifier le texte d'une publication (auteur uniquement)
  r.patch('/posts/:id', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    if (post.user_id !== req.user.id) fail(403, 'Seul l’auteur peut modifier sa publication.');
    const body = text(req.body?.body, { field: 'Publication', max: 2000 });
    if (!body && !post.image) fail(400, 'Votre publication est vide.');
    await db.run('UPDATE posts SET body = ?, edited_at = ? WHERE id = ?', body, Date.now(), post.id);
    res.json({ post: await getPost(ctx, post.id, req.user) });
  });

  r.delete('/posts/:id', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    if (post.user_id !== req.user.id && !req.user.is_admin) fail(403, 'Action non autorisée.');
    const media = await deletePost(ctx, post.id);
    for (const url of [post.image, ...media]) deleteUpload(ctx, url);
    res.json({ ok: true });
  });

  // Réagir (❤️ par défaut) ou changer de réaction
  r.post('/posts/:id/like', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    const reaction = REACTIONS.includes(req.body?.reaction) ? req.body.reaction : REACTIONS[0];
    const previous = await db.get('SELECT reaction FROM likes WHERE user_id = ? AND post_id = ?', req.user.id, post.id);
    if (previous) {
      await db.run('UPDATE likes SET reaction = ? WHERE user_id = ? AND post_id = ?', reaction, req.user.id, post.id);
    } else {
      await db.run(
        'INSERT OR IGNORE INTO likes (user_id, post_id, created_at, reaction) VALUES (?, ?, ?, ?)',
        req.user.id, post.id, Date.now(), reaction,
      );
      await notify(ctx, { userId: post.user_id, actorId: req.user.id, type: 'like', postId: post.id });
    }
    res.json(await reactionState(post.id, reaction));
  });

  r.delete('/posts/:id/like', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    const { changes } = await db.run('DELETE FROM likes WHERE user_id = ? AND post_id = ?', req.user.id, post.id);
    if (changes) await retractNotification(ctx, { userId: post.user_id, actorId: req.user.id, type: 'like', postId: post.id });
    res.json(await reactionState(post.id, null));
  });

  async function reactionState(postId, mine) {
    const row = await db.get(
      'SELECT COUNT(*) AS c, GROUP_CONCAT(reaction) AS list FROM likes WHERE post_id = ?',
      postId,
    );
    return { liked: Boolean(mine), myReaction: mine, likeCount: row.c, reactions: reactionSummary(row.list) };
  }

  r.get('/posts/:id/likes', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    const rows = await db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, l.reaction
       FROM likes l JOIN users u ON u.id = l.user_id
       WHERE l.post_id = ? ORDER BY l.created_at DESC LIMIT 200`,
      post.id,
    );
    res.json({ users: rows.map((row) => ({ ...authorOf(ctx, row), reaction: row.reaction })) });
  });

  // Enregistrer / retirer des enregistrements
  r.post('/posts/:id/save', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    await db.run('INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)', req.user.id, post.id, Date.now());
    res.json({ saved: true });
  });

  r.delete('/posts/:id/save', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    await db.run('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?', req.user.id, post.id);
    res.json({ saved: false });
  });

  r.get('/posts/:id/comments', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    const rows = await db.all(
      `${COMMENT_SELECT}
       WHERE c.post_id = ?
         AND c.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)
       ORDER BY c.id ASC LIMIT 500`,
      post.id, req.user.id, req.user.id,
    );
    res.json({ comments: rows.map((row) => serializeComment(ctx, row, req.user)) });
  });

  r.post('/posts/:id/comments', async (req, res) => {
    const post = await loadPost(req.params.id, req.user);
    const body = text(req.body.body, { field: 'Commentaire', max: 1000, required: true });
    const { lastInsertRowid } = await db.run(
      'INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
      post.id, req.user.id, body, Date.now(),
    );
    await notify(ctx, { userId: post.user_id, actorId: req.user.id, type: 'comment', postId: post.id });
    await notifyMentions(ctx, body, req.user.id, post.id);
    const row = await db.get(`${COMMENT_SELECT} WHERE c.id = ?`, lastInsertRowid);
    res.status(201).json({ comment: serializeComment(ctx, row, req.user) });
  });

  r.delete('/comments/:id', async (req, res) => {
    const id = intParam(req.params.id);
    const comment = id && (await db.get('SELECT * FROM comments WHERE id = ?', id));
    if (!comment) fail(404, 'Commentaire introuvable.');
    if (comment.user_id !== req.user.id && !req.user.is_admin) fail(403, 'Action non autorisée.');
    await db.run('DELETE FROM comments WHERE id = ?', comment.id);
    res.json({ ok: true });
  });

  return r;
};
