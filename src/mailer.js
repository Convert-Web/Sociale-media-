'use strict';
const nodemailer = require('nodemailer');

function createMailer(config) {
  const transport = config.smtp.url ? nodemailer.createTransport(config.smtp.url) : null;

  return {
    enabled: Boolean(transport),
    async send({ to, subject, text, html }) {
      if (!transport) {
        // Sans SMTP configuré, l'e-mail est affiché dans la console (pratique en développement).
        console.log(`\n[email] À : ${to}\n[email] Objet : ${subject}\n${text}\n`);
        return;
      }
      await transport.sendMail({ from: config.smtp.from, to, subject, text, html });
    },
  };
}

module.exports = { createMailer };
