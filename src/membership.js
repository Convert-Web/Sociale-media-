'use strict';

// Accorde l'accès au cercle après paiement. Idempotent : un même paiement
// (webhook + retour navigateur) ne peut attribuer qu'un seul numéro de membre,
// et un numéro n'est jamais réattribué (voir la table member_numbers).
function grantMembership(ctx, userId, { provider, ref, amountCents, currency, status = 'paid' }) {
  return ctx.db.transaction(() => {
    const user = ctx.db.get('SELECT * FROM users WHERE id = ?', userId);
    const already = ctx.db.get('SELECT id FROM payments WHERE provider_ref = ?', ref);
    if (!already) {
      // Le paiement est toujours enregistré, même si le compte a été supprimé entre-temps.
      ctx.db.run(
        `INSERT INTO payments (user_id, provider, provider_ref, amount_cents, currency, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        user ? userId : null, provider, ref, amountCents, currency, status, Date.now(),
      );
    }
    if (!user) return null;
    if (user.paid_at) return user;
    const { lastInsertRowid: next } = ctx.db.run(
      'INSERT INTO member_numbers (user_id, created_at) VALUES (?, ?)',
      userId, Date.now(),
    );
    ctx.db.run('UPDATE users SET paid_at = ?, member_number = ? WHERE id = ?', Date.now(), next, userId);
    return ctx.db.get('SELECT * FROM users WHERE id = ?', userId);
  });
}

module.exports = { grantMembership };
