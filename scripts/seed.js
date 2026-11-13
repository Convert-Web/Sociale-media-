'use strict';
// Remplit la base avec des membres fictifs pour tester AURUM.
// Usage : npm run seed   (mot de passe de tous les comptes : aurum-demo-2026)
const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { hashPassword } = require('../src/security');
const { grantMembership } = require('../src/membership');

const PASSWORD = 'aurum-demo-2026';
const H = 3600 * 1000;

const MEMBERS = [
  { username: 'victoire', name: 'Victoire de Montclar', profession: 'Fondatrice — Maison Montclar, joaillerie', city: 'Paris', bio: 'Joaillière de troisième génération. Je crois aux objets qui traversent les siècles. #joaillerie #artisanat', admin: true },
  { username: 'alexandre.v', name: 'Alexandre Valmont', profession: 'Associé, fonds de capital-risque', city: 'Genève', bio: 'J’investis dans les fondateurs avant les idées. Ancien entrepreneur, deux sorties. #investissement' },
  { username: 'ines.benali', name: 'Inès Benali', profession: "Architecte d'intérieur", city: 'Monaco', bio: 'Villas, yachts et hôtels particuliers. La lumière est mon premier matériau. #design' },
  { username: 'theo.marchetti', name: 'Théodore Marchetti', profession: 'Chef, deux étoiles', city: 'Lyon', bio: 'Cuisine de saison, produits d’exception, zéro compromis. #gastronomie' },
  { username: 'camille.rl', name: 'Camille Rousseau-Lenoir', profession: "Avocate d'affaires", city: 'Paris', bio: 'Fusions-acquisitions et private equity. Le diable est dans les détails — moi aussi.' },
  { username: 'hugo.delacroix', name: 'Hugo Delacroix', profession: 'Fondateur, start-up IA', city: 'Bordeaux', bio: 'On construit des agents qui font gagner 10 h par semaine aux dirigeants. Série A bouclée. #tech #entrepreneuriat' },
  { username: 'lea.aubertin', name: 'Léa Aubertin', profession: "Galeriste, art contemporain", city: 'Paris', bio: 'Galerie Aubertin, Marais. Je défends des artistes avant qu’ils ne soient à la mode. #art' },
  { username: 'malik.ok', name: 'Malik Okonkwo', profession: 'Commandant de bord & collectionneur', city: 'Nice', bio: '15 000 heures de vol, une passion pour l’horlogerie indépendante. #horlogerie #voyage' },
];

const POSTS = [
  ['victoire', 'Premier jour du cercle. Ici, pas de bruit — seulement des gens qui ont des choses à dire. Bienvenue à toutes et à tous. #aurum', 'artdeco.svg', 118],
  ['alexandre.v', 'Ce que je regarde en premier chez un fondateur : sa capacité à dire « je ne sais pas ». Les meilleurs le disent souvent. #investissement #entrepreneuriat', null, 102],
  ['ines.benali', 'Livraison d’une villa sur le Cap ce matin. Huit mois de travail, une seule obsession : que la mer entre dans chaque pièce. #design', 'riviera.svg', 96],
  ['theo.marchetti', 'Les premières truffes blanches d’Alba sont arrivées. Menu dégustation modifié dès ce soir. @victoire je vous garde une table ? #gastronomie', null, 80],
  ['hugo.delacroix', 'Série A bouclée : 12 M€. Merci à @alexandre.v pour la confiance depuis le premier jour. On recrute à Bordeaux et à Paris. #tech #entrepreneuriat', null, 70],
  ['lea.aubertin', 'Vernissage jeudi, 19 h, galerie Aubertin. Une peintre de 26 ans que vous allez entendre citer partout d’ici deux ans. Membres du cercle bienvenus. #art', null, 60],
  ['malik.ok', 'Approche de nuit sur Genève. Il y a des bureaux pires que celui-ci. #voyage', 'skyline.svg', 52],
  ['camille.rl', 'Conseil du jour : relisez toujours la clause de non-concurrence avant de signer un pacte d’associés. Toujours.', null, 40],
  ['victoire', 'Saison d’hiver à Courchevel. Qui sera là la semaine du 20 ? On pourrait organiser un dîner du cercle. #voyage', 'alpes.svg', 30],
  ['alexandre.v', 'Le meilleur investissement que j’ai fait cette année : 9,99 € pour entrer ici. Le rapport signal/bruit est incomparable.', null, 20],
  ['malik.ok', 'Question aux amateurs d’horlogerie : quelle manufacture indépendante suivez-vous en ce moment ? Je cherche ma prochaine pièce. #horlogerie', null, 12],
  ['ines.benali', '@lea.aubertin votre dernière exposition m’a donné une idée pour un salon à Monaco. Je vous écris. #art #design', null, 5],
  ['hugo.delacroix', 'Petit rappel : déléguer, ce n’est pas se débarrasser. C’est faire confiance avec un cadre clair.', null, 2],
];

const COMMENTS = [
  [0, 'alexandre.v', 'Heureux d’en être. Bravo pour le lancement.'],
  [0, 'ines.benali', 'Enfin un endroit calme. Merci Victoire.'],
  [1, 'hugo.delacroix', 'Tellement vrai. C’est ce qui m’a fait vous choisir aussi.'],
  [2, 'lea.aubertin', 'Somptueux. Les volumes sont incroyables.'],
  [3, 'victoire', 'Toujours, Théodore. Vendredi soir ?'],
  [4, 'alexandre.v', 'Mérité. Et ce n’est que le début.'],
  [4, 'camille.rl', 'Félicitations Hugo !'],
  [6, 'theo.marchetti', 'Vue imprenable. Bon vol, commandant.'],
  [8, 'malik.ok', 'Présent ! Je peux m’occuper de la réservation.'],
  [8, 'ines.benali', 'Avec plaisir, je serai au Chabichou.'],
  [10, 'victoire', 'Regardez du côté de la Vallée de Joux. Il y a de vraies pépites.'],
];

const FOLLOWS = {
  victoire: ['alexandre.v', 'ines.benali', 'theo.marchetti', 'lea.aubertin', 'malik.ok'],
  'alexandre.v': ['victoire', 'hugo.delacroix', 'camille.rl'],
  'ines.benali': ['victoire', 'lea.aubertin', 'theo.marchetti'],
  'theo.marchetti': ['victoire', 'ines.benali'],
  'camille.rl': ['alexandre.v', 'victoire', 'hugo.delacroix'],
  'hugo.delacroix': ['alexandre.v', 'camille.rl', 'victoire'],
  'lea.aubertin': ['ines.benali', 'victoire'],
  'malik.ok': ['victoire', 'theo.marchetti', 'alexandre.v'],
};

const MESSAGES = [
  ['alexandre.v', 'victoire', 'Victoire, bravo pour le lancement. On déjeune la semaine prochaine ?', 26],
  ['victoire', 'alexandre.v', 'Avec plaisir Alexandre. Mardi, au Bristol ?', 25],
  ['alexandre.v', 'victoire', 'Parfait. 13 h. J’ai un dossier qui pourrait vous intéresser.', 24],
  ['theo.marchetti', 'victoire', 'Table pour deux vendredi, c’est noté. Vous viendrez accompagnée ?', 6],
];

async function main() {
  const db = openDatabase(config.databasePath);
  if (db.get('SELECT 1 FROM users WHERE username = ?', 'victoire')) {
    console.log('Les données de démonstration sont déjà présentes.');
    return;
  }
  const hash = await hashPassword(PASSWORD);
  const now = Date.now();
  const ids = {};
  const ctx = { db, config };

  for (const [i, m] of MEMBERS.entries()) {
    const created = now - (140 - i * 3) * H;
    const { lastInsertRowid } = db.run(
      `INSERT INTO users (username, email, password_hash, display_name, bio, city, profession, is_admin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.username, `${m.username.replace('.', '')}@aurum.demo`, hash, m.name, m.bio, m.city, m.profession, m.admin ? 1 : 0, created,
    );
    ids[m.username] = lastInsertRowid;
    grantMembership(ctx, lastInsertRowid, { provider: 'demo', ref: `seed_${m.username}`, amountCents: config.priceCents, currency: config.currency });
    db.run('UPDATE users SET paid_at = ? WHERE id = ?', created + 60000, lastInsertRowid);
    db.run('UPDATE payments SET created_at = ? WHERE provider_ref = ?', created + 60000, `seed_${m.username}`);
  }

  const postIds = POSTS.map(([user, body, image, hoursAgo]) => {
    const { lastInsertRowid } = db.run(
      'INSERT INTO posts (user_id, body, image, created_at) VALUES (?, ?, ?, ?)',
      ids[user], body, image ? `/seed/${image}` : null, now - hoursAgo * H,
    );
    return { id: lastInsertRowid, at: now - hoursAgo * H, author: ids[user] };
  });

  for (const [idx, user, body] of COMMENTS) {
    const p = postIds[idx];
    const at = p.at + (1 + Math.random() * 5) * H;
    db.run('INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', p.id, ids[user], body, Math.min(at, now - 60000));
    db.run('INSERT INTO notifications (user_id, actor_id, type, post_id, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?)', p.author, ids[user], 'comment', p.id, Math.min(at, now - 60000), now);
  }

  for (const [follower, followees] of Object.entries(FOLLOWS)) {
    for (const f of followees) {
      db.run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', ids[follower], ids[f], now - 100 * H);
    }
  }

  const usernames = Object.keys(ids);
  for (const p of postIds) {
    for (const u of usernames) {
      if (ids[u] !== p.author && Math.random() < 0.55) {
        db.run('INSERT OR IGNORE INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)', ids[u], p.id, p.at + H);
      }
    }
  }

  for (const [from, to, body, hoursAgo] of MESSAGES) {
    db.run(
      'INSERT INTO messages (sender_id, recipient_id, body, created_at, read_at) VALUES (?, ?, ?, ?, ?)',
      ids[from], ids[to], body, now - hoursAgo * H, hoursAgo > 10 ? now - (hoursAgo - 1) * H : null,
    );
  }

  console.log(`✦ ${MEMBERS.length} membres de démonstration créés.`);
  console.log('  Connexion : victoire@aurum.demo  /  mot de passe : aurum-demo-2026  (compte administrateur)');
  console.log('  Autres comptes : alexandrev@aurum.demo, inesbenali@aurum.demo… (même mot de passe)');
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
