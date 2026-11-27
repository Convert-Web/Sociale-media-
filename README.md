# AURUM — des vidéos courtes, créées par toi

Application complète de vidéos courtes en plein écran, avec ce qui la distingue : **l'Actu**,
l'actualité du jour des médias (articles, podcasts, vidéos) à laquelle chacun peut **réagir en
vidéo**. Fil « Pour toi » personnalisé par un algorithme, « Abonnements » et « Amis », commentaires,
sons réutilisables, Duo, Stitch, LIVE avec cadeaux, messagerie, profils, recherche, studio créateur
et administration. Entièrement en français, pensée d'abord pour le téléphone, installable comme une
application.

AURUM a sa propre identité (nom, logo, couleurs) : aucune marque, aucun logo ni aucun contenu d'un
autre service n'est repris. Les vidéos et musiques de démonstration sont générées par calcul
(`scripts/make-demo.js`).

**Le design d’AURUM** : fond « encre » le soir, « papier » chaud le jour, dégradé de marque violet →
rose et touches d’or (le point qui marque l'onglet ouvert). Le logo, c'est « Au », le symbole de l'or
(numéro 79 du tableau des éléments, d'où le nom AURUM) : en dégradé violet → rose → or sur fond noir, dans
un cadre du même dégradé, avec le 79 en or ; la petite version (onglet du navigateur, en-tête de l'appli)
ne garde que « Au ». Formes douces (photos de profil et icônes en « squircle », boutons en pilule). Dans le fil, chaque vidéo ou photo
remplit tout l'écran, bord à bord et toujours cadrée de la même façon, sans flou ni voile sombre :
les onglets, la barre d'actions (J'aime, commentaires, favoris, partage), le nom avec son bouton
« Suivre » et le dock de navigation sont posés directement dessus, lisibles grâce à une ombre
discrète autour des lettres et des icônes. Titres en Bricolage Grotesque, textes en Inter
(polices libres, licence SIL OFL, servies par l'application : `public/fonts`).

---

## Fonctionnalités

| | |
|---|---|
| **Sujet du jour** | Chaque jour à 19 h (heure de Paris), le même sujet pour tout le monde, choisi automatiquement : un thème par jour de la semaine (débat le lundi, défi le mardi, l'actu du jour le mercredi — sujets sensibles écartés —, souvenir, pour rire, montre-nous, conseil), tiré d'une réserve où rien ne se répète. Notification à tous à 19 h (tâche planifiée Vercel, réglable dans Réglages → Notifications). On répond en vidéo (15 s proposées), en photo ou en texte ; les réponses des autres se débloquent une fois qu'on a répondu (page du sujet et « Pour toi »). Le lendemain, la réponse publique la plus aimée (sans compter son propre J'aime) gagne l'Or du jour, et son auteur est prévenu. Série de jours d'affilée, carte en tête du fil tant qu'on n'a pas répondu, puce « Sujet du jour » sur les réponses. Administration → Sujet du jour : les 7 prochains jours, sujet partenaire programmé avec un lot (il passe avant le choix automatique), réponses par jour. |
| **Fil vertical** | Une vidéo par écran, glisser pour la suivante, lecture immédiate et préchargement des suivantes (téléchargement par morceaux, lecture progressive). Toucher : pause ; double toucher : J'aime avec cœur animé ; appui long : vitesse (×0,5 à ×2), « Pas intéressé », masquer un créateur, enregistrer, copier le lien, signaler. Barre de lecture déplaçable, son activable, flèches et raccourcis clavier sur ordinateur, indicateur d'attente du réseau. En revenant au fil (après un profil, une vidéo, les messages), on retrouve la même vidéo au même instant ; toucher à nouveau Accueil charge de nouvelles vidéos. **Démarrage instantané** : pendant qu'on regarde, les vidéos suivantes se téléchargent (la prochaine en entier, celle d'après aussi sur une bonne connexion, le début des deux suivantes) et restent gardées sur le téléphone (environ 250 Mo, cache du service worker, conservé d'une visite à l'autre) ; les vidéos pas encore vues sont notées « À suivre », et à la prochaine ouverture le fil démarre aussitôt sur elles, sans attendre le serveur ni le réseau. Photos en carrousel et publications texte sur fond coloré dans le même fil. **Image fixe** : vidéos et photos en plein écran (une vidéo horizontale est recadrée au centre ; dans le montage, des bandes montrent ce qui sera coupé), le fil ne glisse que de haut en bas, les photos d'un carrousel seulement de côté, sans rebond, sans zoom à deux doigts et sans image qu'on traîne. |
| **L'Actu** | Onglet dédié : la une (choisie par l'administration ou la plus récente), « Le brief » des titres du moment, « Ça fait réagir » (l'actualité la plus commentée en vidéo), podcasts « À écouter » avec un lecteur qui continue de jouer pendant la navigation (commandes de l'écran verrouillé, reprise là où on s'était arrêté), vidéos des médias « À regarder » (lecteurs intégrés sans cookie), rubriques Monde, Économie, Tech, Sciences, Culture, Sport, Planète. Fiche de chaque actualité : résumé du média, « Lire sur … », partage, et **« Réagir en vidéo »** : la vidéo publiée porte « Réagit à : … » dans les fils et apparaît sur la fiche. Lu dans les flux publics des médias (RSS, chaînes YouTube, podcasts) relus toutes les 20 minutes ; seuls le titre, le court résumé, l'image et le lien sont gardés, jamais l'article. Sources gérées dans l'administration (ajout par adresse, recherche de podcasts, rubrique, retrait). |
| **« Pour toi »** | Algorithme maison : qualité (J'aime, commentaires, partages, favoris, republications rapportés aux spectateurs), temps regardé, fraîcheur, coup de pouce aux nouvelles vidéos, variété (créateurs et sons), part de découverte, et centres d'intérêt appris de chaque compte (créateurs, hashtags, sons, catégories) qui s'estompent avec le temps. Choix des thèmes à l'inscription, remise à zéro et fil non personnalisé dans les réglages. Ouvert sans compte. |
| **Abonnements, Amis** | Onglets du haut du fil : « Pour toi », « Abonnements » (vidéos et republications des comptes suivis), « Amis » (abonnements réciproques, comptes suggérés). |
| **Interactions** | J'aime, commentaires (réponses, J'aime, « Aimé par le créateur », épinglage, suppression, signalement, @mentions et #hashtags suggérés ; sur ordinateur, dans un panneau à côté de la vidéo), favoris privés, republications, partage (message à plusieurs amis, copier le lien, WhatsApp, Facebook, X, e-mail, SMS, partage du téléphone), enregistrement de la vidéo. |
| **Créer** | Caméra : image entière au format réel de la caméra (ce qu'on voit est ce qui est filmé), zoom comme sur l'iPhone (0,5× ultra grand-angle quand le téléphone en a un, 1×, 2×, et pincer pour ajuster, même pendant le tournage), 15 s, 60 s ou 3 min, en plusieurs prises (toucher ou maintenir), minuteur 3 s / 10 s, filtres, flash, caméra avant/arrière (changeable entre deux prises), son ajouté joué pendant le tournage. Import depuis l'appareil (vidéos .MOV d'iPhone comprises, H.264 ou HEVC, filmées debout ou à l'horizontale : durée et dimensions lues dans le fichier lui-même). Montage : textes (couleurs, fond, contour, taille) et autocollants déplaçables au doigt, filtres, son ajouté avec volumes, couverture choisie image par image. Description avec hashtags et mentions, catégorie, « Qui peut voir » (tout le monde, amis, moi), commentaires / Duo / Stitch / téléchargement autorisés ou non, brouillons gardés sur l'appareil. Mode Photo (jusqu'à 20 photos) et mode Texte. Envoi en arrière-plan, en qualité d'origine, reprenable après une coupure, avec sa vignette de progression en tête du profil ; la vidéo y prend sa place dès qu'elle est en ligne. Modifier, épingler ou supprimer une publication depuis le partage, l'appui long ou le clic droit. |
| **Sons** | Chaque vidéo crée son « son original », réutilisable par tous (« Utiliser ce son ») ; page du son (écoute, favoris, vidéos qui l'utilisent), bibliothèque de sons populaires et favoris. |
| **Duo et Stitch** | Duo : ta vidéo à côté de l'originale, sons mélangés. Stitch : jusqu'à 5 s de l'originale, puis ta suite. Montés dans le navigateur, autorisés ou non par chaque créateur. |
| **LIVE** | Passer en LIVE depuis la caméra (titre, retourner, couper le micro), abonnés prévenus, spectateurs avec ou sans compte, commentaires, cœurs, cadeaux animés, compteur de spectateurs, bilan (durée, spectateurs, cœurs, diamants, nouveaux abonnés). Vidéo directe entre appareils (WebRTC), reconnexion automatique. |
| **Pièces et cadeaux** | Portefeuille : recharges par Stripe Checkout (carte, Apple Pay, Google Pay) avec webhook signé et sans double crédit, ou achats simulés en développement ; 9 cadeaux ; les créateurs reçoivent des diamants ; historique. |
| **Profils** | Photo (recadrage), anneau LIVE, compteurs, Suivre / Message, comptes similaires, bio et lien, onglets Vidéos (épinglées en tête), Republications, Favoris, J'aime (privé par défaut) ; listes d'abonnés, d'abonnements et d'amis ; compte privé avec demandes d'abonnement ; bloquer, retirer un abonné, signaler. |
| **Faire venir, faire rester** | **Invitations** : chacun a son lien « Rejoins-moi sur AURUM » (Profil → menu, Boîte de réception, carte « Bien démarrer ») ; la personne invitée arrive sur une page d'entrée à son nom (« Camille t'invite sur AURUM »), et à son inscription elle suit déjà celle qui l'a invitée, qui est prévenue (« a rejoint AURUM grâce à ton invitation », avec de quoi suivre en retour) ; le nombre d'amis venus grâce à soi s'affiche. **Vidéo partagée** : un lien vers une vidéo s'ouvre même sans compte, avec « Rejoindre AURUM » (le reste de l'application demande un compte). **Liens qui donnent envie de cliquer** : collé dans WhatsApp, iMessage, Snapchat, Instagram, Messenger ou X, chaque lien a son propre aperçu, une image dessinée par le serveur aux couleurs d'AURUM : l'image de la vidéo avec le nom, la légende et « Regarder sur AURUM » ; « Camille t'invite sur AURUM » avec sa photo pour une invitation ; la question pour le Sujet du jour (avec le nombre de réponses et un bouton Partager sur sa page) ; le profil, le LIVE en cours, l'actualité, le hashtag ou le son. Rien de privé n'y apparaît : seul ce qu'une personne sans compte peut voir est décrit. **Séries 🔥** : deux personnes qui s'écrivent chacune chaque jour (heure de Paris) font monter leur série, affichée dans les conversations ; ⏳ et un rappel dans la conversation quand elle s'arrête ce soir. **Bien démarrer** : sur son profil, une carte suit 5 étapes (photo, bio, suivre 3 comptes, première vidéo, inviter un ami) et propose la prochaine d'un toucher. **Ouverture instantanée** : la dernière session connue sur le téléphone s'affiche tout de suite, confirmée par le serveur juste après. |
| **Explorer et recherche** | Catégories, hashtags tendance, vidéos populaires ; recherche avec suggestions et historique, onglets Top, Comptes, Vidéos, Sons, Hashtags, LIVE ; pages des hashtags. |
| **Boîte de réception** | Nouveaux abonnés, activité filtrable et regroupée (« Léa et 3 autres personnes ont aimé ta vidéo »), demandes d'abonnement, messagerie en temps réel (« Vu », « écrit… », vidéos partagées, émojis, signalement), réglage « Qui peut t'envoyer des messages ». |
| **Notifications** | Dans l'application ouverte : une bannière descend du haut de l'écran (photo de la personne, aperçu, vignette de la vidéo ; toucher pour ouvrir, glisser vers le haut pour fermer) avec un son maison court et pétillant, synthétisé dans le navigateur (aucun fichier) ; rien pendant le tournage ou un LIVE, et une petite bulle sonore seulement dans la conversation ouverte. Sur le téléphone (Web Push) : le nom et la photo de la personne en titre, les messages d'une même personne regroupés (« 3 nouveaux messages »), les J'aime d'une même vidéo aussi (« Léa et 2 autres personnes… », mis à jour sans resonner), et la pastille de l'icône de l'application indique le nombre de nouveautés. Réglages : son et bannières sur cet appareil, et choix de ce qui prévient (messages, commentaires, mentions, abonnés, LIVE, J'aime et cadeaux). |
| **Studio créateur** | Vues, temps regardé, J'aime, commentaires, nouveaux abonnés et diamants sur 7, 28 ou 60 jours, graphique jour par jour avec tableau, meilleures vidéos, derniers LIVE. |
| **Confidentialité, sécurité** | Compte privé, vidéos aimées visibles ou non, blocages, filtre automatique des propos (refus ou avertissement + signalement), export des données (RGPD), suppression du compte, mots de passe chiffrés (scrypt), sessions httpOnly, protection CSRF, limitation des tentatives, CSP stricte, vérification binaire des fichiers, âge minimal de 13 ans. |
| **Administration** | Vue d'ensemble (comptes, vidéos, vues, LIVE, ventes, espace vidéo), signalements (supprimer, arrêter un LIVE, suspendre), comptes (badge vérifié, suspension, administrateurs), publications, audience sans cookie, informations légales, contenu de démonstration, erreurs des navigateurs. |
| **Page d'entrée** | Sans compte, on arrive d'abord sur une page d'entrée (« Créer un compte », « J'ai déjà un compte ») : le fil, l'Actu, les profils et les liens partagés sont réservés aux membres. Un lien partagé est gardé en mémoire (« Connecte-toi pour voir la vidéo de @… ») et s'ouvre juste après la connexion ou l'inscription. L'aide et les pages légales restent ouvertes. |
| **Application** | Thème clair / sombre (fil toujours sombre), installable (icônes, plein écran), **mises à jour automatiques** (nouvelle version cherchée toutes les minutes et à chaque réponse du serveur, téléchargée en arrière-plan, mise en place d'un bloc quand l'application passe en arrière-plan, à l'ouverture ou au changement d'écran ; jamais pendant un envoi, à la caméra, en LIVE ou pendant qu'on écrit), pages légales (mentions, CGU, CGV des pièces, confidentialité), aide et règles de la communauté. |

## Qualité, sécurité, conformité

- **Sécurité** : HTTPS imposé (redirection et HSTS « preload »), politique de sécurité du contenu
  (CSP), cookie de session `HttpOnly`/`Secure`/`SameSite`, en-tête anti-CSRF sur toute l'API,
  mots de passe chiffrés (scrypt) ; aucune clé d'API côté navigateur (Stripe, Brevo, traduction,
  base de données : uniquement sur le serveur).
- **Anti-spam** : limites par adresse IP (connexion, créations de compte, API), champ piège et
  délai minimal à l'inscription, rafales limitées par compte (publications, commentaires,
  messages), compte bloqué après des essais de mot de passe ratés, e-mails jetables refusés,
  filtre des propos.
- **Accessibilité** : contrastes AA (4,5:1) en thème clair et sombre, textes de remplacement des
  images, libellés des champs et des boutons ; audit axe-core sans aucune erreur sur 21 pages.
- **Référencement** : titre et description par page, aperçu des liens (Open Graph, X/Twitter)
  avec adresses complètes, propre à chaque lien partagé (page servie par le serveur, image
  1200 × 630 de moins de 300 Ko gardée par le CDN), `robots.txt`, `sitemap.xml`, vraie page 404.
- **Qualité des vidéos** : vidéos importées publiées telles quelles, jamais recompressées ;
  caméra de l'appli en 1080p à 16 Mb/s (le débit de l'appareil photo de l'iPhone) et son à
  192 kb/s ; montages (son ajouté, Duo, Stitch) en 1080p au même débit ; photos jusqu'à 2560 px ;
  images d'aperçu des vidéos en 1440 px.
- **Vitesse** : écrans rares (caméra, LIVE, portefeuille, studio, administration) chargés à la
  demande, icônes compressées (pngquant), cache long des polices et images, application gardée
  sur le téléphone (service worker), ouverture instantanée.
- **Données personnelles** : politique de confidentialité (RGPD) complète, CGU, CGV, mentions
  légales (informations de l'éditeur à saisir dans Administration → Légal), bannière cookies
  (refuser aussi simple qu'accepter), mesure d'audience anonyme sans cookie.

## Démarrer sur son ordinateur

Prérequis : **Node.js 20.12 ou plus récent**.

```bash
npm install
npm run seed     # facultatif : 12 comptes et 14 vidéos de démonstration
npm start        # → http://localhost:3000
```

Le premier compte créé devient administrateur. Sans configuration, les données sont dans
`data/vibz.db`, les courriels s'affichent dans la console et les achats de pièces sont simulés.
La caméra et le LIVE demandent `localhost` ou une adresse en `https://`.

## Mettre en ligne

### Vercel + Turso (gratuit, sans serveur à gérer)

1. Crée une base sur [turso.tech](https://turso.tech) (région Europe) ; copie son adresse `libsql://…` et un jeton.
2. Importe ce dépôt sur [vercel.com](https://vercel.com) ; dans **Environment Variables**, ajoute `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN`.
3. Déploie, ouvre le site et crée ton compte en premier (administrateur).

Sur Vercel, messages et notifications se rafraîchissent toutes les quelques secondes (pas de
connexion permanente ; environ 5 s sur la Boîte, les messages et l'Activité) ; le LIVE fonctionne
aussi, sa signalisation passant par des requêtes.

### Serveur classique (Railway, Fly.io, Render, VPS…)

```bash
NODE_ENV=production BASE_URL=https://ton-domaine.fr npm start
```

Avec Turso, ou un disque persistant pour `DATA_DIR`. Messages et notifications y arrivent
instantanément (Server-Sent Events).

### À configurer pour un lancement public

- **Paiements** : `STRIPE_SECRET_KEY` et le webhook `https://ton-domaine/api/billing/webhook`
  (événements `checkout.session.completed` et `checkout.session.async_payment_succeeded`) dans `STRIPE_WEBHOOK_SECRET`.
- **Courriels** : `BREVO_API_KEY` et `MAIL_FROM` (expéditeur validé), ou `SMTP_URL`.
- **LIVE** : un serveur TURN (`TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`) rend le direct fiable sur tous les réseaux.
- **Informations légales** : Administration → Légal (éditeur, SIREN, médiateur…).
- **Démo** : retire le contenu de démonstration (Administration → Démo) avant d'ouvrir au public.

Toutes les options sont décrites dans [`.env.example`](.env.example).

## Reprise de la base d'AURUM

Une base de l'ancienne application est reprise automatiquement au premier démarrage : comptes,
vidéos, abonnements et messages sont conservés. AURUM étant un cercle privé, **ses comptes
deviennent privés** (contenus visibles de leurs seuls abonnés, réglable ensuite par chacun), et les
publications des groupes privés restent visibles de leur seul auteur.

## Ce qui diffère d'un géant du secteur

Tout ce qui est listé ci-dessus fonctionne réellement ; certains éléments sont toutefois
dimensionnés pour une communauté qui démarre :

- **Algorithme** : il classe jusqu'à 500 vidéos candidates à chaque page, ce qui suffit largement
  au lancement ; à très grande échelle, il faudrait un index de candidats précalculé.
- **LIVE** : chaque spectateur reçoit l'image directement du téléphone du créateur (25 spectateurs
  par défaut, `LIVE_MAX_VIEWERS`). Pour des milliers de spectateurs, il faut un serveur média (SFU).
- **Montage** : filtres, textes et autocollants sont appliqués à la lecture (la vidéo d'origine
  n'est jamais recompressée) ; les sons ajoutés, Duos et Stitchs sont montés dans le navigateur, en
  temps réel. Pas d'effets de réalité augmentée ni de bibliothèque de musiques sous licence : les
  sons sont ceux des vidéos publiées sur AURUM.
- **Rémunération** : les diamants sont comptés mais pas encore convertibles en argent (il faudrait
  Stripe Connect). Pas de publicité ni de boutique intégrée.

## Tests

```bash
npm test
```

36 tests couvrent l'Actu (lecture des flux, rubriques, « À la une », sources, réactions en vidéo,
protection contre les adresses internes), les corrections de l'audit (recherche sans accents,
confidentialité des suggestions, compteurs, anciens noms d'utilisateur, présence sans connexion
permanente),  l'inscription (âge, mot de passe, conditions), la connexion, la
publication, la confidentialité (moi, amis, compte privé), le fil « Pour toi » (y compris « Pas
intéressé »), Abonnements et Amis, J'aime, favoris, republications, vues et temps regardé, les
commentaires (réponses, épinglage), les demandes d'abonnement, les blocages, les messages, la
recherche, les sons, Duo, le profil, le LIVE (signalisation, chat, cœurs, cadeaux, bilan), le
portefeuille, le studio, la modération, la suppression de compte, le mot de passe oublié, le contenu
de démonstration, les adresses des pages et la reprise d’une base AURUM (y compris des membres
arrivés après une première ouverture).

## Architecture

```
server.js               Point d'entrée (Vercel ou serveur classique)
src/
  application.js        Application Express (sécurité, routes, fichiers statiques)
  db.js                 Schéma, migrations, reprise d'une base AURUM
  feed.js               Algorithme « Pour toi », Abonnements, Amis, centres d'intérêt
  social.js             Sérialisation, visibilité, notifications
  share.js, cards.js    Aperçus des liens partagés : balises de la page et image dessinée
  assets/fonts/         Polices des images d'aperçu (Inter, Bricolage Grotesque, Noto Sans Arabic)
  videos.js             Vidéos en morceaux de 1 Mo, diffusion par plages d'octets
  wallet.js, demo.js    Pièces et cadeaux ; contenu de démonstration
  journal.js            L'Actu : lecture sûre des flux (RSS, Atom, YouTube, podcasts), lecteurs intégrés
  routes/               API : auth, posts, comments, feed, discover, users, me, messages,
                        notifications, live, wallet, studio, stories, admin, moderation, actu…
public/
  index.html, css/      Interface (application monopage, sans étape de compilation)
  js/components/        Fil vertical, lecteur, commentaires, partage, montage, envoi…
  js/views/             Accueil, Explorer, recherche, profil, création, LIVE, messages…
  demo/                 Vidéos de démonstration générées (scripts/make-demo.js)
scripts/                Génération de la démo, ajout de la démo dans la base
test/                   Tests d'intégration de l'API
```
