'use strict';
// Suppressions complètes (compte, publication, commentaire), dans l'ordre : ne dépend pas des clés
// étrangères. Renvoie les fichiers (photos, vidéos) à effacer ensuite.

// Tables héritées d'AURUM (bases reprises) : les données du compte y sont effacées aussi (RGPD)
const LEGACY = [
  ['friend_requests', 'requester_id = ? OR addressee_id = ?', 2],
  ['groupe_members', 'user_id = ?', 1],
  ['event_attendees', 'user_id = ?', 1],
  ['place_endorsements', 'user_id = ?', 1],
  ['invitations', 'inviter_id = ?', 1],
  ['previews', 'author_id = ?', 1],
  ['journal_items', 'author_id = ?', 1],
  ['events', 'owner_id = ?', 1],
  ['places', 'author_id = ?', 1],
  ['groupes', 'owner_id = ?', 1],
];

async function deletePostIn(t, postId) {
  const media = (await t.all('SELECT url FROM post_media WHERE post_id = ?', postId)).map((m) => m.url);
  const post = await t.get('SELECT image, video_id FROM posts WHERE id = ?', postId);
  if (!post) return media;
  if (post.image) media.push(post.image);
  // La vidéo (et son aperçu) disparaît avec la publication
  const v = post.video_id && (await t.get('SELECT id, mime FROM videos WHERE id = ?', post.video_id));
  if (v) media.push(require('./videos').videoUrl(v.id, require('./videos').TYPES[v.mime] || 'mp4'));
  const comments = 'SELECT id FROM comments WHERE post_id = ?';
  await t.run('DELETE FROM post_media WHERE post_id = ?', postId);
  await t.run('DELETE FROM post_tags WHERE post_id = ?', postId);
  await t.run('DELETE FROM bookmarks WHERE post_id = ?', postId);
  await t.run('DELETE FROM reposts WHERE post_id = ?', postId);
  await t.run('DELETE FROM not_interested WHERE post_id = ?', postId);
  await t.run("DELETE FROM reports WHERE target_type = 'post' AND target_id = ?", postId);
  await t.run(`DELETE FROM reports WHERE target_type = 'comment' AND target_id IN (${comments})`, postId);
  await t.run('DELETE FROM likes WHERE post_id = ?', postId);
  await t.run(`DELETE FROM comment_likes WHERE comment_id IN (${comments})`, postId);
  await t.run('DELETE FROM video_views WHERE post_id = ?', postId);
  await t.run('DELETE FROM view_days WHERE post_id = ?', postId);
  await t.run('DELETE FROM comments WHERE post_id = ?', postId);
  await t.run('DELETE FROM notifications WHERE post_id = ?', postId);
  await t.run('UPDATE messages SET post_id = NULL WHERE post_id = ?', postId);
  await t.run('UPDATE posts SET duet_of = NULL WHERE duet_of = ?', postId);
  await t.run('UPDATE posts SET stitch_of = NULL WHERE stitch_of = ?', postId);
  // Son original de la vidéo : les vidéos qui l'utilisent gardent leur son (enregistré dans leur fichier),
  // mais il n'est plus réutilisable (son fichier source disparaît)
  await t.run('UPDATE sounds SET post_id = NULL, video_id = NULL WHERE post_id = ?', postId);
  await t.run('DELETE FROM posts WHERE id = ?', postId);
  return media;
}

async function deletePost(ctx, postId) {
  return ctx.db.transaction((t) => deletePostIn(t, postId));
}

// Un commentaire disparaît avec ses réponses et leurs J'aime
async function deleteComment(ctx, commentId) {
  await ctx.db.transaction(async (t) => {
    const ids = [commentId, ...(await t.all('SELECT id FROM comments WHERE parent_id = ?', commentId)).map((r) => r.id)];
    const marks = ids.map(() => '?').join(',');
    await t.run(`DELETE FROM comment_likes WHERE comment_id IN (${marks})`, ...ids);
    await t.run(`DELETE FROM reports WHERE target_type = 'comment' AND target_id IN (${marks})`, ...ids);
    await t.run(`DELETE FROM notifications WHERE comment_id IN (${marks})`, ...ids);
    await t.run(`UPDATE posts SET pinned_comment_id = NULL WHERE pinned_comment_id IN (${marks})`, ...ids);
    await t.run(`DELETE FROM comments WHERE id IN (${marks})`, ...ids);
  });
}

// Suppression complète d'un compte
async function deleteUser(ctx, userId) {
  const media = [];
  await ctx.db.transaction(async (t) => {
    const user = await t.get('SELECT avatar FROM users WHERE id = ?', userId);
    if (!user) return;
    media.push(user.avatar);
    for (const p of await t.all('SELECT id FROM posts WHERE user_id = ?', userId)) media.push(...(await deletePostIn(t, p.id)));
    for (const st of await t.all('SELECT media FROM stories WHERE user_id = ?', userId)) media.push(st.media);
    // Commentaires écrits ailleurs (avec leurs réponses)
    const mine = 'SELECT id FROM comments WHERE user_id = ?';
    await t.run(`DELETE FROM comment_likes WHERE user_id = ? OR comment_id IN (${mine}) OR comment_id IN (SELECT id FROM comments WHERE parent_id IN (${mine}))`, userId, userId, userId);
    await t.run(`UPDATE posts SET pinned_comment_id = NULL WHERE pinned_comment_id IN (${mine})`, userId);
    await t.run(`DELETE FROM notifications WHERE comment_id IN (${mine})`, userId);
    await t.run(`DELETE FROM comments WHERE parent_id IN (${mine})`, userId);
    await t.run('DELETE FROM comments WHERE user_id = ?', userId);
    await t.run('DELETE FROM likes WHERE user_id = ?', userId);
    await t.run('DELETE FROM bookmarks WHERE user_id = ?', userId);
    await t.run('DELETE FROM reposts WHERE user_id = ?', userId);
    await t.run('DELETE FROM video_views WHERE user_id = ?', userId);
    await t.run('DELETE FROM not_interested WHERE user_id = ? OR author_id = ?', userId, userId);
    await t.run('DELETE FROM interests WHERE user_id = ?', userId);
    await t.run("DELETE FROM interests WHERE kind = 'author' AND key = ?", String(userId));
    await t.run('DELETE FROM sound_favorites WHERE user_id = ?', userId);
    // Ses sons restent dans les vidéos des autres, mais ne portent plus son nom
    await t.run("UPDATE sounds SET title = 'son original', post_id = NULL, video_id = NULL WHERE author_id = ?", userId);
    await t.run("DELETE FROM reports WHERE reporter_id = ? OR (target_type = 'user' AND target_id = ?)", userId, userId);
    await t.run('DELETE FROM story_views WHERE user_id = ? OR story_id IN (SELECT id FROM stories WHERE user_id = ?)', userId, userId);
    await t.run('DELETE FROM stories WHERE user_id = ?', userId);
    await t.run('DELETE FROM blocks WHERE blocker_id = ? OR blocked_id = ?', userId, userId);
    await t.run('DELETE FROM push_subscriptions WHERE user_id = ?', userId);
    await t.run('DELETE FROM follow_requests WHERE requester_id = ? OR target_id = ?', userId, userId);
    // LIVE : directs terminés, fil du direct anonymisé
    await t.run('UPDATE lives SET ended_at = COALESCE(ended_at, ?) WHERE user_id = ?', Date.now(), userId);
    await t.run('DELETE FROM live_events WHERE user_id = ? OR live_id IN (SELECT id FROM lives WHERE user_id = ?)', userId, userId);
    await t.run('DELETE FROM live_viewers WHERE user_id = ? OR live_id IN (SELECT id FROM lives WHERE user_id = ?)', userId, userId);
    await t.run('DELETE FROM live_signals WHERE live_id IN (SELECT id FROM lives WHERE user_id = ?)', userId);
    await t.run('DELETE FROM lives WHERE user_id = ?', userId);
    await t.run('DELETE FROM wallet_tx WHERE user_id = ?', userId);
    await t.run('UPDATE wallet_tx SET other_id = NULL WHERE other_id = ?', userId);
    // Vidéos envoyées mais pas publiées
    for (const v of await t.all('SELECT poster FROM videos WHERE owner_id = ? AND poster IS NOT NULL', userId)) media.push(v.poster);
    await t.run('DELETE FROM video_chunks WHERE video_id IN (SELECT id FROM videos WHERE owner_id = ?)', userId);
    await t.run('DELETE FROM videos WHERE owner_id = ?', userId);
    await t.run('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', userId, userId);
    await t.run('DELETE FROM follows WHERE follower_id = ? OR followee_id = ?', userId, userId);
    await t.run('DELETE FROM messages WHERE sender_id = ? OR recipient_id = ?', userId, userId);
    await t.run('DELETE FROM sessions WHERE user_id = ?', userId);
    await t.run('DELETE FROM password_resets WHERE user_id = ?', userId);
    await t.run('UPDATE payments SET user_id = NULL WHERE user_id = ?', userId);
    for (const [table, where, n] of LEGACY) {
      if (ctx.db.legacy?.has(table)) await t.run(`DELETE FROM ${table} WHERE ${where}`, ...Array(n).fill(userId));
    }
    await t.run('DELETE FROM users WHERE id = ?', userId);
  });
  return media.filter(Boolean);
}

module.exports = { deleteUser, deletePost, deleteComment };
