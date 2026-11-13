'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { fail, text, intParam } = require('../http');
const { authorOf, counters, pushCounters } = require('../social');

module.exports = function messageRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use(['/conversations', '/counters', '/events'], requireMember);

  const serializeMessage = (m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    senderId: m.sender_id,
    recipientId: m.recipient_id,
    readAt: m.read_at,
  });

  const findMember = async (username) => {
    const u = typeof username === 'string' && await db.get('SELECT * FROM users WHERE username = ? AND paid_at IS NOT NULL', username);
    if (!u) fail(404, 'Ce membre est introuvable.');
    return u;
  };

  r.get('/conversations', async (req, res) => {
    const me = req.user.id;
    const rows = await db.all(
      `WITH conv AS (
         SELECT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS other_id, MAX(id) AS last_id
         FROM messages WHERE sender_id = ? OR recipient_id = ?
         GROUP BY other_id
       )
       SELECT conv.other_id AS user_id, u.username, u.display_name, u.avatar, u.member_number,
              m.body, m.created_at, m.sender_id,
              (SELECT COUNT(*) FROM messages x WHERE x.sender_id = conv.other_id AND x.recipient_id = ? AND x.read_at IS NULL) AS unread
       FROM conv
       JOIN messages m ON m.id = conv.last_id
       JOIN users u ON u.id = conv.other_id
       ORDER BY conv.last_id DESC LIMIT 100`,
      me, me, me, me,
    );
    res.json({
      conversations: rows.map((row) => ({
        user: { ...authorOf(ctx, row), online: ctx.hub.isOnline(row.user_id) },
        lastMessage: { body: row.body, createdAt: row.created_at, fromMe: row.sender_id === me },
        unread: row.unread,
      })),
    });
  });

  r.get('/conversations/:username', async (req, res) => {
    const other = await findMember(req.params.username);
    const me = req.user.id;
    const before = intParam(req.query.before);
    const limit = 50;
    const rows = await db.all(
      `SELECT * FROM messages
       WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))
         AND (? IS NULL OR id < ?)
       ORDER BY id DESC LIMIT ?`,
      me, other.id, other.id, me, before, before, limit,
    );
    const { changes } = await db.run(
      'UPDATE messages SET read_at = ? WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL',
      Date.now(), other.id, me,
    );
    if (changes) {
      await pushCounters(ctx, me);
      ctx.hub.send(other.id, 'read', { by: me });
    }
    res.json({
      user: { ...authorOf(ctx, { ...other, user_id: other.id }), online: ctx.hub.isOnline(other.id) },
      messages: rows.reverse().map(serializeMessage),
      hasMore: rows.length === limit,
    });
  });

  r.post('/conversations/:username', async (req, res) => {
    const other = await findMember(req.params.username);
    if (other.id === req.user.id) fail(400, 'Vous ne pouvez pas vous écrire à vous-même.');
    const body = text(req.body.body, { field: 'Message', max: 2000, required: true });
    const { lastInsertRowid } = await db.run(
      'INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)',
      req.user.id, other.id, body, Date.now(),
    );
    const message = serializeMessage(await db.get('SELECT * FROM messages WHERE id = ?', lastInsertRowid));
    const from = { ...authorOf(ctx, { ...req.user, user_id: req.user.id }) };
    ctx.hub.send(other.id, 'message', { message, from });
    ctx.hub.send(req.user.id, 'message', { message, from, echo: true });
    await pushCounters(ctx, other.id);
    res.status(201).json({ message });
  });

  r.post('/conversations/:username/read', async (req, res) => {
    const other = await findMember(req.params.username);
    const { changes } = await db.run(
      'UPDATE messages SET read_at = ? WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL',
      Date.now(), other.id, req.user.id,
    );
    if (changes) ctx.hub.send(other.id, 'read', { by: req.user.id });
    res.json({ counters: await counters(ctx, req.user.id) });
  });

  r.get('/counters', async (req, res) => res.json(await counters(ctx, req.user.id)));

  // Flux temps réel (Server-Sent Events)
  r.get('/events', async (req, res) => {
    ctx.hub.attach(req.user.id, req, res);
    ctx.hub.send(req.user.id, 'counters', await counters(ctx, req.user.id));
  });

  return r;
};
