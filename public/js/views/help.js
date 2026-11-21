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
      ['Comment publier une vidéo ?', 'Bouton + puis « Vidéo ». Choisissez une vidéo d’une minute au plus et touchez « Publier » : elle se prépare en quelques secondes et s’envoie en arrière-plan, vous pouvez continuer à naviguer. Elle reste dans le cercle et sur votre profil tant que vous ne la supprimez pas.'],
      ['Qu’est-ce qu’une story ?', 'Une photo ou une vidéo visible 24 heures en haut du Salon. Bouton + puis « Story », ou touchez votre photo avec le + en haut du Salon.'],
      ['Mes vidéos restent-elles en ligne ?', 'Oui : elles restent dans le cercle et sur votre profil tant que vous ne les supprimez pas (menu « … » de la publication). Les stories, elles, sont effacées après 24 heures.'],
      ['Comment publier plus tard ?', 'Dans la fenêtre de publication, touchez « Brouillon » : votre texte, vos photos et votre vidéo sont gardés sur ce téléphone. Retrouvez-les avec le bouton + puis « Brouillons ».'],
      ['Comment garder une vidéo ?', 'Touchez « Garder » (le signet) sur la vidéo : elle est copiée sur votre téléphone et reste dans Enregistrés, même sans connexion. Elle ne quitte pas l’application et vous seul la voyez.'],
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
      ['Comment avancer ou revenir dans une vidéo ?', 'Touchez ou faites glisser la fine barre tout en bas de la vidéo : le temps s’affiche en grand pendant que vous glissez.'],
      ['Comment changer la vitesse ou masquer une vidéo ?', 'Restez appuyé sur la vidéo : vitesse (×0,5 à ×2), « Pas intéressé », masquer les vidéos d’un membre, garder, copier le lien ou signaler.'],
      ['« Pour toi » et « Abonnements », c’est quoi ?', '« Pour toi » montre tout le cercle, en commençant par les vidéos que vous n’avez pas encore vues. « Abonnements » montre seulement les membres que vous suivez. Pas d’algorithme : l’ordre reste celui des publications.'],
      ['Qui voit le nombre de vues ?', 'Chaque membre qui regarde une vidéo plus de deux secondes compte pour une vue (une seule fois). Vous voyez les vues de vos vidéos sur la vidéo et dans l’onglet « Vidéos » de votre profil.'],
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
