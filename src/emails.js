'use strict';
// Modèles des courriels d'AURUM : mise en page sobre (tableaux et styles en ligne,
// lisibles dans Gmail, Apple Mail et Outlook), version texte pour chaque courriel.

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const firstName = (name) => String(name || '').split(/\s+/)[0];
const memberNo = (n) => `N° ${String(n).padStart(4, '0')}`;
const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const GOLD = '#8a6d43';

function button(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 6px"><tr><td style="border-radius:999px;background:#1d1d1f">
    <a href="${esc(url)}" style="display:inline-block;padding:14px 28px;font:600 16px ${FONT};color:#ffffff;text-decoration:none;border-radius:999px">${esc(label)}</a>
  </td></tr></table>`;
}

function layout({ preheader = '', body, footer = '', baseUrl }) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>AURUM</title></head>
<body style="margin:0;padding:0;background:#f5f5f7">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7"><tr><td align="center" style="padding:28px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td align="center" style="padding:6px 0 22px"><a href="${esc(baseUrl)}" style="font:600 20px ${FONT};letter-spacing:0.42em;color:#1d1d1f;text-decoration:none">AURUM</a></td></tr>
    <tr><td style="background:#ffffff;border-radius:22px;padding:34px 30px;font:16px/1.55 ${FONT};color:#1d1d1f">${body}</td></tr>
    <tr><td align="center" style="padding:22px 18px;font:12.5px/1.5 ${FONT};color:#86868b">${footer || 'AURUM — le cercle privé, sans publicité ni algorithme.'}</td></tr>
  </table>
</td></tr></table></body></html>`;
}

const h1 = (t) => `<h1 style="margin:0 0 14px;font:700 26px/1.2 ${FONT};letter-spacing:-0.02em;color:#1d1d1f">${t}</h1>`;
const p = (t) => `<p style="margin:0 0 14px">${t}</p>`;
const muted = (t) => `<p style="margin:14px 0 0;font-size:13.5px;color:#86868b">${t}</p>`;

// ---------------------------------------------------------------------------
function welcomeEmail(config, user) {
  const url = `${config.baseUrl}/salon`;
  const founder = user.member_number && user.member_number <= config.founderLimit;
  const card = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:6px 0 20px"><tr><td style="border-radius:16px;padding:22px 22px;background:${founder ? 'linear-gradient(135deg,#efe0bf,#c9a56b)' : 'linear-gradient(135deg,#f5f5f7,#e1e1e6)'};background-color:${founder ? '#d9bf8f' : '#ececf0'}">
      <div style="font:600 12px ${FONT};letter-spacing:0.38em;color:#3a2f22">AURUM</div>
      <div style="font:500 26px ${FONT};letter-spacing:0.08em;color:#1d1d1f;margin:18px 0 12px">${memberNo(user.member_number)}</div>
      <div style="font:13px ${FONT};color:#3a2f22">${esc(user.display_name)}${founder ? ' · Fondateur' : ''}</div>
    </td></tr></table>`;
  const html = layout({
    baseUrl: config.baseUrl,
    preheader: `Votre carte de membre ${memberNo(user.member_number)} vous attend.`,
    body:
      h1(`Bienvenue dans le cercle, ${esc(firstName(user.display_name))}.`) +
      card +
      p(founder ? `Vous faites partie des ${config.founderLimit} Fondateurs d’AURUM : votre carte est en or, et votre couronne est permanente.` : 'Votre numéro vous appartient pour toujours : il ne sera jamais réattribué.') +
      p('Pour bien commencer : complétez votre profil, parcourez le Journal, inscrivez-vous à un événement de l’Agenda et partagez vos meilleures adresses dans le Carnet.') +
      button('Entrer dans le Salon', url),
  });
  const text = `Bienvenue dans le cercle, ${firstName(user.display_name)}.\n\nVotre carte de membre : ${memberNo(user.member_number)}${founder ? ' (Fondateur)' : ''}.\n\nEntrer dans le Salon : ${url}\n\n— AURUM`;
  return { subject: `Bienvenue dans le cercle — carte ${memberNo(user.member_number)}`, html, text };
}

function resetEmail(config, user, link) {
  const html = layout({
    baseUrl: config.baseUrl,
    preheader: 'Choisissez un nouveau mot de passe (lien valable une heure).',
    body:
      h1('Nouveau mot de passe') +
      p(`Bonjour ${esc(firstName(user.display_name))},`) +
      p('Pour choisir un nouveau mot de passe, utilisez le bouton ci-dessous. Le lien est valable une heure.') +
      button('Choisir un nouveau mot de passe', link) +
      muted('Si vous n’êtes pas à l’origine de cette demande, ignorez simplement ce courriel : votre mot de passe reste inchangé.'),
  });
  const text = `Bonjour ${firstName(user.display_name)},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez simplement ce courriel.\n\n— AURUM`;
  return { subject: 'AURUM — Votre nouveau mot de passe', html, text };
}

function admissionReceivedEmail(config, user) {
  const html = layout({
    baseUrl: config.baseUrl,
    preheader: 'La Direction étudie chaque candidature personnellement.',
    body:
      h1(`Votre demande est entre de bonnes mains, ${esc(firstName(user.display_name))}.`) +
      p('La Direction du cercle étudie chaque candidature personnellement. Vous recevrez un courriel dès votre admission.') +
      p('Si un membre vous a remis un code d’invitation, vous pouvez l’utiliser à tout moment : l’entrée est alors immédiate.') +
      button('Suivre ma demande', `${config.baseUrl}/rejoindre`),
  });
  const text = `Votre demande d'admission est bien reçue, ${firstName(user.display_name)}.\nLa Direction étudie chaque candidature personnellement ; vous recevrez un courriel dès votre admission.\n\nSuivre ma demande : ${config.baseUrl}/rejoindre\n\n— AURUM`;
  return { subject: 'AURUM — Votre demande d’admission est bien reçue', html, text };
}

// Phase payante : admission acceptée, reste le droit d'entrée
function admissionApprovedEmail(config, user) {
  const price = `${(config.priceCents / 100).toFixed(2).replace('.', ',')} €`;
  const url = `${config.baseUrl}/rejoindre`;
  const html = layout({
    baseUrl: config.baseUrl,
    preheader: 'Votre place est réservée : il ne reste que le droit d’entrée.',
    body:
      h1(`Votre admission est acceptée, ${esc(firstName(user.display_name))}.`) +
      p(`La Direction a accepté votre demande. Les ${config.founderLimit} places gratuites de Fondateur ont toutes trouvé preneur : l’entrée se fait désormais par un droit d’entrée unique de ${price}, sans abonnement.`) +
      p('Votre carte est prête, il ne reste qu’à y graver votre numéro.') +
      button('Finaliser mon entrée', url),
  });
  const text = `Votre admission est acceptée, ${firstName(user.display_name)}.
Les ${config.founderLimit} places gratuites de Fondateur sont attribuées : l'entrée se fait par un droit d'entrée unique de ${price}, sans abonnement.

Finaliser mon entrée : ${url}

— AURUM`;
  return { subject: 'AURUM — Votre admission est acceptée', html, text };
}

function admissionAdminEmail(config, user) {
  const note = user.admission_note ? `<blockquote style="margin:0 0 14px;padding:12px 16px;border-left:3px solid ${GOLD};background:#f8f6f2;border-radius:8px;font-style:italic">${esc(user.admission_note)}</blockquote>` : p('<em>Aucune présentation.</em>');
  const html = layout({
    baseUrl: config.baseUrl,
    preheader: `${user.display_name} souhaite rejoindre le cercle.`,
    body: h1('Nouvelle demande d’admission') + p(`<strong>${esc(user.display_name)}</strong> (@${esc(user.username)}, ${esc(user.email)}) souhaite rejoindre le cercle.`) + note + button('Examiner la demande', `${config.baseUrl}/admin`),
  });
  const text = `Nouvelle demande d'admission : ${user.display_name} (@${user.username}, ${user.email}).\n${user.admission_note ? `« ${user.admission_note} »\n` : ''}\nExaminer : ${config.baseUrl}/admin`;
  return { subject: `AURUM — ${user.display_name} demande à rejoindre le cercle`, html, text };
}

function testEmail(config, user) {
  const html = layout({
    baseUrl: config.baseUrl,
    preheader: 'Les courriels d’AURUM fonctionnent.',
    body: h1('Les courriels fonctionnent.') + p(`Bonjour ${esc(firstName(user.display_name))}, ce courriel de test confirme que l’envoi est bien configuré.`) + p('Les membres recevront désormais leurs courriels de bienvenue, de mot de passe oublié et la Lettre du cercle chaque dimanche.') + button('Ouvrir AURUM', config.baseUrl),
  });
  return { subject: 'AURUM — Courriel de test', html, text: `Les courriels d'AURUM fonctionnent.\n\n${config.baseUrl}` };
}

// ---------------------------------------------------------------------------
// La Lettre du cercle (chaque dimanche)
// ---------------------------------------------------------------------------
function section(title) {
  return `<h2 style="margin:30px 0 12px;font:700 12px ${FONT};letter-spacing:0.16em;text-transform:uppercase;color:${GOLD}">${title}</h2>`;
}
function itemRow({ title, sub, url, image, text }) {
  const img = image
    ? `<td width="88" valign="top" style="padding:0 14px 0 0"><a href="${esc(url)}"><img src="${esc(image)}" width="88" height="88" alt="" style="display:block;width:88px;height:88px;object-fit:cover;border-radius:12px;border:0"></a></td>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr>${img}<td valign="top">
    ${sub ? `<div style="font:600 12.5px ${FONT};color:#86868b;margin:0 0 3px">${esc(sub)}</div>` : ''}
    <a href="${esc(url)}" style="font:600 16px/1.35 ${FONT};color:#1d1d1f;text-decoration:none">${esc(title)}</a>
    ${text ? `<div style="font:14px/1.45 ${FONT};color:#515154;margin-top:4px">${esc(text)}</div>` : ''}
  </td></tr></table>`;
}

function lettreEmail(config, data, recipient, unsubscribeUrl) {
  const first = firstName(recipient.display_name);
  const parts = [];
  parts.push(h1(`Bonjour ${esc(first)},`));
  parts.push(p(data.intro));
  if (data.events.length) {
    parts.push(section('À l’Agenda'));
    for (const e of data.events) parts.push(itemRow({ title: e.title, sub: `${e.when}${e.location ? ` · ${e.location}` : ''}`, url: e.url, image: e.cover, text: `${e.going} participant${e.going > 1 ? 's' : ''}${e.capacity ? ` sur ${e.capacity} places` : ''}` }));
  }
  if (data.posts.length) {
    parts.push(section('Dans le Salon cette semaine'));
    for (const x of data.posts) parts.push(itemRow({ title: x.excerpt, sub: `${x.author} · ${x.reactions} réaction${x.reactions > 1 ? 's' : ''}, ${x.comments} commentaire${x.comments > 1 ? 's' : ''}`, url: x.url, image: x.image }));
  }
  if (data.journal.length) {
    parts.push(section('Le Journal'));
    for (const j of data.journal) parts.push(itemRow({ title: j.title, sub: `${j.label} · ${j.site}`, url: j.url, image: j.image }));
  }
  if (data.place) {
    parts.push(section('L’adresse de la semaine'));
    parts.push(itemRow({ title: `${data.place.name}, ${data.place.city}`, sub: `Recommandé par ${data.place.author}`, url: data.place.url, image: data.place.photo, text: `« ${data.place.note} »` }));
  }
  if (data.newMembers.length) {
    parts.push(section('Ils ont rejoint le cercle'));
    parts.push(p(esc(data.newMembers.join(', ')) + '.'));
  }
  parts.push(button('Ouvrir AURUM', `${config.baseUrl}/salon`));
  const html = layout({
    baseUrl: config.baseUrl,
    preheader: data.preheader,
    body: parts.join(''),
    footer: `Vous recevez la Lettre du cercle chaque dimanche en tant que membre d’AURUM.<br><a href="${esc(unsubscribeUrl)}" style="color:#86868b">Ne plus recevoir la Lettre</a> · <a href="${esc(config.baseUrl)}/reglages" style="color:#86868b">Réglages</a>`,
  });
  const lines = [`Bonjour ${first},`, '', data.intro, ''];
  if (data.events.length) lines.push('À L’AGENDA', ...data.events.map((e) => `• ${e.title} — ${e.when} : ${e.url}`), '');
  if (data.posts.length) lines.push('DANS LE SALON', ...data.posts.map((x) => `• ${x.author} : ${x.excerpt} ${x.url}`), '');
  if (data.journal.length) lines.push('LE JOURNAL', ...data.journal.map((j) => `• ${j.title} (${j.site}) : ${j.url}`), '');
  if (data.place) lines.push('L’ADRESSE DE LA SEMAINE', `• ${data.place.name}, ${data.place.city} : ${data.place.url}`, '');
  if (data.newMembers.length) lines.push(`Ils ont rejoint le cercle : ${data.newMembers.join(', ')}.`, '');
  lines.push(`Ouvrir AURUM : ${config.baseUrl}/salon`, '', `Ne plus recevoir la Lettre : ${unsubscribeUrl}`);
  return { subject: data.subject, html, text: lines.join('\n') };
}

module.exports = { welcomeEmail, resetEmail, admissionReceivedEmail, admissionApprovedEmail, admissionAdminEmail, testEmail, lettreEmail, layout, esc };
