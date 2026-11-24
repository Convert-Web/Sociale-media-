'use strict';
// LIVE : vidéo en direct entre le téléphone du créateur et ceux des spectateurs (WebRTC).
// La mise en relation (offres et réponses WebRTC) passe par de simples requêtes interrogées
// régulièrement : cela fonctionne partout, y compris sur Vercel (sans connexion permanente).
// Le fil du direct (commentaires, arrivées, cœurs, cadeaux) passe par la même interrogation.
const crypto = require('node:crypto');
const express = require('express');
const { requireAuth } = require('../auth');
const { fail, text, intParam } = require('../http');
const { moderate, assertClean } = require('../contentFilter');
const { authorOf, notify, isBlocked, VIEWER, BLOCKED_WITH, NOW_MS } = require('../social');
const { sendGift, giftById } = require('../wallet');

const BEAT_TIMEOUT = 45e3; // direct terminé si le créateur ne donne plus signe de vie
const VIEWER_TIMEOUT = 12e3; // les spectateurs se signalent toutes les 1,3 s (4 s en arrière-plan)
const MAX_SDP = 20000;

module.exports = function liveRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  // Ménage : directs abandonnés, signaux et spectateurs anciens (au plus une fois toutes les 15 s)
  let lastSweep = 0;
  async function sweep() {
    const now = Date.now();
    if (now - lastSweep < 15e3) return;
    lastSweep = now;
    await db.run('UPDATE lives SET ended_at = last_beat WHERE ended_at IS NULL AND last_beat < ?', now - BEAT_TIMEOUT);
    await db.run('DELETE FROM live_signals WHERE created_at < ?', now - 5 * 60e3);
    await db.run('DELETE FROM live_viewers WHERE last_seen < ?', now - 10 * 60e3);
  }

  const viewersOf = async (liveId) =>
    (await db.get('SELECT COUNT(*) AS n FROM live_viewers WHERE live_id = ? AND last_seen > ?', liveId, Date.now() - VIEWER_TIMEOUT)).n;

  async function loadLive(req, { open = true } = {}) {
    const id = intParam(req.params.id);
    const l = id && (await db.get(
      `SELECT l.*, u.username, u.display_name, u.avatar, u.verified_at, u.private_account, u.banned_at
       FROM lives l JOIN users u ON u.id = l.user_id WHERE l.id = ?`,
      id,
    ));
    if (!l || l.banned_at) fail(404, 'Ce LIVE est introuvable.');
    if (await isBlocked(ctx, req.user?.id || 0, l.user_id)) fail(404, 'Ce LIVE est introuvable.');
    if (l.private_account && req.user?.id !== l.user_id) {
      const ok = req.user && (await db.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', req.user.id, l.user_id));
      if (!ok) fail(403, 'Ce LIVE est réservé aux abonnés de ce compte.');
    }
    if (open && (l.ended_at || l.last_beat < Date.now() - BEAT_TIMEOUT)) fail(410, 'Ce LIVE est terminé.', 'LIVE_ENDED');
    return l;
  }

  const serializeLive = async (l, viewer) => ({
    id: l.id,
    title: l.title,
    startedAt: l.started_at,
    endedAt: l.ended_at || null,
    host: { ...authorOf({ ...l, id: l.user_id }), id: l.user_id },
    viewers: await viewersOf(l.id),
    likes: l.likes,
    diamonds: l.diamonds,
    isHost: Boolean(viewer && viewer.id === l.user_id),
    following: viewer ? Boolean(await db.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', viewer.id, l.user_id)) : false,
  });

  async function events(liveId, after) {
    const rows = await db.all(
      `SELECT e.*, u.username, u.display_name, u.avatar, u.verified_at FROM live_events e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.live_id = ? AND e.id > ? ORDER BY e.id ASC LIMIT 100`,
      liveId, after || 0,
    );
    return rows.map((e) => ({
      id: e.id,
      type: e.type,
      user: e.username ? authorOf({ ...e, user_id: e.user_id }) : null,
      body: e.body,
      gift: e.gift ? giftById(e.gift) : null,
      count: e.count,
      createdAt: e.created_at,
    }));
  }

  const addEvent = (liveId, userId, type, { body = '', gift = null, count = 1 } = {}) =>
    db.run('INSERT INTO live_events (live_id, user_id, type, body, gift, count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', liveId, userId, type, body, gift, count, Date.now());

  // Directs en cours (les plus regardés d'abord)
  r.get('/live', async (req, res) => {
    await sweep();
    const rows = await db.all(
      `SELECT l.id, l.title, l.started_at, l.likes, u.id AS user_id, u.username, u.display_name, u.avatar, u.verified_at,
              (SELECT COUNT(*) FROM live_viewers lw WHERE lw.live_id = l.id AND lw.last_seen > ${NOW_MS} - ${VIEWER_TIMEOUT}) AS viewers,
              EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = v.id AND f.followee_id = u.id) AS following
       FROM ${VIEWER} CROSS JOIN lives l JOIN users u ON u.id = l.user_id
       WHERE l.ended_at IS NULL AND l.last_beat > ${NOW_MS} - ${BEAT_TIMEOUT} AND u.banned_at IS NULL
         AND (u.private_account = 0 OR u.id = v.id OR EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id = v.id AND f2.followee_id = u.id))
         AND NOT ${BLOCKED_WITH('u.id')}
       ORDER BY following DESC, viewers DESC, l.started_at DESC LIMIT 60`,
      req.user?.id || 0,
    );
    res.json({ lives: rows.map((l) => ({ id: l.id, title: l.title, startedAt: l.started_at, likes: l.likes, viewers: l.viewers, following: Boolean(l.following), host: authorOf(l) })) });
  });

  // Le direct en cours d'un compte (lien /live/nom)
  r.get('/live/user/:username', async (req, res) => {
    await sweep();
    const u = await db.get('SELECT id FROM users WHERE username = ? AND banned_at IS NULL', String(req.params.username));
    if (!u) fail(404, 'Ce compte est introuvable.', 'USER_NOT_FOUND');
    const l = u && (await db.get('SELECT id FROM lives WHERE user_id = ? AND ended_at IS NULL AND last_beat > ? ORDER BY id DESC LIMIT 1', u.id, Date.now() - BEAT_TIMEOUT));
    if (!l) fail(404, 'Ce compte n’est pas en LIVE en ce moment.', 'NOT_LIVE');
    req.params.id = String(l.id);
    const live = await loadLive(req);
    res.json({ live: await serializeLive(live, req.user), iceServers: config.ice });
  });

  r.get('/live/:id', async (req, res) => {
    const live = await loadLive(req, { open: false });
    res.json({ live: await serializeLive(live, req.user), iceServers: config.ice });
  });

  // Passer en LIVE
  r.post('/live', requireAuth, async (req, res) => {
    const title = text(req.body?.title, { field: 'Titre', max: 80 });
    if (title) assertClean('Titre du LIVE', title);
    const now = Date.now();
    await db.run('UPDATE lives SET ended_at = ? WHERE user_id = ? AND ended_at IS NULL', now, req.user.id);
    const { lastInsertRowid: id } = await db.run('INSERT INTO lives (user_id, title, started_at, last_beat) VALUES (?, ?, ?, ?)', req.user.id, title, now, now);
    // Les abonnés sont prévenus (les plus récents d'abord, 200 au plus)
    const followers = await db.all('SELECT follower_id FROM follows WHERE followee_id = ? ORDER BY created_at DESC LIMIT 200', req.user.id);
    for (const f of followers) await notify(ctx, { userId: f.follower_id, actorId: req.user.id, type: 'live', liveId: id, body: title });
    req.params.id = String(id);
    res.status(201).json({ live: await serializeLive(await loadLive(req), req.user), iceServers: config.ice });
  });

  // Le créateur, toutes les secondes : signe de vie, nouveaux spectateurs à relier, fil du direct
  r.get('/live/:id/host', requireAuth, async (req, res) => {
    const live = await loadLive(req);
    if (live.user_id !== req.user.id) fail(403, 'Réservé au créateur du LIVE.');
    const now = Date.now();
    await db.run('UPDATE lives SET last_beat = ? WHERE id = ?', now, live.id);
    const offers = await db.all("SELECT id, peer, sdp FROM live_signals WHERE live_id = ? AND kind = 'offer' AND taken_at IS NULL ORDER BY id LIMIT 20", live.id);
    if (offers.length) await db.run(`UPDATE live_signals SET taken_at = ? WHERE id IN (${offers.map(() => '?').join(',')})`, now, ...offers.map((o) => o.id));
    const gone = await db.all('SELECT peer FROM live_viewers WHERE live_id = ? AND last_seen <= ? AND last_seen > ?', live.id, now - VIEWER_TIMEOUT, now - VIEWER_TIMEOUT - 30e3);
    const fresh = await db.get('SELECT likes, diamonds FROM lives WHERE id = ?', live.id);
    res.json({
      offers: offers.map((o) => ({ peer: o.peer, sdp: o.sdp })),
      gone: gone.map((g) => g.peer),
      events: await events(live.id, intParam(req.query.after)),
      viewers: await viewersOf(live.id),
      likes: fresh.likes,
      diamonds: fresh.diamonds,
    });
  });

  r.post('/live/:id/answer', requireAuth, async (req, res) => {
    const live = await loadLive(req);
    if (live.user_id !== req.user.id) fail(403, 'Réservé au créateur du LIVE.');
    const peer = String(req.body?.peer || '');
    const sdp = String(req.body?.sdp || '');
    if (!/^[a-f0-9]{16}$/.test(peer) || !sdp || sdp.length > MAX_SDP) fail(400, 'Réponse invalide.');
    await db.run("INSERT INTO live_signals (live_id, peer, kind, sdp, created_at) VALUES (?, ?, 'answer', ?, ?)", live.id, peer, sdp, Date.now());
    res.json({ ok: true });
  });

  // Fin du direct : bilan
  r.post('/live/:id/end', requireAuth, async (req, res) => {
    const live = await loadLive(req, { open: false });
    if (live.user_id !== req.user.id && !req.user.is_admin) fail(403, 'Réservé au créateur du LIVE.');
    const now = live.ended_at || Date.now();
    await db.run('UPDATE lives SET ended_at = ? WHERE id = ?', now, live.id);
    await addEvent(live.id, live.user_id, 'end');
    const fresh = await db.get('SELECT * FROM lives WHERE id = ?', live.id);
    const { n } = await db.get('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ? AND created_at BETWEEN ? AND ?', live.user_id, live.started_at, now);
    res.json({ summary: { duration: now - live.started_at, peakViewers: fresh.peak_viewers, viewersTotal: fresh.viewers_total, likes: fresh.likes, diamonds: fresh.diamonds, newFollowers: n } });
  });

  // Spectateur : arrivée (un identifiant de connexion lui est donné)
  r.post('/live/:id/join', async (req, res) => {
    const live = await loadLive(req);
    if (req.user?.id === live.user_id) fail(400, 'Tu es le créateur de ce LIVE.');
    const now = Date.now();
    let peer = String(req.body?.peer || '');
    if (!/^[a-f0-9]{16}$/.test(peer)) peer = crypto.randomBytes(8).toString('hex');
    const known = await db.get('SELECT 1 FROM live_viewers WHERE live_id = ? AND peer = ?', live.id, peer);
    if (!known && (await viewersOf(live.id)) >= config.liveMaxViewers) {
      fail(409, `Ce LIVE est complet (${config.liveMaxViewers} spectateurs). Réessaie dans un instant.`, 'LIVE_FULL');
    }
    await db.run(
      `INSERT INTO live_viewers (live_id, peer, user_id, joined_at, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(live_id, peer) DO UPDATE SET last_seen = excluded.last_seen`,
      live.id, peer, req.user?.id || null, now, now,
    );
    if (!known) {
      const viewers = await viewersOf(live.id);
      // Un compte qui revient (rechargement, recharge de pièces) ne compte qu'une fois
      const seen = req.user && (await db.get("SELECT 1 FROM live_events WHERE live_id = ? AND user_id = ? AND type = 'join'", live.id, req.user.id));
      await db.run(`UPDATE lives SET ${seen ? '' : 'viewers_total = viewers_total + 1, '}peak_viewers = MAX(peak_viewers, ?) WHERE id = ?`, viewers, live.id);
      if (req.user && !seen) await addEvent(live.id, req.user.id, 'join');
    }
    const last = await db.get('SELECT COALESCE(MAX(id), 0) AS id FROM live_events WHERE live_id = ?', live.id);
    res.json({ peer, iceServers: config.ice, live: await serializeLive(live, req.user), recent: await events(live.id, Math.max(0, last.id - 30)) });
  });

  // Offre WebRTC du spectateur (renvoyée après une coupure : la connexion est refaite)
  r.post('/live/:id/offer', async (req, res) => {
    const live = await loadLive(req);
    const peer = String(req.body?.peer || '');
    const sdp = String(req.body?.sdp || '');
    if (!/^[a-f0-9]{16}$/.test(peer) || !sdp || sdp.length > MAX_SDP) fail(400, 'Offre invalide.');
    if (!(await db.get('SELECT 1 FROM live_viewers WHERE live_id = ? AND peer = ?', live.id, peer))) fail(409, 'Rejoins d’abord le LIVE.');
    await db.run('DELETE FROM live_signals WHERE live_id = ? AND peer = ?', live.id, peer);
    await db.run("INSERT INTO live_signals (live_id, peer, kind, sdp, created_at) VALUES (?, ?, 'offer', ?, ?)", live.id, peer, sdp, Date.now());
    res.json({ ok: true });
  });

  // Spectateur, toutes les secondes et demie : réponse du créateur, fil du direct, état
  r.get('/live/:id/poll', async (req, res) => {
    const id = intParam(req.params.id);
    const live = await loadLive(req, { open: false });
    const peer = String(req.query.peer || '');
    const now = Date.now();
    let answer = null;
    if (/^[a-f0-9]{16}$/.test(peer)) {
      await db.run('UPDATE live_viewers SET last_seen = ? WHERE live_id = ? AND peer = ?', now, id, peer);
      const a = await db.get("SELECT id, sdp FROM live_signals WHERE live_id = ? AND peer = ? AND kind = 'answer' AND taken_at IS NULL ORDER BY id DESC LIMIT 1", id, peer);
      if (a) {
        await db.run('UPDATE live_signals SET taken_at = ? WHERE id = ?', now, a.id);
        answer = a.sdp;
      }
    }
    const ended = Boolean(live.ended_at) || live.last_beat < now - BEAT_TIMEOUT;
    res.json({ answer, ended, events: await events(id, intParam(req.query.after)), viewers: await viewersOf(id), likes: live.likes });
  });

  r.post('/live/:id/leave', async (req, res) => {
    const peer = String(req.body?.peer || '');
    await db.run('DELETE FROM live_viewers WHERE live_id = ? AND peer = ?', intParam(req.params.id), peer);
    await db.run('DELETE FROM live_signals WHERE live_id = ? AND peer = ?', intParam(req.params.id), peer);
    res.json({ ok: true });
  });

  r.post('/live/:id/comment', requireAuth, async (req, res) => {
    const live = await loadLive(req);
    const body = text(req.body?.body, { field: 'Commentaire', max: 150, required: true });
    const flagged = moderate(body);
    if (flagged) fail(422, 'Ce commentaire contient des propos déplacés : il n’a pas été publié.', 'CONTENT_BLOCKED');
    await addEvent(live.id, req.user.id, 'comment', { body });
    res.status(201).json({ ok: true });
  });

  // Cœurs (les touchers sont regroupés par le téléphone)
  r.post('/live/:id/like', async (req, res) => {
    const live = await loadLive(req);
    const count = Math.max(1, Math.min(50, Math.floor(Number(req.body?.count) || 1)));
    await db.run('UPDATE lives SET likes = likes + ? WHERE id = ?', count, live.id);
    await addEvent(live.id, req.user?.id || null, 'like', { count });
    res.json({ ok: true });
  });

  r.post('/live/:id/gift', requireAuth, async (req, res) => {
    const live = await loadLive(req);
    const out = await sendGift(ctx, { from: req.user, toId: live.user_id, giftId: req.body?.gift, count: req.body?.count, liveId: live.id });
    await addEvent(live.id, req.user.id, 'gift', { gift: out.gift.id, count: out.count });
    res.json({ coins: out.coins });
  });

  // Événements du direct : abonnement au créateur, partage
  r.post('/live/:id/event', requireAuth, async (req, res) => {
    const live = await loadLive(req);
    const type = ['follow', 'share'].includes(req.body?.type) ? req.body.type : null;
    if (!type) fail(400, 'Événement inconnu.');
    await addEvent(live.id, req.user.id, type);
    res.json({ ok: true });
  });

  return r;
};
