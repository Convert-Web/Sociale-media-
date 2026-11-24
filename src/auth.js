'use strict';
const { newToken, sha256 } = require('./security');
const { fail } = require('./http');

const SESSION_COOKIE = 'vibz_sid';
const SESSION_TTL = 60 * 24 * 3600 * 1000; // 60 jours

async function createSession(ctx, res, userId) {
  const token = newToken();
  const now = Date.now();
  await ctx.db.run(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    sha256(token), userId, now, now + SESSION_TTL,
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.cookieSecure,
    maxAge: SESSION_TTL,
    path: '/',
  });
}

async function destroySession(ctx, req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await ctx.db.run('DELETE FROM sessions WHERE id = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

// Charge le compte connecté (ou rien : on peut regarder Vibz sans compte)
function loadUser(ctx) {
  let lastCleanup = 0;
  return async (req, _res, next) => {
    req.user = null;
    const token = req.cookies?.[SESSION_COOKIE];
    if (token && typeof token === 'string' && token.length < 100) {
      const now = Date.now();
      const row = await ctx.db.get(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > ?`,
        sha256(token), now,
      );
      // Compte suspendu par l'administration : plus de session
      if (row && !row.banned_at && !row.is_bot) req.user = row;
      else if (row?.banned_at) req.banned = true;
      if (now - lastCleanup > 3600 * 1000) {
        lastCleanup = now;
        ctx.db.run('DELETE FROM sessions WHERE expires_at <= ?', now).catch(() => {});
      }
    }
    next();
  };
}

const BANNED = 'Ce compte a été suspendu pour non-respect des règles de la communauté.';
function requireAuth(req, _res, next) {
  if (!req.user) fail(401, req.banned ? BANNED : 'Connecte-toi pour continuer.', req.banned ? 'BANNED' : 'AUTH_REQUIRED');
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.user) fail(401, 'Connecte-toi pour continuer.', 'AUTH_REQUIRED');
  if (!req.user.is_admin) fail(403, 'Accès réservé à l’administration.');
  next();
}

// Protection CSRF : toute requête d'écriture doit porter un en-tête personnalisé,
// qu'un site tiers ne peut pas ajouter sans déclencher une requête CORS refusée.
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/billing/webhook') return next();
  // Départ d'un spectateur envoyé à la fermeture de l'onglet (sendBeacon, sans en-tête) : il ne fait
  // que retirer la connexion dont l'identifiant secret est donné
  if (/^\/live\/\d+\/leave$/.test(req.path)) return next();
  if (req.get('x-vibz') !== '1') fail(403, 'Requête refusée.');
  next();
}

module.exports = { SESSION_COOKIE, createSession, destroySession, loadUser, requireAuth, requireAdmin, csrfGuard };
