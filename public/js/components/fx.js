// Effets d'une vidéo : filtre de couleur et textes / autocollants posés par-dessus.
// La vidéo d'origine n'est jamais recompressée : les effets sont appliqués à la lecture,
// à l'identique dans le fil et dans l'éditeur.
import { h } from '../dom.js';

export const FILTERS = [
  { id: '', label: 'Normal', css: '' },
  { id: 'vif', label: 'Vif', css: 'saturate(1.45) contrast(1.08)' },
  { id: 'chaud', label: 'Chaud', css: 'sepia(0.22) saturate(1.35) hue-rotate(-8deg) brightness(1.03)' },
  { id: 'froid', label: 'Froid', css: 'saturate(1.05) hue-rotate(14deg) brightness(1.04) contrast(1.04)' },
  { id: 'noir', label: 'Noir & blanc', css: 'grayscale(1) contrast(1.15)' },
  { id: 'vintage', label: 'Vintage', css: 'sepia(0.45) contrast(0.95) brightness(1.06) saturate(0.9)' },
  { id: 'reve', label: 'Rêve', css: 'brightness(1.1) saturate(1.25) contrast(0.9)' },
  { id: 'neon', label: 'Néon', css: 'saturate(2) contrast(1.2) hue-rotate(18deg)' },
  { id: 'sepia', label: 'Sépia', css: 'sepia(0.85)' },
  { id: 'contraste', label: 'Contraste', css: 'contrast(1.35) saturate(1.1)' },
  { id: 'pastel', label: 'Pastel', css: 'saturate(0.7) brightness(1.12) contrast(0.92)' },
  { id: 'nuit', label: 'Nuit', css: 'brightness(0.82) contrast(1.25) saturate(0.75)' },
  { id: 'doux', label: 'Doux', css: 'contrast(0.92) brightness(1.06) saturate(1.06)' },
];
export const filterCss = (id) => FILTERS.find((f) => f.id === id)?.css || '';

export const TEXT_COLORS = ['#ffffff', '#000000', '#ff2d55', '#ffc83d', '#00d1a0', '#3ea6ff', '#6c4dff', '#ff7a1a'];
export const STICKERS = ['😂', '😍', '🔥', '💯', '✨', '🎉', '👀', '🥺', '😎', '💖', '👍', '🙏', '🤯', '🥳', '😭', '💪', '🎵', '🌈', '⭐', '🍕', '☕', '🐶', '🐱', '🚀', '❤️', '😅', '🤩', '👑', '🌸', '⚡'];

// Couche d'effets : placée exactement sur l'image de la vidéo (rapport largeur / hauteur ar)
export function fxLayer(fx, { ar = 9 / 16, fit = 'contain', editable = false } = {}) {
  const layer = h('div', { class: `fx-layer fit-${fit}`, style: { '--ar': String(ar) } });
  paintOverlays(layer, fx, { editable });
  return layer;
}

export function overlayEl(o, { editable = false } = {}) {
  const style = { left: `${o.x * 100}%`, top: `${o.y * 100}%`, '--rot': `${o.rot || 0}deg`, '--size': String(o.size) };
  if (o.kind === 'sticker') return h('span', { class: `fx-item fx-sticker${editable ? ' editable' : ''}`, style }, o.emoji);
  return h(
    'span',
    { class: `fx-item fx-text fx-${o.style || 'plain'}${editable ? ' editable' : ''}`, style: { ...style, '--c': o.color || '#ffffff', '--bgc': o.style === 'box' ? (o.color === '#ffffff' ? '#000000cc' : '#ffffffee') : 'transparent' } },
    o.text,
  );
}

export function paintOverlays(layer, fx, { editable = false } = {}) {
  layer.replaceChildren(...(fx?.overlays || []).map((o) => overlayEl(o, { editable })));
}

// Ajustement : remplir l'écran si l'image a presque la même forme que lui, sinon l'afficher entière
export function fitFor(ar, box = { w: innerWidth, h: innerHeight }) {
  if (!ar) return 'contain';
  const screen = box.w / box.h;
  return Math.abs(ar - screen) / screen < 0.14 ? 'cover' : 'contain';
}
