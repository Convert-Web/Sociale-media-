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
    document.documentElement.style.removeProperty('--cookie-h');
    setTimeout(() => {
      banner?.remove();
      banner = null;
    }, 220);
  };
  // Court, et deux boutons de même poids : refuser est aussi simple qu'accepter
  banner = h(
    'section',
    { class: 'cookie-banner', role: 'region', 'aria-label': 'Cookies' },
    h(
      'p',
      null,
      'Pas de pub ni de pistage : un cookie de connexion et un comptage anonyme des visites. ',
      h('a', { href: '/confidentialite#cookies' }, 'En savoir plus'),
    ),
    h(
      'div',
      { class: 'cookie-actions' },
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => close('no') }, 'Refuser'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => close('ok') }, 'Accepter'),
    ),
  );
  document.body.append(banner);
  // Tant que le bandeau est affiché, la page défile au-dessus de lui : il ne cache jamais un champ
  // ni un bouton (sa hauteur réservée en bas des pages ; dans le fil, il se place en haut)
  document.documentElement.classList.add('cookie-open');
  document.documentElement.style.setProperty('--cookie-h', `${banner.offsetHeight + 16}px`);
}

// « Gérer mon choix » (politique de confidentialité)
document.addEventListener('vibz:cookies', () => cookieBanner(true));
