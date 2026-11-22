'use strict';
// Point d'entrée unique.
// - Sur Vercel : ce fichier exporte l'application Express (démarrée à la première requête).
// - En local ou sur un serveur classique (`npm start`) : il écoute sur le port configuré.
const express = require('express');
const config = require('./src/config');
const { createApp } = require('./src/application');

let starting = null;
function start() {
  if (!starting) {
    starting = createApp(config).catch((err) => {
      starting = null; // nouvelle tentative à la requête suivante
      throw err;
    });
  }
  return starting;
}

// Application « enveloppe » : attend l'initialisation (connexion à la base) puis délègue.
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  start()
    .then(({ app: inner }) => inner(req, res, next))
    .catch((err) => {
      console.error('Démarrage impossible :', err.message);
      res.status(503).type('text/plain').send('Service momentanément indisponible. Réessayez dans un instant.');
    });
});

module.exports = app;

if (require.main === module) {
  start()
    .then(({ ctx }) => {
      const server = app.listen(config.port, async () => {
        const payment = ctx.stripe
          ? `Stripe (${config.stripe.secretKey.startsWith('sk_live') ? 'PRODUCTION' : 'mode test'})`
          : config.demoPayments
            ? 'SIMULÉ (mode démo — aucun encaissement réel)'
            : 'désactivé (ajoute STRIPE_SECRET_KEY pour vendre des pièces)';
        console.log(`
  ▶ ${config.appName} est en ligne
  ─────────────────────────────────────────
  Adresse    : ${config.baseUrl}
  Pièces     : ${payment}
  Données    : ${ctx.db.remote ? 'Turso (base en ligne)' : config.database.url.replace(/^file:/, '')}
  Temps réel : ${config.realtime === 'sse' ? 'connexion permanente' : 'rafraîchissement régulier'}
  LIVE       : ${config.ice.some((s) => String(s.urls).includes('turn:')) ? 'STUN + TURN' : 'STUN public (ajoute un serveur TURN pour plus de fiabilité)'}
`);
        if (config.isProd && !ctx.db.remote) {
          console.warn('  ⚠ Aucune base Turso configurée (TURSO_DATABASE_URL) : sur un hébergeur gratuit, les données seront perdues au prochain redémarrage.\n');
        }
        if (ctx.stripe && !config.stripe.webhookSecret) {
          console.warn('  ⚠ STRIPE_WEBHOOK_SECRET absent : le webhook est désactivé (le retour de paiement reste vérifié).\n');
        }
        // Contenu de démonstration au premier démarrage (SEED_DEMO=true, développement uniquement)
        if (config.seedDemo && !config.isProd) {
          const { addDemo } = require('./src/demo');
          addDemo(ctx, { origin: config.baseUrl, onlyIfEmpty: true })
            .then((r) => r.added && console.log(`  ✓ Contenu de démonstration ajouté : ${r.users} comptes, ${r.posts} vidéos.\n`))
            .catch((err) => console.warn('  ⚠ Démo :', err.message));
        }
      });

      const shutdown = () => {
        ctx.hub.close();
        server.close(() => {
          ctx.db.close();
          process.exit(0);
        });
        setTimeout(() => process.exit(0), 5000).unref();
      };
      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);
    })
    .catch((err) => {
      console.error('Démarrage impossible :', err.message);
      process.exit(1);
    });
}
