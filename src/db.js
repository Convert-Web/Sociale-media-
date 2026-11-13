'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  bio            TEXT NOT NULL DEFAULT '',
  city           TEXT NOT NULL DEFAULT '',
  profession     TEXT NOT NULL DEFAULT '',
  website        TEXT NOT NULL DEFAULT '',
  avatar         TEXT,
  cover          TEXT,
  member_number  INTEGER UNIQUE,
  paid_at        INTEGER,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

-- Registre des numéros de membre : AUTOINCREMENT garantit qu'un numéro
-- n'est jamais réattribué, même après la suppression d'un compte.
CREATE TABLE IF NOT EXISTS member_numbers (
  number      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  created_at  INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL DEFAULT '',
  image       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id, id);

CREATE TABLE IF NOT EXISTS likes (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);

CREATE TABLE IF NOT EXISTS comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  read_at       INTEGER
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

-- Photos envoyées par les membres, stockées dans la base
-- (les hébergeurs gratuits effacent leurs fichiers à chaque redémarrage).
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
  return db;
}

module.exports = { openDatabase };
