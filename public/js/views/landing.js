// Page d'entrée : un visiteur sans compte arrive ici avant tout le reste (vidéos, Actu, profils,
// liens partagés). Il crée un compte ou se connecte, puis il est emmené là où il voulait aller.
import { safePath } from '../router.js';
import { api, enc } from '../api.js';
import { h, avatar, logoMark, syncThemeColor, verifiedMark } from '../dom.js';
import { rememberInvite, pendingInvite } from '../components/invite.js';

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
  ctx.description = 'Des vidéos courtes de tes amis, et l’actu du jour en vidéo. Crée ton compte AURUM gratuitement.';
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
  // Invitation (« Rejoins-moi sur AURUM ») : la page est au nom de la personne qui invite
  if (ctx.query.get('par')) rememberInvite(ctx.query.get('par'));
  const by = pendingInvite();
  const invite = h('div', { class: 'land-invite', hidden: true });
  if (by) {
    api.get(`/api/users/${enc(by)}`).then(({ user }) => {
      if (!user || user.locked) return;
      invite.hidden = false;
      invite.replaceChildren(avatar(user, 'sm'), h('span', null, h('b', null, user.displayName, user.verified ? verifiedMark() : null), h('small', null, 't’invite sur AURUM')));
    }).catch(() => {});
  }
  return h('div', { class: 'land' },
    h('header', { class: 'land-top' }, logoMark(30), h('span', { class: 'land-name' }, 'AURUM')),
    h('main', { class: 'land-main' },
      invite,
      h('h1', null, 'Filme ta journée.', h('br'), 'Regarde celle des autres.'),
      h('p', { class: 'land-sub' }, why || 'Des vidéos courtes de tes amis, et l’actu du jour en vidéo.')),
    h('footer', { class: 'land-cta' },
      h('a', { href: `/inscription${q}`, class: 'btn btn-lg btn-block land-primary' }, 'Créer un compte'),
      h('p', { class: 'land-login' }, 'Déjà inscrit ? ', h('a', { href: `/connexion${q}` }, 'Se connecter')),
      h('p', { class: 'land-legal' },
        'En continuant, tu acceptes les ', h('a', { href: '/cgu' }, 'conditions d’utilisation'),
        ' et la ', h('a', { href: '/confidentialite' }, 'politique de confidentialité'), '.')));
}
