import { store } from '../store.js';
import { h, money } from '../dom.js';
import { siteTopbar, siteFooter } from './landing.js';
import { backHead } from './feed.js';

// Modèles à compléter avec les informations de votre société.
const todo = (t) => h('span', { class: 'todo' }, `[${t}]`);

function pages() {
  const price = money(store.config.priceCents, store.config.currency);
  const limit = store.config.founderLimit;
  return {
    'mentions-legales': {
      title: 'Mentions légales',
      body: [
        h('h2', null, 'Éditeur'),
        h('p', null, 'Le service AURUM est édité par ', todo('raison sociale'), ', ', todo('forme juridique'), ' au capital de ', todo('montant'), ', immatriculée au RCS de ', todo('ville'), ' sous le numéro ', todo('SIREN'), ', dont le siège social est situé ', todo('adresse'), '.'),
        h('p', null, 'Directeur de la publication : ', todo('nom'), '. Contact : ', todo('e-mail de contact'), '.'),
        h('h2', null, 'Hébergement'),
        h('p', null, 'Le site est hébergé par Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (serveurs utilisés : Francfort, Allemagne). Les données sont stockées par Turso, sur des serveurs situés à Francfort (Allemagne).'),
        h('h2', null, 'Propriété intellectuelle'),
        h('p', null, "La marque AURUM, l'interface et les contenus éditoriaux du service sont protégés. Les contenus publiés par les membres restent leur propriété."),
      ],
    },
    cgv: {
      title: 'Conditions générales de vente et d’utilisation',
      body: [
        h('h2', null, '1. Objet'),
        h('p', null, "Les présentes conditions régissent l'accès au réseau social privé AURUM, réservé aux personnes majeures admises dans le cercle."),
        h('h2', null, "2. Conditions d'entrée"),
        h('p', null, `Les ${limit} premières places, dites de Fondateur, sont gratuites et le restent à vie. Elles donnent droit à la carte Fondateur et aux avant-premières du cercle (annonces de la Direction et événements ouverts d'abord aux Fondateurs), sans autre avantage financier. Une fois ces places attribuées, l'accès au cercle est subordonné au paiement d'un droit d'entrée unique de ${price} TTC. Il ne s'agit pas d'un abonnement : aucun prélèvement ultérieur n'est effectué. Le paiement est traité par la société Stripe ; AURUM n'a jamais accès à vos coordonnées bancaires.`),
        h('h2', null, '3. Droit de rétractation'),
        h('p', null, "Conformément à l'article L221-28 13° du Code de la consommation, le membre qui demande l'accès immédiat au service, avant la fin du délai de rétractation de quatorze jours, reconnaît expressément perdre son droit de rétractation dès l'activation de son accès."),
        h('h2', null, '4. Règles de conduite et modération'),
        h('p', null, "Le membre s'engage à publier sous son identité réelle, à respecter la courtoisie et la discrétion propres au cercle, et à ne publier aucun contenu illicite, haineux, injurieux, menaçant, diffamatoire ou portant atteinte aux droits de tiers."),
        h('p', null, "Un filtre automatique examine les publications, commentaires et messages au moment de leur envoi. Les propos haineux, les menaces et les incitations à la violence sont refusés. Les propos injurieux ou déplacés sont masqués derrière un avertissement et transmis à la Direction, qui décide de leur suppression et, le cas échéant, de l'exclusion de leur auteur. Chaque membre peut également signaler une publication, un commentaire, un message ou un profil."),
        h('h2', null, '5. Admission'),
        h('p', null, "L'entrée dans le cercle se fait sur invitation d'un membre ou après validation de la demande par la Direction, qui peut la refuser sans avoir à se justifier."),
        h('h2', null, '6. Comptes automatiques'),
        h('p', null, "Les comptes « AURUM » et « Le Concierge » sont des comptes automatiques, signalés par la mention « Automatique ». Ils publient des contenus du Journal, la question du jour, les événements et l'adresse de la semaine, et accueillent les nouveaux membres. Ils ne lisent pas les messages. Tous les autres comptes appartiennent à de vraies personnes."),
        h('h2', null, '7. Exclusion'),
        h('p', null, "En cas de manquement grave, AURUM peut suspendre ou supprimer un compte. Le droit d'entrée éventuellement réglé reste acquis."),
        h('h2', null, '8. Résiliation'),
        h('p', null, 'Le membre peut supprimer son compte à tout moment depuis ses réglages.'),
        h('h2', null, '9. Droit applicable'),
        h('p', null, 'Les présentes conditions sont soumises au droit français. Médiateur de la consommation : ', todo('nom et coordonnées du médiateur'), '.'),
      ],
    },
    confidentialite: {
      title: 'Politique de confidentialité',
      body: [
        h('h2', null, 'Responsable du traitement'),
        h('p', null, todo('raison sociale et adresse'), ' — contact : ', todo('e-mail DPO / contact'), '.'),
        h('h2', null, 'Données collectées'),
        h('p', null, 'Nom, nom d’utilisateur, e-mail, mot de passe (chiffré, jamais lisible), informations de profil que vous choisissez de renseigner, présentation jointe à une demande d’admission, parrain éventuel, contenus publiés, messages privés, appareils autorisés à recevoir des notifications et historique de paiement (sans données bancaires).'),
        h('h2', null, 'Finalités et bases légales'),
        h('p', null, "Fourniture du service (exécution du contrat), sécurité et prévention de la fraude (intérêt légitime), obligations comptables (obligation légale). Aucune donnée n'est vendue ni utilisée à des fins publicitaires."),
        h('h2', null, 'Modération automatique'),
        h('p', null, "Pour protéger les membres, les publications, commentaires et messages privés sont analysés automatiquement au moment de leur envoi, par un filtre de mots et d'expressions fonctionnant sur nos propres serveurs (aucun service extérieur). Seuls les contenus détectés comme injurieux ou déplacés sont transmis à la Direction, avec le nom de leur auteur ; les autres messages ne sont lus par personne. Base légale : intérêt légitime (sécurité des membres) et respect des conditions d'utilisation."),
        h('h2', null, 'Cookies'),
        h('p', null, "AURUM n'utilise qu'un cookie strictement nécessaire à votre connexion. Aucun traceur publicitaire ni outil de mesure tiers. Les polices de caractères sont hébergées localement. Lorsque vous lancez une vidéo ou un podcast intégré au Journal (YouTube en mode confidentialité renforcée, Vimeo, Spotify…), ce service peut déposer ses propres cookies."),
        h('h2', null, 'Sous-traitants'),
        h('p', null, 'Stripe (paiement du droit d’entrée), Vercel Inc. (hébergement, serveurs à Francfort), Turso (base de données, serveurs à Francfort), Brevo (envoi des courriels, France), et les services de notification d’Apple, Google ou Mozilla pour les notifications sur téléphone.'),
        h('h2', null, 'Durée de conservation'),
        h('p', null, 'Les données sont conservées tant que le compte est actif, puis supprimées. Les justificatifs de paiement sont conservés dix ans (obligation comptable).'),
        h('h2', null, 'Vos droits'),
        h('p', null, "Accès, rectification, effacement, portabilité (export en un clic depuis vos réglages), opposition et limitation. Vous pouvez saisir la CNIL (cnil.fr)."),
      ],
    },
  };
}

export function legalView(ctx) {
  const page = pages()[ctx.route.page];
  ctx.title = `${page.title} — AURUM`;
  const content = h('article', { class: 'legal' }, page.body);
  if (store.isMember) return h('div', null, backHead(page.title), content);
  return h(
    'div',
    null,
    siteTopbar(),
    h('div', { class: 'container narrow legal-page' }, h('h1', null, page.title), content),
    siteFooter(),
  );
}
