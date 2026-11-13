import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon, memberCard, money, num, cardSince } from '../dom.js';

function dust(count = 26) {
  const box = h('div', { class: 'dust', 'aria-hidden': 'true' });
  for (let i = 0; i < count; i++) {
    const size = 1.5 + Math.random() * 2.5;
    box.append(
      h('i', {
        style: {
          left: `${Math.random() * 100}%`,
          bottom: `${-10 + Math.random() * 40}%`,
          width: `${size}px`,
          height: `${size}px`,
          animationDuration: `${7 + Math.random() * 9}s`,
          animationDelay: `${-Math.random() * 12}s`,
        },
      }),
    );
  }
  return box;
}

export function siteFooter() {
  return h(
    'footer',
    { class: 'site-footer' },
    h(
      'div',
      { class: 'container' },
      h('span', null, `© ${new Date().getFullYear()} AURUM — Le cercle privé`),
      h(
        'nav',
        null,
        h('a', { href: '/mentions-legales' }, 'Mentions légales'),
        h('a', { href: '/cgv' }, 'CGV'),
        h('a', { href: '/confidentialite' }, 'Confidentialité'),
        h('a', { href: '/connexion' }, 'Connexion'),
      ),
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
      h('a', { href: '/', class: 'logo' }, 'AURUM'),
      h(
        'nav',
        null,
        h('a', { href: '/#manifeste', class: 'hide-sm' }, 'Le manifeste'),
        h('a', { href: '/#privileges', class: 'hide-sm' }, 'Privilèges'),
        h('a', { href: '/#entree', class: 'hide-sm' }, 'Entrée'),
        u
          ? h('a', { href: u.isMember ? '/salon' : '/rejoindre', class: 'btn btn-gold btn-sm' }, u.isMember ? 'Entrer' : 'Finaliser')
          : [h('a', { href: '/connexion' }, 'Connexion'), h('a', { href: '/inscription', class: 'btn btn-gold btn-sm' }, 'Rejoindre')],
      ),
    ),
  );
}

export async function landingView(ctx) {
  const cfg = store.config;
  const price = money(cfg.priceCents, cfg.currency);
  let stats = { members: 0, cities: 0, founderSpotsLeft: cfg.founderLimit, founderLimit: cfg.founderLimit };
  try {
    stats = await api.get('/api/public/stats');
  } catch {
    /* page affichée même hors ligne */
  }
  const nextNumber = cfg.founderLimit - stats.founderSpotsLeft + 1;
  const isFounderOpen = stats.founderSpotsLeft > 0;

  const cta = (label = `Obtenir ma carte — ${price}`, cls = 'btn btn-gold btn-lg') =>
    h('a', { href: store.user ? '/rejoindre' : '/inscription', class: cls }, label, icon('arrow'));

  const hero = h(
    'section',
    { class: 'hero' },
    dust(),
    h(
      'div',
      { class: 'container' },
      h(
        'div',
        { class: 'fade-up' },
        h('span', { class: 'eyebrow' }, "Réseau social privé · Sur droit d'entrée"),
        h('h1', null, "Le cercle où l'on se ", h('em', { class: 'gold-text shimmer' }, 'reconnaît'), '.'),
        h(
          'p',
          { class: 'lead' },
          `AURUM réunit celles et ceux qui visent plus haut. Pas de publicité, pas de faux profils, pas d'algorithme qui décide pour vous. Une seule porte d'entrée, et elle a un prix : ${price}.`,
        ),
        h('div', { class: 'hero-cta' }, cta(), h('a', { href: '/connexion', class: 'btn btn-ghost btn-lg' }, "J'ai déjà ma carte")),
        h(
          'div',
          { class: 'hero-note' },
          h('span', null, icon('lock'), 'Paiement unique'),
          h('span', null, icon('infinity'), 'Accès à vie'),
          h('span', null, icon('eyeOff'), 'Zéro publicité'),
        ),
      ),
      h(
        'div',
        { class: 'hero-visual fade-up', style: { animationDelay: '.15s' } },
        h('div', { class: 'halo' }),
        h('div', { class: 'card-behind' }, memberCard({ name: 'Membre fondateur', number: 1, founder: true, interactive: false })),
        memberCard({ name: 'Votre nom ici', number: nextNumber, since: cardSince(Date.now()), founder: false }),
      ),
    ),
  );

  const statsStrip = h(
    'section',
    { class: 'stats-strip' },
    h(
      'div',
      { class: 'container' },
      h('div', { class: 'stat' }, h('b', { class: 'gold-text' }, num(stats.members)), h('span', null, stats.members > 1 ? 'Membres' : 'Membre')),
      h(
        'div',
        { class: 'stat' },
        h('b', { class: 'gold-text' }, num(stats.founderSpotsLeft)),
        h('span', null, 'Places fondateur'),
      ),
      h('div', { class: 'stat' }, h('b', { class: 'gold-text' }, '0'), h('span', null, 'Publicité')),
      h('div', { class: 'stat' }, h('b', { class: 'gold-text' }, '100 %'), h('span', null, 'Membres vérifiés')),
    ),
  );

  const manifesto = h(
    'section',
    { class: 'section', id: 'manifeste' },
    h(
      'div',
      { class: 'container' },
      h(
        'div',
        { class: 'section-head reveal' },
        h('span', { class: 'eyebrow' }, 'Le manifeste'),
        h('h2', null, "Quand c'est gratuit, ", h('em', { class: 'gold-text' }, "c'est vous"), ' le produit.'),
        h(
          'p',
          null,
          "Les réseaux gratuits vendent votre attention au plus offrant. AURUM fait l'inverse : vous payez une fois, et c'est nous qui travaillons pour vous.",
        ),
      ),
      h(
        'div',
        { class: 'manifesto reveal' },
        h(
          'div',
          null,
          h('span', { class: 'num' }, 'I'),
          h('h3', null, 'Le prix filtre.'),
          h('p', null, `${price}, c'est peu pour vous. Pour un robot, un troll ou une ferme à faux comptes, c'est un mur infranchissable.`),
        ),
        h(
          'div',
          null,
          h('span', { class: 'num' }, 'II'),
          h('h3', null, 'Le calme revient.'),
          h('p', null, 'Un fil chronologique, sans publicité ni contenu sponsorisé. Vous voyez ce que publient les membres — rien d’autre.'),
        ),
        h(
          'div',
          null,
          h('span', { class: 'num' }, 'III'),
          h('h3', null, 'Vos données restent les vôtres.'),
          h('p', null, 'Aucune revente, aucun pistage publicitaire. Exportez ou supprimez votre compte en un clic.'),
        ),
      ),
    ),
  );

  const perk = (ic, title, text) =>
    h('div', { class: 'perk reveal' }, h('div', { class: 'perk-icon' }, icon(ic)), h('h3', null, title), h('p', null, text));

  const perks = h(
    'section',
    { class: 'section', id: 'privileges', style: { paddingTop: '0' } },
    h(
      'div',
      { class: 'container' },
      h(
        'div',
        { class: 'section-head reveal' },
        h('span', { class: 'eyebrow' }, 'Privilèges'),
        h('h2', null, 'Ce que contient votre carte.'),
      ),
      h(
        'div',
        { class: 'perks' },
        perk('gem', 'Un numéro à vie', "Chaque membre reçoit un numéro unique, attribué dans l'ordre d'arrivée. Le vôtre ne sera jamais réattribué."),
        perk('crown', 'Le statut de Fondateur', `Les ${cfg.founderLimit} premiers membres portent la couronne dorée et la carte or. Pour toujours.`),
        perk('mail', 'Messagerie privée', 'Des conversations en temps réel, entre membres uniquement. Personne d’autre ne peut vous écrire.'),
        perk('users', 'Un réseau qualifié', 'Entrepreneurs, investisseurs, créateurs, dirigeants : des profils réels, avec un vrai nom et une vraie démarche.'),
        perk('clock', 'Un fil sans algorithme', "Ce que vous suivez, dans l'ordre où c'est publié. Aucune manipulation de votre attention."),
        perk('shield', 'Discrétion absolue', 'Paiement par Stripe, mots de passe chiffrés, aucun traceur publicitaire. Ce qui se dit au cercle reste au cercle.'),
      ),
    ),
  );

  const included = [
    'Accès à vie au cercle',
    'Votre numéro de membre personnel',
    'Messagerie privée illimitée',
    'Zéro publicité, à jamais',
    isFounderOpen
      ? `Statut Fondateur — encore ${num(stats.founderSpotsLeft)} place${stats.founderSpotsLeft > 1 ? 's' : ''}`
      : 'Accès à la communauté des Fondateurs',
  ];
  const [euros, cents] = (cfg.priceCents / 100).toFixed(2).split('.');
  const pricing = h(
    'section',
    { class: 'section', id: 'entree', style: { paddingTop: '0' } },
    h(
      'div',
      { class: 'container' },
      h(
        'div',
        { class: 'section-head reveal' },
        h('span', { class: 'eyebrow' }, "Droit d'entrée"),
        h('h2', null, 'Un prix. Une fois. ', h('em', { class: 'gold-text' }, 'Pour toujours.')),
      ),
      h(
        'div',
        { class: 'pricing reveal' },
        h(
          'div',
          { class: 'price-card' },
          h('span', { class: 'eyebrow' }, 'Carte de membre AURUM'),
          h('div', { class: 'price' }, h('b', { class: 'gold-text' }, euros), h('sup', { class: 'gold-text' }, `,${cents} €`)),
          h('p', { class: 'price-sub' }, 'Paiement unique — sans abonnement, sans engagement.'),
          h('ul', { class: 'price-list' }, included.map((t) => h('li', null, icon('check'), t))),
          cta('Franchir la porte', 'btn btn-gold btn-lg btn-block'),
          h('p', { class: 'secure-note', style: { marginTop: '16px' } }, icon('lock'), 'Paiement sécurisé par Stripe'),
        ),
      ),
    ),
  );

  const faqItem = (q, a) => h('details', null, h('summary', null, q), h('p', null, a));
  const faq = h(
    'section',
    { class: 'section', style: { paddingTop: '0' } },
    h(
      'div',
      { class: 'container' },
      h('div', { class: 'section-head reveal' }, h('span', { class: 'eyebrow' }, 'Questions'), h('h2', null, 'Avant de franchir la porte.')),
      h(
        'div',
        { class: 'faq reveal' },
        faqItem(
          "Pourquoi faire payer l'entrée ?",
          "Parce que c'est le filtre le plus efficace qui existe. Un droit d'entrée, même modeste, écarte les robots, les faux comptes et les comportements toxiques — et nous permet de vivre sans publicité.",
        ),
        faqItem('Est-ce un abonnement ?', `Non. Vous payez ${price} une seule fois et votre accès est valable à vie. Aucun prélèvement ne suivra.`),
        faqItem(
          'Le paiement est-il sécurisé ?',
          'Oui. Le paiement est traité par Stripe, référence mondiale du paiement en ligne. Nous ne voyons ni ne stockons jamais vos coordonnées bancaires.',
        ),
        faqItem(
          'Qui peut rejoindre AURUM ?',
          "Toute personne majeure prête à s'acquitter du droit d'entrée et à respecter l'esprit du cercle : courtoisie, authenticité, discrétion.",
        ),
        faqItem('Puis-je quitter le cercle ?', "À tout moment, depuis vos réglages. Vous pouvez aussi télécharger l'intégralité de vos données."),
      ),
    ),
  );

  const finalCta = h(
    'section',
    { class: 'final-cta' },
    h(
      'div',
      { class: 'container reveal' },
      h('span', { class: 'eyebrow' }, `Prochain numéro attribué : N° ${String(nextNumber).padStart(4, '0')}`),
      h('h2', null, 'Votre place ', h('em', { class: 'gold-text shimmer' }, 'vous attend'), '.'),
      cta(),
    ),
  );

  const page = h('div', { class: 'landing' }, siteTopbar(), hero, statsStrip, manifesto, perks, pricing, faq, finalCta, siteFooter());

  // Apparition au défilement
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      }
    },
    { threshold: 0.12 },
  );
  requestAnimationFrame(() => page.querySelectorAll('.reveal').forEach((el) => io.observe(el)));
  ctx.onCleanup(() => io.disconnect());

  // Ancre éventuelle (#manifeste…)
  if (location.hash) {
    requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView());
  }
  ctx.title = 'AURUM — Le cercle privé';
  return page;
}
