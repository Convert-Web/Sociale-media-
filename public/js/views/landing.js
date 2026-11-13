import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon, memberCard, money, num, cardSince, memberNo } from '../dom.js';

export function siteFooter() {
  return h(
    'footer',
    { class: 'site-footer' },
    h(
      'div',
      { class: 'container' },
      h(
        'nav',
        null,
        h('a', { href: '/mentions-legales' }, 'Mentions légales'),
        h('a', { href: '/cgv' }, 'Conditions'),
        h('a', { href: '/confidentialite' }, 'Confidentialité'),
        h('a', { href: '/connexion' }, 'Se connecter'),
      ),
      h('p', null, `© ${new Date().getFullYear()} AURUM. Tous droits réservés.`),
    ),
  );
}

export function siteTopbar() {
  const u = store.user;
  return h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'container' },
      h('a', { href: '/', class: 'logo', 'aria-label': 'AURUM, accueil' }, 'AURUM'),
      h(
        'nav',
        null,
        u
          ? h('a', { href: u.isMember ? '/salon' : '/rejoindre', class: 'btn btn-primary btn-sm' }, u.isMember ? 'Ouvrir' : 'Finaliser')
          : [h('a', { href: '/connexion', class: 'topbar-link' }, 'Se connecter'), h('a', { href: '/inscription', class: 'btn btn-primary btn-sm' }, 'Rejoindre')],
      ),
    ),
  );
}

export async function landingView(ctx) {
  const cfg = store.config;
  const paid = cfg.paidEntry;
  const price = money(cfg.priceCents, cfg.currency);
  let stats = { members: 0, cities: 0, founderSpotsLeft: cfg.founderLimit, founderLimit: cfg.founderLimit };
  try {
    stats = await api.get('/api/public/stats');
  } catch {
    /* la page reste lisible hors ligne */
  }
  const nextNumber = cfg.founderLimit - stats.founderSpotsLeft + 1;
  const joinHref = store.user ? '/rejoindre' : '/inscription';
  const cta = (label = 'Obtenir ma carte', cls = 'btn btn-primary btn-lg') => h('a', { href: joinHref, class: cls }, label);
  const more = (label, href) => h('a', { href, class: 'link-more' }, label, icon('chevron', 'icon-sm'));

  // ---------------------------------------------------------------- Ouverture
  const hero = h(
    'section',
    { class: 'hero' },
    h(
      'div',
      { class: 'container hero-inner' },
      h(
        'div',
        { class: 'hero-copy fade-up' },
        h('p', { class: 'eyebrow' }, 'Le réseau social privé'),
        h('h1', null, 'Un cercle.', h('br'), h('span', { class: 'muted-strong' }, 'Pas une foule.')),
        h('p', { class: 'lead' }, 'AURUM réunit les personnes qui comptent. Sans publicité. Sans algorithme. Sans bruit.'),
        h('div', { class: 'hero-cta' }, cta(paid ? `Obtenir ma carte — ${price}` : 'Obtenir ma carte'), more('Se connecter', '/connexion')),
        h('p', { class: 'hero-note' }, paid ? `Paiement unique de ${price}. Accès à vie.` : 'Inscription gratuite. Numéro de membre à vie.'),
      ),
      h(
        'div',
        { class: 'hero-visual fade-up', style: { animationDelay: '.12s' } },
        h('div', { class: 'card-behind', 'aria-hidden': 'true' }, memberCard({ name: 'Membre fondateur', number: 1, founder: true, interactive: false })),
        memberCard({ name: 'Votre nom', number: nextNumber, since: cardSince(Date.now()) }),
      ),
    ),
  );

  // ---------------------------------------------------------------- Déclaration
  const statement = h(
    'section',
    { class: 'section statement' },
    h(
      'div',
      { class: 'container narrow' },
      h('h2', { class: 'reveal' }, 'Ici, personne ne vend ', h('span', { class: 'muted-strong' }, 'votre attention.')),
      h(
        'p',
        { class: 'reveal' },
        'Les grands réseaux vivent de la publicité et vous montrent ce qui retient votre regard. AURUM vous montre ce que publient vos relations, dans l’ordre où elles le publient. Rien d’autre.',
      ),
    ),
  );

  // ---------------------------------------------------------------- Mosaïque
  const tile = (cls, ...kids) => h('article', { class: `tile reveal ${cls}` }, kids);
  const bento = h(
    'section',
    { class: 'section', id: 'privileges' },
    h(
      'div',
      { class: 'container' },
      h('div', { class: 'section-head reveal' }, h('p', { class: 'eyebrow' }, 'Privilèges'), h('h2', null, 'Tout ce qui compte.', h('br'), 'Rien de plus.')),
      h(
        'div',
        { class: 'bento' },
        tile(
          'tile-wide',
          h('p', { class: 'tile-kicker' }, 'Votre numéro'),
          h('p', { class: 'tile-figure' }, memberNo(nextNumber)),
          h('h3', null, 'Un numéro à vie.'),
          h('p', null, 'Attribué dans l’ordre d’arrivée. Il vous appartient et ne sera jamais réattribué.'),
        ),
        tile(
          'tile-gold',
          icon('crown', 'icon-lg'),
          h('h3', null, 'Fondateurs.'),
          h('p', null, `Les ${num(cfg.founderLimit)} premiers membres reçoivent la carte or, à vie.`),
          h('p', { class: 'tile-meta' }, stats.founderSpotsLeft > 0 ? `${num(stats.founderSpotsLeft)} place${stats.founderSpotsLeft > 1 ? 's' : ''} restante${stats.founderSpotsLeft > 1 ? 's' : ''}` : 'Complet'),
        ),
        tile('tile-dark', h('p', { class: 'tile-figure' }, '0'), h('h3', null, 'Publicité.'), h('p', null, 'Aucune. Jamais. Vos données ne sont ni vendues ni exploitées.')),
        tile('', icon('mail', 'icon-lg'), h('h3', null, 'Messagerie privée.'), h('p', null, 'Des conversations en temps réel, entre membres uniquement.')),
        tile('', icon('clock', 'icon-lg'), h('h3', null, 'Un fil chronologique.'), h('p', null, 'Ce que vous suivez, dans l’ordre. Aucun algorithme ne décide pour vous.')),
        tile('', icon('shield', 'icon-lg'), h('h3', null, 'Discrétion.'), h('p', null, 'Aucun traceur publicitaire. Export et suppression de vos données en un geste.')),
      ),
    ),
  );

  // ---------------------------------------------------------------- Adhésion
  const included = [
    paid ? 'Paiement unique, accès à vie' : 'Sans carte bancaire',
    'Numéro de membre personnel',
    'Messagerie privée',
    'Aucune publicité',
  ];
  const membership = h(
    'section',
    { class: 'section membership', id: 'entree' },
    h(
      'div',
      { class: 'container narrow reveal' },
      h('p', { class: 'eyebrow' }, 'Adhésion'),
      h('p', { class: 'membership-price' }, paid ? price : 'Gratuit.'),
      h('p', { class: 'membership-sub' }, paid ? 'Une fois. Pour toujours.' : 'Deux minutes pour créer votre compte.'),
      h('ul', { class: 'checklist' }, included.map((t) => h('li', null, icon('check', 'icon-sm'), t))),
      cta(paid ? 'Franchir la porte' : 'Créer mon compte', 'btn btn-primary btn-lg'),
      paid ? h('p', { class: 'secure-note' }, icon('lock', 'icon-sm'), 'Paiement sécurisé par Stripe') : null,
    ),
  );

  // ---------------------------------------------------------------- Questions
  const faqItem = (q, a) => h('details', null, h('summary', null, q), h('p', null, a));
  const faq = h(
    'section',
    { class: 'section' },
    h(
      'div',
      { class: 'container narrow' },
      h('h2', { class: 'faq-title reveal' }, 'Questions.'),
      h(
        'div',
        { class: 'faq reveal' },
        paid
          ? [
              faqItem("Pourquoi un droit d'entrée ?", "C'est le filtre le plus efficace contre les robots, les faux comptes et les comportements toxiques. Il nous permet aussi de vivre sans publicité."),
              faqItem('Est-ce un abonnement ?', `Non. ${price}, une seule fois. Aucun prélèvement ne suivra.`),
              faqItem('Le paiement est-il sécurisé ?', 'Il est traité par Stripe. Nous ne voyons ni ne stockons vos coordonnées bancaires.'),
            ]
          : [
              faqItem("L'inscription est-elle gratuite ?", 'Oui. Créez votre compte et recevez aussitôt votre carte et votre numéro de membre.'),
              faqItem('Pourquoi aucune publicité ?', 'Un réseau financé par la publicité finit par travailler pour les annonceurs. Ici, votre fil ne montre que ce que publient les membres.'),
            ],
        faqItem('Que devient mon numéro ?', "Il vous appartient à vie et ne sera jamais attribué à quelqu'un d'autre, même si vous quittez le cercle."),
        faqItem('Qui peut rejoindre AURUM ?', 'Toute personne majeure qui respecte l’esprit du cercle : courtoisie, authenticité, discrétion.'),
        faqItem('Puis-je partir ?', 'À tout moment, depuis vos réglages. Vous pouvez aussi télécharger l’intégralité de vos données.'),
      ),
    ),
  );

  const finalCta = h(
    'section',
    { class: 'section final-cta' },
    h('div', { class: 'container narrow reveal' }, h('h2', null, 'Votre place', h('br'), 'vous attend.'), cta(), h('p', { class: 'hero-note' }, `Prochain numéro : ${memberNo(nextNumber)}`)),
  );

  const page = h('div', { class: 'landing' }, siteTopbar(), hero, statement, bento, membership, faq, finalCta, siteFooter());

  // Apparition douce au défilement
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
  );
  requestAnimationFrame(() => page.querySelectorAll('.reveal').forEach((el) => io.observe(el)));
  ctx.onCleanup(() => io.disconnect());

  if (location.hash) requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  ctx.title = 'AURUM — Le cercle privé';
  return page;
}
