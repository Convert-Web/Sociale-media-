'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Charge le fichier .env s'il existe (Node >= 21.7)
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const port = Number(env.PORT) || 3000;
const stripeSecretKey = env.STRIPE_SECRET_KEY || '';

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'oui', 'on'].includes(String(value).toLowerCase());
}

// Serveurs ICE du LIVE (WebRTC). STUN public par défaut ; un serveur TURN rend le LIVE fiable
// derrière les réseaux d'entreprise et certains opérateurs mobiles (TURN_URL ou ICE_SERVERS).
function iceServers() {
  if (env.ICE_SERVERS) {
    try {
      const list = JSON.parse(env.ICE_SERVERS);
      if (Array.isArray(list) && list.length) return list;
    } catch {
      console.warn('ICE_SERVERS ignoré : JSON invalide.');
    }
  }
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (env.TURN_URL) {
    list.push({ urls: env.TURN_URL.split(',').map((s) => s.trim()).filter(Boolean), username: env.TURN_USERNAME || '', credential: env.TURN_CREDENTIAL || '' });
  }
  return list;
}

const config = {
  isProd,
  port,
  appName: env.APP_NAME || 'Vibz',
  // Version déployée (change à chaque mise en ligne) : rafraîchit l'application gardée sur le téléphone
  version: env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_DEPLOYMENT_ID || env.APP_VERSION || `local-${Date.now()}`,
  baseUrl: (
    env.BASE_URL ||
    env.RENDER_EXTERNAL_URL ||
    (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    `http://localhost:${port}`
  ).replace(/\/$/, ''),
  dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
  databasePath: env.DATABASE_PATH || '',
  currency: (env.CURRENCY || 'eur').toLowerCase(),
  // Espace réservé aux vidéos dans la base (Turso gratuit : 5 Go au total)
  videoStorageBytes: (Number(env.VIDEO_STORAGE_MB) || 3000) * 1024 * 1024,
  // Durée de vie des vidéos publiées, en heures ; 0 (par défaut) : gardées tant que leur auteur ne les supprime pas
  videoTtlHours: Math.max(0, Number(env.VIDEO_TTL_HOURS) || 0),
  // Poids maximal d'une vidéo (publiée telle que filmée, en qualité d'origine) : 250 Mo par défaut
  videoMaxBytes: Math.max(10, Number(env.VIDEO_MAX_MB) || 250) * 1024 * 1024,
  // Durée maximale d'une vidéo, en secondes (3 minutes par défaut, 10 minutes au plus)
  videoMaxSeconds: Math.min(600, Math.max(15, Number(env.VIDEO_MAX_SECONDS) || 180)),
  stripe: {
    secretKey: stripeSecretKey,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  },
  // Achats de pièces simulés : uniquement sur l'ordinateur de développement, jamais en ligne
  demoPayments: !isProd && bool(env.DEMO_PAYMENTS, !stripeSecretKey),
  adminEmails: (env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  smtp: {
    url: env.SMTP_URL || '',
    from: env.MAIL_FROM || 'Vibz <no-reply@vibz.local>',
  },
  // Traduction : DeepL si une clé est fournie, sinon MyMemory (gratuit, sans compte).
  translate: {
    deeplKey: env.DEEPL_API_KEY || '',
    email: env.TRANSLATE_EMAIL || '',
  },
  mail: {
    brevoKey: env.BREVO_API_KEY || '',
    cronSecret: env.CRON_SECRET || '',
  },
  cookieSecure: bool(env.COOKIE_SECURE, isProd),
  trustProxy: bool(env.TRUST_PROXY, isProd),
  rateLimit: bool(env.RATE_LIMIT, true),
  // « sse » : connexion permanente ; « poll » : rafraîchissement régulier
  // (obligatoire sur les hébergeurs « serverless » comme Vercel).
  realtime: env.REALTIME === 'sse' || env.REALTIME === 'poll' ? env.REALTIME : env.VERCEL ? 'poll' : 'sse',
  // LIVE : serveurs ICE et nombre de spectateurs par LIVE (chaque spectateur reçoit l'image directement)
  ice: iceServers(),
  liveMaxViewers: Math.max(1, Number(env.LIVE_MAX_VIEWERS) || 25),
  // Contenu de démonstration ajouté automatiquement au premier démarrage (développement uniquement)
  seedDemo: bool(env.SEED_DEMO, false),
};

if (!config.databasePath) {
  // Continuité : une base locale d'AURUM existante est reprise (ses comptes deviennent privés)
  const legacy = path.join(config.dataDir, 'aurum.db');
  const fresh = path.join(config.dataDir, 'vibz.db');
  config.databasePath = !fs.existsSync(fresh) && fs.existsSync(legacy) ? legacy : fresh;
}
// Base de données : Turso (gratuit, en ligne) si configuré, sinon fichier SQLite local.
config.database = {
  url: env.TURSO_DATABASE_URL || env.DATABASE_URL || `file:${config.databasePath}`,
  authToken: env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN || '',
};

module.exports = config;
