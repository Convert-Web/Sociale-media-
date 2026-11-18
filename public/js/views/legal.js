import { api } from '../api.js';
import { store } from '../store.js';
import { h, money } from '../dom.js';
import { siteTopbar, siteFooter } from './landing.js';
import { backHead } from './feed.js';

// Pages légales : mentions légales, CGU, CGV, politique de confidentialité (RGPD).
// Les informations de l'éditeur sont saisies par la Direction (Direction → Informations légales).
const UPDATED = '18 novembre 2026';

let cache = null;
async function legalData() {
  if (cache && Date.now() - cache.at < 60e3) return cache.data;
  const data = await api.get('/api/legal');
  cache = { data, at: Date.now() };
  return data;
}

function pages(d) {
  const L = d.legal || {};
  const price = money(d.priceCents, d.currency);
  const limit = d.founderLimit;
  const ttl = d.videoTtlHours || 24;
  // Valeur saisie par la Direction, ou mention « à compléter » tant qu'elle manque
  const v = (k) => (L[k] ? L[k] : h('span', { class: 'todo' }, 'à compléter'));
  const mail = () => (L.email ? h('a', { href: `mailto:${L.email}` }, L.email) : v('email'));
  const p = (...kids) => h('p', null, ...kids);
  const ul = (...items) => h('ul', null, items.map((t) => h('li', null, t)));
  const h2 = (t, id) => h('h2', id ? { id } : null, t);
  const table = (head, rows) =>
    h('div', { class: 'legal-table' }, h('table', null, h('thead', null, h('tr', null, head.map((c) => h('th', null, c)))), h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
  const editor = () => [v('editorName'), L.legalForm ? `, ${L.legalForm}` : '', L.capital ? ` au capital de ${L.capital}` : ''];

  return {
    'mentions-legales': {
      title: 'Mentions légales',
      description: 'Éditeur, hébergeur et contact du réseau social privé AURUM.',
      body: [
        h2('Éditeur du site'),
        p('Le site et l’application AURUM sont édités par ', ...editor(), '.'),
        p('Adresse : ', v('address'), '.'),
        p('SIREN / SIRET : ', v('siren'), L.registry ? ` — ${L.registry}` : '', '.'),
        L.vat ? p('TVA : ', L.vat, '.') : null,
        p('Contact : ', mail(), L.phone ? ` — ${L.phone}` : '', '.'),
        p('Directeur de la publication : ', v('director'), '.'),
        h2('Hébergement'),
        p('Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis — vercel.com. Les serveurs utilisés sont situés à Francfort (Allemagne).'),
        p('Base de données : Turso (ChiselStrike Inc.), serveurs situés dans l’Union européenne.'),
        h2('Propriété intellectuelle'),
        p('La marque AURUM, l’interface, les textes, la charte graphique et les contenus éditoriaux du service sont protégés par le droit de la propriété intellectuelle. Toute reproduction sans autorisation est interdite. Les contenus publiés par les membres restent leur propriété.'),
        h2('Signaler un contenu'),
        p('Chaque publication, commentaire, message et profil peut être signalé depuis son menu « … ». Vous pouvez aussi écrire à ', mail(), ' en précisant l’adresse du contenu et la raison du signalement.'),
        h2('Documents'),
        ul(h('a', { href: '/cgu' }, 'Conditions générales d’utilisation'), h('a', { href: '/cgv' }, 'Conditions générales de vente'), h('a', { href: '/confidentialite' }, 'Politique de confidentialité (RGPD) et cookies')),
      ],
    },

    cgu: {
      title: 'Conditions générales d’utilisation',
      description: 'Règles d’accès et d’usage du réseau social privé AURUM.',
      body: [
        h2('1. Objet'),
        p('Les présentes conditions générales d’utilisation (CGU) encadrent l’accès et l’usage du réseau social privé AURUM, édité par ', v('editorName'), '. En créant un compte, vous les acceptez sans réserve.'),
        h2('2. Accès au cercle'),
        ul(
          'AURUM est réservé aux personnes majeures (18 ans ou plus).',
          'L’entrée se fait sur invitation d’un membre ou après validation de votre demande par la Direction, qui peut la refuser sans avoir à se justifier.',
          `Les ${limit} premiers membres, dits Fondateurs, entrent gratuitement. Ensuite, un droit d’entrée unique est demandé (voir les conditions générales de vente).`,
          'Un seul compte par personne, à votre nom réel. Le nom d’utilisateur ne doit pas usurper l’identité d’un tiers ou d’une marque.',
        ),
        h2('3. Votre compte'),
        p('Vos identifiants sont personnels et confidentiels. Vous êtes responsable de l’usage de votre compte. Prévenez-nous sans attendre à ', mail(), ' en cas d’utilisation frauduleuse. Après plusieurs mots de passe erronés, le compte est temporairement bloqué par sécurité.'),
        h2('4. Règles de conduite'),
        p('Le cercle repose sur la courtoisie et la discrétion. Il est interdit de publier ou d’envoyer :'),
        ul(
          'des contenus illicites, haineux, discriminatoires, violents ou menaçants ;',
          'des propos injurieux, du harcèlement ou de l’intimidation ;',
          'des contenus pornographiques ou sexuels explicites, ou impliquant des mineurs ;',
          'les données personnelles d’autrui (adresse, téléphone, photos) sans son accord ;',
          'des contenus dont vous ne détenez pas les droits (photos, musiques, vidéos) ;',
          'de la publicité non sollicitée, des chaînes, des liens trompeurs ou des envois en masse ;',
          'des numéros de carte bancaire ou des tentatives d’escroquerie.',
        ),
        p('Il est également interdit de copier, d’enregistrer ou de diffuser hors du cercle les contenus des autres membres, notamment les vidéos éphémères et les messages privés.'),
        h2('5. Vos contenus'),
        p('Vous restez propriétaire de ce que vous publiez. Vous accordez à AURUM, pour la seule durée de leur publication, le droit non exclusif et gratuit de les héberger et de les afficher aux membres autorisés à les voir, sans autre usage. Les vidéos et les stories sont éphémères : elles sont effacées définitivement ', `${ttl} heures`, ' après leur publication.'),
        h2('6. Modération et signalements'),
        p('Un filtre automatique examine les publications, commentaires et messages au moment de leur envoi. Les propos haineux, les menaces et les numéros de carte bancaire sont refusés. Les propos injurieux, sexuels ou les envois massifs sont masqués derrière un avertissement et signalés à la Direction.'),
        p('Tout membre peut signaler un contenu ou un profil depuis le menu « … ». La Direction examine chaque signalement, peut retirer un contenu manifestement illicite et vous informe des décisions qui vous concernent, avec leurs motifs. Vous pouvez contester une décision en écrivant à ', mail(), ' : elle sera réexaminée par une personne.'),
        p('Pour éviter les abus, le nombre de publications, commentaires, messages et stories envoyés sur une courte durée est limité.'),
        h2('7. Comptes automatiques'),
        p('Les comptes « AURUM » et « Le Concierge » sont des comptes automatiques, signalés par la mention « Automatique ». Ils ne se font jamais passer pour des personnes et ne lisent pas les messages privés.'),
        h2('8. Disponibilité et responsabilité'),
        p('AURUM met tout en œuvre pour assurer l’accès au service, sans pouvoir garantir une disponibilité permanente (maintenance, incidents techniques). Chaque membre est responsable des contenus qu’il publie. AURUM agit en qualité d’hébergeur pour ces contenus et retire promptement ceux qui lui sont signalés comme manifestement illicites.'),
        h2('9. Suspension et exclusion'),
        p('En cas de manquement aux présentes CGU, la Direction peut retirer un contenu, suspendre ou supprimer un compte, après vous en avoir informé sauf urgence (contenu grave, sécurité des membres). Le droit d’entrée éventuellement réglé reste acquis en cas d’exclusion pour manquement grave.'),
        h2('10. Suppression de votre compte'),
        p('Vous pouvez supprimer votre compte à tout moment depuis Réglages → Données. La suppression est immédiate et définitive. Vous pouvez auparavant télécharger une copie de vos données.'),
        h2('11. Données personnelles'),
        p('Le traitement de vos données est décrit dans la ', h('a', { href: '/confidentialite' }, 'politique de confidentialité'), '.'),
        h2('12. Modification des CGU'),
        p('Les CGU peuvent évoluer. Les membres sont informés de toute modification importante avant son entrée en vigueur ; continuer à utiliser le service vaut acceptation de la nouvelle version.'),
        h2('13. Droit applicable'),
        p('Les présentes CGU sont soumises au droit français. En cas de litige, une solution amiable est recherchée en priorité ; à défaut, les tribunaux français sont compétents, sous réserve des règles protectrices du consommateur.'),
        p(h('small', null, `Dernière mise à jour : ${UPDATED}.`)),
      ],
    },

    cgv: {
      title: 'Conditions générales de vente',
      description: 'Droit d’entrée, paiement, rétractation et médiation pour le cercle AURUM.',
      body: [
        h2('1. Objet'),
        p('Les présentes conditions générales de vente (CGV) s’appliquent au droit d’entrée du réseau social privé AURUM, vendu par ', ...editor(), ' (', v('address'), ' — SIREN ', v('siren'), ') à des consommateurs.'),
        h2('2. Prix'),
        p(`Les ${limit} premières places, dites de Fondateur, sont gratuites et le restent à vie. Au-delà, l’entrée dans le cercle est soumise à un droit d’entrée unique de ${price} toutes taxes comprises, payé une seule fois : il n’y a ni abonnement, ni renouvellement, ni frais cachés.`),
        L.vat ? p(L.vat, '.') : null,
        h2('3. Commande et paiement'),
        p('Le paiement s’effectue par carte bancaire sur la page sécurisée de Stripe. AURUM n’a jamais accès à vos coordonnées bancaires. La commande est confirmée par l’affichage de votre carte de membre et par un courriel de bienvenue.'),
        h2('4. Accès et droit de rétractation'),
        p('L’accès au cercle est immédiat dès le paiement. Conformément à l’article L221-28 13° du Code de la consommation, en demandant cet accès immédiat et en cochant la case prévue à cet effet, vous reconnaissez renoncer à votre droit de rétractation de quatorze jours dès que l’accès vous est ouvert.'),
        h2('5. Remboursement'),
        p('En dehors des cas prévus par la loi (paiement en double, impossibilité d’accéder au service imputable à AURUM), le droit d’entrée n’est pas remboursable. Il reste acquis en cas de suppression du compte par le membre ou d’exclusion pour manquement grave aux CGU.'),
        h2('6. Service client'),
        p('Pour toute question ou réclamation : ', mail(), L.phone ? ` — ${L.phone}` : '', '. Une réponse vous est apportée sous 7 jours ouvrés.'),
        h2('7. Médiation de la consommation'),
        p('Après une réclamation écrite restée sans solution, vous pouvez recourir gratuitement au médiateur de la consommation : ', v('mediatorName'), L.mediatorUrl ? [' — ', h('a', { href: L.mediatorUrl, target: '_blank', rel: 'noopener' }, L.mediatorUrl)] : '', ' (articles L611-1 et suivants du Code de la consommation).'),
        h2('8. Garanties légales'),
        p('Vous bénéficiez de la garantie légale de conformité des contenus et services numériques (articles L224-25-12 et suivants du Code de la consommation).'),
        h2('9. Droit applicable'),
        p('Les présentes CGV sont soumises au droit français.'),
        p(h('small', null, `Dernière mise à jour : ${UPDATED}.`)),
      ],
    },

    confidentialite: {
      title: 'Politique de confidentialité',
      description: 'Données collectées, finalités, durées de conservation, cookies et droits RGPD sur AURUM.',
      body: [
        p('AURUM est un cercle privé : vos données servent uniquement à faire fonctionner le service. Elles ne sont jamais vendues, louées, ni utilisées à des fins publicitaires. Cette politique applique le Règlement général sur la protection des données (RGPD) et la loi Informatique et Libertés.'),
        h2('Responsable du traitement'),
        p(v('editorName'), ' — ', v('address'), '. Contact pour toute question sur vos données : ', mail(), '.'),
        h2('Données collectées'),
        table(
          ['Catégorie', 'Données'],
          [
            ['Compte', 'Nom, nom d’utilisateur, e-mail, mot de passe (chiffré, jamais lisible), numéro de membre'],
            ['Profil (facultatif)', 'Photo, présentation, métier, ville, site'],
            ['Admission', 'Présentation jointe à la demande, parrain éventuel'],
            ['Contenus', 'Publications, photos, vidéos, stories, commentaires, réactions, messages privés, événements, adresses recommandées'],
            ['Paiement', 'Montant, date et référence du paiement (les données bancaires restent chez Stripe)'],
            ['Technique', 'Cookie de connexion, abonnement aux notifications, journaux techniques de l’hébergeur'],
            ['Mesure d’audience', 'Pages vues, provenance et type d’appareil, comptés de façon anonyme et sans cookie'],
          ],
        ),
        h2('Finalités et bases légales'),
        table(
          ['Finalité', 'Base légale'],
          [
            ['Créer et gérer votre compte, afficher vos contenus aux membres', 'Exécution du contrat (CGU)'],
            ['Encaisser le droit d’entrée, tenir la comptabilité', 'Exécution du contrat, obligation légale'],
            ['Modération automatique et traitement des signalements', 'Intérêt légitime (sécurité des membres), obligation légale'],
            ['Sécurité du service, prévention de la fraude et du spam', 'Intérêt légitime'],
            ['Courriels de service (bienvenue, mot de passe, Lettre du cercle)', 'Exécution du contrat ; la Lettre se désactive dans vos réglages'],
            ['Notifications sur le téléphone', 'Consentement (demandé par votre téléphone)'],
            ['Mesure d’audience anonyme', 'Intérêt légitime (dispensée de consentement, vous pouvez vous y opposer)'],
          ],
        ),
        h2('Modération automatique'),
        p('Les publications, commentaires et messages sont analysés au moment de leur envoi par un filtre de mots et d’expressions qui fonctionne sur nos propres serveurs : aucun texte n’est transmis à un service extérieur pour cela. Un contenu bloqué ou masqué peut être contesté auprès de la Direction, qui le réexamine elle-même.'),
        h2('Destinataires et sous-traitants'),
        p('Vos contenus ne sont visibles que des membres autorisés (cercle, groupe, destinataire d’un message). Nos sous-traitants n’agissent que sur nos instructions :'),
        table(
          ['Prestataire', 'Rôle', 'Localisation'],
          [
            ['Vercel Inc.', 'Hébergement', 'Serveurs à Francfort ; société américaine'],
            ['Turso (ChiselStrike Inc.)', 'Base de données', 'Serveurs dans l’UE ; société américaine'],
            ['Stripe', 'Paiement du droit d’entrée', 'Irlande et États-Unis'],
            ['Brevo', 'Envoi des courriels', 'France'],
            ['Apple, Google, Mozilla', 'Acheminement des notifications', 'Selon votre téléphone'],
            ['MyMemory (Translated) ou DeepL', 'Traduction, uniquement quand vous la demandez', 'Italie, Allemagne'],
          ],
        ),
        p('Les transferts vers des sociétés américaines sont encadrés par le cadre de protection des données UE–États-Unis (Data Privacy Framework) ou par les clauses contractuelles types de la Commission européenne.'),
        h2('Durées de conservation'),
        table(
          ['Données', 'Durée'],
          [
            ['Compte et contenus', 'Tant que le compte existe ; effacés dès sa suppression'],
            ['Vidéos et stories', `${ttl} heures après leur publication, puis effacées définitivement`],
            ['Cookie de connexion', '30 jours, renouvelé à chaque connexion'],
            ['Demande d’admission refusée', '6 mois, puis supprimée'],
            ['Pièces comptables du paiement', '10 ans (obligation légale)'],
            ['Liens de réinitialisation du mot de passe', '1 heure'],
            ['Statistiques d’audience', '25 mois, sous forme de totaux anonymes'],
          ],
        ),
        h2('Sécurité'),
        p('Connexion chiffrée (HTTPS) imposée, mots de passe protégés par l’algorithme scrypt, cookie de session inaccessible aux scripts, protection contre les requêtes d’autres sites, blocage temporaire après plusieurs essais de mot de passe, accès à l’administration réservé à la Direction.'),
        h2('Cookies et traceurs', 'cookies'),
        p('AURUM n’utilise aucun cookie publicitaire, aucun réseau social tiers et aucun outil de mesure extérieur. Seuls des traceurs indispensables sont utilisés :'),
        table(
          ['Nom', 'Rôle', 'Durée'],
          [
            ['aurum_sid (cookie)', 'Vous garder connecté', '30 jours'],
            ['Stockage local de l’appareil', 'Retenir vos préférences (son, bandeaux fermés, choix sur la mesure d’audience)', 'Jusqu’à ce que vous l’effaciez'],
            ['Cache de l’application', 'Ouvrir l’application instantanément, même hors connexion', 'Jusqu’à la mise à jour suivante'],
          ],
        ),
        p('La mesure d’audience d’AURUM est faite par nos soins, sans cookie ni identifiant : elle compte des pages vues et ne permet pas de vous suivre d’une visite à l’autre ni sur d’autres sites. Elle respecte les conditions de dispense de consentement de la CNIL. Vous pouvez vous y opposer à tout moment : ', h('button', { type: 'button', class: 'link-btn', onclick: () => document.dispatchEvent(new CustomEvent('aurum:cookies')) }, 'gérer mon choix'), '. Le signal « Ne pas suivre » (Do Not Track / Global Privacy Control) de votre navigateur est également respecté.'),
        p('Lorsque vous lancez une vidéo intégrée au Journal (YouTube, Vimeo, Spotify…), ce service peut déposer ses propres traceurs, selon sa politique.'),
        h2('Vos droits'),
        p('Vous disposez des droits d’accès, de rectification, d’effacement, de limitation, de portabilité et d’opposition, ainsi que du droit de définir des directives sur le sort de vos données après votre décès.'),
        ul(
          'Modifier vos informations : Réglages → Profil.',
          'Télécharger toutes vos données : Réglages → Données → Exporter.',
          'Supprimer votre compte : Réglages → Données → Supprimer.',
          ['Toute autre demande : ', mail(), '. Réponse sous un mois.'],
        ),
        p('Si vous estimez que vos droits ne sont pas respectés, vous pouvez adresser une réclamation à la CNIL (3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07 — ', h('a', { href: 'https://www.cnil.fr/fr/plaintes', target: '_blank', rel: 'noopener' }, 'cnil.fr'), ').'),
        h2('Mineurs'),
        p('AURUM est réservé aux personnes majeures. Un compte créé par un mineur est supprimé dès que nous en avons connaissance.'),
        p(h('small', null, `Dernière mise à jour : ${UPDATED}.`)),
      ],
    },
  };
}

export async function legalView(ctx) {
  let d;
  try {
    d = await legalData();
  } catch {
    d = { legal: {}, priceCents: store.config?.priceCents || 999, currency: store.config?.currency || 'eur', founderLimit: store.config?.founderLimit || 100, videoTtlHours: 24 };
  }
  const page = pages(d)[ctx.route.page];
  ctx.title = `${page.title} — AURUM`;
  ctx.description = page.description;
  const content = h('article', { class: 'legal' }, page.body.filter(Boolean));
  if (store.isMember) return h('div', null, backHead(page.title), content);
  return h('div', null, siteTopbar(), h('div', { class: 'container narrow legal-page' }, h('h1', null, page.title), content), siteFooter());
}

