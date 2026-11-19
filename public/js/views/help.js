// Aide : les questions qu'on se pose vraiment, en réponses courtes, avec une recherche.
import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon } from '../dom.js';
import { siteTopbar, siteFooter } from './landing.js';
import { backHead } from './feed.js';

const SECTIONS = [
  {
    title: 'Premiers pas',
    icon: 'sparkles',
    items: [
      ['Comment publier ?', 'Touchez le bouton + en bas de l’écran, puis « Publication ». Écrivez quelques mots, ajoutez jusqu’à 6 photos si vous le souhaitez, et touchez « Publier ».'],
      ['Comment publier une vidéo ?', 'Bouton + puis « Vidéo ». Choisissez une vidéo d’une minute au plus et touchez « Publier » : elle se prépare et s’envoie en arrière-plan, vous pouvez continuer à naviguer. Elle reste visible 24 heures dans le cercle.'],
      ['Qu’est-ce qu’une story ?', 'Une photo ou une vidéo visible 24 heures en haut du Salon. Bouton + puis « Story », ou touchez votre photo avec le + en haut du Salon.'],
      ['Pourquoi mes vidéos disparaissent-elles ?', 'Les vidéos et les stories sont éphémères : elles sont effacées du cercle et de nos serveurs après 24 heures. Un membre qui a enregistré une vidéo en garde une copie dans l’application, sur son téléphone.'],
      ['Comment garder une vidéo ?', 'Touchez « Garder » (le signet) sur la vidéo : elle est copiée sur votre téléphone et reste dans Enregistrés, même après 24 heures. Elle ne quitte pas l’application et vous seul la voyez.'],
      ['Comment fonctionne le Salon ?', 'Le Salon montre les publications du cercle dans l’ordre où elles sont publiées. Aucun algorithme, aucune publicité. « Mes abonnements » n’affiche que les membres que vous suivez.'],
    ],
  },
  {
    title: 'Vidéos',
    icon: 'video',
    items: [
      ['Comment passer à la vidéo suivante ?', 'Glissez vers le haut. Pour revenir, glissez vers le bas.'],
      ['Comment aimer une vidéo ?', 'Touchez deux fois la vidéo, ou touchez le cœur à droite.'],
      ['Comment commenter sans quitter la vidéo ?', 'Touchez la bulle à droite : les commentaires s’ouvrent par-dessus la vidéo, qui continue. Glissez la feuille vers le bas pour la fermer.'],
      ['Le son ne marche pas', 'Touchez l’icône du haut-parleur en haut à droite. Vérifiez aussi que votre téléphone n’est pas en mode silencieux.'],
    ],
  },
  {
    title: 'Le cercle',
    icon: 'users',
    items: [
      ['Suivre ou être ami : quelle différence ?', 'Suivre, c’est voir les publications d’un membre dans « Mes abonnements ». Être ami, c’est une relation dans les deux sens, acceptée par les deux membres.'],
      ['Comment écrire en privé à un membre ?', 'Ouvrez son profil et touchez « Message », ou allez dans Messages puis touchez le crayon.'],
      ['Qu’est-ce qu’un groupe privé ?', 'Un espace réservé à quelques membres, sur invitation ou validation. Ses publications ne sont visibles que de ses membres.'],
      ['Comment faire entrer un proche ?', 'Menu, puis « Inviter un proche » : partagez votre lien d’invitation. Votre proche entre directement, sans attendre la validation de la Direction.'],
    ],
  },
  {
    title: 'Notifications',
    icon: 'bellRing',
    items: [
      ['Comment recevoir les notifications sur iPhone ?', 'Dans Safari, touchez « Partager » puis « Sur l’écran d’accueil ». Ouvrez AURUM depuis la nouvelle icône, puis activez les notifications dans Réglages.'],
      ['Comment les couper ?', 'Réglages, section « Notifications ». Vous pouvez aussi les gérer dans les réglages de votre téléphone.'],
    ],
  },
  {
    title: 'Compte et confidentialité',
    icon: 'lock',
    items: [
      ['Comment changer ma photo ou mon nom ?', 'Réglages, en haut de la page : photo, couverture, nom, métier, ville et présentation.'],
      ['J’ai oublié mon mot de passe', 'Sur la page de connexion, touchez « Mot de passe oublié ? » : un lien vous est envoyé par e-mail, valable une heure.'],
      ['Comment signaler un contenu ou un membre ?', 'Touchez « … » sur la publication, le commentaire ou le profil, puis « Signaler ». La Direction examine chaque signalement.'],
      ['Comment bloquer quelqu’un ?', 'Sur son profil, touchez « … » puis « Bloquer ». Il ne voit plus vos publications et ne peut plus vous écrire.'],
      ['Comment télécharger ou supprimer mes données ?', 'Réglages, section « Vos données » : « Exporter mes données » pour tout télécharger, « Supprimer mon compte » pour tout effacer définitivement.'],
    ],
  },
];

// Typographie française : espaces insécables dans les guillemets et avant ? ! : ;
const fr = (t) => t.replace(/« /g, '« ').replace(/ »/g, ' »').replace(/ ([?!:;])/g, ' $1');

export async function helpView(ctx) {
  ctx.title = 'Aide — AURUM';
  ctx.description = 'Les réponses aux questions fréquentes sur AURUM : publier, vidéos, stories, notifications, confidentialité.';
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Rechercher une question…', 'aria-label': 'Rechercher dans l’aide' });
  const none = h('p', { class: 'muted help-none', hidden: true }, 'Aucune réponse ne correspond. Écrivez-nous, nous répondons vite.');
  const sections = SECTIONS.map((sec) =>
    h(
      'section',
      { class: 'help-section' },
      h('h2', null, h('span', { class: 'help-ic' }, icon(sec.icon)), sec.title),
      ...sec.items.map(([q, a]) => h('details', { class: 'help-item' }, h('summary', null, fr(q), icon('chevron', 'icon-sm')), h('p', null, fr(a)))),
    ),
  );
  const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  search.addEventListener('input', () => {
    const q = norm(search.value.trim());
    let any = false;
    for (const sec of sections) {
      let shown = 0;
      for (const d of sec.querySelectorAll('.help-item')) {
        const ok = !q || norm(d.textContent).includes(q);
        d.hidden = !ok;
        if (ok) shown++;
        if (q && ok) d.open = true;
      }
      sec.hidden = !shown;
      any = any || shown > 0;
    }
    none.hidden = any;
  });
  // Contact : l'adresse de la Direction (informations légales)
  const contact = h('div', { class: 'help-contact' });
  api
    .get('/api/legal')
    .then(({ legal }) => {
      if (legal?.email) {
        contact.append(h('b', null, 'Une autre question ?'), h('span', null, 'La Direction vous répond, en général dans la journée.'), h('a', { class: 'btn btn-primary', href: `mailto:${legal.email}` }, icon('mail', 'icon-sm'), 'Écrire à la Direction'));
      }
    })
    .catch(() => {});
  const body = h('div', { class: 'help' }, h('div', { class: 'help-search' }, icon('search'), search), none, ...sections, contact);
  if (store.isMember) return h('div', null, backHead('Aide', 'Questions fréquentes'), body);
  return h('div', null, siteTopbar(), h('div', { class: 'container narrow legal-page' }, h('h1', null, 'Aide'), body), siteFooter());
}
