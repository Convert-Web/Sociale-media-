import { store } from '../store.js';
import { h, money } from '../dom.js';
import { siteTopbar, siteFooter } from './landing.js';
import { backHead } from './feed.js';

// Modèles à compléter avec les informations de votre société.
const todo = (t) => h('span', { class: 'todo' }, `[${t}]`);

function pages() {
  const price = money(store.config.priceCents, store.config.currency);
  const paid = store.config.paidEntry;
  return {
    'mentions-legales': {
      title: 'Mentions légales',
      body: [
        h('h2', null, 'Éditeur'),
        h('p', null, 'Le service AURUM est édité par ', todo('raison sociale'), ', ', todo('forme juridique'), ' au capital de ', todo('montant'), ', immatriculée au RCS de ', todo('ville'), ' sous le numéro ', todo('SIREN'), ', dont le siège social est situé ', todo('adresse'), '.'),
        h('p', null, 'Directeur de la publication : ', todo('nom'), '. Contact : ', todo('e-mail de contact'), '.'),
        h('h2', null, 'Hébergement'),
        h('p', null, 'Le site est hébergé par ', todo('hébergeur, adresse, téléphone'), '.'),
        h('h2', null, 'Propriété intellectuelle'),
        h('p', null, "La marque AURUM, l'interface et les contenus éditoriaux du service sont protégés. Les contenus publiés par les membres restent leur propriété."),
      ],
    },
    cgv: {
      title: 'Conditions générales de vente et d’utilisation',
      body: [
        h('h2', null, '1. Objet'),
        h('p', null, paid
          ? "Les présentes conditions régissent l'accès au réseau social privé AURUM, réservé aux personnes majeures s'étant acquittées du droit d'entrée."
          : "Les présentes conditions régissent l'accès au réseau social privé AURUM, réservé aux personnes majeures."),
        paid
          ? [
              h('h2', null, "2. Droit d'entrée"),
              h('p', null, `L'accès au cercle est subordonné au paiement d'un droit d'entrée unique de ${price} TTC. Il ne s'agit pas d'un abonnement : aucun prélèvement ultérieur n'est effectué. Le paiement est traité par la société Stripe ; AURUM n'a jamais accès à vos coordonnées bancaires.`),
              h('h2', null, '3. Droit de rétractation'),
              h('p', null, "Conformément à l'article L221-28 13° du Code de la consommation, le membre qui demande l'accès immédiat au service, avant la fin du délai de rétractation de quatorze jours, reconnaît expressément perdre son droit de rétractation dès l'activation de son accès."),
            ]
          : [
              h('h2', null, '2. Inscription'),
              h('p', null, "L'inscription est gratuite. Le membre s'engage à fournir des informations exactes et à garder son mot de passe confidentiel."),
              h('h2', null, '3. Évolution du service'),
              h('p', null, "AURUM pourra proposer à l'avenir des offres payantes. Aucun paiement ne sera jamais demandé sans l'accord exprès du membre."),
            ],
        h('h2', null, '4. Règles de conduite'),
        h('p', null, "Le membre s'engage à publier sous son identité réelle, à respecter la courtoisie et la discrétion propres au cercle, et à ne publier aucun contenu illicite, haineux, diffamatoire ou portant atteinte aux droits de tiers."),
        h('h2', null, '5. Exclusion'),
        h('p', null, paid ? "En cas de manquement grave, AURUM peut suspendre ou supprimer un compte. Le droit d'entrée reste acquis." : 'En cas de manquement grave, AURUM peut suspendre ou supprimer un compte.'),
        h('h2', null, '6. Résiliation'),
        h('p', null, 'Le membre peut supprimer son compte à tout moment depuis ses réglages.'),
        h('h2', null, '7. Droit applicable'),
        h('p', null, 'Les présentes conditions sont soumises au droit français. Médiateur de la consommation : ', todo('nom et coordonnées du médiateur'), '.'),
      ],
    },
    confidentialite: {
      title: 'Politique de confidentialité',
      body: [
        h('h2', null, 'Responsable du traitement'),
        h('p', null, todo('raison sociale et adresse'), ' — contact : ', todo('e-mail DPO / contact'), '.'),
        h('h2', null, 'Données collectées'),
        h('p', null, 'Nom, nom d’utilisateur, e-mail, mot de passe (chiffré, jamais lisible), informations de profil que vous choisissez de renseigner, contenus publiés, messages privés et historique de paiement (sans données bancaires).'),
        h('h2', null, 'Finalités et bases légales'),
        h('p', null, "Fourniture du service (exécution du contrat), sécurité et prévention de la fraude (intérêt légitime), obligations comptables (obligation légale). Aucune donnée n'est vendue ni utilisée à des fins publicitaires."),
        h('h2', null, 'Cookies'),
        h('p', null, "AURUM n'utilise qu'un cookie strictement nécessaire à votre connexion. Aucun traceur publicitaire ni outil de mesure tiers. Les polices de caractères sont hébergées localement."),
        h('h2', null, 'Sous-traitants'),
        h('p', null, paid ? 'Stripe (paiement), ' : '', todo('hébergeur'), ', ', todo("prestataire d'envoi d'e-mails"), '.'),
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
