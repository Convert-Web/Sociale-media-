'use strict';
const express = require('express');
const { requireAuth, destroySession } = require('../auth');
const { verifyPassword } = require('../security');
const { fail, text, cleanWebsite, intParam, USERNAME_RE, RESERVED } = require('../http');
const { assertClean } = require('../contentFilter');
const { single, saveImage, deleteUpload, deleteUploads } = require('../uploads');
const { selfUser, USER_SELECT, serializeUser, POST_SELECT, serializePost, VISIBLE, notify, pushCounters } = require('../social');
const { deleteUser } = require('../accounts');
const { learn } = require('../feed');
const { CATEGORY_IDS } = require('../catalog');

const DM_POLICIES = ['everyone', 'friends', 'none'];
const NOTIFY_KEYS = ['likes', 'comments', 'follows', 'mentions', 'messages', 'live'];

module.exports = function meRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/me', requireAuth);

  const reload = async (id) => db.get('SELECT * FROM users WHERE id = ?', id);

  // Modifier le profil : nom, nom d'utilisateur (une fois tous les 30 jours), bio, lien
  r.patch('/me', async (req, res) => {
    const b = req.body || {};
    const u = req.user;
    const displayName = b.displayName !== undefined ? text(b.displayName, { field: 'Nom', min: 1, max: 30, required: true }) : u.display_name;
    const bio = b.bio !== undefined ? text(b.bio, { field: 'Bio', max: 80 }) : u.bio;
    const website = b.website !== undefined ? cleanWebsite(b.website) : u.website;
    let username = u.username;
    if (b.username !== undefined && String(b.username).replace(/^@/, '') !== u.username) {
      username = text(b.username, { field: "Nom d'utilisateur", required: true, max: 24 }).replace(/^@/, '');
      if (!USERNAME_RE.test(username)) fail(400, "Nom d'utilisateur : 2 à 24 caractères (lettres, chiffres, « _ » ou « . »).");
      if (RESERVED.has(username.toLowerCase())) fail(409, "Ce nom d'utilisateur est réservé.");
      const taken = await db.get('SELECT id FROM users WHERE username = ? AND id != ?', username, u.id);
      if (taken) fail(409, "Ce nom d'utilisateur est déjà pris.");
      const last = await db.get("SELECT value FROM settings WHERE key = ?", `username-changed:${u.id}`);
      req.oldUsername = u.username;
      if (last && Date.now() - Number(last.value) < 30 * 86400e3 && !u.is_admin) {
        fail(429, 'Tu as déjà changé de nom d’utilisateur ces 30 derniers jours.');
      }
      await db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `username-changed:${u.id}`, String(Date.now()));
    }
    assertClean('Profil', displayName, bio, username.replace(/[._]/g, ' '));
    await db.run('UPDATE users SET display_name = ?, bio = ?, website = ?, username = ? WHERE id = ?', displayName, bio, website, username, u.id);
    // L'ancien nom mène encore au compte (liens partagés, @mentions, notifications)
    if (req.oldUsername && req.oldUsername.toLowerCase() !== username.toLowerCase()) {
      await db.run('INSERT INTO username_history (old_username, user_id, changed_at) VALUES (?, ?, ?)', req.oldUsername, u.id, Date.now());
    }
    res.json({ user: selfUser(ctx, await reload(u.id)) });
  });

  r.post('/me/avatar', single('image'), async (req, res) => {
    if (!req.file) fail(400, 'Aucune image reçue.');
    const image = await saveImage(ctx, req.file);
    deleteUpload(ctx, req.user.avatar);
    await db.run('UPDATE users SET avatar = ? WHERE id = ?', image, req.user.id);
    res.json({ user: selfUser(ctx, await reload(req.user.id)) });
  });

  r.delete('/me/avatar', async (req, res) => {
    deleteUpload(ctx, req.user.avatar);
    await db.run('UPDATE users SET avatar = NULL WHERE id = ?', req.user.id);
    res.json({ user: selfUser(ctx, await reload(req.user.id)) });
  });

  // Confidentialité et notifications
  r.patch('/me/settings', async (req, res) => {
    const b = req.body || {};
    const u = req.user;
    const privateAccount = b.privateAccount !== undefined ? (b.privateAccount ? 1 : 0) : u.private_account;
    const showLiked = b.showLiked !== undefined ? (b.showLiked ? 1 : 0) : u.show_liked;
    const dmPolicy = b.dmPolicy !== undefined ? b.dmPolicy : u.dm_policy;
    const personalized = b.personalized !== undefined ? (b.personalized ? 1 : 0) : u.personalized;
    if (!DM_POLICIES.includes(dmPolicy)) fail(400, 'Réglage des messages invalide.');
    let notify_prefs = u.notify_prefs || '{}';
    if (b.notify && typeof b.notify === 'object') {
      const cur = JSON.parse(notify_prefs || '{}');
      for (const k of NOTIFY_KEYS) if (typeof b.notify[k] === 'boolean') cur[k] = b.notify[k];
      notify_prefs = JSON.stringify(cur);
    }
    await db.run('UPDATE users SET private_account = ?, show_liked = ?, dm_policy = ?, notify_prefs = ?, personalized = ? WHERE id = ?', privateAccount, showLiked, dmPolicy, notify_prefs, personalized, u.id);
    // Compte repassé en public : les demandes en attente sont acceptées
    if (u.private_account && !privateAccount) {
      const pending = await db.all('SELECT requester_id FROM follow_requests WHERE target_id = ?', u.id);
      for (const p of pending) {
        await db.run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', p.requester_id, u.id, Date.now());
      }
      await db.run('DELETE FROM follow_requests WHERE target_id = ?', u.id);
      await db.run("DELETE FROM notifications WHERE user_id = ? AND type = 'follow_request'", u.id);
      await pushCounters(ctx, u.id);
    }
    res.json({ user: selfUser(ctx, await reload(u.id)) });
  });

  // Premier lancement : centres d'intérêt choisis (le fil « Pour toi » démarre avec eux)
  r.post('/me/onboarding', async (req, res) => {
    const cats = Array.isArray(req.body?.categories) ? req.body.categories.filter((c) => CATEGORY_IDS.has(c)).slice(0, 16) : [];
    for (const c of cats) await learn(ctx, req.user.id, { author: 0, category: c, tags: [] }, 5);
    await db.run('UPDATE users SET onboarded_at = ? WHERE id = ?', Date.now(), req.user.id);
    res.json({ user: selfUser(ctx, await reload(req.user.id)) });
  });

  // Demandes d'abonnement (compte privé)
  // Amis venus grâce à mes invitations (lien « Rejoins-moi sur AURUM »)
  r.get('/me/invites', async (req, res) => {
    const rows = await db.all(
      'SELECT id AS user_id, username, display_name, avatar, verified_at FROM users WHERE referrer_id = ? AND banned_at IS NULL ORDER BY id DESC LIMIT 6',
      req.user.id,
    );
    const { n } = await db.get('SELECT COUNT(*) AS n FROM users WHERE referrer_id = ? AND banned_at IS NULL', req.user.id);
    res.json({ count: n, users: rows.map((r) => ({ id: r.user_id, username: r.username, displayName: r.display_name, avatar: r.avatar || null, verified: Boolean(r.verified_at) })) });
  });

  r.get('/me/requests', async (req, res) => {
    const rows = await db.all(
      `${USER_SELECT} JOIN follow_requests fr ON fr.requester_id = u.id AND fr.target_id = v.id ORDER BY fr.created_at DESC LIMIT 200`,
      req.user.id,
    );
    res.json({ users: rows.map((row) => serializeUser(ctx, row, req.user)) });
  });

  r.post('/me/requests/:username/:action', async (req, res) => {
    const other = await db.get('SELECT id FROM users WHERE username = ?', String(req.params.username));
    if (!other) fail(404, 'Compte introuvable.');
    const req0 = await db.get('SELECT 1 FROM follow_requests WHERE requester_id = ? AND target_id = ?', other.id, req.user.id);
    if (!req0) fail(404, 'Cette demande n’existe plus.');
    await db.run('DELETE FROM follow_requests WHERE requester_id = ? AND target_id = ?', other.id, req.user.id);
    await db.run("DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = 'follow_request'", req.user.id, other.id);
    if (req.params.action === 'accept') {
      await db.run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', other.id, req.user.id, Date.now());
      await notify(ctx, { userId: other.id, actorId: req.user.id, type: 'follow_accept' });
      await notify(ctx, { userId: req.user.id, actorId: other.id, type: 'follow' });
    } else if (req.params.action !== 'decline') {
      fail(400, 'Action inconnue.');
    }
    await pushCounters(ctx, req.user.id);
    res.json({ ok: true });
  });

  r.get('/me/blocked', async (req, res) => {
    const rows = await db.all(`${USER_SELECT} JOIN blocks bl ON bl.blocked_id = u.id AND bl.blocker_id = v.id ORDER BY bl.created_at DESC`, req.user.id);
    res.json({ users: rows.map((row) => serializeUser(ctx, row, req.user)) });
  });

  // Favoris (vidéos gardées) : privés
  r.get('/me/favorites', async (req, res) => {
    const before = intParam(req.query.cursor);
    const limit = 18;
    const rows = await db.all(
      `${POST_SELECT} JOIN bookmarks bm ON bm.post_id = p.id AND bm.user_id = v.id WHERE (? IS NULL OR bm.created_at < ?) AND ${VISIBLE}
       ORDER BY bm.created_at DESC LIMIT ?`,
      req.user.id, before, before, limit,
    );
    let cursor = null;
    if (rows.length === limit) {
      const t = await db.get(`SELECT MIN(created_at) AS m FROM bookmarks WHERE user_id = ? AND post_id IN (${rows.map(() => '?').join(',')})`, req.user.id, ...rows.map((x) => x.id));
      cursor = t.m;
    }
    res.json({ posts: rows.map((row) => serializePost(ctx, row, req.user)), cursor });
  });

  // Export RGPD : toutes les données du compte au format JSON
  r.get('/me/export', async (req, res) => {
    const id = req.user.id;
    const { password_hash: _hash, login_failures: _f, login_locked_until: _l, ...profile } = req.user;
    const data = {
      exportedAt: new Date().toISOString(),
      profile,
      posts: await db.all('SELECT id, body, image, video_id, privacy, category, created_at FROM posts WHERE user_id = ?', id),
      comments: await db.all('SELECT id, post_id, parent_id, body, created_at FROM comments WHERE user_id = ?', id),
      likes: await db.all('SELECT post_id, created_at FROM likes WHERE user_id = ?', id),
      favorites: await db.all('SELECT post_id, created_at FROM bookmarks WHERE user_id = ?', id),
      reposts: await db.all('SELECT post_id, created_at FROM reposts WHERE user_id = ?', id),
      following: await db.all('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?', id),
      followers: await db.all('SELECT u.username, f.created_at FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ?', id),
      messages: await db.all(
        `SELECT m.id, s.username AS sender, r.username AS recipient, m.body, m.post_id, m.created_at, m.read_at
         FROM messages m JOIN users s ON s.id = m.sender_id JOIN users r ON r.id = m.recipient_id
         WHERE m.sender_id = ? OR m.recipient_id = ? ORDER BY m.id`,
        id, id,
      ),
      watchHistory: await db.all('SELECT post_id, plays, watch_ms, ratio, created_at, updated_at FROM video_views WHERE user_id = ?', id),
      interests: await db.all('SELECT kind, key, score, updated_at FROM interests WHERE user_id = ?', id),
      lives: await db.all('SELECT id, title, started_at, ended_at, peak_viewers, likes, diamonds FROM lives WHERE user_id = ?', id),
      wallet: await db.all('SELECT kind, coins, diamonds, gift, created_at FROM wallet_tx WHERE user_id = ? ORDER BY id', id),
      payments: await db.all('SELECT provider, amount_cents, currency, status, coins, created_at FROM payments WHERE user_id = ?', id),
    };
    res.setHeader('Content-Disposition', `attachment; filename="aurum-${req.user.username}.json"`);
    res.json(data);
  });

  // Effacer ses centres d'intérêt (« Actualiser ton fil Pour toi »)
  r.delete('/me/interests', async (req, res) => {
    await db.run('DELETE FROM interests WHERE user_id = ?', req.user.id);
    await db.run('DELETE FROM video_views WHERE user_id = ? AND watch_ms = 0', req.user.id);
    res.json({ ok: true });
  });

  // Suppression du compte (mot de passe exigé)
  r.delete('/me', async (req, res) => {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!(await verifyPassword(password, req.user.password_hash))) fail(400, 'Mot de passe incorrect.');
    await deleteUploads(ctx, await deleteUser(ctx, req.user.id));
    await destroySession(ctx, req, res);
    res.json({ ok: true });
  });

  return r;
};
