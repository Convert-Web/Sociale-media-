'use strict';
// Entrée dans le cercle : libre, ou sur invitation (parrainage) / validation par la Direction.
const crypto = require('node:crypto');

const MODES = ['invitation', 'open'];
const caches = new WeakMap(); // par base : { mode, at }

async function admissionMode(ctx) {
  const cache = caches.get(ctx.db);
  if (cache && Date.now() - cache.at < 15000) return cache.mode;
  const row = await ctx.db.get("SELECT value FROM settings WHERE key = 'admission'");
  const mode = MODES.includes(row?.value) ? row.value : ctx.config.admissionDefault;
  caches.set(ctx.db, { mode, at: Date.now() });
  return mode;
}

async function setAdmissionMode(ctx, mode) {
  if (!MODES.includes(mode)) return;
  await ctx.db.run(
    "INSERT INTO settings (key, value) VALUES ('admission', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    mode,
  );
  caches.set(ctx.db, { mode, at: Date.now() });
}

// Codes lisibles, sans caractères ambigus (0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

const normalizeCode = (v) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) : '');

async function findInvitation(ctx, code) {
  const c = normalizeCode(code);
  if (c.length < 6) return null;
  return ctx.db.get(
    `SELECT i.*, u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at, u.paid_at AS inviter_member
     FROM invitations i JOIN users u ON u.id = i.inviter_id WHERE i.code = ?`,
    c,
  );
}

// Places de Fondateur restantes (les numéros ne sont jamais réattribués)
async function foundersLeft(ctx) {
  const { last } = await ctx.db.get('SELECT COALESCE(MAX(number), 0) AS last FROM member_numbers');
  return Math.max(0, ctx.config.founderLimit - last);
}

module.exports = { admissionMode, setAdmissionMode, newCode, normalizeCode, findInvitation, foundersLeft, MODES };

// Accepte une invitation pour un compte : marque le carton comme utilisé, admet le membre
// et prévient le parrain. Renvoie la ligne utilisateur à jour, ou null si le carton a déjà servi.
async function redeemInvitation(ctx, userId, invitation) {
  const { admitMember } = require('./membership');
  const { notify } = require('./social');
  const { sendPush } = require('./push');
  const { changes } = await ctx.db.run(
    'UPDATE invitations SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL',
    userId, Date.now(), invitation.code,
  );
  if (!changes) return null;
  await ctx.db.run('UPDATE users SET invited_by = ?, admission_declined_at = NULL WHERE id = ?', invitation.inviter_id, userId);
  const user = await admitMember(ctx, userId);
  await notify(ctx, { userId: invitation.inviter_id, actorId: userId, type: 'invite_accepted' });
  sendPush(ctx, invitation.inviter_id, {
    title: 'Votre invitation a été acceptée',
    body: `${user.display_name} a rejoint AURUM grâce à vous.`,
    url: `/@${user.username}`,
    tag: `invite-${userId}`,
  }).catch(() => {});
  return user;
}

// Nouvelle demande d'admission : la Direction est prévenue (notification + téléphone).
async function announceAdmissionRequest(ctx, user) {
  const { notify } = require('./social');
  const { sendPush } = require('./push');
  const admins = await ctx.db.all('SELECT id FROM users WHERE is_admin = 1 AND paid_at IS NOT NULL');
  for (const a of admins) {
    await notify(ctx, { userId: a.id, actorId: user.id, type: 'admission_request' });
    sendPush(ctx, a.id, {
      title: 'Nouvelle demande d’admission',
      body: `${user.display_name} souhaite rejoindre le cercle.`,
      url: '/admin',
      tag: `admission-${user.id}`,
    }).catch(() => {});
  }
}

module.exports.redeemInvitation = redeemInvitation;
module.exports.announceAdmissionRequest = announceAdmissionRequest;
