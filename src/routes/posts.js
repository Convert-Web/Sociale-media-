'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { deletePost } = require('../membership');
const { fail, text, intParam } = require('../http');
const { moderate, autoReport } = require('../contentFilter');
const { attachVideo } = require('./videos');
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
    // Vidéo éphémère expirée : elle a disparu, même avant le ménage automatique
    if (post.video_id && post.created_at <= Date.now() - ctx.config.videoTtlHours * 3600 * 1000) fail(404, 'Cette vidéo éphémère a disparu.');
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
    // Avant-premières arrivées à échéance : publiées pour tous, en tête du fil
    if (!intParam(req.query.before)) {
      await require('../founders').releaseDue(ctx);
      await require('../videos').purgeExpired(ctx);
    }
    const before = intParam(req.query.before);
    const limit = Math.min(intParam(req.query.limit) || 15, 50);
    const scope = req.query.scope === 'following' ? 'following' : 'all';
    const me = req.user.id;
    const live = Date.now() - ctx.config.videoTtlHours * 3600 * 1000; // vidéos éphémères encore visibles
    const rows =
      scope === 'following'
        ? await db.all(
            `${POST_SELECT}
             WHERE (? IS NULL OR p.id < ?) AND ${NOT_BLOCKED} AND ${PUBLIC_POST} AND (p.video_id IS NULL OR p.created_at > ?)
               AND (p.user_id = v.id OR p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = v.id))
             ORDER BY p.id DESC LIMIT ?`,
            me, before, before, live, limit,
          )
        : await db.all(
            `${POST_SELECT}
             WHERE (? IS NULL OR p.id < ?) AND u.paid_at IS NOT NULL AND ${NOT_BLOCKED} AND ${PUBLIC_POST} AND (p.video_id IS NULL OR p.created_at > ?)
             ORDER BY p.id DESC LIMIT ?`,
            me, before, before, live, limit,
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
    // Vidéo déjà envoyée en morceaux (voir routes/videos.js) : une par publication, sans photo
    const video = await attachVideo(ctx, req.user, req.body?.video);
    if (video && files.length) fail(400, 'Une publication contient soit des photos, soit une vidéo.');
    if (!body && !files.length && !video) fail(400, 'Votre publication est vide.');
    // Filtre automatique : propos haineux ou menaces refusés, insultes masquées et signalées
    const flagged = moderate(body);
    const urls = [];
    for (const f of files) urls.push(await saveImage(ctx, f));
    // La première photo (ou l'aperçu de la vidéo) reste dans posts.image, les suivantes dans post_media.
    const { lastInsertRowid } = await db.run(
      'INSERT INTO posts (user_id, body, image, video_id, flagged, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      req.user.id, body, video ? video.poster : urls[0] || null, video ? video.id : null, flagged, Date.now(),
    );
    await autoReport(ctx, 'post', lastInsertRowid, flagged);
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
    if (!body && !post.image && !post.video_id) fail(400, 'Votre publication est vide.');
    const flagged = moderate(body);
    await db.run('UPDATE posts SET body = ?, flagged = ?, edited_at = ? WHERE id = ?', body, flagged, Date.now(), post.id);
    await autoReport(ctx, 'post', post.id, flagged);
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
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at, u.is_bot, l.reaction
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
    const flagged = moderate(body);
    const { lastInsertRowid } = await db.run(
      'INSERT INTO comments (post_id, user_id, body, flagged, created_at) VALUES (?, ?, ?, ?, ?)',
      post.id, req.user.id, body, flagged, Date.now(),
    );
    await autoReport(ctx, 'comment', lastInsertRowid, flagged);
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
