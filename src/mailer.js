'use strict';
// Envoi des courriels : Brevo (offre gratuite, 300 courriels par jour) par son interface web,
// sinon un serveur SMTP classique, sinon simple affichage dans la console (développement).
const nodemailer = require('nodemailer');

function parseFrom(from) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from || '');
  return m ? { name: m[1].trim() || 'Vibz', email: m[2].trim() } : { name: 'Vibz', email: (from || '').trim() };
}

function createMailer(config) {
  const brevoKey = config.mail?.brevoKey || '';
  const transport = !brevoKey && config.smtp.url ? nodemailer.createTransport(config.smtp.url) : null;
  const sender = parseFrom(config.smtp.from);
  const provider = brevoKey ? 'brevo' : transport ? 'smtp' : null;

  async function brevo(payload) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender, ...payload }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(`Brevo a refusé l’envoi (${res.status}) : ${detail.message || detail.code || 'erreur inconnue'}`);
    }
    return res.json().catch(() => ({}));
  }

  async function send({ to, name, subject, text, html, replyTo }) {
    if (provider === 'brevo') {
      await brevo({ to: [{ email: to, ...(name ? { name } : {}) }], subject, htmlContent: html || `<pre>${text}</pre>`, textContent: text, ...(replyTo ? { replyTo: { email: replyTo } } : {}) });
      return;
    }
    if (provider === 'smtp') {
      await transport.sendMail({ from: config.smtp.from, to, subject, text, html, replyTo });
      return;
    }
    // Sans service configuré, le courriel est affiché dans la console (pratique en développement).
    console.log(`\n[courriel] À : ${to}\n[courriel] Objet : ${subject}\n${text}\n`);
  }

  // Envoi groupé : une seule requête Brevo pour 500 destinataires
  async function sendBatch(messages) {
    let sent = 0;
    if (provider === 'brevo') {
      for (let i = 0; i < messages.length; i += 500) {
        const chunk = messages.slice(i, i + 500);
        await brevo({
          subject: chunk[0].subject,
          htmlContent: chunk[0].html,
          textContent: chunk[0].text,
          messageVersions: chunk.map((m) => ({ to: [{ email: m.to, ...(m.name ? { name: m.name } : {}) }], subject: m.subject, htmlContent: m.html, textContent: m.text })),
        });
        sent += chunk.length;
      }
      return sent;
    }
    for (const m of messages) {
      await send(m);
      sent++;
    }
    return sent;
  }

  return { enabled: Boolean(provider), provider, from: sender.email ? `${sender.name} <${sender.email}>` : '', send, sendBatch };
}

module.exports = { createMailer, parseFrom };
