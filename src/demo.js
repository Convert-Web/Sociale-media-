'use strict';
// Contenu de démonstration : comptes « Démo » (signalés comme tels sur leur profil), vidéos
// générées par calcul (public/demo, voir scripts/make-demo.js), sons réutilisés, abonnements,
// J'aime et commentaires. Ajouté par « npm run seed » ou depuis l'administration, retiré d'un geste.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('./security');
const { extractTags } = require('./tags');
const { deleteUser } = require('./accounts');
const { deleteUploads } = require('./uploads');
const V = require('./videos');

const DIR = path.join(__dirname, '..', 'public', 'demo');
const DEMO_BIO = 'Compte de démonstration d’AURUM';

const USERS = [
  { username: 'atelier.pixel', name: 'Atelier Pixel', bio: 'Art génératif et pixels qui bougent ✨' },
  { username: 'synthwave.lab', name: 'Synthwave Lab', bio: 'Des sons faits maison, libres pour tes vidéos 🎹' },
  { username: 'fractal.club', name: 'Fractal Club', bio: 'Les maths, mais en beau 🌀' },
  { username: 'astuces.express', name: 'Astuces Express', bio: 'Une astuce par jour, en 10 secondes ⌨️' },
  { username: 'cuisine.minute', name: 'Cuisine Minute', bio: 'Recettes rapides pour soirs pressés 🍝' },
  { username: 'escapades.fr', name: 'Escapades', bio: 'Idées de voyages en France 🇫🇷' },
  { username: 'coach.gainage', name: 'Coach Gainage', bio: 'Du sport sans matériel 💪' },
  { username: 'defi.du.jour', name: 'Défi du jour', bio: 'Chaque jour un nouveau défi 👀' },
  { username: 'pause.zen', name: 'Pause Zen', bio: 'Respire. Tout va bien 🌈' },
  { username: 'lumi.demo', name: 'Lumi', bio: 'Je commente tout 😄' },
  { username: 'noa.demo', name: 'Noa', bio: 'Fan de musique et de défis' },
  { username: 'sacha.demo', name: 'Sacha', bio: 'Curieux de tout' },
];

// Vidéos : fichier, auteur, description, catégorie ; « sound » : vidéo dont le son est réutilisé
const POSTS = [
  { file: 'd06', author: 'synthwave.lab', category: 'musique', title: 'Nuit néon - Synthwave Lab', body: 'Nouveau son synthwave fait maison 🎹 Utilise-le pour tes vidéos ! #synthwave #musique #producteur' },
  { file: 'd02', author: 'atelier.pixel', category: 'art', title: 'Chiptune de la vie - Atelier Pixel', body: 'Le jeu de la vie de Conway, version néon 🌱 Chaque pixel vit ou meurt selon ses voisins. #science #art #pixelart' },
  { file: 'd05', author: 'fractal.club', category: 'art', title: 'Lo-fi plasma - Fractal Club', body: 'Plasma rétro façon démoscène des années 90 👾 #retro #demoscene #art' },
  { file: 'd04', author: 'pause.zen', category: 'quotidien', title: 'Respiration douce - Pause Zen', body: 'Pause respiration : suis les couleurs pendant 12 secondes 🌈 #relax #bienetre #asmr' },
  { file: 'd14', author: 'defi.du.jour', category: 'danse', title: 'Rythme du défi - Défi du jour', body: 'Bouge sur ce rythme 💃🕺 Fais un Duo avec moi ! #danse #challenge #rythme' },
  { file: 'd07', author: 'synthwave.lab', category: 'musique', title: 'Cloches - Synthwave Lab', body: 'Voilà à quoi ressemble le son d’une cloche 🔔 Les graves en bas, les aigus en haut. #son #musique #science' },
  { file: 'd08', author: 'fractal.club', category: 'savoir', title: 'Deux notes - Fractal Club', body: 'Deux notes en stéréo = une figure de Lissajous ✨ #physique #musique #maths' },
  { file: 'd01', author: 'fractal.club', category: 'savoir', sound: 'd06', body: 'Zoom infini dans l’ensemble de Mandelbrot 🌀 Jusqu’où tu tiens ? #fractale #maths #hypnotique' },
  { file: 'd03', author: 'atelier.pixel', category: 'savoir', sound: 'd02', body: 'La règle 110 : un automate tout simple capable de tout calculer 🤯 #maths #informatique #pixelart' },
  { file: 'd09', author: 'astuces.express', category: 'tech', sound: 'd06', body: '3 raccourcis clavier qui font gagner du temps ⌨️ Lequel tu connaissais pas ? #astuce #tech #productivite' },
  { file: 'd11', author: 'cuisine.minute', category: 'cuisine', sound: 'd05', body: 'Pâtes citron & basilic en 10 minutes 🍋🌿 #recette #cuisine #rapide' },
  { file: 'd12', author: 'escapades.fr', category: 'voyage', sound: 'd04', body: '3 idées de week-end cet hiver ❄️ Tu choisis lequel ? #voyage #france #weekend' },
  { file: 'd10', author: 'defi.du.jour', category: 'humour', sound: 'd14', body: 'Défi : 10 secondes sans cligner des yeux 👀 Raconte en commentaire ! #defi #challenge #humour' },
  { file: 'd13', author: 'coach.gainage', category: 'fitness', sound: 'd14', body: '10 secondes de gainage, tu tiens ? 💪 #fitness #sport #gainage' },
];

const COMMENTS = [
  'Trop bien 😍', 'Je pourrais regarder ça toute la journée', 'Le son est incroyable 🔥', 'Comment tu fais ça ?!', 'Enregistré pour plus tard 📌',
  'Ça m’apaise direct', 'Partie 2 stp 🙏', 'J’ai essayé, c’est validé ✅', 'Le meilleur compte d’AURUM', 'Je viens de découvrir, abonné·e !',
  'Mon cerveau a fondu 🤯', 'Qui est là en 2026 ? 😂', 'Tellement satisfaisant', 'Je partage à mes potes', 'Ça mérite plus de vues',
];

// Générateur pseudo-aléatoire déterministe (la démo est identique à chaque ajout)
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

async function readAsset(name, origin) {
  const local = path.join(DIR, name);
  if (fs.existsSync(local)) return fs.readFileSync(local);
  const res = await fetch(`${origin}/demo/${name}`);
  if (!res.ok) throw new Error(`Fichier de démonstration introuvable : ${name}`);
  return Buffer.from(await res.arrayBuffer());
}

async function storeImage(db, buf) {
  const id = crypto.randomBytes(16).toString('hex');
  await db.run('INSERT INTO media (id, mime, data, size, created_at) VALUES (?, ?, ?, ?, ?)', id, 'image/jpeg', buf, buf.length, Date.now());
  return `/media/${id}.jpg`;
}

async function storeVideo(db, ownerId, buf, meta, poster) {
  const id = V.newId();
  const chunks = Math.ceil(buf.length / V.CHUNK);
  await db.run(
    'INSERT INTO videos (id, owner_id, mime, size, duration, width, height, poster, chunks, complete, created_at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    id, ownerId, 'video/mp4', buf.length, meta.duration, meta.width, meta.height, poster, chunks, Date.now(), JSON.stringify({ methode: 'démo' }),
  );
  for (let i = 0; i < chunks; i++) {
    await db.run('INSERT INTO video_chunks (video_id, idx, data) VALUES (?, ?, ?)', id, i, buf.subarray(i * V.CHUNK, Math.min(buf.length, (i + 1) * V.CHUNK)));
  }
  return id;
}

async function addDemo(ctx, { origin, onlyIfEmpty = false } = {}) {
  const { db } = ctx;
  if (onlyIfEmpty && (await db.get('SELECT 1 FROM posts LIMIT 1'))) return { added: false, reason: 'not-empty' };
  if (await db.get('SELECT 1 FROM users WHERE is_demo = 1 LIMIT 1')) return { added: false, reason: 'already' };
  const manifest = require('../public/demo/manifest.json');
  const byFile = new Map(manifest.map((m) => [m.id, m]));
  const rand = rng(20261122);
  const now = Date.now();
  const hash = await hashPassword(crypto.randomBytes(24).toString('base64url'));

  const ids = new Map();
  for (const [i, u] of USERS.entries()) {
    const { lastInsertRowid } = await db.run(
      `INSERT INTO users (username, email, password_hash, display_name, bio, created_at, is_demo, verified_at, onboarded_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      u.username, `${u.username}@demo.vibz.invalid`, hash, u.name, `${u.bio} · ${DEMO_BIO}`, now - (40 - i) * 86400e3, i < 3 ? now : null, now,
    );
    ids.set(u.username, lastInsertRowid);
  }

  // Abonnements entre comptes de démonstration
  const names = [...ids.keys()];
  for (const a of names) {
    for (const b of names) {
      if (a !== b && rand() < 0.45) await db.run('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', ids.get(a), ids.get(b), now - Math.floor(rand() * 20 * 86400e3));
    }
  }

  // Vidéos (les plus anciennes d'abord : les sons d'origine existent avant d'être réutilisés)
  const postIds = new Map();
  const soundIds = new Map();
  for (const [i, p] of POSTS.entries()) {
    const m = byFile.get(p.file);
    if (!m) continue;
    const owner = ids.get(p.author);
    const poster = await storeImage(db, await readAsset(m.poster, origin));
    const videoId = await storeVideo(db, owner, await readAsset(m.file, origin), m, poster);
    const created = now - (POSTS.length - i) * 5 * 3600e3 - Math.floor(rand() * 3600e3);
    const { lastInsertRowid: postId } = await db.run(
      `INSERT INTO posts (user_id, body, image, video_id, created_at, category, privacy, guest_views, share_count) VALUES (?, ?, ?, ?, ?, ?, 'public', ?, ?)`,
      owner, p.body, poster, videoId, created, p.category, 80 + Math.floor(rand() * 2400), Math.floor(rand() * 40),
    );
    for (const tag of extractTags(p.body)) await db.run('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)', postId, tag);
    let soundId = p.sound ? soundIds.get(p.sound) : null;
    if (!soundId) {
      const author = USERS.find((u) => u.username === p.author);
      const { lastInsertRowid } = await db.run(
        'INSERT INTO sounds (title, author_id, post_id, video_id, duration, cover, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        p.title || `Son original - ${author.name}`, owner, postId, videoId, m.duration, poster, created,
      );
      soundId = lastInsertRowid;
      soundIds.set(p.file, soundId);
    }
    await db.run('UPDATE posts SET sound_id = ? WHERE id = ?', soundId, postId);
    postIds.set(p.file, { id: postId, owner, created });
  }

  // J'aime, vues, favoris et commentaires des autres comptes de démonstration
  for (const { id, owner, created } of postIds.values()) {
    for (const name of names) {
      const uid = ids.get(name);
      if (uid === owner) continue;
      const watched = rand() < 0.85;
      if (watched) {
        const ratio = Math.min(1, 0.35 + rand() * 0.8);
        await db.run(
          'INSERT OR IGNORE INTO video_views (post_id, user_id, created_at, plays, watch_ms, ratio, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, uid, created + 3600e3, 1 + Math.floor(rand() * 3), Math.floor(ratio * 10000), ratio, created + 3600e3,
        );
      }
      if (watched && rand() < 0.6) await db.run('INSERT OR IGNORE INTO likes (user_id, post_id, created_at) VALUES (?, ?, ?)', uid, id, created + Math.floor(rand() * 86400e3));
      if (watched && rand() < 0.15) await db.run('INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)', uid, id, created + Math.floor(rand() * 86400e3));
    }
    const n = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const author = ids.get(names[Math.floor(rand() * names.length)]);
      const { lastInsertRowid: cid } = await db.run(
        'INSERT INTO comments (post_id, user_id, body, created_at) VALUES (?, ?, ?, ?)',
        id, author, COMMENTS[Math.floor(rand() * COMMENTS.length)], created + Math.floor(rand() * 2 * 86400e3),
      );
      if (rand() < 0.5) await db.run('INSERT OR IGNORE INTO comment_likes (comment_id, user_id, created_at) VALUES (?, ?, ?)', cid, owner, now);
      if (k === 0 && author !== owner) {
        await db.run('INSERT INTO comments (post_id, user_id, body, created_at, parent_id) VALUES (?, ?, ?, ?, ?)', id, owner, 'Merci beaucoup 🙏', created + 2 * 86400e3, cid);
      }
    }
  }
  return { added: true, users: ids.size, posts: postIds.size };
}

async function removeDemo(ctx) {
  const users = await ctx.db.all('SELECT id FROM users WHERE is_demo = 1');
  for (const u of users) {
    await deleteUploads(ctx, await deleteUser(ctx, u.id));
  }
  return { removed: users.length };
}

module.exports = { addDemo, removeDemo, USERS, POSTS };
