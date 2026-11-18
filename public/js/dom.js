// Utilitaires d'interface : création d'éléments sûre (jamais d'innerHTML avec des données membres),
// formatage, composants génériques (avatar, toast, modale, menu, visionneuse).
import { iconSvg } from './icons.js';

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'multiple', 'readOnly', 'required', 'autofocus']);

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

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
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
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dateFmtY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const fullFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

export function timeAgo(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 45) return "à l'instant";
  if (diff < 3600) return `${Math.round(diff / 60)} min`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h`;
  if (diff < 7 * 86400) return rtf.format(-Math.round(diff / 86400), 'day');
  const d = new Date(ts);
  return d.getFullYear() === new Date().getFullYear() ? dateFmt.format(d) : dateFmtY.format(d);
}
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
export const memberNo = (n) => (n ? `N° ${String(n).padStart(4, '0')}` : 'N° ····');

export function plural(n, one, many) {
  return `${num(n)} ${n > 1 ? many : one}`;
}

// ---------------------------------------------------------------------------
// Texte enrichi : liens, @mentions et #hashtags, sans HTML injecté
// ---------------------------------------------------------------------------
// Sans « lookbehind » (non reconnu par Safari avant iOS 16.4) : le caractère qui précède une
// @mention ou un #sujet est vérifié à la main.
const TOKEN_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|@([a-z0-9_][a-z0-9_.]{1,18}[a-z0-9_])|#([\p{L}\p{N}_]{2,40})/giu;
const WORD = /[\p{L}\p{N}_]/u;

// Typographie française : espace insécable fine avant ? ! ; : » et après «
const frenchSpaces = (s) => s.replace(/ ([?!;:»])/g, '\u202f$1').replace(/« /g, '«\u202f');

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
      frag.append(h('a', { href: `/@${m[2]}` }, `@${m[2]}`));
    } else if (m[3]) {
      frag.append(h('a', { href: `/explorer?q=${encodeURIComponent(`#${m[3]}`)}` }, `#${m[3]}`));
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
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || '?').slice(0, 2);
  return letters.toUpperCase();
}

export function avatar(user, size = '', { presence = false } = {}) {
  const cls = ['avatar', size && `avatar-${size}`].filter(Boolean).join(' ');
  const el = h('span', { class: cls });
  if (user?.avatar) {
    el.append(h('img', { src: user.avatar, alt: '', loading: 'lazy', decoding: 'async' }));
  } else {
    const hue = hash(user?.username || 'x') % 360;
    el.append(
      h(
        'span',
        {
          class: 'avatar-initials',
          style: { '--h': String(hue) },
        },
        initials(user?.displayName),
      ),
    );
  }
  if (presence && user?.online) el.append(h('span', { class: 'presence', title: 'En ligne' }));
  return el;
}

// Étiquette des comptes automatiques (AURUM, Le Concierge)
export function botChip() {
  return h('span', { class: 'bot-chip', title: 'Compte automatique : publications générées par AURUM' }, 'Automatique');
}

// Badge « Membre vérifié » (identité confirmée par la Direction)
export function verifiedMark() {
  return h('span', { class: 'verified', title: 'Membre vérifié', 'aria-label': 'Membre vérifié' }, icon('verified'));
}

export function nameLine(user, { link = true } = {}) {
  const parts = [
    h('b', null, user.displayName),
    user.verified ? verifiedMark() : null,
    user.bot ? botChip() : null,
  ];
  return link
    ? h('a', { href: `/@${user.username}`, class: 'name-line' }, parts)
    : h('span', { class: 'name-line' }, parts);
}

export function memberChip(user) {
  return user.memberNumber ? h('span', { class: 'member-no', title: 'Numéro de membre' }, memberNo(user.memberNumber)) : null;
}

// ---------------------------------------------------------------------------
// Carte de membre 3D : titane pour les membres, carte métal pop art pour les Fondateurs
// ---------------------------------------------------------------------------

// Trame pop art (points de tailles variables, façon impression en demi-teintes) :
// un seul tracé par couleur, calculé une fois pour toutes les cartes.
function halftone(w, hgt, step, size) {
  let d = '';
  for (let y = step / 2, row = 0; y < hgt; y += step, row++) {
    for (let x = step / 2 + (row % 2 ? step / 2 : 0); x < w; x += step) {
      const r = Math.min(1, Math.max(0, size(x / w, y / hgt))) * step * 0.52;
      if (r < 0.14) continue;
      const f = (n) => n.toFixed(2);
      d += `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
    }
  }
  return d;
}
function burst(cx, cy, points, outer, inner) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2;
    const r = i % 2 ? inner : outer;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}
let popArt = '';
function popArtSvg() {
  if (popArt) return popArt;
  const W = 160;
  const H = 101;
  // Le motif reste à droite : le nom et le numéro, à gauche, se lisent sur le métal
  const pink = halftone(W, H, 4.2, (u, v) => 1.15 - Math.hypot(u - 1, v * 0.64) / 0.6);
  const cyan = halftone(W, H, 3.4, (u, v) => 1 - Math.hypot(u - 1.02, (v - 0.8) * 0.64) / 0.3);
  const yellow = halftone(W, H, 2.8, (u, v) => 1 - Math.hypot(u - 0.66, (v - 1.12) * 0.64) / 0.28);
  popArt = `<svg class="mcard-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <path d="${cyan}" fill="#19c6ff" opacity="0.85"/>
    <path d="${yellow}" fill="#ffd60a" opacity="0.8"/>
    <path d="${pink}" fill="#ff2e93" opacity="0.9"/>
    <g transform="translate(2.2 2.2)"><polygon points="${burst(115, 54, 16, 26.5, 20)}" fill="#ff2e93"/></g>
    <polygon points="${burst(115, 54, 16, 26.5, 20)}" fill="#ffd60a" stroke="#0b0b0f" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="115" cy="54" r="16" fill="#fbfbfd" stroke="#0b0b0f" stroke-width="1.6"/>
    <circle cx="115" cy="54" r="13.3" fill="none" stroke="#0b0b0f" stroke-width="0.5" stroke-dasharray="1 1.2"/>
    <text x="116.4" y="63.6" text-anchor="middle" class="mcard-art-a" fill="#19c6ff">A</text>
    <text x="115" y="62.2" text-anchor="middle" class="mcard-art-a" fill="#ff2e93" stroke="#0b0b0f" stroke-width="1.3" paint-order="stroke">A</text>
  </svg>`;
  return popArt;
}

export function memberCard({ name, number, since, founder, interactive = true }) {
  let card;
  if (founder) {
    card = h(
      'div',
      { class: 'mcard founder' },
      h(
        'div',
        { class: 'mcard-top' },
        h('div', { class: 'mcard-logo' }, 'AURUM', h('small', null, 'LE CERCLE PRIVÉ')),
        h('div', { class: 'mcard-pop-label' }, 'Fondateur'),
      ),
      h('div', { class: 'mcard-chip' }),
      h('div', { class: 'mcard-number emboss' }, memberNo(number)),
      h(
        'div',
        { class: 'mcard-bottom' },
        h('div', null, h('small', null, `Membre depuis ${since || '—'}`), h('b', { class: 'emboss' }, (name || 'Votre nom').toUpperCase())),
      ),
    );
    card.insertAdjacentHTML('afterbegin', popArtSvg());
  } else {
    card = h(
      'div',
      { class: 'mcard' },
      h(
        'div',
        { class: 'mcard-top' },
        h('div', { class: 'mcard-logo' }, 'AURUM', h('small', null, 'LE CERCLE PRIVÉ')),
        h('div', { class: 'mcard-chip' }),
      ),
      h('div', { class: 'mcard-number' }, memberNo(number)),
      h(
        'div',
        { class: 'mcard-bottom' },
        h('div', null, h('small', null, 'Membre'), h('b', null, name || 'Votre nom')),
        h('div', { style: { textAlign: 'right' } }, h('small', null, 'Depuis'), h('b', null, since || '—')),
      ),
    );
  }
  if (interactive) tilt(card);
  return h('div', { class: 'mcard-wrap' }, card);
}

export function tilt(card) {
  const target = card;
  const move = (e) => {
    const r = target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    target.classList.add('is-tracking');
    target.style.setProperty('--rx', `${(x - 0.5) * 22}deg`);
    target.style.setProperty('--ry', `${(0.5 - y) * 16}deg`);
    target.style.setProperty('--mx', `${x * 100}%`);
    target.style.setProperty('--my', `${y * 100}%`);
  };
  const leave = () => {
    target.classList.remove('is-tracking');
    target.style.setProperty('--rx', '0deg');
    target.style.setProperty('--ry', '0deg');
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerleave', leave);
}

// Toucher simple (action habituelle) et double-toucher (aimer), comme sur les grands réseaux.
// Le toucher simple attend un court instant pour ne pas se confondre avec le double.
export function onTaps(el, { single, double }) {
  let timer = null;
  let last = 0;
  el.addEventListener('click', (e) => {
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
export async function shareLink(title, path) {
  const url = `${location.origin}${path}`;
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Lien copié.');
  } catch {
    toast(url);
  }
}

export function remaining(ts) {
  const hours = Math.max(1, Math.ceil((ts - Date.now()) / 3600000));
  return hours >= 48 ? `${Math.round(hours / 24)} jours` : `${hours} h`;
}

export function cardSince(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;
}

// ---------------------------------------------------------------------------
// Composants génériques
// ---------------------------------------------------------------------------
export function toast(message, type = 'ok') {
  const host = document.getElementById('toasts');
  const el = h('div', { class: `toast ${type}`, role: 'status' }, icon(type === 'error' ? 'alert' : 'check'), message);
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
  return h('div', { class: 'empty' }, icon(iconName), h('h3', null, title), text ? h('p', null, text) : null, action || null);
}

let openModalEl = null;
export function modal(title, body, { onClose } = {}) {
  closeModal();
  const close = () => closeModal();
  const backdrop = h(
    'div',
    {
      class: 'modal-backdrop',
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
  document.body.append(backdrop);
  document.body.style.overflow = 'hidden';
  openModalEl = backdrop;
  const focusable = backdrop.querySelector('textarea, input, select');
  if (focusable && window.matchMedia('(min-width: 721px)').matches) setTimeout(() => focusable.focus(), 50);
  return { close, el: backdrop };
}
export function closeModal() {
  if (!openModalEl) return;
  const el = openModalEl;
  openModalEl = null;
  el.remove();
  document.body.style.overflow = '';
  el._onClose?.();
}

// Visionneuse : ouverture zoomée, fermeture d'un geste vers le bas (comme Photos sur iPhone), Échap ou toucher.
export function lightbox(src) {
  const img = h('img', { src, alt: '', draggable: 'false' });
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
export function infinite(sentinel, loadMore) {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    },
    { rootMargin: '600px 0px' },
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
