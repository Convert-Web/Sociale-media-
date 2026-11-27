'use strict';
// Images d'aperçu des liens partagés (1200 × 630, JPEG) : ce que montrent WhatsApp, iMessage,
// Snapchat, Instagram, Messenger ou X quand on y colle un lien AURUM. Fond noir, dégradé
// violet → rose → or de l'appli, et le contenu du lien : image de la vidéo, nom, légende, sujet…
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage, GlobalFonts, Path2D } = require('@napi-rs/canvas');

const W = 1200;
const H = 630;
const INK = '#0B0A10';
const TILE = '#16141E';
const WHITE = '#FFFFFF';
const SOFT = '#E6E2F0';
const MUTED = '#A69FBA';
const GOLD = '#FFD84D';
const LIVE = '#FF2E63';

// Polices : Bricolage Grotesque (titres), Inter (textes), et de quoi écrire les noms dans d'autres
// alphabets (accents d'Europe de l'Est, vietnamien, cyrillique, grec, arabe). Chaque fichier est
// cité en entier : l'hébergeur n'embarque que les fichiers nommés dans le code.
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  fontsReady = true;
  const add = (file, family) => GlobalFonts.register(fs.readFileSync(file), family);
  add(path.join(__dirname, 'assets/fonts/bricolage-800.woff2'), 'Bricolage');
  add(path.join(__dirname, 'assets/fonts/inter-latin-500.woff2'), 'Inter');
  add(path.join(__dirname, 'assets/fonts/inter-latin-700.woff2'), 'Inter');
  add(path.join(__dirname, 'assets/fonts/inter-latin-ext-500.woff2'), 'InterX');
  add(path.join(__dirname, 'assets/fonts/inter-latin-ext-700.woff2'), 'InterX');
  add(path.join(__dirname, 'assets/fonts/inter-vietnamese-500.woff2'), 'InterV');
  add(path.join(__dirname, 'assets/fonts/inter-vietnamese-700.woff2'), 'InterV');
  add(path.join(__dirname, 'assets/fonts/inter-cyrillic-500.woff2'), 'InterC');
  add(path.join(__dirname, 'assets/fonts/inter-cyrillic-700.woff2'), 'InterC');
  add(path.join(__dirname, 'assets/fonts/inter-greek-500.woff2'), 'InterG');
  add(path.join(__dirname, 'assets/fonts/inter-greek-700.woff2'), 'InterG');
  add(path.join(__dirname, 'assets/fonts/noto-sans-arabic-500.woff2'), 'NotoArabic');
  add(path.join(__dirname, 'assets/fonts/noto-sans-arabic-700.woff2'), 'NotoArabic');
}
const FALLBACK = 'InterX, InterV, InterC, InterG, NotoArabic';
const text = (weight, size) => `${weight} ${size}px Inter, ${FALLBACK}`;
const title = (size) => `800 ${size}px Bricolage, ${FALLBACK}`;

// Émojis et drapeaux retirés de ce qui est dessiné (aucune police d'émojis chez l'hébergeur) ;
// ils restent dans le titre et la description du lien, affichés par la messagerie elle-même
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;
// Typographie française : « ? », « ! », « : », « ; » et les guillemets ne partent jamais seuls à la ligne
const clean = (s) => String(s || '').replace(EMOJI, '').replace(/\s+/g, ' ').trim()
  .replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');

// Découpe en lignes (mots entiers ; un mot trop long est coupé), « … » si le texte dépasse
function lines(g, str, max, maxLines) {
  const out = [];
  let cur = '';
  for (let word of clean(str).split(' ')) {
    if (!word) continue;
    const test = cur ? `${cur} ${word}` : word;
    if (g.measureText(test).width <= max) {
      cur = test;
      continue;
    }
    if (cur) out.push(cur);
    cur = '';
    let chars = [...word];
    while (g.measureText(word).width > max && chars.length > 1) {
      let k = chars.length - 1;
      while (k > 1 && g.measureText(chars.slice(0, k).join('')).width > max) k--;
      out.push(chars.slice(0, k).join(''));
      chars = chars.slice(k);
      word = chars.join('');
    }
    cur = word;
    if (out.length > maxLines) break;
  }
  if (cur) out.push(cur);
  if (out.length <= maxLines) return out;
  const kept = out.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && g.measureText(`${last}…`).width > max) last = [...last].slice(0, -1).join('');
  kept[maxLines - 1] = `${last.replace(/[\s,.;:!?«»"'’-]+$/u, '')}…`;
  return kept;
}

// Titre à la plus grande taille qui tienne (sinon la plus petite, avec « … »)
function fit(g, str, max, maxLines, from, to, font = title) {
  for (let size = from; size >= to; size -= 2) {
    g.font = font(size);
    const ls = lines(g, str, max, maxLines + 1);
    if (ls.length <= maxLines && !ls[ls.length - 1]?.endsWith('…')) return { size, lines: ls };
  }
  g.font = font(to);
  return { size: to, lines: lines(g, str, max, maxLines) };
}

function drawLines(g, ls, x, top, size, lineHeight, color) {
  g.fillStyle = color;
  ls.forEach((l, i) => g.fillText(l, x, top + size * 0.92 + i * lineHeight));
  return top + ls.length * lineHeight;
}

// Dégradés de l'appli : celui des boutons (violet → rose) et celui du logo (violet → rose → or)
function gradient(g, x0, y0, x1, y1, kind = 'app') {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  const stops = kind === 'logo' ? [[0, '#7B5CFF'], [0.6, '#FF3D7F'], [1, '#FFD84D']] : [[0, '#7B5CFF'], [0.5, '#B14DFF'], [1, '#FF3D7F']];
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}
// Fonds des publications texte (mêmes couleurs que dans l'appli)
const BG = {
  violet: ['#6c4dff', '#2a1a80'],
  rose: ['#ff5f9e', '#b0205f'],
  ocean: ['#1fb5ff', '#1240a8'],
  soleil: ['#ffcf3d', '#ff7a1a'],
  menthe: ['#3ee6b4', '#0a7d6a'],
  nuit: ['#2b2b3a', '#07070c'],
  feu: ['#ff4d4d', '#8f0f2a'],
  ciel: ['#a5c8ff', '#6f7bff'],
};

// « Au », la petite version du logo (même tracé que dans l'appli)
const AU = new Path2D('M2.2 0 126 -369.6H243.6L366.8 0H268.8L185.9 -296.2H182.6L99.1 0ZM72.2 -65.5V-129.4H308V-65.5Z M465 7.8Q416.9 7.8 393.6 -25.8Q370.4 -59.4 370.4 -128.8V-295.7H461.1V-129.9Q461.1 -97.4 470.4 -84.6Q479.6 -71.7 497 -71.7Q509.3 -71.7 519.6 -78.1Q530 -84.6 537.8 -97.7Q545.7 -110.9 549.9 -131.6Q554.1 -152.3 554.1 -181.4V-295.7H644.8V-133.3V0H567.5V-115.4H563.6Q560.2 -72.2 548.5 -45.1Q536.7 -17.9 516 -5Q495.3 7.8 465 7.8Z');
function logo(g, x, y, size, { back = TILE } = {}) {
  g.save();
  g.translate(x, y);
  g.scale(size / 1024, size / 1024);
  g.fillStyle = back;
  g.beginPath();
  g.roundRect(0, 0, 1024, 1024, 230);
  g.fill();
  g.translate(188.5, 700.9);
  g.fillStyle = gradient(g, 2, -370, 645, 8, 'logo');
  g.fill(AU);
  g.restore();
}
function brand(g, x, y) {
  logo(g, x, y, 56);
  g.font = title(32);
  g.fillStyle = WHITE;
  g.fillText('AURUM', x + 72, y + 40);
}

// Bouton dessiné (dégradé de l'appli), avec une petite icône
function pill(g, x, y, label, icon = null) {
  g.font = text(700, 30);
  const tw = g.measureText(label).width;
  const iw = icon ? 34 : 0;
  const w = Math.round(tw + iw + 76);
  const h = 76;
  g.fillStyle = gradient(g, x, y, x + w, y + h);
  g.beginPath();
  g.roundRect(x, y, w, h, h / 2);
  g.fill();
  g.fillStyle = WHITE;
  if (icon === 'play') {
    g.beginPath();
    g.moveTo(x + 38, y + 25);
    g.lineTo(x + 38, y + 51);
    g.lineTo(x + 60, y + 38);
    g.closePath();
    g.fill();
  } else if (icon === 'plus') {
    g.fillRect(x + 37, y + 35, 22, 6);
    g.fillRect(x + 45, y + 27, 6, 22);
  }
  g.fillText(label, x + 38 + iw, y + 49);
  return w;
}

function cover(g, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

// Photo de profil ronde, ou initiales sur un dégradé propre au compte (comme dans l'appli)
function hue(str) {
  let x = 0;
  for (const ch of String(str || 'x')) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return x % 360;
}
function initials(name) {
  const parts = clean(name).split(' ').filter(Boolean);
  const first = (w) => [...w][0] || '';
  const s = parts.length > 1 ? first(parts[0]) + first(parts[parts.length - 1]) : [...(parts[0] || '?')].slice(0, 2).join('');
  return s.toUpperCase();
}
function avatar(g, img, cx, cy, r, { name, username }) {
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  if (img) {
    cover(g, img, cx - r, cy - r, r * 2, r * 2);
  } else {
    const h = hue(username);
    const gr = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    gr.addColorStop(0, `hsl(${h}, 72%, 58%)`);
    gr.addColorStop(1, `hsl(${(h + 40) % 360}, 76%, 48%)`);
    g.fillStyle = gr;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.font = text(700, Math.round(r * 0.78));
    g.fillStyle = WHITE;
    g.textAlign = 'center';
    g.fillText(initials(name), cx, cy + r * 0.28);
    g.textAlign = 'left';
  }
  g.restore();
}

async function image(buf) {
  if (!buf) return null;
  try {
    return await loadImage(buf);
  } catch {
    return null;
  }
}

// ── Les quatre mises en page ─────────────────────────────────────────────────────────────────

// Publication : l'image de la vidéo (ou la photo, ou le texte sur son fond) à gauche, et à droite
// l'auteur, le sujet du jour éventuel, la légende et « Regarder sur AURUM »
async function postCard(g, s) {
  const mx = 72;
  const my = 40;
  const mw = 310;
  const mh = 550;
  const media = await image(s.media);
  g.save();
  g.beginPath();
  g.roundRect(mx, my, mw, mh, 32);
  g.clip();
  if (media) {
    cover(g, media, mx, my, mw, mh);
  } else if (s.textPost) {
    const [c0, c1] = BG[s.textPost.bg] || BG.violet;
    const gr = g.createLinearGradient(mx + mw * 0.33, my, mx + mw * 0.67, my + mh);
    gr.addColorStop(0, c0);
    gr.addColorStop(1, c1);
    g.fillStyle = gr;
    g.fillRect(mx, my, mw, mh);
    g.textAlign = 'center';
    const t = fit(g, s.textPost.text, mw - 56, 7, 40, 24, (size) => text(700, size));
    const lh = Math.round(t.size * 1.25);
    const top = my + (mh - t.lines.length * lh) / 2;
    drawLines(g, t.lines.map((l) => l), mx + mw / 2, top, t.size, lh, s.textPost.bg === 'soleil' ? '#2A1300' : WHITE);
    g.textAlign = 'left';
  } else {
    g.fillStyle = gradient(g, mx, my, mx + mw, my + mh, 'logo');
    g.fillRect(mx, my, mw, mh);
    logo(g, mx + mw / 2 - 70, my + mh / 2 - 70, 140, { back: 'rgba(11,10,16,0.88)' });
  }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.1)';
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(mx + 1, my + 1, mw - 2, mh - 2, 31);
  g.stroke();
  if (s.video && (media || !s.textPost)) {
    const cx = mx + mw / 2;
    const cy = my + mh / 2;
    g.fillStyle = 'rgba(11,10,16,0.55)';
    g.beginPath();
    g.arc(cx, cy, 46, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = WHITE;
    g.beginPath();
    g.moveTo(cx - 13, cy - 21);
    g.lineTo(cx - 13, cy + 21);
    g.lineTo(cx + 23, cy);
    g.closePath();
    g.fill();
  }

  const x = 450;
  const col = W - x - 72;
  brand(g, x, 52);
  const face = await image(s.avatar);
  avatar(g, face, x + 36, 176, 36, s.author);
  g.font = text(700, 38);
  g.fillStyle = WHITE;
  g.fillText(lines(g, s.author.name, col - 92, 1)[0] || '', x + 92, 170);
  g.font = text(500, 26);
  g.fillStyle = MUTED;
  g.fillText(lines(g, `@${s.author.username}`, col - 92, 1)[0], x + 92, 206);

  const ctaTop = 506;
  let y = 250;
  if (s.label) {
    g.font = text(700, 26);
    y = drawLines(g, lines(g, s.label, col, 2), x, y, 26, 36, GOLD) + 12;
  }
  const statsH = s.stats ? 42 : 0;
  g.font = text(500, 32);
  const room = Math.max(1, Math.floor((ctaTop - 22 - statsH - y) / 44));
  if (s.caption) drawLines(g, lines(g, s.caption, col, Math.min(room, 4)), x, y, 32, 44, SOFT);
  if (s.stats) {
    g.font = text(500, 26);
    g.fillStyle = MUTED;
    g.fillText(s.stats, x, ctaTop - 26);
  }
  pill(g, x, ctaTop, s.cta, s.video ? 'play' : null);
}

// Personne (invitation, profil, LIVE) : grande photo de profil cerclée du dégradé du logo
async function personCard(g, s) {
  const cx = 72 + 176;
  const cy = 315;
  g.fillStyle = gradient(g, cx - 176, cy - 176, cx + 176, cy + 176, 'logo');
  g.beginPath();
  g.arc(cx, cy, 176, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(cx, cy, 166, 0, Math.PI * 2);
  g.fill();
  avatar(g, await image(s.avatar), cx, cy, 156, s.author);
  if (s.live) {
    g.fillStyle = INK;
    g.beginPath();
    g.roundRect(cx - 64, cy + 150, 128, 58, 29);
    g.fill();
    g.fillStyle = LIVE;
    g.beginPath();
    g.roundRect(cx - 57, cy + 157, 114, 44, 22);
    g.fill();
    g.font = text(700, 24);
    g.fillStyle = WHITE;
    g.textAlign = 'center';
    g.fillText('LIVE', cx, cy + 188);
    g.textAlign = 'left';
  }
  const x = 490;
  const col = W - x - 72;
  brand(g, x, 52);
  const t = fit(g, s.title, col, 3, 66, 44);
  let y = drawLines(g, t.lines, x, 150, t.size, Math.round(t.size * 1.08), WHITE) + 18;
  if (s.subtitle) {
    g.font = text(500, 30);
    y = drawLines(g, lines(g, s.subtitle, col, 2), x, y, 30, 40, SOFT) + 10;
  }
  if (s.about) {
    g.font = text(500, 26);
    const room = Math.max(0, Math.floor((480 - y) / 36));
    if (room) drawLines(g, lines(g, s.about, col, Math.min(2, room)), x, y, 26, 36, MUTED);
  }
  pill(g, x, 506, s.cta, s.ctaIcon || null);
}

// Sujet du jour : la question en grand
async function subjectCard(g, s) {
  const x = 72;
  const col = W - 2 * x;
  brand(g, x, 52);
  if (s.date) {
    g.font = text(500, 26);
    g.fillStyle = MUTED;
    g.textAlign = 'right';
    g.fillText(s.date, W - x, 90);
    g.textAlign = 'left';
  }
  g.font = text(700, 26);
  g.letterSpacing = '4px';
  g.fillStyle = GOLD;
  g.fillText(s.label, x, 178);
  g.letterSpacing = '0px';
  const t = fit(g, s.title, col, 3, 96, 46);
  let y = drawLines(g, t.lines, x, 200, t.size, Math.round(t.size * 1.08), WHITE) + 10;
  if (s.sponsor) {
    g.font = text(500, 26);
    if (y + 36 < 490) drawLines(g, lines(g, s.sponsor, col, 1), x, y, 26, 36, SOFT);
  }
  const w = pill(g, x, 506, s.cta, s.ctaIcon || null);
  if (s.stats) {
    g.font = text(500, 28);
    g.fillStyle = MUTED;
    g.fillText(lines(g, s.stats, col - w - 32, 1)[0], x + w + 32, 554);
  }
}

// Actu, hashtag, son : une étiquette, un grand titre, une ligne
async function textCard(g, s) {
  const x = 72;
  const col = W - 2 * x;
  brand(g, x, 52);
  g.font = text(700, 26);
  g.letterSpacing = '4px';
  g.fillStyle = GOLD;
  g.fillText(s.label, x, 178);
  g.letterSpacing = '0px';
  const t = fit(g, s.title, col, 3, 76, 44);
  const y = drawLines(g, t.lines, x, 200, t.size, Math.round(t.size * 1.1), WHITE) + 12;
  if (s.subtitle && y + 36 < 490) {
    g.font = text(500, 28);
    drawLines(g, lines(g, s.subtitle, col, 1), x, y, 28, 38, MUTED);
  }
  pill(g, x, 506, s.cta, s.ctaIcon || null);
}

const LAYOUTS = { post: postCard, person: personCard, subject: subjectCard, text: textCard };

// Une carte → JPEG (moins de 300 Ko : au-delà, WhatsApp n'affiche pas toujours l'image)
async function renderCard(spec) {
  registerFonts();
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  await LAYOUTS[spec.layout](g, spec);
  let out = await canvas.encode('jpeg', 88);
  if (out.length > 280 * 1024) out = await canvas.encode('jpeg', 78);
  return out;
}

module.exports = { renderCard, clean, W, H };
