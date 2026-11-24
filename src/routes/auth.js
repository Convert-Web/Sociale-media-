'use strict';
const express = require('express');
const { hashPassword, verifyPassword, burnPasswordCheck, newToken, sha256 } = require('../security');
const { createSession, destroySession, requireAuth } = require('../auth');
const { fail, text, USERNAME_RE, EMAIL_RE, RESERVED } = require('../http');
const { assertHuman, isDisposable, assertNotLocked, loginFailed, loginSucceeded } = require('../antispam');
const { selfUser, counters } = require('../social');
const { assertClean } = require('../contentFilter');
const { CATEGORIES } = require('../catalog');

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères.', 'PASSWORD_WEAK');
  if (pw.length > 200) fail(400, 'Mot de passe trop long.', 'PASSWORD_WEAK');
  if (!/[a-zA-Z]/.test(pw) || !/[0-9\W_]/.test(pw)) fail(400, 'Le mot de passe doit mêler des lettres et au moins un chiffre ou un symbole.', 'PASSWORD_WEAK');
  return pw;
}

// Âge minimal pour ouvrir un compte (comme les grands réseaux sociaux)
const MIN_AGE = 13;
function checkBirthdate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) fail(400, 'Indique ta date de naissance.', 'BIRTHDATE');
  const birth = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Une date qui n'existe pas (31 février) est refusée, pas décalée au mois suivant
  if (Number.isNaN(birth.getTime()) || birth.getFullYear() < 1900 || birth > new Date() || birth.getMonth() !== Number(m[2]) - 1 || birth.getDate() !== Number(m[3])) {
    fail(400, 'Date de naissance invalide.', 'BIRTHDATE');
  }
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  if (age < MIN_AGE) fail(403, `Vibz est réservé aux personnes de ${MIN_AGE} ans et plus.`, 'TOO_YOUNG');
}

module.exports = function authRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  r.get('/session', async (req, res) => {
    res.json({
      user: req.user ? selfUser(ctx, req.user) : null,
      banned: Boolean(req.banned) || undefined,
      counters: req.user ? await counters(ctx, req.user.id) : null,
      config: {
        appName: config.appName,
        realtime: config.realtime,
        version: config.version,
        videoMaxBytes: config.videoMaxBytes,
        videoMaxSeconds: config.videoMaxSeconds,
        videoTtlHours: config.videoTtlHours,
        currency: config.currency,
        stripeEnabled: Boolean(ctx.stripe),
        demoPayments: config.demoPayments,
        categories: CATEGORIES,
      },
    });
  });

  // Nom d'utilisateur disponible ? (vérifié pendant la saisie)
  r.get('/auth/username', async (req, res) => {
    const name = String(req.query.u || '').replace(/^@/, '');
    if (!USERNAME_RE.test(name)) return res.json({ ok: false, reason: '2 à 24 caractères : lettres sans accent (a-z), chiffres, « _ » ou « . ».' });
    if (RESERVED.has(name.toLowerCase())) return res.json({ ok: false, reason: 'Ce nom est réservé.' });
    // Son propre nom (même dans une autre casse) n'est pas « déjà pris »
    const taken = await db.get('SELECT 1 FROM users WHERE username = ? AND id != ?', name, req.user?.id || 0);
    if (taken) return res.json({ ok: false, reason: 'Ce nom est déjà pris.' });
    // Déjà changé ces 30 derniers jours : on le dit tout de suite, pas seulement à l'enregistrement
    if (req.user && !req.user.is_admin && name.toLowerCase() !== req.user.username.toLowerCase()) {
      const last = await db.get('SELECT value FROM settings WHERE key = ?', `username-changed:${req.user.id}`);
      const next = last ? Number(last.value) + 30 * 86400e3 : 0;
      if (next > Date.now()) {
        const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(new Date(next));
        return res.json({ ok: false, reason: `Prochain changement de nom possible le ${day}.` });
      }
    }
    res.json({ ok: true, reason: null });
  });

  r.post('/auth/signup', async (req, res) => {
    assertHuman(req.body); // champ piège et délai minimal : les robots sont refusés
    checkBirthdate(req.body.birthdate);
    if (!String(req.body.username || '').trim()) fail(400, 'Choisis un nom d’utilisateur.', 'USERNAME_INVALID');
    const username = text(req.body.username, { field: "Nom d'utilisateur", required: true, max: 24 }).replace(/^@/, '');
    const displayName = text(req.body.displayName || username, { field: 'Nom', min: 1, max: 30, required: true });
    const email = text(req.body.email, { field: 'E-mail', required: true, max: 120 }).toLowerCase();
    const password = validatePassword(req.body.password);
    if (req.body.terms !== true) fail(400, 'Accepte les conditions d’utilisation pour continuer.', 'TERMS');

    if (!USERNAME_RE.test(username)) fail(400, "Nom d'utilisateur : 2 à 24 caractères (lettres sans accent, chiffres, « _ » ou « . »).", 'USERNAME_INVALID');
    if (RESERVED.has(username.toLowerCase())) fail(409, "Ce nom d'utilisateur est réservé.", 'USERNAME_TAKEN');
    assertClean('Nom', displayName, username.replace(/[._]/g, ' '));
    if (!EMAIL_RE.test(email)) fail(400, 'Adresse e-mail invalide.', 'EMAIL_INVALID');
    if (isDisposable(email)) fail(400, 'Les adresses e-mail jetables ne sont pas acceptées.', 'EMAIL_INVALID');
    if (await db.get('SELECT 1 FROM users WHERE username = ?', username)) fail(409, "Ce nom d'utilisateur est déjà pris.", 'USERNAME_TAKEN');
    if (await db.get('SELECT 1 FROM users WHERE email = ?', email)) fail(409, 'Un compte existe déjà avec cet e-mail.', 'EMAIL_TAKEN');

    const hash = await hashPassword(password);
    // Sans ADMIN_EMAILS, le tout premier compte créé devient administrateur.
    const firstAccount = !config.adminEmails.length && !(await db.get('SELECT 1 FROM users WHERE is_admin = 1'));
    const isAdmin = config.adminEmails.includes(email) || firstAccount ? 1 : 0;
    const { lastInsertRowid } = await db.run(
      'INSERT INTO users (username, email, password_hash, display_name, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      username, email, hash, displayName, isAdmin, Date.now(),
    );
    await createSession(ctx, res, lastInsertRowid);
    const user = await db.get('SELECT * FROM users WHERE id = ?', lastInsertRowid);
    const { welcomeEmail } = require('../emails');
    ctx.mailer.send({ to: email, name: displayName, ...welcomeEmail(config, user) }).catch((err) => console.error('[email] échec :', err.message));
    res.status(201).json({ user: selfUser(ctx, user) });
  });

  r.post('/auth/login', async (req, res) => {
    const login = text(req.body.login, { field: 'Identifiant', required: true, max: 120 }).replace(/^@/, '');
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = await db.get('SELECT * FROM users WHERE (email = ? OR username = ?) AND is_bot = 0', login, login);
    assertNotLocked(user); // compte bloqué 15 min après 8 essais ratés
    const ok = user ? await verifyPassword(password, user.password_hash) : await burnPasswordCheck(password);
    if (!ok) {
      await loginFailed(ctx, user);
      fail(401, 'Identifiant ou mot de passe incorrect.', 'BAD_LOGIN');
    }
    if (user.banned_at) fail(403, 'Ce compte a été suspendu pour non-respect des règles de la communauté.', 'BANNED');
    await loginSucceeded(ctx, user);
    if (!user.is_admin && config.adminEmails.includes(user.email.toLowerCase())) {
      await db.run('UPDATE users SET is_admin = 1 WHERE id = ?', user.id);
    }
    await createSession(ctx, res, user.id);
    res.json({ user: selfUser(ctx, await db.get('SELECT * FROM users WHERE id = ?', user.id)) });
  });

  r.post('/auth/logout', async (req, res) => {
    await destroySession(ctx, req, res);
    res.json({ ok: true });
  });

  r.post('/auth/forgot', async (req, res) => {
    const email = text(req.body.email, { field: 'E-mail', required: true, max: 120 }).toLowerCase();
    const user = await db.get('SELECT * FROM users WHERE email = ? AND is_bot = 0', email);
    // Un seul courriel toutes les 2 minutes par compte (pas de bombardement de la boîte)
    const recent = user && (await db.get('SELECT 1 FROM password_resets WHERE user_id = ? AND expires_at > ?', user.id, Date.now() + 3600 * 1000 - 120 * 1000));
    if (user && !recent) {
      const token = newToken();
      await db.run('DELETE FROM password_resets WHERE user_id = ?', user.id);
      await db.run('INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), user.id, Date.now() + 3600 * 1000);
      const link = `${config.baseUrl}/reinitialiser?jeton=${token}`;
      const { resetEmail } = require('../emails');
      await ctx.mailer
        .send({ to: user.email, name: user.display_name, ...resetEmail(config, user, link) })
        .catch((err) => console.error('[email] échec :', err.message));
    }
    // Réponse identique que le compte existe ou non.
    res.json({ ok: true });
  });

  // Lien de réinitialisation encore valable ? (vérifié dès l'ouverture de la page)
  r.get('/auth/reset', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const row = token && (await db.get('SELECT 1 FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > ?', sha256(token), Date.now()));
    res.json({ valid: Boolean(row) });
  });

  r.post('/auth/reset', async (req, res) => {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const password = validatePassword(req.body.password);
    const row = await db.get('SELECT * FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > ?', sha256(token), Date.now());
    if (!row) fail(400, 'Ce lien a expiré ou a déjà été utilisé.', 'RESET_EXPIRED');
    const hash = await hashPassword(password);
    await db.transaction(async (t) => {
      await t.run('UPDATE users SET password_hash = ?, login_failures = 0, login_locked_until = NULL WHERE id = ?', hash, row.user_id);
      await t.run('UPDATE password_resets SET used_at = ? WHERE id = ?', Date.now(), row.id);
      await t.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
    });
    await createSession(ctx, res, row.user_id);
    res.json({ user: selfUser(ctx, await db.get('SELECT * FROM users WHERE id = ?', row.user_id)) });
  });

  r.post('/auth/password', requireAuth, async (req, res) => {
    const current = typeof req.body.current === 'string' ? req.body.current : '';
    const next = validatePassword(req.body.next);
    if (!(await verifyPassword(current, req.user.password_hash))) fail(400, 'Mot de passe actuel incorrect.', 'BAD_PASSWORD');
    const hash = await hashPassword(next);
    await db.transaction(async (t) => {
      await t.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, req.user.id);
      await t.run('DELETE FROM sessions WHERE user_id = ?', req.user.id);
    });
    await createSession(ctx, res, req.user.id);
    res.json({ ok: true });
  });

  return r;
};

module.exports.validatePassword = validatePassword;
