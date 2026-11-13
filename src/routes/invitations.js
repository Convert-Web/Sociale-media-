'use strict';
const express = require('express');
const { requireAuth, requireMember } = require('../auth');
const { fail, text } = require('../http');
const { authorOf, selfUser } = require('../social');
const { newCode, findInvitation, foundersLeft, redeemInvitation, announceAdmissionRequest, admissionMode } = require('../admission');

module.exports = function invitationRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;
  const link = (code) => `${config.baseUrl}/invitation/${code}`;

  // Page d'invitation (publique) : qui invite, places de Fondateur restantes
  r.get('/invitations/:code/preview', async (req, res) => {
    const inv = await findInvitation(ctx, req.params.code);
    const valid = Boolean(inv && !inv.used_by && inv.inviter_member);
    res.json({
      valid,
      used: Boolean(inv?.used_by),
      code: valid ? inv.code : null,
      inviter: inv ? authorOf(ctx, inv) : null,
      foundersLeft: await foundersLeft(ctx),
      founderLimit: config.founderLimit,
    });
  });

  // Mes cartons d'invitation (créés au besoin jusqu'au quota)
  r.get('/invitations', requireMember, async (req, res) => {
    const unlimited = Boolean(req.user.is_admin);
    const quota = config.invitesPerMember;
    const { n } = await db.get('SELECT COUNT(*) AS n FROM invitations WHERE inviter_id = ?', req.user.id);
    for (let i = n; i < quota; i++) {
      await db.run('INSERT INTO invitations (code, inviter_id, created_at) VALUES (?, ?, ?)', newCode(), req.user.id, Date.now() + i);
    }
    const rows = await db.all(
      `SELECT i.code, i.created_at, i.used_at, u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at
       FROM invitations i LEFT JOIN users u ON u.id = i.used_by
       WHERE i.inviter_id = ? ORDER BY (i.used_at IS NULL) DESC, i.created_at ASC`,
      req.user.id,
    );
    const invites = rows.map((x) => ({
      code: x.code,
      url: link(x.code),
      createdAt: x.created_at,
      usedAt: x.used_at,
      usedBy: x.used_at && x.username ? authorOf(ctx, x) : null,
    }));
    res.json({ quota, unlimited, invites, available: invites.filter((x) => !x.usedAt).length, invitedCount: invites.filter((x) => x.usedAt).length });
  });

  // Carton supplémentaire : réservé à la Direction
  r.post('/invitations', requireMember, async (req, res) => {
    if (!req.user.is_admin) fail(403, 'Vous avez déjà reçu toutes vos invitations.');
    const code = newCode();
    await db.run('INSERT INTO invitations (code, inviter_id, created_at) VALUES (?, ?, ?)', code, req.user.id, Date.now());
    res.status(201).json({ invite: { code, url: link(code), createdAt: Date.now(), usedAt: null, usedBy: null } });
  });

  // Compte en attente : utiliser un code d'invitation
  r.post('/admission/redeem', requireAuth, async (req, res) => {
    if (req.user.paid_at) return res.json({ user: selfUser(ctx, req.user) });
    if (config.paidEntry) fail(400, 'L’entrée se fait par le droit d’entrée.');
    const inv = await findInvitation(ctx, req.body?.code);
    if (!inv || !inv.inviter_member) fail(404, 'Ce code d’invitation est introuvable.');
    if (inv.used_by) fail(409, 'Cette invitation a déjà été utilisée.');
    const user = await redeemInvitation(ctx, req.user.id, inv);
    if (!user) fail(409, 'Cette invitation a déjà été utilisée.');
    res.json({ user: selfUser(ctx, user) });
  });

  // Compte en attente : se présenter à la Direction
  r.post('/admission/note', requireAuth, async (req, res) => {
    if (req.user.paid_at) return res.json({ user: selfUser(ctx, req.user) });
    const note = text(req.body?.note, { field: 'Présentation', max: 500 });
    const first = !req.user.admission_requested_at;
    await db.run(
      'UPDATE users SET admission_note = ?, admission_requested_at = COALESCE(admission_requested_at, ?) WHERE id = ?',
      note, Date.now(), req.user.id,
    );
    const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (first && (await admissionMode(ctx)) === 'invitation') await announceAdmissionRequest(ctx, user);
    res.json({ user: selfUser(ctx, user) });
  });

  return r;
};
