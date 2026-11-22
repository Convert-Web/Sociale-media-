'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { fail } = require('../http');
const { PACKS, GIFTS, DIAMOND_CENTS, creditPurchase } = require('../wallet');

// Achat confirmé par Stripe (retour de paiement ou webhook) : crédité une seule fois
async function creditFromSession(ctx, session) {
  if (!session || session.payment_status !== 'paid') return null;
  const userId = Number(session.client_reference_id || session.metadata?.user_id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return creditPurchase(ctx, {
    userId,
    pack: session.metadata?.pack,
    provider: 'stripe',
    ref: session.id,
    amountCents: session.amount_total,
    currency: session.currency,
  });
}

// Webhook Stripe : doit recevoir le corps brut pour vérifier la signature.
function webhookHandler(ctx) {
  return [
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (req, res) => {
      if (!ctx.stripe || !ctx.config.stripe.webhookSecret) return res.status(404).end();
      let event;
      try {
        event = ctx.stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), ctx.config.stripe.webhookSecret);
      } catch (err) {
        console.warn('[stripe] signature de webhook invalide :', err.message);
        return res.status(400).send('Signature invalide');
      }
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        const out = await creditFromSession(ctx, event.data.object);
        if (out?.coins) console.log(`[stripe] ${out.coins} pièces créditées (session ${event.data.object.id})`);
      }
      res.json({ received: true });
    },
  ];
}

module.exports = function walletRoutes(ctx) {
  const r = express.Router();
  const { db, config } = ctx;

  r.get('/gifts', (_req, res) => res.json({ gifts: GIFTS }));

  r.get('/wallet', requireAuth, async (req, res) => {
    const u = await db.get('SELECT coins, diamonds FROM users WHERE id = ?', req.user.id);
    const history = await db.all(
      `SELECT t.kind, t.coins, t.diamonds, t.gift, t.created_at, o.username, o.display_name
       FROM wallet_tx t LEFT JOIN users o ON o.id = t.other_id WHERE t.user_id = ? ORDER BY t.id DESC LIMIT 40`,
      req.user.id,
    );
    res.json({
      coins: u.coins,
      diamonds: u.diamonds,
      diamondsValueCents: Math.floor(u.diamonds * DIAMOND_CENTS),
      packs: PACKS,
      gifts: GIFTS,
      currency: config.currency,
      stripe: Boolean(ctx.stripe),
      demo: !ctx.stripe && config.demoPayments,
      history: history.map((t) => {
        const [gift, n] = (t.gift || '').split('x');
        return { kind: t.kind, coins: t.coins, diamonds: t.diamonds, gift: gift ? GIFTS.find((g) => g.id === gift) || null : null, count: Number(n) || 1, createdAt: t.created_at, other: t.username ? { username: t.username, displayName: t.display_name } : null };
      }),
    });
  });

  // Recharger : paiement Stripe Checkout (ou crédit simulé en développement)
  r.post('/wallet/checkout', requireAuth, async (req, res) => {
    const pack = PACKS.find((p) => p.id === req.body?.pack);
    if (!pack) fail(400, 'Choisis une recharge.');
    if (req.body?.waiver !== true) fail(400, 'Confirme ta demande de livraison immédiate des pièces pour continuer.');
    if (ctx.stripe) {
      const session = await ctx.stripe.checkout.sessions.create({
        mode: 'payment',
        locale: 'fr',
        customer_email: req.user.email,
        client_reference_id: String(req.user.id),
        metadata: { user_id: String(req.user.id), pack: pack.id },
        line_items: [{ quantity: 1, price_data: { currency: config.currency, unit_amount: pack.cents, product_data: { name: `${pack.coins} pièces ${config.appName}`, description: 'Pièces virtuelles pour envoyer des cadeaux pendant les LIVE.' } } }],
        custom_text: { submit: { message: 'Livraison immédiate des pièces : tu as demandé l’exécution immédiate et renoncé à ton droit de rétractation.' } },
        success_url: `${config.baseUrl}/api/wallet/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.baseUrl}/portefeuille?annule=1`,
      });
      return res.json({ url: session.url });
    }
    if (config.demoPayments) {
      const out = await creditPurchase(ctx, { userId: req.user.id, pack: pack.id, provider: 'demo', ref: `demo_${req.user.id}_${Date.now()}`, amountCents: 0, currency: config.currency });
      const u = await db.get('SELECT coins FROM users WHERE id = ?', req.user.id);
      return res.json({ demo: true, credited: out?.coins || 0, coins: u.coins });
    }
    fail(503, 'Les recharges ne sont pas encore ouvertes.', 'PAYMENT_UNAVAILABLE');
  });

  // Retour de Stripe : le paiement est vérifié côté serveur (le webhook fait de même, sans double crédit)
  r.get('/wallet/return', async (req, res) => {
    const id = typeof req.query.session_id === 'string' ? req.query.session_id : '';
    if (!ctx.stripe || !/^cs_[A-Za-z0-9_]+$/.test(id)) return res.redirect('/portefeuille');
    try {
      const session = await ctx.stripe.checkout.sessions.retrieve(id);
      const out = await creditFromSession(ctx, session);
      return res.redirect(out ? '/portefeuille?recharge=ok' : '/portefeuille?recharge=attente');
    } catch (err) {
      console.error('[stripe] vérification impossible :', err.message);
      return res.redirect('/portefeuille?recharge=erreur');
    }
  });

  return r;
};

module.exports.webhookHandler = webhookHandler;
