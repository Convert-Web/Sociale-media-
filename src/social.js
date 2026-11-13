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

const POST_SELECT = `
  SELECT p.id, p.body, p.image, p.created_at, p.user_id,
         u.username, u.display_name, u.avatar, u.member_number,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked
  FROM posts p JOIN users u ON u.id = p.user_id`;

function serializePost(ctx, row, viewer) {
  const mine = row.user_id === viewer.id;
  return {
    id: row.id,
    body: row.body,
    image: row.image || null,
    createdAt: row.created_at,
    author: authorOf(ctx, row),
    likeCount: row.like_count,
    commentCount: row.comment_count,
    liked: Boolean(row.liked),
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
  SELECT n.id, n.type, n.post_id, n.created_at, n.read_at,
         a.id AS user_id, a.username, a.display_name, a.avatar, a.member_number,
         p.body AS post_body, p.image AS post_image
  FROM notifications n
  JOIN users a ON a.id = n.actor_id
  LEFT JOIN posts p ON p.id = n.post_id`;

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
  };
}

async function counters(ctx, userId) {
  const row = await ctx.db.get(
    `SELECT (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL) AS n,
            (SELECT COUNT(*) FROM messages WHERE recipient_id = ? AND read_at IS NULL) AS m`,
    userId, userId,
  );
  return { notifications: row.n, messages: row.m };
}

async function pushCounters(ctx, userId) {
  if (ctx.hub.isOnline(userId)) ctx.hub.send(userId, 'counters', await counters(ctx, userId));
}

async function notify(ctx, { userId, actorId, type, postId = null }) {
  if (!userId || userId === actorId) return;
  if (type === 'like' || type === 'follow') {
    // Pas de doublon pour une même action répétée
    const existing = await ctx.db.get(
      'SELECT id FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND post_id IS ?',
      userId, actorId, type, postId,
    );
    if (existing) return;
  }
  const { lastInsertRowid } = await ctx.db.run(
    'INSERT INTO notifications (user_id, actor_id, type, post_id, created_at) VALUES (?, ?, ?, ?, ?)',
    userId, actorId, type, postId, Date.now(),
  );
  if (ctx.hub.isOnline(userId)) {
    const row = await ctx.db.get(`${NOTIF_SELECT} WHERE n.id = ?`, lastInsertRowid);
    ctx.hub.send(userId, 'notification', serializeNotification(ctx, row));
    await pushCounters(ctx, userId);
  }
}

async function retractNotification(ctx, { userId, actorId, type, postId = null }) {
  await ctx.db.run(
    'DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND post_id IS ?',
    userId, actorId, type, postId,
  );
  await pushCounters(ctx, userId);
}

const MENTION_RE = /(^|[^\w@.])@([a-z0-9_.]{3,20})/gi;

async function notifyMentions(ctx, text, actorId, postId) {
  const names = new Set();
  for (const m of text.matchAll(MENTION_RE)) {
    names.add(m[2].replace(/\.+$/, '').toLowerCase());
    if (names.size >= 10) break;
  }
  for (const name of names) {
    const u = await ctx.db.get('SELECT id FROM users WHERE username = ? AND paid_at IS NOT NULL', name);
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
