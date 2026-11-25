// Bannière cookies et mesure d'audience anonyme (sans cookie, hébergée par AURUM).
import { h } from '../dom.js';

const KEY = 'vibz:cookies'; // « ok » ou « no » (mesure d'audience refusée)
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return 'ok'; // stockage indisponible : on n'insiste pas avec la bannière
  }
};
const write = (v) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* stockage indisponible */
  }
};
const optedOut = () => read() === 'no' || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;

// Une page vue. La première page d'une visite (arrivée depuis un autre site, un lien ou l'écran
// d'accueil, pas un rechargement) compte aussi comme visite, avec sa provenance.
let first = true;
export function trackPage(pattern) {
  const isFirst = first;
  first = false;
  if (optedOut()) return;
  const body = { p: pattern };
  if (isFirst) {
    const nav = performance.getEntriesByType?.('navigation')?.[0];
    let ref = '';
    try {
      const r = document.referrer ? new URL(document.referrer) : null;
      if (r && r.host !== location.host) ref = r.hostname;
    } catch {
      /* provenance illisible */
    }
    const internal = document.referrer && !ref;
    if (nav?.type !== 'reload' && !internal) {
      body.v = true;
      if (ref) body.r = ref;
      const utm = new URLSearchParams(location.search).get('utm_source');
      if (utm) body.s = utm.slice(0, 30);
    }
  }
  fetch('/api/a', {
    method: 'POST',
    headers: { 'x-vibz': '1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    keepalive: true,
  }).catch(() => {});
}

// Bannière : informative (aucun traceur publicitaire), avec possibilité de refuser la mesure
let banner = null;
export function cookieBanner(force = false) {
  if (banner || (!force && read())) return;
  const close = (choice) => {
    write(choice);
    banner?.classList.add('out');
    document.documentElement.classList.remove('cookie-open');
    setTimeout(() => {
      banner?.remove();
      banner = null;
    }, 220);
  };
  banner = h(
    'section',
    { class: 'cookie-banner', role: 'region', 'aria-label': 'Cookies' },
    h(
      'p',
      null,
      h('b', null, 'Ni publicité, ni pistage. '),
      'AURUM utilise un seul cookie, indispensable pour rester connecté, et compte ses visites de façon anonyme, sans cookie. ',
      h('a', { href: '/confidentialite#cookies' }, 'En savoir plus'),
    ),
    h(
      'div',
      { class: 'cookie-actions' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => close('no') }, 'Refuser la mesure'),
      h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => close('ok') }, 'D’accord'),
    ),
  );
  document.body.append(banner);
  // Tant que le bandeau est affiché, la page peut défiler au-dessus de lui (boutons jamais cachés)
  document.documentElement.classList.add('cookie-open');
}

// « Gérer mon choix » (politique de confidentialité)
document.addEventListener('vibz:cookies', () => cookieBanner(true));
