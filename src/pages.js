'use strict';
// Adresses des pages de l'application (mêmes que public/js/app.js) : elles renvoient la page
// de l'application avec le statut 200 ; toute autre adresse renvoie la page 404 (statut 404).
// La même liste figure dans vercel.json (réécriture vers index.html) : un test vérifie l'accord.
const PAGE_RE = /^\/(?:|connexion|inscription|mot-de-passe-oublie|reinitialiser|rejoindre|bienvenue|salon|explorer|notifications|videos|reglages|enregistres|amis|invitations|admin|aide|cgu|cgv|rgpd|confidentialite|mentions-legales|messages(?:\/[^/]+)?|p\/[^/]+|@[^/]+|groupes(?:\/[^/]+)?|journal(?:\/[^/]+)?|agenda(?:\/[^/]+)?|carnet(?:\/[^/]+)?|invitation\/[^/]+)\/?$/;

const isPage = (path) => PAGE_RE.test(path);

// Pages publiques, proposées aux moteurs de recherche
const PUBLIC_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/inscription', priority: '0.8', changefreq: 'monthly' },
  { path: '/connexion', priority: '0.5', changefreq: 'yearly' },
  { path: '/aide', priority: '0.5', changefreq: 'monthly' },
  { path: '/cgu', priority: '0.3', changefreq: 'yearly' },
  { path: '/cgv', priority: '0.3', changefreq: 'yearly' },
  { path: '/confidentialite', priority: '0.3', changefreq: 'yearly' },
  { path: '/mentions-legales', priority: '0.3', changefreq: 'yearly' },
];

function robotsTxt(baseUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    // Espace membres et données : privés, rien à indexer
    'Disallow: /api/',
    'Disallow: /media/',
    'Disallow: /salon',
    'Disallow: /explorer',
    'Disallow: /notifications',
    'Disallow: /messages',
    'Disallow: /videos',
    'Disallow: /reglages',
    'Disallow: /enregistres',
    'Disallow: /amis',
    'Disallow: /groupes',
    'Disallow: /journal',
    'Disallow: /agenda',
    'Disallow: /carnet',
    'Disallow: /invitations',
    'Disallow: /invitation/',
    'Disallow: /admin',
    'Disallow: /rejoindre',
    'Disallow: /bienvenue',
    'Disallow: /reinitialiser',
    'Disallow: /mot-de-passe-oublie',
    'Disallow: /p/',
    'Disallow: /@',
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

module.exports = { PAGE_RE, isPage, PUBLIC_PAGES, robotsTxt, sitemapXml };
