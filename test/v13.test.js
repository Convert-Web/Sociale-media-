'use strict';
// Version 13 : pages légales, référencement (robots, sitemap, 404), anti-spam,
// mesure d'audience anonyme, préchargement des modules, en-têtes HTTPS.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.NODE_ENV = 'test';
const config = require('../src/config');
const { createApp } = require('../src/application');
const { PAGE_RE } = require('../src/pages');
const { LIMITS } = require('../src/antispam');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurum-v13-'));
let server;
let base;
let ctx;

const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

before(async () => {
  const cfg = {
    ...config,
    dataDir: tmp,
    database: { url: `file:${path.join(tmp, 'v13.db')}`, authToken: '' },
    baseUrl: 'https://cercle.example',
    paidEntry: false,
    admissionDefault: 'open',
    bots: false,
    rateLimit: true, // anti-spam actif dans ce fichier
    cookieSecure: true,
    adminEmails: [],
    stripe: { secretKey: '', webhookSecret: '' },
  };
  const created = await createApp(cfg, { stripe: null, mailer: { send: async () => {}, sendBatch: async (l) => l.length } });
  ctx = created.ctx;
  await new Promise((resolve) => {
    server = created.app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  ctx.hub.close();
  await new Promise((r) => server.close(r));
  ctx.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function client(ua = DESKTOP) {
  let cookie = '';
  const call = async (method, url, body) => {
    const hd = { 'x-aurum': '1', 'user-agent': ua };
    if (cookie) hd.cookie = cookie;
    let payload;
    if (body !== undefined) {
      hd['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers: hd, body: payload });
    const m = /aurum_sid=([^;]+)/.exec(res.headers.get('set-cookie') || '');
    if (m) cookie = `aurum_sid=${m[1]}`;
    const isJson = res.headers.get('content-type')?.includes('json');
    return { status: res.status, headers: res.headers, data: isJson ? await res.json() : await res.text() };
  };
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b) };
}

const signup = (c, name, username, extra = {}) =>
  c.post('/api/auth/signup', { displayName: name, username, email: `${username}@aurum.test`, password: 'motdepasse-solide', ...extra });

let admin;
let membre;

test('le premier compte (Direction) puis un membre s’inscrivent normalement', async () => {
  admin = client();
  assert.equal((await signup(admin, 'Victoire Delmas', 'victoire', { website: '', elapsed: 9000 })).status, 201);
  membre = client(IPHONE);
  assert.equal((await signup(membre, 'Anna Weber', 'anna', { elapsed: 6000 })).status, 201);
});

test('anti-spam à l’inscription : champ piège, envoi trop rapide, adresse jetable', async () => {
  const robot = client();
  const trap = await signup(robot, 'Robot Un', 'robot1', { website: 'http://spam.example' });
  assert.equal(trap.status, 400);
  assert.equal(trap.data.code, 'SPAM');
  const fast = await signup(robot, 'Robot Deux', 'robot2', { elapsed: 400 });
  assert.equal(fast.status, 400);
  assert.equal(fast.data.code, 'TOO_FAST');
  const jetable = await robot.post('/api/auth/signup', { displayName: 'Robot Trois', username: 'robot3', email: 'x@yopmail.com', password: 'motdepasse-solide' });
  assert.equal(jetable.status, 400);
  assert.match(jetable.data.error, /jetables/);
  assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM users WHERE username LIKE 'robot%'")).n, 0);
});

test('mots de passe essayés en série : compte bloqué 15 minutes', async () => {
  const c = client();
  assert.equal((await signup(c, 'Hugo Lambert', 'hugo', { elapsed: 5000 })).status, 201);
  const pirate = client();
  for (let i = 0; i < 8; i++) assert.equal((await pirate.post('/api/auth/login', { login: 'hugo', password: `faux-${i}` })).status, 401);
  const locked = await pirate.post('/api/auth/login', { login: 'hugo', password: 'motdepasse-solide' });
  assert.equal(locked.status, 429);
  assert.equal(locked.data.code, 'LOCKED');
  // Fin du blocage : la connexion fonctionne et le compteur repart à zéro
  await ctx.db.run("UPDATE users SET login_locked_until = ? WHERE username = 'hugo'", Date.now() - 1);
  assert.equal((await client().post('/api/auth/login', { login: 'hugo', password: 'motdepasse-solide' })).status, 200);
  assert.equal((await ctx.db.get("SELECT login_failures FROM users WHERE username = 'hugo'")).login_failures, 0);
});

test('rafales : trop de publications en une heure sont refusées (la Direction n’est pas limitée)', async () => {
  for (let i = 0; i < LIMITS.post.max; i++) assert.equal((await membre.post('/api/posts', { body: `Publication ${i}` })).status, 201);
  const trop = await membre.post('/api/posts', { body: 'Une de trop' });
  assert.equal(trop.status, 429);
  assert.equal(trop.data.code, 'SLOW_DOWN');
  assert.equal((await admin.post('/api/posts', { body: 'Annonce de la Direction' })).status, 201);
});

test('mot de passe oublié : un seul courriel toutes les 2 minutes', async () => {
  const sent = [];
  const old = ctx.mailer.send;
  ctx.mailer.send = async (m) => sent.push(m);
  const c = client();
  await c.post('/api/auth/forgot', { email: 'anna@aurum.test' });
  await c.post('/api/auth/forgot', { email: 'anna@aurum.test' });
  ctx.mailer.send = old;
  assert.equal(sent.length, 1);
});

test('informations légales : saisies par la Direction, affichées publiquement', async () => {
  const vide = await client().get('/api/legal');
  assert.equal(vide.status, 200);
  assert.equal(vide.data.legal.editorName, '');
  assert.equal((await membre.put('/api/admin/legal', { editorName: 'X' })).status, 403);
  const faux = await admin.put('/api/admin/legal', { email: 'pas-un-mail' });
  assert.equal(faux.status, 400);
  const ok = await admin.put('/api/admin/legal', {
    editorName: 'Victoire Delmas', legalForm: 'Entrepreneur individuel', address: '1 rue de la Paix, 75002 Paris', siren: '123 456 789',
    director: 'Victoire Delmas', email: 'contact@cercle.example', mediatorName: 'CM2C', mediatorUrl: 'https://www.cm2c.net', inconnu: 'ignoré',
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.missing, []);
  const pub = await client().get('/api/legal');
  assert.equal(pub.data.legal.siren, '123 456 789');
  assert.equal(pub.data.legal.inconnu, undefined);
  const etat = await admin.get('/api/admin/legal');
  assert.ok(etat.data.fields.some((f) => f.key === 'mediatorName' && f.required));
});

test('robots.txt et sitemap.xml : adresse réelle du site, pages publiques seulement', async () => {
  const robots = await client().get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get('content-type'), /text\/plain/);
  assert.match(robots.data, /Sitemap: https:\/\/cercle\.example\/sitemap\.xml/);
  assert.match(robots.data, /Disallow: \/messages/);
  const map = await client().get('/sitemap.xml');
  assert.equal(map.status, 200);
  assert.match(map.headers.get('content-type'), /xml/);
  assert.match(map.data, /<loc>https:\/\/cercle\.example\/cgu<\/loc>/);
  assert.doesNotMatch(map.data, /salon|messages/);
});

test('page 404 : vrai statut 404 pour une adresse inconnue, 200 pour les pages de l’application', async () => {
  const c = client();
  for (const p of ['/', '/salon', '/cgu', '/rgpd', '/@victoire', '/@alexandre.v', '/messages/anna', '/p/12', '/invitation/ABCD1234', '/agenda/3']) {
    const r = await c.get(p);
    assert.equal(r.status, 200, p);
    assert.match(r.data, /<div id="app">/, p);
  }
  for (const p of ['/page-qui-n-existe-pas', '/salon/truc/machin', '/admin.php', '/wp-login.php']) {
    const r = await c.get(p);
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get('x-robots-tag'), 'noindex');
    if (!p.endsWith('.php')) assert.match(r.data, /<div id="app">/, p); // la page « introuvable » de l'application
  }
});

test('vercel.json réécrit exactement les mêmes pages que le serveur', () => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const source = v.rewrites[0].source; // syntaxe path-to-regexp : un groupe d'expression régulière
  const re = new RegExp(`^${source.replace(/^\/\((.*)\)$/, '/(?:$1)')}$`);
  const app = fs.readFileSync(path.join(ROOT, 'public/js/app.js'), 'utf8');
  const routes = [...app.matchAll(/\{ path: '([^']+)', view:/g)].map((m) => m[1]);
  assert.ok(routes.length > 30);
  for (const r of routes) {
    const sample = r.replace(/:(\w+)/g, (_, k) => (k === 'username' ? 'alexandre.v' : 'abc123'));
    assert.ok(PAGE_RE.test(sample), `serveur : ${sample}`);
    assert.ok(re.test(sample), `vercel.json : ${sample}`);
  }
  for (const p of ['/robots.txt', '/sitemap.xml', '/favicon.ico', '/api/version', '/inconnue']) assert.ok(!re.test(p), p);
});

test('HTTPS imposé : HSTS longue durée et requêtes non chiffrées converties', async () => {
  const r = await client().get('/');
  assert.match(r.headers.get('strict-transport-security'), /max-age=63072000/);
  assert.match(r.headers.get('content-security-policy'), /upgrade-insecure-requests/);
  const v = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
  assert.match(v, /upgrade-insecure-requests/);
});

test('aucune clé secrète dans les fichiers envoyés au navigateur', () => {
  const files = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(js|html|json|webmanifest|css)$/.test(f.name)) files.push(p);
    }
  };
  walk(path.join(ROOT, 'public'));
  const SECRET = /(sk|rk)_(live|test)_[0-9a-zA-Z]{8,}|whsec_[0-9a-zA-Z]{8,}|xkeysib-[0-9a-f]{16,}|eyJhbGciOi[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY/;
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), SECRET, f);
});

test('mesure d’audience : anonyme, sans cookie, robots et Direction exclus', async () => {
  const visiteur = client(IPHONE);
  let r = await visiteur.post('/api/a', { p: '/', v: true, r: 'www.tiktok.com', s: 'TikTok' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('set-cookie'), null);
  await visiteur.post('/api/a', { p: '/inscription' });
  await client(DESKTOP).post('/api/a', { p: '/', v: true });
  await client('Mozilla/5.0 HeadlessChrome/120').post('/api/a', { p: '/', v: true }); // robot : ignoré
  await admin.post('/api/a', { p: '/salon', v: true }); // la Direction ne se compte pas
  await visiteur.post('/api/a', { p: '/@victoire<script>', v: true }); // adresse refusée
  const s = await admin.get('/api/admin/analytics');
  assert.equal(s.status, 200);
  assert.equal(s.data.visits, 2);
  assert.equal(s.data.views, 3);
  assert.deepEqual(s.data.sources.find((x) => x.key === 'tiktok.com'), { key: 'tiktok.com', n: 1 });
  assert.deepEqual(s.data.campaigns, [{ key: 'tiktok', n: 1 }]);
  assert.ok(s.data.devices.some((d) => d.key === 'mobile') && s.data.devices.some((d) => d.key === 'ordinateur'));
  assert.equal(s.data.daily.length, 14);
  assert.equal((await membre.get('/api/admin/analytics')).status, 403);
  // Aucune donnée personnelle : seulement des totaux par jour
  const cols = (await ctx.db.all('SELECT name FROM pragma_table_info(?)', 'analytics_daily')).map((c) => c.name);
  assert.deepEqual(cols.sort(), ['day', 'key', 'kind', 'n']);
});

test('index.html : tous les modules préchargés en parallèle, aperçu de partage complet', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const mods = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js') && f.name !== 'boot.js') mods.push(`/${path.relative(path.join(ROOT, 'public'), p).split(path.sep).join('/')}`);
    }
  };
  walk(path.join(ROOT, 'public/js'));
  for (const m of mods) assert.ok(html.includes(`<link rel="modulepreload" href="${m}">`), `module non préchargé : ${m}`);
  for (const tag of ['og:image', 'og:title', 'og:description', 'twitter:card', 'og:image:alt']) assert.ok(html.includes(tag), tag);
  assert.ok(fs.existsSync(path.join(ROOT, 'public/img/og.jpg')));
  assert.ok(fs.existsSync(path.join(ROOT, 'public/favicon.ico')));
});
