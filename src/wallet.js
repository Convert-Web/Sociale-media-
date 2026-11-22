'use strict';
// Portefeuille : pièces (achetées) et diamants (reçus en cadeaux pendant les LIVE).
// Une pièce dépensée en cadeau donne un diamant au créateur.
const { fail } = require('./http');

// Recharges proposées (prix TTC en centimes)
const PACKS = [
  { id: 'p100', coins: 100, cents: 129 },
  { id: 'p350', coins: 350, cents: 449 },
  { id: 'p700', coins: 700, cents: 899 },
  { id: 'p1400', coins: 1400, cents: 1799 },
  { id: 'p3500', coins: 3500, cents: 4499 },
  { id: 'p7000', coins: 7000, cents: 8999 },
];

// Cadeaux du LIVE (prix en pièces)
const GIFTS = [
  { id: 'rose', name: 'Rose', emoji: '🌹', coins: 1 },
  { id: 'coeur', name: 'Cœur', emoji: '💖', coins: 5 },
  { id: 'cafe', name: 'Café', emoji: '☕', coins: 10 },
  { id: 'donut', name: 'Donut', emoji: '🍩', coins: 30 },
  { id: 'etoile', name: 'Étoile', emoji: '🌟', coins: 99 },
  { id: 'couronne', name: 'Couronne', emoji: '👑', coins: 199 },
  { id: 'fusee', name: 'Fusée', emoji: '🚀', coins: 499 },
  { id: 'licorne', name: 'Licorne', emoji: '🦄', coins: 999 },
  { id: 'planete', name: 'Planète', emoji: '🪐', coins: 2999 },
];
const giftById = (id) => GIFTS.find((g) => g.id === id) || null;
// Valeur indicative d'un diamant pour le créateur (en centimes)
const DIAMOND_CENTS = 0.5;

// Crédit d'un achat de pièces : une seule fois par référence de paiement (rejeu sans effet)
async function creditPurchase(ctx, { userId, pack, provider, ref, amountCents, currency }) {
  const p = PACKS.find((x) => x.id === pack);
  if (!p || !userId) return null;
  return ctx.db.transaction(async (t) => {
    const user = await t.get('SELECT id FROM users WHERE id = ?', userId);
    if (!user) return null;
    const dup = await t.get('SELECT id FROM payments WHERE provider_ref = ?', ref);
    if (dup) return { duplicate: true };
    const now = Date.now();
    await t.run(
      'INSERT INTO payments (user_id, provider, provider_ref, amount_cents, currency, status, created_at, coins) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      userId, provider, ref, amountCents ?? p.cents, currency || ctx.config.currency, 'paid', now, p.coins,
    );
    await t.run('UPDATE users SET coins = coins + ? WHERE id = ?', p.coins, userId);
    await t.run('INSERT INTO wallet_tx (user_id, kind, coins, ref, created_at) VALUES (?, ?, ?, ?, ?)', userId, 'purchase', p.coins, ref, now);
    return { coins: p.coins };
  });
}

// Cadeau : pièces retirées à l'un, diamants donnés à l'autre (tout ou rien)
async function sendGift(ctx, { from, toId, giftId, count = 1, liveId = null, postId = null }) {
  const gift = giftById(giftId);
  if (!gift) fail(400, 'Cadeau inconnu.');
  const n = Math.max(1, Math.min(99, Math.floor(Number(count) || 1)));
  if (toId === from.id) fail(400, 'Tu ne peux pas t’offrir un cadeau.');
  const cost = gift.coins * n;
  const now = Date.now();
  const result = await ctx.db.transaction(async (t) => {
    const { changes } = await t.run('UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?', cost, from.id, cost);
    if (!changes) fail(402, 'Tu n’as pas assez de pièces. Recharge ton portefeuille.', 'NO_COINS');
    await t.run('UPDATE users SET diamonds = diamonds + ? WHERE id = ?', cost, toId);
    await t.run(
      'INSERT INTO wallet_tx (user_id, kind, coins, other_id, live_id, post_id, gift, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      from.id, 'gift_sent', -cost, toId, liveId, postId, `${gift.id}x${n}`, now,
    );
    await t.run(
      'INSERT INTO wallet_tx (user_id, kind, diamonds, other_id, live_id, post_id, gift, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      toId, 'gift_received', cost, from.id, liveId, postId, `${gift.id}x${n}`, now,
    );
    if (liveId) await t.run('UPDATE lives SET diamonds = diamonds + ? WHERE id = ?', cost, liveId);
    const left = await t.get('SELECT coins FROM users WHERE id = ?', from.id);
    return { coins: left.coins };
  });
  return { gift, count: n, cost, coins: result.coins };
}

module.exports = { PACKS, GIFTS, giftById, DIAMOND_CENTS, creditPurchase, sendGift };
