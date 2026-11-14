'use strict';
// Le Journal : actualités, podcasts et vidéos.
const express = require('express');
const { requireMember } = require('../auth');
const { fail, text, intParam } = require('../http');
const { authorOf } = require('../social');
const { KINDS, previewLink, loadFeed, searchPodcasts, DEFAULT_SOURCES, lighter } = require('../journal');

const REFRESH_EVERY = 20 * 60 * 1000; // les flux sont relus au plus toutes les 20 minutes
const PER_SOURCE = 15; // éléments repris à chaque lecture d'un flux
const KEEP_PER_SOURCE = 40; // éléments conservés par source

const ITEM_SELECT = `
  SELECT j.*, s.title AS source_title,
         u.id AS user_id, u.username, u.display_name, u.avatar, u.member_number, u.verified_at
  FROM journal_items j
  LEFT JOIN journal_sources s ON s.id = j.source_id
  LEFT JOIN users u ON u.id = j.author_id`;

async function setting(db, key) {
  return (await db.get('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
}
function putSetting(db, key, value) {
  return db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

// Enregistre les éléments d'un flux en une seule requête (rapide avec une base distante)
async function storeItems(db, source, items) {
  const rows = items
    .filter((i) => i.title && i.url)
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
    .slice(0, PER_SOURCE);
  if (!rows.length) return 0;
  const now = Date.now();
  const cols = '(source_id, kind, title, summary, url, image, audio_url, embed_url, duration, site_name, published_at, created_at)';
  const values = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const params = rows.flatMap((i) => [
    source.id,
    source.kind,
    i.title.slice(0, 200),
    (i.summary || '').slice(0, 400),
    i.url.slice(0, 1000),
    i.image ? i.image.slice(0, 1000) : null,
    i.audioUrl ? i.audioUrl.slice(0, 1000) : null,
    i.embedUrl || null,
    i.duration || null,
    source.title,
    Math.min(i.publishedAt || now, now),
    now,
  ]);
  const { changes } = await db.run(`INSERT OR IGNORE INTO journal_items ${cols} VALUES ${values}`, ...params);
  return changes;
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error('Lecture trop longue.')), ms))]);

async function refreshSource(db, source) {
  try {
    const feed = await withTimeout(loadFeed(source.url), 8000);
    const added = await storeItems(db, source, feed.items);
    await db.run('UPDATE journal_sources SET last_fetched_at = ?, last_error = NULL, image = COALESCE(image, ?) WHERE id = ?', Date.now(), feed.image || null, source.id);
    return added;
  } catch (err) {
    await db.run('UPDATE journal_sources SET last_fetched_at = ?, last_error = ? WHERE id = ?', Date.now(), String(err.message).slice(0, 200), source.id);
    return 0;
  }
}

async function seedSources(db) {
  if (await setting(db, 'journal_seeded')) return;
  const now = Date.now();
  for (const s of DEFAULT_SOURCES) {
    await db.run('INSERT OR IGNORE INTO journal_sources (kind, title, url, created_at) VALUES (?, ?, ?, ?)', s.kind, s.title, s.url, now);
  }
  await putSetting(db, 'journal_seeded', now);
}

// Relit toutes les sources (en parallèle) ; une seule relecture à la fois
async function refreshAll(ctx, { force = false } = {}) {
  const { db } = ctx;
  await seedSources(db);
  const last = Number(await setting(db, 'journal_refreshed_at')) || 0;
  const lock = Number(await setting(db, 'journal_lock')) || 0;
  if (!force && Date.now() - last < REFRESH_EVERY) return { added: 0, skipped: true };
  if (Date.now() - lock < 60000) return { added: 0, skipped: true };
  await putSetting(db, 'journal_lock', Date.now());
  const sources = await db.all('SELECT * FROM journal_sources');
  const results = await Promise.all(sources.map((s) => refreshSource(db, s)));
  // On ne garde que les plus récents de chaque source (les éléments « à la une » restent)
  await db.run(
    `DELETE FROM journal_items WHERE source_id IS NOT NULL AND featured_at IS NULL AND id NOT IN (
       SELECT x.id FROM journal_items x WHERE x.source_id = journal_items.source_id ORDER BY x.published_at DESC LIMIT ?)`,
    KEEP_PER_SOURCE,
  );
  await putSetting(db, 'journal_refreshed_at', Date.now());
  await putSetting(db, 'journal_lock', 0);
  return { added: results.reduce((a, b) => a + b, 0), skipped: false };
}

module.exports = function journalRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  r.use('/journal', requireMember);

  const serialize = (row, viewer) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    url: row.url,
    image: row.image ? lighter(row.image) : null,
    audioUrl: row.audio_url || null,
    embedUrl: row.embed_url || null,
    duration: row.duration || null,
    siteName: row.source_title || row.site_name || '',
    note: row.note || '',
    sharedBy: row.author_id && row.username ? authorOf(ctx, row) : null,
    featured: Boolean(row.featured_at),
    publishedAt: row.published_at,
    canDelete: Boolean(viewer.is_admin) || (row.author_id && row.author_id === viewer.id),
  });

  const load = async (id) => {
    const iid = intParam(id);
    const row = iid && (await db.get(`${ITEM_SELECT} WHERE j.id = ?`, iid));
    if (!row) fail(404, 'Ce contenu est introuvable.');
    return row;
  };

  // Liste : tout, actualités, podcasts ou vidéos
  r.get('/journal', async (req, res) => {
    await seedSources(db);
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
    const before = Number(req.query.before) || null;
    const limit = Math.min(Number(req.query.limit) || 24, 50);
    const rows = await db.all(
      `${ITEM_SELECT} WHERE (? IS NULL OR j.kind = ?) AND (? IS NULL OR j.published_at < ?)
       ORDER BY j.published_at DESC, j.id DESC LIMIT ?`,
      kind, kind, before, before, limit,
    );
    const featured = before
      ? []
      : await db.all(`${ITEM_SELECT} WHERE j.featured_at IS NOT NULL AND (? IS NULL OR j.kind = ?) ORDER BY j.featured_at DESC LIMIT 3`, kind, kind);
    const last = Number(await setting(db, 'journal_refreshed_at')) || 0;
    res.json({
      items: rows.map((x) => serialize(x, req.user)),
      featured: featured.map((x) => serialize(x, req.user)),
      hasMore: rows.length === limit,
      stale: Date.now() - last > REFRESH_EVERY,
    });
  });

  // Relecture des flux, demandée par l'application en arrière-plan quand le Journal est ancien
  r.post('/journal/refresh', async (req, res) => {
    const force = Boolean(req.body?.force) && Boolean(req.user.is_admin);
    res.json(await refreshAll(ctx, { force }));
  });

  // Aperçu d'un lien avant partage
  r.post('/journal/preview', async (req, res) => {
    const url = text(req.body?.url, { field: 'Lien', required: true, max: 1000 });
    try {
      res.json({ preview: await previewLink(url) });
    } catch (err) {
      fail(400, `Aperçu impossible : ${err.message}`);
    }
  });

  // Un membre partage un article, une vidéo ou un podcast
  r.post('/journal', async (req, res) => {
    const url = text(req.body?.url, { field: 'Lien', required: true, max: 1000 });
    const note = text(req.body?.note, { field: 'Votre mot', max: 500 });
    let p;
    try {
      p = await previewLink(url);
    } catch (err) {
      fail(400, `Lien inaccessible : ${err.message}`);
    }
    if (await db.get('SELECT id FROM journal_items WHERE url = ?', p.url)) fail(409, 'Ce contenu figure déjà dans le Journal.');
    const now = Date.now();
    const { lastInsertRowid } = await db.run(
      `INSERT INTO journal_items (kind, title, summary, url, image, audio_url, embed_url, site_name, note, author_id, published_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.kind, p.title, p.summary, p.url, p.image, p.audioUrl, p.embedUrl, p.siteName, note, req.user.id, now, now,
    );
    res.status(201).json({ item: serialize(await load(lastInsertRowid), req.user) });
  });

  r.get('/journal/sources', async (req, res) => {
    if (!req.user.is_admin) fail(403, 'Réservé à la Direction.');
    await seedSources(db);
    const rows = await db.all(
      `SELECT s.*, (SELECT COUNT(*) FROM journal_items j WHERE j.source_id = s.id) AS items
       FROM journal_sources s ORDER BY s.kind, s.title COLLATE NOCASE`,
    );
    res.json({
      sources: rows.map((s) => ({ id: s.id, kind: s.kind, title: s.title, url: s.url, image: s.image, items: s.items, lastFetchedAt: s.last_fetched_at, error: s.last_error })),
    });
  });

  // Recherche d'un podcast par son nom
  r.post('/journal/sources/search', async (req, res) => {
    if (!req.user.is_admin) fail(403, 'Réservé à la Direction.');
    const q = text(req.body?.q, { field: 'Recherche', required: true, max: 80 });
    try {
      res.json({ results: await searchPodcasts(q) });
    } catch (err) {
      fail(502, `Recherche impossible : ${err.message}`);
    }
  });

  // Ajout d'une source : flux RSS, site, chaîne YouTube, podcast
  r.post('/journal/sources', async (req, res) => {
    if (!req.user.is_admin) fail(403, 'Réservé à la Direction.');
    const url = text(req.body?.url, { field: 'Adresse', required: true, max: 1000 });
    let feed;
    try {
      feed = await loadFeed(url);
    } catch (err) {
      fail(400, err.message);
    }
    if (!feed.items.length) fail(400, 'Ce flux ne contient aucun élément pour le moment.');
    if (await db.get('SELECT id FROM journal_sources WHERE url = ?', feed.feedUrl)) fail(409, 'Cette source est déjà suivie.');
    const title = text(req.body?.title, { field: 'Nom', max: 80 }) || feed.title || new URL(feed.feedUrl).hostname;
    const { lastInsertRowid } = await db.run(
      'INSERT INTO journal_sources (kind, title, url, site_url, image, created_at, last_fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      feed.kind, title.slice(0, 80), feed.feedUrl, feed.siteUrl, feed.image, Date.now(), Date.now(),
    );
    const source = await db.get('SELECT * FROM journal_sources WHERE id = ?', lastInsertRowid);
    const added = await storeItems(db, source, feed.items);
    res.status(201).json({ source: { id: source.id, kind: source.kind, title: source.title, url: source.url, items: added, error: null } });
  });

  r.delete('/journal/sources/:id', async (req, res) => {
    if (!req.user.is_admin) fail(403, 'Réservé à la Direction.');
    const id = intParam(req.params.id);
    if (!id || !(await db.get('SELECT id FROM journal_sources WHERE id = ?', id))) fail(404, 'Source introuvable.');
    await db.run('DELETE FROM journal_items WHERE source_id = ?', id);
    await db.run('DELETE FROM journal_sources WHERE id = ?', id);
    res.json({ ok: true });
  });

  r.get('/journal/:id', async (req, res) => {
    res.json({ item: serialize(await load(req.params.id), req.user) });
  });

  // « À la une » : choisi par la Direction
  r.post('/journal/:id/feature', async (req, res) => {
    if (!req.user.is_admin) fail(403, 'Réservé à la Direction.');
    const row = await load(req.params.id);
    const on = req.body?.featured !== false;
    await db.run('UPDATE journal_items SET featured_at = ? WHERE id = ?', on ? Date.now() : null, row.id);
    res.json({ item: serialize(await load(row.id), req.user) });
  });

  r.delete('/journal/:id', async (req, res) => {
    const row = await load(req.params.id);
    if (!req.user.is_admin && row.author_id !== req.user.id) fail(403, 'Vous ne pouvez pas retirer ce contenu.');
    await db.run('DELETE FROM journal_items WHERE id = ?', row.id);
    res.json({ ok: true });
  });

  return r;
};

module.exports.refreshAll = refreshAll;
