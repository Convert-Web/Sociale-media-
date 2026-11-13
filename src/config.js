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

const config = {
  isProd,
  port,
  appName: env.APP_NAME || 'AURUM',
  baseUrl: (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
  databasePath: env.DATABASE_PATH || '',
  priceCents: Number(env.ENTRY_PRICE_CENTS) || 999,
  currency: (env.CURRENCY || 'eur').toLowerCase(),
  founderLimit: Number(env.FOUNDER_LIMIT) || 100,
  // Droit d'entrée payant : désactivé par défaut (inscription gratuite).
  // Passez PAID_ENTRY=true pour exiger le paiement à l'inscription.
  paidEntry: bool(env.PAID_ENTRY, false),
  stripe: {
    secretKey: stripeSecretKey,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  },
  // Paiement simulé : actif par défaut uniquement en développement sans clé Stripe.
  demoPayments: bool(env.DEMO_PAYMENTS, !stripeSecretKey && !isProd),
  adminEmails: (env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  smtp: {
    url: env.SMTP_URL || '',
    from: env.MAIL_FROM || 'AURUM <no-reply@aurum.local>',
  },
  cookieSecure: bool(env.COOKIE_SECURE, isProd),
  trustProxy: bool(env.TRUST_PROXY, isProd),
  rateLimit: bool(env.RATE_LIMIT, true),
};

if (!config.databasePath) config.databasePath = path.join(config.dataDir, 'aurum.db');
config.uploadsDir = path.join(config.dataDir, 'uploads');

module.exports = config;
