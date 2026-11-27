'use strict';
// Liens partagés : chaque adresse (vidéo, profil, invitation, Sujet du jour, LIVE, actu, hashtag,
// son) a son propre aperçu dans WhatsApp, iMessage, Snapchat, Instagram, Messenger ou X : titre,
// description et image dessinée pour l'occasion (cards.js). Rien de privé n'y apparaît : seul ce
// qu'une personne sans compte peut voir est décrit (sinon, l'aperçu général d'AURUM).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getPost, USER_SELECT, serializeUser } = require('./social');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');
const KINDS = new Set(['video', 'profil', 'invitation', 'live', 'sujet', 'actu', 'tag', 'son']);

// ── Petits outils ────────────────────────────────────────────────────────────────────────────
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const excerpt = (s, max = 190) => {
  const t = oneLine(s);
  if ([...t].length <= max) return t;
  const cut = [...t].slice(0, max).join('');
  return `${cut.replace(/\s+\S*$/, '').replace(/[\s,.;:!?-]+$/, '')}…`;
};
const fmt1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const fmt0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
function short(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  for (const [step, unit] of [[1e3, 'k'], [1e6, 'M'], [1e9, 'Md']]) {
    const v = n / step;
    const r = v < 100 ? Math.round(v * 10) / 10 : Math.round(v);
    if (r < 1000 || unit === 'Md') return `${(r < 100 ? fmt1 : fmt0).format(r)} ${unit}`;
  }
  return String(n);
}
const plural = (n, one, many) => `${short(n)} ${n > 1 ? many : one}`;
const firstName = (name) => [...oneLine(name).split(' ')[0]].slice(0, 18).join('');
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const dayName = (day) => {
  const s = dayFmt.format(new Date(`${day}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

// Un compte visible sans compte (ni banni ni robot) ; un ancien nom mène au compte qui le portait
async function findUser(ctx, username) {
  const name = String(username || '').replace(/^@/, '');
  if (!/^[a-z0-9._]{1,30}$/i.test(name)) return null;
  let u = await ctx.db.get('SELECT id FROM users WHERE username = ? AND is_bot = 0 AND banned_at IS NULL', name);
  if (!u) {
    const was = await ctx.db.get('SELECT user_id FROM username_history WHERE old_username = ? ORDER BY changed_at DESC LIMIT 1', name);
    if (was) u = await ctx.db.get('SELECT id FROM users WHERE id = ? AND is_bot = 0 AND banned_at IS NULL', was.user_id);
  }
  if (!u) return null;
  return serializeUser(ctx, await ctx.db.get(`${USER_SELECT} WHERE u.id = ?`, 0, u.id), null);
}

// ── Ce que montre chaque lien ────────────────────────────────────────────────────────────────
// { meta: titre, description, texte de l'image ; card: la carte à dessiner ; images: adresses des
//   images de la carte ; page: l'adresse du lien }
async function describe(ctx, kind, key) {
  const { db } = ctx;
  if (kind === 'video') {
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const post = await getPost(ctx, id, null, { admin: false });
    // Introuvable, réservé à certains, ou signalé comme sensible : l'aperçu général
    if (!post || post.flagged?.length) return null;
    const a = post.author;
    const name = oneLine(a.displayName) || a.username;
    const isVideo = post.kind === 'video';
    const caption = oneLine(post.body);
    const subject = post.subject;
    const views = post.viewCount;
    const likes = post.likeCount;
    const stats = views >= 100 || likes >= 10
      ? [views >= 100 ? plural(views, 'vue', 'vues') : null, likes ? `${short(likes)} J’aime` : null].filter(Boolean).join(' · ')
      : null;
    return {
      page: `/@${a.username}/video/${post.id}`,
      meta: {
        title: subject ? `${name} répond au Sujet du jour sur AURUM` : `${isVideo ? 'Vidéo' : 'Publication'} de ${name} sur AURUM`,
        description: subject
          ? `« ${oneLine(subject.title)} »${caption ? ` — ${excerpt(caption, 150)}` : ' — Regarde sa réponse en vidéo.'}`
          : caption ? excerpt(caption) : `Regarde ${isVideo ? 'la vidéo' : 'la publication'} de ${name} sur AURUM.`,
        alt: `${isVideo ? 'Vidéo' : 'Publication'} de ${name} sur AURUM${caption ? ` : ${excerpt(caption, 100)}` : ''}`,
      },
      card: {
        layout: 'post',
        video: isVideo,
        author: { name, username: a.username },
        label: subject ? `Sujet du jour · « ${oneLine(subject.title)} »` : null,
        caption: post.kind === 'text' ? null : caption,
        textPost: post.kind === 'text' ? { bg: post.bg || 'violet', text: post.body } : null,
        stats,
        cta: isVideo ? 'Regarder sur AURUM' : 'Voir sur AURUM',
      },
      images: { media: post.video?.poster || post.images?.[0] || null, avatar: a.avatar },
    };
  }

  if (kind === 'profil' || kind === 'invitation' || kind === 'live') {
    const u = await findUser(ctx, key);
    if (!u) return null;
    const name = oneLine(u.displayName) || u.username;
    const author = { name, username: u.username };
    const images = { media: null, avatar: u.avatar };
    if (kind === 'invitation') {
      return {
        page: `/rejoindre?par=${encodeURIComponent(u.username)}`,
        meta: {
          title: `${name} t’invite sur AURUM`,
          description: `Rejoins ${name} sur AURUM : les vidéos courtes de tes amis et l’actu du jour en vidéo. C’est gratuit.`,
          alt: `${name} t’invite sur AURUM`,
        },
        card: { layout: 'person', author, title: `${name} t’invite sur AURUM`, subtitle: 'Les vidéos courtes de tes amis et l’actu du jour en vidéo.', cta: `Rejoindre ${firstName(name) || u.username}`, ctaIcon: 'plus' },
        images,
      };
    }
    const live = kind === 'live' && u.live ? await db.get('SELECT id, title FROM lives WHERE id = ?', u.live) : null;
    if (live) {
      return {
        page: `/live/${u.username}`,
        meta: {
          title: `${name} est en LIVE sur AURUM`,
          description: oneLine(live.title) ? `${excerpt(live.title, 120)} — Rejoins le LIVE de ${name} sur AURUM.` : `Rejoins le LIVE de ${name} sur AURUM.`,
          alt: `${name} est en LIVE sur AURUM`,
        },
        card: { layout: 'person', live: true, author, title: `${name} est en LIVE`, subtitle: oneLine(live.title) || `@${u.username}`, cta: 'Rejoindre le LIVE', ctaIcon: 'play' },
        images,
      };
    }
    const c = u.counts || { followers: 0, posts: 0 };
    const counts = `${plural(c.followers, 'abonné', 'abonnés')} · ${plural(c.posts, 'publication', 'publications')}`;
    return {
      page: kind === 'live' ? `/live/${u.username}` : `/@${u.username}`,
      meta: {
        title: `${name} (@${u.username}) sur AURUM`,
        description: u.bio ? excerpt(u.bio) : `${counts}. Regarde les vidéos de ${name} sur AURUM.`,
        alt: `Le profil de ${name} sur AURUM`,
      },
      card: { layout: 'person', author, title: name, subtitle: `@${u.username} · ${counts}`, about: u.bio || null, cta: 'Voir le profil' },
      images,
    };
  }

  if (kind === 'sujet') {
    const now = Date.now();
    const s = key === 'today'
      ? await db.get('SELECT * FROM subjects WHERE opens_at <= ? ORDER BY opens_at DESC LIMIT 1', now)
      : /^\d{1,12}$/.test(String(key)) ? await db.get('SELECT * FROM subjects WHERE id = ? AND opens_at <= ?', Number(key), now) : null;
    if (!s) return null;
    const { n } = await db.get('SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id WHERE p.subject_id = ? AND u.banned_at IS NULL', s.id);
    const open = now < s.closes_at;
    const answers = n ? `${plural(n, 'réponse', 'réponses')} en vidéo` : null;
    return {
      page: `/sujet/${s.id}`,
      meta: {
        title: `Le Sujet du jour : ${oneLine(s.title)}`,
        description: open
          ? `${answers ? `${answers}. ` : ''}Réponds toi aussi sur AURUM avant demain 19 h.`
          : `${answers ? `${answers} sur AURUM. ` : ''}Un nouveau sujet chaque jour à 19 h.`,
        alt: `Le Sujet du jour sur AURUM : ${oneLine(s.title)}`,
      },
      card: {
        layout: 'subject',
        label: 'LE SUJET DU JOUR',
        date: dayName(s.day),
        title: s.title,
        sponsor: s.sponsor ? `Proposé par ${s.sponsor}${s.prize ? ` · À gagner : ${s.prize}` : ''}` : null,
        stats: answers || (open ? 'Sois le premier à répondre' : null),
        cta: open ? 'Réponds en vidéo' : 'Voir les réponses',
        ctaIcon: open ? 'plus' : 'play',
      },
      images: { media: null, avatar: null },
    };
  }

  if (kind === 'actu') {
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const it = await db.get('SELECT id, title, site_name FROM journal_items WHERE id = ?', id);
    if (!it) return null;
    const site = oneLine(it.site_name);
    return {
      page: `/actu/${it.id}`,
      meta: { title: oneLine(it.title), description: `${site ? `${site} · ` : ''}L’actu du jour en vidéo sur AURUM.`, alt: oneLine(it.title) },
      card: { layout: 'text', label: 'L’ACTU', title: it.title, subtitle: `${site ? `${site} · ` : ''}L’actu du jour sur AURUM`, cta: 'Voir sur AURUM' },
      images: { media: null, avatar: null },
    };
  }

  if (kind === 'tag') {
    const wanted = String(key || '').replace(/^#/, '');
    if (!/^[\p{L}\p{N}_]{1,40}$/u.test(wanted)) return null;
    // Seulement un hashtag qui existe (jamais un texte inventé dans l'adresse)
    const row = await db.get(
      `SELECT MIN(t.tag) AS tag, COUNT(*) AS n FROM post_tags t JOIN posts p ON p.id = t.post_id JOIN users u ON u.id = p.user_id
       WHERE t.tag = ? AND p.privacy = 'public' AND u.banned_at IS NULL AND u.is_bot = 0 AND u.private_account = 0`,
      wanted,
    );
    if (!row?.n) return null;
    return {
      page: `/tag/${encodeURIComponent(row.tag)}`,
      meta: { title: `#${row.tag} sur AURUM`, description: `${plural(row.n, 'publication', 'publications')} #${row.tag} à regarder sur AURUM.`, alt: `#${row.tag} sur AURUM` },
      card: { layout: 'text', label: 'HASHTAG', title: `#${row.tag}`, subtitle: `${plural(row.n, 'publication', 'publications')} sur AURUM`, cta: 'Voir les vidéos', ctaIcon: 'play' },
      images: { media: null, avatar: null },
    };
  }

  if (kind === 'son') {
    const id = Number(key);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const s = await db.get('SELECT s.id, s.title, u.display_name, u.username FROM sounds s JOIN users u ON u.id = s.author_id WHERE s.id = ? AND u.banned_at IS NULL AND u.is_bot = 0', id);
    if (!s) return null;
    const { n } = await db.get(
      `SELECT COUNT(*) AS n FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.sound_id = ? AND p.privacy = 'public' AND u.banned_at IS NULL AND u.is_bot = 0 AND u.private_account = 0`,
      s.id,
    );
    const by = oneLine(s.display_name) || s.username;
    return {
      page: `/son/${s.id}`,
      meta: { title: `${oneLine(s.title)} — un son sur AURUM`, description: `Son de ${by} · ${plural(n, 'vidéo', 'vidéos')} avec ce son sur AURUM.`, alt: `${oneLine(s.title)}, son de ${by}` },
      card: { layout: 'text', label: 'SON', title: s.title, subtitle: `Son de ${by} · ${plural(n, 'vidéo', 'vidéos')}`, cta: 'Voir les vidéos', ctaIcon: 'play' },
      images: { media: null, avatar: null },
    };
  }
  return null;
}

// Adresse de l'image (sa version change avec ce qu'elle montre : les messageries la redemandent)
async function preview(ctx, kind, key) {
  if (!KINDS.has(kind)) return null;
  const d = await describe(ctx, kind, key);
  if (!d) return null;
  const version = crypto.createHash('sha1').update(JSON.stringify([d.card, d.images])).digest('hex').slice(0, 10);
  const id = kind === 'sujet' ? d.page.split('/').pop() : key;
  return { ...d, version, image: `/apercu/${kind}/${encodeURIComponent(id)}.jpg?v=${version}` };
}

// Photo enregistrée (base), ou image du site (démo, logo) ; une adresse extérieure n'est pas chargée
async function loadImage(ctx, url) {
  if (typeof url !== 'string' || !url) return null;
  const m = /^\/media\/([a-f0-9]{32})\.(?:jpg|png|gif|webp)$/.exec(url);
  if (m) {
    const hit = ctx.mediaCache?.get(m[1]);
    if (hit) return hit.data;
    const row = await ctx.db.get('SELECT data FROM media WHERE id = ?', m[1]);
    return row ? Buffer.from(row.data) : null;
  }
  if (/^\/(?:demo|img)\/[\w.-]+\.(?:jpe?g|png|webp)$/.test(url)) {
    try {
      return fs.readFileSync(path.join(PUBLIC_DIR, url));
    } catch {
      // Chez l'hébergeur, les fichiers publics sont servis à part : on les demande au site lui-même
      try {
        const res = await fetch(`${ctx.config.baseUrl}${url}`, { signal: AbortSignal.timeout(4000) });
        if (res.ok) return Buffer.from(await res.arrayBuffer());
      } catch {
        /* image indisponible : la carte s'en passe */
      }
    }
  }
  return null;
}

// ── La page, avec les balises de son aperçu ──────────────────────────────────────────────────
const ROUTES = [
  [/^\/@([^/]+)\/video\/(\d+)\/?$/, (m) => ['video', m[2]]],
  [/^\/@([^/]+)\/?$/, (m) => ['profil', m[1]]],
  [/^\/sujet\/?$/, () => ['sujet', 'today']],
  [/^\/sujet\/(\d+)\/?$/, (m) => ['sujet', m[1]]],
  [/^\/live\/([^/]+)\/?$/, (m) => ['live', m[1]]],
  [/^\/actu\/(\d+)\/?$/, (m) => ['actu', m[1]]],
  [/^\/tag\/([^/]+)\/?$/, (m) => ['tag', m[1]]],
  [/^\/son\/(\d+)\/?$/, (m) => ['son', m[1]]],
];
function target(pathname, query = {}) {
  // Lien d'invitation : « /rejoindre?par=camille.roux »
  if (pathname.replace(/\/$/, '') === '/rejoindre' && typeof query.par === 'string' && query.par) return ['invitation', query.par];
  for (const [re, pick] of ROUTES) {
    const m = re.exec(pathname);
    if (!m) continue;
    const [kind, raw] = pick(m);
    const key = decode(raw);
    return key === null ? null : [kind, key];
  }
  return null;
}

let template = null;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function withMeta(html, base, d) {
  const url = `${base}${d.page}`;
  const image = `${base}${d.image}`;
  const set = (attr, name, value) => {
    html = html.replace(new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(">)`), (_all, a, b) => `${a}${esc(value)}${b}`);
  };
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(d.meta.title)}</title>`);
  set('name', 'description', d.meta.description);
  set('property', 'og:url', url);
  set('property', 'og:title', d.meta.title);
  set('property', 'og:description', d.meta.description);
  set('property', 'og:image', image);
  set('property', 'og:image:alt', d.meta.alt);
  set('name', 'twitter:title', d.meta.title);
  set('name', 'twitter:description', d.meta.description);
  set('name', 'twitter:image', image);
  return html;
}

// La page de l'application pour cette adresse, avec son aperçu (null : la page telle quelle)
async function sharedPage(ctx, pathname, query) {
  const t = target(pathname, query);
  if (!t) return null;
  const d = await preview(ctx, t[0], t[1]);
  if (!d) return null;
  const html = ctx.config.isProd ? (template ??= fs.readFileSync(INDEX_HTML, 'utf8')) : fs.readFileSync(INDEX_HTML, 'utf8');
  return withMeta(html, ctx.config.baseUrl, d);
}

// L'image de l'aperçu : /apercu/<genre>/<clé>.jpg?v=<version>
function previewHandler(ctx) {
  const recent = new Map(); // dernières images dessinées par ce serveur
  return async (req, res, next) => {
    const m = /^(.+)\.jpg$/.exec(req.params.file || '');
    const key = m && decode(m[1]);
    if (!KINDS.has(req.params.kind) || !key) return next();
    const d = await preview(ctx, req.params.kind, key);
    if (!d) {
      // Plus rien à montrer (publication retirée, compte privé…) : l'image générale d'AURUM
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.redirect(302, '/img/og.jpg?v=au79');
    }
    // Une seule version dessinée par contenu : toute autre adresse renvoie vers la bonne
    if (req.query.v !== d.version) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.redirect(302, d.image);
    }
    let buf = recent.get(d.image);
    if (!buf) {
      // Le moteur de dessin n'est chargé qu'ici : les autres requêtes démarrent sans lui
      const { renderCard } = require('./cards');
      const [media, avatar] = await Promise.all([loadImage(ctx, d.images.media), loadImage(ctx, d.images.avatar)]);
      buf = await renderCard({ ...d.card, media, avatar });
      recent.set(d.image, buf);
      if (recent.size > 40) recent.delete(recent.keys().next().value);
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', buf.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.end(buf);
  };
}

module.exports = { sharedPage, previewHandler, preview, target, describe };
