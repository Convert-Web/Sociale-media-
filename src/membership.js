'use strict';

// Admet un membre : attribue son numéro (jamais réattribué, voir la table
// member_numbers) et ouvre l'accès. Sans effet si le membre est déjà admis.
// La colonne paid_at sert de date d'admission, que l'entrée soit payante ou non.
async function admitIn(t, userId) {
  const user = await t.get('SELECT * FROM users WHERE id = ?', userId);
  if (!user || user.paid_at) return user || null;
  const { lastInsertRowid: next } = await t.run(
    'INSERT INTO member_numbers (user_id, created_at) VALUES (?, ?)',
    userId, Date.now(),
  );
  await t.run('UPDATE users SET paid_at = ?, member_number = ? WHERE id = ?', Date.now(), next, userId);
  return t.get('SELECT * FROM users WHERE id = ?', userId);
}

function admitMember(ctx, userId) {
  return ctx.db.transaction((t) => admitIn(t, userId));
}

// Accorde l'accès après paiement. Idempotent : un même paiement
// (webhook + retour navigateur) ne peut attribuer qu'un seul numéro de membre.
function grantMembership(ctx, userId, { provider, ref, amountCents, currency, status = 'paid' }) {
  return ctx.db.transaction(async (t) => {
    const user = await t.get('SELECT * FROM users WHERE id = ?', userId);
    const already = await t.get('SELECT id FROM payments WHERE provider_ref = ?', ref);
    if (!already) {
      // Le paiement est toujours enregistré, même si le compte a été supprimé entre-temps.
      await t.run(
        `INSERT INTO payments (user_id, provider, provider_ref, amount_cents, currency, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        user ? userId : null, provider, ref, amountCents, currency, status, Date.now(),
      );
    }
    if (!user) return null;
    return admitIn(t, userId);
  });
}

// Suppression d'un groupe : publications, photos, membres, notifications.
async function deleteGroup(ctx, groupId) {
  return ctx.db.transaction(async (t) => {
    const g = await t.get('SELECT cover FROM groupes WHERE id = ?', groupId);
    if (!g) return [];
    const media = [g.cover];
    const posts = 'SELECT id FROM posts WHERE groupe_id = ?';
    for (const p of await t.all('SELECT image FROM posts WHERE groupe_id = ? AND image IS NOT NULL', groupId)) media.push(p.image);
    for (const m of await t.all(`SELECT url FROM post_media WHERE post_id IN (${posts})`, groupId)) media.push(m.url);
    await t.run(`DELETE FROM post_media WHERE post_id IN (${posts})`, groupId);
    await t.run(`DELETE FROM bookmarks WHERE post_id IN (${posts})`, groupId);
    await t.run(`DELETE FROM reports WHERE target_type = 'post' AND target_id IN (${posts})`, groupId);
    await t.run(`DELETE FROM likes WHERE post_id IN (${posts})`, groupId);
    await t.run(`DELETE FROM comments WHERE post_id IN (${posts})`, groupId);
    await t.run(`DELETE FROM notifications WHERE groupe_id = ? OR post_id IN (${posts})`, groupId, groupId);
    await t.run('DELETE FROM posts WHERE groupe_id = ?', groupId);
    await t.run('DELETE FROM groupe_members WHERE groupe_id = ?', groupId);
    await t.run('DELETE FROM groupes WHERE id = ?', groupId);
    return media.filter(Boolean);
  });
}

// Suppression complète d'un compte, dans l'ordre (ne dépend pas des clés étrangères).
async function deleteUser(ctx, userId) {
  const media = [];
  // Les groupes créés par le membre disparaissent avec lui.
  for (const g of await ctx.db.all('SELECT id FROM groupes WHERE owner_id = ?', userId)) {
    media.push(...(await deleteGroup(ctx, g.id)));
  }
  await ctx.db.transaction(async (t) => {
    const user = await t.get('SELECT avatar, cover FROM users WHERE id = ?', userId);
    if (!user) return;
    media.push(user.avatar, user.cover);
    for (const p of await t.all('SELECT image FROM posts WHERE user_id = ? AND image IS NOT NULL', userId)) media.push(p.image);
    for (const m of await t.all('SELECT url FROM post_media WHERE post_id IN (SELECT id FROM posts WHERE user_id = ?)', userId)) media.push(m.url);
    for (const st of await t.all('SELECT media FROM stories WHERE user_id = ?', userId)) media.push(st.media);
    const mine = 'SELECT id FROM posts WHERE user_id = ?';
    await t.run(`DELETE FROM post_media WHERE post_id IN (${mine})`, userId);
    await t.run(`DELETE FROM bookmarks WHERE user_id = ? OR post_id IN (${mine})`, userId, userId);
    await t.run("DELETE FROM reports WHERE reporter_id = ? OR (target_type = 'user' AND target_id = ?) OR (target_type = 'post' AND target_id IN (" + mine + '))', userId, userId, userId);
    await t.run('DELETE FROM story_views WHERE user_id = ? OR story_id IN (SELECT id FROM stories WHERE user_id = ?)', userId, userId);
    await t.run('DELETE FROM stories WHERE user_id = ?', userId);
    await t.run('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', userId, userId);
    await t.run('DELETE FROM push_subscriptions WHERE user_id = ?', userId);
    await t.run('DELETE FROM friend_requests WHERE requester_id = ? OR addressee_id = ?', userId, userId);
    await t.run('DELETE FROM groupe_members WHERE user_id = ?', userId);
    // v4 : événements organisés, adresses recommandées, invitations
    for (const e of await t.all('SELECT cover FROM events WHERE owner_id = ? AND cover IS NOT NULL', userId)) media.push(e.cover);
    for (const p of await t.all('SELECT photo FROM places WHERE author_id = ? AND photo IS NOT NULL', userId)) media.push(p.photo);
    await t.run('DELETE FROM event_attendees WHERE user_id = ? OR event_id IN (SELECT id FROM events WHERE owner_id = ?)', userId, userId);
    await t.run('DELETE FROM notifications WHERE event_id IN (SELECT id FROM events WHERE owner_id = ?)', userId);
    await t.run('DELETE FROM events WHERE owner_id = ?', userId);
    await t.run('DELETE FROM place_endorsements WHERE user_id = ? OR place_id IN (SELECT id FROM places WHERE author_id = ?)', userId, userId);
    await t.run('DELETE FROM notifications WHERE place_id IN (SELECT id FROM places WHERE author_id = ?)', userId);
    await t.run('DELETE FROM places WHERE author_id = ?', userId);
    await t.run('DELETE FROM invitations WHERE inviter_id = ? AND used_by IS NULL', userId);
    await t.run('UPDATE users SET invited_by = NULL WHERE invited_by = ?', userId);
    await t.run(`DELETE FROM likes WHERE user_id = ? OR post_id IN (${mine})`, userId, userId);
    await t.run(`DELETE FROM comments WHERE user_id = ? OR post_id IN (${mine})`, userId, userId);
    await t.run(`DELETE FROM notifications WHERE user_id = ? OR actor_id = ? OR post_id IN (${mine})`, userId, userId, userId);
    await t.run('DELETE FROM posts WHERE user_id = ?', userId);
    await t.run('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?', userId, userId);
    await t.run('DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?', userId, userId);
    await t.run('DELETE FROM sessions WHERE user_id = ?', userId);
    await t.run('DELETE FROM password_resets WHERE user_id = ?', userId);
    await t.run('UPDATE payments SET user_id = NULL WHERE user_id = ?', userId);
    await t.run('DELETE FROM users WHERE id = ?', userId);
  });
  return media.filter(Boolean);
}

async function deletePost(ctx, postId) {
  return ctx.db.transaction(async (t) => {
    const media = (await t.all('SELECT url FROM post_media WHERE post_id = ?', postId)).map((m) => m.url);
    await t.run('DELETE FROM post_media WHERE post_id = ?', postId);
    await t.run('DELETE FROM bookmarks WHERE post_id = ?', postId);
    await t.run("DELETE FROM reports WHERE target_type = 'post' AND target_id = ?", postId);
    await t.run('DELETE FROM likes WHERE post_id = ?', postId);
    await t.run('DELETE FROM comments WHERE post_id = ?', postId);
    await t.run('DELETE FROM notifications WHERE post_id = ?', postId);
    await t.run('DELETE FROM posts WHERE id = ?', postId);
    return media;
  });
}

module.exports = { admitMember, grantMembership, deleteUser, deletePost, deleteGroup };
