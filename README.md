# AURUM — Le cercle privé

Réseau social privé : chaque membre reçoit une carte numérotée, à vie. Pas de publicité, pas de faux comptes, pas d'algorithme.

L'entrée est **gratuite pour les 100 premiers membres** (les Fondateurs). Ensuite, elle devient automatiquement payante : droit d'entrée unique de 9,99 € via Stripe, après invitation d'un membre ou accord de la Direction. `PAID_ENTRY=true` rend l'entrée payante dès le départ.

Design minimaliste inspiré d'Apple, pensé **d'abord pour le téléphone** (barre d'onglets, feuilles, contrôles natifs), clair ou sombre selon l'appareil, entièrement en français. Typographie système (SF Pro sur iPhone et Mac, Inter ailleurs, hébergée avec le site).

---

## Fonctionnalités

| | |
|---|---|
| **Droit d'entrée** | Gratuit pour les `FOUNDER_LIMIT` (100) premiers membres, puis automatique : paiement unique via **Stripe Checkout** (carte bancaire, et Apple Pay / Google Pay selon votre configuration Stripe), vérifié côté serveur + webhook signé. Case de renonciation au droit de rétractation (art. L221-28 du Code de la consommation). |
| **Fondateurs** | Les 100 premiers membres : entrée gratuite à vie, **carte Fondateur** (métal noir, trame pop art) et **avant-premières** — les annonces de la Direction leur sont réservées 24 h, 48 h ou 7 jours avant d'être publiées pour tous, et les événements de la Direction s'ouvrent d'abord à eux pendant 48 h. Pas de couronne ni d'insigne à côté du nom. |
| **Vidéos** | **Gardées** sur le profil tant que leur auteur ne les supprime pas (une durée de vie peut être réglée avec `VIDEO_TTL_HOURS`) ; les stories, elles, s'effacent après 24 h. Une vidéo par publication (une minute au plus), dans le Salon et les groupes. **Préparation rapide** : le téléphone la convertit avec ses circuits vidéo (WebCodecs, librairie Mediabunny 1.65.2, MPL-2.0, dans `public/js/vendor`), plusieurs fois plus vite que le temps réel et sans image perdue, en **1080p H.264** (~3,1 Mbit/s) avec le son d'origine ; sinon, ancienne méthode (rejouée en temps réel, 2,1 Mbit/s). Elle part **pendant** la préparation, en morceaux de 1 Mo (limite de 4,5 Mo de Vercel respectée ; « Réessayer » après une coupure ne refait que l'envoi). **Lecture progressive** façon TikTok (MediaSource, ManagedMediaSource sur iPhone) : la vidéo démarre dès son premier morceau, avec retour automatique à la lecture classique au moindre souci. **Plein écran vertical** : onglets « Pour toi » (vidéos pas encore vues d'abord, sans algorithme) et « Abonnements », barre de lecture déplaçable, appui long (vitesse ×0,5 à ×2, pas intéressé, masquer un membre, garder, copier le lien, signaler), vues, « Son original », J'aime et réponses sur les commentaires. Espace réservé : `VIDEO_STORAGE_MB` (3 000 Mo par défaut, la base Turso gratuite fait 5 Go). |
| **Rapide comme une appli** | L'application est gardée sur le téléphone (service worker) : elle s'ouvre sans attendre le réseau. Quand une nouvelle version est en ligne (annoncée par le serveur à chaque réponse), un bouton bleu clair **« Mettre à jour »** apparaît : un toucher vide le cache d'un bloc et charge la nouvelle version complète, jamais un mélange. Onglet **Vidéos** dans la barre du bas, double-toucher pour aimer, **stories vidéo**. |
| **Filtre automatique** | Publications, commentaires et messages privés sont analysés à l'envoi (français, anglais, espagnol, italien, allemand, portugais ; écriture « l33t », lettres répétées ou espacées, astérisques). Propos haineux, menaces et numéros de carte bancaire : refusés. Insultes et propos déplacés : publiés mais floutés derrière un avertissement, et signalés automatiquement à la Direction. Les messages privés reçus peuvent être signalés (appui long). |
| **Entrée sur invitation** | Par défaut, on entre au cercle **sur invitation** : chaque membre dispose de 3 invitations personnelles (lien à partager sur WhatsApp, iMessage…), la personne invitée entre immédiatement. Sans invitation, l'inscription devient une **demande d'admission** que la Direction accepte ou refuse (notification sur le téléphone). Interrupteur « Entrée sur invitation » dans la page Direction pour revenir à l'entrée libre. Le profil affiche « Invité par… ». |
| **Agenda du cercle** | Événements privés (dîners, vernissages, voyages) : photo, date, lieu avec itinéraire, nombre de places, « Je viens », liste des participants, ajout au calendrier du téléphone (.ics), carte « Prochain événement » en tête du Salon. |
| **Carnet d'adresses** | Les recommandations des membres (restaurants, hôtels, bars, boutiques, artisans, bien-être, services, voyages) par ville et catégorie, avec photo, itinéraire, site web et « Je recommande aussi ». |
| **Membre vérifié** | Badge bleu attribué par la Direction depuis le profil d'un membre, affiché à côté de son nom partout. |
| **Le Journal** | Actualités, podcasts et vidéos : sources relues automatiquement toutes les 20 minutes (France 24, Robb Report, Wallpaper*, Dezeen, L’Heure du Monde, GDIY, La Martingale, chaînes YouTube…), mise en page magazine (« À la une », « À écouter », « À regarder »), lecteur de podcasts qui continue pendant la navigation (commandes de l’écran verrouillé, reprise là où l’on s’était arrêté), vidéos YouTube / Vimeo / Dailymotion et podcasts Spotify / Apple jouées dans l’application. Chaque membre peut partager un lien ; la Direction gère les sources (site, flux RSS, chaîne YouTube, recherche de podcast par nom) et choisit la une. |
| **Comptes automatiques** | **AURUM** (compte officiel) publie dans le Salon les contenus du Journal (toutes les 4 h, de 8 h à 23 h), une question du jour pour lancer la conversation, les nouveaux événements de l'Agenda, et souhaite la bienvenue à chaque nouveau membre. **Le Concierge** envoie un message d'accueil et met en avant l'adresse de la semaine du Carnet. Ils portent l'étiquette « Automatique », n'ont pas de numéro de membre, ne comptent pas dans les effectifs et ne peuvent pas se connecter. Interrupteur dans la page Direction (ou `BOTS=off`). |
| **Courriels** | Bienvenue à l'admission (avec la carte de membre), accusé de réception d'une demande d'admission (et alerte à la Direction), mot de passe oublié, et **la Lettre du cercle** chaque dimanche matin (événements, meilleures publications, Journal, adresse de la semaine, nouveaux membres) avec lien de désinscription. Envoi par Brevo (gratuit, 300 courriels par jour). Essais et aperçu dans la page Direction. |
| **Traduction automatique** | Sous chaque publication, commentaire, message privé ou contenu du Journal écrit dans une autre langue : « Voir la traduction », puis « Voir l'original ». Langue détectée sur le serveur (sans service extérieur), traduction gratuite par MyMemory (ou DeepL avec `DEEPL_API_KEY`), chaque texte n'est traduit qu'une fois. Langue choisie dans Réglages → Traduction (par défaut celle du téléphone). |
| **Carte de membre** | Numéro unique attribué dans l'ordre d'arrivée et **jamais réattribué**. Carte en titane clair, en **or** pour les 100 premiers « Fondateurs ». Cérémonie d'accueil à l'inscription. Le premier compte créé devient administrateur. |
| **Le Salon** | Fil chronologique « Tout le cercle » / « Mes abonnements », publications avec jusqu'à 6 photos (carrousel), modification, commentaires, #hashtags, @mentions avec suggestions, défilement infini, bandeau « nouvelles publications ». |
| **Réactions** | ❤️ 👍 👏 🔥 😂 😮 : un toucher pour ❤️, appui long (ou survol) pour choisir, liste des membres qui ont réagi. |
| **Stories** | Photos éphémères (24 h) avec légende, lecteur plein écran (progression, toucher pour avancer, appui long pour pause, glisser pour fermer), vues, réponse en message privé. |
| **Enregistrés** | Mettre une publication de côté et la retrouver dans « Enregistrés ». |
| **Brouillons** | Texte, photos et vidéo gardés sur le téléphone (bouton « Brouillon » de la fenêtre de publication), à reprendre et publier plus tard (bouton + → « Brouillons »). |
| **Sécurité** | Signaler une publication, un commentaire ou un membre ; bloquer un membre (contenus masqués, messages impossibles) ; file des signalements dans « Direction ». |
| **Application** | Installable sur l'écran d'accueil (icône, plein écran), accueil guidé des nouveaux membres. |
| **Profils** | Mise en page inspirée de X : couverture 3:1, photo qui chevauche, onglets soulignés « Publications / Vidéos / Photos » (vidéos en grille avec leurs vues). **Outil de recadrage** (glisser, pincer, zoom) pour la photo de profil et la couverture : jamais d'image étirée. Visionneuse animée (glisser vers le bas pour fermer). |
| **Amis** | Demandes d'ami façon Facebook : Ajouter → Demande envoyée → Accepter / Refuser, liste d'amis, « Vous connaissez peut-être », bandeau dans Activité et badge rouge. Accepter une demande abonne les deux membres l'un à l'autre. |
| **Groupes privés** | Création avec couverture, invitation de membres, demandes d'adhésion validées par le créateur ou les admins du groupe, rôles (créateur / admin / membre), discussion réservée aux membres. Les publications d'un groupe n'apparaissent jamais dans le Salon, les profils, la recherche ou les tendances. |
| **Messagerie privée** | Conversations entre membres **en temps réel**, accusés de lecture « Vu », compteurs de non-lus. |
| **Notifications** | Réactions, commentaires, abonnés, mentions, demandes d'ami, invitations de groupe. **Notifications sur le téléphone** (Web Push) à chaque message privé, demande d'ami ou invitation — à activer dans Réglages › Notifications. Sur iPhone : ajouter d'abord AURUM à l'écran d'accueil (iOS 16.4+). Clés VAPID générées automatiquement, rien à configurer. |
| **Explorer** | Recherche (membres, métiers, villes, #sujets), tendances, suggestions, derniers arrivés. |
| **Direction (admin)** | Membres, chiffre d'affaires, conversion, inscriptions sur 14 jours, derniers paiements, exclusion de membres, modération des publications. |
| **RGPD** | Export de toutes ses données en un clic, suppression du compte, aucun traceur, polices hébergées localement. |
| **Sécurité** | Mots de passe chiffrés (scrypt), sessions httpOnly, protection CSRF, limitation des tentatives, CSP stricte, vérification binaire des images envoyées. |
| **Pages légales** | Mentions légales, **CGU**, **CGV** et politique de confidentialité **RGPD** (`/rgpd`, section `#cookies`). Les informations de l'éditeur (nom, adresse, SIREN, médiateur…) se saisissent dans **Direction → Informations légales** : elles restent dans la base, jamais dans le code. |
| **Mesure d'audience** | Faite maison, **sans cookie ni identifiant** : visites, pages vues, provenance (TikTok, Instagram…), campagnes `?utm_source=`, appareils, dans **Direction → Audience**. Refus possible depuis la bannière cookies ; « Ne pas suivre » respecté ; la Direction n'est pas comptée. |
| **Anti-spam** | Champ piège et délai minimal à l'inscription, adresses jetables refusées, 8 inscriptions par heure et par adresse IP, compte bloqué 15 min après 8 mots de passe erronés, limites de publications, commentaires, messages et stories, un courriel de mot de passe toutes les 2 minutes. |
| **Référencement** | Titre et description par page, adresse canonique, image de partage 1200×630 (`/img/og.jpg`), `favicon.ico`, `robots.txt` et `sitemap.xml` (adresse réelle du site), **vraie page 404** (statut 404). |

## Mettre le site en ligne gratuitement (Vercel + Turso)

Deux services gratuits, **sans carte bancaire**, avec connexion par GitHub :

- **Turso** garde les données (comptes, publications, messages, photos) : 5 Go gratuits.
- **Vercel** fait tourner le site (offre *Hobby*), serveur à Francfort (`vercel.json`).

**1. La base de données (Turso)**
1. Créez un compte sur [turso.tech](https://turso.tech) avec GitHub.
2. Créez une base nommée `aurum` en Europe.
3. Copiez son **adresse** (`libsql://…`) et créez un **jeton** (lecture et écriture, sans expiration).

**2. Le site (Vercel)**
1. Créez un compte sur [vercel.com](https://vercel.com) avec GitHub (offre *Hobby*, gratuite).
2. **Add New → Project**, puis importez ce dépôt (le code doit être sur la branche principale).
3. Dans **Environment Variables**, ajoutez `TURSO_DATABASE_URL` (l'adresse) et `TURSO_AUTH_TOKEN` (le jeton).
4. **Deploy** : le site est en ligne à une adresse `https://…vercel.app`.
5. Ouvrez-la et **créez votre compte en premier** : vous devenez Fondateur N° 0001 et administrateur.

Sur Vercel, les messages, notifications et nouvelles publications sont rafraîchis automatiquement toutes les quelques secondes (pas de connexion permanente sur ce type d'hébergement). Sur un serveur classique, ils arrivent instantanément.


## Lancer sur son ordinateur

Prérequis : **Node.js 20 ou plus récent**. Sans configuration Turso, les données sont enregistrées dans un fichier local (`data/aurum.db`).

```bash
npm install
npm start        # → http://localhost:3000
```


## Activer le droit d'entrée payant (Stripe)

0. Le paiement s'ouvre de lui-même une fois les places de Fondateur attribuées (ou dès le départ avec `PAID_ENTRY=true`).
1. Créez un compte sur [stripe.com](https://stripe.com) et récupérez votre **clé secrète** (`sk_test_…` pour tester, `sk_live_…` en réel).
2. Copiez `.env.example` en `.env` et renseignez `STRIPE_SECRET_KEY`.
3. Webhook (recommandé) :
   - **En local** : installez la [Stripe CLI](https://docs.stripe.com/stripe-cli) puis
     `stripe listen --forward-to localhost:3000/api/billing/webhook` et copiez le secret `whsec_…` affiché dans `STRIPE_WEBHOOK_SECRET`.
   - **En production** : Dashboard Stripe → Développeurs → Webhooks → ajoutez `https://votre-domaine.fr/api/billing/webhook` avec les événements `checkout.session.completed` et `checkout.session.async_payment_succeeded`.
4. Redémarrez. Carte de test : `4242 4242 4242 4242`, date future, CVC quelconque.

Même sans webhook, l'accès est accordé au retour du paiement (le serveur interroge Stripe pour vérifier). Le webhook couvre le cas où le membre ferme la page trop tôt.

## Activer les courriels (Brevo, gratuit)

1. Créez un compte gratuit sur **brevo.com** et complétez le profil demandé.
2. **Expéditeurs** : ajoutez « AURUM » avec votre adresse e-mail et validez-la avec le code reçu.
3. **SMTP et API → Clés API** : générez une clé (elle commence par `xkeysib-`) et copiez-la.
4. Dans **Vercel → votre projet → Settings → Environment Variables**, ajoutez :
   - `BREVO_API_KEY` : la clé copiée ;
   - `MAIL_FROM` : `AURUM <votre-adresse-validée>` ;
   - `CRON_SECRET` : une longue phrase au hasard (protège l'envoi automatique du dimanche).
5. **Deployments → Redeploy**, puis dans AURUM : **Direction → Courriels → M'envoyer un test**.

La Lettre du cercle part chaque dimanche vers 8 h (tâche planifiée Vercel, `vercel.json`).

## Configuration

Toutes les options sont décrites dans [`.env.example`](.env.example). Les principales :

| Variable | Rôle | Défaut |
|---|---|---|
| `PAID_ENTRY` | `true` pour exiger le paiement dès le premier membre (sinon : après les Fondateurs) | `false` |
| `BASE_URL` | Adresse publique du site (automatique sur Vercel) | `http://localhost:3000` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Paiement | — |
| `ENTRY_PRICE_CENTS` | Prix d'entrée en centimes | `999` |
| `FOUNDER_LIMIT` | Nombre de Fondateurs | `100` |
| `ADMIN_EMAILS` | Accès au tableau de bord | premier compte créé |
| `SMTP_URL` | Envoi des e-mails « mot de passe oublié » | console |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Base de données en ligne (Turso) | fichier local |
| `DATA_DIR` | Dossier du fichier local (sans Turso) | `./data` |
| `REALTIME` | `sse` (instantané) ou `poll` (rafraîchissement régulier) | `poll` sur Vercel, `sse` ailleurs |

## Autres hébergeurs

N'importe quel hébergeur Node.js convient (Railway, Fly.io, un VPS…), avec Turso ou avec un disque persistant pour le fichier local.

```bash
NODE_ENV=production BASE_URL=https://votre-domaine.fr npm start
```


En production (`NODE_ENV=production`) : cookies sécurisés (HTTPS obligatoire), mode démo désactivé, en-têtes HSTS.

### Avant d'ouvrir les portes

- [ ] Compléter les pages **Mentions légales**, **CGV** et **Confidentialité** (`public/js/views/legal.js`, champs entre crochets dorés).
- [ ] Créer votre compte en premier (ou renseigner `ADMIN_EMAILS`).
- [ ] Configurer `SMTP_URL` pour les e-mails de réinitialisation.
- [ ] Si l'entrée devient payante : clé Stripe `sk_live_…` et webhook de production.
- [ ] Sauvegarder régulièrement la base (Turso propose des sauvegardes ; en local : le fichier `aurum.db`).

## Tests

```bash
npm test
```

31 tests d'intégration couvrent l'inscription (gratuite et payante), le paiement (démo, retour Stripe, webhook signé, rejeu), l'unicité des numéros de membre, les publications et images, j'aime, commentaires, abonnements, messagerie, mentions, recherche, réinitialisation du mot de passe, administration, export RGPD, suppression de compte, réactions, photos multiples, stories, enregistrements, signalements et blocages.

## Architecture

```
server.js               Point d'entrée (Vercel ou serveur classique)
vercel.json             Région, routes des pages et en-têtes de sécurité sur Vercel
src/
  application.js        Application Express (sécurité, routes, fichiers statiques)
  db.js                 Schéma et accès à la base (libSQL : fichier local ou Turso)
  auth.js, security.js  Sessions, mots de passe, CSRF
  membership.js         Attribution des cartes de membre
  realtime.js           Temps réel (Server-Sent Events)
  routes/               API : auth, billing, posts, users, messages, notifications, me, admin
public/
  index.html, css/      Interface (application monopage sans étape de compilation)
  js/views/             Pages : accueil, inscription, adhésion, salon, profil, messages…
test/                   Tests d'intégration
```
