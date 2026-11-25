'use strict';
// Sérialisation et logique sociale partagée entre les routes.
const { detectLang } = require('./translate');
const { extractMentions } = require('./tags');

// Spectateur courant dans les requêtes SQL : « v.id » (0 sans compte) et « v.admin ».
// Le seul paramètre de ces sélections est l'identifiant du spectateur, placé en premier.
const VIEWER = '(SELECT x.id, COALESCE((SELECT is_admin FROM users WHERE id = x.id), 0) AS admin FROM (SELECT ? AS id) x) v';
const NOW_MS = "(CAST(strftime('%s','now') AS INTEGER) * 1000)";
// LIVE en cours d'un compte (le direct qui ne donne plus signe de vie depuis 45 s ne compte plus)
const LIVE_OF = (col) => `(SELECT lv.id FROM lives lv WHERE lv.user_id = ${col} AND lv.ended_at IS NULL AND lv.last_beat > ${NOW_MS} - 45000 ORDER BY lv.id DESC LIMIT 1)`;

// Comptes bloqués dans un sens ou dans l'autre
const BLOCKED_WITH = (col) => `${col} IN (SELECT blocked_id FROM blocks WHERE blocker_id = v.id UNION SELECT blocker_id FROM blocks WHERE blocked_id = v.id)`;

// Amis = abonnements réciproques
const FRIEND_OF = (col) => `(EXISTS (SELECT 1 FROM follows f1 WHERE f1.follower_id = v.id AND f1.followee_id = ${col})
  AND EXISTS (SELECT 1 FROM follows f2 WHERE f2.follower_id = ${col} AND f2.followee_id = v.id))`;

// Publication visible par le spectateur v (p = publication, u = auteur)
const VISIBLE = `(p.user_id = v.id OR (
  u.banned_at IS NULL AND u.is_bot = 0
  AND (p.privacy = 'public' OR (p.privacy = 'friends' AND ${FRIEND_OF('p.user_id')}))
  AND (u.private_account = 0 OR EXISTS (SELECT 1 FROM follows fa WHERE fa.follower_id = v.id AND fa.followee_id = p.user_id))
  AND NOT ${BLOCKED_WITH('p.user_id')}
))`;
// La même, plus tout pour l'administration (modération)
const VISIBLE_OR_ADMIN = `(v.admin = 1 OR ${VISIBLE})`;

function authorOf(row, prefix = '') {
  return {
    id: row[`${prefix}user_id`] ?? row.id,
    username: row[`${prefix}username`],
    displayName: row[`${prefix}display_name`],
    avatar: row[`${prefix}avatar`] || null,
    verified: Boolean(row[`${prefix}verified_at`]),
  };
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------
const USER_SELECT = `
  SELECT u.*,
    (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers_count,
    (SELECT COUNT(*) FROM follows f WHERE f.follower_id = u.id) AS following_count,
    (SELECT COUNT(*) FROM likes l JOIN posts lp ON lp.id = l.post_id WHERE lp.user_id = u.id) AS likes_count,
    (SELECT COUNT(*) FROM posts cp WHERE cp.user_id = u.id AND (cp.user_id = v.id OR cp.privacy = 'public')) AS posts_count,
    EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = v.id AND f.followee_id = u.id) AS is_following,
    EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = v.id) AS follows_you,
    EXISTS(SELECT 1 FROM follow_requests r WHERE r.requester_id = v.id AND r.target_id = u.id) AS requested,
    EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id = v.id AND b.blocked_id = u.id) AS blocked,
    EXISTS(SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = v.id) AS blocked_by,
    ${LIVE_OF('u.id')} AS live_id
  FROM ${VIEWER} CROSS JOIN users u`;

function serializeUser(ctx, u, viewer) {
  const me = viewer && viewer.id === u.id;
  const out = {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar || null,
    bio: u.bio || '',
    website: u.website || '',
    verified: Boolean(u.verified_at),
    private: Boolean(u.private_account),
    demo: Boolean(u.is_demo),
    joinedAt: u.created_at,
    live: u.live_id || null,
    online: ctx.hub.isOnline(u.id),
  };
  if ('followers_count' in u) {
    out.counts = { followers: u.followers_count, following: u.following_count, likes: u.likes_count, posts: u.posts_count };
    out.isFollowing = Boolean(u.is_following);
    out.followsYou = Boolean(u.follows_you);
    out.friend = Boolean(u.is_following && u.follows_you);
    out.requested = Boolean(u.requested);
    out.blocked = Boolean(u.blocked);
    out.blockedBy = Boolean(u.blocked_by);
    out.me = Boolean(me);
    // Contenus d'un compte privé : réservés à ses abonnés
    out.locked = Boolean(u.private_account && !me && !u.is_following);
    out.showLiked = Boolean(u.show_liked) || Boolean(me);
  }
  return out;
}

function prefs(u) {
  try {
    return { likes: true, comments: true, follows: true, mentions: true, messages: true, live: true, ...JSON.parse(u.notify_prefs || '{}') };
  } catch {
    return { likes: true, comments: true, follows: true, mentions: true, messages: true, live: true };
  }
}

function selfUser(ctx, u) {
  return {
    ...serializeUser(ctx, u, u),
    email: u.email,
    isAdmin: Boolean(u.is_admin),
    coins: u.coins || 0,
    diamonds: u.diamonds || 0,
    lang: u.lang || null,
    onboarded: Boolean(u.onboarded_at),
    settings: {
      privateAccount: Boolean(u.private_account),
      showLiked: Boolean(u.show_liked),
      dmPolicy: u.dm_policy || 'everyone',
      personalized: u.personalized !== 0,
      notify: prefs(u),
    },
  };
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------
const POST_SELECT = `
  SELECT p.id, p.body, p.image, p.created_at, p.edited_at, p.user_id, p.flagged, p.video_id, p.sound_id, p.privacy,
         p.allow_comments, p.allow_duet, p.allow_stitch, p.allow_download, p.category, p.fx, p.bg, p.duet_of, p.stitch_of,
         p.pinned_at, p.pinned_comment_id, p.share_count, p.guest_views,
         vid.mime AS v_mime, vid.width AS v_width, vid.height AS v_height, vid.duration AS v_duration, vid.size AS v_size,
         u.username, u.display_name, u.avatar, u.verified_at, u.private_account,
         s.title AS s_title, s.post_id AS s_post_id, s.video_id AS s_video_id, s.cover AS s_cover, s.duration AS s_duration,
         su.username AS s_username, su.display_name AS s_display_name, su.avatar AS s_avatar, sv.mime AS s_mime,
         dp.id AS d_id, du.username AS d_username, du.display_name AS d_display_name,
         p.journal_id, ji.title AS actu_title, ji.site_name AS actu_site, ji.kind AS actu_kind,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id) AS save_count,
         (SELECT COUNT(*) FROM reposts rp WHERE rp.post_id = p.id) AS repost_count,
         (SELECT COALESCE(SUM(vv.plays), 0) FROM video_views vv WHERE vv.post_id = p.id) + p.guest_views AS view_count,
         EXISTS(SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = v.id) AS liked,
         EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = v.id) AS saved,
         EXISTS(SELECT 1 FROM reposts rp WHERE rp.post_id = p.id AND rp.user_id = v.id) AS reposted,
         EXISTS(SELECT 1 FROM follows fw WHERE fw.follower_id = v.id AND fw.followee_id = p.user_id) AS follows_author,
         EXISTS(SELECT 1 FROM follow_requests fr WHERE fr.requester_id = v.id AND fr.target_id = p.user_id) AS requested_author,
         (SELECT GROUP_CONCAT(url, '|') FROM (SELECT pm.url FROM post_media pm WHERE pm.post_id = p.id ORDER BY pm.position, pm.id)) AS media,
         ${LIVE_OF('p.user_id')} AS live_id
  FROM ${VIEWER}
  CROSS JOIN posts p
  JOIN users u ON u.id = p.user_id
  LEFT JOIN videos vid ON vid.id = p.video_id
  LEFT JOIN sounds s ON s.id = p.sound_id
  LEFT JOIN users su ON su.id = s.author_id
  LEFT JOIN videos sv ON sv.id = s.video_id AND sv.complete = 1
  LEFT JOIN posts dp ON dp.id = COALESCE(p.duet_of, p.stitch_of)
  LEFT JOIN users du ON du.id = dp.user_id
  LEFT JOIN journal_items ji ON ji.id = p.journal_id`;

function parseFx(value) {
  if (!value) return null;
  try {
    const fx = JSON.parse(value);
    return fx && typeof fx === 'object' ? fx : null;
  } catch {
    return null;
  }
}

// « injure,sexuel » → ['Insulte', 'Propos sexuels déplacés'] ; null si rien à signaler
function flaggedLabels(value) {
  if (!value) return null;
  return require('./contentFilter').labels(String(value).split(','));
}

function postKind(row) {
  if (row.video_id) return 'video';
  if (row.image || row.media) return 'photo';
  return 'text';
}

function serializePost(ctx, row, viewer) {
  const V = require('./videos');
  const mine = Boolean(viewer && row.user_id === viewer.id);
  const kind = postKind(row);
  const video = row.video_id
    ? {
        url: V.videoUrl(row.video_id, V.TYPES[row.v_mime] || 'mp4'),
        poster: row.image || null,
        width: row.v_width || null,
        height: row.v_height || null,
        duration: row.v_duration || null,
        size: row.v_size || null,
        expiresAt: V.expiresAt(ctx, row.created_at),
      }
    : null;
  const images = video ? [] : [row.image, ...(row.media ? row.media.split('|') : [])].filter(Boolean);
  const sound = row.sound_id && row.s_title
    ? {
        id: row.sound_id,
        title: row.s_title,
        original: row.s_post_id === row.id,
        author: { username: row.s_username, displayName: row.s_display_name, avatar: row.s_avatar || null },
        cover: row.s_cover || row.s_avatar || null,
        url: row.s_video_id && row.s_mime ? V.videoUrl(row.s_video_id, V.TYPES[row.s_mime] || 'mp4') : null,
        duration: row.s_duration || null,
      }
    : null;
  const source = row.d_id ? { id: row.d_id, username: row.d_username, displayName: row.d_display_name } : null;
  return {
    id: row.id,
    kind,
    body: row.body,
    lang: detectLang(row.body),
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    video,
    images,
    bg: row.bg || null,
    author: { ...authorOf(row), private: Boolean(row.private_account), live: row.live_id || null },
    likeCount: row.like_count || 0,
    commentCount: row.comment_count || 0,
    saveCount: row.save_count || 0,
    shareCount: row.share_count || 0,
    repostCount: row.repost_count || 0,
    viewCount: row.view_count || 0,
    liked: Boolean(row.liked),
    saved: Boolean(row.saved),
    reposted: Boolean(row.reposted),
    followsAuthor: Boolean(row.follows_author),
    requestedAuthor: Boolean(row.requested_author),
    mine,
    sound,
    privacy: row.privacy || 'public',
    allowComments: row.allow_comments !== 0,
    allowDuet: row.allow_duet !== 0 && kind === 'video',
    allowStitch: row.allow_stitch !== 0 && kind === 'video',
    allowDownload: row.allow_download !== 0,
    category: row.category || null,
    fx: parseFx(row.fx),
    // Vidéo qui réagit à une actualité de l'Actu
    actu: row.journal_id && row.actu_title ? { id: row.journal_id, title: row.actu_title, siteName: row.actu_site || '', kind: row.actu_kind || 'article' } : null,
    duetOf: row.duet_of && source ? source : null,
    stitchOf: row.stitch_of && source ? source : null,
    pinned: Boolean(row.pinned_at),
    pinnedCommentId: row.pinned_comment_id || null,
    canDelete: mine || Boolean(viewer?.is_admin),
    flagged: flaggedLabels(row.flagged),
  };
}

// Une publication visible par ce spectateur (null sinon)
async function getPost(ctx, postId, viewer, { admin = true } = {}) {
  const row = await ctx.db.get(`${POST_SELECT} WHERE p.id = ? AND ${admin ? VISIBLE_OR_ADMIN : VISIBLE}`, viewer?.id || 0, postId);
  return row ? serializePost(ctx, row, viewer) : null;
}

// Plusieurs publications, dans l'ordre demandé (les invisibles sont écartées)
async function getPosts(ctx, ids, viewer) {
  if (!ids.length) return [];
  const rows = await ctx.db.all(`${POST_SELECT} WHERE p.id IN (${ids.map(() => '?').join(',')}) AND ${VISIBLE}`, viewer?.id || 0, ...ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((r) => serializePost(ctx, r, viewer));
}

// ---------------------------------------------------------------------------
// Commentaires
// ---------------------------------------------------------------------------
const COMMENT_SELECT = `
  SELECT c.id, c.post_id, c.parent_id, c.body, c.created_at, c.user_id, c.flagged,
         u.username, u.display_name, u.avatar, u.verified_at,
         p.user_id AS post_author_id, p.pinned_comment_id,
         (SELECT COUNT(*) FROM comment_likes cl WHERE cl.comment_id = c.id) AS like_count,
         EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = v.id) AS liked,
         EXISTS(SELECT 1 FROM comment_likes cl WHERE cl.comment_id = c.id AND cl.user_id = p.user_id) AS author_liked,
         (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id) AS reply_count
  FROM ${VIEWER} CROSS JOIN comments c JOIN users u ON u.id = c.user_id JOIN posts p ON p.id = c.post_id`;

function serializeComment(ctx, row, viewer) {
  const mine = Boolean(viewer && row.user_id === viewer.id);
  const postOwner = Boolean(viewer && row.post_author_id === viewer.id);
  return {
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id || null,
    body: row.body,
    lang: detectLang(row.body),
    createdAt: row.created_at,
    author: authorOf(row),
    byCreator: row.user_id === row.post_author_id,
    likeCount: row.like_count || 0,
    liked: Boolean(row.liked),
    authorLiked: Boolean(row.author_liked),
    replyCount: row.reply_count || 0,
    pinned: row.pinned_comment_id === row.id,
    mine,
    canDelete: mine || postOwner || Boolean(viewer?.is_admin),
    canPin: postOwner && !row.parent_id,
    flagged: flaggedLabels(row.flagged),
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
const NOTIF_SELECT = `
  SELECT n.id, n.type, n.post_id, n.comment_id, n.live_id, n.body, n.created_at, n.read_at,
         a.id AS user_id, a.username, a.display_name, a.avatar, a.verified_at,
         p.image AS post_image, CASE WHEN p.flagged IS NULL THEN p.body ELSE '' END AS post_body,
         p.video_id AS post_video, pu.username AS post_author, c.parent_id AS comment_parent,
         (SELECT COUNT(*) FROM post_media pm WHERE pm.post_id = p.id) AS post_media_count,
         EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = n.user_id AND f.followee_id = a.id) AS following_back,
         EXISTS(SELECT 1 FROM follow_requests fr WHERE fr.requester_id = a.id AND fr.target_id = n.user_id) AS pending_request
  FROM notifications n
  JOIN users a ON a.id = n.actor_id
  LEFT JOIN posts p ON p.id = n.post_id
  LEFT JOIN users pu ON pu.id = p.user_id
  LEFT JOIN comments c ON c.id = n.comment_id`;

// Nature d'une publication, pour le texte des notifications (« ta vidéo », « tes photos »…)
const notifPostKind = (row) => (row.post_video ? 'video' : row.post_media_count > 1 ? 'photos' : row.post_image ? 'photo' : 'text');

function serializeNotification(_ctx, row) {
  return {
    id: row.id,
    type: row.type,
    createdAt: row.created_at,
    read: Boolean(row.read_at),
    actor: authorOf(row),
    followingBack: Boolean(row.following_back),
    pendingRequest: Boolean(row.pending_request),
    body: row.body || '',
    post: row.post_id ? { id: row.post_id, image: row.post_image || null, excerpt: (row.post_body || '').slice(0, 100), kind: notifPostKind(row), author: row.post_author || null } : null,
    commentId: row.comment_id || null,
    commentParentId: row.comment_parent || null,
    liveId: row.live_id || null,
  };
}

async function counters(ctx, userId) {
  const row = await ctx.db.get(
    `SELECT (SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL
               AND actor_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)) AS n,
            (SELECT COUNT(*) FROM messages m JOIN users s ON s.id = m.sender_id
             WHERE m.recipient_id = ? AND m.read_at IS NULL AND s.banned_at IS NULL
               AND m.sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)) AS m,
            (SELECT COUNT(*) FROM follow_requests WHERE target_id = ?) AS r`,
    userId, userId, userId, userId, userId, userId,
  );
  return { notifications: row.n, messages: row.m, requests: row.r };
}

// Présence : connexion permanente (hub) ou, sans elle, dernier passage enregistré en base
const POLL_ONLINE = 90e3;
const polling = (ctx) => ctx.config?.realtime === 'poll';
async function onlineSet(ctx, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!polling(ctx)) return new Set(list.filter((id) => ctx.hub.isOnline(id)));
  if (!list.length) return new Set();
  const rows = await ctx.db.all(`SELECT user_id FROM presence WHERE seen_at > ? AND user_id IN (${list.map(() => '?').join(',')})`, Date.now() - POLL_ONLINE, ...list);
  return new Set(rows.map((r) => r.user_id));
}
async function touchPresence(ctx, userId, typingTo = null) {
  if (!polling(ctx) || !userId) return;
  const now = Date.now();
  if (typingTo) {
    await ctx.db.run(
      `INSERT INTO presence (user_id, seen_at, typing_to, typing_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at, typing_to = excluded.typing_to, typing_at = excluded.typing_at`,
      userId, now, typingTo, now,
    );
  } else {
    await ctx.db.run('INSERT INTO presence (user_id, seen_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET seen_at = excluded.seen_at', userId, now);
  }
}
// « écrit… » sans connexion permanente : l'autre personne a tapé il y a moins de 6 secondes
async function isTyping(ctx, from, to) {
  if (!polling(ctx)) return false;
  const row = await ctx.db.get('SELECT typing_to, typing_at FROM presence WHERE user_id = ?', from);
  return Boolean(row && row.typing_to === to && row.typing_at > Date.now() - 6000);
}

async function pushCounters(ctx, userId) {
  if (ctx.hub.isOnline(userId)) ctx.hub.send(userId, 'counters', await counters(ctx, userId));
}

// Une seule notification par action répétée (J'aime retiré puis remis, etc.)
const DEDUP = ['like', 'comment_like', 'follow', 'follow_request', 'follow_accept', 'repost', 'favorite'];

// Texte des notifications sur le téléphone : le nom de la personne en titre, l'action en dessous.
// Les J'aime d'une même publication se regroupent en une seule notification (voir sw.js).
function pushText(type, body, user, what = 'ta vidéo') {
  const p = prefs(user);
  const clip = (s) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);
  switch (type) {
    case 'like': return p.likes && `a aimé ${what}.`;
    case 'follow': return p.follows && 'a commencé à te suivre.';
    case 'follow_request': return p.follows && 'souhaite s’abonner à ton compte.';
    case 'follow_accept': return p.follows && 'a accepté ta demande d’abonnement.';
    case 'comment': return p.comments && `a commenté : ${clip(body)}`;
    case 'reply': return p.comments && `a répondu : ${clip(body)}`;
    case 'mention': return p.mentions && `parle de toi : ${clip(body)}`;
    case 'live': return p.live && `est en LIVE${body ? ` : ${clip(body)}` : ''}`;
    case 'duet': return p.comments && 'a fait un Duo avec ta vidéo.';
    case 'stitch': return p.comments && 'a fait un Stitch de ta vidéo.';
    case 'gift': return p.likes && `t’a envoyé ${body}.`;
    default: return null;
  }
}

// Adresse complète d'une image (photo de profil) pour les notifications du téléphone
function absoluteUrl(ctx, src) {
  if (!src) return null;
  try {
    return new URL(src, ctx.config.baseUrl).href;
  } catch {
    return null;
  }
}

// Total non lu (notifications, messages, demandes) : pastille sur l'icône de l'application
async function unreadTotal(ctx, userId) {
  const c = await counters(ctx, userId);
  return c.notifications + c.messages + c.requests;
}

// Ce qui est arrivé depuis les derniers éléments vus par l'application (repères n et m) :
// la dernière notification et le dernier message reçus, pour la bannière dans l'application.
async function freshSince(ctx, userId, { n = null, m = null } = {}) {
  const top = await ctx.db.get(
    `SELECT (SELECT COALESCE(MAX(id), 0) FROM notifications WHERE user_id = ?) AS n,
            (SELECT COALESCE(MAX(id), 0) FROM messages WHERE recipient_id = ?) AS m`,
    userId, userId,
  );
  const out = { top: { n: top.n, m: top.m }, notification: null, message: null };
  if (n !== null && top.n > n) {
    const row = await ctx.db.get(
      `${NOTIF_SELECT} WHERE n.user_id = ? AND n.id > ? AND n.read_at IS NULL
         AND n.actor_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
       ORDER BY n.id DESC LIMIT 1`,
      userId, n, userId,
    );
    if (row) out.notification = serializeNotification(ctx, row);
  }
  if (m !== null && top.m > m) {
    const row = await ctx.db.get(
      `SELECT m.id, m.body, m.flagged, m.post_id, m.created_at, u.id AS user_id, u.username, u.display_name, u.avatar, u.verified_at
       FROM messages m JOIN users u ON u.id = m.sender_id
       WHERE m.recipient_id = ? AND m.id > ? AND m.read_at IS NULL AND u.banned_at IS NULL
         AND m.sender_id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ? UNION SELECT blocker_id FROM blocks WHERE blocked_id = ?)
       ORDER BY m.id DESC LIMIT 1`,
      userId, m, userId, userId,
    );
    if (row) {
      out.message = {
        id: row.id,
        from: authorOf(row),
        body: row.flagged ? 'Message masqué' : row.body || (row.post_id ? 'a partagé une publication avec toi' : ''),
        createdAt: row.created_at,
      };
    }
  }
  return out;
}

function notificationUrl(type, n, actorUsername, ownerUsername) {
  if (type === 'follow' || type === 'follow_accept') return `/@${actorUsername}`;
  if (type === 'follow_request') return '/activite?type=demandes';
  if (type === 'live') return `/live/${actorUsername}`;
  if (n.postId) return `/@${ownerUsername}/video/${n.postId}${n.commentId ? `?commentaire=${n.commentId}` : ''}`;
  return '/activite';
}

async function notify(ctx, { userId, actorId, type, postId = null, commentId = null, liveId = null, body = null }) {
  if (!userId || userId === actorId) return;
  if (await isBlocked(ctx, userId, actorId)) return;
  if (DEDUP.includes(type)) {
    const existing = await ctx.db.get(
      'SELECT id FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND post_id IS ? AND comment_id IS ?',
      userId, actorId, type, postId, commentId,
    );
    if (existing) return;
  }
  const { lastInsertRowid } = await ctx.db.run(
    'INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, live_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    userId, actorId, type, postId, commentId, liveId, body ? String(body).slice(0, 300) : null, Date.now(),
  );
  if (ctx.hub.isOnline(userId)) {
    const row = await ctx.db.get(`${NOTIF_SELECT} WHERE n.id = ?`, lastInsertRowid);
    if (row) ctx.hub.send(userId, 'notification', serializeNotification(ctx, row));
    await pushCounters(ctx, userId);
  }
  // Notification sur le téléphone, selon les réglages de la personne
  const [user, actor, post] = await Promise.all([
    ctx.db.get('SELECT id, username, notify_prefs FROM users WHERE id = ?', userId),
    ctx.db.get('SELECT username, display_name, avatar FROM users WHERE id = ?', actorId),
    postId
      ? ctx.db.get('SELECT u.username, p.video_id, p.image, (SELECT COUNT(*) FROM post_media pm WHERE pm.post_id = p.id) AS media FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?', postId)
      : null,
  ]);
  const what = !post || post.video_id ? 'ta vidéo' : post.media > 1 ? 'tes photos' : post.image ? 'ta photo' : 'ta publication';
  const text = user && actor && pushText(type, body || '', user, what);
  if (text) {
    const { sendPush } = require('./push');
    await sendPush(ctx, userId, {
      title: actor.display_name,
      body: text,
      icon: absoluteUrl(ctx, actor.avatar),
      url: notificationUrl(type, { postId, commentId }, actor.username, post?.username || user.username),
      // Un J'aime de plus sur la même publication met à jour la notification existante, sans resonner
      tag: type === 'like' ? `like-${postId}` : `${type}-${postId || actorId}`,
      renotify: type !== 'like',
      kind: type,
      actor: actor.display_name,
      what,
      nid: Number(lastInsertRowid),
      count: await unreadTotal(ctx, userId),
    });
  }
}

async function retractNotification(ctx, { userId, actorId, type, postId = null, commentId = null }) {
  await ctx.db.run(
    'DELETE FROM notifications WHERE user_id = ? AND actor_id = ? AND type = ? AND post_id IS ? AND comment_id IS ?',
    userId, actorId, type, postId, commentId,
  );
  await pushCounters(ctx, userId);
}

// @mentions d'un texte : chaque compte cité (existant, non bloqué) est prévenu
async function notifyMentions(ctx, text, actorId, { postId = null, commentId = null, except = [] } = {}) {
  for (const name of extractMentions(text)) {
    const u = await ctx.db.get('SELECT id FROM users WHERE username = ? AND banned_at IS NULL AND is_bot = 0', name);
    if (u && !except.includes(u.id)) await notify(ctx, { userId: u.id, actorId, type: 'mention', postId, commentId, body: text });
  }
}

// Vrai si l'un des deux comptes a bloqué l'autre.
async function isBlocked(ctx, a, b) {
  if (!a || !b) return false;
  return Boolean(
    await ctx.db.get('SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)', a, b, b, a),
  );
}

async function areFriends(ctx, a, b) {
  const row = await ctx.db.get(
    `SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?)
        AND EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS ok`,
    a, b, b, a,
  );
  return Boolean(row?.ok);
}

module.exports = {
  VIEWER,
  NOW_MS,
  LIVE_OF,
  BLOCKED_WITH,
  FRIEND_OF,
  VISIBLE,
  VISIBLE_OR_ADMIN,
  authorOf,
  USER_SELECT,
  serializeUser,
  selfUser,
  prefs,
  POST_SELECT,
  serializePost,
  postKind,
  getPost,
  getPosts,
  flaggedLabels,
  COMMENT_SELECT,
  serializeComment,
  NOTIF_SELECT,
  serializeNotification,
  onlineSet,
  touchPresence,
  isTyping,
  counters,
  pushCounters,
  notify,
  freshSince,
  unreadTotal,
  absoluteUrl,
  retractNotification,
  notifyMentions,
  isBlocked,
  areFriends,
};
