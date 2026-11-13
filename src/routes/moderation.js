'use strict';
const express = require('express');
const { requireMember, requireAdmin } = require('../auth');
const { fail, text, intParam } = require('../http');
const { deletePost, deleteUser } = require('../membership');
const { deleteUpload } = require('../uploads');

const REASONS = {
  spam: 'Spam ou publicité',
  inappropriate: 'Contenu inapproprié',
  harassment: 'Harcèlement ou propos haineux',
  fake: 'Faux profil ou usurpation',
  other: 'Autre',
};
const TYPES = ['post', 'user', 'comment'];

module.exports = function moderationRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;

  const targetExists = async (type, id) => {
    if (type === 'post') return db.get('SELECT id FROM posts WHERE id = ?', id);
    if (type === 'comment') return db.get('SELECT id FROM comments WHERE id = ?', id);
    return db.get('SELECT id FROM users WHERE id = ? AND paid_at IS NOT NULL', id);
  };

  r.post('/reports', requireMember, async (req, res) => {
    const type = req.body?.type;
    const id = intParam(req.body?.id);
    if (!TYPES.includes(type) || !id) fail(400, 'Signalement invalide.');
    if (!REASONS[req.body?.reason]) fail(400, 'Choisissez un motif.');
    if (!(await targetExists(type, id))) fail(404, 'Contenu introuvable.');
    if (type === 'user' && id === req.user.id) fail(400, 'Vous ne pouvez pas vous signaler vous-même.');
    const details = text(req.body?.details, { field: 'Précisions', max: 500 });
    const reason = details ? `${req.body.reason}: ${details}` : req.body.reason;
    const already = await db.get(
      'SELECT id FROM reports WHERE reporter_id = ? AND target_type = ? AND target_id = ? AND resolved_at IS NULL',
      req.user.id, type, id,
    );
    if (!already) {
      await db.run(
        'INSERT INTO reports (reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)',
        req.user.id, type, id, reason, Date.now(),
      );
    }
    res.status(201).json({ ok: true });
  });

  // File des signalements ouverts, avec un aperçu du contenu visé
  r.get('/admin/reports', requireAdmin, async (_req, res) => {
    const rows = await db.all(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.created_at,
              rep.username AS reporter,
              (SELECT COUNT(*) FROM reports r2 WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id AND r2.resolved_at IS NULL) AS total
       FROM reports r LEFT JOIN users rep ON rep.id = r.reporter_id
       WHERE r.resolved_at IS NULL ORDER BY r.id DESC LIMIT 100`,
    );
    const reports = [];
    for (const row of rows) {
      let target = null;
      if (row.target_type === 'post') {
        const p = await db.get('SELECT p.id, p.body, p.image, u.username, u.display_name FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?', row.target_id);
        if (p) target = { id: p.id, text: p.body, image: p.image, author: p.username, authorName: p.display_name, link: `/p/${p.id}` };
      } else if (row.target_type === 'comment') {
        const c = await db.get('SELECT c.id, c.body, c.post_id, u.username, u.display_name FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?', row.target_id);
        if (c) target = { id: c.id, text: c.body, author: c.username, authorName: c.display_name, link: `/p/${c.post_id}` };
      } else {
        const u = await db.get('SELECT id, username, display_name, bio FROM users WHERE id = ?', row.target_id);
        if (u) target = { id: u.id, text: u.bio, author: u.username, authorName: u.display_name, link: `/@${u.username}` };
      }
      const [code, ...rest] = row.reason.split(': ');
      reports.push({
        id: row.id,
        type: row.target_type,
        reason: REASONS[code] || code,
        details: rest.join(': ') || null,
        reporter: row.reporter,
        total: row.total,
        createdAt: row.created_at,
        target,
      });
    }
    res.json({ reports });
  });

  // Traiter un signalement : « dismiss » (classer) ou « remove » (supprimer le contenu ou exclure le membre)
  r.post('/admin/reports/:id/resolve', requireAdmin, async (req, res) => {
    const id = intParam(req.params.id);
    const report = id && (await db.get('SELECT * FROM reports WHERE id = ?', id));
    if (!report) fail(404, 'Signalement introuvable.');
    const action = req.body?.action === 'remove' ? 'remove' : 'dismiss';
    if (action === 'remove') {
      if (report.target_type === 'post') {
        const post = await db.get('SELECT image FROM posts WHERE id = ?', report.target_id);
        if (post) {
          const media = await deletePost(ctx, report.target_id);
          for (const url of [post.image, ...media]) deleteUpload(ctx, url);
        }
      } else if (report.target_type === 'comment') {
        await db.run('DELETE FROM comments WHERE id = ?', report.target_id);
      } else {
        if (report.target_id === req.user.id) fail(400, 'Vous ne pouvez pas vous exclure vous-même.');
        const media = await deleteUser(ctx, report.target_id);
        for (const url of media) deleteUpload(ctx, url);
      }
    }
    await db.run(
      'UPDATE reports SET resolved_at = ? WHERE target_type = ? AND target_id = ? AND resolved_at IS NULL',
      Date.now(), report.target_type, report.target_id,
    );
    res.json({ ok: true });
  });

  return r;
};

module.exports.REASONS = REASONS;
