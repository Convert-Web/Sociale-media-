'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { fail, intParam } = require('../http');
const { USER_SELECT, serializeUser, POST_SELECT, serializePost, VISIBLE, VIEWER, BLOCKED_WITH, notify, retractNotification, pushCounters, isBlocked } = require('../social');
const { learn, SIGNALS } = require('../feed');

const PAGE = 18;

module.exports = function userRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  const vid = (req) => req.user?.id || 0;

  // Compte par son nom (ligne brute) ; introuvable s'il est suspendu (sauf pour l'administration)
  async function findUser(req, username = req.params.username) {
    const name = String(username || '').replace(/^@/, '');
    let u = name && (await db.get('SELECT * FROM users WHERE username = ? AND is_bot = 0', name));
    // Ancien nom (lien partagé, @mention, notification) : le compte qui le portait
    if (!u && name) {
      const was = await db.get('SELECT user_id FROM username_history WHERE old_username = ? ORDER BY changed_at DESC LIMIT 1', name);
      if (was) u = await db.get('SELECT * FROM users WHERE id = ? AND is_bot = 0', was.user_id);
    }
    if (!u || (u.banned_at && !req.user?.is_admin)) fail(404, 'Ce compte est introuvable.');
    return u;
  }

  async function profile(req, u) {
    const row = await db.get(`${USER_SELECT} WHERE u.id = ?`, vid(req), u.id);
    return serializeUser(ctx, row, req.user);
  }

  // Contenus d'un compte privé : réservés à ses abonnés (et à lui-même)
  async function canSeeContent(req, u) {
    if (!u.private_account || req.user?.id === u.id || req.user?.is_admin) return true;
    if (!req.user) return false;
    return Boolean(await db.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', req.user.id, u.id));
  }

  r.get('/users/:username', async (req, res) => {
    const u = await findUser(req);
    const user = await profile(req, u);
    if (user.blockedBy) {
      // Bloqué par ce compte : seulement le nom
      return res.json({ user: { ...user, bio: '', website: '', counts: { followers: 0, following: 0, likes: 0, posts: 0 }, locked: true } });
    }
    res.json({ user });
  });

  // Grille du profil : vidéos épinglées d'abord, puis de la plus récente à la plus ancienne
  r.get('/users/:username/posts', async (req, res) => {
    const u = await findUser(req);
    if (!(await canSeeContent(req, u)) || (await isBlocked(ctx, vid(req), u.id))) return res.json({ posts: [], locked: true, cursor: null });
    const before = intParam(req.query.cursor);
    const pinned = before
      ? []
      : await db.all(`${POST_SELECT} WHERE p.user_id = ? AND p.pinned_at IS NOT NULL AND ${VISIBLE} ORDER BY p.pinned_at DESC LIMIT 3`, vid(req), u.id);
    const rows = await db.all(
      `${POST_SELECT} WHERE p.user_id = ? AND p.pinned_at IS NULL AND (? IS NULL OR p.id < ?) AND ${VISIBLE} ORDER BY p.id DESC LIMIT ?`,
      vid(req), u.id, before, before, PAGE,
    );
    res.json({
      posts: [...pinned, ...rows].map((row) => serializePost(ctx, row, req.user)),
      cursor: rows.length === PAGE ? rows[rows.length - 1].id : null,
    });
  });

  // Republications du compte
  r.get('/users/:username/reposts', async (req, res) => {
    const u = await findUser(req);
    if (!(await canSeeContent(req, u)) || (await isBlocked(ctx, vid(req), u.id))) return res.json({ posts: [], locked: true, cursor: null });
    const before = intParam(req.query.cursor);
    const rows = await db.all(
      `${POST_SELECT} JOIN reposts rr ON rr.post_id = p.id AND rr.user_id = ? WHERE (? IS NULL OR rr.created_at < ?) AND ${VISIBLE}
       ORDER BY rr.created_at DESC LIMIT ?`,
      vid(req), u.id, before, before, PAGE,
    );
    const times = rows.length
      ? await db.all(`SELECT post_id, created_at FROM reposts WHERE user_id = ? AND post_id IN (${rows.map(() => '?').join(',')})`, u.id, ...rows.map((x) => x.id))
      : [];
    const last = times.reduce((m, t) => Math.min(m, t.created_at), Infinity);
    res.json({ posts: rows.map((row) => serializePost(ctx, row, req.user)), cursor: rows.length === PAGE ? last : null });
  });

  // Vidéos aimées : privées par défaut (réglage « Vidéos aimées visibles »)
  r.get('/users/:username/liked', async (req, res) => {
    const u = await findUser(req);
    const mine = req.user?.id === u.id;
    if (!mine && (!u.show_liked || !(await canSeeContent(req, u)) || (await isBlocked(ctx, vid(req), u.id)))) return res.json({ posts: [], hidden: true, cursor: null });
    const before = intParam(req.query.cursor);
    const rows = await db.all(
      `${POST_SELECT} JOIN likes ll ON ll.post_id = p.id AND ll.user_id = ? WHERE (? IS NULL OR ll.created_at < ?) AND ${VISIBLE}
       ORDER BY ll.created_at DESC LIMIT ?`,
      vid(req), u.id, before, before, PAGE,
    );
    let cursor = null;
    if (rows.length === PAGE) {
      const t = await db.get(`SELECT MIN(created_at) AS m FROM likes WHERE user_id = ? AND post_id IN (${rows.map(() => '?').join(',')})`, u.id, ...rows.map((x) => x.id));
      cursor = t.m;
    }
    res.json({ posts: rows.map((row) => serializePost(ctx, row, req.user)), cursor });
  });

  // S'abonner (ou demander à s'abonner à un compte privé)
  r.post('/users/:username/follow', requireAuth, async (req, res) => {
    const u = await findUser(req);
    if (u.id === req.user.id) fail(400, 'Tu ne peux pas t’abonner à toi-même.');
    if (await isBlocked(ctx, req.user.id, u.id)) fail(403, 'Impossible de s’abonner à ce compte.');
    const already = await db.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', req.user.id, u.id);
    if (!already) {
      if (u.private_account) {
        const { changes } = await db.run('INSERT OR IGNORE INTO follow_requests (requester_id, target_id, created_at) VALUES (?, ?, ?)', req.user.id, u.id, Date.now());
        if (changes) {
          await notify(ctx, { userId: u.id, actorId: req.user.id, type: 'follow_request' });
          await pushCounters(ctx, u.id);
        }
      } else {
        await db.run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', req.user.id, u.id, Date.now());
        await notify(ctx, { userId: u.id, actorId: req.user.id, type: 'follow' });
        await learn(ctx, req.user.id, { author: u.id, tags: [] }, SIGNALS.follow);
      }
    }
    res.json({ user: await profile(req, u) });
  });

  // Se désabonner (ou annuler sa demande)
  r.delete('/users/:username/follow', requireAuth, async (req, res) => {
    const u = await findUser(req);
    await db.run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', req.user.id, u.id);
    const { changes } = await db.run('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?', req.user.id, u.id);
    await retractNotification(ctx, { userId: u.id, actorId: req.user.id, type: 'follow' });
    if (changes) await retractNotification(ctx, { userId: u.id, actorId: req.user.id, type: 'follow_request' });
    res.json({ user: await profile(req, u) });
  });

  // Retirer un abonné de ses abonnés
  r.delete('/users/:username/follower', requireAuth, async (req, res) => {
    const u = await findUser(req);
    await db.run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', u.id, req.user.id);
    res.json({ user: await profile(req, u) });
  });

  // Listes : abonnés, abonnements, amis
  async function list(req, res, kind) {
    const u = await findUser(req);
    if (!(await canSeeContent(req, u)) || (await isBlocked(ctx, vid(req), u.id))) return res.json({ users: [], locked: true, cursor: null });
    const before = intParam(req.query.cursor);
    const limit = 30;
    const where = {
      followers: 'u.id IN (SELECT follower_id FROM follows WHERE followee_id = ?)',
      following: 'u.id IN (SELECT followee_id FROM follows WHERE follower_id = ?)',
      friends: 'u.id IN (SELECT a.followee_id FROM follows a JOIN follows b ON b.follower_id = a.followee_id AND b.followee_id = a.follower_id WHERE a.follower_id = ?)',
    }[kind];
    const order = {
      followers: '(SELECT created_at FROM follows WHERE follower_id = u.id AND followee_id = ?)',
      following: '(SELECT created_at FROM follows WHERE followee_id = u.id AND follower_id = ?)',
      friends: '(SELECT created_at FROM follows WHERE followee_id = u.id AND follower_id = ?)',
    }[kind];
    const rows = await db.all(
      `SELECT * FROM (${USER_SELECT.replace('SELECT u.*,', `SELECT u.*, ${order} AS since,`)} WHERE ${where} AND u.banned_at IS NULL AND NOT ${BLOCKED_WITH('u.id')})
       WHERE (? IS NULL OR since < ?) ORDER BY since DESC LIMIT ?`,
      u.id, vid(req), u.id, before, before, limit,
    );
    res.json({ users: rows.map((row) => serializeUser(ctx, row, req.user)), cursor: rows.length === limit ? rows[rows.length - 1].since : null });
  }
  r.get('/users/:username/followers', (req, res) => list(req, res, 'followers'));
  r.get('/users/:username/following', (req, res) => list(req, res, 'following'));
  r.get('/users/:username/friends', (req, res) => list(req, res, 'friends'));

  // Bloquer : plus d'abonnement dans aucun sens, plus de messages, contenus masqués
  r.post('/users/:username/block', requireAuth, async (req, res) => {
    const u = await findUser(req);
    if (u.id === req.user.id) fail(400, 'Tu ne peux pas te bloquer toi-même.');
    await db.run('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)', req.user.id, u.id, Date.now());
    await db.run('DELETE FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)', req.user.id, u.id, u.id, req.user.id);
    await db.run('DELETE FROM follow_requests WHERE (requester_id = ? AND target_id = ?) OR (requester_id = ? AND target_id = ?)', req.user.id, u.id, u.id, req.user.id);
    res.json({ user: await profile(req, u) });
  });

  r.delete('/users/:username/block', requireAuth, async (req, res) => {
    const u = await findUser(req);
    await db.run('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?', req.user.id, u.id);
    res.json({ user: await profile(req, u) });
  });

  // Comptes suggérés : amis d'amis, puis créateurs populaires (jamais soi-même, ni déjà suivis)
  r.get('/suggestions', async (req, res) => {
    const limit = Math.min(30, intParam(req.query.limit) || 10);
    const rows = await db.all(
      `${USER_SELECT}
       WHERE u.id != v.id AND u.banned_at IS NULL AND u.is_bot = 0
         AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = v.id)
         AND u.id NOT IN (SELECT target_id FROM follow_requests WHERE requester_id = v.id)
         AND NOT ${BLOCKED_WITH('u.id')}
       ORDER BY
         (SELECT COUNT(*) FROM follows ff WHERE ff.followee_id = u.id AND ff.follower_id IN (SELECT followee_id FROM follows WHERE follower_id = v.id)) DESC,
         EXISTS(SELECT 1 FROM follows fb WHERE fb.follower_id = u.id AND fb.followee_id = v.id) DESC,
         followers_count DESC, likes_count DESC, u.id DESC
       LIMIT ?`,
      vid(req), limit,
    );
    const users = rows.map((row) => serializeUser(ctx, row, req.user));
    // Raison affichée sous le nom (comme « Suit ton compte », « Populaire »)
    for (const u of users) u.reason = u.followsYou ? 'Abonné à ton compte' : u.counts.followers > 0 ? `${u.counts.followers} abonné${u.counts.followers > 1 ? 's' : ''}` : 'Nouveau sur AURUM';
    res.json({ users });
  });

  return r;
};

module.exports.VIEWER = VIEWER;
