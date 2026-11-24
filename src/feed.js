'use strict';
// Algorithme « Pour toi » : chaque vidéo reçoit une note qui mêle
//   - sa qualité (J'aime, commentaires, partages, favoris, republications, rapportés à ses spectateurs),
//   - le temps qu'on reste dessus (part moyenne de la vidéo regardée),
//   - sa fraîcheur,
//   - les centres d'intérêt appris de la personne (hashtags, créateurs, sons, catégories),
//   - un coup de pouce aux nouvelles vidéos (elles doivent pouvoir trouver leur public),
//   - une part de hasard (découverte).
// Les centres d'intérêt s'apprennent de ce que l'on regarde jusqu'au bout, aime, commente, partage,
// garde en favori… et de ce que l'on passe vite ou marque « Pas intéressé ». Ils s'estompent avec le temps.
const { VIEWER, VISIBLE, getPosts } = require('./social');

const HALF_LIFE = 21 * 86400e3; // un intérêt perd la moitié de son poids en 3 semaines
const MIN_SCORE = -30;
const MAX_SCORE = 60;

// Ce qui décrit une publication pour l'algorithme
async function postSignals(db, postId) {
  const row = await db.get(
    `SELECT p.user_id, p.sound_id, p.category, (SELECT GROUP_CONCAT(tag, ' ') FROM post_tags t WHERE t.post_id = p.id) AS tags
     FROM posts p WHERE p.id = ?`,
    postId,
  );
  if (!row) return null;
  return { author: row.user_id, sound: row.sound_id, category: row.category, tags: row.tags ? row.tags.split(' ').slice(0, 12) : [] };
}

// Ajoute « weight » aux intérêts liés à une publication (ou à un créateur seul)
async function learn(ctx, userId, target, weight) {
  if (!userId || !weight) return;
  const info = typeof target === 'number' ? await postSignals(ctx.db, target) : target;
  if (!info) return;
  if (info.author === userId) return; // ses propres vidéos n'apprennent rien
  const deltas = new Map();
  const add = (kind, key, w) => {
    if (key === null || key === undefined || key === '') return;
    const k = `${kind}\u0000${key}`;
    deltas.set(k, (deltas.get(k) || 0) + w);
  };
  if (info.author) add('author', String(info.author), weight * 1.2);
  if (info.sound) add('sound', String(info.sound), weight * 0.6);
  if (info.category) add('cat', info.category, weight * 0.8);
  const tags = info.tags || [];
  const per = tags.length ? weight / Math.sqrt(tags.length) : 0;
  for (const t of tags) add('tag', t, per);
  if (!deltas.size) return;
  const keys = [...deltas.keys()].map((k) => k.split('\u0000'));
  const now = Date.now();
  const existing = await ctx.db.all(
    `SELECT kind, key, score, updated_at FROM interests WHERE user_id = ? AND (${keys.map(() => '(kind = ? AND key = ?)').join(' OR ')})`,
    userId, ...keys.flat(),
  );
  const old = new Map(existing.map((r) => [`${r.kind}\u0000${r.key}`, r]));
  const values = [];
  for (const [k, delta] of deltas) {
    const prev = old.get(k);
    const decayed = prev ? prev.score * Math.pow(0.5, Math.max(0, now - prev.updated_at) / HALF_LIFE) : 0;
    const score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, decayed + delta));
    const [kind, key] = k.split('\u0000');
    values.push(userId, kind, key, Math.round(score * 1000) / 1000, now);
  }
  await ctx.db.run(
    `INSERT INTO interests (user_id, kind, key, score, updated_at) VALUES ${[...deltas.keys()].map(() => '(?, ?, ?, ?, ?)').join(', ')}
     ON CONFLICT(user_id, kind, key) DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
    ...values,
  );
}

// Poids des signaux
const SIGNALS = {
  like: 3,
  unlike: -3,
  comment: 4,
  share: 4,
  favorite: 3,
  repost: 3,
  follow: 6,
  notInterested: -8,
  completed: 2, // regardée jusqu'au bout (ou plusieurs fois)
  half: 1, // regardée à moitié
  skipped: -1, // passée en moins d'une seconde et demie
};

async function loadInterests(db, userId) {
  if (!userId) return null;
  const rows = await db.all('SELECT kind, key, score, updated_at FROM interests WHERE user_id = ? ORDER BY ABS(score) DESC LIMIT 400', userId);
  const now = Date.now();
  const map = { author: new Map(), sound: new Map(), cat: new Map(), tag: new Map() };
  for (const r of rows) map[r.kind]?.set(r.key, r.score * Math.pow(0.5, Math.max(0, now - r.updated_at) / HALF_LIFE));
  return map;
}

const squash = (x, k) => Math.tanh(x / k);

function score(row, interests, now, rand) {
  const ageH = Math.max(0, (now - row.created_at) / 3.6e6);
  const fresh = Math.exp(-ageH / 120); // ~5 jours
  const viewers = Math.max(row.viewers, Math.round((row.guest_views || 0) / 2));
  const engagement = row.likes + 2 * row.comments + 3 * (row.share_count || 0) + 2 * row.saves + 2 * row.reposts;
  const quality = Math.min(1, ((engagement + 1) / (viewers + 8)) * 1.6);
  // Part regardée, lissée (une vidéo peu vue reste proche de la moyenne)
  const completion = (row.completion * row.watched + 0.45 * 6) / (row.watched + 6);
  // Nouvelle vidéo : coup de pouce pour qu'elle trouve son public
  const boost = viewers < 20 ? 0.22 * (1 - viewers / 20) : 0;
  let personal = 0;
  if (interests) {
    personal += squash(interests.author.get(String(row.user_id)) || 0, 8) * 0.9;
    if (row.sound_id) personal += squash(interests.sound.get(String(row.sound_id)) || 0, 6) * 0.35;
    if (row.category) personal += squash(interests.cat.get(row.category) || 0, 8) * 0.5;
    const tags = row.tags ? row.tags.split(' ') : [];
    let t = 0;
    for (const tag of tags) t += interests.tag.get(tag) || 0;
    if (tags.length) personal += squash(t / Math.sqrt(tags.length), 6) * 0.7;
    if (row.follows) personal += 0.25;
  }
  let s = 0.3 * quality + 0.22 * completion + 0.16 * fresh + 0.3 * Math.max(-1, Math.min(1.5, personal)) + boost + 0.12 * rand();
  if (row.seen) s -= 0.6; // déjà vue : seulement quand il n'y a plus de nouveautés
  return s;
}

// Une page de « Pour toi » : exclude = publications déjà montrées pendant cette visite
async function forYou(ctx, viewer, { exclude = [], limit = 8, rand = Math.random } = {}) {
  const vid = viewer?.id || 0;
  const ex = exclude.slice(-300);
  const exSql = ex.length ? `AND p.id NOT IN (${ex.map(() => '?').join(',')})` : '';
  const rows = await ctx.db.all(
    `SELECT p.id, p.user_id, p.sound_id, p.category, p.created_at, p.share_count, p.guest_views,
       (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments,
       (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id) AS saves,
       (SELECT COUNT(*) FROM reposts r WHERE r.post_id = p.id) AS reposts,
       (SELECT COUNT(*) FROM video_views vv WHERE vv.post_id = p.id) AS viewers,
       (SELECT COUNT(*) FROM video_views vv WHERE vv.post_id = p.id AND vv.watch_ms > 0) AS watched,
       (SELECT COALESCE(AVG(vv.ratio), 0) FROM video_views vv WHERE vv.post_id = p.id AND vv.watch_ms > 0) AS completion,
       (SELECT GROUP_CONCAT(t.tag, ' ') FROM post_tags t WHERE t.post_id = p.id) AS tags,
       EXISTS(SELECT 1 FROM video_views vv WHERE vv.post_id = p.id AND vv.user_id = v.id) AS seen,
       EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = v.id AND f.followee_id = p.user_id) AS follows
     FROM ${VIEWER} CROSS JOIN posts p JOIN users u ON u.id = p.user_id
     WHERE (p.video_id IS NOT NULL OR p.image IS NOT NULL OR p.bg IS NOT NULL) AND p.user_id != v.id AND ${VISIBLE}
       AND NOT EXISTS (SELECT 1 FROM not_interested ni WHERE ni.user_id = v.id AND (ni.post_id = p.id OR (ni.post_id = 0 AND ni.author_id = p.user_id)))
       ${exSql}
     ORDER BY p.id DESC LIMIT 500`,
    vid, ...ex,
  );
  // Fil non personnalisé (réglage) : seulement popularité, fraîcheur et découverte
  const interests = viewer && viewer.personalized === 0 ? null : await loadInterests(ctx.db, vid);
  const now = Date.now();
  const scored = rows.map((r) => ({ r, s: score(r, interests, now, rand) })).sort((a, b) => b.s - a.s);
  // Variété : un même créateur et un même son une fois par page (sauf s'il ne reste que lui)
  const picked = [];
  const authors = new Set();
  const sounds = new Set();
  for (const pass of [true, false]) {
    for (const x of scored) {
      if (picked.length >= limit) break;
      if (picked.includes(x)) continue;
      if (pass && (authors.has(x.r.user_id) || (x.r.sound_id && sounds.has(x.r.sound_id)))) continue;
      picked.push(x);
      authors.add(x.r.user_id);
      if (x.r.sound_id) sounds.add(x.r.sound_id);
    }
  }
  const posts = await getPosts(ctx, picked.map((x) => x.r.id), viewer);
  return { posts, hasMore: rows.length > picked.length };
}

// « Abonnements » : publications et republications des comptes suivis, de la plus récente à la plus ancienne
async function followingFeed(ctx, viewer, { before = null, limit = 10 } = {}) {
  const items = await ctx.db.all(
    `SELECT post_id, at, reposter_id FROM (
       SELECT p.id AS post_id, p.created_at AS at, NULL AS reposter_id FROM posts p
       WHERE p.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?) AND (p.video_id IS NOT NULL OR p.image IS NOT NULL OR p.bg IS NOT NULL)
       UNION ALL
       SELECT r.post_id, r.created_at AS at, r.user_id AS reposter_id FROM reposts r
       WHERE r.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)
     ) WHERE (? IS NULL OR at < ?) ORDER BY at DESC LIMIT ?`,
    viewer.id, viewer.id, before, before, limit * 2,
  );
  const seen = new Set();
  const order = [];
  for (const it of items) {
    if (seen.has(it.post_id)) continue;
    seen.add(it.post_id);
    order.push(it);
  }
  const posts = await getPosts(ctx, order.map((x) => x.post_id), viewer);
  const reposters = order.filter((x) => x.reposter_id).map((x) => x.reposter_id);
  const names = reposters.length
    ? new Map((await ctx.db.all(`SELECT id, username, display_name FROM users WHERE id IN (${reposters.map(() => '?').join(',')})`, ...reposters)).map((u) => [u.id, u]))
    : new Map();
  const by = new Map(order.map((x) => [x.post_id, x.reposter_id]));
  for (const p of posts) {
    const r = names.get(by.get(p.id));
    if (r && p.author.id !== r.id) p.repostedBy = { username: r.username, displayName: r.display_name };
  }
  const last = items[items.length - 1];
  return { posts: posts.filter((p) => !p.mine || p.repostedBy), cursor: items.length === limit * 2 && last ? last.at : null };
}

// « Amis » : publications des abonnements réciproques
async function friendsFeed(ctx, viewer, { before = null, limit = 10 } = {}) {
  const rows = await ctx.db.all(
    `SELECT p.id FROM posts p
     WHERE p.user_id IN (SELECT a.followee_id FROM follows a JOIN follows b ON b.follower_id = a.followee_id AND b.followee_id = a.follower_id WHERE a.follower_id = ?)
       AND (p.video_id IS NOT NULL OR p.image IS NOT NULL OR p.bg IS NOT NULL) AND (? IS NULL OR p.id < ?)
     ORDER BY p.id DESC LIMIT ?`,
    viewer.id, before, before, limit,
  );
  const posts = await getPosts(ctx, rows.map((r) => r.id), viewer);
  return { posts, cursor: rows.length === limit ? rows[rows.length - 1].id : null };
}

module.exports = { forYou, followingFeed, friendsFeed, learn, postSignals, loadInterests, score, SIGNALS };
