'use strict';
const express = require('express');
const { requireAuth } = require('../auth');
const { fail } = require('../http');
const { selfUser } = require('../social');
const { grantMembership } = require('../membership');

async function grantFromCheckoutSession(ctx, session) {
  if (!session || session.payment_status !== 'paid') return null;
  const userId = Number(session.client_reference_id || session.metadata?.user_id);
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return grantMembership(ctx, userId, {
    provider: 'stripe',
    ref: session.id,
    amountCents: session.amount_total ?? ctx.config.priceCents,
    currency: session.currency || ctx.config.currency,
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
        event = ctx.stripe.webhooks.constructEvent(
          req.body,
          req.get('stripe-signature'),
          ctx.config.stripe.webhookSecret,
        );
      } catch (err) {
        console.warn('[stripe] signature de webhook invalide :', err.message);
        return res.status(400).send('Signature invalide');
      }
      if (
        event.type === 'checkout.session.completed' ||
        event.type === 'checkout.session.async_payment_succeeded'
      ) {
        const user = await grantFromCheckoutSession(ctx, event.data.object);
        if (user) console.log(`[stripe] accès accordé à @${user.username} (membre n°${user.member_number})`);
      }
      res.json({ received: true });
    },
  ];
}

module.exports = function billingRoutes(ctx) {
  const r = express.Router();
  const { config } = ctx;

  r.post('/billing/checkout', requireAuth, async (req, res) => {
    if (req.user.paid_at) return res.json({ alreadyMember: true });
    if (req.body.waiver !== true) {
      fail(400, "Merci de confirmer votre demande d'accès immédiat pour continuer.");
    }
    if (ctx.stripe) {
      const session = await ctx.stripe.checkout.sessions.create({
        mode: 'payment',
        locale: 'fr',
        customer_email: req.user.email,
        client_reference_id: String(req.user.id),
        metadata: { user_id: String(req.user.id), username: req.user.username },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: config.currency,
              unit_amount: config.priceCents,
              product_data: {
                name: `${config.appName} — Droit d'entrée au cercle`,
                description: 'Accès à vie, numéro de membre personnel, zéro publicité.',
              },
            },
          },
        ],
        custom_text: {
          submit: {
            message:
              "Accès immédiat au cercle : vous avez demandé l'exécution immédiate et renoncé à votre droit de rétractation.",
          },
        },
        success_url: `${config.baseUrl}/api/billing/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.baseUrl}/rejoindre?annule=1`,
      });
      return res.json({ url: session.url });
    }
    if (config.demoPayments) return res.json({ demo: true });
    fail(503, 'Le paiement est momentanément indisponible.');
  });

  // Retour depuis Stripe Checkout : on vérifie le paiement côté serveur
  // (le webhook fait la même chose, de façon idempotente).
  r.get('/billing/return', async (req, res) => {
    const id = typeof req.query.session_id === 'string' ? req.query.session_id : '';
    if (!ctx.stripe || !/^cs_[A-Za-z0-9_]+$/.test(id)) return res.redirect('/rejoindre');
    try {
      const session = await ctx.stripe.checkout.sessions.retrieve(id);
      const user = await grantFromCheckoutSession(ctx, session);
      return res.redirect(user ? '/bienvenue' : '/rejoindre?statut=attente');
    } catch (err) {
      console.error('[stripe] vérification impossible :', err.message);
      return res.redirect('/rejoindre?statut=erreur');
    }
  });

  // Paiement simulé (développement / démonstration uniquement)
  r.post('/billing/demo', requireAuth, async (req, res) => {
    if (!config.demoPayments) fail(404, 'Indisponible.');
    if (req.body.waiver !== true) {
      fail(400, "Merci de confirmer votre demande d'accès immédiat pour continuer.");
    }
    const user = await grantMembership(ctx, req.user.id, {
      provider: 'demo',
      ref: `demo_${req.user.id}`,
      amountCents: config.priceCents,
      currency: config.currency,
    });
    res.json({ user: selfUser(ctx, user) });
  });

  return r;
};

module.exports.webhookHandler = webhookHandler;
