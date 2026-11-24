'use strict';
// L'Actu : l'actualité des médias (articles, podcasts, vidéos), lue dans leurs flux publics, et
// les vidéos des membres qui y réagissent (« Réagir en vidéo »). Lecture ouverte à tous ;
// l'administration choisit les sources et ce qui est « À la une ».
const express = require('express');
const { requireAdmin } = require('../auth');
const { fail, text, intParam } = require('../http');
const { POST_SELECT, serializePost, VISIBLE } = require('../social');
const { KINDS, TOPICS, TOPIC_IDS, loadFeed, searchPodcasts, DEFAULT_SOURCES, legacyTopic, lighter } = require('../journal');

const REFRESH_EVERY = 20 * 60 * 1000; // les flux sont relus au plus toutes les 20 minutes
const PER_SOURCE = 15; // éléments repris à chaque lecture d'un flux
const KEEP_PER_SOURCE = 40; // éléments conservés par source
const FEATURED_FOR = 3 * 86400e3; // une actualité reste « À la une » trois jours

const ITEM_SELECT = `
  SELECT j.*, COALESCE(j.topic, s.topic) AS item_topic, s.title AS source_title,
         (SELECT COUNT(*) FROM posts rp JOIN users ru ON ru.id = rp.user_id
          WHERE rp.journal_id = j.id AND rp.privacy = 'public' AND ru.private_account = 0 AND ru.banned_at IS NULL) AS reactions
  FROM journal_items j
  LEFT JOIN journal_sources s ON s.id = j.source_id`;

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
  const cols = '(source_id, kind, topic, title, summary, url, image, audio_url, embed_url, duration, site_name, published_at, created_at)';
  const values = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const params = rows.flatMap((i) => [
    source.id,
    source.kind,
    source.topic || null,
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

// Premier lancement : les sources de l'Actu ; une base reprise d'AURUM garde ses sources du
// Journal (rangées dans les rubriques)
// Sources de langue anglaise du Journal d'AURUM (art de vivre, enchères) : retirées une fois de
// l'Actu, qui est en français (l'administration peut les remettre)
const ENGLISH_LEGACY = [/robbreport\.com/, /wallpaper\.com/, /dezeen\.com/, /UCelkSnSbxvIfjjD01uPHHbg|UCSbY5GF1eSKtT6d32qC7Krw|UCad9XfyHa3dikbSSLyOiguQ|UC0k238zFx-Z8xFH0sxCrPJg/];

// Vérifié une fois par base ouverte (pas à chaque requête)
const seedChecked = new WeakSet();
async function seedSources(db) {
  if (seedChecked.has(db)) return;
  if (!(await setting(db, 'actu_seeded'))) {
    const now = Date.now();
    for (const s of DEFAULT_SOURCES) {
      await db.run('INSERT OR IGNORE INTO journal_sources (kind, title, url, topic, created_at) VALUES (?, ?, ?, ?, ?)', s.kind, s.title, s.url, s.topic, now);
    }
    for (const s of await db.all('SELECT id, url FROM journal_sources WHERE topic IS NULL')) {
      const topic = legacyTopic(s.url);
      if (topic) await db.run('UPDATE journal_sources SET topic = ? WHERE id = ?', topic, s.id);
    }
    await putSetting(db, 'actu_seeded', now);
  }
  if (!(await setting(db, 'actu_english_removed'))) {
    for (const s of await db.all('SELECT id, url FROM journal_sources')) {
      if (!ENGLISH_LEGACY.some((re) => re.test(s.url))) continue;
      // Les éléments auxquels des vidéos réagissent restent (leur lien ne casse pas)
      await db.run('DELETE FROM journal_items WHERE source_id = ? AND id NOT IN (SELECT journal_id FROM posts WHERE journal_id IS NOT NULL)', s.id);
      await db.run('UPDATE journal_items SET source_id = NULL WHERE source_id = ?', s.id);
      await db.run('DELETE FROM journal_sources WHERE id = ?', s.id);
    }
    await putSetting(db, 'actu_english_removed', Date.now());
  }
  seedChecked.add(db);
}

// Relit toutes les sources (en parallèle) ; une seule relecture à la fois
async function refreshAll(ctx, { force = false } = {}) {
  const { db } = ctx;
  await seedSources(db);
  const last = Number(await setting(db, 'actu_refreshed_at')) || 0;
  const lock = Number(await setting(db, 'actu_lock')) || 0;
  if (!force && Date.now() - last < REFRESH_EVERY) return { added: 0, skipped: true };
  if (Date.now() - lock < 60000) return { added: 0, skipped: true };
  await putSetting(db, 'actu_lock', Date.now());
  try {
    const sources = await db.all('SELECT * FROM journal_sources');
    const results = await Promise.all(sources.map((s) => refreshSource(db, s)));
    // On ne garde que les plus récents de chaque source (« À la une » et ceux qui ont des réactions restent)
    await db.run(
      `DELETE FROM journal_items WHERE source_id IS NOT NULL AND featured_at IS NULL
         AND id NOT IN (SELECT journal_id FROM posts WHERE journal_id IS NOT NULL) AND id NOT IN (
         SELECT x.id FROM journal_items x WHERE x.source_id = journal_items.source_id ORDER BY x.published_at DESC LIMIT ?)`,
      KEEP_PER_SOURCE,
    );
    await putSetting(db, 'actu_refreshed_at', Date.now());
    return { added: results.reduce((a, b) => a + b, 0), skipped: false };
  } finally {
    await putSetting(db, 'actu_lock', 0);
  }
}

module.exports = function actuRoutes(ctx) {
  const r = express.Router();
  const { db } = ctx;
  const vid = (req) => req.user?.id || 0;

  const serialize = (row, viewer) => ({
    id: row.id,
    kind: row.kind,
    topic: row.item_topic || null,
    title: row.title,
    summary: row.summary,
    url: row.url,
    image: row.image ? lighter(row.image) : null,
    audioUrl: row.audio_url || null,
    embedUrl: row.embed_url || null,
    duration: row.duration || null,
    siteName: row.source_title || row.site_name || '',
    note: row.note || '',
    featured: Boolean(row.featured_at && row.featured_at > Date.now() - FEATURED_FOR),
    publishedAt: row.published_at,
    reactions: row.reactions || 0,
    canManage: Boolean(viewer?.is_admin),
  });

  const load = async (id) => {
    const iid = intParam(id);
    const row = iid && (await db.get(`${ITEM_SELECT} WHERE j.id = ?`, iid));
    if (!row) fail(404, 'Cette actualité n’est plus disponible.');
    return row;
  };

  const stale = async () => Date.now() - (Number(await setting(db, 'actu_refreshed_at')) || 0) > REFRESH_EVERY;

  // Une : à la une, le brief (derniers titres), à écouter, à regarder, les plus commentées en vidéo
  r.get('/actu/une', async (req, res) => {
    await seedSources(db);
    const list = (where, order, limit, ...args) => db.all(`${ITEM_SELECT} WHERE ${where} ORDER BY ${order} LIMIT ?`, ...args, limit);
    // « À la une » : choisie par l'administration, pendant 3 jours
    const featured = await list('j.featured_at > ?', 'j.featured_at DESC', 3, Date.now() - FEATURED_FOR);
    const lead = featured.length ? featured : await list("j.kind = 'article' AND j.image IS NOT NULL", 'j.published_at DESC', 1);
    const leadIds = lead.map((x) => x.id);
    const brief = await list(`j.kind = 'article'${leadIds.length ? ` AND j.id NOT IN (${leadIds.join(',')})` : ''}`, 'j.published_at DESC', 6);
    const podcasts = await list("j.kind = 'podcast'", 'j.published_at DESC', 8);
    const videos = await list("j.kind = 'video'", 'j.published_at DESC', 8);
    const reacted = await db.all(`SELECT * FROM (${ITEM_SELECT}) WHERE reactions > 0 ORDER BY reactions DESC, published_at DESC LIMIT 6`);
    const s = (rows) => rows.map((x) => serialize(x, req.user));
    res.json({
      lead: s(lead),
      brief: s(brief),
      podcasts: s(podcasts),
      videos: s(videos),
      reacted: s(reacted),
      topics: TOPICS.map(([id, label]) => ({ id, label })),
      stale: await stale(),
      refreshedAt: Number(await setting(db, 'actu_refreshed_at')) || null,
    });
  });

  // Liste : par rubrique ou par format (articles, podcasts, vidéos), page après page
  r.get('/actu', async (req, res) => {
    await seedSources(db);
    const kind = KINDS.includes(req.query.kind) ? req.query.kind : null;
    const topic = TOPIC_IDS.has(req.query.topic) ? req.query.topic : null;
    const before = Number(req.query.before) || null;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const rows = await db.all(
      `${ITEM_SELECT} WHERE (? IS NULL OR j.kind = ?) AND (? IS NULL OR COALESCE(j.topic, s.topic) = ?) AND (? IS NULL OR j.published_at < ?)
       ORDER BY j.published_at DESC, j.id DESC LIMIT ?`,
      kind, kind, topic, topic, before, before, limit,
    );
    res.json({ items: rows.map((x) => serialize(x, req.user)), hasMore: rows.length === limit, stale: await stale() });
  });

  // Relecture des flux, demandée en arrière-plan par l'application quand l'Actu date un peu
  r.post('/actu/refresh', async (req, res) => {
    const force = Boolean(req.body?.force) && Boolean(req.user?.is_admin);
    res.json(await refreshAll(ctx, { force }));
  });

  // Sources (administration)
  r.get('/actu/sources', requireAdmin, async (_req, res) => {
    await seedSources(db);
    const rows = await db.all(
      `SELECT s.*, (SELECT COUNT(*) FROM journal_items j WHERE j.source_id = s.id) AS items
       FROM journal_sources s ORDER BY s.kind, s.title COLLATE NOCASE`,
    );
    res.json({
      sources: rows.map((s) => ({ id: s.id, kind: s.kind, topic: s.topic || null, title: s.title, url: s.url, image: s.image, items: s.items, lastFetchedAt: s.last_fetched_at, error: s.last_error })),
      topics: TOPICS.map(([id, label]) => ({ id, label })),
      refreshedAt: Number(await setting(db, 'actu_refreshed_at')) || null,
    });
  });

  // Recherche d'un podcast par son nom (annuaire Apple Podcasts)
  r.post('/actu/sources/search', requireAdmin, async (req, res) => {
    const q = text(req.body?.q, { field: 'Recherche', required: true, max: 80 });
    try {
      res.json({ results: await searchPodcasts(q) });
    } catch (err) {
      fail(502, `Recherche impossible : ${err.message}`);
    }
  });

  // Ajout d'une source : flux RSS, site d'un média, chaîne YouTube, podcast
  r.post('/actu/sources', requireAdmin, async (req, res) => {
    const url = text(req.body?.url, { field: 'Adresse', required: true, max: 1000 });
    const topic = TOPIC_IDS.has(req.body?.topic) ? req.body.topic : null;
    let feed;
    try {
      feed = await withTimeout(loadFeed(url), 12000);
    } catch (err) {
      fail(400, err.message);
    }
    if (!feed.items.length) fail(400, 'Ce flux ne contient aucun élément pour le moment.');
    if (await db.get('SELECT id FROM journal_sources WHERE url = ?', feed.feedUrl)) fail(409, 'Cette source est déjà suivie.');
    const title = text(req.body?.title, { field: 'Nom', max: 80 }) || feed.title || new URL(feed.feedUrl).hostname;
    const { lastInsertRowid } = await db.run(
      'INSERT INTO journal_sources (kind, topic, title, url, site_url, image, created_at, last_fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      feed.kind, topic, title.slice(0, 80), feed.feedUrl, feed.siteUrl, feed.image, Date.now(), Date.now(),
    );
    const source = await db.get('SELECT * FROM journal_sources WHERE id = ?', lastInsertRowid);
    const added = await storeItems(db, source, feed.items);
    res.status(201).json({ source: { id: source.id, kind: source.kind, topic: source.topic, title: source.title, url: source.url, items: added, error: null } });
  });

  // Rubrique ou nom d'une source
  r.patch('/actu/sources/:id', requireAdmin, async (req, res) => {
    const id = intParam(req.params.id);
    const s = id && (await db.get('SELECT * FROM journal_sources WHERE id = ?', id));
    if (!s) fail(404, 'Source introuvable.');
    const topic = req.body?.topic === null || req.body?.topic === '' ? null : TOPIC_IDS.has(req.body?.topic) ? req.body.topic : s.topic;
    const title = req.body?.title !== undefined ? text(req.body.title, { field: 'Nom', required: true, max: 80 }) : s.title;
    await db.run('UPDATE journal_sources SET topic = ?, title = ? WHERE id = ?', topic, title, id);
    await db.run('UPDATE journal_items SET topic = ?, site_name = ? WHERE source_id = ?', topic, title, id);
    res.json({ ok: true });
  });

  r.delete('/actu/sources/:id', requireAdmin, async (req, res) => {
    const id = intParam(req.params.id);
    if (!id || !(await db.get('SELECT id FROM journal_sources WHERE id = ?', id))) fail(404, 'Source introuvable.');
    // Les éléments auxquels des vidéos répondent restent (leur lien ne casse pas)
    await db.run('DELETE FROM journal_items WHERE source_id = ? AND id NOT IN (SELECT journal_id FROM posts WHERE journal_id IS NOT NULL)', id);
    await db.run('UPDATE journal_items SET source_id = NULL WHERE source_id = ?', id);
    await db.run('DELETE FROM journal_sources WHERE id = ?', id);
    res.json({ ok: true });
  });

  // Une actualité et les vidéos qui y réagissent
  r.get('/actu/:id', async (req, res) => {
    const row = await load(req.params.id);
    const posts = await db.all(
      `SELECT * FROM (${POST_SELECT} WHERE p.journal_id = ? AND ${VISIBLE}) ORDER BY like_count DESC, id DESC LIMIT 24`,
      vid(req), row.id,
    );
    res.json({ item: serialize(row, req.user), reactions: posts.map((p) => serializePost(ctx, p, req.user)) });
  });

  // « À la une » : choisi par l'administration
  r.post('/actu/:id/feature', requireAdmin, async (req, res) => {
    const row = await load(req.params.id);
    const on = req.body?.featured !== false;
    await db.run('UPDATE journal_items SET featured_at = ? WHERE id = ?', on ? Date.now() : null, row.id);
    res.json({ item: serialize(await load(row.id), req.user) });
  });

  r.delete('/actu/:id', requireAdmin, async (req, res) => {
    const row = await load(req.params.id);
    await db.run('UPDATE posts SET journal_id = NULL WHERE journal_id = ?', row.id);
    await db.run('DELETE FROM journal_items WHERE id = ?', row.id);
    res.json({ ok: true });
  });

  return r;
};

module.exports.refreshAll = refreshAll;
