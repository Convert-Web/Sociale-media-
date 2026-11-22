'use strict';
// Filtre de modération automatique : repère, au moment de l'envoi, les propos haineux,
// menaçants, injurieux ou déplacés (français, anglais et quelques langues voisines).
// Il fonctionne entièrement sur nos serveurs, sans service extérieur.
//
// Deux niveaux :
//   « block » — propos haineux, menaces, incitation au suicide, numéro de carte bancaire :
//               le contenu est refusé et l'auteur invité à le reformuler ;
//   « flag »  — insultes, vulgarité sexuelle, arnaques : le contenu est publié, mais masqué
//               derrière un avertissement et transmis à l'administration.
//
// Les mots sont comparés en entier (« con » ne touche pas « conseil »), après normalisation :
// minuscules, accents, écriture « l33t » (c0nn4rd), lettres répétées (connnnard),
// lettres espacées (c o n n a r d) et astérisques (c*nnard).

const CATEGORIES = {
  haine: 'Propos haineux',
  menace: 'Menace ou violence',
  injure: 'Insulte',
  sexuel: 'Propos sexuels déplacés',
  spam: 'Arnaque ou démarchage',
  carte: 'Numéro de carte bancaire',
};

// Entrées déjà normalisées (sans accents, apostrophes remplacées par des espaces).
// « a|b » : variantes ; les pluriels et féminins (s, e, es) sont ajoutés automatiquement.
const LEXICON = {
  block: {
    haine: [
      // Insultes racistes, antisémites, homophobes (seules ou précédées de « sale »)
      'bougnoule', 'bougnoul', 'youpin', 'youpine', 'bicot', 'chinetoque', 'niakoue', 'bamboula', 'nigger', 'niggers', 'faggot', 'kike',
      'sale (arabe|noir|negre|negresse|juif|juive|feuj|rebeu|beur|renoi|musulman|chretien|blanc|asiat|chinois|gitan|rom|portos|polak|pd|pede|gouine|tapette|travelo|tranny|nigga)',
      'mort aux (juifs|arabes|noirs|musulmans|chretiens|blancs|pedes|gays|homos|femmes|immigres|migrants)',
      'heil hitler', 'sieg heil', 'white power', 'gas the jews', 'gaz aux juifs', '(retourne|rentre) dans ton pays',
    ],
    // Menaces explicites et incitation au suicide (les formules souvent dites pour plaisanter,
    // comme « je vais te tuer », sont seulement signalées : voir plus bas)
    menace: [
      '(je|j|on) (vais|veux|va) te (buter|egorger|planter|violer|defoncer la gueule|faire la peau|cramer|bruler vif|etrangler|retrouver et)',
      'je vais vous (buter|egorger|violer)', 'je vais tous vous tuer', 'on va vous (buter|egorger)', 'je sais ou tu habites', 'je sais ou tu vis',
      'suicide toi', 'suicides toi', 'tue toi', 'va te tuer', 'va te pendre', 'pends toi', 'va te suicider', 'jette toi sous un train',
      'kill yourself', 'go kill yourself', 'kys', 'i (will|ll|m gonna|am gonna|am going to|m going to) (rape|stab|shoot) you',
      'i know where you live', 'hope you die', 'j espere que tu (vas mourir|vas crever|creves)',
    ],
  },
  flag: {
    injure: [
      'connard', 'conard', 'connasse', 'conasse', 'salope', 'salaud', 'pute', 'enculer', 'encule', 'batard', 'baltringue',
      'debile mental', 'pouffiasse', 'petasse', 'grognasse', 'trouduc', 'trou du cul', 'sac a merde', 'merdeux', 'fils de pute',
      'fdp', 'ntm', 'nique ta (mere|race|soeur|famille|grand mere)', 'niquer ta mere', 'je te nique', 'nique toi', 'ta gueule', 'ferme ta gueule',
      'va te faire (foutre|enculer|mettre)', 'va crever (sale|connard|connasse|batard|salope)', 'allez crever', 'creve (sale|connard|connasse|batard)',
      '(espece de|pauvre|gros|grosse|sale|quel|quelle|t es|tu es|t es qu un|bande de|vieux|vieille) (con|conne|cons|connes|idiot|imbecile|cretin|cretine|merde|abruti|ordure|raclure)',
      '(espece d|bande d|pauvre|sale) (abruti|idiot|imbecile|enfoire|ordure)',
      'pd', 'pede', 'gouine', 'enfoire', 'raclure', 'grosse vache', 'sale chienne', 'sale pute',
      'fuck you', 'fuck off', 'fuck u', 'motherfucker', 'mother fucker', 'son of a bitch', 'bitch', 'cunt', 'whore', 'slut', 'asshole', 'dickhead',
      'stfu', 'shut the fuck up', 'you retard', 'retarded', 'piece of shit', 'nigga', 'twat', 'wanker',
      // Espagnol, italien, allemand, portugais, arabe translittéré
      'hijo de puta', 'hijoputa', 'puta', 'cabron', 'pendejo', 'gilipollas', 'maricon', 'vete a la mierda',
      'vaffanculo', 'stronzo', 'stronza', 'figlio di puttana', 'puttana', 'coglione',
      'arschloch', 'hurensohn', 'fotze', 'wichser', 'schlampe', 'fick dich', 'missgeburt',
      'filho da puta', 'vai tomar no cu', 'viado',
      'charmouta', 'sharmouta', 'kahba', 'nik mok',
    ],
    // Formules violentes souvent dites pour plaisanter : signalées, pas refusées
    menace: [
      '(je|j|on) (vais|va) te (tuer|crever|defoncer)', 'je te tue', 'je vais vous tuer', 'je vais te casser la gueule',
      'i (will|ll|m gonna|am gonna|am going to|m going to) (kill|murder|hurt) you', 'gonna kill you',
    ],
    sexuel: [
      'suce ma (bite|queue)', 'suce moi', 'montre (tes seins|ta chatte|ton cul)', 'envoie (des nudes|tes nudes|une photo nue)',
      'send nudes', 'send me nudes', 'show me your (tits|boobs|pussy)', 'suck my (dick|cock)', 'je vais te baiser', 'je veux te baiser', 'baise moi',
      'grosse bite',
    ],
    spam: [
      'double ton argent', 'doublez votre argent', 'gagnez (\\d+|de l argent) par jour', 'investissement garanti', 'rendement garanti',
      'contactez moi sur (whatsapp|telegram)', 'contacte moi sur (whatsapp|telegram)', 'ecris moi sur (whatsapp|telegram)',
      'contact me on (whatsapp|telegram)', 'dm me on (whatsapp|telegram)', 'crypto garanti', 'guaranteed profit', 'onlyfans', 'mym fans', 'escort girl',
    ],
  },
};

// Termes dont les lettres doubles comptent (« nigger » ≠ « Niger », « faggot » ≠ « fagot »).
const STRICT = new Set(['nigger', 'niggers', 'faggot', 'kike']);

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '€': 'e' };

// Écrase les lettres répétées : « max » lettres identiques consécutives au plus.
const squeeze = (word, max) => word.replace(/(.)\1+/g, (run, c) => c.repeat(Math.min(run.length, max)));

// Découpe un texte en mots normalisés.
function tokenize(text) {
  const base = String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, ' ');
  const words = [];
  for (const raw of base.split(/\s+/)) {
    if (!raw) continue;
    // Bords : ponctuation retirée ; au milieu d'un mot, les chiffres/symboles « l33t » deviennent des lettres
    let w = raw.replace(/^[^a-z0-9@$€*]+|[^a-z0-9@$€*]+$/g, '');
    if (/[a-z]/.test(w)) w = w.replace(/[013457@$€]/g, (c) => LEET[c]);
    for (const part of w.split(/[^a-z0-9*]+/)) if (part) words.push(part);
    // Fin de phrase ou virgule : une expression ne déborde pas d'une phrase à l'autre
    if (/[.,;:!?)]$/.test(raw)) words.push('#');
  }
  // Lettres espacées : « c o n n a r d » → « connard » (au moins trois lettres isolées)
  const out = [];
  for (let i = 0; i < words.length; ) {
    if (words[i].length === 1 && /[a-z]/.test(words[i])) {
      let j = i;
      while (j < words.length && words[j].length === 1 && /[a-z]/.test(words[j])) j++;
      if (j - i >= 3) {
        out.push(words.slice(i, j).join(''));
        i = j;
        continue;
      }
    }
    out.push(words[i]);
    i++;
  }
  return out;
}

// Développe « a (b|c) » en « a b » et « a c », puis ajoute pluriels et féminins.
function expand(pattern) {
  let forms = [''];
  for (const piece of pattern.split(/(\([^)]*\))/)) {
    const alts = piece.startsWith('(') ? piece.slice(1, -1).split('|') : [piece];
    forms = forms.flatMap((f) => alts.map((a) => f + a));
  }
  const out = new Set();
  for (const f of forms) {
    const words = f.trim().split(/\s+/);
    const last = words.pop();
    for (const suffix of ['', 's', 'e', 'es', 'x']) out.add([...words, last + suffix].join(' '));
  }
  return [...out];
}

// Index : forme normalisée → { level, category }
const ENTRIES = [];
const VOCAB = new Set();
for (const level of ['block', 'flag']) {
  for (const [category, patterns] of Object.entries(LEXICON[level])) {
    for (const p of patterns) {
      for (const form of expand(p)) {
        const words = form.split(' ');
        const strict = words.some((w) => [...STRICT].some((t) => w.startsWith(t)));
        for (const w of words) if (!w.includes('\\')) VOCAB.add(squeeze(w, 1));
        ENTRIES.push({ level, category, strict, regex: form.includes('\\') ? new RegExp(`(?:^| )${words.map((w) => squeeze(w, 1)).join(' ')}(?: |$)`) : null, text: words.map((w) => squeeze(w, strict ? 2 : 1)).join(' ') });
      }
    }
  }
}

// Astérisques : « c*nnard » → le mot du lexique correspondant
function unmask(word) {
  if (!word.includes('*')) return word;
  const re = new RegExp(`^${word.replace(/\*+/g, '[a-z]{0,2}')}$`);
  for (const v of VOCAB) if (re.test(v)) return v;
  return word.replace(/\*/g, '');
}

// Numéro de carte bancaire (contrôle de Luhn)
function hasCardNumber(text) {
  const candidates = String(text || '').match(/(?:\d[ -]?){13,19}/g) || [];
  return candidates.some((c) => {
    const digits = c.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2 === 1) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
    }
    return sum % 10 === 0;
  });
}

// Analyse un texte : { level: 'ok' | 'flag' | 'block', categories: [...] }
function screen(text) {
  const result = { level: 'ok', categories: [] };
  if (!text || typeof text !== 'string') return result;
  const add = (level, category) => {
    if (level === 'block') result.level = 'block';
    else if (result.level === 'ok') result.level = 'flag';
    if (!result.categories.includes(category)) result.categories.push(category);
  };
  if (hasCardNumber(text)) add('block', 'carte');
  const words = tokenize(text).map((w) => (w.includes('*') ? unmask(squeeze(w, 1)) : w));
  const loose = ` ${words.map((w) => squeeze(w, 1)).join(' ')} `;
  const strict = ` ${words.map((w) => squeeze(w, 2)).join(' ')} `;
  for (const e of ENTRIES) {
    if (e.level === 'flag' && result.categories.includes(e.category)) continue;
    const hit = e.regex ? e.regex.test(loose.trim()) : (e.strict ? strict : loose).includes(` ${e.text} `);
    if (hit) add(e.level, e.category);
  }
  // Une catégorie bloquante l'emporte : on ne garde que les motifs de blocage
  if (result.level === 'block') result.categories = result.categories.filter((c) => ['haine', 'menace', 'carte'].includes(c));
  return result;
}

// Analyse plusieurs champs d'un même envoi (texte + légende, etc.)
function screenAll(...texts) {
  return screen(texts.filter(Boolean).join('\n'));
}

const labels = (categories) => categories.map((c) => CATEGORIES[c] || c);

// Message d'erreur adressé à l'auteur d'un contenu refusé
function blockedMessage(categories) {
  if (categories.includes('carte')) {
    return 'Ce texte contient un numéro de carte bancaire : par sécurité, il n’est pas envoyé. Ne partagez jamais vos coordonnées bancaires, même en privé.';
  }
  return `Ce texte ne peut pas être envoyé (${labels(categories).join(', ').toLowerCase()}). Le cercle n’accepte ni propos haineux, ni menaces. Merci de le reformuler.`;
}

module.exports = { screen, screenAll, tokenize, blockedMessage, labels, CATEGORIES };

// ---------------------------------------------------------------------------
// Application dans les routes
// ---------------------------------------------------------------------------

// Contrôle à l'envoi d'une publication, d'un commentaire ou d'un message :
// refuse les propos bloqués ; renvoie les catégories à signaler (« injure,sexuel ») ou null.
function moderate(...texts) {
  const { fail } = require('./http');
  const r = screenAll(...texts);
  if (r.level === 'block') fail(422, blockedMessage(r.categories), 'CONTENT_BLOCKED');
  return r.level === 'flag' ? r.categories.join(',') : null;
}

// Noms, profils, titres d'événement ou de groupe : ni propos bloqués, ni insultes.
function assertClean(field, ...texts) {
  const { fail } = require('./http');
  const r = screenAll(...texts);
  if (r.level === 'block') fail(422, blockedMessage(r.categories), 'CONTENT_BLOCKED');
  if (r.level === 'flag') fail(422, `${field} : ce texte contient des propos injurieux ou déplacés. Merci de le reformuler.`, 'CONTENT_BLOCKED');
}

// Signalement automatique à l'administration (reporter_id = 0 : « Filtre automatique »).
// Sans doublon : un seul signalement ouvert par contenu. Avec flagged vide, le signalement
// automatique ouvert est classé (contenu corrigé par son auteur).
async function autoReport(ctx, type, id, flagged) {
  const open = await ctx.db.get(
    'SELECT id FROM reports WHERE reporter_id = 0 AND target_type = ? AND target_id = ? AND resolved_at IS NULL',
    type, id,
  );
  if (!flagged) {
    if (open) await ctx.db.run('UPDATE reports SET resolved_at = ? WHERE id = ?', Date.now(), open.id);
    return;
  }
  if (open) return;
  await ctx.db.run(
    'INSERT INTO reports (reporter_id, target_type, target_id, reason, created_at) VALUES (0, ?, ?, ?, ?)',
    type, id, `auto: ${labels(flagged.split(',')).join(', ')}`, Date.now(),
  );
  // L'administration est prévenue sur son téléphone (une seule notification visible à la fois)
  const { sendPush } = require('./push');
  const admins = await ctx.db.all('SELECT id FROM users WHERE is_admin = 1');
  for (const a of admins) {
    sendPush(ctx, a.id, {
      title: 'Contenu signalé automatiquement',
      body: `${labels(flagged.split(',')).join(', ')} — à examiner dans l’administration.`,
      url: '/admin',
      tag: 'auto-report',
    }).catch(() => {});
  }
}

module.exports.moderate = moderate;
module.exports.assertClean = assertClean;
module.exports.autoReport = autoReport;
