# AURUM — Le cercle privé

Réseau social privé **sur droit d'entrée** : on paie **9,99 € une seule fois** pour entrer, et l'on reçoit en échange une carte de membre numérotée, à vie. Pas de publicité, pas de faux comptes, pas d'algorithme.

Interface luxe noir & or, entièrement en français, responsive (mobile, tablette et ordinateur).

---

## Fonctionnalités

| | |
|---|---|
| **Droit d'entrée** | Paiement unique via **Stripe Checkout** (carte bancaire, et Apple Pay / Google Pay selon votre configuration Stripe), vérifié côté serveur + webhook signé. Case de renonciation au droit de rétractation (art. L221-28 du Code de la consommation). |
| **Carte de membre** | Numéro unique attribué dans l'ordre d'arrivée et **jamais réattribué**. Carte 3D animée, en **or** pour les 100 premiers « Fondateurs ». Cérémonie d'accueil après paiement. |
| **Le Salon** | Fil chronologique « Tout le cercle » / « Mes abonnements », publication texte + photo, j'aime, commentaires, #hashtags, @mentions, défilement infini, bandeau « nouvelles publications » en direct. |
| **Profils** | Photo, couverture, bio, profession, ville, site web, statistiques, abonnés / abonnements. |
| **Messagerie privée** | Conversations entre membres **en temps réel**, accusés de lecture « Vu », compteurs de non-lus. |
| **Notifications** | J'aime, commentaires, nouveaux abonnés, mentions — en temps réel. |
| **Explorer** | Recherche (membres, métiers, villes, #sujets), tendances, suggestions, derniers arrivés. |
| **Direction (admin)** | Membres, chiffre d'affaires, conversion, inscriptions sur 14 jours, derniers paiements, exclusion de membres, modération des publications. |
| **RGPD** | Export de toutes ses données en un clic, suppression du compte, aucun traceur, polices hébergées localement. |
| **Sécurité** | Mots de passe chiffrés (scrypt), sessions httpOnly, protection CSRF, limitation des tentatives, CSP stricte, vérification binaire des images envoyées. |

## Démarrage en 2 minutes

Prérequis : **Node.js 22.5 ou plus récent** (aucune base de données à installer : SQLite est intégré à Node).

```bash
npm install
npm run seed     # facultatif : 8 membres fictifs, publications et messages
npm start        # → http://localhost:3000
```

Sans clé Stripe, l'application fonctionne en **mode démonstration** : le paiement est simulé (un bandeau l'indique clairement), ce qui permet de tout tester.

Comptes de démonstration (après `npm run seed`) — mot de passe `aurum-demo-2026` :

- `victoire@aurum.demo` — compte administrateur (onglet « Direction »)
- `alexandrev@aurum.demo`, `inesbenali@aurum.demo`, `theomarchetti@aurum.demo`…

## Brancher les vrais paiements (Stripe)

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
| `BASE_URL` | Adresse publique du site | `http://localhost:3000` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Paiement | — |
| `ENTRY_PRICE_CENTS` | Prix d'entrée en centimes | `999` |
| `FOUNDER_LIMIT` | Nombre de Fondateurs | `100` |
| `ADMIN_EMAILS` | Accès au tableau de bord | — |
| `SMTP_URL` | Envoi des e-mails « mot de passe oublié » | console |
| `DATA_DIR` | Base SQLite + images envoyées | `./data` |

## Mise en ligne

N'importe quel hébergeur Node.js avec un **disque persistant** convient (Render, Railway, Fly.io, un VPS…).

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
- [ ] Renseigner `ADMIN_EMAILS` avec votre adresse.
- [ ] Configurer `SMTP_URL` pour les e-mails de réinitialisation.
- [ ] Passer Stripe en clé `sk_live_…` et créer le webhook de production.
- [ ] Sauvegarder régulièrement le dossier `DATA_DIR` (base `aurum.db` + `uploads/`).

## Tests

```bash
npm test
```

19 tests d'intégration couvrent l'inscription, le paiement (démo, retour Stripe, webhook signé, rejeu), l'unicité des numéros de membre, les publications et images, j'aime, commentaires, abonnements, messagerie, mentions, recherche, réinitialisation du mot de passe, administration, export RGPD et suppression de compte.

## Architecture

```
server.js               Démarrage du serveur
src/
  app.js                Application Express (sécurité, routes, fichiers statiques)
  db.js                 Schéma SQLite (node:sqlite)
  auth.js, security.js  Sessions, mots de passe, CSRF
  membership.js         Attribution des cartes après paiement
  realtime.js           Temps réel (Server-Sent Events)
  routes/               API : auth, billing, posts, users, messages, notifications, me, admin
public/
  index.html, css/      Interface (application monopage sans étape de compilation)
  js/views/             Pages : accueil, inscription, adhésion, salon, profil, messages…
scripts/seed.js         Données de démonstration
test/                   Tests d'intégration
```
