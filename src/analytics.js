'use strict';
// Mesure d'audience maison : sans cookie, sans identifiant, sans service extérieur.
// Seuls des totaux par jour sont gardés (pages vues, visites, provenance, type d'appareil,
// campagne « utm_source ») : impossible de suivre une personne d'une visite à l'autre.
// Conforme aux conditions de dispense de consentement de la CNIL ; opposition possible.

const KEEP_MS = 25 * 30 * 86400e3; // 25 mois

const dayOf = (ts) => new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);

function device(ua = '') {
  if (/iPad|Tablet|Nexus (7|9|10)|SM-T/i.test(ua)) return 'tablette';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'ordinateur';
}
const isBot = (ua = '') => !ua || /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|whatsapp|curl|wget|python|node-fetch|axios/i.test(ua);

async function bump(db, day, kind, key) {
  await db.run(
    'INSERT INTO analytics_daily (day, kind, key, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, kind, key) DO UPDATE SET n = n + 1',
    day, kind, key,
  );
}

async function record(ctx, req) {
  const b = req.body || {};
  const ua = req.get('user-agent') || '';
  if (isBot(ua) || req.user?.is_admin || req.get('dnt') === '1' || req.get('sec-gpc') === '1') return false;
  const page = typeof b.p === 'string' && /^(\/[a-z0-9@:\-/]{0,58}|404)$/i.test(b.p) ? b.p : null;
  if (!page) return false;
  const day = dayOf(Date.now());
  await bump(ctx.db, day, 'view', page);
  if (b.v === true) {
    await bump(ctx.db, day, 'visit', 'all');
    await bump(ctx.db, day, 'device', device(ua));
    const ref = typeof b.r === 'string' && /^[a-z0-9.-]{3,60}$/i.test(b.r) ? b.r.toLowerCase().replace(/^(www|m|l|lm)\./, '') : 'direct';
    await bump(ctx.db, day, 'ref', ref);
    if (typeof b.s === 'string' && /^[a-z0-9_.-]{1,30}$/i.test(b.s)) await bump(ctx.db, day, 'utm', b.s.toLowerCase());
  }
  return true;
}

async function summary(ctx, days = 30) {
  const since = dayOf(Date.now() - (days - 1) * 86400e3);
  const rows = await ctx.db.all('SELECT day, kind, key, n FROM analytics_daily WHERE day >= ?', since);
  const sum = (kind, key) => rows.filter((r) => r.kind === kind && (!key || r.key === key)).reduce((a, r) => a + r.n, 0);
  const top = (kind, limit = 6) => {
    const m = new Map();
    for (const r of rows) if (r.kind === kind) m.set(r.key, (m.get(r.key) || 0) + r.n);
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key, n]) => ({ key, n }));
  };
  const today = dayOf(Date.now());
  const daily = [];
  for (let i = 13; i >= 0; i--) {
    const d = dayOf(Date.now() - i * 86400e3);
    daily.push({ date: `${d}T12:00:00`, count: rows.filter((r) => r.day === d && r.kind === 'visit').reduce((a, r) => a + r.n, 0) });
  }
  return {
    days,
    visits: sum('visit'),
    views: sum('view'),
    today: rows.filter((r) => r.day === today && r.kind === 'visit').reduce((a, r) => a + r.n, 0),
    daily,
    pages: top('view', 8),
    sources: top('ref'),
    campaigns: top('utm'),
    devices: top('device', 3),
  };
}

async function purgeOld(ctx) {
  await ctx.db.run('DELETE FROM analytics_daily WHERE day < ?', dayOf(Date.now() - KEEP_MS));
}

module.exports = { record, summary, purgeOld, device, isBot, dayOf };
