// Notifications dans l'application ouverte : une bannière descend du haut de l'écran, avec un son
// maison court et pétillant (une bulle qui monte, puis une note claire), et la pastille de l'icône
// de l'application affiche le nombre de nouveautés. Application fermée : ce sont les notifications
// du téléphone (sw.js).
// Rien ne vient déranger le tournage d'une vidéo ni un LIVE ; sur la page concernée (la
// conversation ouverte, la boîte de réception, l'activité), seul le son prévient.
import { store, pollNow } from './store.js';
import { navigate } from './router.js';
import { h, icon, avatar } from './dom.js';
import { notifSummary, notifLink } from './views/inbox.js';

// ---------------------------------------------------------------------------
// Réglages de cet appareil (Réglages → Notifications)
// ---------------------------------------------------------------------------
const KEYS = { sound: 'vibz:notif-son', banner: 'vibz:notif-banniere' };
function readFlag(key) {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}
function writeFlag(key, on) {
  try {
    if (on) localStorage.removeItem(key);
    else localStorage.setItem(key, '0');
  } catch {
    /* navigation privée : le réglage vaut pour cette visite */
  }
}
export const notifSettings = {
  get sound() {
    return readFlag(KEYS.sound);
  },
  set sound(on) {
    writeFlag(KEYS.sound, on);
  },
  get banner() {
    return readFlag(KEYS.banner);
  },
  set banner(on) {
    writeFlag(KEYS.banner, on);
  },
};

// ---------------------------------------------------------------------------
// Le son (synthétisé : aucun fichier à télécharger)
// ---------------------------------------------------------------------------
let ac = null;
// Les navigateurs (l'iPhone surtout) n'autorisent le son qu'après un premier toucher
export function unlockSound() {
  try {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
    }
    if (ac.state !== 'running') ac.resume().catch(() => {});
    const silent = ac.createBufferSource();
    silent.buffer = ac.createBuffer(1, 1, 22050);
    silent.connect(ac.destination);
    silent.start(0);
  } catch {
    /* pas de son sur ce navigateur */
  }
}
const onGesture = () => {
  if (ac?.state === 'running') return;
  unlockSound();
};
for (const ev of ['pointerdown', 'touchend', 'keydown']) addEventListener(ev, onGesture, { capture: true, passive: true });

// Une bulle qui monte : sinusoïde dont la hauteur glisse vers le haut, attaque nette, chute rapide
function bubble(c, out, t, from, to, dur, gain) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.55);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}
// Une note claire : la fondamentale et deux harmoniques qui s'éteignent plus vite
function ding(c, out, t, freq, dur, gain) {
  for (const [mult, part] of [[1, 1], [2, 0.24], [3.01, 0.09]]) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * mult, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * part, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur / mult);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

// Le son lui-même, sur n'importe quel contexte audio (aussi pour l'enregistrer dans un fichier)
export function renderSound(c, dest, kind = 'notif', t = c.currentTime) {
  const out = c.createGain();
  out.gain.value = kind === 'soft' ? 0.5 : 0.78;
  const soften = c.createBiquadFilter();
  soften.type = 'lowpass';
  soften.frequency.value = 7200;
  out.connect(soften).connect(dest);
  if (kind === 'message') {
    bubble(c, out, t, 640, 1220, 0.09, 0.55);
    bubble(c, out, t + 0.085, 820, 1560, 0.1, 0.5);
    ding(c, out, t + 0.165, 1760, 0.34, 0.26);
  } else if (kind === 'soft') {
    bubble(c, out, t, 700, 1300, 0.085, 0.5);
  } else {
    bubble(c, out, t, 540, 1100, 0.095, 0.55);
    ding(c, out, t + 0.075, 1568, 0.44, 0.32);
  }
}

let lastSound = 0;
// kind : « notif » (bulle puis note), « message » (deux bulles puis note), « soft » (une petite bulle)
export function playNotifSound(kind = 'notif', { force = false } = {}) {
  if (!force && !notifSettings.sound) return;
  const now = performance.now();
  if (!force && now - lastSound < 1200) return; // plusieurs nouveautés d'un coup : un seul son
  if (!ac) unlockSound();
  if (!ac) return;
  lastSound = now;
  const play = () => renderSound(ac, ac.destination, kind, ac.currentTime + 0.02);
  if (ac.state === 'running') play();
  else ac.resume().then(() => ac.state === 'running' && play()).catch(() => {});
  try {
    navigator.vibrate?.(kind === 'soft' ? 12 : [18, 40, 26]);
  } catch {
    /* pas de vibreur */
  }
}

// ---------------------------------------------------------------------------
// La bannière
// ---------------------------------------------------------------------------
const KIND_ICONS = {
  like: 'heart-fill',
  favorite: 'bookmarkFill',
  comment_like: 'heart-fill',
  comment: 'comment',
  reply: 'comment',
  mention: 'comment',
  follow: 'userPlus',
  follow_request: 'userPlus',
  follow_accept: 'userPlus',
  invite_joined: 'userPlus',
  repost: 'repost',
  duet: 'duet',
  stitch: 'scissors',
  live: 'live',
  gift: 'gift',
  dm: 'send',
};
const KIND_CLASS = (k) => (['like', 'comment_like', 'favorite'].includes(k) ? 'k-like' : k === 'dm' ? 'k-dm' : k === 'live' ? 'k-live' : k === 'gift' ? 'k-gift' : k?.startsWith('follow') || k === 'invite_joined' ? 'k-follow' : 'k-comment');

let box = null;
let hideTimer = 0;
function hideBanner() {
  clearTimeout(hideTimer);
  const el = box;
  if (!el) return;
  box = null;
  el.classList.remove('in');
  setTimeout(() => el.remove(), 380);
}

// who : { displayName, avatar, username } ou une adresse d'image (notification du téléphone)
function showBanner({ who, title, text, image = null, href, kind }) {
  const pic = typeof who === 'string' || !who ? h('img', { class: 'nb-pic', src: who || '/img/icon-192.png', alt: '' }) : avatar(who, 'sm');
  const card = h(
    'a',
    { class: 'nb-card', href },
    h('span', { class: 'nb-who' }, pic, KIND_ICONS[kind] ? h('span', { class: `nb-kind ${KIND_CLASS(kind)}` }, icon(KIND_ICONS[kind], 'icon-xs')) : null),
    h('span', { class: 'nb-text' }, h('span', { class: 'nb-top' }, h('b', null, title), h('small', null, 'maintenant')), h('span', { class: 'nb-body' }, text)),
    image ? h('img', { class: 'nb-thumb', src: image, alt: '' }) : null,
  );
  // Toucher : ouvrir ; glisser vers le haut : fermer
  let startY = null;
  let dy = 0;
  card.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    dy = 0;
    clearTimeout(hideTimer);
    el.classList.add('dragging');
  });
  card.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    dy = Math.min(0, e.clientY - startY);
    el.style.setProperty('--drag', `${dy}px`);
  });
  const release = () => {
    if (startY === null) return;
    startY = null;
    el.classList.remove('dragging');
    el.style.removeProperty('--drag');
    if (dy < -24) hideBanner();
    else hideTimer = setTimeout(hideBanner, 5000);
  };
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);
  card.addEventListener('click', (e) => {
    e.preventDefault();
    if (dy < -8) return;
    hideBanner();
    navigate(href);
  });
  let el = box;
  if (el) {
    // Une bannière est déjà là : son contenu est remplacé (petit rebond)
    el.replaceChildren(card);
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  } else {
    el = h('div', { class: 'nb', role: 'status', 'aria-live': 'polite' }, card);
    document.body.append(el);
    box = el;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  }
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBanner, 5000);
}

// ---------------------------------------------------------------------------
// Ce qui arrive
// ---------------------------------------------------------------------------
// Réglage « Me prévenir pour » du compte (le même que pour les notifications du téléphone)
const PREF = (kind) =>
  kind === 'dm' ? 'messages'
    : ['like', 'favorite', 'comment_like', 'repost', 'gift'].includes(kind) ? 'likes'
      : ['comment', 'reply', 'duet', 'stitch'].includes(kind) ? 'comments'
        : kind === 'mention' ? 'mentions'
          : kind?.startsWith('follow') || kind === 'invite_joined' ? 'follows'
            : kind === 'live' ? 'live' : null;
const wanted = (kind) => {
  const key = PREF(kind);
  return !key || store.user?.settings?.notify?.[key] !== false;
};

const announced = new Set(); // déjà annoncés (temps réel, notification du téléphone, relecture)

// Où l'on est : « quiet » (rien), « sound » (le son seul), « full » (bannière et son)
function placeFor(kind, from) {
  const path = location.pathname;
  if (document.hidden || path.startsWith('/creer') || path.startsWith('/live/')) return 'quiet';
  if (kind === 'dm' && from && path.toLowerCase() === `/messages/${from.toLowerCase()}`) return 'soft';
  if (['/boite', '/activite', '/messages'].includes(path)) return 'sound';
  return 'full';
}

function announce({ key, kind, who, title, text, image, href, from }) {
  if (!store.user || (key && announced.has(key))) return;
  if (key) announced.add(key);
  if (!wanted(kind)) return;
  const place = placeFor(kind, from);
  if (place === 'quiet') return;
  if (place === 'soft') return playNotifSound('soft');
  playNotifSound(kind === 'dm' ? 'message' : 'notif');
  if (place === 'full' && notifSettings.banner) showBanner({ who, title, text, image, href, kind });
}

function announceNotification(n) {
  if (!n?.actor) return;
  announce({
    key: `n:${n.id}`,
    kind: n.type,
    who: n.actor,
    title: n.actor.displayName,
    text: notifSummary(n),
    image: n.post?.image || null,
    href: notifLink(n),
  });
}

function announceMessage(m, from) {
  if (!m || !from) return;
  announce({
    key: `m:${m.id}`,
    kind: 'dm',
    who: from,
    title: from.displayName,
    text: m.body || 'a partagé une publication avec toi',
    href: `/messages/${from.username}`,
    from: from.username,
  });
}

// Pastille sur l'icône de l'application installée (iPhone, Android, ordinateur)
function paintAppBadge(c) {
  try {
    const n = store.user ? (c.notifications || 0) + (c.messages || 0) + (c.requests || 0) : 0;
    if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch {
    /* non pris en charge */
  }
}

let started = false;
export function startInAppNotifications() {
  if (started) return;
  started = true;
  // Temps réel (serveur classique) : la notification ou le message arrive avec l'évènement
  store.on('rt:notification', (n) => n && announceNotification(n));
  store.on('rt:message', (d) => {
    const m = d?.message;
    if (!m || d.echo || m.senderId === store.user?.id) return;
    announceMessage({ id: m.id, body: m.flagged?.length ? 'Message masqué' : m.body || (m.post ? 'a partagé une publication avec toi' : '') }, d.from);
  });
  // Relecture régulière (Vercel) : les nouveautés arrivent avec les compteurs
  store.on('notify:fresh', (fresh) => {
    if (fresh.notification) announceNotification(fresh.notification);
    if (fresh.message) announceMessage(fresh.message, fresh.message.from);
  });
  // Notification du téléphone reçue pendant que l'application est ouverte (sw.js)
  store.on('notify:push', ({ data, shown }) => {
    const key = data.nid ? `n:${data.nid}` : data.mid ? `m:${data.mid}` : null;
    if (shown) {
      if (key) announced.add(key); // le téléphone l'a déjà affichée : pas de doublon
    } else {
      announce({ key, kind: data.kind, who: data.icon || null, title: data.title || 'AURUM', text: data.body || '', href: data.url || '/activite', from: data.kind === 'dm' ? data.url?.split('/').pop() : null });
    }
    pollNow();
  });
  store.on('counters', paintAppBadge);
  store.on('user', (u) => !u && paintAppBadge({}));
  paintAppBadge(store.counters);
}
