'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { fail } = require('./http');

const MAX_SIZE = 8 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE, files: 1, fields: 10 },
});

// Détection du format par signature binaire (on ne fait jamais confiance au type annoncé).
function detectImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function saveImage(uploadsDir, file) {
  if (!file) return null;
  const ext = detectImage(file.buffer);
  if (!ext) fail(400, 'Format d’image non pris en charge (JPEG, PNG, WebP ou GIF).');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(uploadsDir, name), file.buffer);
  return `/uploads/${name}`;
}

function deleteUpload(uploadsDir, publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const name = path.basename(publicPath);
  fs.rm(path.join(uploadsDir, name), { force: true }, () => {});
}

// Transforme les erreurs multer en messages lisibles.
function single(field) {
  const handler = upload.single(field);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') return next(Object.assign(new Error('Image trop lourde (8 Mo maximum).'), { status: 413 }));
      return next(Object.assign(new Error('Envoi du fichier impossible.'), { status: 400 }));
    });
  };
}

module.exports = { single, saveImage, deleteUpload, detectImage };
