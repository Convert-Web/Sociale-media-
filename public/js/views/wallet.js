// Portefeuille : pièces (recharges par Stripe, ou simulées en développement), diamants reçus
// en cadeaux pendant les LIVE, historique.
import { api } from '../api.js';
import { store } from '../store.js';
import { navigate, safePath } from '../router.js';
import { h, icon, money, num, timeAgo, toast, modal, emptyState, deName } from '../dom.js';

export async function walletView(ctx) {
  ctx.title = 'Portefeuille — AURUM';
  let w;
  try {
    w = await api.get('/api/wallet');
  } catch (err) {
    return h('div', { class: 'page' }, emptyState('wallet', 'Portefeuille indisponible', err.message));
  }
  // Venu d'un LIVE (« Recharger ») : on y revient après l'achat
  let back = safePath(ctx.query.get('suite'), null);
  try {
    if (back) sessionStorage.setItem('vibz:suite', back);
    else if (ctx.query.get('recharge')) back = safePath(sessionStorage.getItem('vibz:suite'), null);
    if (ctx.query.get('recharge') || ctx.query.get('annule')) sessionStorage.removeItem('vibz:suite');
  } catch {
    /* stockage indisponible */
  }
  const status = ctx.query.get('recharge');
  if (status === 'ok') toast('Paiement reçu : tes pièces sont créditées');
  else if (status === 'attente') toast('Paiement en cours de confirmation…');
  else if (status === 'erreur') toast('Le paiement n’a pas pu être vérifié.', 'error');
  if (ctx.query.get('annule')) toast('Recharge annulée');

  const coins = h('b', null, num(w.coins));
  const buy = (pack) => {
    const waiver = h('input', { type: 'checkbox', required: true });
    const go = h('button', { type: 'submit', class: 'btn btn-primary btn-block' }, w.demo ? `Créditer ${num(pack.coins)} pièces (démo)` : `Payer ${money(pack.cents, w.currency)}`);
    const m = modal('Recharger', h('form', {
      class: 'modal-body form-stack',
      onsubmit: async (e) => {
        e.preventDefault();
        go.disabled = true;
        try {
          const r = await api.post('/api/wallet/checkout', { pack: pack.id, waiver: waiver.checked });
          if (r.url) {
            location.href = r.url;
            return;
          }
          m.close();
          coins.textContent = num(r.coins);
          store.setUser({ ...store.user, coins: r.coins });
          toast(`${num(r.credited)} pièces ajoutées (mode démo, aucun paiement réel)`);
          if (back) navigate(back);
          else navigate('/portefeuille', { replace: true });
        } catch (err) {
          go.disabled = false;
          toast(err.message, 'error');
        }
      },
    },
    h('div', { class: 'pack-summary' }, icon('coin'), h('b', null, `${num(pack.coins)} pièces`), h('span', null, w.demo ? 'Mode démonstration' : money(pack.cents, w.currency))),
    w.demo ? h('p', { class: 'notice' }, 'Mode démonstration : aucun paiement n’est encaissé. En ligne, la recharge passe par Stripe (carte, Apple Pay, Google Pay).') : null,
    h('label', { class: 'check' }, waiver, h('span', null, 'Je demande la livraison immédiate de mes pièces et renonce à mon droit de rétractation (', h('a', { href: '/cgv', target: '_blank' }, 'CGV'), ').')),
    go));
  };
  const packs = h('div', { class: 'packs' }, w.packs.map((p) => h('button', { type: 'button', class: 'pack', onclick: () => (w.stripe || w.demo ? buy(p) : toast('Les recharges ne sont pas encore ouvertes.', 'error')) }, h('span', { class: 'pack-coins' }, icon('coin'), num(p.coins)), h('small', null, w.demo ? 'Démo' : money(p.cents, w.currency)))));
  const gifts = h('div', { class: 'gift-grid small' }, w.gifts.map((g) => h('div', { class: 'gift' }, h('span', { class: 'gift-emoji' }, g.emoji), h('b', null, g.name), h('small', null, icon('coin', 'icon-xs'), num(g.coins)))));
  const label = (t) => {
    if (t.kind === 'purchase') return `Recharge de ${num(t.coins)} ${t.coins > 1 ? 'pièces' : 'pièce'}`;
    if (t.kind === 'gift_sent') return `${t.gift ? `${t.gift.emoji} ${t.gift.name}` : 'Cadeau'}${t.count > 1 ? ` ×${t.count}` : ''} envoyé${t.other ? ` à ${t.other.displayName}` : ''}`;
    if (t.kind === 'gift_received') return `${t.gift ? `${t.gift.emoji} ${t.gift.name}` : 'Cadeau'}${t.count > 1 ? ` ×${t.count}` : ''} reçu${t.other ? ` ${deName(t.other.displayName)}` : ''}`;
    return t.kind;
  };
  const historyEl = w.history.length
    ? h('div', { class: 'set-card' }, w.history.map((t) => h('div', { class: 'tx' }, h('span', { class: 'tx-text' }, label(t), h('small', null, timeAgo(t.createdAt))), h('b', { class: t.coins < 0 ? 'neg' : 'pos' }, t.coins ? `${t.coins > 0 ? '+' : '−'}${num(Math.abs(t.coins))} ${Math.abs(t.coins) > 1 ? 'pièces' : 'pièce'}` : `+${num(t.diamonds)} 💎`))))
    : h('p', { class: 'muted small pad' }, 'Aucune opération pour l’instant.');
  return h(
    'div',
    { class: 'page wallet' },
    h('header', { class: 'page-head' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retour', onclick: () => (window.history.length > 1 ? window.history.back() : navigate('/reglages')) }, icon('back')), h('h1', null, 'Portefeuille'), h('span', { class: 'icon-btn' })),
    back ? h('a', { href: back, class: 'btn btn-primary btn-block wallet-back' }, icon('live', 'icon-sm'), 'Revenir au LIVE') : null,
    h('div', { class: 'balance-cards' },
      h('div', { class: 'balance coins' }, h('small', null, 'Pièces'), h('div', { class: 'balance-num' }, icon('coin'), coins), h('p', null, 'Pour offrir des cadeaux pendant les LIVE.')),
      h('div', { class: 'balance diamonds' }, h('small', null, 'Diamants reçus'), h('div', { class: 'balance-num' }, icon('diamond'), h('b', null, num(w.diamonds))), h('p', null, `Valeur indicative : ${money(w.diamondsValueCents, w.currency)}`))),
    h('section', { class: 'set-group' }, h('h2', null, 'Recharger'), packs, !w.stripe && !w.demo ? h('p', { class: 'muted small' }, 'Les recharges s’ouvriront dès que le paiement en ligne sera configuré.') : null),
    h('section', { class: 'set-group' }, h('h2', null, 'Cadeaux du LIVE'), gifts),
    h('section', { class: 'set-group' }, h('h2', null, 'Historique'), historyEl),
  );
}
