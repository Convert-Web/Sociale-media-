'use strict';
const { detectLang } = require('../translate');
const express = require('express');
const { requireAuth } = require('../auth');
const { fail, text, intParam } = require('../http');
const { throttle } = require('../antispam');
const { authorOf, counters, pushCounters, isBlocked, areFriends, flaggedLabels, getPost, prefs } = require('../social');
const { moderate, autoReport } = require('../contentFilter');
const { sendPush } = require('../push');

const HIDDEN = 'Message masqué : contenu potentiellement offensant';

module.exports = function messageRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use(['/conversations', '/counters', '/stream', '/share'], requireAuth);

  // Aperçus des vidéos partagées dans une liste de messages
  async function previews(rows, viewer) {
    const ids = [...new Set(rows.map((m) => m.post_id).filter(Boolean))];
    const map = new Map();
    for (const id of ids) {
      const p = await getPost(ctx, id, viewer, { admin: false });
      map.set(id, p ? { id: p.id, kind: p.kind, image: p.video?.poster || p.images[0] || null, body: p.body.slice(0, 80), author: { username: p.author.username, displayName: p.author.displayName, avatar: p.author.avatar } } : { id, unavailable: true });
    }
    return map;
  }

  const serializeMessage = (m, posts) => ({
    id: m.id,
    body: m.body,
    lang: detectLang(m.body),
    createdAt: m.created_at,
    senderId: m.sender_id,
    recipientId: m.recipient_id,
    readAt: m.read_at,
    post: m.post_id ? posts?.get(m.post_id) || { id: m.post_id, unavailable: true } : null,
    // Filtre automatique : message masqué chez le destinataire derrière un avertissement
    flagged: flaggedLabels(m.flagged),
  });

  const findUser = async (username) => {
    const u = typeof username === 'string' && (await db.get('SELECT * FROM users WHERE username = ? AND banned_at IS NULL AND is_bot = 0', username));
    if (!u) fail(404, 'Ce compte est introuvable.');
    return u;
  };

  // Le destinataire accepte-t-il les messages de ce compte ? (réglage « Qui peut t'envoyer des messages »)
  async function canMessage(me, other) {
    if (await isBlocked(ctx, me.id, other.id)) return 'Tu ne peux pas écrire à ce compte.';
    const replied = await db.get('SELECT 1 FROM messages WHERE sender_id = ? AND recipient_id = ? LIMIT 1', other.id, me.id);
    if (replied) return null;
    if (other.dm_policy === 'none') return 'Ce compte ne reçoit pas de messages.';
    if (other.dm_policy === 'friends' && !(await areFriends(ctx, me.id, other.id))) return 'Ce compte ne reçoit des messages que de ses amis (abonnements réciproques).';
    return null;
  }

  async function send(req, other, body, postId) {
    if (other.id === req.user.id) fail(400, 'Tu ne peux pas t’écrire à toi-même.');
    const refused = await canMessage(req.user, other);
    if (refused) fail(403, refused, 'DM_REFUSED');
    await throttle(ctx, req.user, 'message');
    const flagged = body ? moderate(body) : null;
    const { lastInsertRowid } = await db.run(
      'INSERT INTO messages (sender_id, recipient_id, body, flagged, post_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      req.user.id, other.id, body, flagged, postId, Date.now(),
    );
    await autoReport(ctx, 'message', lastInsertRowid, flagged);
    const row = await db.get('SELECT * FROM messages WHERE id = ?', lastInsertRowid);
    const message = serializeMessage(row, await previews([row], req.user));
    const from = authorOf({ ...req.user, user_id: req.user.id });
    ctx.hub.send(other.id, 'message', { message, from });
    ctx.hub.send(req.user.id, 'message', { message, from, echo: true });
    await pushCounters(ctx, other.id);
    if (prefs(other).messages) {
      await sendPush(ctx, other.id, {
        title: req.user.display_name,
        body: flagged ? HIDDEN : postId && !body ? 'a partagé une vidéo avec toi' : body.length > 140 ? `${body.slice(0, 137)}…` : body,
        url: `/messages/${req.user.username}`,
        tag: `dm-${req.user.id}`,
      });
    }
    return message;
  }

  r.get('/conversations', async (req, res) => {
    const me = req.user.id;
    const rows = await db.all(
      `WITH conv AS (
         SELECT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS other_id, MAX(id) AS last_id
         FROM messages WHERE sender_id = ? OR recipient_id = ?
         GROUP BY other_id
       )
       SELECT conv.other_id AS user_id, u.username, u.display_name, u.avatar, u.verified_at,
              m.body, m.created_at, m.sender_id, m.flagged, m.post_id, m.read_at,
              (SELECT COUNT(*) FROM messages x WHERE x.sender_id = conv.other_id AND x.recipient_id = ? AND x.read_at IS NULL) AS unread
       FROM conv
       JOIN messages m ON m.id = conv.last_id
       JOIN users u ON u.id = conv.other_id
       WHERE u.banned_at IS NULL AND conv.other_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)
       ORDER BY conv.last_id DESC LIMIT 100`,
      me, me, me, me, me, me,
    );
    res.json({
      conversations: rows.map((row) => ({
        user: { ...authorOf(row), online: ctx.hub.isOnline(row.user_id) },
        lastMessage: {
          body: row.flagged && row.sender_id !== me ? HIDDEN : row.body || (row.post_id ? 'A partagé une vidéo' : ''),
          createdAt: row.created_at,
          fromMe: row.sender_id === me,
          seen: Boolean(row.read_at),
          post: Boolean(row.post_id),
        },
        unread: row.unread,
      })),
    });
  });

  r.get('/conversations/:username', async (req, res) => {
    const other = await findUser(req.params.username);
    const me = req.user.id;
    const before = intParam(req.query.before);
    const after = intParam(req.query.after);
    const limit = 50;
    // « after » : uniquement les messages arrivés depuis (rafraîchissement régulier)
    const rows = after
      ? (
          await db.all(
            `SELECT * FROM messages WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) AND id > ?
             ORDER BY id ASC LIMIT 200`,
            me, other.id, other.id, me, after,
          )
        ).reverse()
      : await db.all(
          `SELECT * FROM messages WHERE ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) AND (? IS NULL OR id < ?)
           ORDER BY id DESC LIMIT ?`,
          me, other.id, other.id, me, before, before, limit,
        );
    const { changes } = await db.run('UPDATE messages SET read_at = ? WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL', Date.now(), other.id, me);
    if (changes) {
      await pushCounters(ctx, me);
      ctx.hub.send(other.id, 'read', { by: me });
    }
    const { seen } = await db.get('SELECT COALESCE(MAX(id), 0) AS seen FROM messages WHERE sender_id = ? AND recipient_id = ? AND read_at IS NOT NULL', me, other.id);
    const posts = await previews(rows, req.user);
    res.json({
      user: { ...authorOf({ ...other, user_id: other.id }), online: ctx.hub.isOnline(other.id) },
      messages: rows.reverse().map((m) => serializeMessage(m, posts)),
      hasMore: !after && rows.length === limit,
      seenUpTo: seen,
      blocked: await isBlocked(ctx, me, other.id),
      refused: await canMessage(req.user, other),
    });
  });

  r.post('/conversations/:username', async (req, res) => {
    const other = await findUser(req.params.username);
    const body = text(req.body?.body, { field: 'Message', max: 2000 });
    let postId = null;
    if (req.body?.postId) {
      const p = await getPost(ctx, intParam(req.body.postId), req.user, { admin: false });
      if (!p) fail(404, 'Cette vidéo n’est pas disponible.');
      postId = p.id;
    }
    if (!body && !postId) fail(400, 'Écris un message.');
    res.status(201).json({ message: await send(req, other, body, postId) });
  });

  r.post('/conversations/:username/read', async (req, res) => {
    const other = await findUser(req.params.username);
    const { changes } = await db.run('UPDATE messages SET read_at = ? WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL', Date.now(), other.id, req.user.id);
    if (changes) ctx.hub.send(other.id, 'read', { by: req.user.id });
    res.json({ counters: await counters(ctx, req.user.id) });
  });

  // « Écrit… » : signal envoyé à l'autre personne si elle est connectée
  r.post('/conversations/:username/typing', async (req, res) => {
    const other = await findUser(req.params.username);
    if (!(await isBlocked(ctx, req.user.id, other.id))) ctx.hub.send(other.id, 'typing', { from: req.user.id });
    res.json({ ok: true });
  });

  // Partager une vidéo en message à plusieurs personnes
  r.post('/share/dm', async (req, res) => {
    const p = await getPost(ctx, intParam(req.body?.postId), req.user, { admin: false });
    if (!p) fail(404, 'Cette vidéo n’est pas disponible.');
    const names = Array.isArray(req.body?.usernames) ? [...new Set(req.body.usernames.map(String))].slice(0, 20) : [];
    if (!names.length) fail(400, 'Choisis au moins une personne.');
    const body = text(req.body?.body, { field: 'Message', max: 500 });
    const sent = [];
    const errors = [];
    for (const name of names) {
      try {
        const other = await findUser(name);
        await send(req, other, body, p.id);
        sent.push(name);
      } catch (err) {
        errors.push({ username: name, error: err.message });
      }
    }
    if (sent.length) await db.run('UPDATE posts SET share_count = share_count + ? WHERE id = ?', sent.length, p.id);
    res.json({ sent, errors });
  });

  // Destinataires proposés dans la feuille de partage : conversations récentes, puis amis
  r.get('/share/targets', async (req, res) => {
    const me = req.user.id;
    const rows = await db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.verified_at, MAX(x.at) AS at FROM (
         SELECT CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END AS uid, MAX(id) * 1.0 + 1e13 AS at
         FROM messages WHERE sender_id = ? OR recipient_id = ? GROUP BY uid
         UNION ALL
         SELECT a.followee_id AS uid, a.created_at AS at FROM follows a JOIN follows b ON b.follower_id = a.followee_id AND b.followee_id = a.follower_id WHERE a.follower_id = ?
       ) x JOIN users u ON u.id = x.uid
       WHERE u.banned_at IS NULL AND u.id != ? AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)
       GROUP BY u.id ORDER BY at DESC LIMIT 24`,
      me, me, me, me, me, me, me,
    );
    res.json({ users: rows.map((row) => authorOf(row)) });
  });

  r.get('/counters', async (req, res) => res.json(await counters(ctx, req.user.id)));

  // Flux temps réel (Server-Sent Events)
  r.get('/stream', async (req, res) => {
    ctx.hub.attach(req.user.id, req, res);
    ctx.hub.send(req.user.id, 'counters', await counters(ctx, req.user.id));
  });

  return r;
};
