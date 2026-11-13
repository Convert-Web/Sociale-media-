'use strict';

// Admet un membre : attribue son numéro (jamais réattribué, voir la table
// member_numbers) et ouvre l'accès. Sans effet si le membre est déjà admis.
// La colonne paid_at sert de date d'admission, que l'entrée soit payante ou non.
function admitMember(ctx, userId) {
  return ctx.db.transaction(() => {
    const user = ctx.db.get('SELECT * FROM users WHERE id = ?', userId);
    if (!user || user.paid_at) return user || null;
    const { lastInsertRowid: next } = ctx.db.run(
      'INSERT INTO member_numbers (user_id, created_at) VALUES (?, ?)',
      userId, Date.now(),
    );
    ctx.db.run('UPDATE users SET paid_at = ?, member_number = ? WHERE id = ?', Date.now(), next, userId);
    return ctx.db.get('SELECT * FROM users WHERE id = ?', userId);
  });
}

// Accorde l'accès après paiement. Idempotent : un même paiement
// (webhook + retour navigateur) ne peut attribuer qu'un seul numéro de membre.
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
    return admitMember(ctx, userId);
  });
}

module.exports = { admitMember, grantMembership };
