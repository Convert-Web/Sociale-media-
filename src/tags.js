'use strict';
// #hashtags et @mentions des descriptions, commentaires et messages.
// Le caractère qui précède doit être un séparateur : « C#4 » ou une adresse e-mail ne comptent pas.
const TAG_RE = /(^|[^\p{L}\p{N}_&#])#([\p{L}\p{N}_]{2,40})/gu;
const MENTION_RE = /(^|[^\p{L}\p{N}_@.])@([a-z0-9_.]{2,24})(?![\p{L}\p{N}_])/giu;

function extractTags(text, max = 30) {
  const out = new Set();
  for (const m of String(text || '').matchAll(TAG_RE)) {
    out.add(m[2].toLocaleLowerCase('fr'));
    if (out.size >= max) break;
  }
  return [...out];
}

function extractMentions(text, max = 10) {
  const out = new Set();
  for (const m of String(text || '').matchAll(MENTION_RE)) {
    const name = m[2].replace(/\.+$/, '').toLowerCase();
    if (name.length >= 2) out.add(name);
    if (out.size >= max) break;
  }
  return [...out];
}

// Hashtag saisi par une personne (« #Danse », « danse ») → forme normalisée, ou null
function normalizeTag(value) {
  const t = String(value || '').trim().replace(/^#+/, '').toLocaleLowerCase('fr');
  return /^[\p{L}\p{N}_]{2,40}$/u.test(t) ? t : null;
}

module.exports = { extractTags, extractMentions, normalizeTag, TAG_RE, MENTION_RE };
