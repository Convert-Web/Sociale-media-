'use strict';
const config = require('./src/config');
const { createApp } = require('./src/app');

const { app, ctx } = createApp(config);

const server = app.listen(config.port, () => {
  const payment = ctx.stripe
    ? `Stripe (${config.stripe.secretKey.startsWith('sk_live') ? 'PRODUCTION' : 'mode test'})`
    : config.demoPayments
      ? 'SIMULÉ (mode démo — aucun encaissement réel)'
      : 'DÉSACTIVÉ (ajoutez STRIPE_SECRET_KEY)';
  console.log(`
  ✦ ${config.appName} — le cercle est ouvert
  ─────────────────────────────────────────
  Adresse   : ${config.baseUrl}
  Paiement  : ${payment}
  Entrée    : ${(config.priceCents / 100).toFixed(2).replace('.', ',')} ${config.currency.toUpperCase()}
  Données   : ${config.dataDir}
`);
  if (ctx.stripe && !config.stripe.webhookSecret) {
    console.warn('  ⚠ STRIPE_WEBHOOK_SECRET absent : le webhook est désactivé (le retour de paiement reste vérifié).\n');
  }
});

function shutdown() {
  ctx.hub.close();
  server.close(() => {
    ctx.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
