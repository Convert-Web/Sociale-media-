'use strict';

// Sérialisation et logique sociale partagée entre les routes.

function isFounder(ctx, memberNumber) {
  return memberNumber != null && memberNumber <= ctx.config.founderLimit;
}

function authorOf(ctx, row, prefix = '') {
  return {
    id: row[`${prefix}user_id`] ?? row.id,
    username: row[`${prefix}username`],
    displayName: row[`${prefix}display_name`],
    avatar: row[`${prefix}avatar`] || null,
    memberNumber: row[`${prefix}member_number`] ?? null,
    founder: isFounder(ctx, row[`${prefix}member_number`]),
  };
}

function publicUser(ctx, u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar || null,
    cover: u.cover || null,
    bio: u.bio,
    city: u.city,
    profession: u.profession,
    website: u.website,
    memberNumber: u.member_number ?? null,
    founder: isFounder(ctx, u.member_number),
    joinedAt: u.paid_at || u.created_at,
    online: ctx.hub.isOnline(u.id),
  };
}

function selfUser(ctx, u) {
  return {
    ...publicUser(ctx, u),
    email: u.email,
    isMember: Boolean(u.paid_at),
    isAdmin: Boolean(u.is_admin),
  };
}

// Réactions disponibles (la première est celle d'un simple toucher).
const REACTIONS = ['love', 'like', 'bravo', 'fire', 'haha', 'wow'];

// Le seul paramètre de POST_SELECT est l'identifiant du membre qui consulte (v.id) ;
// il précède tous les paramètres de la clause WHERE ajoutée par l'appelant.
const POST_SELECT = `
  SELECT p.id, p.body, p.image, p.created_at, p.edited_at, p.user_id, p.groupe_id,
         u.username, u.display_name, u.avatar, u.member_number,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT GROUP_CONCAT(l.reaction) FROM likes l WHERE l.post_id = p.id) AS reactions,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         (SELECT l.reaction FROM likes l WHERE l.post_id = p.id AND l.user_id = v.id) AS my_reaction,
         EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = v.id) AS saved,
         (SELECT GROUP_CONCAT(pm.url, '|') FROM post_media pm WHERE pm.post_id = p.id) AS media
  FROM (SELECT ? AS id) v
  CROSS JOIN posts p
  JOIN users u ON u.id = p.user_id`;

// Publications hors groupes (fil, profils, recherche, tendances).
const PUBLIC_POST = 'p.groupe_id IS NULL';
// Publications visibles par le lecteur v.id : publiques ou de ses groupes.
const VISIBLE_POST = `(p.groupe_id IS NULL OR p.groupe_id IN (SELECT groupe_id FROM groupe_members WHERE user_id = v.id AND status = 'member'))`;

// À ajouter dans la clause WHERE d'une requête POST_SELECT : masque les membres bloqués.
const NOT_BLOCKED = `p.user_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = v.id
                                       UNION SELECT blocker_id FROM blocks WHERE blocked_id = v.id)`;

// Vrai si l'un des deux membres a bloqué l'autre.
async function isBlocked(ctx, a, b) {
  return Boolean(
    await ctx.db.get('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', a, b, b, a),
  );
}

function reactionSummary(list) {
  const counts = {};
  for (const r of (list || '').split(',').filter(Boolean)) counts[r] = (counts[r] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
}

function serializePost(ctx, row, viewer) {
  const mine = row.user_id === viewer.id;
  const images = [row.image, ...(row.media ? row.media.split('|') : [])].filter(Boolean);
  return {
    id: row.id,
    body: row.body,
    image: images[0] || null,
    images,
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    groupId: row.groupe_id || null,
    author: authorOf(ctx, row),
    likeCount: row.like_count,
    reactions: reactionSummary(row.reactions),
    myReaction: row.my_reaction || null,
    liked: Boolean(row.my_reaction),
    saved: Boolean(row.saved),
    commentCount: row.comment_count,
    mine,
    canDelete: mine || Boolean(viewer.is_admin),
  };
}

async function getPost(ctx, postId, viewer) {
  const row = await ctx.db.get(`${POST_SELECT} WHERE p.id = ?`, viewer.id, postId);
  return row ? serializePost(ctx, row, viewer) : null;
}

const COMMENT_SELECT = `
  SELECT c.id, c.post_id, c.body, c.created_at, c.user_id,
         u.username, u.display_name, u.avatar, u.member_number
  FROM comments c JOIN users u ON u.id = c.user_id`;

function serializeComment(ctx, row, viewer) {
  return {
    id: row.id,
    postId: row.post_id,
    body: row.body,
    createdAt: row.created_at,
    author: authorOf(ctx, row),
    canDelete: row.user_id === viewer.id || Boolean(viewer.is_admin),
  };
}

const NOTIF_SELECT = `
  SELECT n.id, n.type, n.post_id, n.groupe_id, n.created_at, n.read_at,
         a.id AS user_id, a.username, a.display_name, a.avatar, a.member_number,
         p.body AS post_body, p.image AS post_image,
         g.name AS groupe_name
  FROM notifications n
  JOIN users a ON a.id = n.actor_id
  LEFT JOIN posts p ON p.id = n.post_id
  LEFT JOIN groupes g ON g.id = n.groupe_id`;

function serializeNotification(ctx, row) {
  return {
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
    read: Boolean(row.read_at),
    actor: authorOf(ctx, row),
    post: row.post_id
      ? { id: row.post_id, excerpt: (row.post_body || '').slice(0, 120), image: row.post_image || null }
      : null,
    group: row.groupe_id ? { id: row.groupe_id, name: row.groupe_name || 'Groupe' } : null,
  };
}

async function counters(ctx, userId) {
  const row = await ctx.db.get(
    `SELECT (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL) AS n,
            (SELECT COUNT(*) FROM messages WHERE recipient_id = ? AND read_at IS NULL) AS m,
            (SELECT COUNT(*) FROM friend_requests WHERE addressee_id = ? AND status = 'pending') AS r`,
    userId, userId, userId,
  );
  return { notifications: row.n, messages: row.m, requests: row.r };
}

async function pushCounters(ctx, userId) {
  if (ctx.hub.isOnline(userId)) ctx.hub.send(userId, 'counters', await counters(ctx, userId));
}

async function notify(ctx, { userId, actorId, type, postId = null, groupId = null }) {
  if (!userId || userId === actorId) return;
  if (['like', 'follow', 'friend_request', 'friend_accept', 'group_invite', 'group_request'].includes(type)) {
    // Pas de doublon pour une même action répétée
    const existing = await ctx.db.get(
      'SELECT id FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND post_id IS ? AND groupe_id IS ?',
      userId, actorId, type, postId, groupId,
    );
    if (existing) return;
  }
  const { lastInsertRowid } = await ctx.db.run(
    'INSERT INTO notifications (user_id, actor_id, type, post_id, groupe_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    userId, actorId, type, postId, groupId, Date.now(),
  );
  if (ctx.hub.isOnline(userId)) {
    const row = await ctx.db.get(`${NOTIF_SELECT} WHERE n.id = ?`, lastInsertRowid);
    ctx.hub.send(userId, 'notification', serializeNotification(ctx, row));
    await pushCounters(ctx, userId);
  }
}

async function retractNotification(ctx, { userId, actorId, type, postId = null, groupId = null }) {
  await ctx.db.run(
    'DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND post_id IS ? AND groupe_id IS ?',
    userId, actorId, type, postId, groupId,
  );
  await pushCounters(ctx, userId);
}

const MENTION_RE = /(^|[^\w@.])@([a-z0-9_.]{3,20})/gi;

// groupId : dans un groupe privé, seuls ses membres sont prévenus.
async function notifyMentions(ctx, text, actorId, postId, groupId = null) {
  const names = new Set();
  for (const m of text.matchAll(MENTION_RE)) {
    names.add(m[2].replace(/\.+$/, '').toLowerCase());
    if (names.size >= 10) break;
  }
  for (const name of names) {
    const u = groupId
      ? await ctx.db.get(
          `SELECT u.id FROM users u JOIN groupe_members gm ON gm.user_id = u.id AND gm.groupe_id = ? AND gm.status = 'member'
           WHERE u.username = ? AND u.paid_at IS NOT NULL`,
          groupId, name,
        )
      : await ctx.db.get('SELECT id FROM users WHERE username = ? AND paid_at IS NOT NULL', name);
    if (u) await notify(ctx, { userId: u.id, actorId, type: 'mention', postId });
  }
}

module.exports = {
  isFounder,
  authorOf,
  publicUser,
  selfUser,
  POST_SELECT,
  serializePost,
  getPost,
  REACTIONS,
  NOT_BLOCKED,
  PUBLIC_POST,
  VISIBLE_POST,
  reactionSummary,
  isBlocked,
  COMMENT_SELECT,
  serializeComment,
  NOTIF_SELECT,
  serializeNotification,
  counters,
  pushCounters,
  notify,
  retractNotification,
  notifyMentions,
};
