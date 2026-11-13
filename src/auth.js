'use strict';
const { newToken, sha256 } = require('./security');
const { fail } = require('./http');

const SESSION_COOKIE = 'aurum_sid';
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 jours

function createSession(ctx, res, userId) {
  const token = newToken();
  const now = Date.now();
  ctx.db.run(
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

function destroySession(ctx, req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) ctx.db.run('DELETE FROM sessions WHERE id = ?', sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function loadUser(ctx) {
  let lastCleanup = 0;
  return (req, _res, next) => {
    req.user = null;
    const token = req.cookies?.[SESSION_COOKIE];
    if (token && typeof token === 'string' && token.length < 100) {
      const now = Date.now();
      const row = ctx.db.get(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND s.expires_at > ?`,
        sha256(token), now,
      );
      if (row) req.user = row;
      if (now - lastCleanup > 3600 * 1000) {
        lastCleanup = now;
        ctx.db.run('DELETE FROM sessions WHERE expires_at <= ?', now);
      }
    }
    next();
  };
}

const isMember = (user) => Boolean(user && user.paid_at);

function requireAuth(req, _res, next) {
  if (!req.user) fail(401, 'Veuillez vous connecter.', 'AUTH_REQUIRED');
  next();
}

function requireMember(req, _res, next) {
  if (!req.user) fail(401, 'Veuillez vous connecter.', 'AUTH_REQUIRED');
  if (!isMember(req.user)) fail(402, "Votre droit d'entrée n'a pas encore été réglé.", 'PAYMENT_REQUIRED');
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.user || !req.user.is_admin) fail(403, 'Accès réservé à la direction du cercle.');
  next();
}

// Protection CSRF : toute requête d'écriture doit porter un en-tête personnalisé,
// qu'un site tiers ne peut pas ajouter sans déclencher une requête CORS refusée.
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-aurum') !== '1') fail(403, 'Requête refusée.');
  next();
}

module.exports = {
  SESSION_COOKIE,
  createSession,
  destroySession,
  loadUser,
  isMember,
  requireAuth,
  requireMember,
  requireAdmin,
  csrfGuard,
};
