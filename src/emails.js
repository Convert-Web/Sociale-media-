'use strict';
// Modèles des courriels de Vibz : tableaux et styles en ligne (lisibles dans Gmail, Apple Mail et
// Outlook), avec une version texte pour chaque courriel.

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const firstName = (name) => String(name || '').split(/\s+/)[0];
const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";

function button(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px"><tr><td style="border-radius:10px;background:#6c4dff">
    <a href="${esc(url)}" style="display:inline-block;padding:14px 28px;font:700 16px ${FONT};color:#ffffff;text-decoration:none;border-radius:10px">${esc(label)}</a>
  </td></tr></table>`;
}

function layout({ preheader = '', body, footer = '', baseUrl, appName = 'Vibz' }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(appName)}</title></head>
<body style="margin:0;padding:0;background:#f4f3f8">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f8"><tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td align="center" style="padding:6px 0 22px"><a href="${esc(baseUrl)}" style="font:800 26px ${FONT};letter-spacing:-0.03em;color:#6c4dff;text-decoration:none">${esc(appName.toLowerCase())}</a></td></tr>
    <tr><td style="background:#ffffff;border-radius:18px;padding:34px 30px;font:16px/1.55 ${FONT};color:#161823">${body}</td></tr>
    <tr><td align="center" style="padding:22px 18px;font:12.5px/1.5 ${FONT};color:#8a8b91">${footer || `${esc(appName)} — des vidéos courtes, créées par toi.`}</td></tr>
  </table>
</td></tr></table></body></html>`;
}

const h1 = (t) => `<h1 style="margin:0 0 14px;font:800 26px/1.2 ${FONT};letter-spacing:-0.02em;color:#161823">${t}</h1>`;
const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;
const muted = (t) => `<p style="margin:14px 0 0;font-size:13.5px;color:#8a8b91">${t}</p>`;

function welcomeEmail(config, user) {
  const url = `${config.baseUrl}/`;
  const html = layout({
    baseUrl: config.baseUrl,
    appName: config.appName,
    preheader: 'Ton compte est prêt : découvre les vidéos du moment.',
    body:
      h1(`Bienvenue sur ${esc(config.appName)}, ${esc(firstName(user.display_name))} !`) +
      p(`Ton compte <b>@${esc(user.username)}</b> est prêt.`) +
      p('Fais défiler « Pour toi » : plus tu regardes, aimes et commentes, plus le fil te ressemble. Et quand tu veux, touche + pour filmer ta première vidéo.') +
      button('Ouvrir Vibz', url),
  });
  const text = `Bienvenue sur ${config.appName}, ${firstName(user.display_name)} !\n\nTon compte @${user.username} est prêt.\n\nOuvrir ${config.appName} : ${url}`;
  return { subject: `Bienvenue sur ${config.appName} !`, html, text };
}

function resetEmail(config, user, link) {
  const html = layout({
    baseUrl: config.baseUrl,
    appName: config.appName,
    preheader: 'Choisis un nouveau mot de passe (lien valable une heure).',
    body:
      h1('Nouveau mot de passe') +
      p(`Bonjour ${esc(firstName(user.display_name))},`) +
      p('Pour choisir un nouveau mot de passe, utilise le bouton ci-dessous. Le lien est valable une heure.') +
      button('Choisir un nouveau mot de passe', link) +
      muted('Si tu n’es pas à l’origine de cette demande, ignore simplement ce courriel : ton mot de passe reste inchangé.'),
  });
  const text = `Bonjour ${firstName(user.display_name)},\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable 1 heure) :\n${link}\n\nSi tu n'es pas à l'origine de cette demande, ignore simplement ce courriel.`;
  return { subject: `${config.appName} — Ton nouveau mot de passe`, html, text };
}

function testEmail(config, user) {
  const html = layout({
    baseUrl: config.baseUrl,
    appName: config.appName,
    preheader: 'Les courriels fonctionnent.',
    body: h1('Courriel d’essai') + p(`Bonjour ${esc(firstName(user.display_name))}, l’envoi des courriels de ${esc(config.appName)} fonctionne.`),
  });
  return { subject: `${config.appName} — Courriel d’essai`, html, text: `L'envoi des courriels de ${config.appName} fonctionne.` };
}

module.exports = { welcomeEmail, resetEmail, testEmail, layout, esc };
