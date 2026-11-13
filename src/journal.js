'use strict';
// Le Journal : actualités (flux RSS), podcasts (flux audio) et vidéos (chaînes YouTube),
// plus les liens partagés par les membres. Aucun fichier lourd n'est stocké : on garde
// le titre, le résumé, l'image et l'adresse d'origine, et l'on joue l'audio / la vidéo
// depuis la plateforme qui les publie.
const dns = require('node:dns').promises;
const net = require('node:net');
const { XMLParser } = require('fast-xml-parser');

const UA = 'AURUM/1.0 (lecteur de flux du Journal)';
const KINDS = ['article', 'podcast', 'video'];

// ---------------------------------------------------------------------------
// Récupération sûre d'une page distante (pas d'adresse interne, taille et durée bornées)
// ---------------------------------------------------------------------------
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:127.') || v.startsWith('::ffff:10.') || v.startsWith('::ffff:192.168.');
}

async function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('Adresse invalide.');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Seules les adresses http(s) sont acceptées.');
  // Tests automatiques uniquement : un faux serveur de flux tourne sur la machine
  if (process.env.AURUM_ALLOW_LOCAL_FETCH === '1' && process.env.NODE_ENV === 'test') return u;
  if (u.port && !['80', '443'].includes(u.port)) throw new Error('Adresse non autorisée.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Adresse non autorisée.');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Error('Adresse non autorisée.');
  return u;
}

async function safeFetch(raw, { maxBytes = 1.5 * 1024 * 1024, timeout = 6000, accept } = {}) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await assertPublicUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(u, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': UA, accept: accept || 'text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*;q=0.8', 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.6' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), u).toString();
        continue;
      }
      if (!res.ok) throw new Error(`Le site a répondu ${res.status}.`);
      // Lecture bornée
      const reader = res.body.getReader();
      const chunks = [];
      let size = 0;
      let truncated = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        chunks.push(value);
        if (size > maxBytes) {
          truncated = true;
          ctrl.abort();
          break;
        }
      }
      const buf = Buffer.concat(chunks);
      return { url: u.toString(), contentType: res.headers.get('content-type') || '', text: decode(buf, res.headers.get('content-type')), truncated };
    } catch (err) {
      if (err.name === 'AbortError' && !res) throw new Error('Le site met trop de temps à répondre.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Trop de redirections.');
}

function decode(buf, contentType = '') {
  const m = /charset=([\w-]+)/i.exec(contentType || '') || /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(buf.subarray(0, 200).toString('latin1')) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 2048).toString('latin1'));
  const charset = (m?.[1] || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset === 'iso-8859-1' ? 'latin1' : charset).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

// ---------------------------------------------------------------------------
// Texte : HTML → texte brut, entités, longueur
// ---------------------------------------------------------------------------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê', ocirc: 'ô', laquo: '«', raquo: '»', mdash: '—', ndash: '–', euro: '€' };
function unescapeHtml(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function plain(html, max = 400) {
  const s = unescapeHtml(
    String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s;
}
const httpsOnly = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim().replace(/^http:\/\//i, 'https://') : null);

// ---------------------------------------------------------------------------
// Lecteurs intégrés : YouTube, Vimeo, Dailymotion, Spotify, Apple Podcasts, SoundCloud, Deezer
// ---------------------------------------------------------------------------
function embedFor(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let m;
  if (host === 'youtu.be' && (m = /^\/([\w-]{11})/.exec(u.pathname))) return { kind: 'video', embedUrl: `https://www.youtube-nocookie.com/embed/${m[1]}`, image: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` };
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const id = u.searchParams.get('v') || (/^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(u.pathname) || [])[1];
    if (id && /^[\w-]{11}$/.test(id)) return { kind: 'video', embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  }
  if (host === 'vimeo.com' && (m = /^\/(\d+)/.exec(u.pathname))) return { kind: 'video', embedUrl: `https://player.vimeo.com/video/${m[1]}` };
  if ((host === 'dailymotion.com' || host === 'dai.ly') && (m = /(?:\/video\/|^\/)([a-z0-9]+)/i.exec(u.pathname))) return { kind: 'video', embedUrl: `https://www.dailymotion.com/embed/video/${m[1]}` };
  if (host === 'open.spotify.com' && (m = /^\/(?:intl-\w+\/)?(episode|show|track|album|playlist)\/(\w+)/.exec(u.pathname))) return { kind: 'podcast', embedUrl: `https://open.spotify.com/embed/${m[1]}/${m[2]}` };
  if (host === 'podcasts.apple.com' && /\/podcast\//.test(u.pathname)) return { kind: 'podcast', embedUrl: `https://embed.podcasts.apple.com${u.pathname}${u.search}` };
  if (host === 'soundcloud.com' && u.pathname.split('/').filter(Boolean).length >= 2) return { kind: 'podcast', embedUrl: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.origin + u.pathname)}&color=%238a6d43&visual=true` };
  if (host === 'deezer.com' && (m = /\/(episode|show|track|album|playlist)\/(\d+)/.exec(u.pathname))) return { kind: 'podcast', embedUrl: `https://widget.deezer.com/widget/auto/${m[1]}/${m[2]}` };
  if (/\.(mp3|m4a|aac|ogg|opus)(\?|$)/i.test(u.pathname)) return { kind: 'podcast', audioUrl: u.toString() };
  return null;
}

// ---------------------------------------------------------------------------
// Aperçu d'un lien partagé (balises Open Graph)
// ---------------------------------------------------------------------------
function metaTags(html) {
  const head = html.slice(0, 300000);
  const out = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (/(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
    const val = (/content\s*=\s*["']([^"']*)["']/i.exec(tag) || [])[1];
    if (key && val !== undefined && !(key.toLowerCase() in out)) out[key.toLowerCase()] = unescapeHtml(val);
  }
  out.title_tag = unescapeHtml((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1] || '').trim();
  return out;
}

// Aperçus officiels (oEmbed) des grandes plateformes : titre et vignette fiables
const OEMBED = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, (u) => `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(u)}`],
  [/(^|\.)vimeo\.com$/, (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`],
  [/^open\.spotify\.com$/, (u) => `https://open.spotify.com/oembed?url=${encodeURIComponent(u)}`],
  [/(^|\.)soundcloud\.com$/, (u) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u)}`],
  [/(^|\.)dailymotion\.com$/, (u) => `https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(u)}`],
];
async function oembed(url) {
  const host = new URL(url).hostname.replace(/^www\.|^m\./, '');
  const entry = OEMBED.find(([re]) => re.test(host));
  if (!entry) return null;
  try {
    const res = await safeFetch(entry[1](url), { accept: 'application/json', maxBytes: 200 * 1024, timeout: 5000 });
    const d = JSON.parse(res.text);
    return { title: d.title, author: d.author_name, image: d.thumbnail_url, provider: d.provider_name };
  } catch {
    return null;
  }
}

async function previewLink(raw) {
  const url = raw.trim();
  const embed = embedFor(url);
  let meta = {};
  let finalUrl = url;
  const oe = embed && !embed.audioUrl ? await oembed(url) : null;
  if (oe?.title) {
    meta = { 'og:title': oe.title, 'og:site_name': oe.author ? `${oe.author} · ${oe.provider || ''}`.replace(/ · $/, '') : oe.provider, 'og:image': oe.image };
  } else if (!embed?.audioUrl) {
    try {
      const page = await safeFetch(url, { maxBytes: 800 * 1024 });
      finalUrl = page.url;
      meta = metaTags(page.text);
    } catch (err) {
      if (!embed) throw err;
    }
  }
  const host = new URL(finalUrl).hostname.replace(/^www\./, '');
  const title = plain(meta['og:title'] || meta['twitter:title'] || meta.title_tag || '', 200) || host;
  const summary = plain(meta['og:description'] || meta['twitter:description'] || meta.description || '', 400);
  const image = httpsOnly(embed?.image || meta['og:image'] || meta['og:image:url'] || meta['twitter:image']);
  const ogType = (meta['og:type'] || '').toLowerCase();
  const kind = embed?.kind || (ogType.startsWith('video') ? 'video' : ogType.includes('music') || ogType.includes('podcast') ? 'podcast' : 'article');
  return {
    kind,
    url: finalUrl,
    title,
    summary,
    image,
    siteName: plain(meta['og:site_name'] || '', 60) || host,
    embedUrl: embed?.embedUrl || null,
    audioUrl: embed?.audioUrl || null,
  };
}

// ---------------------------------------------------------------------------
// Flux RSS / Atom / YouTube / podcasts
// ---------------------------------------------------------------------------
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', removeNSPrefix: false, processEntities: true, htmlEntities: true });
const arr = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v) => (v && typeof v === 'object' ? v['#text'] ?? v['@href'] ?? '' : v ?? '');
const dateOf = (...vals) => {
  for (const v of vals) {
    const t = Date.parse(txt(v));
    if (Number.isFinite(t)) return t;
  }
  return null;
};
function durationOf(v) {
  const s = String(txt(v) || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseFeed(xml) {
  const doc = parser.parse(xml);
  // Atom (dont YouTube)
  if (doc.feed) {
    const f = doc.feed;
    const isYouTube = Boolean(f['yt:channelId']) || arr(f.entry).some((e) => e['yt:videoId']);
    const link = arr(f.link).find((l) => l['@rel'] === 'alternate') || arr(f.link)[0];
    const items = arr(f.entry).map((e) => {
      const vid = e['yt:videoId'];
      const elink = arr(e.link).find((l) => !l['@rel'] || l['@rel'] === 'alternate') || arr(e.link)[0];
      const group = e['media:group'] || {};
      return {
        title: plain(txt(e.title), 200),
        url: vid ? `https://www.youtube.com/watch?v=${vid}` : txt(elink),
        summary: plain(txt(group['media:description']) || txt(e.summary) || txt(e.content), 400),
        image: httpsOnly(group['media:thumbnail']?.['@url'] || (vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null)),
        publishedAt: dateOf(e.published, e.updated),
        embedUrl: vid ? `https://www.youtube-nocookie.com/embed/${vid}` : null,
        audioUrl: null,
        duration: null,
      };
    });
    return { kind: isYouTube ? 'video' : 'article', title: plain(txt(f.title), 120), siteUrl: txt(link) || null, image: null, items };
  }
  // RSS 2.0
  const ch = doc.rss?.channel || doc['rdf:RDF']?.channel;
  if (!ch) throw new Error('Ce lien n’est pas un flux RSS, Atom, YouTube ou podcast.');
  const rawItems = arr(ch.item || doc['rdf:RDF']?.item);
  const channelImage = httpsOnly(ch['itunes:image']?.['@href'] || txt(ch.image?.url));
  const audio = (it) => arr(it.enclosure).find((x) => /^audio\//.test(x['@type'] || '') || /\.(mp3|m4a|aac|ogg)(\?|$)/i.test(x['@url'] || ''));
  const isPodcast = rawItems.length > 0 && rawItems.filter((it) => audio(it)).length >= Math.ceil(rawItems.length / 2);
  const items = rawItems.map((it) => {
    const enc = audio(it);
    const img =
      it['itunes:image']?.['@href'] ||
      arr(it['media:content']).find((m) => !m['@medium'] || m['@medium'] === 'image' || /^image\//.test(m['@type'] || ''))?.['@url'] ||
      arr(it['media:thumbnail'])[0]?.['@url'] ||
      arr(it.enclosure).find((x) => /^image\//.test(x['@type'] || ''))?.['@url'] ||
      (/<img[^>]+src=["']([^"']+)["']/i.exec(txt(it['content:encoded']) || txt(it.description) || '') || [])[1];
    const link = txt(it.link) || (it.guid && /^https?:/.test(txt(it.guid)) ? txt(it.guid) : '') || enc?.['@url'] || '';
    return {
      title: plain(txt(it.title), 200),
      url: link.trim(),
      summary: plain(txt(it['itunes:summary']) || txt(it.description) || txt(it['content:encoded']), 400),
      image: httpsOnly(img) || (isPodcast ? channelImage : null),
      publishedAt: dateOf(it.pubDate, it['dc:date']),
      embedUrl: null,
      audioUrl: enc ? httpsOnly(enc['@url']) : null,
      duration: durationOf(it['itunes:duration']),
    };
  });
  return { kind: isPodcast ? 'podcast' : 'article', title: plain(txt(ch.title), 120), siteUrl: txt(ch.link) || null, image: channelImage, items };
}

// Résout ce que la Direction colle : flux, site (lien « alternate »), chaîne YouTube, page Apple Podcasts
async function resolveFeedUrl(raw) {
  const url = raw.trim();
  const u = new URL(url);
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtube.com' && !u.pathname.startsWith('/feeds/')) {
    const direct = /^\/channel\/(UC[\w-]{22})/.exec(u.pathname);
    if (direct) return `https://www.youtube.com/feeds/videos.xml?channel_id=${direct[1]}`;
    const page = await safeFetch(url, { maxBytes: 2.5 * 1024 * 1024 });
    // L'adresse officielle de la chaîne figure en tête de page
    const id = (
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(page.text) ||
      /<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(page.text) ||
      /"externalId":"(UC[\w-]{22})"/.exec(page.text) ||
      []
    )[1];
    if (!id) throw new Error('Chaîne YouTube introuvable.');
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
  }
  if (host === 'podcasts.apple.com') {
    const id = (/\/id(\d+)/.exec(u.pathname) || [])[1];
    if (!id) throw new Error('Podcast Apple introuvable.');
    const look = await safeFetch(`https://itunes.apple.com/lookup?id=${id}&entity=podcast`, { accept: 'application/json' });
    const feed = JSON.parse(look.text).results?.[0]?.feedUrl;
    if (!feed) throw new Error('Ce podcast ne publie pas de flux public.');
    return feed;
  }
  return url;
}

// Les flux YouTube répondent parfois « introuvable » au hasard : on réessaie
async function fetchFeed(url) {
  const youtube = /youtube\.com\/feeds\//.test(url);
  for (let attempt = 1; ; attempt++) {
    try {
      return await safeFetch(url, { maxBytes: 3 * 1024 * 1024 });
    } catch (err) {
      if (!youtube || attempt >= 3 || !/répondu (404|5\d\d)/.test(err.message)) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function loadFeed(raw) {
  let url = await resolveFeedUrl(raw);
  let page = await fetchFeed(url);
  // Page web : on cherche son flux déclaré
  if (!/^\s*(<\?xml|<rss|<feed|<rdf)/i.test(page.text.slice(0, 500))) {
    const alt = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i.exec(page.text);
    const href = alt && (/href=["']([^"']+)["']/i.exec(alt[0]) || [])[1];
    if (!href) throw new Error('Aucun flux trouvé à cette adresse.');
    url = new URL(unescapeHtml(href), page.url).toString();
    page = await safeFetch(url, { maxBytes: 3 * 1024 * 1024 });
  }
  // Très gros podcasts : on ne garde que les épisodes complets du début du flux
  let xml = page.text;
  if (page.truncated) {
    const cut = Math.max(xml.lastIndexOf('</item>'), xml.lastIndexOf('</entry>'));
    if (cut < 0) throw new Error('Flux trop volumineux.');
    const end = xml.lastIndexOf('</entry>') === cut ? '</entry></feed>' : '</item></channel></rss>';
    xml = xml.slice(0, cut) + end;
  }
  const feed = parseFeed(xml);
  return { ...feed, feedUrl: url, items: feed.items.filter((i) => i.title && /^https?:\/\//.test(i.url)) };
}

// Recherche de podcasts par nom (annuaire Apple Podcasts)
async function searchPodcasts(q) {
  const res = await safeFetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=podcast&country=fr&limit=8`, { accept: 'application/json' });
  return (JSON.parse(res.text).results || [])
    .filter((r) => r.feedUrl)
    .map((r) => ({ title: r.collectionName, author: r.artistName, image: httpsOnly(r.artworkUrl600 || r.artworkUrl100), feedUrl: r.feedUrl }));
}

// Sources proposées au premier lancement (la Direction peut les retirer ou en ajouter)
const DEFAULT_SOURCES = [
  { kind: 'article', title: 'France 24 — À la une', url: 'https://www.france24.com/fr/rss' },
  { kind: 'article', title: 'France 24 — Économie', url: 'https://www.france24.com/fr/economie/rss' },
  { kind: 'article', title: 'France 24 — Culture', url: 'https://www.france24.com/fr/culture/rss' },
  { kind: 'article', title: 'Robb Report', url: 'https://www.robbreport.com/feed/' },
  { kind: 'article', title: 'Wallpaper*', url: 'https://www.wallpaper.com/rss' },
  { kind: 'article', title: 'Dezeen', url: 'https://www.dezeen.com/feed/' },
  { kind: 'podcast', title: 'L’Heure du Monde', url: 'https://feeds.acast.com/public/shows/68db9d2509b1c365e44318ca' },
  { kind: 'podcast', title: 'Génération Do It Yourself', url: 'https://feeds.audiomeans.fr/feed/b4a5ee3a-9230-4f9f-988d-2ae156a2d5a9.xml' },
  { kind: 'podcast', title: 'La Martingale', url: 'https://feeds.audiomeans.fr/feed/647b907b-5a2f-4a11-94cb-591d604cb1b9.xml' },
  { kind: 'podcast', title: 'Le Podcast de Pauline Laigneau', url: 'https://feeds.audiomeans.fr/feed/777bf367-c336-48d1-a304-f0f6cc685a8e.xml' },
  { kind: 'video', title: 'Sotheby’s', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCelkSnSbxvIfjjD01uPHHbg' },
  { kind: 'video', title: 'Christie’s', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCSbY5GF1eSKtT6d32qC7Krw' },
  { kind: 'video', title: 'Robb Report', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCad9XfyHa3dikbSSLyOiguQ' },
  { kind: 'video', title: 'Architectural Digest', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC0k238zFx-Z8xFH0sxCrPJg' },
  { kind: 'video', title: 'Le Monde', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCYpRDnhk5H8h16jpS84uqsA' },
  { kind: 'video', title: 'France 24', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCCCPCZNChQdGa9EkATeye4g' },
  { kind: 'video', title: 'BFM Business', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCUsBMOIUl_ad6JUOC16DpmQ' },
];

module.exports = { KINDS, safeFetch, assertPublicUrl, previewLink, parseFeed, loadFeed, searchPodcasts, embedFor, plain, DEFAULT_SOURCES };
