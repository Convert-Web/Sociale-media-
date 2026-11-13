'use strict';
const express = require('express');
const { requireMember } = require('../auth');
const { fail, text, intParam } = require('../http');
const { single, photos, saveImage, deleteUpload } = require('../uploads');
const { POST_SELECT, NOT_BLOCKED, serializePost, getPost, authorOf, notify, notifyMentions, isBlocked } = require('../social');
const { deleteGroup } = require('../membership');
const { sendPush } = require('../push');

const GROUP_SELECT = `
  SELECT g.id, g.name, g.description, g.cover, g.created_at, g.owner_id,
         u.username AS owner_username, u.display_name AS owner_name,
         (SELECT COUNT(*) FROM groupe_members m WHERE m.groupe_id = g.id AND m.status = 'member') AS member_count,
         gm.role, gm.status
  FROM groupes g
  JOIN users u ON u.id = g.owner_id
  LEFT JOIN groupe_members gm ON gm.groupe_id = g.id AND gm.user_id = ?`;

module.exports = function groupRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/groups', requireMember);

  const serialize = (g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    cover: g.cover || null,
    createdAt: g.created_at,
    memberCount: g.member_count,
    owner: { username: g.owner_username, displayName: g.owner_name },
    status: g.status || null, // member | invited | requested | null
    role: g.status === 'member' ? g.role : null, // owner | admin | member
  });

  const loadGroup = async (id, viewer) => {
    const gid = intParam(id);
    const g = gid && (await db.get(`${GROUP_SELECT} WHERE g.id = ?`, viewer.id, gid));
    if (!g) fail(404, 'Ce groupe est introuvable.');
    return g;
  };
  const isMember = (g, viewer) => g.status === 'member' || Boolean(viewer.is_admin);
  const isManager = (g, viewer) => (g.status === 'member' && (g.role === 'owner' || g.role === 'admin')) || Boolean(viewer.is_admin);
  const requireMemberOf = (g, viewer) => {
    if (!isMember(g, viewer)) fail(403, 'Ce groupe est privé : rejoignez-le pour voir son contenu.');
  };
  const requireManager = (g, viewer) => {
    if (!isManager(g, viewer)) fail(403, 'Action réservée aux administrateurs du groupe.');
  };
  const managers = (gid) =>
    db.all("SELECT user_id FROM groupe_members WHERE groupe_id = ? AND status = 'member' AND role IN ('owner', 'admin')", gid);
  const findUser = async (username) => {
    const u = typeof username === 'string' && (await db.get('SELECT * FROM users WHERE username = ? AND paid_at IS NOT NULL', username));
    if (!u) fail(404, 'Ce membre est introuvable.');
    return u;
  };

  // Annuaire : mes groupes, invitations, demandes en cours, à découvrir
  r.get('/groups', async (req, res) => {
    const rows = await db.all(`${GROUP_SELECT} ORDER BY g.id DESC LIMIT 300`, req.user.id);
    const list = rows.map(serialize);
    res.json({
      mine: list.filter((g) => g.status === 'member'),
      invitations: list.filter((g) => g.status === 'invited'),
      requested: list.filter((g) => g.status === 'requested'),
      discover: list.filter((g) => !g.status),
    });
  });

  r.post('/groups', single('cover'), async (req, res) => {
    const name = text(req.body?.name, { field: 'Nom du groupe', min: 2, max: 60, required: true });
    const description = text(req.body?.description, { field: 'Description', max: 500 });
    const cover = await saveImage(ctx, req.file);
    const now = Date.now();
    const id = await db.transaction(async (t) => {
      const { lastInsertRowid } = await t.run(
        'INSERT INTO groupes (name, description, cover, owner_id, created_at) VALUES (?, ?, ?, ?, ?)',
        name, description, cover, req.user.id, now,
      );
      await t.run(
        "INSERT INTO groupe_members (groupe_id, user_id, role, status, created_at) VALUES (?, ?, 'owner', 'member', ?)",
        lastInsertRowid, req.user.id, now,
      );
      return lastInsertRowid;
    });
    res.status(201).json({ group: serialize(await loadGroup(id, req.user)) });
  });

  r.get('/groups/:id', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    // Comme un groupe privé Facebook : la liste des membres n'est visible que par les membres (et les invités)
    const canSeeMembers = isMember(g, req.user) || g.status === 'invited';
    const preview = canSeeMembers
      ? await db.all(
          `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number
           FROM groupe_members m JOIN users u ON u.id = m.user_id
           WHERE m.groupe_id = ? AND m.status = 'member' ORDER BY m.created_at ASC LIMIT 8`,
          g.id,
        )
      : [];
    const pending = isManager(g, req.user)
      ? (await db.get("SELECT COUNT(*) AS c FROM groupe_members WHERE groupe_id = ? AND status = 'requested'", g.id)).c
      : 0;
    res.json({ group: { ...serialize(g), preview: preview.map((x) => authorOf(ctx, x)), pendingRequests: pending, canManage: isManager(g, req.user) } });
  });

  r.patch('/groups/:id', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    requireManager(g, req.user);
    const name = req.body?.name !== undefined ? text(req.body.name, { field: 'Nom du groupe', min: 2, max: 60, required: true }) : g.name;
    const description = req.body?.description !== undefined ? text(req.body.description, { field: 'Description', max: 500 }) : g.description;
    await db.run('UPDATE groupes SET name = ?, description = ? WHERE id = ?', name, description, g.id);
    res.json({ group: serialize(await loadGroup(g.id, req.user)) });
  });

  r.post('/groups/:id/cover', single('image'), async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    requireManager(g, req.user);
    if (!req.file) fail(400, 'Aucune image reçue.');
    const cover = await saveImage(ctx, req.file);
    deleteUpload(ctx, g.cover);
    await db.run('UPDATE groupes SET cover = ? WHERE id = ?', cover, g.id);
    res.json({ group: serialize(await loadGroup(g.id, req.user)) });
  });

  r.delete('/groups/:id', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    if (g.owner_id !== req.user.id && !req.user.is_admin) fail(403, 'Seul le créateur peut supprimer le groupe.');
    const media = await deleteGroup(ctx, g.id);
    for (const url of media) deleteUpload(ctx, url);
    res.json({ ok: true });
  });

  // Discussion du groupe (membres uniquement)
  r.get('/groups/:id/posts', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    requireMemberOf(g, req.user);
    const before = intParam(req.query.before);
    const limit = 15;
    const rows = await db.all(
      `${POST_SELECT} WHERE p.groupe_id = ? AND (? IS NULL OR p.id < ?) AND ${NOT_BLOCKED} ORDER BY p.id DESC LIMIT ?`,
      req.user.id, g.id, before, before, limit,
    );
    res.json({ posts: rows.map((row) => serializePost(ctx, row, req.user)), hasMore: rows.length === limit });
  });

  r.post('/groups/:id/posts', photos(), async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    if (g.status !== 'member') fail(403, 'Rejoignez le groupe pour y publier.');
    const body = text(req.body?.body, { field: 'Publication', max: 2000 });
    const files = [...(req.files?.image || []), ...(req.files?.images || [])].slice(0, 6);
    if (!body && !files.length) fail(400, 'Votre publication est vide.');
    const urls = [];
    for (const f of files) urls.push(await saveImage(ctx, f));
    const { lastInsertRowid } = await db.run(
      'INSERT INTO posts (user_id, body, image, groupe_id, created_at) VALUES (?, ?, ?, ?, ?)',
      req.user.id, body, urls[0] || null, g.id, Date.now(),
    );
    for (const [i, url] of urls.slice(1).entries()) {
      await db.run('INSERT INTO post_media (post_id, url, position) VALUES (?, ?, ?)', lastInsertRowid, url, i + 1);
    }
    if (body) await notifyMentions(ctx, body, req.user.id, lastInsertRowid, g.id);
    res.status(201).json({ post: await getPost(ctx, lastInsertRowid, req.user) });
  });

  // Membres (et, pour les administrateurs, demandes et invitations en attente)
  r.get('/groups/:id/members', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    requireMemberOf(g, req.user);
    const rows = await db.all(
      `SELECT u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.profession, m.role, m.status, m.created_at
       FROM groupe_members m JOIN users u ON u.id = m.user_id
       WHERE m.groupe_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at ASC`,
      g.id,
    );
    const out = (x) => ({ ...authorOf(ctx, x), profession: x.profession, role: x.role, since: x.created_at, isMe: x.user_id === req.user.id });
    res.json({
      members: rows.filter((x) => x.status === 'member').map(out),
      requests: isManager(g, req.user) ? rows.filter((x) => x.status === 'requested').map(out) : [],
      invited: isManager(g, req.user) ? rows.filter((x) => x.status === 'invited').map(out) : [],
    });
  });

  // Rejoindre : accepte une invitation, sinon envoie une demande aux administrateurs
  r.post('/groups/:id/join', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    if (g.status === 'member') return res.json({ status: 'member' });
    if (g.status === 'requested') return res.json({ status: 'requested' });
    if (g.status === 'invited') {
      await db.run("UPDATE groupe_members SET status = 'member', created_at = ? WHERE groupe_id = ? AND user_id = ?", Date.now(), g.id, req.user.id);
      return res.json({ status: 'member' });
    }
    if (await isBlocked(ctx, req.user.id, g.owner_id)) fail(403, 'Impossible de rejoindre ce groupe.');
    await db.run(
      "INSERT INTO groupe_members (groupe_id, user_id, role, status, created_at) VALUES (?, ?, 'member', 'requested', ?)",
      g.id, req.user.id, Date.now(),
    );
    for (const m of await managers(g.id)) {
      await notify(ctx, { userId: m.user_id, actorId: req.user.id, type: 'group_request', groupId: g.id });
      await sendPush(ctx, m.user_id, {
        title: g.name,
        body: `${req.user.display_name} demande à rejoindre le groupe.`,
        url: `/groupes/${g.id}`,
        tag: `group-${g.id}`,
      });
    }
    res.json({ status: 'requested' });
  });

  // Quitter, annuler sa demande ou refuser une invitation
  r.post('/groups/:id/leave', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    if (g.status === 'member' && g.role === 'owner') fail(400, 'Le créateur ne peut pas quitter son groupe : supprimez-le ou nommez un autre créateur.');
    await db.run('DELETE FROM groupe_members WHERE groupe_id = ? AND user_id = ?', g.id, req.user.id);
    res.json({ status: null });
  });

  r.post('/groups/:id/invite', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    if (g.status !== 'member') fail(403, 'Seuls les membres peuvent inviter.');
    const u = await findUser(req.body?.username);
    if (u.id === req.user.id) fail(400, 'Vous êtes déjà membre.');
    if (await isBlocked(ctx, req.user.id, u.id)) fail(403, 'Impossible d’inviter ce membre.');
    const existing = await db.get('SELECT status FROM groupe_members WHERE groupe_id = ? AND user_id = ?', g.id, u.id);
    if (existing?.status === 'member') fail(409, `${u.display_name} est déjà membre.`);
    if (existing?.status === 'invited') return res.json({ status: 'invited' });
    if (existing?.status === 'requested') {
      if (!isManager(g, req.user)) fail(409, 'Sa demande attend la validation d’un administrateur.');
      await db.run("UPDATE groupe_members SET status = 'member', created_at = ? WHERE groupe_id = ? AND user_id = ?", Date.now(), g.id, u.id);
      await notify(ctx, { userId: u.id, actorId: req.user.id, type: 'group_accept', groupId: g.id });
      return res.json({ status: 'member' });
    }
    await db.run(
      "INSERT INTO groupe_members (groupe_id, user_id, role, status, invited_by, created_at) VALUES (?, ?, 'member', 'invited', ?, ?)",
      g.id, u.id, req.user.id, Date.now(),
    );
    await notify(ctx, { userId: u.id, actorId: req.user.id, type: 'group_invite', groupId: g.id });
    await sendPush(ctx, u.id, {
      title: 'Invitation',
      body: `${req.user.display_name} vous invite à rejoindre « ${g.name} ».`,
      url: `/groupes/${g.id}`,
      tag: `group-${g.id}`,
    });
    res.status(201).json({ status: 'invited' });
  });

  r.post('/groups/:id/requests/:userId/:decision', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    requireManager(g, req.user);
    const uid = intParam(req.params.userId);
    const row = uid && (await db.get("SELECT * FROM groupe_members WHERE groupe_id = ? AND user_id = ? AND status = 'requested'", g.id, uid));
    if (!row) fail(404, 'Demande introuvable.');
    if (req.params.decision === 'approve') {
      await db.run("UPDATE groupe_members SET status = 'member', created_at = ? WHERE groupe_id = ? AND user_id = ?", Date.now(), g.id, uid);
      await notify(ctx, { userId: uid, actorId: req.user.id, type: 'group_accept', groupId: g.id });
      await sendPush(ctx, uid, { title: g.name, body: 'Votre demande a été acceptée. Bienvenue dans le groupe.', url: `/groupes/${g.id}`, tag: `group-${g.id}` });
      return res.json({ status: 'member' });
    }
    if (req.params.decision !== 'decline') fail(404, 'Introuvable.');
    await db.run('DELETE FROM groupe_members WHERE groupe_id = ? AND user_id = ?', g.id, uid);
    res.json({ status: null });
  });

  r.post('/groups/:id/members/:userId/remove', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    requireManager(g, req.user);
    const uid = intParam(req.params.userId);
    if (uid === g.owner_id) fail(400, 'Le créateur du groupe ne peut pas être retiré.');
    await db.run('DELETE FROM groupe_members WHERE groupe_id = ? AND user_id = ?', g.id, uid);
    res.json({ ok: true });
  });

  r.post('/groups/:id/members/:userId/role', async (req, res) => {
    const g = await loadGroup(req.params.id, req.user);
    if (g.owner_id !== req.user.id) fail(403, 'Seul le créateur peut nommer des administrateurs.');
    const uid = intParam(req.params.userId);
    const role = req.body?.role === 'admin' ? 'admin' : 'member';
    if (uid === g.owner_id) fail(400, 'Le créateur reste créateur.');
    const { changes } = await db.run(
      "UPDATE groupe_members SET role = ? WHERE groupe_id = ? AND user_id = ? AND status = 'member'",
      role, g.id, uid,
    );
    if (!changes) fail(404, 'Membre introuvable.');
    res.json({ role });
  });

  return r;
};
