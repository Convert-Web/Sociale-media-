# AURUM — Le cercle privé

Réseau social privé : chaque membre reçoit une carte numérotée, à vie. Pas de publicité, pas de faux comptes, pas d'algorithme.

L'inscription est **gratuite** par défaut. Un droit d'entrée payant (9,99 € via Stripe) est prêt à l'emploi : il s'active avec `PAID_ENTRY=true`.

Design minimaliste inspiré d'Apple, pensé **d'abord pour le téléphone** (barre d'onglets, feuilles, contrôles natifs), clair ou sombre selon l'appareil, entièrement en français. Typographie système (SF Pro sur iPhone et Mac, Inter ailleurs, hébergée avec le site).

---

## Fonctionnalités

| | |
|---|---|
| **Droit d'entrée (optionnel)** | Désactivé par défaut. Avec `PAID_ENTRY=true` : paiement unique via **Stripe Checkout** (carte bancaire, et Apple Pay / Google Pay selon votre configuration Stripe), vérifié côté serveur + webhook signé. Case de renonciation au droit de rétractation (art. L221-28 du Code de la consommation). |
| **Carte de membre** | Numéro unique attribué dans l'ordre d'arrivée et **jamais réattribué**. Carte en titane clair, en **or** pour les 100 premiers « Fondateurs ». Cérémonie d'accueil à l'inscription. Le premier compte créé devient administrateur. |
| **Le Salon** | Fil chronologique « Tout le cercle » / « Mes abonnements », publications avec jusqu'à 6 photos (carrousel), modification, commentaires, #hashtags, @mentions avec suggestions, défilement infini, bandeau « nouvelles publications ». |
| **Réactions** | ❤️ 👍 👏 🔥 😂 😮 : un toucher pour ❤️, appui long (ou survol) pour choisir, liste des membres qui ont réagi. |
| **Stories** | Photos éphémères (24 h) avec légende, lecteur plein écran (progression, toucher pour avancer, appui long pour pause, glisser pour fermer), vues, réponse en message privé. |
| **Enregistrés** | Mettre une publication de côté et la retrouver dans « Enregistrés ». |
| **Sécurité** | Signaler une publication, un commentaire ou un membre ; bloquer un membre (contenus masqués, messages impossibles) ; file des signalements dans « Direction ». |
| **Application** | Installable sur l'écran d'accueil (icône, plein écran), accueil guidé des nouveaux membres. |
| **Profils** | Mise en page inspirée de X : couverture 3:1, photo qui chevauche, onglets soulignés « Publications / Photos ». **Outil de recadrage** (glisser, pincer, zoom) pour la photo de profil et la couverture : jamais d'image étirée. Visionneuse animée (glisser vers le bas pour fermer). |
| **Amis** | Demandes d'ami façon Facebook : Ajouter → Demande envoyée → Accepter / Refuser, liste d'amis, « Vous connaissez peut-être », bandeau dans Activité et badge rouge. Accepter une demande abonne les deux membres l'un à l'autre. |
| **Groupes privés** | Création avec couverture, invitation de membres, demandes d'adhésion validées par le créateur ou les admins du groupe, rôles (créateur / admin / membre), discussion réservée aux membres. Les publications d'un groupe n'apparaissent jamais dans le Salon, les profils, la recherche ou les tendances. |
| **Messagerie privée** | Conversations entre membres **en temps réel**, accusés de lecture « Vu », compteurs de non-lus. |
| **Notifications** | Réactions, commentaires, abonnés, mentions, demandes d'ami, invitations de groupe. **Notifications sur le téléphone** (Web Push) à chaque message privé, demande d'ami ou invitation — à activer dans Réglages › Notifications. Sur iPhone : ajouter d'abord AURUM à l'écran d'accueil (iOS 16.4+). Clés VAPID générées automatiquement, rien à configurer. |
| **Explorer** | Recherche (membres, métiers, villes, #sujets), tendances, suggestions, derniers arrivés. |
| **Direction (admin)** | Membres, chiffre d'affaires, conversion, inscriptions sur 14 jours, derniers paiements, exclusion de membres, modération des publications. |
| **RGPD** | Export de toutes ses données en un clic, suppression du compte, aucun traceur, polices hébergées localement. |
| **Sécurité** | Mots de passe chiffrés (scrypt), sessions httpOnly, protection CSRF, limitation des tentatives, CSP stricte, vérification binaire des images envoyées. |

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

Autre possibilité : [Render](https://render.com) avec le fichier `render.yaml` (Render demande une carte bancaire, même pour l'offre gratuite).

## Lancer sur son ordinateur

Prérequis : **Node.js 20 ou plus récent**. Sans configuration Turso, les données sont enregistrées dans un fichier local (`data/aurum.db`).

```bash
npm install
npm start        # → http://localhost:3000
```

Pour tester en local avec des membres fictifs : `npm run seed` (refusé en production). Mot de passe des comptes fictifs : `aurum-demo-2026`.

## Activer le droit d'entrée payant (Stripe)

0. Ajoutez `PAID_ENTRY=true` à la configuration.
1. Créez un compte sur [stripe.com](https://stripe.com) et récupérez votre **clé secrète** (`sk_test_…` pour tester, `sk_live_…` en réel).
2. Copiez `.env.example` en `.env` et renseignez `STRIPE_SECRET_KEY`.
3. Webhook (recommandé) :
   - **En local** : installez la [Stripe CLI](https://docs.stripe.com/stripe-cli) puis
     `stripe listen --forward-to localhost:3000/api/billing/webhook` et copiez le secret `whsec_…` affiché dans `STRIPE_WEBHOOK_SECRET`.
   - **En production** : Dashboard Stripe → Développeurs → Webhooks → ajoutez `https://votre-domaine.fr/api/billing/webhook` avec les événements `checkout.session.completed` et `checkout.session.async_payment_succeeded`.
4. Redémarrez. Carte de test : `4242 4242 4242 4242`, date future, CVC quelconque.

Même sans webhook, l'accès est accordé au retour du paiement (le serveur interroge Stripe pour vérifier). Le webhook couvre le cas où le membre ferme la page trop tôt.

## Configuration

Toutes les options sont décrites dans [`.env.example`](.env.example). Les principales :

| Variable | Rôle | Défaut |
|---|---|---|
| `PAID_ENTRY` | `true` pour exiger le paiement à l'inscription | `false` |
| `BASE_URL` | Adresse publique du site (automatique sur Render) | `http://localhost:3000` |
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

ou avec Docker :

```bash
docker build -t aurum .
docker run -d -p 3000:3000 -v aurum-data:/data --env-file .env aurum
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
scripts/seed.js         Membres fictifs pour tester en local
test/                   Tests d'intégration
```
