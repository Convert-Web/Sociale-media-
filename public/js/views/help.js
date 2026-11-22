// Aide (questions fréquentes) et règles de la communauté.
import { store } from '../store.js';
import { navigate } from '../router.js';
import { h, icon } from '../dom.js';

const back = () => h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate(store.user ? '/reglages' : '/')) }, icon('back'));
const qa = (q, ...a) => h('details', { class: 'faq' }, h('summary', null, q), h('div', { class: 'faq-a' }, ...a.map((x) => (typeof x === 'string' ? h('p', null, x) : x))));

export function helpView(ctx) {
  ctx.title = 'Aide — Vibz';
  ctx.description = 'Questions fréquentes : regarder, créer, LIVE, messages, confidentialité.';
  return h(
    'div',
    { class: 'page help' },
    h('header', { class: 'page-head' }, back(), h('h1', null, 'Aide'), h('span', { class: 'icon-btn' })),
    h('h2', { class: 'section-title' }, 'Regarder'),
    qa('Comment marche « Pour toi » ?', 'Le fil mêle les vidéos populaires du moment, des nouveautés qui cherchent leur public et des vidéos proches de ce que tu aimes : les comptes, hashtags, sons et thèmes que tu regardes jusqu’au bout, aimes, commentes ou partages. Passer vite une vidéo ou la marquer « Pas intéressé » compte aussi.', 'Tu peux remettre ton fil à zéro, ou le rendre non personnalisé : Réglages → Confidentialité.'),
    qa('Les gestes', 'Glisse vers le haut pour la vidéo suivante. Touche une fois pour mettre en pause, deux fois pour aimer. Reste appuyé pour les options : vitesse de lecture, « Pas intéressé », enregistrer, signaler. Sur ordinateur : flèches haut et bas, espace pour la pause, M pour le son, L pour aimer.'),
    qa('Pourquoi la vidéo démarre sans le son ?', 'Les navigateurs coupent le son tant que tu n’as pas touché l’écran. Touche « Activer le son » : il reste activé pour toute la visite.'),
    h('h2', { class: 'section-title' }, 'Créer'),
    qa('Publier une vidéo', 'Touche + : filme directement (15 s, 60 s ou 3 min, en plusieurs prises, avec minuteur et filtres) ou importe une vidéo de ton appareil. Ajoute des textes, des autocollants, un filtre et un son, choisis ta couverture, écris ta description avec #hashtags et @mentions, puis publie.', 'La vidéo part en arrière-plan, en qualité d’origine : tu peux continuer à regarder des vidéos pendant l’envoi. Après une coupure, l’envoi reprend là où il s’était arrêté.'),
    qa('Utiliser le son d’une autre vidéo', 'Touche le disque qui tourne, en bas à droite d’une vidéo, puis « Utiliser ce son ». Le son est mêlé à ta vidéo pendant le tournage.'),
    qa('Duo et Stitch', 'Dans « Partager » : le Duo place ta vidéo à côté de l’originale ; le Stitch reprend jusqu’à 5 secondes de l’originale avant la tienne. Chaque créateur peut les autoriser ou non pour chacune de ses vidéos.'),
    qa('Brouillons', 'À la dernière étape, « Brouillon » garde ta vidéo et ta description sur cet appareil pour plus tard (bouton + → Brouillons).'),
    h('h2', { class: 'section-title' }, 'LIVE et cadeaux'),
    qa('Passer en LIVE', 'Va dans LIVE → « Passer en LIVE », autorise la caméra et le micro, donne un titre. Tes abonnés sont prévenus. Les spectateurs peuvent commenter, envoyer des cœurs et des cadeaux.', 'L’image passe directement de ton appareil à ceux des spectateurs : une bonne connexion (Wi-Fi ou 4G/5G) est conseillée.'),
    qa('Pièces et diamants', 'Les pièces s’achètent dans le Portefeuille et servent à offrir des cadeaux pendant les LIVE. Le créateur reçoit des diamants (un par pièce).'),
    h('h2', { class: 'section-title' }, 'Compte et confidentialité'),
    qa('Compte privé', 'Réglages → Confidentialité → Compte privé : seules les personnes que tu acceptes voient tes vidéos. Pour chaque vidéo, tu choisis aussi qui la voit (tout le monde, tes amis, ou toi uniquement).'),
    qa('Bloquer ou signaler', 'Depuis un profil (« … ») : Bloquer empêche ce compte de te voir, te suivre, te commenter et t’écrire. Signaler transmet le contenu à l’équipe de modération, de façon anonyme.'),
    qa('Notifications', 'Réglages → Notifications. Sur iPhone, ajoute d’abord Vibz à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis ouvre-le depuis l’icône.'),
    qa('Installer l’application', 'Sur Android et ordinateur : menu du navigateur → « Installer l’application ». Sur iPhone : Partager → « Sur l’écran d’accueil ». Vibz s’ouvre alors en plein écran, comme une application.'),
    h('h2', { class: 'section-title', id: 'apparence' }, 'Apparence'),
    h('p', { class: 'muted' }, 'Clair, sombre ou comme l’appareil : Réglages → Apparence. Le fil des vidéos reste toujours sombre.'),
    h('p', { class: 'help-links' }, h('a', { href: '/regles' }, 'Règles de la communauté'), ' · ', h('a', { href: '/cgu' }, 'Conditions d’utilisation'), ' · ', h('a', { href: '/confidentialite' }, 'Confidentialité'), ' · ', h('a', { href: '/mentions-legales' }, 'Contact')),
  );
}

export function rulesView(ctx) {
  ctx.title = 'Règles de la communauté — Vibz';
  const rule = (emoji, title, text) => h('div', { class: 'rule' }, h('span', { class: 'rule-emoji' }, emoji), h('div', null, h('h3', null, title), h('p', null, text)));
  return h(
    'div',
    { class: 'page rules' },
    h('header', { class: 'page-head' }, back(), h('h1', null, 'Règles de la communauté'), h('span', { class: 'icon-btn' })),
    h('p', { class: 'lead' }, 'Vibz est un endroit pour créer, rire, apprendre et partager. Ces règles s’appliquent aux vidéos, photos, sons, descriptions, commentaires, messages, LIVE et profils.'),
    rule('🤝', 'Respect', 'Pas de harcèlement, d’insultes, de menaces ni de propos haineux visant une personne ou un groupe (origine, religion, genre, orientation, handicap…).'),
    rule('🛡️', 'Sécurité des mineurs', 'Aucun contenu sexualisant des mineurs, aucune sollicitation. Les comptes de moins de 13 ans sont interdits.'),
    rule('🔞', 'Nudité et contenu sexuel', 'Nudité, actes sexuels et contenus pornographiques sont interdits.'),
    rule('⚠️', 'Violence et actes dangereux', 'Pas de violence réelle, de contenus choquants, ni de défis qui mettent en danger (soi ou les autres).'),
    rule('🎭', 'Authenticité', 'Pas d’usurpation d’identité, de faux comptes, de spam, d’arnaques ni de manipulation des J’aime ou des vues.'),
    rule('©️', 'Propriété intellectuelle', 'Ne publie que ce que tu as le droit de publier : tes images, tes sons, ou ceux d’autres créateurs de Vibz via Duo, Stitch et « Utiliser ce son ».'),
    rule('🔒', 'Vie privée', 'Ne publie pas les informations personnelles de quelqu’un (adresse, téléphone, documents) ni d’images de personnes sans leur accord.'),
    h('h2', { class: 'section-title' }, 'Ce qui se passe en cas de manquement'),
    h('p', null, 'Les contenus signalés sont examinés. Selon la gravité : contenu masqué ou retiré, LIVE arrêté, compte suspendu. Tu peux contester une décision en écrivant à l’adresse des mentions légales.'),
  );
}
