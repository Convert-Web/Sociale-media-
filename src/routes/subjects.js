'use strict';
// Le Sujet du jour : le sujet en cours, ses réponses (visibles une fois qu'on a répondu), l'Or d'hier,
// la série de jours ; programmation par l'administration ; tâche planifiée de 19 h.
const express = require('express');
const { requireAdmin } = require('../auth');
const { fail, text, intParam } = require('../http');
const { VIEWER, FRIEND_OF, VISIBLE, POST_SELECT, serializePost, getPost } = require('../social');
const S = require('../subjects');

const PAGE = 18;

module.exports = function subjectRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  const answeredBy = async (s, user) => (user ? db.get('SELECT id FROM posts WHERE subject_id = ? AND user_id = ? ORDER BY id LIMIT 1', s.id, user.id) : null);
  const locked = (s, mine, user) => Date.now() < s.closes_at && !mine && !user?.is_admin;

  // Tout ce que la page du sujet affiche, en une réponse
  async function payload(s, user) {
    const now = Date.now();
    const mine = await answeredBy(s, user);
    const count = (await db.get('SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id WHERE p.subject_id = ? AND u.banned_at IS NULL', s.id)).n;
    const friends = user
      ? await db.all(
          `SELECT u.username, u.display_name, u.avatar FROM ${VIEWER} CROSS JOIN posts p JOIN users u ON u.id = p.user_id
           WHERE p.subject_id = ? AND p.user_id != v.id AND ${FRIEND_OF('p.user_id')} AND u.banned_at IS NULL
           GROUP BY u.id ORDER BY MAX(p.id) DESC LIMIT 6`,
          user.id, s.id,
        )
      : [];
    const friendsCount = user
      ? (await db.get(
          `SELECT COUNT(DISTINCT p.user_id) AS n FROM ${VIEWER} CROSS JOIN posts p WHERE p.subject_id = ? AND p.user_id != v.id AND ${FRIEND_OF('p.user_id')}`,
          user.id, s.id,
        )).n
      : 0;
    // Le sujet précédent et son Or du jour
    const prevRow = await db.get('SELECT * FROM subjects WHERE day < ? AND opens_at <= ? ORDER BY day DESC LIMIT 1', s.day, now);
    const winner = prevRow?.winner_post_id ? await getPost(ctx, prevRow.winner_post_id, user, { admin: false }) : null;
    const gold = s.winner_post_id ? await getPost(ctx, s.winner_post_id, user, { admin: false }) : null;
    return {
      subject: S.serializeSubject(s, now),
      answers: count,
      friends: { count: friendsCount, users: friends.map((f) => ({ username: f.username, displayName: f.display_name, avatar: f.avatar || null })) },
      gold,
      me: user
        ? { answered: Boolean(mine), answerId: mine?.id || null, streak: await S.streakOf(db, user.id, now), golds: await S.goldsOf(db, user.id), locked: locked(s, mine, user) }
        : { answered: false, answerId: null, streak: 0, golds: 0, locked: true },
      previous: prevRow ? { subject: S.serializeSubject(prevRow, now), winner } : null,
      nextAt: S.parisTime(S.shiftDay(S.currentDay(now), 1), S.OPEN_HOUR),
    };
  }

  // Le sujet en cours (créé au premier passage après 19 h ; l'Or d'hier est décerné au passage)
  r.get('/subjects/today', async (req, res) => {
    await S.settle(ctx);
    const s = await S.ensureCurrent(ctx);
    res.json(await payload(s, req.user));
  });

  const load = async (id) => {
    const s = await db.get('SELECT * FROM subjects WHERE id = ?', intParam(id));
    if (!s) fail(404, 'Ce sujet n’existe pas.');
    return s;
  };

  r.get('/subjects/:id', async (req, res) => {
    const s = await load(req.params.id);
    if (Date.now() < s.opens_at && !req.user?.is_admin) fail(404, 'Ce sujet n’est pas encore ouvert.');
    res.json(await payload(s, req.user));
  });

  // Réponses : amis (« friends »), les plus aimées (« best ») ou les plus récentes (« recent »).
  // Sujet en cours : il faut avoir répondu pour les voir.
  r.get('/subjects/:id/answers', async (req, res) => {
    const s = await load(req.params.id);
    const mine = await answeredBy(s, req.user);
    if (locked(s, mine, req.user)) return res.json({ locked: true, posts: [], hasMore: false });
    const sort = ['friends', 'best', 'recent'].includes(req.query.sort) ? req.query.sort : 'best';
    const page = Math.max(0, Math.min(200, Number(req.query.page) || 0));
    const vid = req.user?.id || 0;
    const where = `p.subject_id = ? AND ${VISIBLE}${sort === 'friends' ? ` AND (p.user_id = v.id OR ${FRIEND_OF('p.user_id')})` : ''}`;
    const order = sort === 'best' ? 'like_count DESC, view_count DESC, p.id DESC' : 'p.id DESC';
    const rows = await db.all(`${POST_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, vid, s.id, PAGE + 1, page * PAGE);
    res.json({ locked: false, posts: rows.slice(0, PAGE).map((row) => serializePost(ctx, row, req.user)), hasMore: rows.length > PAGE });
  });

  // ── Administration : sujets passés et à venir, sujet programmé (partenaire, lot) ──────
  r.get('/admin/subjects', requireAdmin, async (_req, res) => {
    const now = Date.now();
    await S.ensureCurrent(ctx, now);
    const today = S.currentDay(now);
    const rows = await db.all(
      `SELECT s.*, (SELECT COUNT(*) FROM posts p WHERE p.subject_id = s.id) AS answers,
              (SELECT u.username FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = s.winner_post_id) AS winner
       FROM subjects s WHERE s.day <= ? ORDER BY s.day DESC LIMIT 30`,
      today,
    );
    // Les 7 prochains jours : sujet programmé, ou thème qui sera tiré automatiquement
    const ahead = await db.all('SELECT * FROM subjects WHERE day > ? AND day <= ? ORDER BY day', today, S.shiftDay(today, 7));
    const planned = new Map(ahead.map((x) => [x.day, x]));
    const upcoming = [];
    for (let i = 1; i <= 7; i++) {
      const day = S.shiftDay(today, i);
      const theme = S.RHYTHM[new Date(`${day}T12:00:00Z`).getUTCDay()];
      upcoming.push({ day, theme: S.LABELS[theme], planned: planned.has(day) ? S.serializeSubject(planned.get(day), now) : null });
    }
    res.json({
      subjects: rows.map((x) => ({ ...S.serializeSubject(x, now), answers: x.answers, winner: x.winner || null, notified: Boolean(x.notified_at) })),
      upcoming,
      cron: Boolean(config.cronSecret),
    });
  });

  // Programmer (ou modifier) le sujet d'un jour à venir : il passera avant le choix automatique
  r.post('/admin/subjects', requireAdmin, async (req, res) => {
    const b = req.body || {};
    if (!S.isDay(b.day)) fail(400, 'Date invalide.');
    const title = text(b.title, { field: 'Sujet', max: 120, required: true });
    const sponsor = text(b.sponsor || '', { field: 'Partenaire', max: 60 }) || null;
    const prize = text(b.prize || '', { field: 'Lot', max: 80 }) || null;
    const opens = S.parisTime(b.day, S.OPEN_HOUR);
    if (opens <= Date.now()) fail(400, 'Ce jour est déjà commencé : choisis une date à venir.');
    const kind = sponsor ? 'marque' : ['debat', 'defi', 'souvenir', 'fun', 'montre', 'conseil', 'actu'].includes(b.kind) ? b.kind : 'fun';
    await db.run(
      `INSERT INTO subjects (day, title, kind, sponsor, prize, planned_by, opens_at, closes_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET title = excluded.title, kind = excluded.kind, sponsor = excluded.sponsor, prize = excluded.prize,
         planned_by = excluded.planned_by, pool_key = NULL, journal_id = NULL`,
      b.day, title, kind, sponsor, prize, req.user.id, opens, S.parisTime(S.shiftDay(b.day, 1), S.OPEN_HOUR), Date.now(),
    );
    res.status(201).json({ subject: S.serializeSubject(await db.get('SELECT * FROM subjects WHERE day = ?', b.day)) });
  });

  // Retirer un sujet programmé (pas encore ouvert) : le choix automatique reprend la main
  r.delete('/admin/subjects/:id', requireAdmin, async (req, res) => {
    const s = await db.get('SELECT * FROM subjects WHERE id = ?', intParam(req.params.id));
    if (!s) fail(404, 'Ce sujet n’existe pas.');
    if (s.opens_at <= Date.now()) fail(400, 'Ce sujet est déjà ouvert.');
    await db.run('DELETE FROM subjects WHERE id = ?', s.id);
    res.json({ ok: true });
  });

  // ── Tâche planifiée de 19 h (Vercel Cron) : Or d'hier, sujet du jour, notification à tous ──
  r.get('/cron/subject', async (req, res) => {
    if (config.cronSecret && req.get('authorization') !== `Bearer ${config.cronSecret}`) fail(401, 'Accès refusé.');
    res.setHeader('Cache-Control', 'no-store');
    res.json(await S.tick(ctx));
  });

  return r;
};
