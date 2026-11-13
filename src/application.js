'use strict';
const path = require('node:path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const Stripe = require('stripe');

const { openDatabase } = require('./db');
const { Hub } = require('./realtime');
const { createMailer } = require('./mailer');
const { loadUser, csrfGuard } = require('./auth');
const { webhookHandler } = require('./routes/billing');
const { mediaHandler } = require('./uploads');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

function securityHeaders(config) {
  const csp = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

async function createApp(config, overrides = {}) {
  const ctx = {
    config,
    db: overrides.db || (await openDatabase(config.database)),
    hub: overrides.hub || new Hub(),
    mailer: overrides.mailer || createMailer(config),
    stripe: 'stripe' in overrides ? overrides.stripe : config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null,
  };

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders(config));

  // Le webhook Stripe a besoin du corps brut : déclaré avant le parseur JSON.
  app.post('/api/billing/webhook', ...webhookHandler(ctx));

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', csrfGuard, loadUser(ctx));

  if (config.rateLimit) {
    const tooMany = { error: 'Trop de tentatives. Patientez quelques minutes.' };
    app.use(
      '/api/auth',
      rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false, message: tooMany }),
    );
    app.use(
      '/api',
      rateLimit({
        windowMs: 60 * 1000,
        limit: 600,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: tooMany,
        skip: (req) => req.path === '/events',
      }),
    );
  }

  const routes = ['auth', 'billing', 'public', 'posts', 'stories', 'moderation', 'users', 'messages', 'notifications', 'me', 'admin'];
  for (const name of routes) app.use('/api', require(`./routes/${name}`)(ctx));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ressource introuvable.' }));

  // Photos envoyées par les membres (stockées dans la base)
  app.use('/media', mediaHandler(ctx));
  app.use(express.static(PUBLIC_DIR, { maxAge: config.isProd ? '1h' : 0, index: false }));

  // Application monopage : toute route « propre » renvoie index.html.
  // Attention : les noms d'utilisateur peuvent contenir un point (/@alexandre.v).
  const STATIC_PREFIX = /^\/(api|media|fonts|js|css|img|seed)\//;
  const ASSET_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|json|txt|xml|webmanifest)$/i;
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (STATIC_PREFIX.test(req.path)) return next();
    if (ASSET_EXT.test(req.path) && !/^\/(@|messages\/)/.test(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(INDEX_HTML);
  });

  app.use((_req, res) => res.status(404).type('text/plain').send('Introuvable'));

  // Gestion centralisée des erreurs
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    if (res.headersSent) return res.end();
    let message = err.message;
    if (status >= 500) message = 'Une erreur est survenue. Réessayez dans un instant.';
    else if (err.type) message = 'Requête invalide.';
    if (req.path.startsWith('/api')) return res.status(status).json({ error: message, code: err.code });
    res.status(status).type('text/plain').send(message);
  });

  return { app, ctx };
}

module.exports = { createApp };
