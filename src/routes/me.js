'use strict';
const express = require('express');
const { requireAuth, requireMember, destroySession } = require('../auth');
const { verifyPassword } = require('../security');
const { fail, text } = require('../http');
const { single, saveImage, deleteUpload } = require('../uploads');
const { selfUser } = require('../social');

function cleanWebsite(value) {
  const v = text(value, { field: 'Site web', max: 120 });
  if (!v) return '';
  const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error();
    return parsed.toString().replace(/\/$/, '');
  } catch {
    fail(400, 'Adresse de site web invalide.');
  }
}

module.exports = function meRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  const reload = (id) => db.get('SELECT * FROM users WHERE id = ?', id);

  r.patch('/me', requireMember, (req, res) => {
    const b = req.body || {};
    const u = req.user;
    const displayName = b.displayName !== undefined ? text(b.displayName, { field: 'Nom', min: 2, max: 40, required: true }) : u.display_name;
    const bio = b.bio !== undefined ? text(b.bio, { field: 'Biographie', max: 280 }) : u.bio;
    const city = b.city !== undefined ? text(b.city, { field: 'Ville', max: 60 }) : u.city;
    const profession = b.profession !== undefined ? text(b.profession, { field: 'Profession', max: 60 }) : u.profession;
    const website = b.website !== undefined ? cleanWebsite(b.website) : u.website;
    db.run(
      'UPDATE users SET display_name = ?, bio = ?, city = ?, profession = ?, website = ? WHERE id = ?',
      displayName, bio, city, profession, website, u.id,
    );
    res.json({ user: selfUser(ctx, reload(u.id)) });
  });

  for (const kind of ['avatar', 'cover']) {
    r.post(`/me/${kind}`, requireMember, single('image'), (req, res) => {
      if (!req.file) fail(400, 'Aucune image reçue.');
      const image = saveImage(config.uploadsDir, req.file);
      deleteUpload(config.uploadsDir, req.user[kind]);
      db.run(`UPDATE users SET ${kind} = ? WHERE id = ?`, image, req.user.id);
      res.json({ user: selfUser(ctx, reload(req.user.id)) });
    });
    r.delete(`/me/${kind}`, requireMember, (req, res) => {
      deleteUpload(config.uploadsDir, req.user[kind]);
      db.run(`UPDATE users SET ${kind} = NULL WHERE id = ?`, req.user.id);
      res.json({ user: selfUser(ctx, reload(req.user.id)) });
    });
  }

  // Export RGPD : toutes les données du compte au format JSON
  r.get('/me/export', requireAuth, (req, res) => {
    const id = req.user.id;
    const { password_hash: _ignored, ...profile } = req.user;
    const data = {
      exportedAt: new Date().toISOString(),
      profile,
      payments: db.all('SELECT provider, amount_cents, currency, status, created_at FROM payments WHERE user_id = ?', id),
      posts: db.all('SELECT id, body, image, created_at FROM posts WHERE user_id = ?', id),
      comments: db.all('SELECT id, post_id, body, created_at FROM comments WHERE user_id = ?', id),
      likes: db.all('SELECT post_id, created_at FROM likes WHERE user_id = ?', id),
      following: db.all('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?', id),
      followers: db.all('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ?', id),
      messagesSent: db.all('SELECT m.body, m.created_at, u.username AS to_user FROM messages m JOIN users u ON u.id = m.recipient_id WHERE m.sender_id = ?', id),
      messagesReceived: db.all('SELECT m.body, m.created_at, u.username AS from_user FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.recipient_id = ?', id),
    };
    res.setHeader('Content-Disposition', `attachment; filename="aurum-${req.user.username}.json"`);
    res.json(data);
  });

  r.delete('/me', requireAuth, async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!(await verifyPassword(password, req.user.password_hash))) fail(400, 'Mot de passe incorrect.');
    const images = [
      req.user.avatar,
      req.user.cover,
      ...db.all('SELECT image FROM posts WHERE user_id = ? AND image IS NOT NULL', req.user.id).map((p) => p.image),
    ];
    destroySession(ctx, req, res);
    db.run('DELETE FROM users WHERE id = ?', req.user.id);
    for (const img of images) deleteUpload(config.uploadsDir, img);
    res.json({ ok: true });
  });

  return r;
};
