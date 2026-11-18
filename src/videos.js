'use strict';
// Vidéos des membres, compatibles avec un hébergement gratuit :
// - Vercel refuse les requêtes et réponses de plus de 4,5 Mo : la vidéo (déjà compressée
//   par le téléphone) est envoyée en morceaux de 1 Mo, et diffusée par plages d'octets
//   (« Range »), comme le demandent de toute façon Safari et Chrome pour lire une vidéo ;
// - les morceaux sont rangés dans la base (Turso), comme les photos ;
// - un plafond global protège l'espace gratuit de la base (VIDEO_STORAGE_MB).
const crypto = require('node:crypto');

const CHUNK = 1024 * 1024; // 1 Mo par morceau stocké
const MAX_BYTES = 40 * 1024 * 1024; // 40 Mo par vidéo (une minute bien compressée en pèse ~12)
const MAX_SECONDS = 61;
const RESPONSE_CAP = 3 * CHUNK; // 3 Mo par réponse au plus (limite de Vercel : 4,5 Mo)
const PER_DAY = 15; // vidéos envoyées par membre et par 24 h
const TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mp4', 'video/webm': 'webm' };

const newId = () => crypto.randomBytes(16).toString('hex');
const videoUrl = (id, ext) => `/media/v/${id}.${ext}`;
const idFromUrl = (url) => (typeof url === 'string' && /^\/media\/v\/([a-f0-9]{32})\.(mp4|webm)$/.exec(url)?.[1]) || null;

// Signature du fichier : MP4/QuickTime (« ftyp » à l'octet 4) ou WebM (en-tête EBML)
function looksLikeVideo(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return true;
  return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
}

// Place occupée par les vidéos terminées (octets)
async function storageUsed(ctx) {
  const { bytes } = await ctx.db.get('SELECT COALESCE(SUM(size), 0) AS bytes FROM videos');
  return bytes;
}

// Ménage : envois abandonnés (6 h) et vidéos jamais publiées (24 h)
async function cleanup(ctx) {
  const now = Date.now();
  const stale = await ctx.db.all(
    `SELECT id, poster FROM videos
     WHERE (complete = 0 AND created_at < ?)
        OR (complete = 1 AND created_at < ? AND id NOT IN (SELECT video_id FROM posts WHERE video_id IS NOT NULL)
            AND id NOT IN (SELECT video_id FROM stories WHERE video_id IS NOT NULL))
     LIMIT 50`,
    now - 6 * 3600 * 1000, now - 24 * 3600 * 1000,
  );
  for (const v of stale) await removeVideo(ctx, v.id);
}

async function removeVideo(ctx, id) {
  if (!id) return;
  if (ctx.videoCache) for (let i = 0; i < MAX_BYTES / CHUNK; i++) ctx.videoCache.delete(`${id}:${i}`);
  const row = await ctx.db.get('SELECT poster FROM videos WHERE id = ?', id);
  await ctx.db.run('DELETE FROM video_chunks WHERE video_id = ?', id);
  await ctx.db.run('DELETE FROM videos WHERE id = ?', id);
  if (row?.poster) require('./uploads').deleteUpload(ctx, row.poster);
}

// Vidéos éphémères : la publication et la vidéo sont effacées définitivement après
// config.videoTtlHours (24 h par défaut). Vérifié au plus une fois par minute, à l'ouverture
// du Salon, des profils, des groupes et du fil des vidéos.
const lastPurge = new WeakMap();
async function purgeExpired(ctx, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - (lastPurge.get(ctx.db) || 0) < 60 * 1000) return 0;
  lastPurge.set(ctx.db, now);
  const rows = await ctx.db.all(
    'SELECT id, image, video_id FROM posts WHERE video_id IS NOT NULL AND created_at < ? LIMIT 25',
    now - ctx.config.videoTtlHours * 3600 * 1000,
  );
  const { deletePost } = require('./membership');
  const { deleteUpload } = require('./uploads');
  for (const p of rows) {
    const media = await deletePost(ctx, p.id);
    await removeVideo(ctx, p.video_id); // morceaux, fiche et image d'aperçu
    for (const url of media) if (!idFromUrl(url)) deleteUpload(ctx, url);
  }
  await cleanup(ctx);
  return rows.length;
}

const expiresAt = (ctx, createdAt) => createdAt + ctx.config.videoTtlHours * 3600 * 1000;

// Diffusion par plages d'octets (lecture, avance rapide)
function videoHandler(ctx) {
  // Morceaux les plus regardés gardés en mémoire : démarrage plus rapide des vidéos
  const { MediaCache } = require('./uploads');
  const cache = new MediaCache(64 * 1024 * 1024);
  ctx.videoCache = cache;

  async function sendChunk(id, idx, req, res, next) {
    const v = await ctx.db.get(
      `SELECT v.chunks, p.created_at AS posted_at, s.expires_at AS story_expires
       FROM videos v LEFT JOIN posts p ON p.video_id = v.id LEFT JOIN stories s ON s.video_id = v.id
       WHERE v.id = ? AND v.complete = 1`,
      id,
    );
    if (!v || idx >= v.chunks) return next();
    // Fin de vie : 24 h après la publication (ou fin de la story) ; vidéo pas encore publiée : 1 h
    const end = v.posted_at ? expiresAt(ctx, v.posted_at) : v.story_expires || Date.now() + 3600 * 1000;
    if (end <= Date.now()) return next();
    const key = `${id}:${idx}`;
    let data = cache.get(key)?.data;
    if (!data) {
      const row = await ctx.db.get('SELECT data FROM video_chunks WHERE video_id = ? AND idx = ?', id, idx);
      if (!row) return next();
      data = Buffer.from(row.data);
      cache.set(key, { data });
    }
    // Gardé en cache (navigateur et réseau de Vercel) jusqu'à l'effacement de la vidéo, pas plus
    const ttl = Math.max(60, Math.floor((end - Date.now()) / 1000));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', data.length);
    res.setHeader('Cache-Control', `public, max-age=${ttl}, immutable`);
    res.setHeader('CDN-Cache-Control', `public, max-age=${ttl}`);
    res.setHeader('Vercel-CDN-Cache-Control', `public, max-age=${ttl}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // Morceau seul (1 Mo) : le téléphone télécharge la vidéo entière d'avance, en parallèle,
    // et le réseau de Vercel garde ces morceaux en mémoire tant que la vidéo existe.
    const mc = /^\/([a-f0-9]{32})\/(\d{1,3})\.bin$/.exec(req.path);
    if (mc) return sendChunk(mc[1], Number(mc[2]), req, res, next);
    const m = /^\/([a-f0-9]{32})\.(mp4|webm)$/.exec(req.path);
    if (!m) return next();
    const v = await ctx.db.get(
      'SELECT v.mime, v.size, p.created_at AS posted_at FROM videos v LEFT JOIN posts p ON p.video_id = v.id WHERE v.id = ? AND v.complete = 1',
      m[1],
    );
    // Vidéo expirée : plus jamais diffusée, même avant le ménage
    if (!v || (v.posted_at && expiresAt(ctx, v.posted_at) <= Date.now())) return next();
    const type = v.mime === 'video/webm' ? 'video/webm' : 'video/mp4';
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    // Éphémère : le navigateur ne la garde pas au-delà de la journée
    res.setHeader('Cache-Control', `private, max-age=${Math.min(86400, ctx.config.videoTtlHours * 3600)}`);
    // Le CDN de Vercel ne garde pas ces réponses partielles (chaque plage est différente) ;
    // le navigateur, lui, les garde en cache.
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');

    let start = 0;
    let end = v.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
    if (range) {
      if (range[1] === '' && range[2] !== '') {
        start = Math.max(0, v.size - Number(range[2])); // « bytes=-500 » : les 500 derniers octets
      } else {
        start = Number(range[1] || 0);
        if (range[2] !== '') end = Math.min(end, Number(range[2]));
      }
      if (start >= v.size || start > end) {
        res.setHeader('Content-Range', `bytes */${v.size}`);
        return res.status(416).end();
      }
    }
    // Une réponse ne dépasse jamais 3 Mo : le lecteur demande la suite de lui-même
    end = Math.min(end, start + RESPONSE_CAP - 1);
    const first = Math.floor(start / CHUNK);
    const last = Math.floor(end / CHUNK);
    const parts = [];
    const missing = [];
    for (let i = first; i <= last; i++) {
      const hit = cache.get(`${m[1]}:${i}`);
      parts[i - first] = hit ? hit.data : null;
      if (!hit) missing.push(i);
    }
    if (missing.length) {
      const rows = await ctx.db.all(
        `SELECT idx, data FROM video_chunks WHERE video_id = ? AND idx IN (${missing.map(() => '?').join(',')})`,
        m[1], ...missing,
      );
      for (const r of rows) {
        const data = Buffer.from(r.data);
        parts[r.idx - first] = data;
        cache.set(`${m[1]}:${r.idx}`, { data });
      }
    }
    if (parts.some((p) => !p)) return res.status(500).end();
    const buf = Buffer.concat(parts).subarray(start - first * CHUNK, end - first * CHUNK + 1);
    const partial = Boolean(range) || end < v.size - 1;
    res.status(partial ? 206 : 200);
    if (partial) res.setHeader('Content-Range', `bytes ${start}-${end}/${v.size}`);
    res.setHeader('Content-Length', buf.length);
    res.end(req.method === 'HEAD' ? undefined : buf);
  };
}

module.exports = { purgeExpired, expiresAt, CHUNK, MAX_BYTES, MAX_SECONDS, PER_DAY, TYPES, newId, videoUrl, idFromUrl, looksLikeVideo, storageUsed, cleanup, removeVideo, videoHandler };
