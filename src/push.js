'use strict';
// Notifications push (Web Push) : messages, abonnements, commentaires, LIVE.
// Les clés VAPID sont générées une seule fois puis conservées dans la base :
// aucune configuration n'est nécessaire chez l'hébergeur.
const webpush = require('web-push');

let cached = null;

async function vapidKeys(ctx) {
  if (cached) return cached;
  let row = await ctx.db.get("SELECT value FROM settings WHERE key = 'vapid'");
  if (!row) {
    const keys = webpush.generateVAPIDKeys();
    // Si deux instances démarrent en même temps, la première clé enregistrée l'emporte.
    await ctx.db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid', ?)", JSON.stringify(keys));
    row = await ctx.db.get("SELECT value FROM settings WHERE key = 'vapid'");
  }
  cached = JSON.parse(row.value);
  return cached;
}

function subject(config) {
  return config.baseUrl.startsWith('https://') ? config.baseUrl : 'mailto:notifications@vibz.invalid';
}

// Envoie une notification à tous les appareils d'un membre (sans jamais faire échouer la requête).
async function sendPush(ctx, userId, payload) {
  try {
    const subs = await ctx.db.all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
    if (!subs.length) return 0;
    const { publicKey, privateKey } = await vapidKeys(ctx);
    const send = ctx.pushSender || webpush.sendNotification;
    const body = JSON.stringify(payload);
    let delivered = 0;
    const jobs = subs.map(async (s) => {
      try {
        await send(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { vapidDetails: { subject: subject(ctx.config), publicKey, privateKey }, TTL: 24 * 3600, urgency: 'high', timeout: 4000 },
        );
        delivered++;
      } catch (err) {
        // Abonnement expiré ou révoqué : on l'oublie.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await ctx.db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
        } else {
          console.warn('[push] envoi impossible :', err.statusCode || '', err.message);
        }
      }
    });
    // On n'attend jamais plus de 5 secondes (hébergement serverless).
    await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 5000))]);
    return delivered;
  } catch (err) {
    console.warn('[push] erreur :', err.message);
    return 0;
  }
}

// Une même notification pour tous les membres qui l'acceptent (Sujet du jour) : envois en parallèle
// (20 à la fois), 8 secondes au plus (hébergement serverless). Les abonnements expirés sont oubliés.
async function sendPushToAll(ctx, payload, { pref = null, budget = 8000 } = {}) {
  try {
    const { prefs } = require('./social');
    const rows = await ctx.db.all(
      'SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, u.notify_prefs FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id WHERE u.banned_at IS NULL',
    );
    const subs = pref ? rows.filter((r) => prefs(r)[pref] !== false) : rows;
    if (!subs.length) return 0;
    const { publicKey, privateKey } = await vapidKeys(ctx);
    const send = ctx.pushSender || webpush.sendNotification;
    const body = JSON.stringify(payload);
    const end = Date.now() + budget;
    let next = 0;
    let delivered = 0;
    const worker = async () => {
      while (next < subs.length && Date.now() < end) {
        const s = subs[next++];
        try {
          await send(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { vapidDetails: { subject: subject(ctx.config), publicKey, privateKey }, TTL: 6 * 3600, urgency: 'normal', timeout: 4000 },
          );
          delivered++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) await ctx.db.run('DELETE FROM push_subscriptions WHERE id = ?', s.id).catch(() => {});
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(20, subs.length) }, worker));
    if (next < subs.length) console.warn(`[push] envoi groupé interrompu : ${subs.length - next} appareils non prévenus`);
    return delivered;
  } catch (err) {
    console.warn('[push] envoi groupé :', err.message);
    return 0;
  }
}

module.exports = { vapidKeys, sendPush, sendPushToAll };
