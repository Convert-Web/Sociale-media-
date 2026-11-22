'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { fail, text, intParam, flag } = require('../http');
const { throttle } = require('../antispam');
const { moderate, autoReport } = require('../contentFilter');
const { single, saveImage, deleteUpload, deleteUploads } = require('../uploads');
const { getPost, notify, retractNotification, notifyMentions, isBlocked } = require('../social');
const { deletePost } = require('../accounts');
const { extractTags } = require('../tags');
const { learn, SIGNALS } = require('../feed');
const { attachVideo } = require('./videos');
const { CATEGORY_IDS } = require('../catalog');
const { dayOf } = require('../analytics');

// Filtres (appliqués à la lecture, la vidéo d'origine n'est jamais recompressée)
const FILTERS = ['vif', 'chaud', 'froid', 'noir', 'vintage', 'reve', 'neon', 'sepia', 'contraste', 'pastel', 'nuit', 'doux'];
// Fonds des publications « texte »
const BACKGROUNDS = ['violet', 'rose', 'ocean', 'soleil', 'menthe', 'nuit', 'feu', 'ciel'];
const PRIVACY = ['public', 'friends', 'private'];
const MAX_IMAGES = 20;

const num = (v, min, max, d) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d);

// Effets de la vidéo : filtre, textes et autocollants posés par-dessus (positions de 0 à 1)
function cleanFx(raw) {
  if (!raw) return null;
  let fx = raw;
  if (typeof raw === 'string') {
    try {
      fx = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!fx || typeof fx !== 'object') return null;
  const out = {};
  if (FILTERS.includes(fx.filter)) out.filter = fx.filter;
  if (Array.isArray(fx.overlays)) {
    const list = [];
    for (const o of fx.overlays.slice(0, 12)) {
      if (!o || typeof o !== 'object') continue;
      const base = { x: num(o.x, 0, 1, 0.5), y: num(o.y, 0, 1, 0.5), rot: num(o.rot, -180, 180, 0) };
      if (o.kind === 'sticker' && typeof o.emoji === 'string' && o.emoji.trim()) {
        list.push({ kind: 'sticker', emoji: o.emoji.trim().slice(0, 16), size: num(o.size, 0.04, 0.6, 0.16), ...base });
      } else if (o.kind === 'text' && typeof o.text === 'string' && o.text.trim()) {
        list.push({
          kind: 'text',
          text: o.text.trim().slice(0, 150),
          size: num(o.size, 0.03, 0.2, 0.065),
          color: /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#ffffff',
          style: ['plain', 'box', 'outline'].includes(o.style) ? o.style : 'plain',
          ...base,
        });
      }
    }
    if (list.length) out.overlays = list;
  }
  return Object.keys(out).length ? out : null;
}

module.exports = function postRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;

  async function loadVisible(req) {
    const id = intParam(req.params.id);
    const post = id && (await getPost(ctx, id, req.user));
    if (!post) fail(404, 'Cette vidéo n’est pas disponible.');
    return post;
  }

  // Photo envoyée seule (publication « photos » en plusieurs envois : limite de 4,5 Mo par requête)
  r.post('/media', requireAuth, single('image'), async (req, res) => {
    if (!req.file) fail(400, 'Aucune image reçue.');
    const url = await saveImage(ctx, req.file);
    await db.run('UPDATE media SET owner_id = ? WHERE id = ?', req.user.id, url.split('/').pop().split('.')[0]);
    res.status(201).json({ url });
  });

  // Images envoyées par ce compte, pas encore utilisées
  async function ownImages(user, urls) {
    const out = [];
    for (const url of urls) {
      const m = typeof url === 'string' && /^\/media\/([a-f0-9]{32})\.(jpg|png|gif|webp)$/.exec(url);
      if (!m) fail(400, 'Photo invalide.');
      const row = await db.get('SELECT owner_id FROM media WHERE id = ?', m[1]);
      if (!row || row.owner_id !== user.id) fail(400, 'Photo introuvable : envoie-la à nouveau.');
      out.push(url);
    }
    return out;
  }

  // Publier : vidéo (envoyée en morceaux auparavant), photos, ou texte sur fond coloré
  r.post('/posts', requireAuth, async (req, res) => {
    const b = req.body || {};
    const body = text(b.body, { field: 'Description', max: 2200 });
    await throttle(ctx, req.user, 'post');
    const images = Array.isArray(b.images) ? await ownImages(req.user, b.images.slice(0, MAX_IMAGES)) : [];
    const video = b.videoId ? await attachVideo(ctx, req.user, b.videoId) : null;
    const bg = !video && !images.length ? (BACKGROUNDS.includes(b.bg) ? b.bg : null) : null;
    if (!video && !images.length && !bg) fail(400, 'Ajoute une vidéo, des photos ou un texte.');
    if (bg && !body) fail(400, 'Écris quelque chose pour ta publication texte.');
    if (video && video.duration > ctx.config.videoMaxSeconds + 1) fail(400, `Vidéo trop longue : ${Math.round(ctx.config.videoMaxSeconds / 60)} min au maximum.`);
    const privacy = PRIVACY.includes(b.privacy) ? b.privacy : 'public';
    const category = CATEGORY_IDS.has(b.category) ? b.category : null;
    const fx = cleanFx(b.fx);
    const flagged = moderate(body, ...(fx?.overlays || []).filter((o) => o.kind === 'text').map((o) => o.text));

    // Son : un son existant (« Utiliser ce son ») ou le son original de la vidéo
    let soundId = null;
    if (video && b.soundId) {
      const s = await db.get('SELECT id FROM sounds WHERE id = ? AND video_id IS NOT NULL', intParam(b.soundId));
      if (!s) fail(400, 'Ce son n’est plus disponible.');
      soundId = s.id;
    }
    // Duo ou Stitch : la vidéo d'origine doit l'autoriser
    let duetOf = null;
    let stitchOf = null;
    for (const key of ['duetOf', 'stitchOf']) {
      if (!b[key] || !video) continue;
      const src = await getPost(ctx, intParam(b[key]), req.user, { admin: false });
      if (!src?.video) fail(400, 'La vidéo d’origine n’est plus disponible.');
      if (key === 'duetOf' ? !src.allowDuet : !src.allowStitch) fail(403, key === 'duetOf' ? 'Cette vidéo n’autorise pas les Duos.' : 'Cette vidéo n’autorise pas les Stitchs.');
      if (key === 'duetOf') duetOf = src.id;
      else stitchOf = src.id;
    }
    // Couverture choisie (image envoyée avant)
    let cover = video?.poster || null;
    if (video && b.cover) {
      cover = (await ownImages(req.user, [b.cover]))[0];
      if (video.poster && video.poster !== cover) await deleteUploads(ctx, [video.poster]);
    }

    const now = Date.now();
    const postId = await db.transaction(async (t) => {
      const { lastInsertRowid: id } = await t.run(
        `INSERT INTO posts (user_id, body, image, video_id, created_at, flagged, privacy, allow_comments, allow_duet, allow_stitch, allow_download,
                            category, fx, bg, duet_of, stitch_of, sound_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.user.id, body, video ? cover : images[0] || null, video?.id || null, now, flagged, privacy,
        flag(b.allowComments) ? 1 : 0, flag(b.allowDuet) ? 1 : 0, flag(b.allowStitch) ? 1 : 0, flag(b.allowDownload) ? 1 : 0,
        category, fx ? JSON.stringify(fx) : null, bg, duetOf, stitchOf, soundId,
      );
      for (let i = 1; i < images.length; i++) await t.run('INSERT INTO post_media (post_id, url, position) VALUES (?, ?, ?)', id, images[i], i);
      for (const tag of extractTags(body)) await t.run('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)', id, tag);
      if (video && !soundId) {
        const { lastInsertRowid: sid } = await t.run(
          'INSERT INTO sounds (title, author_id, post_id, video_id, duration, cover, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          `son original - ${req.user.display_name}`, req.user.id, id, video.id, video.duration, cover, now,
        );
        await t.run('UPDATE posts SET sound_id = ? WHERE id = ?', sid, id);
      }
      if (images.length) await t.run(`UPDATE media SET owner_id = NULL WHERE id IN (${images.map(() => '?').join(',')})`, ...images.map((u) => u.split('/').pop().split('.')[0]));
      return id;
    });
    await autoReport(ctx, 'post', postId, flagged);
    if (privacy !== 'private') {
      await notifyMentions(ctx, body, req.user.id, { postId });
      const src = duetOf || stitchOf;
      if (src) {
        const owner = await db.get('SELECT user_id FROM posts WHERE id = ?', src);
        if (owner) await notify(ctx, { userId: owner.user_id, actorId: req.user.id, type: duetOf ? 'duet' : 'stitch', postId });
      }
    }
    res.status(201).json({ post: await getPost(ctx, postId, req.user) });
  });

  r.get('/posts/:id', async (req, res) => {
    res.json({ post: await loadVisible(req) });
  });

  // Modifier : description, confidentialité, autorisations, catégorie
  r.patch('/posts/:id', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    if (!post.mine) fail(403, 'Seul son auteur peut modifier cette publication.');
    const b = req.body || {};
    const body = b.body !== undefined ? text(b.body, { field: 'Description', max: 2200 }) : post.body;
    if (post.kind === 'text' && !body) fail(400, 'Écris quelque chose pour ta publication texte.');
    const flagged = moderate(body);
    const privacy = b.privacy !== undefined ? (PRIVACY.includes(b.privacy) ? b.privacy : fail(400, 'Confidentialité invalide.')) : post.privacy;
    const category = b.category !== undefined ? (CATEGORY_IDS.has(b.category) ? b.category : null) : post.category;
    const bool = (key, cur) => (b[key] !== undefined ? (flag(b[key]) ? 1 : 0) : cur ? 1 : 0);
    await db.run(
      `UPDATE posts SET body = ?, flagged = ?, privacy = ?, category = ?, allow_comments = ?, allow_duet = ?, allow_stitch = ?, allow_download = ?,
                        edited_at = CASE WHEN body != ? THEN ? ELSE edited_at END WHERE id = ?`,
      body, flagged, privacy, category, bool('allowComments', post.allowComments), bool('allowDuet', post.allowDuet), bool('allowStitch', post.allowStitch),
      bool('allowDownload', post.allowDownload), body, Date.now(), post.id,
    );
    await db.run('DELETE FROM post_tags WHERE post_id = ?', post.id);
    for (const tag of extractTags(body)) await db.run('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)', post.id, tag);
    await autoReport(ctx, 'post', post.id, flagged);
    res.json({ post: await getPost(ctx, post.id, req.user) });
  });

  r.delete('/posts/:id', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    if (!post.canDelete) fail(403, 'Tu ne peux pas supprimer cette publication.');
    await deleteUploads(ctx, await deletePost(ctx, post.id));
    res.json({ ok: true });
  });

  // J'aime
  r.post('/posts/:id/like', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    if (await isBlocked(ctx, req.user.id, post.author.id)) fail(403, 'Action impossible.');
    const { changes } = await db.run('INSERT OR IGNORE INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)', req.user.id, post.id, Date.now());
    if (changes) {
      await notify(ctx, { userId: post.author.id, actorId: req.user.id, type: 'like', postId: post.id });
      await learn(ctx, req.user.id, post.id, SIGNALS.like);
    }
    const { n } = await db.get('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', post.id);
    res.json({ liked: true, likeCount: n });
  });

  r.delete('/posts/:id/like', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    const { changes } = await db.run('DELETE FROM likes WHERE user_id = ? AND post_id = ?', req.user.id, post.id);
    if (changes) {
      await retractNotification(ctx, { userId: post.author.id, actorId: req.user.id, type: 'like', postId: post.id });
      await learn(ctx, req.user.id, post.id, SIGNALS.unlike);
    }
    const { n } = await db.get('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', post.id);
    res.json({ liked: false, likeCount: n });
  });

  // Favoris
  r.post('/posts/:id/favorite', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    const { changes } = await db.run('INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)', req.user.id, post.id, Date.now());
    if (changes) {
      await notify(ctx, { userId: post.author.id, actorId: req.user.id, type: 'favorite', postId: post.id });
      await learn(ctx, req.user.id, post.id, SIGNALS.favorite);
    }
    const { n } = await db.get('SELECT COUNT(*) AS n FROM bookmarks WHERE post_id = ?', post.id);
    res.json({ saved: true, saveCount: n });
  });

  r.delete('/posts/:id/favorite', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    await db.run('DELETE FROM bookmarks WHERE user_id = ? AND post_id = ?', req.user.id, post.id);
    await retractNotification(ctx, { userId: post.author.id, actorId: req.user.id, type: 'favorite', postId: post.id });
    const { n } = await db.get('SELECT COUNT(*) AS n FROM bookmarks WHERE post_id = ?', post.id);
    res.json({ saved: false, saveCount: n });
  });

  // Republier (visible dans « Abonnements » de ses abonnés et sur son profil)
  r.post('/posts/:id/repost', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    if (post.mine) fail(400, 'Tu ne peux pas republier ta propre vidéo.');
    if (post.privacy !== 'public' || post.author.private) fail(403, 'Cette vidéo ne peut pas être republiée.');
    const { changes } = await db.run('INSERT OR IGNORE INTO reposts (user_id, post_id, created_at) VALUES (?, ?, ?)', req.user.id, post.id, Date.now());
    if (changes) {
      await notify(ctx, { userId: post.author.id, actorId: req.user.id, type: 'repost', postId: post.id });
      await learn(ctx, req.user.id, post.id, SIGNALS.repost);
    }
    const { n } = await db.get('SELECT COUNT(*) AS n FROM reposts WHERE post_id = ?', post.id);
    res.json({ reposted: true, repostCount: n });
  });

  r.delete('/posts/:id/repost', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    await db.run('DELETE FROM reposts WHERE user_id = ? AND post_id = ?', req.user.id, post.id);
    await retractNotification(ctx, { userId: post.author.id, actorId: req.user.id, type: 'repost', postId: post.id });
    const { n } = await db.get('SELECT COUNT(*) AS n FROM reposts WHERE post_id = ?', post.id);
    res.json({ reposted: false, repostCount: n });
  });

  // Une lecture (comptée après une seconde à l'écran ; chaque nouvelle lecture compte, comme une vue)
  r.post('/posts/:id/view', async (req, res) => {
    const id = intParam(req.params.id);
    const post = id && (await db.get('SELECT id, user_id FROM posts WHERE id = ?', id));
    if (!post) fail(404, 'Vidéo introuvable.');
    const now = Date.now();
    if (req.user) {
      await db.run(
        `INSERT INTO video_views (post_id, user_id, created_at, plays, updated_at) VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(post_id, user_id) DO UPDATE SET plays = plays + 1, updated_at = excluded.updated_at`,
        id, req.user.id, now, now,
      );
    } else {
      await db.run('UPDATE posts SET guest_views = guest_views + 1 WHERE id = ?', id);
    }
    await db.run(
      'INSERT INTO view_days (post_id, day, plays) VALUES (?, ?, 1) ON CONFLICT(post_id, day) DO UPDATE SET plays = plays + 1',
      id, dayOf(now),
    );
    const { views } = await db.get('SELECT (SELECT COALESCE(SUM(plays), 0) FROM video_views WHERE post_id = ?) + guest_views AS views FROM posts WHERE id = ?', id, id);
    res.json({ views });
  });

  // Temps regardé en quittant une vidéo : nourrit l'algorithme et les statistiques du créateur
  r.post('/posts/:id/watch', async (req, res) => {
    const id = intParam(req.params.id);
    const ms = Math.round(num(req.body?.ms, 0, 10 * 60 * 1000, 0));
    const ratio = num(req.body?.ratio, 0, 1, 0);
    const loops = Math.round(num(req.body?.loops, 0, 20, 0));
    const post = id && (await db.get('SELECT id, user_id FROM posts WHERE id = ?', id));
    if (!post) fail(404, 'Vidéo introuvable.');
    const now = Date.now();
    await db.run('INSERT INTO view_days (post_id, day, watch_ms) VALUES (?, ?, ?) ON CONFLICT(post_id, day) DO UPDATE SET watch_ms = watch_ms + excluded.watch_ms', id, dayOf(now), ms);
    if (req.user && req.user.id !== post.user_id) {
      await db.run(
        `INSERT INTO video_views (post_id, user_id, created_at, plays, watch_ms, ratio, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(post_id, user_id) DO UPDATE SET watch_ms = watch_ms + excluded.watch_ms, ratio = MAX(ratio, excluded.ratio),
           plays = plays + ?, updated_at = excluded.updated_at`,
        id, req.user.id, now, Math.max(1, loops), ms, Math.min(1, ratio + loops), now, loops,
      );
      if (loops > 0 || ratio >= 0.9) await learn(ctx, req.user.id, id, SIGNALS.completed + Math.min(3, loops) * 0.5);
      else if (ratio >= 0.5) await learn(ctx, req.user.id, id, SIGNALS.half);
      else if (ms < 1500 && ratio < 0.15) await learn(ctx, req.user.id, id, SIGNALS.skipped);
    }
    res.json({ ok: true });
  });

  // Partage (lien copié, application, message) : compté
  r.post('/posts/:id/share', async (req, res) => {
    const post = await loadVisible(req);
    await db.run('UPDATE posts SET share_count = share_count + 1 WHERE id = ?', post.id);
    if (req.user) await learn(ctx, req.user.id, post.id, SIGNALS.share);
    res.json({ shareCount: post.shareCount + 1 });
  });

  // « Pas intéressé » (ou masquer tout ce créateur)
  r.post('/posts/:id/not-interested', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    const author = flag(req.body?.author, false);
    await db.run(
      'INSERT OR IGNORE INTO not_interested (user_id, post_id, author_id, created_at) VALUES (?, ?, ?, ?)',
      req.user.id, author ? 0 : post.id, post.author.id, Date.now(),
    );
    await learn(ctx, req.user.id, post.id, author ? SIGNALS.notInterested * 1.5 : SIGNALS.notInterested);
    res.json({ ok: true });
  });

  // Épingler en haut de son profil (3 au plus)
  r.post('/posts/:id/pin', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    if (!post.mine) fail(403, 'Tu ne peux épingler que tes propres vidéos.');
    const { n } = await db.get('SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND pinned_at IS NOT NULL AND id != ?', req.user.id, post.id);
    if (n >= 3) fail(409, 'Tu peux épingler 3 publications au maximum. Désépingles-en une d’abord.');
    await db.run('UPDATE posts SET pinned_at = ? WHERE id = ?', Date.now(), post.id);
    res.json({ pinned: true });
  });

  r.delete('/posts/:id/pin', requireAuth, async (req, res) => {
    const post = await loadVisible(req);
    if (!post.mine) fail(403, 'Action impossible.');
    await db.run('UPDATE posts SET pinned_at = NULL WHERE id = ?', post.id);
    res.json({ pinned: false });
  });

  return r;
};

module.exports.cleanFx = cleanFx;
module.exports.FILTERS = FILTERS;
module.exports.BACKGROUNDS = BACKGROUNDS;
