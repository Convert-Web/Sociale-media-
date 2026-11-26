// Pages légales : mentions légales, CGU, CGV (pièces), politique de confidentialité (RGPD).
// Les informations de l'éditeur sont saisies dans l'administration (Administration → Légal) :
// elles restent dans la base, jamais dans le code.
import { api } from '../api.js';
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon } from '../dom.js';

const UPDATED = '26 novembre 2026';

let cache = null;
async function legalData() {
  if (cache && Date.now() - cache.at < 60e3) return cache.data;
  const data = await api.get('/api/legal');
  cache = { data, at: Date.now() };
  return data;
}

function pages(d) {
  const L = d.legal || {};
  const v = (k) => (L[k] ? L[k] : h('span', { class: 'todo' }, 'à compléter'));
  const mail = () => (L.email ? h('a', { href: `mailto:${L.email}` }, L.email) : v('email'));
  const p = (...kids) => h('p', null, ...kids);
  const ul = (...items) => h('ul', null, items.map((t) => h('li', null, t)));
  const h2 = (t, id) => h('h2', id ? { id } : null, t);
  const table = (head, rows) => h('div', { class: 'legal-table' }, h('table', null, h('thead', null, h('tr', null, head.map((c) => h('th', null, c)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { 'data-label': head[i] }, c)))))));
  const editor = () => [v('editorName'), L.legalForm ? `, ${L.legalForm}` : '', L.capital ? ` au capital de ${L.capital}` : ''];

  return {
    'mentions-legales': {
      title: 'Mentions légales',
      description: 'Éditeur, hébergeur et contact d’AURUM.',
      body: [
        h2('Éditeur'),
        p('Le site et l’application AURUM sont édités par ', ...editor(), '.'),
        p('Adresse : ', v('address'), '.'),
        p('SIREN / SIRET : ', v('siren'), L.registry ? ` — ${L.registry}` : '', '.'),
        L.vat ? p('TVA : ', L.vat, '.') : null,
        p('Contact : ', mail(), L.phone ? ` — ${L.phone}` : '', '.'),
        p('Directeur de la publication : ', v('director'), '.'),
        h2('Hébergement'),
        p('Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis — vercel.com (serveurs à Francfort, Allemagne). Base de données : Turso (ChiselStrike Inc.), serveurs dans l’Union européenne.'),
        h2('Point de contact (règlement européen sur les services numériques)'),
        p('Autorités et utilisateurs peuvent joindre l’éditeur à ', mail(), ', en français ou en anglais.'),
        h2('Propriété intellectuelle'),
        p('La marque AURUM, son logo, l’interface et les textes du service sont protégés. Les vidéos, photos et textes publiés restent la propriété de leurs auteurs.'),
        h2('Signaler un contenu'),
        p('Chaque vidéo, commentaire, message, LIVE et compte peut être signalé depuis son menu (appui long ou « … »). Tu peux aussi écrire à ', mail(), ' en indiquant l’adresse du contenu et la raison.'),
        h2('Documents'),
        ul(h('a', { href: '/cgu' }, 'Conditions d’utilisation'), h('a', { href: '/cgv' }, 'Conditions de vente des pièces'), h('a', { href: '/confidentialite' }, 'Politique de confidentialité'), h('a', { href: '/regles' }, 'Règles de la communauté')),
      ],
    },

    cgu: {
      title: 'Conditions d’utilisation',
      description: 'Règles d’accès et d’usage d’AURUM.',
      body: [
        h2('1. Le service'),
        p('AURUM permet de regarder, créer et partager des vidéos courtes, des photos et des textes, de commenter, d’envoyer des messages, de suivre des comptes et de diffuser des LIVE. Le service est gratuit ; seules les pièces virtuelles sont payantes (voir les ', h('a', { href: '/cgv' }, 'CGV'), ').'),
        h2('2. Ton compte'),
        ul('Il faut avoir 13 ans au moins. Avant 15 ans, parles-en à un parent : il peut t’aider à régler la confidentialité de ton compte.', 'Les informations données doivent être exactes ; le compte est personnel et son mot de passe confidentiel.', 'Tu peux modifier ou supprimer ton compte à tout moment (Réglages → Compte).'),
        h2('3. Tes contenus'),
        p('Tu restes propriétaire de ce que tu publies. Tu accordes à l’éditeur, pour la durée de leur mise en ligne, une licence gratuite et mondiale pour les héberger, les afficher et les diffuser dans AURUM (fils, recherche, partages). Selon tes réglages, d’autres comptes peuvent réutiliser ta vidéo en Duo, en Stitch ou son son (« Utiliser ce son ») ; tu peux désactiver ces options pour chaque vidéo.'),
        p('Tu garantis disposer des droits sur ce que tu publies (images, musiques, personnes filmées). Une musique protégée ne doit pas être utilisée sans autorisation.'),
        h2('4. Règles de la communauté'),
        p('Sont interdits notamment : contenus illégaux, haineux ou harcelants, violence, nudité, mise en danger, atteinte aux mineurs, usurpation, spam et arnaques. Le détail est dans les ', h('a', { href: '/regles' }, 'Règles de la communauté'), '.'),
        h2('5. Modération et signalements'),
        p('Tout contenu ou compte peut être signalé. Un filtre automatique refuse certains propos et en masque d’autres derrière un avertissement. L’éditeur peut retirer un contenu, arrêter un LIVE ou suspendre un compte qui enfreint ces conditions ; la personne concernée peut contester la décision en écrivant à ', mail(), '.'),
        h2('6. Recommandations'),
        p('Le fil « Pour toi » classe les vidéos selon leur popularité auprès des personnes qui les ont vues, leur fraîcheur et tes centres d’intérêt (comptes, hashtags, sons et catégories que tu regardes jusqu’au bout, aimes, commentes ou partages ; ce que tu passes vite ou marques « Pas intéressé »). Tu peux remettre ton fil à zéro, ou choisir un fil non personnalisé (Réglages → Confidentialité). « Abonnements » et « Amis » sont chronologiques.'),
        h2('7. LIVE et cadeaux'),
        p('Les LIVE sont diffusés directement entre les appareils. Les cadeaux offerts pendant un LIVE sont payés en pièces ; le créateur reçoit des diamants, qui n’ont pas de valeur en dehors du service tant qu’aucun programme de rémunération n’est ouvert.'),
        h2('8. Responsabilité'),
        p('Les contenus sont publiés sous la responsabilité de leurs auteurs. L’éditeur agit promptement pour retirer un contenu manifestement illicite qui lui est signalé.'),
        h2('9. Droit applicable'),
        p('Ces conditions sont soumises au droit français. En cas de litige, une solution amiable est recherchée en priorité ; pour un consommateur, le médiateur est : ', v('mediatorName'), L.mediatorUrl ? [' (', h('a', { href: L.mediatorUrl, target: '_blank', rel: 'noopener' }, L.mediatorUrl), ')'] : '', '.'),
        h2('10. Accès au service'),
        p('Le service est accessible gratuitement à toute personne disposant d’un accès à internet. L’éditeur s’efforce de le maintenir disponible, sans pouvoir le garantir : il peut être interrompu pour maintenance, mise à jour ou en cas de panne d’un prestataire.'),
        h2('11. Propriété intellectuelle d’AURUM'),
        p('Le nom AURUM, son logo, son interface, ses textes et son code sont protégés. Toute reproduction ou réutilisation sans autorisation écrite de l’éditeur est interdite.'),
        h2('12. Fin du compte'),
        p('Tu peux supprimer ton compte à tout moment (Réglages → Compte → Supprimer mon compte) : tes contenus et tes données sont alors effacés. L’éditeur peut suspendre ou supprimer un compte en cas de manquement grave ou répété à ces conditions, après avoir, sauf urgence, informé la personne concernée.'),
        h2('13. Données personnelles'),
        p('Le traitement de tes données est décrit dans la ', h('a', { href: '/confidentialite' }, 'politique de confidentialité'), '.'),
        h2('14. Modification des conditions'),
        p('Ces conditions peuvent évoluer. En cas de changement important, tu en es informé dans l’application avant son entrée en vigueur ; si tu n’es pas d’accord, tu peux supprimer ton compte.'),
        h2('15. Contact'),
        p('Pour toute question sur ces conditions : ', mail(), '.'),
      ],
    },

    cgv: {
      title: 'Conditions de vente des pièces',
      description: 'Achat de pièces virtuelles sur AURUM.',
      body: [
        h2('1. Les pièces'),
        p('Les pièces sont un contenu numérique qui permet d’offrir des cadeaux pendant les LIVE. Elles ne sont ni remboursables, ni échangeables contre de l’argent, ni transférables entre comptes.'),
        h2('2. Prix et paiement'),
        p('Les prix sont indiqués TTC dans le portefeuille avant tout achat. Le paiement est traité par Stripe (carte bancaire, et Apple Pay / Google Pay selon l’appareil) ; AURUM ne voit jamais tes coordonnées bancaires.'),
        h2('3. Livraison et droit de rétractation'),
        p('Les pièces sont créditées immédiatement après le paiement. En demandant cette livraison immédiate, tu renonces expressément à ton droit de rétractation (article L221-28, 13° du Code de la consommation), ce que tu confirmes en cochant la case prévue avant de payer.'),
        h2('4. Cadeaux'),
        p('Un cadeau envoyé est définitif. Le créateur qui le reçoit est crédité de diamants (un diamant par pièce).'),
        h2('5. Réclamations'),
        p('Pour toute question sur un achat : ', mail(), '. Médiateur de la consommation : ', v('mediatorName'), '.'),
      ],
    },

    confidentialite: {
      title: 'Politique de confidentialité',
      description: 'Données personnelles traitées par AURUM et tes droits (RGPD).',
      body: [
        h2('Responsable du traitement'),
        p(...editor(), ' — ', v('address'), ' — ', mail(), '.'),
        h2('Données traitées et finalités'),
        table(
          ['Données', 'Pourquoi', 'Base légale', 'Durée'],
          [
            ['Compte : e-mail, nom d’utilisateur, nom, mot de passe chiffré (scrypt), photo, bio, lien', 'Créer et sécuriser ton compte', 'Contrat', 'Jusqu’à la suppression du compte'],
            ['Contenus : vidéos, photos, descriptions, commentaires, LIVE', 'Publier et afficher tes contenus', 'Contrat', 'Jusqu’à leur suppression'],
            ['Messages privés', 'Messagerie entre comptes', 'Contrat', 'Jusqu’à la suppression du compte de l’un des deux'],
            ['Activité : vidéos regardées et temps passé, J’aime, favoris, partages, centres d’intérêt déduits', 'Personnaliser « Pour toi », statistiques des créateurs', 'Intérêt légitime (désactivable)', 'Jusqu’à la suppression du compte (remise à zéro possible)'],
            ['Achats de pièces : montant, date, référence Stripe', 'Facturation, obligations comptables', 'Contrat, obligation légale', '10 ans (pièces comptables)'],
            ['Abonnement aux notifications de l’appareil', 'T’envoyer les notifications choisies', 'Consentement', 'Jusqu’à leur désactivation'],
            ['Signalements', 'Modération', 'Obligation légale (DSA)', '1 an après traitement'],
            ['Mesure d’audience : totaux anonymes par jour, sans cookie ni identifiant', 'Statistiques de fréquentation', 'Intérêt légitime', '25 mois'],
          ],
        ),
        h2('Date de naissance'),
        p('Elle sert uniquement à vérifier l’âge minimal à l’inscription ; elle n’est pas conservée.'),
        h2('Destinataires'),
        p('Hébergement : Vercel et Turso. Paiements : Stripe. Envoi des courriels : Brevo. Traduction à la demande : MyMemory ou DeepL (seul le texte à traduire leur est transmis). Aucune donnée n’est vendue ni utilisée pour de la publicité.'),
        h2('Cookies', 'cookies'),
        p('Un seul cookie est déposé : celui de la session, indispensable pour rester connecté. La mesure d’audience ne dépose aucun cookie ; tu peux l’accepter ou la refuser quand tu veux.'),
        h('p', null, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => document.dispatchEvent(new CustomEvent('vibz:cookies')) }, 'Gérer mon choix')),
        h2('Transferts hors de l’Union européenne'),
        p('Les serveurs de l’application et la base de données sont situés dans l’Union européenne. Certains prestataires sont des sociétés américaines (Vercel, Stripe) : si des données sont transférées hors de l’Union, ces transferts sont encadrés par le cadre de protection des données UE–États-Unis ou par les clauses contractuelles types de la Commission européenne.'),
        h2('Sécurité'),
        ul('Connexion chiffrée (HTTPS) imposée sur tout le service.', 'Mots de passe jamais conservés en clair (chiffrement scrypt), compte bloqué temporairement après plusieurs essais ratés.', 'Cookie de session inaccessible aux scripts (HttpOnly) et limité au site.', 'Accès à l’administration réservé, actions de modération tracées.'),
        h2('Mineurs'),
        p('AURUM est réservé aux personnes de 13 ans et plus. Avant 15 ans, l’inscription se fait avec l’accord d’un parent, qui peut exercer les droits ci-dessous pour son enfant. Un compte créé par une personne trop jeune est supprimé dès que nous en avons connaissance.'),
        h2('Recommandations et décisions automatisées'),
        p('Le fil « Pour toi » est classé automatiquement selon ton activité. Ce classement n’a aucun effet juridique sur toi ; tu peux le désactiver à tout moment (Réglages → Confidentialité → fil non personnalisé). Le filtre automatique des propos peut masquer un contenu ; une personne de l’équipe examine les signalements.'),
        h2('Tes droits'),
        ul('Accès et portabilité : Réglages → Compte → Télécharger mes données.', 'Rectification : Modifier le profil.', 'Effacement : Réglages → Compte → Supprimer mon compte.', 'Opposition à la personnalisation : Réglages → Confidentialité.', ['Limitation, opposition, retrait d’un consentement, directives après décès et toute autre demande : écrire à ', mail(), '. Une réponse est apportée dans un délai d’un mois.']),
        h2('Réclamation'),
        p('Si tu estimes que tes droits ne sont pas respectés, tu peux adresser une réclamation à la CNIL : ', h('a', { href: 'https://www.cnil.fr/fr/plaintes', target: '_blank', rel: 'noopener' }, 'cnil.fr/fr/plaintes'), ', 3 place de Fontenoy, 75007 Paris.'),
        h2('Contact'),
        p('Pour toute question sur tes données : ', mail(), '.'),
      ],
    },
  };
}

export async function legalView(ctx) {
  const key = ctx.route.page;
  let d;
  try {
    d = await legalData();
  } catch {
    d = { legal: {} };
  }
  const page = pages(d)[key];
  ctx.title = `${page.title} — AURUM`;
  ctx.description = page.description;
  return h(
    'article',
    { class: 'page legal' },
    h('header', { class: 'page-head' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate(store.user ? '/reglages' : '/')) }, icon('back')), h('h1', null, page.title), h('span', { class: 'icon-btn' })),
    h('p', { class: 'muted small' }, `Mise à jour : ${UPDATED}`),
    ...page.body,
  );
}
