'use strict';
// Adresses des pages de l'application (mêmes que public/js/app.js) : elles renvoient la page
// de l'application avec le statut 200 ; toute autre adresse renvoie la page 404 (statut 404).
// - STATIC_SOURCE : servies telles quelles par l'hébergeur (vercel.json les réécrit vers index.html,
//   un test vérifie l'accord) ;
// - SHARE_SOURCE : liens qu'on partage (vidéo, profil, Sujet du jour, LIVE, actu, hashtag, son),
//   servis par le serveur avec leur propre aperçu (titre, description, image : voir share.js).
//   Les invitations (« /rejoindre?par=… ») passent aussi par le serveur.
const STATIC_SOURCE = '(?:|abonnements|amis|explorer|actu|live|recherche|boite|activite|messages(?:/[^/]+)?|creer|reglages(?:/(?:compte|confidentialite|notifications|apparence))?|portefeuille|studio|admin|aide|regles|bienvenue|rejoindre|connexion|inscription|mot-de-passe-oublie|reinitialiser|cgu|cgv|rgpd|confidentialite|mentions-legales|p/[0-9]+|salon|videos)/?';
const SHARE_SOURCE = '(?:actu/[0-9]+|sujet(?:/[0-9]+)?|live/[^/]+|@[^/]+(?:/video/[0-9]+)?|tag/[^/]+|son/[0-9]+)/?';
const PAGE_SOURCE = `(?:${STATIC_SOURCE}|${SHARE_SOURCE})`;
const PAGE_RE = new RegExp(`^/${PAGE_SOURCE}$`);

const isPage = (path) => PAGE_RE.test(path);

// Pages publiques, proposées aux moteurs de recherche
const PUBLIC_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'hourly' },
  { path: '/rejoindre', priority: '0.9', changefreq: 'monthly' },
  { path: '/inscription', priority: '0.6', changefreq: 'monthly' },
  { path: '/connexion', priority: '0.4', changefreq: 'yearly' },
  { path: '/aide', priority: '0.5', changefreq: 'monthly' },
  { path: '/regles', priority: '0.4', changefreq: 'yearly' },
  { path: '/cgu', priority: '0.3', changefreq: 'yearly' },
  { path: '/cgv', priority: '0.3', changefreq: 'yearly' },
  { path: '/confidentialite', priority: '0.3', changefreq: 'yearly' },
  { path: '/mentions-legales', priority: '0.3', changefreq: 'yearly' },
];

function robotsTxt(baseUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    // Espaces personnels et données : rien à indexer
    'Disallow: /api/',
    'Disallow: /media/',
    'Disallow: /messages',
    'Disallow: /boite',
    'Disallow: /activite',
    'Disallow: /reglages',
    'Disallow: /portefeuille',
    'Disallow: /studio',
    'Disallow: /admin',
    'Disallow: /creer',
    'Disallow: /recherche',
    'Disallow: /bienvenue',
    'Disallow: /reinitialiser',
    'Disallow: /mot-de-passe-oublie',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

function sitemapXml(baseUrl, lastmod) {
  const day = new Date(lastmod).toISOString().slice(0, 10);
  const urls = PUBLIC_PAGES.map(
    (p) => `  <url>\n    <loc>${baseUrl}${p.path}</loc>\n    <lastmod>${day}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

module.exports = { PAGE_RE, PAGE_SOURCE, STATIC_SOURCE, SHARE_SOURCE, isPage, PUBLIC_PAGES, robotsTxt, sitemapXml };
