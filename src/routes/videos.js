'use strict';
// Envoi d'une vidéo en plusieurs morceaux : ouverture, morceaux de 1 Mo, finalisation.
const express = require('express');
const { requireAuth } = require('../auth');
const { fail } = require('../http');
const { single, saveImage } = require('../uploads');
const V = require('../videos');

module.exports = function videoRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;
  r.use('/videos', requireAuth);

  // Espace vidéo plein : l'administration est prévenue, l'envoi est refusé
  async function storageFull() {
    const { sendPush } = require('../push');
    for (const a of await db.all('SELECT id FROM users WHERE is_admin = 1')) {
      sendPush(ctx, a.id, { title: 'Espace vidéo plein', body: 'Supprime d’anciennes vidéos ou augmente VIDEO_STORAGE_MB.', url: '/admin', tag: 'video-storage' }).catch(() => {});
    }
    fail(409, 'L’espace vidéo est plein pour le moment. L’administration a été prévenue.', 'VIDEO_STORAGE_FULL');
  }

  // 1. Ouverture : taille, durée, format, et image d'aperçu
  r.post('/videos', single('poster'), async (req, res) => {
    const b = req.body || {};
    const mime = String(b.mime || '').split(';')[0].trim().toLowerCase();
    // Envoi pendant la préparation : la taille finale n'est connue qu'à la fin. L'espace est réservé
    // d'après l'estimation (au moins 1 Mo), puis vérifié à nouveau avec la taille réelle.
    const streaming = ['1', 'true'].includes(String(b.streaming));
    const max = V.maxBytes(ctx);
    const size = streaming ? Math.round(Math.min(Math.max(Number(b.estimate) || max / 2, V.CHUNK), max)) : Number(b.size);
    const duration = Number(b.duration);
    const width = Math.round(Number(b.width)) || null;
    const height = Math.round(Number(b.height)) || null;
    if (!V.TYPES[mime]) fail(400, 'Format de vidéo non pris en charge (MP4, MOV ou WebM).');
    if (!Number.isSafeInteger(size) || size < 1000) fail(400, 'Vidéo invalide.');
    if (size > max) fail(413, `Vidéo trop lourde : ${Math.round(max / 1048576)} Mo maximum.`);
    if (!Number.isFinite(duration) || duration <= 0) fail(400, 'Durée de la vidéo illisible.');
    if (duration > config.videoMaxSeconds + 1) fail(400, `Vidéo trop longue : ${Math.round(config.videoMaxSeconds / 60)} min au maximum.`);
    await V.cleanup(ctx);
    const { n } = await db.get('SELECT COUNT(*) AS n FROM videos WHERE owner_id = ? AND created_at > ?', req.user.id, Date.now() - 24 * 3600 * 1000);
    if (n >= V.PER_DAY && !req.user.is_admin) fail(429, 'Tu as envoyé beaucoup de vidéos aujourd’hui. Réessaie demain.');
    if ((await V.storageUsed(ctx)) + size > config.videoStorageBytes) await storageFull();
    const poster = req.file ? await saveImage(ctx, req.file) : null;
    const id = V.newId();
    // En envoi pendant la préparation : 0 morceau annoncé (taille fixée à la finalisation) ;
    // la taille notée d'ici là est la place réservée, comptée dans l'espace occupé
    const chunks = streaming ? 0 : Math.ceil(size / V.CHUNK);
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
    const streaming = v.chunks === 0;
    const last = streaming ? Math.ceil(V.maxBytes(ctx) / V.CHUNK) : v.chunks;
    if (!Number.isInteger(idx) || idx < 0 || idx >= last) fail(400, 'Morceau invalide.');
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (streaming) {
      // Taille vérifiée à la finalisation (tous les morceaux font 1 Mo, sauf le dernier)
      if (data.length < 1 || data.length > V.CHUNK) fail(400, 'Morceau incomplet : renvoie-le.');
    } else {
      const expected = idx === v.chunks - 1 ? v.size - idx * V.CHUNK : V.CHUNK;
      if (data.length !== expected) fail(400, 'Morceau incomplet : renvoie-le.');
    }
    if (idx === 0 && !V.looksLikeVideo(data)) fail(400, 'Ce fichier n’est pas une vidéo lisible.');
    await db.run('INSERT OR REPLACE INTO video_chunks (video_id, idx, data) VALUES (?, ?, ?)', v.id, idx, data);
    res.json({ ok: true });
  });

  // 3. Finalisation : tous les morceaux sont arrivés
  r.post('/videos/:id/complete', async (req, res) => {
    const v = await db.get('SELECT * FROM videos WHERE id = ? AND owner_id = ?', String(req.params.id), req.user.id);
    if (!v) fail(404, 'Envoi introuvable.');
    if (v.chunks === 0) {
      // Envoi pendant la préparation : la taille finale arrive maintenant, tout est vérifié
      const size = Number(req.body?.size);
      if (!Number.isSafeInteger(size) || size < 1000) fail(400, 'Vidéo invalide.');
      if (size > V.maxBytes(ctx)) fail(413, `Vidéo trop lourde : ${Math.round(V.maxBytes(ctx) / 1048576)} Mo maximum.`);
      const chunks = Math.ceil(size / V.CHUNK);
      const got = await db.get(
        'SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes, MAX(idx) AS last, SUM(CASE WHEN idx < ? AND LENGTH(data) != ? THEN 1 ELSE 0 END) AS short FROM video_chunks WHERE video_id = ?',
        chunks - 1, V.CHUNK, v.id,
      );
      if (got.n !== chunks || got.bytes !== size || got.last !== chunks - 1 || got.short) fail(409, 'Envoi incomplet : la vidéo n’a pas été entièrement reçue.');
      // Espace du cercle : vérifié avec la taille réelle (la place réservée par cette vidéo est déduite)
      if ((await V.storageUsed(ctx)) - v.size + size > config.videoStorageBytes) {
        await V.removeVideo(ctx, v.id);
        await storageFull();
      }
      await db.run('UPDATE videos SET size = ?, chunks = ?, complete = 1 WHERE id = ?', size, chunks, v.id);
      v.size = size;
    } else {
      const { n } = await db.get('SELECT COUNT(*) AS n FROM video_chunks WHERE video_id = ?', v.id);
      if (n !== v.chunks) fail(409, 'Envoi incomplet : la vidéo n’a pas été entièrement reçue.');
      await db.run('UPDATE videos SET complete = 1 WHERE id = ?', v.id);
    }
    // Fiche technique envoyée par le téléphone (méthode, format d'origine, contrôle) : diagnostic
    const meta = req.body?.meta && typeof req.body.meta === 'object' ? JSON.stringify(req.body.meta).slice(0, 3000) : null;
    if (meta) await db.run('UPDATE videos SET meta = ? WHERE id = ?', meta, v.id);
    res.json({ video: { id: v.id, url: V.videoUrl(v.id, V.TYPES[v.mime]), poster: v.poster, width: v.width, height: v.height, duration: v.duration, size: v.size } });
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
  if (!v) fail(400, 'La vidéo n’a pas été entièrement envoyée. Réessaie.');
  return v;
};
