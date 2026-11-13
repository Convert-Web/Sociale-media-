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

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESERVED = new Set([
  'admin', 'administrateur', 'aurum', 'support', 'help', 'aide', 'root', 'system', 'systeme',
  'api', 'moderation', 'staff', 'equipe', 'contact', 'security', 'securite', 'null', 'undefined',
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

function cleanWebsite(value) {
  const v = text(value, { field: 'Site web', max: 200 });
  if (!v) return '';
  const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error();
    return parsed.toString().replace(/\/$/, '');
  } catch {
    fail(400, 'Adresse de site web invalide.');
  }
}

module.exports = {
  cleanWebsite, HttpError, fail, text, intParam, USERNAME_RE, EMAIL_RE, RESERVED };
