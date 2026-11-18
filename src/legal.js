'use strict';
// Informations légales de l'éditeur (mentions légales, CGU, CGV, politique de confidentialité).
// Saisies par la Direction depuis l'application et gardées dans la base : elles ne figurent
// jamais dans le code publié sur GitHub.
const { fail } = require('./http');

const FIELDS = {
  editorName: { label: 'Nom et prénom, ou raison sociale', max: 120, required: true },
  legalForm: { label: 'Statut juridique', max: 120, required: true },
  capital: { label: 'Capital social', max: 60 },
  address: { label: 'Adresse', max: 240, required: true },
  siren: { label: 'SIREN ou SIRET', max: 40, required: true },
  registry: { label: 'Immatriculation (RCS, RNE…)', max: 120 },
  vat: { label: 'TVA intracommunautaire ou mention d’exonération', max: 120 },
  director: { label: 'Directeur de la publication', max: 120, required: true },
  email: { label: 'E-mail de contact', max: 120, required: true, email: true },
  phone: { label: 'Téléphone', max: 40 },
  mediatorName: { label: 'Médiateur de la consommation', max: 160, required: true },
  mediatorUrl: { label: 'Site du médiateur', max: 200, url: true },
};

async function getLegal(ctx) {
  const row = await ctx.db.get("SELECT value FROM settings WHERE key = 'legal'");
  let data = {};
  try {
    data = row ? JSON.parse(row.value) : {};
  } catch {
    data = {};
  }
  const out = {};
  for (const k of Object.keys(FIELDS)) out[k] = typeof data[k] === 'string' ? data[k] : '';
  return out;
}

function missing(legal) {
  return Object.entries(FIELDS).filter(([k, f]) => f.required && !legal[k]).map(([, f]) => f.label);
}

async function saveLegal(ctx, body) {
  const clean = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    const v = typeof body?.[k] === 'string' ? body[k].replace(/\s+/g, ' ').trim() : '';
    if (v.length > f.max) fail(400, `${f.label} : ${f.max} caractères au maximum.`);
    if (v && f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) fail(400, `${f.label} : adresse e-mail invalide.`);
    if (v && f.url && !/^https:\/\/[^\s]+\.[^\s]{2,}/.test(v)) fail(400, `${f.label} : adresse web invalide (elle doit commencer par https://).`);
    clean[k] = v;
  }
  await ctx.db.run(
    "INSERT INTO settings (key, value) VALUES ('legal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    JSON.stringify(clean),
  );
  return clean;
}

module.exports = { FIELDS, getLegal, saveLegal, missing };
