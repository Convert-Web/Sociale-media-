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
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
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
const TOKEN_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|(?<![\w@.])@([a-z0-9_][a-z0-9_.]{1,18}[a-z0-9_])|(?<![\w&#])#([\p{L}\p{N}_]{2,40})/giu;

export function richText(str) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of str.matchAll(TOKEN_RE)) {
    if (m.index > last) frag.append(str.slice(last, m.index));
    if (m[1]) {
      frag.append(h('a', { href: m[1], target: '_blank', rel: 'noopener noreferrer nofollow' }, m[1].replace(/^https?:\/\/(www\.)?/, '')));
    } else if (m[2]) {
      frag.append(h('a', { href: `/@${m[2]}` }, `@${m[2]}`));
    } else if (m[3]) {
      frag.append(h('a', { href: `/explorer?q=${encodeURIComponent(`#${m[3]}`)}` }, `#${m[3]}`));
    }
    last = m.index + m[0].length;
  }
  if (last < str.length) frag.append(str.slice(last));
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
  const cls = ['avatar', size && `avatar-${size}`, user?.founder && 'founder'].filter(Boolean).join(' ');
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
          style: {
            background: `radial-gradient(120% 120% at 20% 10%, hsl(${hue} 22% 22%), hsl(${(hue + 40) % 360} 18% 9%))`,
          },
        },
        initials(user?.displayName),
      ),
    );
  }
  if (presence && user?.online) el.append(h('span', { class: 'presence', title: 'En ligne' }));
  return el;
}

export function nameLine(user, { link = true } = {}) {
  const parts = [
    h('b', null, user.displayName),
    user.founder ? h('span', { title: 'Membre fondateur' }, icon('crown', 'crown')) : null,
  ];
  return link
    ? h('a', { href: `/@${user.username}`, class: 'name-line' }, parts)
    : h('span', { class: 'name-line' }, parts);
}

export function memberChip(user) {
  return user.memberNumber ? h('span', { class: 'member-no', title: 'Numéro de membre' }, memberNo(user.memberNumber)) : null;
}

export function founderBadge() {
  return h('span', { class: 'founder-badge' }, icon('crown'), 'Fondateur');
}

// ---------------------------------------------------------------------------
// Carte de membre 3D
// ---------------------------------------------------------------------------
export function memberCard({ name, number, since, founder, interactive = true }) {
  const card = h(
    'div',
    { class: `mcard${founder ? ' gold' : ''}` },
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
      founder
        ? h('div', { class: 'mcard-founder' }, icon('crown'), 'Fondateur')
        : h('div', { style: { textAlign: 'right' } }, h('small', null, 'Depuis'), h('b', null, since || '—')),
    ),
  );
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

export function lightbox(src) {
  const box = h('div', { class: 'lightbox', onclick: () => box.remove() }, h('img', { src, alt: '' }));
  document.body.append(box);
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
          h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-gold'}`, onclick: () => done(true) }, confirmLabel),
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
