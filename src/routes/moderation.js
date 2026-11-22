'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('../auth');
const { fail, text, intParam } = require('../http');
const { deletePost, deleteUser, deleteComment } = require('../accounts');
const { deleteUploads } = require('../uploads');

const REASONS = {
  spam: 'Spam ou arnaque',
  inappropriate: 'Nudité ou contenu sexuel',
  violence: 'Violence ou contenu choquant',
  harassment: 'Harcèlement ou propos haineux',
  dangerous: 'Actes dangereux',
  minor: 'Sécurité des mineurs',
  fake: 'Faux compte ou usurpation',
  ip: 'Atteinte à la propriété intellectuelle',
  other: 'Autre',
  // Signalements du filtre automatique (reporter_id = 0)
  auto: 'Filtre automatique',
};
const TYPES = ['post', 'user', 'comment', 'message', 'live'];

module.exports = function moderationRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;

  const targetExists = async (type, id, user) => {
    if (type === 'post') return db.get('SELECT id FROM posts WHERE id = ?', id);
    if (type === 'comment') return db.get('SELECT id FROM comments WHERE id = ?', id);
    // Message privé : seul son destinataire peut le signaler
    if (type === 'message') return db.get('SELECT id FROM messages WHERE id = ? AND recipient_id = ?', id, user.id);
    if (type === 'live') return db.get('SELECT id FROM lives WHERE id = ?', id);
    return db.get('SELECT id FROM users WHERE id = ? AND is_bot = 0', id);
  };

  r.post('/reports', requireAuth, async (req, res) => {
    const type = req.body?.type;
    const id = intParam(req.body?.id);
    if (!TYPES.includes(type) || !id) fail(400, 'Signalement invalide.');
    if (!REASONS[req.body?.reason] || req.body.reason === 'auto') fail(400, 'Choisis un motif.');
    if (!(await targetExists(type, id, req.user))) fail(404, 'Contenu introuvable.');
    if (type === 'user' && id === req.user.id) fail(400, 'Tu ne peux pas te signaler toi-même.');
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
        if (p) target = { id: p.id, text: p.body, image: p.image, author: p.username, authorName: p.display_name, link: `/@${p.username}/video/${p.id}` };
      } else if (row.target_type === 'comment') {
        const c = await db.get(
          'SELECT c.id, c.body, c.post_id, u.username, u.display_name, pu.username AS owner FROM comments c JOIN users u ON u.id = c.user_id JOIN posts p ON p.id = c.post_id JOIN users pu ON pu.id = p.user_id WHERE c.id = ?',
          row.target_id,
        );
        if (c) target = { id: c.id, text: c.body, author: c.username, authorName: c.display_name, link: `/@${c.owner}/video/${c.post_id}?commentaire=${c.id}` };
      } else if (row.target_type === 'message') {
        // Seul le message signalé est montré à la Direction, jamais le reste de la conversation
        const m = await db.get(
          `SELECT m.id, m.body, s.username, s.display_name, r.username AS to_username, r.display_name AS to_name
           FROM messages m JOIN users s ON s.id = m.sender_id JOIN users r ON r.id = m.recipient_id WHERE m.id = ?`,
          row.target_id,
        );
        if (m) target = { id: m.id, text: m.body, author: m.username, authorName: m.display_name, link: null, to: m.to_username, toName: m.to_name };
      } else if (row.target_type === 'live') {
        const l = await db.get('SELECT l.id, l.title, l.ended_at, u.username, u.display_name FROM lives l JOIN users u ON u.id = l.user_id WHERE l.id = ?', row.target_id);
        if (l) target = { id: l.id, text: l.title || 'LIVE', author: l.username, authorName: l.display_name, link: l.ended_at ? `/@${l.username}` : `/live/${l.username}` };
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
        automatic: code === 'auto',
        total: row.total,
        createdAt: row.created_at,
        target,
      });
    }
    res.json({ reports });
  });

  // Traiter un signalement : « dismiss » (classer) ou « remove » (supprimer le contenu, arrêter le LIVE ou suspendre le compte)
  r.post('/admin/reports/:id/resolve', requireAdmin, async (req, res) => {
    const id = intParam(req.params.id);
    const report = id && (await db.get('SELECT * FROM reports WHERE id = ?', id));
    if (!report) fail(404, 'Signalement introuvable.');
    const action = req.body?.action === 'remove' ? 'remove' : 'dismiss';
    if (action === 'remove') {
      if (report.target_type === 'post') {
        if (await db.get('SELECT 1 FROM posts WHERE id = ?', report.target_id)) await deleteUploads(ctx, await deletePost(ctx, report.target_id));
      } else if (report.target_type === 'comment') {
        await deleteComment(ctx, report.target_id);
      } else if (report.target_type === 'message') {
        await db.run('DELETE FROM messages WHERE id = ?', report.target_id);
      } else if (report.target_type === 'live') {
        await db.run('UPDATE lives SET ended_at = COALESCE(ended_at, ?) WHERE id = ?', Date.now(), report.target_id);
      } else {
        // Compte : suspendu (il ne peut plus se connecter, ses contenus disparaissent du site)
        if (report.target_id === req.user.id) fail(400, 'Tu ne peux pas suspendre ton propre compte.');
        await db.run('UPDATE users SET banned_at = ? WHERE id = ?', Date.now(), report.target_id);
        await db.run('DELETE FROM sessions WHERE user_id = ?', report.target_id);
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
