// Page d'entrée : un visiteur sans compte arrive ici avant tout le reste (vidéos, Actu, profils,
// liens partagés). Il crée un compte ou se connecte, puis il est emmené là où il voulait aller.
import { safePath } from '../router.js';
import { h, icon, logoMark, syncThemeColor } from '../dom.js';

// Ce que la personne voulait ouvrir (lien partagé, notification) : dit en clair sur la page
function intent(suite) {
  if (!suite || suite === '/') return null;
  const name = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  let m;
  if ((m = /^\/@([^/?#]+)\/video\/\d+/.exec(suite))) return `Connecte-toi pour voir la vidéo de @${name(m[1])}.`;
  if ((m = /^\/live\/([^/?#]+)/.exec(suite))) return `Connecte-toi pour rejoindre le LIVE de @${name(m[1])}.`;
  if (/^\/actu\/\d+/.test(suite)) return 'Connecte-toi pour lire cette actualité.';
  if ((m = /^\/@([^/?#]+)/.exec(suite))) return `Connecte-toi pour voir le profil de @${name(m[1])}.`;
  if (/^\/(messages|boite|activite)/.test(suite)) return 'Connecte-toi pour retrouver tes messages et ton activité.';
  if (/^\/creer/.test(suite)) return 'Connecte-toi pour publier ta vidéo.';
  return 'Connecte-toi pour continuer.';
}

export function landingView(ctx) {
  ctx.title = 'AURUM — Crée ton compte ou connecte-toi';
  ctx.description = 'Des vidéos courtes, l’actu du jour et ta communauté. Crée ton compte AURUM gratuitement.';
  // Page toujours sombre (comme le fil) : barre d'état et bandeau du haut en noir
  document.documentElement.classList.add('feed-mode');
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = '#000000';
  ctx.onCleanup(() => {
    document.documentElement.classList.remove('feed-mode');
    syncThemeColor();
  });

  const suite = safePath(ctx.query.get('suite'), '');
  const q = suite ? `?suite=${encodeURIComponent(suite)}` : '';
  const why = intent(suite);
  const feature = (ic, title, text) => h('li', null, h('span', { class: 'land-ic' }, icon(ic)), h('span', null, h('b', null, title), h('small', null, text)));

  return h('div', { class: 'land' },
    h('div', { class: 'land-bg', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('div', { class: 'land-main' },
      h('div', { class: 'land-brand' }, logoMark(56), h('span', { class: 'land-name' }, 'AURUM')),
      h('h1', null, 'Des vidéos courtes,', h('br'), 'l’actu du jour,', h('br'), h('span', { class: 'land-accent' }, 'et toi.')),
      why
        ? h('p', { class: 'land-why' }, icon('lock', 'icon-sm'), h('span', null, why))
        : h('p', { class: 'land-lead' }, 'Filme, découvre et réagis à ce qui se passe, avec ta communauté.'),
      h('ul', { class: 'land-features' },
        feature('play', 'Pour toi', 'Un fil de vidéos qui apprend ce que tu aimes'),
        feature('newspaper', 'L’Actu', 'Les infos du jour, et tes réactions en vidéo'),
        feature('live', 'LIVE et messages', 'En direct et en privé avec tes amis'))),
    h('div', { class: 'land-cta' },
      h('a', { href: `/inscription${q}`, class: 'btn btn-lg btn-block land-primary' }, 'Créer un compte'),
      h('a', { href: `/connexion${q}`, class: 'btn btn-lg btn-block land-secondary' }, 'J’ai déjà un compte'),
      h('p', { class: 'land-legal' },
        'En continuant, tu acceptes les ', h('a', { href: '/cgu' }, 'Conditions d’utilisation'),
        ' et la ', h('a', { href: '/confidentialite' }, 'Politique de confidentialité'), '.',
        h('br'), h('a', { href: '/aide' }, 'Besoin d’aide ?'))));
}
