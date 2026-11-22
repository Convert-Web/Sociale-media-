// Studio créateur : chiffres clés (vues, temps regardé, J'aime, commentaires, abonnés, diamants),
// courbe jour par jour d'un indicateur à la fois (survol pour le détail, tableau pour tout lire),
// meilleures vidéos, derniers LIVE.
import { api } from '../api.js';
import { navigate } from '../router.js';
import { h, icon, short, num, emptyState, timeAgo, duration } from '../dom.js';
import { tile } from '../components/grid.js';
import { openViewer } from '../components/feed.js';

const METRICS = [
  ['views', 'Vues'],
  ['likes', 'J’aime'],
  ['comments', 'Commentaires'],
  ['followers', 'Nouveaux abonnés'],
];
const dayFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dayName = (d) => dayFmt.format(new Date(`${d}T12:00:00`));

// Diagramme en bâtons d'une seule série : bâtons fins arrondis en haut, carrés à la base,
// grille discrète, valeur du jour au survol (ou au toucher), le maximum étiqueté.
function barChart(series, key, label) {
  const W = 640;
  const H = 220;
  const pad = { l: 34, r: 8, t: 22, b: 26 };
  const values = series.map((d) => d[key]);
  const max = Math.max(1, ...values);
  const nice = (() => {
    const p = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / p) * p;
  })();
  const band = (W - pad.l - pad.r) / series.length;
  const bw = Math.min(24, Math.max(4, band - 2));
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': `${label} par jour` });
  for (const f of [0, 0.5, 1]) {
    const v = Math.round(nice * f);
    svg.append(el('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'chart-grid' }), el('text', { x: pad.l - 6, y: y(v) + 4, class: 'chart-axis', 'text-anchor': 'end' }, short(v)));
  }
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const iMax = values.indexOf(Math.max(...values));
  series.forEach((d, i) => {
    const v = d[key];
    const cx = pad.l + band * i + band / 2;
    const top = y(v);
    const base = y(0);
    const hgt = Math.max(0, base - top);
    if (hgt > 0) {
      const r = Math.min(4, hgt, bw / 2);
      const x0 = cx - bw / 2;
      const path = `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${base} Z`;
      svg.append(el('path', { d: path, class: 'chart-bar' }));
    }
    if (i === iMax && v > 0) svg.append(el('text', { x: cx, y: top - 6, class: 'chart-label', 'text-anchor': 'middle' }, short(v)));
    // Zone de survol plus large que le bâton
    const hit = el('rect', { x: pad.l + band * i, y: pad.t, width: band, height: H - pad.t - pad.b, class: 'chart-hit', tabindex: '0' });
    const show = () => {
      tip.hidden = false;
      tip.replaceChildren(h('b', null, num(v)), h('span', null, ` ${label.toLowerCase()} · ${dayName(d.day)}`));
      tip.style.left = `${(cx / W) * 100}%`;
      tip.style.top = `${(top / H) * 100}%`;
      svg.querySelectorAll('.chart-bar').forEach((b) => b.classList.add('dim'));
    };
    const hide = () => {
      tip.hidden = true;
      svg.querySelectorAll('.chart-bar').forEach((b) => b.classList.remove('dim'));
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    svg.append(hit);
    // Quelques dates sous l'axe (la première, la dernière, et régulièrement entre les deux)
    const every = Math.ceil(series.length / 7);
    if (i % every === 0 || i === series.length - 1) svg.append(el('text', { x: cx, y: H - 8, class: 'chart-axis', 'text-anchor': 'middle' }, dayName(d.day)));
  });
  return h('div', { class: 'chart' }, svg, tip);
}

export async function studioView(ctx) {
  ctx.title = 'Studio créateur — Vibz';
  const days = [7, 28, 60].includes(Number(ctx.query.get('jours'))) ? Number(ctx.query.get('jours')) : 7;
  let d;
  try {
    d = await api.get(`/api/studio?days=${days}`);
  } catch (err) {
    return h('div', { class: 'page' }, emptyState('creator', 'Statistiques indisponibles', err.message));
  }
  let metric = 'views';
  const chartHost = h('div');
  const metricTabs = h('div', { class: 'chips' });
  const table = h('details', { class: 'chart-table' });
  const paint = () => {
    const label = METRICS.find(([k]) => k === metric)[1];
    metricTabs.replaceChildren(...METRICS.map(([k, l]) => h('button', { type: 'button', class: `chip${k === metric ? ' on' : ''}`, onclick: () => { metric = k; paint(); } }, l)));
    chartHost.replaceChildren(h('h3', { class: 'chart-title' }, `${label} par jour`), barChart(d.series, metric, label));
    table.replaceChildren(
      h('summary', null, 'Voir le tableau'),
      h('table', null, h('thead', null, h('tr', null, h('th', null, 'Jour'), ...METRICS.map(([, l]) => h('th', null, l)))), h('tbody', null, d.series.map((r) => h('tr', null, h('td', null, dayName(r.day)), ...METRICS.map(([k]) => h('td', null, num(r[k]))))))),
    );
  };
  paint();
  const t = d.totals;
  const kpi = (label, value, sub = null) => h('div', { class: 'kpi' }, h('small', null, label), h('b', null, value), sub ? h('span', null, sub) : null);
  const minutes = Math.round(t.watchMs / 60000);
  const top = d.top.length
    ? h('div', { class: 'grid cols-3' }, d.top.map((p) => tile(p, { onOpen: (post) => openViewer(d.top, { startId: post.id }) })))
    : emptyState('video', 'Aucune vidéo', 'Publie ta première vidéo pour suivre ses statistiques.', h('a', { href: '/creer', class: 'btn btn-primary' }, 'Créer'));
  const lives = d.lives.length
    ? h('div', { class: 'set-card' }, d.lives.map((l) => h('div', { class: 'tx' }, h('span', { class: 'tx-text' }, l.title || 'LIVE', h('small', null, `${timeAgo(l.startedAt)} · ${l.endedAt ? duration((l.endedAt - l.startedAt) / 1000) : 'en cours'}`)), h('span', { class: 'live-stats' }, `👀 ${short(l.peakViewers)}  ❤️ ${short(l.likes)}  💎 ${short(l.diamonds)}`))))
    : h('p', { class: 'muted small pad' }, 'Aucun LIVE pour l’instant.');
  return h(
    'div',
    { class: 'page studio' },
    h('header', { class: 'page-head' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (history.length > 1 ? history.back() : navigate('/reglages')) }, icon('back')), h('h1', null, 'Studio créateur'), h('a', { href: '/creer', class: 'icon-btn', 'aria-label': 'Créer' }, icon('plus'))),
    h('div', { class: 'chips' }, [7, 28, 60].map((n) => h('a', { href: `/studio?jours=${n}`, class: `chip${n === days ? ' on' : ''}` }, `${n} derniers jours`))),
    h('div', { class: 'kpis' },
      kpi('Vues', short(t.views), `${short(t.allViews)} au total`),
      kpi('Temps regardé', minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`),
      kpi('J’aime', short(t.likes)),
      kpi('Commentaires', short(t.comments)),
      kpi('Nouveaux abonnés', short(t.newFollowers), `${short(t.followers)} au total`),
      kpi('Diamants', short(t.diamonds), 'reçus en LIVE')),
    h('section', { class: 'set-group' }, metricTabs, chartHost, table),
    h('section', { class: 'set-group' }, h('h2', null, `Tes meilleures vidéos (${days} jours)`), top),
    h('section', { class: 'set-group' }, h('h2', null, 'Derniers LIVE'), lives),
  );
}
