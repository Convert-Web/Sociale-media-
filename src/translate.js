'use strict';
// Traduction automatique des contenus entre membres (publications, commentaires, messages, Journal).
// - Détection de la langue sur le serveur, sans appel extérieur (tinyld).
// - Traduction par DeepL si une clé est fournie (DEEPL_API_KEY), sinon par MyMemory (gratuit).
// - Chaque traduction est gardée en mémoire dans la base : un même texte n'est traduit qu'une fois.
const crypto = require('node:crypto');
const light = require('tinyld/light');
const heavy = require('tinyld/heavy');

// Les deux modèles se trompent sur des cas différents : on additionne leurs votes
function detect(text) {
  const score = {};
  for (const r of heavy.detectAll(text)) score[r.lang] = (score[r.lang] || 0) + r.accuracy;
  for (const r of light.detectAll(text)) score[r.lang] = (score[r.lang] || 0) + r.accuracy;
  return Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const LANGS = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ru', 'ar', 'zh', 'ja', 'ko', 'tr', 'pl', 'he', 'hi', 'sv', 'da', 'no', 'fi', 'el', 'cs', 'ro', 'hu', 'uk', 'th', 'vi', 'id'];

// --- Détection ------------------------------------------------------------------
const FR_WORDS = new Set('le les des une est et pour avec dans sur pas qui nous vous je tu il elle ils elles on ce cette ces mais très où ça du au aux mon ma mes ton ta tes son sa ses notre votre leur trop bien merci aussi encore déjà toujours être avoir fait suis sont était chez'.split(' '));
const cache = new Map();
function detectLang(text) {
  if (typeof text !== 'string') return null;
  // On retire liens, @mentions et #sujets, mais on garde la ponctuation (elle aide les détecteurs)
  const clean = text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[@#][\p{L}\p{N}_.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Les phrases courtes (« Trop beau ce soir ! ») sont trop ambiguës : pas de traduction proposée
  if (clean.replace(/[^\p{L}]/gu, '').length < 30) return null;
  const key = clean.slice(0, 400);
  if (cache.has(key)) return cache.get(key);
  let lang = null;
  try {
    // Mots-outils propres au français : les détecteurs prennent souvent un message familier
    // (« trop bien la soirée avec vous ») pour une autre langue
    const words = key.toLowerCase().split(/[^\p{L}’']+/u).filter(Boolean);
    const fr = words.filter((w) => FR_WORDS.has(w) || /^(?:c|j|l|d|qu|n|m|s|t)['’]/.test(w)).length;
    lang = fr >= 2 && fr / words.length >= 0.15 ? 'fr' : detect(key) || null;
  } catch {
    lang = null;
  }
  if (lang && !LANGS.includes(lang)) lang = null;
  if (cache.size > 5000) cache.clear();
  cache.set(key, lang);
  return lang;
}

// --- Fournisseurs -----------------------------------------------------------------
const unescapeHtml = (s) =>
  String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// MyMemory accepte 500 caractères par requête : on découpe par phrases
function chunks(text, max = 450) {
  const parts = text.match(/[^.!?…\n]+[.!?…]*\s*|\n+/g) || [text];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > max && cur) {
      out.push(cur);
      cur = '';
    }
    if (p.length > max) {
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max));
    } else cur += p;
  }
  if (cur) out.push(cur);
  return out;
}

async function myMemory(text, from, to, email) {
  const pieces = [];
  for (const part of chunks(text)) {
    if (!part.trim()) {
      pieces.push(part);
      continue;
    }
    const lead = part.match(/^\s*/)[0];
    const trail = part.match(/\s*$/)[0];
    const params = new URLSearchParams({ q: part.trim(), langpair: `${from || 'Autodetect'}|${to}`, mt: '1' });
    if (email) params.set('de', email);
    const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { signal: AbortSignal.timeout(10000) });
    const data = await res.json().catch(() => ({}));
    if (data.quotaFinished || data.responseStatus === 429) throw Object.assign(new Error('Le quota de traduction gratuit du jour est atteint. Réessayez demain.'), { status: 429 });
    if (Number(data.responseStatus) !== 200 || !data.responseData?.translatedText) throw new Error('Traduction indisponible pour le moment.');
    pieces.push(lead + unescapeHtml(data.responseData.translatedText) + trail);
  }
  return pieces.join('');
}

async function deepl(texts, to, key) {
  const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
  const body = new URLSearchParams();
  for (const t of texts) body.append('text', t);
  body.set('target_lang', to === 'en' ? 'EN-GB' : to === 'pt' ? 'PT-PT' : to.toUpperCase());
  const res = await fetch(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 456) throw Object.assign(new Error('Le quota mensuel de traduction est atteint.'), { status: 429 });
  if (!res.ok) throw new Error('Traduction indisponible pour le moment.');
  const data = await res.json();
  return data.translations.map((t) => ({ text: t.text, source: (t.detected_source_language || '').slice(0, 2).toLowerCase() || null }));
}

// --- Traduction avec mémoire --------------------------------------------------------
const keyOf = (text, to) => crypto.createHash('sha256').update(`${to}\n${text}`).digest('hex');

async function translateTexts(ctx, texts, to) {
  const { db, config } = ctx;
  if (!LANGS.includes(to)) throw Object.assign(new Error('Langue non prise en charge.'), { status: 400 });
  const results = new Array(texts.length);
  const missing = [];
  for (const [i, text] of texts.entries()) {
    const row = await db.get('SELECT text, source FROM translations WHERE key = ?', keyOf(text, to));
    if (row) results[i] = { text: row.text, source: row.source };
    else missing.push(i);
  }
  if (missing.length) {
    let fresh;
    if (ctx.translator) {
      fresh = await ctx.translator(missing.map((i) => texts[i]), to);
    } else if (config.translate?.deeplKey) {
      fresh = await deepl(missing.map((i) => texts[i]), to, config.translate.deeplKey);
    } else {
      fresh = [];
      for (const i of missing) {
        const source = detectLang(texts[i]);
        // MyMemory reconnaît lui-même la langue d'origine (plus sûr sur les cas limites)
        fresh.push({ text: source === to ? texts[i] : await myMemory(texts[i], null, to, config.translate?.email), source });
      }
    }
    for (const [n, i] of missing.entries()) {
      results[i] = fresh[n];
      await db.run(
        'INSERT OR REPLACE INTO translations (key, lang, source, text, created_at) VALUES (?, ?, ?, ?, ?)',
        keyOf(texts[i], to), to, fresh[n].source || null, fresh[n].text, Date.now(),
      );
    }
  }
  return results;
}

module.exports = { LANGS, detectLang, translateTexts, chunks };
