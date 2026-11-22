'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { fail, text, intParam } = require('../http');
const { throttle } = require('../antispam');
const { assertClean } = require('../contentFilter');
const { single, saveImage, deleteUpload } = require('../uploads');
const { authorOf } = require('../social');
const V = require('../videos');
const { attachVideo } = require('./videos');

const DAY = 24 * 3600 * 1000;

module.exports = function storyRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/stories', requireAuth);

  // Suppression des stories expirées (au plus une fois toutes les 10 minutes)
  let lastCleanup = 0;
  async function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < 10 * 60 * 1000) return;
    lastCleanup = now;
    const old = await db.all('SELECT id, media, video_id FROM stories WHERE expires_at <= ?', now);
    for (const s of old) {
      await db.run('DELETE FROM story_views WHERE story_id = ?', s.id);
      await db.run('DELETE FROM stories WHERE id = ?', s.id);
      deleteUpload(ctx, s.media);
      await V.removeVideo(ctx, s.video_id); // story vidéo : effacée avec la story
    }
  }

  const loadStory = async (id) => {
    const storyId = intParam(id);
    const story = storyId && (await db.get('SELECT * FROM stories WHERE id = ? AND expires_at > ?', storyId, Date.now()));
    if (!story) fail(404, 'Cette story n’est plus disponible.');
    return story;
  };

  // Stories actives : les siennes et celles des comptes suivis (?user=nom : celles d'un seul compte),
  // regroupées par compte : les siennes, puis les non vues, puis les vues.
  r.get('/stories', async (req, res) => {
    await cleanup();
    const me = req.user.id;
    const one = typeof req.query.user === 'string' ? await db.get('SELECT id, private_account FROM users WHERE username = ?', req.query.user) : null;
    const scope = one
      ? 's.user_id = ? AND (s.user_id = ? OR u.private_account = 0 OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = s.user_id))'
      : '(s.user_id = ? OR s.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)) AND ? IS NOT NULL';
    const rows = await db.all(
      `SELECT s.id, s.user_id, s.media, s.caption, s.created_at, s.video_id,
              vid.mime AS v_mime, vid.duration AS v_duration, vid.width AS v_width, vid.height AS v_height, vid.size AS v_size,
              u.username, u.display_name, u.avatar, u.verified_at,
              EXISTS(SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.user_id = ?) AS viewed,
              (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id = s.id) AS views
       FROM stories s JOIN users u ON u.id = s.user_id
       LEFT JOIN videos vid ON vid.id = s.video_id
       WHERE s.expires_at > ? AND u.banned_at IS NULL AND ${scope}
         AND s.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)
       ORDER BY s.id ASC`,
      me, Date.now(), one ? one.id : me, me, me, me, me,
    );
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.user_id)) groups.set(row.user_id, { user: authorOf(row), mine: row.user_id === me, stories: [] });
      groups.get(row.user_id).stories.push({
        id: row.id,
        media: row.media,
        video: row.video_id
          ? { url: V.videoUrl(row.video_id, V.TYPES[row.v_mime] || 'mp4'), duration: row.v_duration || null, width: row.v_width || null, height: row.v_height || null, size: row.v_size || null }
          : null,
        caption: row.caption,
        createdAt: row.created_at,
        viewed: row.user_id === me || Boolean(row.viewed),
        views: row.user_id === me ? row.views : undefined,
      });
    }
    const list = [...groups.values()].map((g) => ({
      ...g,
      allViewed: g.stories.every((s) => s.viewed),
      latest: g.stories[g.stories.length - 1].createdAt,
    }));
    list.sort((a, b) => (b.mine - a.mine) || (a.allViewed - b.allViewed) || (b.latest - a.latest));
    res.json({ groups: list });
  });

  // Story photo (champ « image ») ou vidéo (« video » : identifiant d'une vidéo déjà envoyée)
  r.post('/stories', single('image'), async (req, res) => {
    await throttle(ctx, req.user, 'story');
    const video = await attachVideo(ctx, req.user, req.body?.video);
    if (!req.file && !video) fail(400, 'Ajoute une photo ou une vidéo à ta story.');
    const caption = text(req.body?.caption, { field: 'Légende', max: 200 });
    assertClean('Légende', caption);
    const media = video ? video.poster || '' : await saveImage(ctx, req.file);
    const now = Date.now();
    const { lastInsertRowid } = await db.run(
      'INSERT INTO stories (user_id, media, video_id, caption, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      req.user.id, media, video ? video.id : null, caption, now, now + DAY,
    );
    res.status(201).json({
      story: {
        id: lastInsertRowid,
        media,
        video: video ? { url: V.videoUrl(video.id, V.TYPES[video.mime]), duration: video.duration, width: video.width, height: video.height } : null,
        caption,
        createdAt: now,
        viewed: true,
        views: 0,
      },
    });
  });

  r.post('/stories/:id/view', async (req, res) => {
    const story = await loadStory(req.params.id);
    if (story.user_id !== req.user.id) {
      await db.run('INSERT OR IGNORE INTO story_views (story_id, user_id, viewed_at) VALUES (?, ?, ?)', story.id, req.user.id, Date.now());
    }
    res.json({ ok: true });
  });

  r.get('/stories/:id/viewers', async (req, res) => {
    const story = await loadStory(req.params.id);
    if (story.user_id !== req.user.id) fail(403, 'Seul l’auteur voit qui a regardé sa story.');
    const rows = await db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.verified_at, sv.viewed_at
       FROM story_views sv JOIN users u ON u.id = sv.user_id
       WHERE sv.story_id = ? ORDER BY sv.viewed_at DESC LIMIT 500`,
      story.id,
    );
    res.json({ users: rows.map((row) => ({ ...authorOf(row), viewedAt: row.viewed_at })) });
  });

  r.delete('/stories/:id', async (req, res) => {
    const story = await loadStory(req.params.id);
    if (story.user_id !== req.user.id && !req.user.is_admin) fail(403, 'Action non autorisée.');
    await db.run('DELETE FROM story_views WHERE story_id = ?', story.id);
    await db.run('DELETE FROM stories WHERE id = ?', story.id);
    deleteUpload(ctx, story.media);
    await V.removeVideo(ctx, story.video_id);
    res.json({ ok: true });
  });

  return r;
};
