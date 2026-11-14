// Traduction automatique : un lien « Voir la traduction » sous les contenus écrits dans une autre langue.
import { api } from '../api.js';
import { store } from '../store.js';
import { h, toast } from '../dom.js';

// Langues proposées dans les réglages (nom dans la langue elle-même)
export const LANG_CHOICES = [
  ['fr', 'Français'],
  ['en', 'English'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['nl', 'Nederlands'],
  ['ru', 'Русский'],
  ['ar', 'العربية'],
  ['zh', '中文'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['tr', 'Türkçe'],
  ['pl', 'Polski'],
  ['he', 'עברית'],
];
const SUPPORTED = new Set(LANG_CHOICES.map(([c]) => c));

// Langue du membre : son réglage, sinon celle de son téléphone
export function myLang() {
  const pref = store.user?.lang;
  if (pref) return pref;
  const device = (navigator.language || 'fr').slice(0, 2).toLowerCase();
  return SUPPORTED.has(device) ? device : 'fr';
}

let names = null;
function fromLabel(code) {
  try {
    names ||= new Intl.DisplayNames(['fr'], { type: 'language' });
    const name = names.of(code);
    if (!name || name === code) return 'Traduit';
    return `Traduit ${/^[aeiouyhéèêâ]/i.test(name) ? 'de l’' : 'du '}${name}`;
  } catch {
    return 'Traduit';
  }
}

const memo = new Map();
async function translate(texts, to) {
  const key = `${to}\n${texts.join('\n\u0000\n')}`;
  if (memo.has(key)) return memo.get(key);
  const { translations } = await api.post('/api/translate', { texts, to });
  memo.set(key, translations);
  return translations;
}

// Renvoie le lien (ou null si le contenu est déjà dans la langue du membre).
// show(traductions) affiche la traduction, hide() remet l'original.
export function translateLink(texts, lang, { show, hide, small = false } = {}) {
  const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => typeof t === 'string' && t.trim());
  const to = myLang();
  if (!lang || !list.length || lang === to) return null;
  const btn = h('button', { class: `see-translation${small ? ' small' : ''}`, type: 'button' }, 'Voir la traduction');
  let shown = false;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (shown) {
      shown = false;
      hide();
      btn.textContent = 'Voir la traduction';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Traduction…';
    try {
      const out = await translate(list, to);
      show(out.map((t) => t.text));
      shown = true;
      btn.textContent = `${fromLabel(out[0]?.source || lang)} · Voir l’original`;
    } catch (err) {
      btn.textContent = 'Voir la traduction';
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}
