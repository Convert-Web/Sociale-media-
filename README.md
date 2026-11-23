# Vibz — des vidéos courtes, créées par toi

Application complète de vidéos courtes en plein écran, dans l'esprit des grands réseaux du genre :
fil « Pour toi » personnalisé par un algorithme, « Abonnements » et « Amis », commentaires, sons
réutilisables, Duo, Stitch, LIVE avec cadeaux, messagerie, profils, recherche, studio créateur et
administration. Entièrement en français, pensée d'abord pour le téléphone, installable comme une
application.

Vibz a sa propre identité (nom, logo, couleurs) : aucune marque, aucun logo ni aucun contenu d'un
autre service n'est repris. Les vidéos et musiques de démonstration sont générées par calcul
(`scripts/make-demo.js`).

---

## Fonctionnalités

| | |
|---|---|
| **Fil vertical** | Une vidéo par écran, glisser pour la suivante, lecture immédiate et préchargement des suivantes (téléchargement par morceaux, lecture progressive). Toucher : pause ; double toucher : J'aime avec cœur animé ; appui long : vitesse (×0,5 à ×2), « Pas intéressé », masquer un créateur, enregistrer, copier le lien, signaler. Barre de lecture déplaçable, son activable, flèches et raccourcis clavier sur ordinateur, indicateur d'attente du réseau. En revenant au fil (après un profil, une vidéo, les messages), on retrouve la même vidéo au même instant ; toucher à nouveau Accueil charge de nouvelles vidéos. Photos en carrousel et publications texte sur fond coloré dans le même fil. |
| **« Pour toi »** | Algorithme maison : qualité (J'aime, commentaires, partages, favoris, republications rapportés aux spectateurs), temps regardé, fraîcheur, coup de pouce aux nouvelles vidéos, variété (créateurs et sons), part de découverte, et centres d'intérêt appris de chaque compte (créateurs, hashtags, sons, catégories) qui s'estompent avec le temps. Choix des thèmes à l'inscription, remise à zéro et fil non personnalisé dans les réglages. Ouvert sans compte. |
| **Abonnements, Amis** | Vidéos et republications des comptes suivis ; onglet Amis (abonnements réciproques) avec comptes suggérés. |
| **Interactions** | J'aime, commentaires (réponses, J'aime, « Aimé par le créateur », épinglage, suppression, signalement, @mentions et #hashtags suggérés ; sur ordinateur, dans un panneau à côté de la vidéo), favoris privés, republications, partage (message à plusieurs amis, copier le lien, WhatsApp, Facebook, X, e-mail, SMS, partage du téléphone), enregistrement de la vidéo. |
| **Créer** | Caméra : 15 s, 60 s ou 3 min, en plusieurs prises (toucher ou maintenir), minuteur 3 s / 10 s, filtres, flash, caméra avant/arrière, son ajouté joué pendant le tournage. Import depuis l'appareil. Montage : textes (couleurs, fond, contour, taille) et autocollants déplaçables au doigt, filtres, son ajouté avec volumes, couverture choisie image par image. Description avec hashtags et mentions, catégorie, « Qui peut voir » (tout le monde, amis, moi), commentaires / Duo / Stitch / téléchargement autorisés ou non, brouillons gardés sur l'appareil. Mode Photo (jusqu'à 20 photos) et mode Texte. Envoi en arrière-plan, en qualité d'origine, reprenable après une coupure, avec sa vignette de progression en tête du profil ; la vidéo y prend sa place dès qu'elle est en ligne. Modifier, épingler ou supprimer une publication depuis le partage, l'appui long ou le clic droit. |
| **Sons** | Chaque vidéo crée son « son original », réutilisable par tous (« Utiliser ce son ») ; page du son (écoute, favoris, vidéos qui l'utilisent), bibliothèque de sons populaires et favoris. |
| **Duo et Stitch** | Duo : ta vidéo à côté de l'originale, sons mélangés. Stitch : jusqu'à 5 s de l'originale, puis ta suite. Montés dans le navigateur, autorisés ou non par chaque créateur. |
| **LIVE** | Passer en LIVE depuis la caméra (titre, retourner, couper le micro), abonnés prévenus, spectateurs avec ou sans compte, commentaires, cœurs, cadeaux animés, compteur de spectateurs, bilan (durée, spectateurs, cœurs, diamants, nouveaux abonnés). Vidéo directe entre appareils (WebRTC), reconnexion automatique. |
| **Pièces et cadeaux** | Portefeuille : recharges par Stripe Checkout (carte, Apple Pay, Google Pay) avec webhook signé et sans double crédit, ou achats simulés en développement ; 9 cadeaux ; les créateurs reçoivent des diamants ; historique. |
| **Profils** | Photo (recadrage), anneau LIVE, compteurs, Suivre / Message, comptes similaires, bio et lien, onglets Vidéos (épinglées en tête), Republications, Favoris, J'aime (privé par défaut) ; listes d'abonnés, d'abonnements et d'amis ; compte privé avec demandes d'abonnement ; bloquer, retirer un abonné, signaler. |
| **Explorer et recherche** | Catégories, hashtags tendance, vidéos populaires ; recherche avec suggestions et historique, onglets Top, Comptes, Vidéos, Sons, Hashtags, LIVE ; pages des hashtags. |
| **Boîte de réception** | Nouveaux abonnés, activité filtrable et regroupée (« Léa et 3 autres personnes ont aimé ta vidéo »), demandes d'abonnement, messagerie en temps réel (« Vu », « écrit… », vidéos partagées, émojis, signalement), réglage « Qui peut t'envoyer des messages ». |
| **Notifications** | Dans l'application et sur le téléphone (Web Push), selon les réglages de chacun. |
| **Studio créateur** | Vues, temps regardé, J'aime, commentaires, nouveaux abonnés et diamants sur 7, 28 ou 60 jours, graphique jour par jour avec tableau, meilleures vidéos, derniers LIVE. |
| **Confidentialité, sécurité** | Compte privé, vidéos aimées visibles ou non, blocages, filtre automatique des propos (refus ou avertissement + signalement), export des données (RGPD), suppression du compte, mots de passe chiffrés (scrypt), sessions httpOnly, protection CSRF, limitation des tentatives, CSP stricte, vérification binaire des fichiers, âge minimal de 13 ans. |
| **Administration** | Vue d'ensemble (comptes, vidéos, vues, LIVE, ventes, espace vidéo), signalements (supprimer, arrêter un LIVE, suspendre), comptes (badge vérifié, suspension, administrateurs), publications, audience sans cookie, informations légales, contenu de démonstration, erreurs des navigateurs. |
| **Application** | Thème clair / sombre (fil toujours sombre), installable (icônes, plein écran), mise à jour en un toucher, pages légales (mentions, CGU, CGV des pièces, confidentialité), aide et règles de la communauté. |

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
  sons sont ceux des vidéos publiées sur Vibz.
- **Rémunération** : les diamants sont comptés mais pas encore convertibles en argent (il faudrait
  Stripe Connect). Pas de publicité ni de boutique intégrée.

## Tests

```bash
npm test
```

24 tests couvrent l'inscription (âge, mot de passe, conditions), la connexion, la
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
  videos.js             Vidéos en morceaux de 1 Mo, diffusion par plages d'octets
  wallet.js, demo.js    Pièces et cadeaux ; contenu de démonstration
  routes/               API : auth, posts, comments, feed, discover, users, me, messages,
                        notifications, live, wallet, studio, stories, admin, moderation…
public/
  index.html, css/      Interface (application monopage, sans étape de compilation)
  js/components/        Fil vertical, lecteur, commentaires, partage, montage, envoi…
  js/views/             Accueil, Explorer, recherche, profil, création, LIVE, messages…
  demo/                 Vidéos de démonstration générées (scripts/make-demo.js)
scripts/                Génération de la démo, ajout de la démo dans la base
test/                   Tests d'intégration de l'API
```
