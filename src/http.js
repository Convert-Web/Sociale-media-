'use strict';

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, message, code) => {
  throw new HttpError(status, message, code);
};

// Nom d'utilisateur : 2 à 24 caractères, lettres, chiffres, « _ » et « . » (pas de point final)
const USERNAME_RE = /^[a-z0-9_](?:[a-z0-9_.]{0,22}[a-z0-9_])?$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESERVED = new Set([
  'admin', 'administrateur', 'vibz', 'vibz.officiel', 'support', 'help', 'aide', 'root', 'system', 'systeme',
  'api', 'moderation', 'staff', 'equipe', 'contact', 'security', 'securite', 'null', 'undefined', 'live', 'explorer',
  'recherche', 'reglages', 'messages', 'boite', 'activite', 'studio', 'portefeuille', 'creer', 'tag', 'son', 'amis',
  'abonnements', 'connexion', 'inscription', 'media', 'static', 'aurum',
]);

function text(value, { field, min = 0, max = 500, required = false } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') fail(400, `Champ « ${field} » invalide.`);
  const v = value.replace(/\r\n/g, '\n').trim();
  if (required && !v) fail(400, `Le champ « ${field} » est requis.`);
  if (v.length < min) fail(400, `« ${field} » doit contenir au moins ${min} caractères.`);
  if (v.length > max) fail(400, `« ${field} » ne peut dépasser ${max} caractères.`);
  return v;
}

function intParam(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Liste d'identifiants « 1,2,3 » (au plus max), sans doublon
function idList(value, max = 300) {
  if (typeof value !== 'string' || !value) return [];
  const out = new Set();
  for (const part of value.split(',')) {
    const n = intParam(part);
    if (n) out.add(n);
    if (out.size >= max) break;
  }
  return [...out];
}

function flag(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || ['1', 'true', 'on', 'oui'].includes(String(value).toLowerCase());
}

function cleanWebsite(value) {
  const v = text(value, { field: 'Lien', max: 200 });
  if (!v) return '';
  const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error();
    return parsed.toString().replace(/\/$/, '');
  } catch {
    fail(400, 'Adresse du lien invalide.');
  }
}

module.exports = { cleanWebsite, HttpError, fail, text, intParam, idList, flag, USERNAME_RE, EMAIL_RE, RESERVED };
