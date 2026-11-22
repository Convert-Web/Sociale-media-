#!/usr/bin/env node
'use strict';
// Ajoute le contenu de démonstration à la base configurée (npm run seed), ou le retire (npm run seed -- --retirer).
const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { Hub } = require('../src/realtime');
const { addDemo, removeDemo } = require('../src/demo');

(async () => {
  const db = await openDatabase(config.database);
  const ctx = { config, db, hub: new Hub() };
  try {
    if (process.argv.includes('--retirer')) {
      const r = await removeDemo(ctx);
      console.log(`Contenu de démonstration retiré : ${r.removed} comptes.`);
    } else {
      const r = await addDemo(ctx, { origin: config.baseUrl });
      console.log(r.added ? `Contenu de démonstration ajouté : ${r.users} comptes, ${r.posts} vidéos.` : 'Le contenu de démonstration est déjà présent.');
    }
  } finally {
    ctx.hub.close();
    db.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
