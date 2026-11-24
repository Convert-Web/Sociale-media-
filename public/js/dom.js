// Utilitaires d'interface : création d'éléments sûre (jamais d'innerHTML avec des données membres),
// formatage, composants génériques (avatar, toast, modale, menu, visionneuse).
import { iconSvg } from './icons.js';

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'multiple', 'readOnly', 'required', 'autofocus']);

// Filet de sécurité : append(), replaceChildren()… ignorent les valeurs vides (null, undefined,
// false, true) au lieu d'afficher le mot « null » à l'écran.
const blank = (n) => n === null || n === undefined || n === false || n === true;
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['append', 'prepend', 'replaceChildren', 'before', 'after']) {
    const native = proto[m];
    if (typeof native !== 'function') continue;
    proto[m] = function (...nodes) {
      return native.apply(this, nodes.some(blank) ? nodes.filter((n) => !blank(n)) : nodes);
    };
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, val);
          else el.style[prop] = val;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'ref') v(el);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

// Typographie française : espace fine insécable avant « ; : ? ! » et après « « », pour qu'aucun
// signe ne reste seul en début ou en fin de ligne (tous les textes ajoutés par h()/append())
export const frenchSpaces = (s) => (/[ «]/.test(s) ? s.replace(/ ([?!;:»])/g, '\u202f$1').replace(/« /g, '«\u202f') : s);

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(typeof c === 'string' ? frenchSpaces(c) : String(c)));
  }
  return el;
}

// Couleur de la barre du navigateur : celle du fond des pages (claire ou sombre), noire sur le fil
export function syncThemeColor() {
  if (document.documentElement.classList.contains('feed-mode')) return;
  const t = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = t === 'dark' ? '#0e0e13' : '#ffffff';
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  span.innerHTML = iconSvg(name); // contenu statique de confiance
  return span;
}

// ---------------------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------------------
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dateFmtY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const fullFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

// Dates relatives, toujours au même format court : « à l’instant », « 5 min », « 3 h », « 2 j »,
// « 3 sem. », puis la date (« 12 nov. », « 12 nov. 2024 »)
export function timeAgo(ts) {
  const diff = Math.max(0, (Date.now() - ts) / 1000);
  if (diff < 45) return 'à l’instant';
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} j`;
  if (diff < 28 * 86400) return `${Math.floor(diff / (7 * 86400))} sem.`;
  const d = new Date(ts);
  return d.getFullYear() === new Date().getFullYear() ? dateFmt.format(d) : dateFmtY.format(d);
}
// « de Paul », « d’Alice » (élision devant une voyelle ou un h)
export const deName = (name) => (/^[aeiouyhàâäéèêëîïôöùûüœæ]/i.test(String(name || '').trim()) ? `d’${name}` : `de ${name}`);
export const fullDate = (ts) => fullFmt.format(new Date(ts));
export const clock = (ts) => timeFmt.format(new Date(ts));
export const monthYear = (ts) => monthFmt.format(new Date(ts));
export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return 'Hier';
  return dateFmtY.format(d);
}

export function money(cents, currency = 'eur') {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}
export const num = (n) => new Intl.NumberFormat('fr-FR').format(n);
// Compteurs façon réseau social : 987 · 1,2 k · 34 k · 1,5 M
const shortFmt1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const shortFmt0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
// « 999 », « 1,2 k », « 12,5 k », « 135 k », « 1 M » (jamais « 1 000 k »)
export function short(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  const steps = [[1e3, 'k'], [1e6, 'M'], [1e9, 'Md']];
  for (let i = 0; i < steps.length; i++) {
    const v = n / steps[i][0];
    const r = v < 100 ? Math.round(v * 10) / 10 : Math.round(v);
    if (r < 1000 || i === steps.length - 1) return `${(r < 100 ? shortFmt1 : shortFmt0).format(r)}\u202f${steps[i][1]}`;
  }
  return String(n);
}
export const duration = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function plural(n, one, many) {
  return `${num(n)} ${n > 1 ? many : one}`;
}
// « 0 vue », « 1 vue », « 12 vues », « 1,2 k vues »
export function count(n, one, many = `${one}s`) {
  return `${short(n)} ${Number(n) >= 2 ? many : one}`;
}

// ---------------------------------------------------------------------------
// Texte enrichi : liens, @mentions et #hashtags, sans HTML injecté
// ---------------------------------------------------------------------------
// Sans « lookbehind » (non reconnu par Safari avant iOS 16.4) : le caractère qui précède une
// @mention ou un #sujet est vérifié à la main.
const TOKEN_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|@([a-z0-9_][a-z0-9_.]{1,18}[a-z0-9_])|#([\p{L}\p{N}_]{2,40})/giu;
const WORD = /[\p{L}\p{N}_]/u;

// Typographie française : espace insécable fine avant ? ! ; : » et après «

export function richText(str) {
  const frag = document.createDocumentFragment();
  let last = 0;
  const text = (s) => frag.append(frenchSpaces(s));
  for (const m of str.matchAll(TOKEN_RE)) {
    const before = m.index > 0 ? str[m.index - 1] : '';
    // Une @ ou un # collé à un mot (adresse e-mail, « C# », « &#… ») reste du texte
    if ((m[2] && (WORD.test(before) || before === '@' || before === '.')) || (m[3] && (WORD.test(before) || before === '&' || before === '#'))) continue;
    if (m.index > last) text(str.slice(last, m.index));
    if (m[1]) {
      const internal = m[1].startsWith(`${location.origin}/`);
      frag.append(
        internal
          ? h('a', { href: m[1].slice(location.origin.length) }, m[1].slice(location.origin.length))
          : h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer nofollow' }, m[1].replace(/^https?:\/\/(www\.)?/, '')),
      );
    } else if (m[2]) {
      frag.append(h('a', { href: `/@${m[2]}`, class: 'mention-link' }, `@${m[2]}`));
    } else if (m[3]) {
      frag.append(h('a', { href: `/tag/${encodeURIComponent(m[3].toLocaleLowerCase('fr'))}`, class: 'tag-link' }, `#${m[3]}`));
    }
    last = m.index + m[0].length;
  }
  if (last < str.length) text(str.slice(last));
  return frag;
}

// ---------------------------------------------------------------------------
// Avatars & identité
// ---------------------------------------------------------------------------
function hash(str) {
  let x = 0;
  for (const ch of str) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return x;
}
export function initials(name = '') {
  // Par caractères entiers (un émoji ou une lettre accentuée composée ne sont jamais coupés en deux)
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const first = (w) => [...w][0] || '';
  const letters = parts.length > 1 ? first(parts[0]) + first(parts[parts.length - 1]) : [...(parts[0] || '?')].slice(0, 2).join('');
  return letters.toUpperCase();
}

export function avatar(user, size = '', { presence = false, live = false } = {}) {
  const cls = ['avatar', size && `avatar-${size}`, live && user?.live ? 'avatar-live' : ''].filter(Boolean).join(' ');
  const el = h('span', { class: cls });
  const hue = hash(user?.username || 'x') % 360;
  const letters = () => h('span', { class: 'avatar-initials', style: { '--h': String(hue) } }, initials(user?.displayName));
  if (user?.avatar) {
    // Image introuvable (ancienne adresse, fichier retiré) : les initiales, jamais une image cassée
    const img = h('img', { src: user.avatar, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.replaceWith(letters()), { once: true });
    el.append(img);
  } else {
    el.append(letters());
  }
  if (presence && user?.online) el.append(h('span', { class: 'presence', title: 'En ligne' }));
  if (live && user?.live) el.append(h('span', { class: 'live-chip' }, 'LIVE'));
  return el;
}

// Badge « Compte vérifié » (attribué par l'administration)
export function verifiedMark() {
  return h('span', { class: 'verified', title: 'Compte vérifié', 'aria-label': 'Compte vérifié' }, icon('verified'));
}

export function nameLine(user, { link = true } = {}) {
  const parts = [
    h('b', null, user.displayName),
    user.verified ? verifiedMark() : null,
  ];
  return link
    ? h('a', { href: `/@${user.username}`, class: 'name-line' }, parts)
    : h('span', { class: 'name-line' }, parts);
}

// Toucher simple (action habituelle) et double-toucher (aimer), comme sur les grands réseaux.
// Le toucher simple attend un court instant pour ne pas se confondre avec le double.
// Touchers sur une zone (vidéo, photo) : simple ou double. Les touchers sur un bouton ou un lien
// de la zone sont ignorés dès le toucher (le bouton peut être redessiné entre-temps : J'aime).
const CONTROLS = 'a, button, input, textarea, select, label, [role="button"], .no-taps';
export function onTaps(el, { single, double, ignore = CONTROLS }) {
  let timer = null;
  let last = 0;
  el.addEventListener('click', (e) => {
    const ctl = ignore && e.target instanceof Element ? e.target.closest(ignore) : null;
    if (ctl && ctl !== el && el.contains(ctl)) return;
    const now = Date.now();
    if (double && now - last < 300) {
      clearTimeout(timer);
      last = 0;
      double(e);
      return;
    }
    last = now;
    if (!single) return;
    if (!double) return single(e);
    timer = setTimeout(() => single(e), 260);
  });
}

// Cœur qui éclate à l'endroit touché
export function heartBurst(host, e) {
  const r = host.getBoundingClientRect();
  const x = e && e.clientX ? e.clientX - r.left : r.width / 2;
  const y = e && e.clientY ? e.clientY - r.top : r.height / 2;
  const el = h('span', { class: 'heart-burst', style: { left: `${x}px`, top: `${y}px` } }, icon('heart-fill'));
  host.append(el);
  setTimeout(() => el.remove(), 1000);
}

// Partager un lien : feuille de partage du téléphone, sinon copie du lien
export async function shareLink(title, path, { native = true } = {}) {
  const url = `${location.origin}${path}`;
  if (native && navigator.share) {
    try {
      await navigator.share({ title, url });
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Lien copié');
  } catch {
    toast(url);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Composants génériques
// ---------------------------------------------------------------------------
export function toast(message, type = 'ok') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h('div', { class: `toast ${type}`, role: 'status' }, type === 'error' ? icon('alert') : null, message);
  host.append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

export function spinner() {
  return h('div', { class: 'loader' }, h('div', { class: 'spinner' }));
}

export function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, h('span', { class: 'empty-icon' }, icon(iconName)), h('h3', null, title), text ? h('p', null, text) : null, action || null);
}

// Fenêtres : une à la fois, sauf « stack » (une fenêtre ouverte par-dessus une autre, ex. le
// recadrage d'une photo depuis « Modifier le profil » : la première reste ouverte dessous)
const openModals = [];
function dropModal(el) {
  const i = openModals.indexOf(el);
  if (i < 0) return;
  openModals.splice(i, 1);
  el.remove();
  if (!openModals.length) document.body.style.overflow = '';
  el._onClose?.();
}
export function modal(title, body, { onClose, stack = false } = {}) {
  if (!stack) closeModals();
  let backdrop = null;
  const close = () => dropModal(backdrop);
  backdrop = h(
    'div',
    {
      class: `modal-backdrop${stack && openModals.length ? ' stacked' : ''}`,
      onmousedown: (e) => {
        if (e.target === backdrop) close();
      },
    },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Fermer', onclick: close }, icon('x'))),
      body,
    ),
  );
  backdrop._onClose = onClose;
  // Ouverte depuis une feuille (commentaires, brouillons…) : affichée par-dessus, et non derrière
  if (document.querySelector('.sheet-backdrop')) backdrop.classList.add('over-sheet');
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  openModals.push(backdrop);
  const focusable = backdrop.querySelector('textarea, input, select');
  if (focusable && window.matchMedia('(min-width: 721px)').matches) setTimeout(() => focusable.focus(), 50);
  return { close, el: backdrop };
}
export const modalOpen = () => openModals.length > 0;
// La fenêtre du dessus (Échap, bouton Fermer)
export function closeModal() {
  if (openModals.length) dropModal(openModals[openModals.length - 1]);
}
// Toutes les fenêtres (changement de page)
export function closeModals() {
  while (openModals.length) dropModal(openModals[openModals.length - 1]);
}

// Visionneuse : ouverture zoomée, fermeture d'un geste vers le bas (comme Photos sur iPhone), Échap ou toucher.
export function lightbox(src) {
  const img = h('img', { src, alt: 'Photo agrandie', draggable: 'false' });
  const box = h('div', { class: 'lightbox', role: 'dialog', 'aria-label': 'Photo' }, img, h('button', { class: 'lightbox-close', 'aria-label': 'Fermer' }, icon('x')));
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    document.removeEventListener('keydown', onKey);
    box.classList.add('closing');
    setTimeout(() => box.remove(), 220);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  let startY = null;
  let dy = 0;
  box.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    dy = 0;
    img.style.transition = 'none';
  });
  box.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    dy = e.clientY - startY;
    const d = Math.max(0, dy);
    img.style.transform = `translateY(${dy}px) scale(${Math.max(0.8, 1 - d / 1600)})`;
    box.style.setProperty('--dim', String(Math.max(0.25, 1 - Math.abs(dy) / 420)));
  });
  const end = () => {
    if (startY === null) return;
    startY = null;
    img.style.transition = '';
    if (Math.abs(dy) > 90 || Math.abs(dy) < 6) return close();
    img.style.transform = '';
    box.style.removeProperty('--dim');
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  document.body.append(box);
}

// Squelettes de chargement : grille de vidéos
export function skeletonGrid(n = 9) {
  return h('div', { class: 'grid', 'aria-hidden': 'true' }, Array.from({ length: n }, () => h('div', { class: 'tile sk' })));
}

// Squelettes de chargement (plus élégants qu'une roue)
export function skeletonPosts(n = 3) {
  return h(
    'div',
    { class: 'skeletons', 'aria-hidden': 'true' },
    Array.from({ length: n }, (_, i) =>
      h(
        'div',
        { class: 'sk-card' },
        h('i', { class: 'sk sk-avatar' }),
        h('div', { class: 'sk-main' }, h('i', { class: 'sk', style: { width: '42%' } }), h('i', { class: 'sk', style: { width: '92%' } }), h('i', { class: 'sk', style: { width: i % 2 ? '64%' : '78%' } }), i === 0 ? h('i', { class: 'sk sk-media' }) : null),
      ),
    ),
  );
}

let openMenu = null;
export function popMenu(anchor, items) {
  closeMenu();
  const menu = h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((it) =>
      h(
        'button',
        {
          class: it.danger ? 'danger' : '',
          role: 'menuitem',
          onclick: () => {
            closeMenu();
            it.action();
          },
        },
        icon(it.icon),
        it.label,
      ),
    ),
  );
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  menu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 10)}px`;
  menu.style.left = `${Math.max(10, Math.min(r.right - mw, window.innerWidth - mw - 10))}px`;
  openMenu = menu;
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}
export function closeMenu() {
  openMenu?.remove();
  openMenu = null;
}

export async function confirmDialog(title, text, confirmLabel = 'Confirmer', danger = true) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => {
      if (answered) return;
      answered = true;
      m.close();
      resolve(v);
    };
    const m = modal(
      title,
      h(
        'div',
        { class: 'modal-body', style: { display: 'grid', gap: '20px' } },
        h('p', { class: 'text-2' }, text),
        h(
          'div',
          { class: 'row-end' },
          h('button', { class: 'btn btn-ghost', onclick: () => done(false) }, 'Annuler'),
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => done(true) }, confirmLabel),
        ),
      ),
      { onClose: () => done(false) },
    );
  });
}

export function autosize(textarea) {
  const fit = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

// Défilement infini : appelle loadMore quand la sentinelle devient visible.
// Cadre qui défile (zone principale de l'application, ou toute la page) : repère des listes
// infinies, pour charger la suite un peu avant d'arriver en bas
export const scrollRoot = () => document.querySelector('.shell > .main') || document.getElementById('app');

export function infinite(sentinel, loadMore) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    { root: scrollRoot(), rootMargin: '600px 0px' },
  );
  io.observe(sentinel);
  return () => io.disconnect();
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Réduit une photo dans le navigateur avant l'envoi (une photo de téléphone
// de 4 Mo devient ~300 Ko). Les GIF animés sont envoyés tels quels.
export async function shrinkImage(file, maxDim = 1600, quality = 0.85) {
  if (!file || file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 900 * 1024) {
    bitmap.close?.();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
}

export const TOO_BIG_GIF = 4 * 1024 * 1024;

// Logo : un « V » qui joue, dans un carré aux couleurs de Vibz (un dégradé propre à chaque logo :
// un dégradé défini dans un élément masqué ne s'afficherait pas ailleurs)
let logoSeq = 0;
export function logoMark(size = 40) {
  const el = h('span', { class: 'logo-mark', style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' });
  const id = `vz${++logoSeq}`;
  el.innerHTML = `<svg viewBox="0 0 48 48"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7b5cff"/><stop offset="1" stop-color="#ff3d7f"/></linearGradient></defs><rect width="48" height="48" rx="13" fill="url(#${id})"/><path d="M13 14.5 22.6 34a1.6 1.6 0 0 0 2.9 0L35 14.5" fill="none" stroke="#fff" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="35" cy="14.5" r="3.4" fill="#ffd84d"/></svg>`;
  return el;
}
