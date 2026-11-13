'use strict';
const crypto = require('node:crypto');
const multer = require('multer');
const { fail } = require('./http');

// Les photos sont redimensionnées par le navigateur avant l'envoi ;
// cette limite ne concerne que les cas exceptionnels (GIF animés).
// Vercel refuse les requêtes de plus de 4,5 Mo.
const MAX_SIZE = 4 * 1024 * 1024;
const MIME = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: 1, fields: 10 },
});

// Détection du format par signature binaire (on ne fait jamais confiance au type annoncé).
function detectImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  const head = buf.subarray(0, 6).toString('ascii');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

// Enregistre l'image dans la base et renvoie son adresse publique.
async function saveImage(ctx, file) {
  if (!file) return null;
  const ext = detectImage(file.buffer);
  if (!ext) fail(400, 'Format d’image non pris en charge (JPEG, PNG, WebP ou GIF).');
  const id = crypto.randomBytes(16).toString('hex');
  await ctx.db.run(
    'INSERT INTO media (id, mime, data, size, created_at) VALUES (?, ?, ?, ?, ?)',
    id, MIME[ext], file.buffer, file.buffer.length, Date.now(),
  );
  return `/media/${id}.${ext}`;
}

function deleteUpload(ctx, publicPath) {
  const m = typeof publicPath === 'string' && /^\/media\/([a-f0-9]{32})\.\w+$/.exec(publicPath);
  if (!m) return;
  ctx.mediaCache?.delete(m[1]);
  ctx.db.run('DELETE FROM media WHERE id = ?', m[1]).catch(() => {});
}

// Petit cache mémoire pour éviter de relire les images les plus vues.
class MediaCache {
  constructor(maxBytes = 48 * 1024 * 1024) {
    this.max = maxBytes;
    this.bytes = 0;
    this.map = new Map();
  }
  get(id) {
    const v = this.map.get(id);
    if (v) {
      this.map.delete(id);
      this.map.set(id, v);
    }
    return v;
  }
  set(id, v) {
    if (v.data.length > this.max / 4) return;
    this.delete(id);
    this.map.set(id, v);
    this.bytes += v.data.length;
    for (const [k, old] of this.map) {
      if (this.bytes <= this.max) break;
      this.map.delete(k);
      this.bytes -= old.data.length;
    }
  }
  delete(id) {
    const v = this.map.get(id);
    if (v) {
      this.bytes -= v.data.length;
      this.map.delete(id);
    }
  }
}

function mediaHandler(ctx) {
  ctx.mediaCache = new MediaCache();
  return async (req, res, next) => {
    const m = /^\/([a-f0-9]{32})\.(jpg|png|gif|webp)$/.exec(req.path);
    if (!m) return next();
    let item = ctx.mediaCache.get(m[1]);
    if (!item) {
      const row = await ctx.db.get('SELECT mime, data FROM media WHERE id = ?', m[1]);
      if (!row) return next();
      item = { mime: row.mime, data: Buffer.from(row.data) };
      ctx.mediaCache.set(m[1], item);
    }
    res.setHeader('Content-Type', item.mime);
    res.setHeader('Content-Length', item.data.length);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(item.data);
  };
}

function readable(handler) {
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(Object.assign(new Error('Image trop lourde (4 Mo maximum).'), { status: 413 }));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return next(Object.assign(new Error('6 photos maximum par publication.'), { status: 400 }));
      return next(Object.assign(new Error('Envoi du fichier impossible.'), { status: 400 }));
    });
  };
}

// Plusieurs photos (champ « images ») ou une seule (champ « image »).
const multi = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_SIZE, files: 6, fields: 10 } });
function photos() {
  return readable(multi.fields([{ name: 'images', maxCount: 6 }, { name: 'image', maxCount: 1 }]));
}

// Transforme les erreurs multer en messages lisibles.
function single(field) {
  const handler = upload.single(field);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(Object.assign(new Error('Image trop lourde (4 Mo maximum).'), { status: 413 }));
      return next(Object.assign(new Error('Envoi du fichier impossible.'), { status: 400 }));
    });
  };
}

module.exports = { single, photos, saveImage, deleteUpload, detectImage, mediaHandler };
