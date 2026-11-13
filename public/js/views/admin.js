import { api } from '../api.js';
import { store } from '../store.js';
import { h, avatar, nameLine, memberChip, money, num, timeAgo, toast, confirmDialog, emptyState } from '../dom.js';
import { backHead } from './feed.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  for (const k of kids) el.append(k);
  return el;
}

function signupChart(days) {
  const W = 600;
  const H = 180;
  const pad = { t: 16, b: 26, l: 4, r: 4 };
  const max = Math.max(1, ...days.map((d) => d.count));
  const bw = (W - pad.l - pad.r) / days.length;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Nouveaux membres sur 14 jours' });
  root.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, class: 'chart-axis' }));
  days.forEach((d, i) => {
    const hgt = ((H - pad.t - pad.b) * d.count) / max;
    const x = pad.l + i * bw + bw * 0.18;
    const w = bw * 0.64;
    const y = H - pad.b - hgt;
    const g = svg('g', {});
    g.append(svg('title', {}, `${new Date(d.date).toLocaleDateString('fr-FR')} : ${d.count}`));
    g.append(svg('rect', { x, y: d.count ? y : H - pad.b - 2, width: w, height: d.count ? hgt : 2, rx: 4, class: d.count ? 'chart-bar' : 'chart-bar-empty' }));
    if (d.count) {
      const t = svg('text', { x: x + w / 2, y: y - 5, 'text-anchor': 'middle', class: 'chart-value', 'font-size': '11' });
      t.textContent = d.count;
      g.append(t);
    }
    if (i % 2 === 0 || i === days.length - 1) {
      const lbl = svg('text', { x: x + w / 2, y: H - 8, 'text-anchor': 'middle', class: 'chart-label', 'font-size': '10.5' });
      lbl.textContent = new Date(d.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      g.append(lbl);
    }
    root.append(g);
  });
  return root;
}

export async function adminView(ctx) {
  const data = await api.get('/api/admin/overview');
  const t = data.totals;
  const conversion = t.members + t.pending ? Math.round((t.members / (t.members + t.pending)) * 100) : 0;

  const kpi = (label, value, gold, sub) => h('div', { class: `kpi${gold ? ' gold' : ''}` }, h('small', null, label), h('b', { class: gold ? 'accent' : '' }, value), sub ? h('span', { class: 'muted small' }, sub) : null);

  const memberRows = data.recentMembers.map((m) => {
    const row = h(
      'tr',
      null,
      h('td', null, h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, avatar(m, 'xs'), h('div', null, nameLine(m), h('div', { class: 'muted small' }, m.email)))),
      h('td', null, m.memberNumber ? memberChip(m) : h('span', { class: 'tag' }, 'En attente')),
      h('td', { class: 'muted small' }, timeAgo(m.createdAt)),
      h(
        'td',
        { style: { textAlign: 'right' } },
        m.id === store.user.id
          ? h('span', { class: 'muted small' }, 'Vous')
          : h(
          'button',
          {
            class: 'btn btn-danger btn-sm',
            onclick: async () => {
              if (!(await confirmDialog(`Exclure ${m.displayName} ?`, 'Le compte et tout son contenu seront supprimés définitivement.', 'Exclure'))) return;
              try {
                await api.del(`/api/admin/users/${m.id}`);
                row.remove();
                toast('Membre exclu.');
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          'Exclure',
        ),
      ),
    );
    return row;
  });

  const paymentRows = data.recentPayments.map((p) =>
    h(
      'tr',
      null,
      h('td', null, p.username ? `@${p.username}` : h('span', { class: 'muted' }, 'compte supprimé')),
      h('td', null, money(p.amount_cents, p.currency)),
      h('td', null, h('span', { class: 'tag' }, p.provider === 'demo' ? 'Simulé' : 'Stripe')),
      h('td', { class: 'muted small' }, timeAgo(p.created_at)),
    ),
  );

  ctx.title = 'Direction — AURUM';
  return h(
    'div',
    null,
    backHead('Direction du cercle', data.config.stripeEnabled ? 'Paiements Stripe actifs' : 'Paiements en mode démonstration'),
    h(
      'div',
      { class: 'kpis' },
      kpi('Membres', num(t.members), true),
      kpi("Droits d'entrée encaissés", money(t.revenue), true, t.demoRevenue ? `+ ${money(t.demoRevenue)} simulés` : null),
      kpi('Conversion', `${conversion} %`, false, `${num(t.pending)} inscrit${t.pending > 1 ? 's' : ''} sans paiement`),
      kpi('Publications', num(t.posts)),
      kpi('Commentaires', num(t.comments)),
      kpi('Messages privés', num(t.messages)),
    ),
    h('div', { class: 'section-title' }, 'Nouveaux membres — 14 jours'),
    h('div', { class: 'chart' }, signupChart(data.signups)),
    h('div', { class: 'section-title' }, 'Derniers inscrits'),
    memberRows.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Membre'), h('th', null, 'Statut'), h('th', null, 'Inscription'), h('th'))), h('tbody', null, memberRows)))
      : emptyState('users', 'Aucun inscrit', null),
    h('div', { class: 'section-title' }, 'Derniers paiements'),
    paymentRows.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Membre'), h('th', null, 'Montant'), h('th', null, 'Moyen'), h('th', null, 'Date'))), h('tbody', null, paymentRows)))
      : emptyState('euro', 'Aucun paiement', null),
  );
}
