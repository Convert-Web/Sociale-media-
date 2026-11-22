'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { fail, intParam } = require('../http');
const { USER_SELECT, serializeUser, POST_SELECT, serializePost, VISIBLE, VIEWER, BLOCKED_WITH, NOW_MS, authorOf } = require('../social');
const { normalizeTag } = require('../tags');
const { CATEGORY_IDS, CATEGORIES } = require('../catalog');
const V = require('../videos');

// Texte cherché, échappé pour LIKE
const like = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const prefix = (q) => `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
// Popularité d'une publication (pour les grilles : Explorer, hashtags, sons, recherche)
const POPULAR = `(like_count * 4 + comment_count * 6 + view_count + share_count * 8 + 1) * 1.0 / ((${NOW_MS} - p.created_at) / 3600000.0 + 48)`;
const PUBLIC_USER = 'u.banned_at IS NULL AND u.is_bot = 0';

function serializeSound(ctx, s) {
  return {
    id: s.id,
    title: s.title,
    author: s.username ? authorOf(s) : null,
    cover: s.cover || s.avatar || null,
    url: s.video_id && s.mime ? V.videoUrl(s.video_id, V.TYPES[s.mime] || 'mp4') : null,
    duration: s.duration || null,
    postId: s.post_id || null,
    uses: s.uses || 0,
    favorite: Boolean(s.favorite),
  };
}

const SOUND_SELECT = `
  SELECT s.*, u.id AS user_id, u.username, u.display_name, u.avatar, u.verified_at, vd.mime,
         (SELECT COUNT(*) FROM posts sp WHERE sp.sound_id = s.id AND sp.privacy = 'public') AS uses,
         EXISTS(SELECT 1 FROM sound_favorites sf WHERE sf.sound_id = s.id AND sf.user_id = v.id) AS favorite
  FROM ${VIEWER} CROSS JOIN sounds s
  LEFT JOIN users u ON u.id = s.author_id
  LEFT JOIN videos vd ON vd.id = s.video_id AND vd.complete = 1`;

module.exports = function discoverRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  const vid = (req) => req.user?.id || 0;
  const posts = (req, rows) => rows.map((row) => serializePost(ctx, row, req.user));

  async function trendingTags(limit = 12) {
    const q = (since) =>
      db.all(
        `SELECT t.tag, COUNT(*) AS posts,
                SUM((SELECT COALESCE(SUM(vv.plays), 0) FROM video_views vv WHERE vv.post_id = t.post_id) + p.guest_views) AS views
         FROM post_tags t JOIN posts p ON p.id = t.post_id JOIN users u ON u.id = p.user_id
         WHERE p.privacy = 'public' AND u.private_account = 0 AND ${PUBLIC_USER} AND p.created_at > ?
         GROUP BY t.tag ORDER BY posts DESC, views DESC LIMIT ?`,
        since, limit,
      );
    let rows = await q(Date.now() - 7 * 86400e3);
    if (rows.length < 4) rows = await q(0);
    return rows.map((t) => ({ tag: t.tag, posts: t.posts, views: t.views || 0 }));
  }

  // Explorer : hashtags du moment et vidéos populaires (filtrables par catégorie)
  r.get('/discover', async (req, res) => {
    const category = CATEGORY_IDS.has(req.query.category) ? req.query.category : null;
    const offset = Math.min(500, intParam(req.query.cursor) || 0);
    const limit = 18;
    const rows = await db.all(
      `SELECT * FROM (${POST_SELECT} WHERE (p.video_id IS NOT NULL OR p.image IS NOT NULL) AND p.privacy = 'public' AND (? IS NULL OR p.category = ?) AND ${VISIBLE})
       ORDER BY ${POPULAR.replace(/p\.created_at/g, 'created_at')} DESC, id DESC LIMIT ? OFFSET ?`,
      vid(req), category, category, limit, offset,
    );
    res.json({
      categories: CATEGORIES,
      tags: offset ? [] : await trendingTags(),
      posts: posts(req, rows),
      cursor: rows.length === limit ? offset + limit : null,
    });
  });

  r.get('/trending', async (_req, res) => res.json({ tags: await trendingTags(20) }));

  // Recherche : Top, Comptes, Vidéos, Sons, Hashtags, LIVE
  r.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const type = ['top', 'users', 'videos', 'sounds', 'tags', 'live'].includes(req.query.type) ? req.query.type : 'top';
    if (!q) return res.json({ users: [], posts: [], sounds: [], tags: [], lives: [] });
    const offset = Math.min(500, intParam(req.query.cursor) || 0);
    const tag = normalizeTag(q);
    const name = q.replace(/^@/, '');
    const out = {};

    if (type === 'top' || type === 'users') {
      const limit = type === 'top' ? 4 : 20;
      const rows = await db.all(
        `SELECT * FROM (${USER_SELECT} WHERE ${PUBLIC_USER} AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\') AND NOT ${BLOCKED_WITH('u.id')})
         ORDER BY (username = ?) DESC, (username LIKE ? ESCAPE '\\') DESC, followers_count DESC LIMIT ? OFFSET ?`,
        vid(req), like(name), like(q), name, prefix(name), limit, offset,
      );
      out.users = rows.map((row) => serializeUser(ctx, row, req.user));
      if (type === 'users') out.cursor = rows.length === limit ? offset + limit : null;
    }
    if (type === 'top' || type === 'videos') {
      const limit = type === 'top' ? 12 : 18;
      const rows = await db.all(
        `SELECT * FROM (${POST_SELECT} WHERE (p.video_id IS NOT NULL OR p.image IS NOT NULL)
           AND (p.body LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR s.title LIKE ? ESCAPE '\\'
                OR (? IS NOT NULL AND EXISTS (SELECT 1 FROM post_tags pt WHERE pt.post_id = p.id AND pt.tag LIKE ? ESCAPE '\\')))
           AND ${VISIBLE})
         ORDER BY ${POPULAR.replace(/p\.created_at/g, 'created_at')} DESC LIMIT ? OFFSET ?`,
        vid(req), like(q), like(name), like(q), like(q), tag, tag ? prefix(tag) : null, limit, offset,
      );
      out.posts = posts(req, rows);
      if (type === 'videos') out.cursor = rows.length === limit ? offset + limit : null;
    }
    if (type === 'top' || type === 'sounds') {
      const limit = type === 'top' ? 3 : 20;
      const rows = await db.all(
        `SELECT * FROM (${SOUND_SELECT} WHERE s.video_id IS NOT NULL AND (s.title LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\'))
         WHERE uses > 0 ORDER BY uses DESC, id DESC LIMIT ? OFFSET ?`,
        vid(req), like(q), like(q), like(name), limit, offset,
      );
      out.sounds = rows.map((s) => serializeSound(ctx, s));
      if (type === 'sounds') out.cursor = rows.length === limit ? offset + limit : null;
    }
    if (type === 'top' || type === 'tags') {
      const limit = type === 'top' ? 4 : 30;
      const rows = tag
        ? await db.all(
            `SELECT t.tag, COUNT(*) AS posts FROM post_tags t JOIN posts p ON p.id = t.post_id JOIN users u ON u.id = p.user_id
             WHERE t.tag LIKE ? ESCAPE '\\' AND p.privacy = 'public' AND u.private_account = 0 AND ${PUBLIC_USER}
             GROUP BY t.tag ORDER BY (t.tag = ?) DESC, posts DESC LIMIT ? OFFSET ?`,
            prefix(tag), tag, limit, offset,
          )
        : [];
      out.tags = rows.map((t) => ({ tag: t.tag, posts: t.posts }));
      if (type === 'tags') out.cursor = rows.length === limit ? offset + limit : null;
    }
    if (type === 'top' || type === 'live') {
      const rows = await db.all(
        `SELECT l.id, l.title, l.started_at, u.id AS user_id, u.username, u.display_name, u.avatar, u.verified_at,
                (SELECT COUNT(*) FROM live_viewers lw WHERE lw.live_id = l.id AND lw.last_seen > ${NOW_MS} - 25000) AS viewers
         FROM ${VIEWER} CROSS JOIN lives l JOIN users u ON u.id = l.user_id
         WHERE l.ended_at IS NULL AND l.last_beat > ${NOW_MS} - 45000 AND ${PUBLIC_USER} AND NOT ${BLOCKED_WITH('u.id')}
           AND (l.title LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')
         ORDER BY viewers DESC LIMIT 20`,
        vid(req), like(q), like(name), like(q),
      );
      out.lives = rows.map((l) => ({ id: l.id, title: l.title, startedAt: l.started_at, viewers: l.viewers, host: authorOf(l) }));
    }
    res.json(out);
  });

  // Suggestions pendant la saisie
  r.get('/search/suggest', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (!q) return res.json({ users: [], tags: [] });
    const name = q.replace(/^[@#]/, '');
    const users = await db.all(
      `SELECT * FROM (${USER_SELECT} WHERE ${PUBLIC_USER} AND (u.username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\') AND NOT ${BLOCKED_WITH('u.id')})
       ORDER BY is_following DESC, followers_count DESC LIMIT 6`,
      vid(req), prefix(name), like(name),
    );
    const tag = normalizeTag(name);
    const tags = tag
      ? await db.all('SELECT tag, COUNT(*) AS posts FROM post_tags WHERE tag LIKE ? ESCAPE \'\\\' GROUP BY tag ORDER BY posts DESC LIMIT 5', prefix(tag))
      : [];
    res.json({ users: users.map((row) => serializeUser(ctx, row, req.user)), tags: tags.map((t) => ({ tag: t.tag, posts: t.posts })) });
  });

  // Page d'un hashtag
  r.get('/tags/:tag', async (req, res) => {
    const tag = normalizeTag(req.params.tag);
    if (!tag) fail(404, 'Hashtag introuvable.');
    const stats = await db.get(
      `SELECT COUNT(*) AS posts, COALESCE(SUM((SELECT COALESCE(SUM(vv.plays), 0) FROM video_views vv WHERE vv.post_id = t.post_id) + p.guest_views), 0) AS views
       FROM post_tags t JOIN posts p ON p.id = t.post_id WHERE t.tag = ? AND p.privacy = 'public'`,
      tag,
    );
    res.json({ tag: { tag, posts: stats.posts, views: stats.views } });
  });

  r.get('/tags/:tag/posts', async (req, res) => {
    const tag = normalizeTag(req.params.tag);
    if (!tag) fail(404, 'Hashtag introuvable.');
    const offset = Math.min(1000, intParam(req.query.cursor) || 0);
    const limit = 18;
    const rows = await db.all(
      `SELECT * FROM (${POST_SELECT} WHERE p.id IN (SELECT post_id FROM post_tags WHERE tag = ?) AND ${VISIBLE})
       ORDER BY ${POPULAR.replace(/p\.created_at/g, 'created_at')} DESC, id DESC LIMIT ? OFFSET ?`,
      vid(req), tag, limit, offset,
    );
    res.json({ posts: posts(req, rows), cursor: rows.length === limit ? offset + limit : null });
  });

  // Bibliothèque de sons (pour créer) : populaires, favoris, ou recherche
  r.get('/sounds', async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 60);
    const tab = req.query.tab === 'favorites' ? 'favorites' : 'popular';
    if (tab === 'favorites' && !req.user) return res.json({ sounds: [] });
    const rows = await db.all(
      `SELECT * FROM (${SOUND_SELECT} WHERE s.video_id IS NOT NULL
         ${tab === 'favorites' ? 'AND s.id IN (SELECT sound_id FROM sound_favorites WHERE user_id = v.id)' : ''}
         ${q ? "AND (s.title LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')" : ''})
       WHERE mime IS NOT NULL ${tab === 'popular' ? 'AND uses > 0' : ''}
       ORDER BY ${tab === 'favorites' ? 'id DESC' : 'uses DESC, id DESC'} LIMIT 40`,
      vid(req), ...(q ? [like(q), like(q)] : []),
    );
    res.json({ sounds: rows.map((s) => serializeSound(ctx, s)) });
  });

  r.get('/sounds/:id', async (req, res) => {
    const row = await db.get(`${SOUND_SELECT} WHERE s.id = ?`, vid(req), intParam(req.params.id));
    if (!row) fail(404, 'Ce son est introuvable.');
    res.json({ sound: serializeSound(ctx, row) });
  });

  r.get('/sounds/:id/posts', async (req, res) => {
    const id = intParam(req.params.id);
    const offset = Math.min(1000, intParam(req.query.cursor) || 0);
    const limit = 18;
    const rows = await db.all(
      `SELECT * FROM (${POST_SELECT} WHERE p.sound_id = ? AND ${VISIBLE})
       ORDER BY (id = (SELECT post_id FROM sounds WHERE id = ?)) DESC, ${POPULAR.replace(/p\.created_at/g, 'created_at')} DESC LIMIT ? OFFSET ?`,
      vid(req), id, id, limit, offset,
    );
    res.json({ posts: posts(req, rows), cursor: rows.length === limit ? offset + limit : null });
  });

  r.post('/sounds/:id/favorite', requireAuth, async (req, res) => {
    const s = await db.get('SELECT id FROM sounds WHERE id = ?', intParam(req.params.id));
    if (!s) fail(404, 'Ce son est introuvable.');
    await db.run('INSERT OR IGNORE INTO sound_favorites (user_id, sound_id, created_at) VALUES (?, ?, ?)', req.user.id, s.id, Date.now());
    res.json({ favorite: true });
  });

  r.delete('/sounds/:id/favorite', requireAuth, async (req, res) => {
    await db.run('DELETE FROM sound_favorites WHERE user_id = ? AND sound_id = ?', req.user.id, intParam(req.params.id));
    res.json({ favorite: false });
  });

  return r;
};

module.exports.serializeSound = serializeSound;
