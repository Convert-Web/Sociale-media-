'use strict';
// Envoi d'une vidéo en plusieurs morceaux : ouverture, morceaux de 1 Mo, finalisation.
const express = require('express');
const { requireMember } = require('../auth');
const { fail, intParam } = require('../http');
const { single, saveImage } = require('../uploads');
const V = require('../videos');
const { POST_SELECT, NOT_BLOCKED, VISIBLE_POST, serializePost } = require('../social');

module.exports = function videoRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;
  r.use('/videos', requireMember);

  // Fil des vidéos (lecture plein écran, glisser pour la suivante)
  r.get('/videos/feed', async (req, res) => {
    const before = intParam(req.query.before);
    if (!before) await V.purgeExpired(ctx);
    const limit = 8;
    const rows = await db.all(
      `${POST_SELECT} WHERE p.video_id IS NOT NULL AND p.created_at > ? AND (? IS NULL OR p.id < ?) AND ${NOT_BLOCKED} AND ${VISIBLE_POST}
       ORDER BY p.id DESC LIMIT ?`,
      req.user.id, Date.now() - config.videoTtlHours * 3600 * 1000, before, before, limit,
    );
    res.json({ posts: rows.map((row) => serializePost(ctx, row, req.user)), hasMore: rows.length === limit });
  });

  // 1. Ouverture : taille, durée, format, et image d'aperçu
  r.post('/videos', single('poster'), async (req, res) => {
    const b = req.body || {};
    const mime = String(b.mime || '').split(';')[0].trim().toLowerCase();
    const size = Number(b.size);
    const duration = Number(b.duration);
    const width = Math.round(Number(b.width)) || null;
    const height = Math.round(Number(b.height)) || null;
    if (!V.TYPES[mime]) fail(400, 'Format de vidéo non pris en charge (MP4, MOV ou WebM).');
    if (!Number.isSafeInteger(size) || size < 1000) fail(400, 'Vidéo invalide.');
    if (size > V.MAX_BYTES) fail(413, 'Vidéo trop lourde (40 Mo maximum).');
    if (!Number.isFinite(duration) || duration <= 0) fail(400, 'Durée de la vidéo illisible.');
    if (duration > V.MAX_SECONDS) fail(400, 'Vidéo trop longue : une minute au maximum.');
    await V.cleanup(ctx);
    const { n } = await db.get('SELECT COUNT(*) AS n FROM videos WHERE owner_id = ? AND created_at > ?', req.user.id, Date.now() - 24 * 3600 * 1000);
    if (n >= V.PER_DAY) fail(429, 'Vous avez envoyé beaucoup de vidéos aujourd’hui. Réessayez demain.');
    if ((await V.storageUsed(ctx)) + size > config.videoStorageBytes) {
      const { sendPush } = require('../push');
      for (const a of await db.all('SELECT id FROM users WHERE is_admin = 1 AND paid_at IS NOT NULL')) {
        sendPush(ctx, a.id, { title: 'Espace vidéo plein', body: 'Supprimez d’anciennes vidéos ou augmentez VIDEO_STORAGE_MB.', url: '/admin', tag: 'video-storage' }).catch(() => {});
      }
      fail(409, 'L’espace vidéo du cercle est plein pour le moment. La Direction a été prévenue.', 'VIDEO_STORAGE_FULL');
    }
    const poster = req.file ? await saveImage(ctx, req.file) : null;
    const id = V.newId();
    const chunks = Math.ceil(size / V.CHUNK);
    await db.run(
      `INSERT INTO videos (id, owner_id, mime, size, duration, width, height, poster, chunks, complete, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      id, req.user.id, mime, size, duration, width, height, poster, chunks, Date.now(),
    );
    res.status(201).json({ id, chunkSize: V.CHUNK, chunks });
  });

  // 2. Morceaux (corps binaire brut, 1 Mo chacun)
  r.put('/videos/:id/chunks/:idx', express.raw({ type: () => true, limit: V.CHUNK + 1024 }), async (req, res) => {
    const idx = Number(req.params.idx);
    const v = await db.get('SELECT * FROM videos WHERE id = ? AND owner_id = ?', String(req.params.id), req.user.id);
    if (!v || v.complete) fail(404, 'Envoi introuvable.');
    if (!Number.isInteger(idx) || idx < 0 || idx >= v.chunks) fail(400, 'Morceau invalide.');
    const expected = idx === v.chunks - 1 ? v.size - idx * V.CHUNK : V.CHUNK;
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (data.length !== expected) fail(400, 'Morceau incomplet : renvoyez-le.');
    if (idx === 0 && !V.looksLikeVideo(data)) fail(400, 'Ce fichier n’est pas une vidéo lisible.');
    await db.run('INSERT OR REPLACE INTO video_chunks (video_id, idx, data) VALUES (?, ?, ?)', v.id, idx, data);
    res.json({ ok: true });
  });

  // 3. Finalisation : tous les morceaux sont arrivés
  r.post('/videos/:id/complete', async (req, res) => {
    const v = await db.get('SELECT * FROM videos WHERE id = ? AND owner_id = ?', String(req.params.id), req.user.id);
    if (!v) fail(404, 'Envoi introuvable.');
    const { n } = await db.get('SELECT COUNT(*) AS n FROM video_chunks WHERE video_id = ?', v.id);
    if (n !== v.chunks) fail(409, 'Envoi incomplet : la vidéo n’a pas été entièrement reçue.');
    await db.run('UPDATE videos SET complete = 1 WHERE id = ?', v.id);
    res.json({ video: { id: v.id, url: V.videoUrl(v.id, V.TYPES[v.mime]), poster: v.poster, width: v.width, height: v.height, duration: v.duration } });
  });

  // Annuler un envoi (avant publication)
  r.delete('/videos/:id', async (req, res) => {
    const v = await db.get(
      `SELECT id FROM videos WHERE id = ? AND owner_id = ?
         AND id NOT IN (SELECT video_id FROM posts WHERE video_id IS NOT NULL)
         AND id NOT IN (SELECT video_id FROM stories WHERE video_id IS NOT NULL)`,
      String(req.params.id), req.user.id,
    );
    if (v) await V.removeVideo(ctx, v.id);
    res.json({ ok: true });
  });

  return r;
};

// Vidéo jointe à une publication : vérifiée (auteur, envoi terminé, pas déjà publiée)
module.exports.attachVideo = async function attachVideo(ctx, user, id) {
  if (!id) return null;
  const v = await ctx.db.get(
    `SELECT * FROM videos WHERE id = ? AND owner_id = ? AND complete = 1
       AND id NOT IN (SELECT video_id FROM posts WHERE video_id IS NOT NULL)
       AND id NOT IN (SELECT video_id FROM stories WHERE video_id IS NOT NULL)`,
    String(id), user.id,
  );
  if (!v) fail(400, 'La vidéo n’a pas été entièrement envoyée. Réessayez.');
  return v;
};
