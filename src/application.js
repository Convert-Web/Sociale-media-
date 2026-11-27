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
const { webhookHandler } = require('./routes/wallet');
const { mediaHandler } = require('./uploads');
const { videoHandler } = require('./videos');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

// Lecteurs intégrés de l'Actu (YouTube sans cookie, Vimeo, Dailymotion, Spotify, Apple, SoundCloud, Deezer)
const EMBED_ORIGINS = 'https://www.youtube-nocookie.com https://player.vimeo.com https://www.dailymotion.com https://open.spotify.com https://embed.podcasts.apple.com https://w.soundcloud.com https://widget.deezer.com';

function securityHeaders(config) {
  const csp = [
    "default-src 'self'",
    // L'Actu : images des médias, épisodes de podcasts et lecteurs vidéo / audio intégrés
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data: https:",
    `frame-src ${EMBED_ORIGINS}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(config.cookieSecure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Caméra et micro : création de vidéos et LIVE, sur ce site uniquement
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), display-capture=(self)');
    if (config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
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
    pushSender: overrides.pushSender,
    translator: overrides.translator, // remplacé dans les tests
  };

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders(config));

  // Le webhook Stripe a besoin du corps brut : déclaré avant le parseur JSON.
  app.post('/api/billing/webhook', ...webhookHandler(ctx));

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  // Chaque réponse annonce la version en ligne : l'application ouverte voit aussitôt qu'une
  // nouvelle version existe et se met à jour d'elle-même, sans requête supplémentaire
  app.use('/api', (_req, res, next) => {
    res.setHeader('X-Vibz-Version', config.version);
    next();
  });
  app.use('/api', csrfGuard, loadUser(ctx));

  if (config.rateLimit) {
    const tooMany = { error: 'Trop de tentatives. Patiente quelques minutes.' };
    app.use(
      '/api/auth',
      rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false, message: tooMany }),
    );
    // Créations de compte : 8 par heure et par adresse IP
    app.use(
      '/api/auth/signup',
      rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: tooMany }),
    );
    app.use(
      '/api',
      rateLimit({
        windowMs: 60 * 1000,
        limit: 600,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: tooMany,
        // Le LIVE interroge le serveur chaque seconde : compté à part
        skip: (req) => req.path === '/stream' || /^\/live\/\d+\/(poll|host)$/.test(req.path),
      }),
    );
  }

  const routes = ['auth', 'public', 'wallet', 'videos', 'posts', 'comments', 'feed', 'discover', 'stories', 'live', 'moderation', 'push', 'translate', 'users', 'messages', 'notifications', 'me', 'studio', 'admin', 'actu', 'subjects'];
  for (const name of routes) app.use('/api', require(`./routes/${name}`)(ctx));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ressource introuvable.' }));

  // Moteurs de recherche : règles d'exploration et plan du site (adresse réelle du site)
  const { isPage, robotsTxt, sitemapXml } = require('./pages');
  app.get('/robots.txt', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(robotsTxt(config.baseUrl));
  });
  app.get('/sitemap.xml', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(sitemapXml(config.baseUrl, '2026-11-22'));
  });

  // Photos et vidéos envoyées (stockées dans la base)
  app.use('/media/v', videoHandler(ctx));
  app.use('/media', mediaHandler(ctx));
  app.use(express.static(PUBLIC_DIR, { maxAge: config.isProd ? '1h' : 0, index: false }));

  // Application monopage : toute route « propre » renvoie index.html.
  // Attention : les noms d'utilisateur peuvent contenir un point (/@alex.martin).
  const STATIC_PREFIX = /^\/(api|media|fonts|js|css|img|demo)\//;
  const ASSET_EXT = /\.(js|mjs|css|map|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|json|txt|xml|webmanifest)$/i;
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (STATIC_PREFIX.test(req.path)) return next();
    const page = isPage(req.path);
    if (!page && ASSET_EXT.test(req.path)) return next();
    // Jamais en cache : les règles de sécurité (CSP) de la page doivent toujours être les dernières
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    // Adresse inconnue : vraie réponse 404 (pour les moteurs), avec la page « introuvable » de l'application
    if (!page) {
      res.setHeader('X-Robots-Tag', 'noindex');
      res.status(404);
    }
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
    if (status >= 500) message = 'Une erreur est survenue. Réessaie dans un instant.';
    else if (err.type) message = 'Requête invalide.';
    if (req.path.startsWith('/api')) return res.status(status).json({ error: message, code: err.code });
    res.status(status).type('text/plain').send(message);
  });

  return { app, ctx };
}

module.exports = { createApp };
