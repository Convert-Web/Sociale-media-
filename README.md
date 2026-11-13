# AURUM — Le cercle privé

Réseau social privé : chaque membre reçoit une carte numérotée, à vie. Pas de publicité, pas de faux comptes, pas d'algorithme.

L'inscription est **gratuite** par défaut. Un droit d'entrée payant (9,99 € via Stripe) est prêt à l'emploi : il s'active avec `PAID_ENTRY=true`.

Design minimaliste inspiré d'Apple, pensé **d'abord pour le téléphone** (barre d'onglets, feuilles, contrôles natifs), clair ou sombre selon l'appareil, entièrement en français. Typographie système (SF Pro sur iPhone et Mac, Inter ailleurs).

---

## Fonctionnalités

| | |
|---|---|
| **Droit d'entrée (optionnel)** | Désactivé par défaut. Avec `PAID_ENTRY=true` : paiement unique via **Stripe Checkout** (carte bancaire, et Apple Pay / Google Pay selon votre configuration Stripe), vérifié côté serveur + webhook signé. Case de renonciation au droit de rétractation (art. L221-28 du Code de la consommation). |
| **Carte de membre** | Numéro unique attribué dans l'ordre d'arrivée et **jamais réattribué**. Carte en titane clair, en **or** pour les 100 premiers « Fondateurs ». Cérémonie d'accueil à l'inscription. Le premier compte créé devient administrateur. |
| **Le Salon** | Fil chronologique « Tout le cercle » / « Mes abonnements », publication texte + photo, j'aime, commentaires, #hashtags, @mentions, défilement infini, bandeau « nouvelles publications » en direct. |
| **Profils** | Photo, couverture, bio, profession, ville, site web, statistiques, abonnés / abonnements. |
| **Messagerie privée** | Conversations entre membres **en temps réel**, accusés de lecture « Vu », compteurs de non-lus. |
| **Notifications** | J'aime, commentaires, nouveaux abonnés, mentions — en temps réel. |
| **Explorer** | Recherche (membres, métiers, villes, #sujets), tendances, suggestions, derniers arrivés. |
| **Direction (admin)** | Membres, chiffre d'affaires, conversion, inscriptions sur 14 jours, derniers paiements, exclusion de membres, modération des publications. |
| **RGPD** | Export de toutes ses données en un clic, suppression du compte, aucun traceur, polices hébergées localement. |
| **Sécurité** | Mots de passe chiffrés (scrypt), sessions httpOnly, protection CSRF, limitation des tentatives, CSP stricte, vérification binaire des images envoyées. |

## Mettre le site en ligne (Render)

Le site a besoin d'un hébergeur Node.js avec un **disque permanent** (pour garder les comptes, publications et photos). Le dépôt contient déjà la configuration pour [Render](https://render.com) (`render.yaml`).

1. Créez un compte sur [render.com](https://render.com) en vous connectant **avec GitHub**, et autorisez l'accès à ce dépôt.
2. Dans Render : **New → Blueprint**, choisissez ce dépôt, puis **Apply**.
3. Quelques minutes plus tard, le site est en ligne à une adresse du type `https://aurum-xxxx.onrender.com`.
4. Ouvrez-la et **créez votre compte en premier** : vous devenez Fondateur N° 0001 et administrateur.
5. Facultatif : ajoutez votre nom de domaine dans Render → *Settings → Custom Domains*.

Coût : offre *Starter* de Render (environ 7 $/mois) + 1 Go de disque (environ 0,25 $/mois). L'offre gratuite de Render ne garde pas les fichiers : les données seraient effacées à chaque redémarrage.

Le site démarre **vide** : aucune donnée fictive n'est installée en production.

## Lancer sur son ordinateur

Prérequis : **Node.js 22.5 ou plus récent** (aucune base de données à installer : SQLite est intégré à Node).

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
| `DATA_DIR` | Base SQLite + images envoyées | `./data` |

## Autres hébergeurs

N'importe quel hébergeur Node.js avec un **disque persistant** convient (Railway, Fly.io, un VPS…).

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
- [ ] Sauvegarder régulièrement le dossier `DATA_DIR` (base `aurum.db` + `uploads/`).

## Tests

```bash
npm test
```

22 tests d'intégration couvrent l'inscription (gratuite et payante), le paiement (démo, retour Stripe, webhook signé, rejeu), l'unicité des numéros de membre, les publications et images, j'aime, commentaires, abonnements, messagerie, mentions, recherche, réinitialisation du mot de passe, administration, export RGPD et suppression de compte.

## Architecture

```
server.js               Démarrage du serveur
src/
  app.js                Application Express (sécurité, routes, fichiers statiques)
  db.js                 Schéma SQLite (node:sqlite)
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
