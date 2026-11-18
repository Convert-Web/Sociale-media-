'use strict';
// Anti-spam : robots à l'inscription, adresses jetables, rafales de publications,
// essais de mots de passe en série et envois répétés de courriels.
const { fail } = require('./http');

// Adresses e-mail jetables les plus courantes (comptes créés en masse)
const DISPOSABLE = new Set([
  'yopmail.com', 'yopmail.fr', 'yopmail.net', 'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'guerrillamail.net',
  'sharklasers.com', 'grr.la', '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'temp-mail.io',
  'tempmailo.com', 'trashmail.com', 'trashmail.fr', 'getnada.com', 'nada.email', 'maildrop.cc', 'dispostable.com',
  'mailnesia.com', 'mintemail.com', 'throwawaymail.com', 'fakeinbox.com', 'mohmal.com', 'emailondeck.com', 'jetable.org',
  'mail-temporaire.fr', 'spamgourmet.com', 'mytemp.email', 'tempr.email', 'discard.email', 'burnermail.io', 'moakt.com',
  'tmpmail.org', 'tmail.ws', 'mailpoof.com', 'inboxkitten.com', 'emailfake.com', 'crazymailing.com',
]);

function isDisposable(email) {
  const domain = String(email).split('@')[1]?.toLowerCase() || '';
  return DISPOSABLE.has(domain) || [...DISPOSABLE].some((d) => domain.endsWith(`.${d}`));
}

// Formulaires d'inscription : un champ invisible (que seuls les robots remplissent)
// et un délai minimal entre l'affichage du formulaire et l'envoi.
const MIN_FILL_MS = 2500;
function assertHuman(body) {
  if (typeof body?.website === 'string' && body.website.trim()) fail(400, 'Inscription refusée.', 'SPAM');
  const elapsed = Number(body?.elapsed);
  if (body?.elapsed !== undefined && Number.isFinite(elapsed) && elapsed < MIN_FILL_MS) {
    fail(400, 'Envoi trop rapide. Vérifiez vos informations puis réessayez.', 'TOO_FAST');
  }
}

// Rafales : nombre maximal d'envois par membre sur une période
const LIMITS = {
  post: { table: 'posts', col: 'user_id', max: 15, ms: 3600e3, msg: 'Vous avez beaucoup publié en peu de temps. Réessayez dans un moment.' },
  comment: { table: 'comments', col: 'user_id', max: 40, ms: 600e3, msg: 'Trop de commentaires en peu de temps. Patientez quelques minutes.' },
  message: { table: 'messages', col: 'sender_id', max: 60, ms: 300e3, msg: 'Trop de messages d’affilée. Patientez quelques minutes.' },
  story: { table: 'stories', col: 'user_id', max: 30, ms: 86400e3, msg: 'Limite de stories atteinte pour aujourd’hui.' },
};
async function throttle(ctx, user, kind) {
  if (ctx.config.rateLimit === false || user?.is_admin || user?.isAdmin || user?.is_bot) return;
  const l = LIMITS[kind];
  const { n } = await ctx.db.get(`SELECT COUNT(*) AS n FROM ${l.table} WHERE ${l.col} = ? AND created_at > ?`, user.id, Date.now() - l.ms);
  if (n >= l.max) fail(429, l.msg, 'SLOW_DOWN');
}

// Mots de passe essayés en série sur un même compte : blocage temporaire
const MAX_FAILURES = 8;
const LOCK_MS = 15 * 60e3;
function assertNotLocked(user) {
  if (user?.login_locked_until && user.login_locked_until > Date.now()) {
    const min = Math.ceil((user.login_locked_until - Date.now()) / 60e3);
    fail(429, `Trop d’essais sur ce compte. Réessayez dans ${min} min, ou réinitialisez votre mot de passe.`, 'LOCKED');
  }
}
async function loginFailed(ctx, user) {
  if (!user) return;
  const n = (user.login_failures || 0) + 1;
  if (n >= MAX_FAILURES) await ctx.db.run('UPDATE users SET login_failures = 0, login_locked_until = ? WHERE id = ?', Date.now() + LOCK_MS, user.id);
  else await ctx.db.run('UPDATE users SET login_failures = ? WHERE id = ?', n, user.id);
}
async function loginSucceeded(ctx, user) {
  if (user.login_failures || user.login_locked_until) await ctx.db.run('UPDATE users SET login_failures = 0, login_locked_until = NULL WHERE id = ?', user.id);
}

module.exports = { isDisposable, assertHuman, throttle, assertNotLocked, loginFailed, loginSucceeded, MIN_FILL_MS, LIMITS };
