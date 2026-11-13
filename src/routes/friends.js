'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { fail } = require('../http');
const { authorOf, notify, retractNotification, pushCounters, isBlocked } = require('../social');
const { sendPush } = require('../push');

// Statut d'amitié vu par « me » : none | outgoing | incoming | friends
async function friendStatus(ctx, me, other) {
  const row = await ctx.db.get(
    `SELECT requester_id, status FROM friend_requests
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    me, other, other, me,
  );
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requester_id === me ? 'outgoing' : 'incoming';
}

const FRIEND_LIST = `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.bio, u.profession, u.city`;

module.exports = function friendRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/friends', requireMember);

  const findMember = async (username) => {
    const u = typeof username === 'string' && (await db.get('SELECT * FROM users WHERE username = ? AND paid_at IS NOT NULL', username));
    if (!u) fail(404, 'Ce membre est introuvable.');
    return u;
  };

  const row = (x) => ({ ...authorOf(ctx, x), bio: x.bio, profession: x.profession, city: x.city });

  // Demandes reçues, envoyées, et liste des amis
  r.get('/friends', async (req, res) => {
    const me = req.user.id;
    const incoming = await db.all(
      `${FRIEND_LIST}, fr.created_at FROM friend_requests fr JOIN users u ON u.id = fr.requester_id
       WHERE fr.addressee_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      me,
    );
    const outgoing = await db.all(
      `${FRIEND_LIST}, fr.created_at FROM friend_requests fr JOIN users u ON u.id = fr.addressee_id
       WHERE fr.requester_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`,
      me,
    );
    const friends = await db.all(
      `${FRIEND_LIST} FROM friend_requests fr
       JOIN users u ON u.id = CASE WHEN fr.requester_id = ? THEN fr.addressee_id ELSE fr.requester_id END
       WHERE (fr.requester_id = ? OR fr.addressee_id = ?) AND fr.status = 'accepted'
       ORDER BY u.display_name COLLATE NOCASE`,
      me, me, me,
    );
    res.json({ incoming: incoming.map(row), outgoing: outgoing.map(row), friends: friends.map(row) });
  });

  // Envoyer une demande, ou accepter celle reçue
  r.post('/users/:username/friend', requireMember, async (req, res) => {
    const other = await findMember(req.params.username);
    const me = req.user.id;
    if (other.id === me) fail(400, 'Vous ne pouvez pas vous ajouter vous-même.');
    if (await isBlocked(ctx, me, other.id)) fail(403, 'Impossible d’ajouter ce membre.');
    const status = await friendStatus(ctx, me, other.id);

    if (status === 'incoming') {
      const now = Date.now();
      await db.transaction(async (t) => {
        await t.run(
          "UPDATE friend_requests SET status = 'accepted', responded_at = ? WHERE requester_id = ? AND addressee_id = ?",
          now, other.id, me,
        );
        // Amis = abonnés l'un à l'autre
        await t.run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', me, other.id, now);
        await t.run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', other.id, me, now);
      });
      await retractNotification(ctx, { userId: me, actorId: other.id, type: 'friend_request' });
      await notify(ctx, { userId: other.id, actorId: me, type: 'friend_accept' });
      await sendPush(ctx, other.id, {
        title: req.user.display_name,
        body: 'a accepté votre demande d’ami.',
        url: `/@${req.user.username}`,
        tag: `friend-${me}`,
      });
      await pushCounters(ctx, me);
      return res.json({ status: 'friends' });
    }

    if (status === 'none') {
      await db.run(
        "INSERT OR REPLACE INTO friend_requests (requester_id, addressee_id, status, created_at) VALUES (?, ?, 'pending', ?)",
        me, other.id, Date.now(),
      );
      await notify(ctx, { userId: other.id, actorId: me, type: 'friend_request' });
      await sendPush(ctx, other.id, {
        title: 'Nouvelle demande d’ami',
        body: `${req.user.display_name} souhaite vous ajouter à ses amis.`,
        url: '/amis',
        tag: `friend-${me}`,
      });
      await pushCounters(ctx, other.id);
      return res.json({ status: 'outgoing' });
    }
    res.json({ status });
  });

  // Annuler une demande, la refuser, ou retirer un ami
  r.delete('/users/:username/friend', requireMember, async (req, res) => {
    const other = await findMember(req.params.username);
    const me = req.user.id;
    await db.run(
      'DELETE FROM friend_requests WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
      me, other.id, other.id, me,
    );
    await retractNotification(ctx, { userId: other.id, actorId: me, type: 'friend_request' });
    await retractNotification(ctx, { userId: me, actorId: other.id, type: 'friend_request' });
    await pushCounters(ctx, me);
    await pushCounters(ctx, other.id);
    res.json({ status: 'none' });
  });

  // Amis d'un membre (profil)
  r.get('/users/:username/friends', requireMember, async (req, res) => {
    const other = await findMember(req.params.username);
    if (await isBlocked(ctx, req.user.id, other.id)) return res.json({ users: [] });
    const rows = await db.all(
      `${FRIEND_LIST},
         EXISTS(SELECT 1 FROM follows fx WHERE fx.follower_id = ? AND fx.followee_id = u.id) AS is_following
       FROM friend_requests fr
       JOIN users u ON u.id = CASE WHEN fr.requester_id = ? THEN fr.addressee_id ELSE fr.requester_id END
       WHERE (fr.requester_id = ? OR fr.addressee_id = ?) AND fr.status = 'accepted'
       ORDER BY u.display_name COLLATE NOCASE LIMIT 500`,
      req.user.id, other.id, other.id, other.id,
    );
    res.json({ users: rows.map((x) => ({ ...row(x), isFollowing: Boolean(x.is_following), isMe: x.user_id === req.user.id })) });
  });

  return r;
};

module.exports.friendStatus = friendStatus;
