'use strict';
const express = require('express');
const { hashPassword, verifyPassword, burnPasswordCheck, newToken, sha256 } = require('../security');
const { createSession, destroySession, requireAuth } = require('../auth');
const { fail, text, USERNAME_RE, EMAIL_RE, RESERVED } = require('../http');
const { selfUser, counters } = require('../social');
const { admitMember } = require('../membership');

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  if (pw.length > 200) fail(400, 'Mot de passe trop long.');
  return pw;
}

module.exports = function authRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  r.get('/session', (req, res) => {
    res.json({
      user: req.user ? selfUser(ctx, req.user) : null,
      counters: req.user && req.user.paid_at ? counters(ctx, req.user.id) : null,
      config: {
        appName: config.appName,
        priceCents: config.priceCents,
        currency: config.currency,
        paidEntry: config.paidEntry,
        stripeEnabled: Boolean(ctx.stripe),
        demoPayments: config.demoPayments,
        founderLimit: config.founderLimit,
      },
    });
  });

  r.post('/auth/signup', async (req, res) => {
    const displayName = text(req.body.displayName, { field: 'Nom', min: 2, max: 40, required: true });
    const username = text(req.body.username, { field: "Nom d'utilisateur", required: true, max: 20 }).replace(/^@/, '');
    const email = text(req.body.email, { field: 'E-mail', required: true, max: 120 }).toLowerCase();
    const password = validatePassword(req.body.password);

    if (!USERNAME_RE.test(username)) {
      fail(400, "Nom d'utilisateur : 3 à 20 caractères (lettres, chiffres, « _ » ou « . »).");
    }
    if (RESERVED.has(username.toLowerCase())) fail(409, "Ce nom d'utilisateur est réservé.");
    if (!EMAIL_RE.test(email)) fail(400, 'Adresse e-mail invalide.');
    if (db.get('SELECT 1 FROM users WHERE username = ?', username)) fail(409, "Ce nom d'utilisateur est déjà pris.");
    if (db.get('SELECT 1 FROM users WHERE email = ?', email)) fail(409, 'Un compte existe déjà avec cet e-mail.');

    const hash = await hashPassword(password);
    // Sans ADMIN_EMAILS, le tout premier compte créé devient administrateur.
    const firstAccount = !config.adminEmails.length && !db.get('SELECT 1 FROM users WHERE is_admin = 1');
    const isAdmin = config.adminEmails.includes(email) || firstAccount ? 1 : 0;
    const { lastInsertRowid } = db.run(
      `INSERT INTO users (username, email, password_hash, display_name, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      username, email, hash, displayName, isAdmin, Date.now(),
    );
    createSession(ctx, res, lastInsertRowid);
    const user = config.paidEntry
      ? db.get('SELECT * FROM users WHERE id = ?', lastInsertRowid)
      : admitMember(ctx, lastInsertRowid);
    res.status(201).json({ user: selfUser(ctx, user) });
  });

  r.post('/auth/login', async (req, res) => {
    const login = text(req.body.login, { field: 'Identifiant', required: true, max: 120 }).replace(/^@/, '');
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = db.get('SELECT * FROM users WHERE email = ? OR username = ?', login, login);
    const ok = user ? await verifyPassword(password, user.password_hash) : await burnPasswordCheck(password);
    if (!ok) fail(401, 'Identifiants incorrects.');
    if (!user.is_admin && config.adminEmails.includes(user.email.toLowerCase())) {
      db.run('UPDATE users SET is_admin = 1 WHERE id = ?', user.id);
      user.is_admin = 1;
    }
    createSession(ctx, res, user.id);
    res.json({ user: selfUser(ctx, user.paid_at || config.paidEntry ? user : admitMember(ctx, user.id)) });
  });

  r.post('/auth/logout', (req, res) => {
    destroySession(ctx, req, res);
    res.json({ ok: true });
  });

  r.post('/auth/forgot', async (req, res) => {
    const email = text(req.body.email, { field: 'E-mail', required: true, max: 120 }).toLowerCase();
    const user = db.get('SELECT * FROM users WHERE email = ?', email);
    if (user) {
      const token = newToken();
      db.run('DELETE FROM password_resets WHERE user_id = ?', user.id);
      db.run(
        'INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, ?)',
        sha256(token), user.id, Date.now() + 3600 * 1000,
      );
      const link = `${config.baseUrl}/reinitialiser?jeton=${token}`;
      ctx.mailer
        .send({
          to: user.email,
          subject: `${config.appName} — Réinitialisation de votre mot de passe`,
          text: `Bonjour ${user.display_name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.\n\n— ${config.appName}`,
        })
        .catch((err) => console.error('[email] échec :', err.message));
    }
    // Réponse identique que le compte existe ou non.
    res.json({ ok: true });
  });

  r.post('/auth/reset', async (req, res) => {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const password = validatePassword(req.body.password);
    const row = db.get(
      'SELECT * FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > ?',
      sha256(token), Date.now(),
    );
    if (!row) fail(400, 'Ce lien a expiré ou a déjà été utilisé.');
    const hash = await hashPassword(password);
    db.transaction(() => {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, row.user_id);
      db.run('UPDATE password_resets SET used_at = ? WHERE id = ?', Date.now(), row.id);
      db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id);
    });
    createSession(ctx, res, row.user_id);
    const user = config.paidEntry ? db.get('SELECT * FROM users WHERE id = ?', row.user_id) : admitMember(ctx, row.user_id);
    res.json({ user: selfUser(ctx, user) });
  });

  r.post('/auth/password', requireAuth, async (req, res) => {
    const current = typeof req.body.current === 'string' ? req.body.current : '';
    const next = validatePassword(req.body.next);
    if (!(await verifyPassword(current, req.user.password_hash))) fail(400, 'Mot de passe actuel incorrect.');
    const hash = await hashPassword(next);
    db.transaction(() => {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, req.user.id);
      db.run('DELETE FROM sessions WHERE user_id = ?', req.user.id);
    });
    createSession(ctx, res, req.user.id);
    res.json({ ok: true });
  });

  return r;
};
