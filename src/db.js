'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Schéma de Vibz. Les tables gardent les noms de l'ancienne application (AURUM) : une base
// existante est reprise telle quelle et complétée (colonnes ajoutées, migration ci-dessous).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash       TEXT NOT NULL,
  display_name        TEXT NOT NULL,
  bio                 TEXT NOT NULL DEFAULT '',
  website             TEXT NOT NULL DEFAULT '',
  avatar              TEXT,
  is_admin            INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  verified_at         INTEGER,
  is_bot              INTEGER NOT NULL DEFAULT 0,
  login_failures      INTEGER NOT NULL DEFAULT 0,
  login_locked_until  INTEGER,
  lang                TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

-- Paiements (achats de pièces) : la référence du prestataire est unique (pas de double crédit)
CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  provider      TEXT NOT NULL,
  provider_ref  TEXT NOT NULL UNIQUE,
  amount_cents  INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  status        TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Publications : vidéo (video_id), photos (image + post_media) ou texte
CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL DEFAULT '',
  image       TEXT,
  created_at  INTEGER NOT NULL,
  edited_at   INTEGER,
  flagged     TEXT,
  video_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, id);

CREATE TABLE IF NOT EXISTS post_media (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id   INTEGER NOT NULL,
  url       TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_post_media_post ON post_media(post_id, position);

CREATE TABLE IF NOT EXISTS likes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  reaction    TEXT NOT NULL DEFAULT 'love',
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);

-- Favoris
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id     INTEGER NOT NULL,
  post_id     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_post ON bookmarks(post_id);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  flagged     TEXT,
  parent_id   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id, created_at);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id  INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_comment_likes_user ON comment_likes(user_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

-- Comptes privés : demandes d'abonnement en attente
CREATE TABLE IF NOT EXISTS follow_requests (
  requester_id  INTEGER NOT NULL,
  target_id     INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (requester_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_follow_requests_target ON follow_requests(target_id, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  read_at       INTEGER,
  flagged       TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, recipient_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id, read_at);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  post_id     INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  read_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);

CREATE TABLE IF NOT EXISTS stories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  media       TEXT NOT NULL,
  caption     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  video_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_stories_expiry ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_user ON stories(user_id, id);

CREATE TABLE IF NOT EXISTS story_views (
  story_id   INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  viewed_at  INTEGER NOT NULL,
  PRIMARY KEY (story_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id  INTEGER NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    INTEGER NOT NULL,
  reason       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_open ON reports(resolved_at, id);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id  INTEGER NOT NULL,
  blocked_id  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

-- Vidéos, stockées en morceaux de 1 Mo (hébergement gratuit : Vercel + Turso)
CREATE TABLE IF NOT EXISTS videos (
  id          TEXT PRIMARY KEY,
  owner_id    INTEGER NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  duration    REAL,
  width       INTEGER,
  height      INTEGER,
  poster      TEXT,
  chunks      INTEGER NOT NULL,
  complete    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  meta        TEXT
);
CREATE INDEX IF NOT EXISTS idx_videos_owner ON videos(owner_id, created_at);
CREATE TABLE IF NOT EXISTS video_chunks (
  video_id  TEXT NOT NULL,
  idx       INTEGER NOT NULL,
  data      BLOB NOT NULL,
  PRIMARY KEY (video_id, idx)
);

-- Vues : une ligne par spectateur connecté (lectures, temps regardé, part de la vidéo vue)
CREATE TABLE IF NOT EXISTS video_views (
  post_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_video_views_user ON video_views(user_id);

-- Lectures par jour et par vidéo (statistiques des créateurs)
CREATE TABLE IF NOT EXISTS view_days (
  post_id   INTEGER NOT NULL,
  day       TEXT NOT NULL,
  plays     INTEGER NOT NULL DEFAULT 0,
  watch_ms  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, day)
);

-- Sons : le son original d'une vidéo, réutilisable par tous (« Utiliser ce son »)
CREATE TABLE IF NOT EXISTS sounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  author_id   INTEGER NOT NULL,
  post_id     INTEGER,
  video_id    TEXT,
  duration    REAL,
  cover       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sounds_post ON sounds(post_id);
CREATE INDEX IF NOT EXISTS idx_sounds_author ON sounds(author_id);

CREATE TABLE IF NOT EXISTS sound_favorites (
  user_id     INTEGER NOT NULL,
  sound_id    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, sound_id)
);

-- #hashtags des descriptions (recherche, pages des hashtags, tendances, algorithme)
CREATE TABLE IF NOT EXISTS post_tags (
  post_id  INTEGER NOT NULL,
  tag      TEXT NOT NULL COLLATE NOCASE,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag, post_id);

CREATE TABLE IF NOT EXISTS reposts (
  user_id     INTEGER NOT NULL,
  post_id     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_reposts_post ON reposts(post_id);
CREATE INDEX IF NOT EXISTS idx_reposts_time ON reposts(user_id, created_at);

-- « Pas intéressé » (post_id) et créateurs masqués (post_id = 0)
CREATE TABLE IF NOT EXISTS not_interested (
  user_id     INTEGER NOT NULL,
  post_id     INTEGER NOT NULL,
  author_id   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id, author_id)
);

-- Centres d'intérêt appris par l'algorithme « Pour toi » (hashtags, créateurs, sons, catégories)
CREATE TABLE IF NOT EXISTS interests (
  user_id     INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  key         TEXT NOT NULL,
  score       REAL NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, key)
);

-- LIVE
CREATE TABLE IF NOT EXISTS lives (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,
  last_beat      INTEGER NOT NULL,
  peak_viewers   INTEGER NOT NULL DEFAULT 0,
  viewers_total  INTEGER NOT NULL DEFAULT 0,
  likes          INTEGER NOT NULL DEFAULT 0,
  diamonds       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lives_user ON lives(user_id, ended_at);
CREATE INDEX IF NOT EXISTS idx_lives_open ON lives(ended_at, started_at);

CREATE TABLE IF NOT EXISTS live_viewers (
  live_id    INTEGER NOT NULL,
  peer       TEXT NOT NULL,
  user_id    INTEGER,
  joined_at  INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  PRIMARY KEY (live_id, peer)
);

-- Signalisation WebRTC par simple requête (fonctionne aussi sur Vercel, sans connexion permanente)
CREATE TABLE IF NOT EXISTS live_signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  live_id     INTEGER NOT NULL,
  peer        TEXT NOT NULL,
  kind        TEXT NOT NULL,
  sdp         TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  taken_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_live_signals ON live_signals(live_id, kind, taken_at);

-- Fil du LIVE : commentaires, arrivées, cœurs, cadeaux, abonnements
CREATE TABLE IF NOT EXISTS live_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  live_id     INTEGER NOT NULL,
  user_id     INTEGER,
  type        TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  gift        TEXT,
  count       INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_live_events ON live_events(live_id, id);

-- Portefeuille : pièces achetées et dépensées, diamants reçus
CREATE TABLE IF NOT EXISTS wallet_tx (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  kind        TEXT NOT NULL,
  coins       INTEGER NOT NULL DEFAULT 0,
  diamonds    INTEGER NOT NULL DEFAULT 0,
  other_id    INTEGER,
  live_id     INTEGER,
  post_id     INTEGER,
  gift        TEXT,
  ref         TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_tx(user_id, id);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- Erreurs survenues dans les navigateurs (anonymes) : suivi par l'administration
CREATE TABLE IF NOT EXISTS client_errors (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  at       INTEGER NOT NULL,
  message  TEXT NOT NULL,
  stack    TEXT NOT NULL DEFAULT '',
  path     TEXT NOT NULL DEFAULT '',
  device   TEXT NOT NULL DEFAULT '',
  version  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_client_errors_at ON client_errors(at);

-- Mesure d'audience : totaux anonymes par jour (aucun identifiant)
CREATE TABLE IF NOT EXISTS analytics_daily (
  day   TEXT NOT NULL,
  kind  TEXT NOT NULL,
  key   TEXT NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, key)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- Traductions déjà faites (un texte n'est traduit qu'une fois)
CREATE TABLE IF NOT EXISTS translations (
  key         TEXT PRIMARY KEY,
  lang        TEXT NOT NULL,
  source      TEXT,
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- Photos envoyées (stockées dans la base : les hébergeurs gratuits effacent leurs fichiers)
CREATE TABLE IF NOT EXISTS media (
  id          TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  data        BLOB NOT NULL,
  size        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
`;

// Accès à la base : fichier SQLite local en développement, Turso (libSQL) en ligne.
// Toutes les fonctions renvoient des promesses.
function wrap(executor) {
  const args = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  return {
    async get(sql, ...params) {
      const r = await executor.execute({ sql, args: args(params) });
      return r.rows[0];
    },
    async all(sql, ...params) {
      const r = await executor.execute({ sql, args: args(params) });
      return r.rows;
    },
    async run(sql, ...params) {
      const r = await executor.execute({ sql, args: args(params) });
      return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid == null ? undefined : Number(r.lastInsertRowid) };
    },
  };
}

// Colonnes de Vibz absentes d'une base plus ancienne : ajoutées seulement si besoin.
const COLUMNS = [
  // Comptes
  ['users', 'private_account', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'show_liked', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'dm_policy', "TEXT NOT NULL DEFAULT 'everyone'"],
  ['users', 'banned_at', 'INTEGER'],
  ['users', 'coins', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'diamonds', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'is_demo', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'notify_prefs', "TEXT NOT NULL DEFAULT '{}'"],
  ['users', 'onboarded_at', 'INTEGER'],
  // Fil « Pour toi » personnalisé (0 : classement sans centres d'intérêt, règlement DSA)
  ['users', 'personalized', 'INTEGER NOT NULL DEFAULT 1'],
  // Publications
  ['posts', 'sound_id', 'INTEGER'],
  ['posts', 'privacy', "TEXT NOT NULL DEFAULT 'public'"],
  ['posts', 'allow_comments', 'INTEGER NOT NULL DEFAULT 1'],
  ['posts', 'allow_duet', 'INTEGER NOT NULL DEFAULT 1'],
  ['posts', 'allow_stitch', 'INTEGER NOT NULL DEFAULT 1'],
  ['posts', 'allow_download', 'INTEGER NOT NULL DEFAULT 1'],
  ['posts', 'category', 'TEXT'],
  ['posts', 'fx', 'TEXT'],
  ['posts', 'bg', 'TEXT'],
  ['posts', 'duet_of', 'INTEGER'],
  ['posts', 'stitch_of', 'INTEGER'],
  ['posts', 'pinned_at', 'INTEGER'],
  ['posts', 'pinned_comment_id', 'INTEGER'],
  ['posts', 'guest_views', 'INTEGER NOT NULL DEFAULT 0'],
  ['posts', 'share_count', 'INTEGER NOT NULL DEFAULT 0'],
  // Vues détaillées
  ['video_views', 'plays', 'INTEGER NOT NULL DEFAULT 1'],
  ['video_views', 'watch_ms', 'INTEGER NOT NULL DEFAULT 0'],
  ['video_views', 'ratio', 'REAL NOT NULL DEFAULT 0'],
  ['video_views', 'updated_at', 'INTEGER'],
  // Messages : vidéo partagée
  ['messages', 'post_id', 'INTEGER'],
  // Notifications : commentaire, LIVE, extrait
  ['notifications', 'comment_id', 'INTEGER'],
  ['notifications', 'live_id', 'INTEGER'],
  ['notifications', 'body', 'TEXT'],
  // Paiements : pièces achetées
  ['payments', 'coins', 'INTEGER NOT NULL DEFAULT 0'],
  // Photos : compte qui les a envoyées (publication en plusieurs fois)
  ['media', 'owner_id', 'INTEGER'],
];

async function migrate(client) {
  // Toutes les colonnes existantes en une seule requête (démarrage rapide sur Vercel)
  const { rows } = await client.execute(
    "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'",
  );
  const have = new Set(rows.map((r) => `${r.t}.${r.c}`));
  for (const [table, column, ddl] of COLUMNS) {
    if (!have.has(`${table}.${column}`)) {
      try {
        await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      } catch (err) {
        // Deux démarrages simultanés (mise en ligne sur Vercel) : la colonne vient d'être ajoutée par l'autre
        if (!/duplicate column/i.test(err.message)) throw err;
      }
      have.add(`${table}.${column}`);
    }
  }
  return have;
}

// Reprise d'une base d'AURUM (réseau privé) : une seule fois.
// AURUM était un cercle privé : ce que ses membres y ont publié ne devient pas public.
// - leurs comptes deviennent privés (contenus visibles de leurs seuls abonnés, réglable ensuite) ;
// - les publications des groupes privés et des comptes automatiques restent visibles de leur seul auteur ;
// - hashtags et sons originaux des vidéos existantes sont recensés.
async function upgradeFromAurum(client, have) {
  const done = await client.execute("SELECT value FROM settings WHERE key = 'vibz:upgraded'");
  if (done.rows.length) return;
  const { rows } = await client.execute('SELECT COUNT(*) AS n FROM users');
  if (rows[0].n > 0 && have.has('users.member_number')) {
    await client.execute('UPDATE users SET private_account = 1');
    if (have.has('posts.groupe_id')) await client.execute("UPDATE posts SET privacy = 'private' WHERE groupe_id IS NOT NULL");
    await client.execute("UPDATE posts SET privacy = 'private' WHERE user_id IN (SELECT id FROM users WHERE is_bot = 1)");
    // Hashtags des publications existantes
    const { extractTags } = require('./tags');
    const posts = await client.execute('SELECT id, body FROM posts');
    for (const p of posts.rows) {
      for (const tag of extractTags(p.body)) {
        await client.execute({ sql: 'INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)', args: [p.id, tag] });
      }
    }
    // Son original de chaque vidéo
    const vids = await client.execute(
      `SELECT p.id, p.user_id, p.video_id, p.image, p.created_at, v.duration, u.display_name
       FROM posts p JOIN videos v ON v.id = p.video_id JOIN users u ON u.id = p.user_id WHERE p.sound_id IS NULL`,
    );
    for (const p of vids.rows) {
      const r = await client.execute({
        sql: 'INSERT INTO sounds (title, author_id, post_id, video_id, duration, cover, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [`son original - ${p.display_name}`, p.user_id, p.id, p.video_id, p.duration, p.image, p.created_at],
      });
      await client.execute({ sql: 'UPDATE posts SET sound_id = ? WHERE id = ?', args: [Number(r.lastInsertRowid), p.id] });
    }
  }
  await client.execute("INSERT OR IGNORE INTO settings (key, value) VALUES ('vibz:upgraded', '1')");
}

async function openDatabase({ url, authToken }) {
  const local = url.startsWith('file:');
  if (local) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  // Base distante : client HTTP pur (aucun module natif) ; fichier local : client complet.
  const { createClient } = local ? require('@libsql/client') : require('@libsql/client/web');
  const client = createClient({ url, authToken: authToken || undefined, intMode: 'number' });
  if (local) {
    await client.execute('PRAGMA journal_mode = WAL');
    await client.execute('PRAGMA busy_timeout = 5000');
  }
  await client.executeMultiple(SCHEMA);
  const have = await migrate(client);
  // Index qui portent sur des colonnes ajoutées par migration : créés après elle
  await client.executeMultiple(`
    CREATE INDEX IF NOT EXISTS idx_posts_video ON posts(id) WHERE video_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_posts_sound ON posts(sound_id, id);
    CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_post ON messages(post_id) WHERE post_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_notifications_comment ON notifications(comment_id) WHERE comment_id IS NOT NULL;
  `);
  await upgradeFromAurum(client, have);

  const db = wrap(client);
  // Transaction : fn reçoit un objet { get, all, run } lié à la transaction.
  db.transaction = async (fn) => {
    const tx = await client.transaction('write');
    try {
      const result = await fn(wrap(tx));
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    } finally {
      tx.close();
    }
  };
  db.close = () => client.close();
  db.remote = !local;
  // Tables héritées d'AURUM présentes dans cette base (nettoyées à la suppression d'un compte)
  db.legacy = new Set([...have].map((x) => x.split('.')[0]));
  return db;
}

module.exports = { openDatabase };
