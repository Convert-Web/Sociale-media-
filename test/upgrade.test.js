'use strict';
// Reprise d'une base d'AURUM : comptes rendus privés (une seule fois chacun), publications de
// groupes privés cachées, hashtags et sons recensés — y compris pour ce qu'AURUM ajoute ensuite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createClient } = require('@libsql/client');
const { openDatabase } = require('../src/db');

test('reprise d’une base AURUM, à chaque démarrage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibz-aurum-'));
  const url = `file:${path.join(dir, 'aurum.db')}`;
  // Base telle qu'AURUM la laissait (colonnes propres à AURUM comprises)
  const old = createClient({ url });
  await old.executeMultiple(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', avatar TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, member_number INTEGER UNIQUE, paid_at INTEGER, is_bot INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, body TEXT NOT NULL DEFAULT '', image TEXT, created_at INTEGER NOT NULL,
      video_id TEXT, groupe_id INTEGER);
    CREATE TABLE videos (id TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, duration REAL, width INTEGER, height INTEGER,
      poster TEXT, chunks INTEGER NOT NULL, complete INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    INSERT INTO users (username, email, password_hash, display_name, created_at, member_number, paid_at) VALUES ('membre', 'm@x.fr', 'h', 'Membre', 1, 1, 1);
    INSERT INTO users (username, email, password_hash, display_name, created_at, is_bot) VALUES ('robot', 'r@x.fr', 'h', 'Robot', 1, 1);
    INSERT INTO videos (id, owner_id, mime, size, duration, chunks, complete, created_at) VALUES ('${'a'.repeat(32)}', 1, 'video/mp4', 10, 5, 1, 1, 1);
    INSERT INTO posts (user_id, body, created_at, video_id) VALUES (1, 'Ma vidéo #Soirée', 1, '${'a'.repeat(32)}');
    INSERT INTO posts (user_id, body, created_at, groupe_id) VALUES (1, 'Dans le groupe privé', 1, 7);
    INSERT INTO posts (user_id, body, created_at) VALUES (2, 'Annonce automatique', 1);
  `);
  old.close();

  let db = await openDatabase({ url });
  let u = await db.get("SELECT private_account, legacy_checked FROM users WHERE username = 'membre'");
  assert.equal(u.private_account, 1);
  assert.equal((await db.get('SELECT privacy FROM posts WHERE groupe_id = 7')).privacy, 'private');
  assert.equal((await db.get("SELECT privacy FROM posts WHERE body = 'Annonce automatique'")).privacy, 'private');
  assert.equal((await db.get("SELECT tag FROM post_tags WHERE post_id = 1")).tag, 'soirée');
  const s = await db.get('SELECT s.title FROM posts p JOIN sounds s ON s.id = p.sound_id WHERE p.id = 1');
  assert.match(s.title, /son original - Membre/);
  // Le membre repasse en public dans Vibz ; un nouveau compte Vibz ; AURUM accueille encore un membre
  await db.run("UPDATE users SET private_account = 0 WHERE username = 'membre'");
  await db.run("INSERT INTO users (username, email, password_hash, display_name, created_at) VALUES ('nouveau', 'n@x.fr', 'h', 'Nouveau', 2)");
  await db.run("INSERT INTO users (username, email, password_hash, display_name, created_at, member_number, paid_at) VALUES ('tardif', 't@x.fr', 'h', 'Tardif', 3, 2, 3)");
  await db.run("INSERT INTO posts (user_id, body, created_at) VALUES (1, 'Plus tard #Été', 4)");
  db.close();

  db = await openDatabase({ url });
  assert.equal((await db.get("SELECT private_account FROM users WHERE username = 'membre'")).private_account, 0); // son choix est respecté
  assert.equal((await db.get("SELECT private_account FROM users WHERE username = 'nouveau'")).private_account, 0); // compte Vibz : public
  assert.equal((await db.get("SELECT private_account FROM users WHERE username = 'tardif'")).private_account, 1); // arrivé après : privé
  assert.ok(await db.get("SELECT 1 FROM post_tags WHERE tag = 'été'"));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
